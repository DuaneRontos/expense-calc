package com.duanerontos.expensecalc.api;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import com.duanerontos.expensecalc.classification.Classification;
import com.duanerontos.expensecalc.classification.ClassificationRecord;
import com.duanerontos.expensecalc.classification.ClassificationRecordRepository;
import com.duanerontos.expensecalc.classification.ExpenseClassifier;
import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.expense.Expense;
import com.duanerontos.expensecalc.expense.ExpenseRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The write side of spec §8: create, amend, reclassify, delete.
 *
 * <p><b>Every write that changes a category appends a classification record in
 * the same transaction as the change.</b> An expense that exists without one
 * would be indistinguishable from an expense nobody has classified, and the
 * history is what makes a category explicable months later (#9).
 */
@Service
public class ExpenseService {

	private final ExpenseRepository expenses;

	private final ClassificationRecordRepository records;

	private final ExpenseClassifier classifier;

	private final Clock clock;

	public ExpenseService(ExpenseRepository expenses, ClassificationRecordRepository records,
			ExpenseClassifier classifier, Clock clock) {
		this.expenses = expenses;
		this.records = records;
		this.classifier = classifier;
		this.clock = clock;
	}

	/**
	 * Records a new expense and classifies it.
	 *
	 * <p>Currency is checked before anything is written — spec §9.6 wants a
	 * non-{@code PHP} expense rejected at the boundary so no aggregation can
	 * ever sum across currencies. {@code Expense.record} does that check first,
	 * before any conversion.
	 *
	 * <p>An unmatched expense is recorded as {@code UNCLASSIFIED} rather than
	 * left without a record: "nothing matched" is an answer (spec §5), and
	 * skipping the write would make it indistinguishable from "never classified".
	 */
	@Transactional
	public ExpenseDetail create(BigDecimal amount, String currency, java.time.LocalDate occurredOn, String merchant,
			String description) {
		Expense expense = this.expenses.save(Expense.record(amount, currency, occurredOn, merchant, description));

		Classification classification = this.classifier.classify(expense);
		this.records.save(ClassificationRecord.fromRuleEngine(expense.getId(), classification, this.clock.instant()));

		return detail(expense);
	}

	@Transactional(readOnly = true)
	public ExpenseDetail get(UUID id) {
		return detail(require(id));
	}

	/**
	 * Applies a partial update.
	 *
	 * <p>Re-runs classification only when the merchant or description changed.
	 * The rule engine reads nothing else as text, so re-classifying on an amount
	 * or date edit would append a record asserting a decision nobody made and
	 * bury the real ones in the history.
	 */
	@Transactional
	public ExpenseDetail update(UUID id, BigDecimal amount, String currency, java.time.LocalDate occurredOn,
			String merchant, String description) {
		Expense expense = require(id);

		if (expense.applyUpdate(amount, currency, occurredOn, merchant, description)) {
			Classification classification = this.classifier.classify(expense);
			this.records
				.save(ClassificationRecord.fromRuleEngine(expense.getId(), classification, this.clock.instant()));
		}

		return detail(this.expenses.save(expense));
	}

	/**
	 * Appends a user's reclassification (spec §8, issue #9).
	 *
	 * <p>Appends rather than overwrites, so a report over a closed period stays
	 * reproducible. The database rejects an update to an existing record, so
	 * this is the only way the category can change.
	 */
	@Transactional
	public ExpenseDetail reclassify(UUID id, Category category, String reason) {
		Expense expense = require(id);
		this.records.save(ClassificationRecord.fromUser(expense.getId(), category, reason, this.clock.instant()));
		return detail(expense);
	}

	/**
	 * Deletes an expense and its history.
	 *
	 * <p>The classification records go with it by cascade. That is deliberate
	 * and is why V3's append-only trigger covers {@code UPDATE} but not
	 * {@code DELETE}: history exists to explain an expense, and history for an
	 * expense that no longer exists explains nothing.
	 */
	@Transactional
	public void delete(UUID id) {
		this.expenses.delete(require(id));
	}

	private Expense require(UUID id) {
		return this.expenses.findById(id).orElseThrow(() -> new ExpenseNotFoundException(id));
	}

	private ExpenseDetail detail(Expense expense) {
		List<ClassificationRecord> history = this.records
			.findByExpenseIdOrderByRecordedAtDescIdDesc(expense.getId());
		return ExpenseDetail.of(expense, history);
	}

}
