package com.duanerontos.expensecalc.query;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import com.duanerontos.expensecalc.expense.Category;

/**
 * What {@code GET /expenses} was asked for (spec §6).
 *
 * <p>Every filter is optional and they compose with AND. {@code categories} is
 * the one exception to that reading: values within it are OR'd, so
 * {@code ?category=DINING&category=GROCERIES} means "either", while adding
 * {@code &merchant=SM} means "either, and at SM".
 *
 * @param categories empty means no category filter, not "no categories"
 * @param from inclusive lower bound on {@code occurredOn}; null for unbounded
 * @param to exclusive upper bound — half-open, so a month boundary cannot
 *     double-count into the next month (spec §6)
 * @param merchant case-insensitive substring
 * @param text case-insensitive substring over the description — the {@code q}
 *     parameter
 * @param minAmountMinor inclusive lower bound on the <em>signed</em> amount, so
 *     a minimum of zero excludes refunds rather than including them by
 *     magnitude
 * @param maxAmountMinor inclusive upper bound on the signed amount
 */
public record ExpenseFilter(Set<Category> categories, LocalDate from, LocalDate to, String merchant, String text,
		Long minAmountMinor, Long maxAmountMinor) {

	public ExpenseFilter {
		categories = (categories == null) ? Set.of() : Set.copyOf(categories);
		if (from != null && to != null && !to.isAfter(from)) {
			throw new IllegalArgumentException(
					"[%s, %s) is empty or inverted; the upper bound is exclusive.".formatted(from, to));
		}
		if (minAmountMinor != null && maxAmountMinor != null && minAmountMinor > maxAmountMinor) {
			throw new IllegalArgumentException("minAmount is above maxAmount, so nothing can match.");
		}
	}

	/** No filters at all — every expense. */
	public static ExpenseFilter unfiltered() {
		return new ExpenseFilter(Set.of(), null, null, null, null, null, null);
	}

	/** Category names as the query binds them; empty when unfiltered. */
	public List<String> categoryNames() {
		return this.categories.stream().map(Category::name).sorted().toList();
	}

}
