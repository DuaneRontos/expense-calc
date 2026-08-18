package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.List;

import com.duanerontos.expensecalc.expense.Category;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The grouped-bar shape: both periods on one row per category.
 */
class PeriodComparisonTest {

	private static final ReportPeriod MARCH = ReportPeriod.monthOf(LocalDate.of(2026, 3, 1));

	private static final ReportPeriod FEBRUARY = MARCH.previous();

	private static PeriodComparison of(List<CategoryTotal> current, List<CategoryTotal> previous) {
		return PeriodComparison.of(MARCH, FEBRUARY, current, previous);
	}

	@Test
	@DisplayName("puts both periods on one row per category")
	void pairsBothPeriods() {
		PeriodComparison comparison = of(List.of(new CategoryTotal(Category.GROCERIES, 500_000L)),
				List.of(new CategoryTotal(Category.GROCERIES, 420_000L)));

		PeriodComparison.Bucket groceries = comparison.buckets().getFirst();

		assertThat(groceries.key()).isEqualTo("GROCERIES");
		assertThat(groceries.current()).isEqualTo("5000.00");
		assertThat(groceries.previous()).isEqualTo("4200.00");
		assertThat(groceries.change()).isEqualTo("800.00");
	}

	@Test
	@DisplayName("keeps a category that disappeared, which is what a comparison is for")
	void keepsCategoriesFromEitherPeriod() {
		// The union, not the intersection. Dropping a category that was spent on
		// last month and not this one hides exactly the change the report exists
		// to show.
		PeriodComparison comparison = of(List.of(new CategoryTotal(Category.GROCERIES, 500_000L)),
				List.of(new CategoryTotal(Category.DINING, 300_000L)));

		assertThat(comparison.buckets()).extracting(PeriodComparison.Bucket::key)
			.containsExactlyInAnyOrder("GROCERIES", "DINING");

		PeriodComparison.Bucket dining = comparison.buckets()
			.stream()
			.filter(bucket -> bucket.key().equals("DINING"))
			.findFirst()
			.orElseThrow();

		assertThat(dining.current()).isEqualTo("0.00");
		assertThat(dining.previous()).isEqualTo("3000.00");
		assertThat(dining.change()).isEqualTo("-3000.00");
	}

	@Test
	@DisplayName("reports change as an absolute amount, never a percentage")
	void reportsAbsoluteChange() {
		// A percentage needs a denominator, and a category that was zero last
		// period has one of zero — a division by zero dressed up as infinite
		// growth. With signed amounts a category can also cross zero, where a
		// percentage is not merely undefined but misleading.
		PeriodComparison comparison = of(List.of(new CategoryTotal(Category.CAPITAL, 6_500_000L)), List.of());

		assertThat(comparison.buckets().getFirst().previous()).isEqualTo("0.00");
		assertThat(comparison.buckets().getFirst().change()).isEqualTo("65000.00");
	}

	@Test
	@DisplayName("handles a category crossing zero between periods")
	void handlesSignChanges() {
		// Refunds exceeded spending this month; last month they did not.
		PeriodComparison comparison = of(List.of(new CategoryTotal(Category.DISCRETIONARY, -75_000L)),
				List.of(new CategoryTotal(Category.DISCRETIONARY, 120_000L)));

		PeriodComparison.Bucket bucket = comparison.buckets().getFirst();

		assertThat(bucket.current()).isEqualTo("-750.00");
		assertThat(bucket.previous()).isEqualTo("1200.00");
		assertThat(bucket.change()).isEqualTo("-1950.00");
	}

	@Test
	@DisplayName("totals each period independently")
	void totalsEachPeriod() {
		PeriodComparison comparison = of(
				List.of(new CategoryTotal(Category.GROCERIES, 500_000L), new CategoryTotal(Category.DINING, 100_000L)),
				List.of(new CategoryTotal(Category.GROCERIES, 420_000L)));

		assertThat(comparison.currentTotal()).isEqualTo("6000.00");
		assertThat(comparison.previousTotal()).isEqualTo("4200.00");
	}

	@Test
	@DisplayName("ranks by the current period and breaks ties stably")
	void ranksByCurrentPeriod() {
		PeriodComparison comparison = of(
				List.of(new CategoryTotal(Category.DINING, 100_000L), new CategoryTotal(Category.GROCERIES, 900_000L)),
				List.of(new CategoryTotal(Category.TRANSPORT, 50_000L)));

		assertThat(comparison.buckets()).extracting(PeriodComparison.Bucket::key)
			.containsExactly("GROCERIES", "DINING", "TRANSPORT");
	}

	@Test
	@DisplayName("names both periods so the client can say what it is showing")
	void namesBothPeriods() {
		PeriodComparison comparison = of(List.of(), List.of());

		assertThat(comparison.current()).isEqualTo(MARCH);
		assertThat(comparison.previous()).isEqualTo(ReportPeriod.monthOf(LocalDate.of(2026, 2, 1)));
		assertThat(comparison.buckets()).isEmpty();
		assertThat(comparison.currentTotal()).isEqualTo("0.00");
	}

}
