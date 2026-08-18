package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.List;

import com.duanerontos.expensecalc.expense.Category;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The presentation boundary: minor units in, decimal strings out.
 */
class CategoryBreakdownTest {

	private static final ReportPeriod JANUARY = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1));

	private static CategoryBreakdown of(CategoryTotal... totals) {
		return CategoryBreakdown.of(JANUARY, List.of(totals));
	}

	@Test
	@DisplayName("renders money as a decimal string, never a number")
	void rendersMoneyAsDecimalStrings() {
		// Spec §8: a JSON number arrives in JavaScript as a double, which
		// reintroduces the precision problem integer storage exists to avoid —
		// in the client, where it is hardest to see.
		CategoryBreakdown breakdown = of(new CategoryTotal(Category.GROCERIES, 1_842_000L),
				new CategoryTotal(Category.DINING, 613_550L));

		assertThat(breakdown.buckets()).extracting(CategoryBreakdown.Bucket::total)
			.containsExactly("18420.00", "6135.50");
		assertThat(breakdown.total()).isEqualTo("24555.50");
		assertThat(breakdown.currency()).isEqualTo("PHP");
	}

	@Test
	@DisplayName("keeps two decimal places even when the centavos are zero")
	void keepsScaleTwo() {
		// "1000" and "1000.0" both parse, but the client formats what it is
		// given; an inconsistent scale shows up as ragged decimals in the legend.
		assertThat(of(new CategoryTotal(Category.HOUSING, 100_000L)).total()).isEqualTo("1000.00");
		assertThat(of(new CategoryTotal(Category.HOUSING, 1L)).total()).isEqualTo("0.01");
	}

	@Test
	@DisplayName("carries a negative bucket rather than clamping it")
	void carriesNegativeBuckets() {
		// Spec §7: a category with more refunds than spending nets negative, and
		// the legend shows the real value. Issue #8's rule, at the boundary.
		CategoryBreakdown breakdown = of(new CategoryTotal(Category.GROCERIES, 500_000L),
				new CategoryTotal(Category.DISCRETIONARY, -125_000L));

		assertThat(breakdown.buckets()).extracting(CategoryBreakdown.Bucket::total)
			.containsExactly("5000.00", "-1250.00");
		assertThat(breakdown.total()).isEqualTo("3750.00");
	}

	@Test
	@DisplayName("lets the whole period net negative")
	void carriesANegativeTotal() {
		CategoryBreakdown breakdown = of(new CategoryTotal(Category.GROCERIES, 50_000L),
				new CategoryTotal(Category.DISCRETIONARY, -125_000L));

		assertThat(breakdown.total()).isEqualTo("-750.00");
	}

	@Test
	@DisplayName("ranks buckets by total descending for the legend")
	void ranksBuckets() {
		CategoryBreakdown breakdown = of(new CategoryTotal(Category.DINING, 100_000L),
				new CategoryTotal(Category.GROCERIES, 900_000L), new CategoryTotal(Category.TRANSPORT, 400_000L));

		assertThat(breakdown.categories()).containsExactly(Category.GROCERIES, Category.TRANSPORT, Category.DINING);
	}

	@Test
	@DisplayName("orders ties stably, so two runs of one report do not differ")
	void ordersTiesStably() {
		// An unstable order makes two identical reports produce different JSON,
		// and the diff reads as a data change.
		CategoryBreakdown first = of(new CategoryTotal(Category.DINING, 100_000L),
				new CategoryTotal(Category.TRANSPORT, 100_000L), new CategoryTotal(Category.HEALTH, 100_000L));
		CategoryBreakdown reordered = of(new CategoryTotal(Category.HEALTH, 100_000L),
				new CategoryTotal(Category.TRANSPORT, 100_000L), new CategoryTotal(Category.DINING, 100_000L));

		assertThat(first.categories()).isEqualTo(reordered.categories());
		// Taxonomy order breaks the tie: DINING before TRANSPORT before HEALTH.
		assertThat(first.categories()).containsExactly(Category.DINING, Category.TRANSPORT, Category.HEALTH);
	}

	@Test
	@DisplayName("reports an empty period as zero with no buckets")
	void reportsEmptyPeriods() {
		// Spec §7: "No spending in March" is a valid answer, rendered as an
		// empty state rather than an error.
		CategoryBreakdown breakdown = CategoryBreakdown.of(JANUARY, List.of());

		assertThat(breakdown.isEmpty()).isTrue();
		assertThat(breakdown.buckets()).isEmpty();
		assertThat(breakdown.total()).isEqualTo("0.00");
		assertThat(breakdown.period()).isEqualTo(JANUARY);
	}

	@Test
	@DisplayName("serves the display label so the client never hardcodes the taxonomy")
	void servesLabels() {
		CategoryBreakdown breakdown = of(new CategoryTotal(Category.DISCRETIONARY, 1L));

		assertThat(breakdown.buckets().getFirst().key()).isEqualTo("DISCRETIONARY");
		assertThat(breakdown.buckets().getFirst().label()).isEqualTo("Discretionary");
	}

	@Test
	@DisplayName("sums exactly across every category")
	void sumsExactly() {
		List<CategoryTotal> everyCategory = List.of(new CategoryTotal(Category.HOUSING, 2_500_000L),
				new CategoryTotal(Category.UTILITIES, 389_050L), new CategoryTotal(Category.GROCERIES, 1_842_033L),
				new CategoryTotal(Category.DINING, 613_557L), new CategoryTotal(Category.TRANSPORT, 180_011L),
				new CategoryTotal(Category.MAINTENANCE, 80_000L), new CategoryTotal(Category.HEALTH, 65_099L),
				new CategoryTotal(Category.DISCRETIONARY, -54_901L), new CategoryTotal(Category.CAPITAL, 6_500_000L),
				new CategoryTotal(Category.INCOME, -4_500_000L), new CategoryTotal(Category.UNCLASSIFIED, 45_000L));

		long expected = everyCategory.stream().mapToLong(CategoryTotal::totalMinor).sum();

		assertThat(CategoryBreakdown.of(JANUARY, everyCategory).total())
			.isEqualTo(com.duanerontos.expensecalc.money.Money.toMajorUnits(expected).toPlainString());
	}

}
