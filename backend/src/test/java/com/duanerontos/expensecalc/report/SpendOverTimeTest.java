package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Zero-filling and the wire format for the over-time report.
 */
class SpendOverTimeTest {

	private static final ReportPeriod QUARTER = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 1));

	@Test
	@DisplayName("fills an empty month with 0.00 rather than omitting it")
	void fillsEmptyBuckets() {
		// Spec §7: contiguous buckets, so the x-axis has no invisible gaps. A
		// chart that skips February draws January and March as adjacent, which
		// reads as a trend that did not happen.
		SpendOverTime report = SpendOverTime.of(QUARTER, TimeBucket.MONTH,
				Map.of(LocalDate.of(2026, 1, 1), 150_000L, LocalDate.of(2026, 3, 1), 90_000L));

		assertThat(report.buckets()).extracting(SpendOverTime.Bucket::key)
			.containsExactly("2026-01-01", "2026-02-01", "2026-03-01");
		assertThat(report.buckets()).extracting(SpendOverTime.Bucket::total)
			.containsExactly("1500.00", "0.00", "900.00");
	}

	@Test
	@DisplayName("totals only what was actually spent, not the filled zeros")
	void totalsRealValuesOnly() {
		SpendOverTime report = SpendOverTime.of(QUARTER, TimeBucket.MONTH,
				Map.of(LocalDate.of(2026, 1, 1), 150_000L, LocalDate.of(2026, 3, 1), 90_000L));

		assertThat(report.total()).isEqualTo("2400.00");
	}

	@Test
	@DisplayName("carries a negative bucket and a negative total")
	void carriesNegatives() {
		// Issue #8's rule at this boundary too: a month with more refunds than
		// spending nets below zero and the chart has to render it.
		SpendOverTime report = SpendOverTime.of(QUARTER, TimeBucket.MONTH,
				Map.of(LocalDate.of(2026, 1, 1), 50_000L, LocalDate.of(2026, 2, 1), -125_000L));

		assertThat(report.buckets()).extracting(SpendOverTime.Bucket::total)
			.containsExactly("500.00", "-1250.00", "0.00");
		assertThat(report.total()).isEqualTo("-750.00");
	}

	@Test
	@DisplayName("returns every bucket at zero for a period with no expenses")
	void reportsAnEmptyPeriodAsZeroes() {
		// Not an empty array: the axis still has three months on it, and a
		// client rendering an empty state needs to know the period was empty
		// rather than that the buckets were missing.
		SpendOverTime report = SpendOverTime.of(QUARTER, TimeBucket.MONTH, Map.of());

		assertThat(report.buckets()).hasSize(3)
			.extracting(SpendOverTime.Bucket::total)
			.containsOnly("0.00");
		assertThat(report.total()).isEqualTo("0.00");
	}

	@Test
	@DisplayName("renders money as strings and keeps two decimal places")
	void rendersMoneyAsStrings() {
		SpendOverTime report = SpendOverTime.of(QUARTER, TimeBucket.MONTH, Map.of(LocalDate.of(2026, 1, 1), 1L));

		assertThat(report.buckets().getFirst().total()).isEqualTo("0.01");
		assertThat(report.currency()).isEqualTo("PHP");
		assertThat(report.bucket()).isEqualTo(TimeBucket.MONTH);
	}

	@Test
	@DisplayName("labels buckets for the axis")
	void labelsBuckets() {
		SpendOverTime report = SpendOverTime.of(QUARTER, TimeBucket.MONTH, Map.of());

		assertThat(report.buckets()).extracting(SpendOverTime.Bucket::label)
			.containsExactly("Jan 2026", "Feb 2026", "Mar 2026");
	}

}
