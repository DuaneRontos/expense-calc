package com.duanerontos.expensecalc.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.duanerontos.expensecalc.classification.ClassificationRecord;
import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.expense.Expense;

/**
 * {@code GET /expenses/{id}} — one expense with its classification history
 * (spec §8).
 *
 * <p>The history is served whole rather than behind another request. It is
 * bounded by how many times a person reclassified one expense, and the reason a
 * category is what it is has no value if fetching it is a second round trip
 * nobody makes.
 */
public record ExpenseDetail(UUID id, String amount, String currency, LocalDate occurredOn, String merchant,
		String description, String category, String categoryLabel, Instant createdAt, Instant updatedAt,
		List<ClassificationView> classifications) {

	/**
	 * One decision in the history, newest first.
	 *
	 * @param source {@code RULE_ENGINE}, {@code USER}, or {@code IMPORT} — "the
	 *     engine guessed" and "the user said so" carry very different weight
	 *     when a report looks wrong
	 */
	public record ClassificationView(String category, String categoryLabel, String source, String reason,
			Instant recordedAt) {

		static ClassificationView of(ClassificationRecord record) {
			return new ClassificationView(record.getCategory().name(), record.getCategory().getLabel(),
					record.getSource().name(), record.getReason(), record.getRecordedAt());
		}
	}

	public static ExpenseDetail of(Expense expense, List<ClassificationRecord> history) {
		// The head of the history is the current category, by the same
		// latest-wins rule the list and the reports use — rather than a second
		// read that could disagree with the history shown beside it.
		Category current = history.isEmpty() ? Category.UNCLASSIFIED : history.getFirst().getCategory();

		return new ExpenseDetail(expense.getId(), expense.getAmount().toPlainString(), expense.getCurrency(),
				expense.getOccurredOn(), expense.getMerchant(), expense.getDescription(), current.name(),
				current.getLabel(), expense.getCreatedAt(), expense.getUpdatedAt(),
				history.stream().map(ClassificationView::of).toList());
	}

}
