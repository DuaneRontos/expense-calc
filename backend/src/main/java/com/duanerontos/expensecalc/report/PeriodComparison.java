package com.duanerontos.expensecalc.report;

import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.money.Money;

/**
 * The {@code /reports/compare} response (spec §7's grouped bar).
 *
 * <p>One row per category with both periods' totals side by side, which is the
 * shape a grouped bar consumes directly — the alternative, two independent
 * breakdowns, makes the client join them by key and decide what to do about
 * categories present in only one.
 *
 * <p><b>The union of both periods, not the intersection.</b> A category that was
 * spent on last month and not this one is exactly what a comparison is for, and
 * dropping it would hide the change the report exists to show. Such a category
 * appears with {@code "0.00"} on the side it is missing from.
 *
 * @param current the period asked about
 * @param previous what it is compared against — see {@link ReportPeriod#previous()}
 * @param currency ISO 4217; always {@code PHP} in v1
 * @param currentTotal net across the current period, which may be negative
 * @param previousTotal net across the previous period
 * @param buckets ranked by current total descending
 */
public record PeriodComparison(ReportPeriod current, ReportPeriod previous, String currency, String currentTotal,
		String previousTotal, List<Bucket> buckets) {

	/**
	 * One category, both periods.
	 *
	 * @param key the enum name
	 * @param label the display name
	 * @param current decimal string for the current period
	 * @param previous decimal string for the comparison period
	 * @param change current minus previous; negative means less was spent
	 */
	public record Bucket(String key, String label, String current, String previous, String change) {
	}

	/**
	 * Builds the comparison.
	 *
	 * <p><b>{@code change} is deliberately absolute, not a percentage.</b> A
	 * percentage needs a denominator, and every category that was zero last
	 * period has one of zero — which is a division by zero dressed up as
	 * "infinite growth". Worse, with signed amounts a category can go from
	 * negative to positive, where a percentage is not merely undefined but
	 * misleading. The client can compute a ratio where it makes sense and show
	 * the absolute change where it does not.
	 */
	public static PeriodComparison of(ReportPeriod current, ReportPeriod previous, List<CategoryTotal> currentTotals,
			List<CategoryTotal> previousTotals) {

		Map<Category, Long> now = currentTotals.stream()
			.collect(Collectors.toMap(CategoryTotal::category, CategoryTotal::totalMinor));
		Map<Category, Long> before = previousTotals.stream()
			.collect(Collectors.toMap(CategoryTotal::category, CategoryTotal::totalMinor));

		Set<Category> everyCategory = new LinkedHashSet<>(now.keySet());
		everyCategory.addAll(before.keySet());

		Comparator<Category> byCurrentDescending = Comparator
			.comparingLong((Category category) -> now.getOrDefault(category, 0L))
			.reversed()
			// Taxonomy order breaks ties, so two runs of one report cannot differ.
			.thenComparing(Comparator.naturalOrder());

		List<Bucket> buckets = everyCategory.stream()
			.sorted(byCurrentDescending)
			.map(category -> {
				long currentMinor = now.getOrDefault(category, 0L);
				long previousMinor = before.getOrDefault(category, 0L);
				return new Bucket(category.name(), category.getLabel(), decimal(currentMinor), decimal(previousMinor),
						decimal(currentMinor - previousMinor));
			})
			.toList();

		return new PeriodComparison(current, previous, Money.CURRENCY_CODE,
				decimal(now.values().stream().mapToLong(Long::longValue).sum()),
				decimal(before.values().stream().mapToLong(Long::longValue).sum()), buckets);
	}

	private static String decimal(long minorUnits) {
		return Money.toMajorUnits(minorUnits).toPlainString();
	}

}
