package com.duanerontos.expensecalc.report;

import com.duanerontos.expensecalc.expense.Category;

/**
 * One category's net total for a period, in minor units.
 *
 * <p>Stays in centavos all the way from the database to the presentation
 * boundary. Spec §7 asks for aggregation in {@code BigDecimal} to avoid the
 * scale drift that rounding mid-accumulation causes; summing signed integers is
 * the stronger version of the same guarantee — exact by construction, with no
 * scale to drift and no rounding mode to get wrong. The conversion happens once,
 * in {@link CategoryBreakdown}, where the number becomes a string for the wire.
 *
 * <p>{@code totalMinor} is signed and may be negative: a category with more
 * refunds than spending in a period nets below zero (spec §7, issue #8).
 */
public record CategoryTotal(Category category, long totalMinor) {

	public CategoryTotal {
		if (category == null) {
			throw new IllegalArgumentException("A total needs a category.");
		}
	}

}
