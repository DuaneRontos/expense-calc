package com.duanerontos.expensecalc.classification;

import java.time.Instant;
import java.util.UUID;

import com.duanerontos.expensecalc.expense.Category;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

/**
 * What a record carries, provable without a database.
 */
class ClassificationRecordTest {

	private static final UUID EXPENSE = UUID.randomUUID();

	private static final Instant WHEN = Instant.parse("2026-02-01T03:00:00Z");

	@Test
	@DisplayName("carries the engine's own reason rather than a reconstruction of it")
	void carriesTheEnginesReason() {
		// Built from the Classification the engine returned, so the row cites
		// the rule that actually fired. Passing a category and a hand-written
		// string instead is how a reason drifts from its rule.
		Classification classification = new ExpenseClassifier().classify("Puregold", null, 234_500);

		ClassificationRecord record = ClassificationRecord.fromRuleEngine(EXPENSE, classification, WHEN);

		assertThat(record.getCategory()).isEqualTo(Category.GROCERIES);
		assertThat(record.getReason()).isEqualTo(classification.reason());
		assertThat(record.getSource()).isEqualTo(ClassificationSource.RULE_ENGINE);
		assertThat(record.getExpenseId()).isEqualTo(EXPENSE);
		assertThat(record.getRecordedAt()).isEqualTo(WHEN);
	}

	@Test
	@DisplayName("records an unmatched expense as UNCLASSIFIED rather than as no record at all")
	void recordsUnmatchedExpenses() {
		// "Nothing matched" is an answer (spec §5). Skipping the write would
		// leave the expense with no history and make "never classified" and
		// "classified as nothing" indistinguishable.
		ClassificationRecord record = ClassificationRecord.fromRuleEngine(EXPENSE, Classification.unmatched(), WHEN);

		assertThat(record.getCategory()).isEqualTo(Category.UNCLASSIFIED);
		assertThat(record.getReason()).isNotBlank();
	}

	@Test
	@DisplayName("marks a user reclassification as USER, not as the engine")
	void marksUserReclassification() {
		ClassificationRecord record = ClassificationRecord.fromUser(EXPENSE, Category.DINING, "It was a client lunch",
				WHEN);

		assertThat(record.getSource()).isEqualTo(ClassificationSource.USER);
		assertThat(record.getCategory()).isEqualTo(Category.DINING);
		assertThat(record.getReason()).isEqualTo("It was a client lunch");
	}

	@ParameterizedTest
	@ValueSource(strings = { "", "   " })
	@DisplayName("refuses a user reclassification with no reason")
	void refusesBlankReason(String reason) {
		// An unexplained category change is exactly the question this table
		// exists to answer, so a blank reason defeats the point of the row.
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRecord.fromUser(EXPENSE, Category.DINING, reason, WHEN))
			.withMessageContaining("needs a reason");
	}

	@Test
	@DisplayName("refuses a reason longer than the column holds")
	void refusesAnOverlongReason() {
		// Otherwise it reaches VARCHAR(200) and fails at flush, which a
		// controller can only turn into a 500 — while the blank case beside it
		// gives a clean 400. A free-text note is the input most likely to run
		// long, and this is the only factory that takes one unmediated.
		String tooLong = "x".repeat(Classification.MAX_REASON_LENGTH + 1);

		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRecord.fromUser(EXPENSE, Category.DINING, tooLong, WHEN))
			.withMessageContaining("the column holds");

		assertThat(ClassificationRecord
			.fromUser(EXPENSE, Category.DINING, "x".repeat(Classification.MAX_REASON_LENGTH), WHEN)
			.getReason()).hasSize(Classification.MAX_REASON_LENGTH);
	}

	@Test
	@DisplayName("names the null argument rather than failing at flush")
	void refusesNullArguments() {
		assertThatNullPointerException()
			.isThrownBy(() -> ClassificationRecord.fromUser(null, Category.DINING, "why", WHEN))
			.withMessageContaining("expenseId");
		assertThatNullPointerException()
			.isThrownBy(() -> ClassificationRecord.fromUser(EXPENSE, Category.DINING, "why", null))
			.withMessageContaining("when");
		assertThatNullPointerException()
			.isThrownBy(() -> ClassificationRecord.fromRuleEngine(null, Classification.unmatched(), WHEN))
			.withMessageContaining("expenseId");
	}

	@Test
	@DisplayName("gives every record a distinct identity")
	void givesEachRecordItsOwnId() {
		// Two reclassifications to the same category at the same instant are
		// still two events, and the id is the tiebreaker the read path orders on.
		ClassificationRecord first = ClassificationRecord.fromUser(EXPENSE, Category.DINING, "same", WHEN);
		ClassificationRecord second = ClassificationRecord.fromUser(EXPENSE, Category.DINING, "same", WHEN);

		assertThat(first.getId()).isNotEqualTo(second.getId());
	}

}
