package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Bucket boundaries and the contiguity spec §7 requires.
 */
class TimeBucketTest {

	private static final ReportPeriod JANUARY = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1));

	@Test
	@DisplayName("cuts months at the first of the month")
	void cutsMonths() {
		assertThat(TimeBucket.MONTH.startOfBucket(LocalDate.of(2026, 1, 31))).isEqualTo(LocalDate.of(2026, 1, 1));
		assertThat(TimeBucket.MONTH.nextBucket(LocalDate.of(2026, 1, 1))).isEqualTo(LocalDate.of(2026, 2, 1));
	}

	@Test
	@DisplayName("cuts weeks on Monday, matching Postgres date_trunc")
	void cutsWeeksOnMonday() {
		// Load-bearing agreement. If Java snapped weeks to Sunday while
		// date_trunc('week') snaps to Monday, the fill step would generate
		// bucket starts the query never returns: every week would read zero
		// while the real totals sat in buckets nothing looked for.
		assertThat(LocalDate.of(2026, 1, 7).getDayOfWeek().getValue()).isEqualTo(3);
		assertThat(TimeBucket.WEEK.startOfBucket(LocalDate.of(2026, 1, 7))).isEqualTo(LocalDate.of(2026, 1, 5));
		assertThat(LocalDate.of(2026, 1, 5).getDayOfWeek().getValue()).isEqualTo(1);
		// A Monday is its own bucket start, not the previous week's.
		assertThat(TimeBucket.WEEK.startOfBucket(LocalDate.of(2026, 1, 5))).isEqualTo(LocalDate.of(2026, 1, 5));
	}

	@Test
	@DisplayName("leaves no gap in a month of days")
	void generatesContiguousDays() {
		List<LocalDate> starts = TimeBucket.DAY.bucketStartsIn(JANUARY);

		assertThat(starts).hasSize(31);
		assertThat(starts.getFirst()).isEqualTo(LocalDate.of(2026, 1, 1));
		assertThat(starts.getLast()).isEqualTo(LocalDate.of(2026, 1, 31));
	}

	@Test
	@DisplayName("starts the first week before the period when the period starts mid-week")
	void includesThePartialLeadingWeek() {
		// January 2026 starts on a Thursday, so the first week bucket begins
		// Monday 29 December. Omitting it because it starts outside the period
		// would drop 1–4 January from the chart entirely.
		List<LocalDate> starts = TimeBucket.WEEK.bucketStartsIn(JANUARY);

		assertThat(starts.getFirst()).isEqualTo(LocalDate.of(2025, 12, 29));
		assertThat(starts).isSorted();
		assertThat(starts.getLast()).isBefore(JANUARY.to());
	}

	@ParameterizedTest
	@EnumSource(TimeBucket.class)
	@DisplayName("produces buckets in order with none repeated, at every width")
	void producesOrderedDistinctBuckets(TimeBucket bucket) {
		ReportPeriod year = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2027, 1, 1));

		List<LocalDate> starts = bucket.bucketStartsIn(year);

		assertThat(starts).isSorted().doesNotHaveDuplicates().isNotEmpty();
		assertThat(starts.getLast()).isBefore(year.to());
	}

	@ParameterizedTest
	@EnumSource(TimeBucket.class)
	@DisplayName("labels every bucket in English, whatever the host locale")
	void labelsInEnglish(TimeBucket bucket) {
		// A host-default locale renders month names differently on a laptop and
		// in the container, which becomes a diff nobody can reproduce.
		String label = bucket.label(LocalDate.of(2026, 1, 5));

		assertThat(label).contains("Jan").isNotBlank();
	}

	@ParameterizedTest
	@EnumSource(TimeBucket.class)
	@DisplayName("counts the same buckets it would generate")
	void countAgreesWithGeneration(TimeBucket bucket) {
		// Two ways of saying the same thing, which is exactly where they drift.
		// The count runs before the allocation the size guard exists to
		// prevent, so it cannot simply generate and measure.
		List<ReportPeriod> periods = List.of(JANUARY,
				new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2027, 1, 1)),
				// Starting mid-week and mid-month, where the leading partial
				// bucket makes the arithmetic non-obvious.
				new ReportPeriod(LocalDate.of(2026, 1, 7), LocalDate.of(2026, 3, 15)),
				new ReportPeriod(LocalDate.of(2026, 2, 26), LocalDate.of(2026, 3, 2)),
				new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 2)));

		for (ReportPeriod period : periods) {
			assertThat(bucket.bucketCountIn(period)).as("%s over %s", bucket, period)
				.isEqualTo(bucket.bucketStartsIn(period).size());
		}
	}

	@Test
	@DisplayName("counts a two-century daily window as far more than a response may carry")
	void countsThePathologicalWindow() {
		// The case that returned 200 with 4.2 MB from an empty database before
		// the cap: unbounded through the response rather than through the query.
		ReportPeriod twoCenturies = new ReportPeriod(LocalDate.of(1900, 1, 1), LocalDate.of(2100, 1, 1));

		assertThat(TimeBucket.DAY.bucketCountIn(twoCenturies)).isEqualTo(73_049);
		// Two centuries is over the cap at every width — 2,400 months — so this
		// window is simply too long, and the message's other half ("narrow the
		// period") is the applicable one.
		assertThat(TimeBucket.MONTH.bucketCountIn(twoCenturies)).isGreaterThan(TimeBucket.MAX_BUCKETS);
	}

	@Test
	@DisplayName("lets a wider slice rescue a window that is too long for a narrow one")
	void wideningTheSliceRescuesALongWindow() {
		// The other half of the message. Twenty years is 7,305 days and 240
		// months, so the same period is refused by day and served by month —
		// which is why the failure suggests widening the slice as well as
		// narrowing the period.
		ReportPeriod twentyYears = new ReportPeriod(LocalDate.of(2006, 1, 1), LocalDate.of(2026, 1, 1));

		assertThat(TimeBucket.DAY.bucketCountIn(twentyYears)).isGreaterThan(TimeBucket.MAX_BUCKETS);
		assertThat(TimeBucket.MONTH.bucketCountIn(twentyYears)).isEqualTo(240)
			.isLessThanOrEqualTo(TimeBucket.MAX_BUCKETS);
	}

	@Test
	@DisplayName("keeps ordinary windows well inside the cap")
	void keepsRealisticWindowsUnderTheCap() {
		assertThat(TimeBucket.DAY.bucketCountIn(new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2027, 1, 1))))
			.isEqualTo(365);
		assertThat(TimeBucket.WEEK.bucketCountIn(new ReportPeriod(LocalDate.of(2021, 1, 1), LocalDate.of(2026, 1, 1))))
			.isLessThan(TimeBucket.MAX_BUCKETS);
	}

	@Test
	@DisplayName("names the unit Postgres date_trunc expects")
	void namesTheTruncUnit() {
		assertThat(TimeBucket.DAY.truncUnit()).isEqualTo("day");
		assertThat(TimeBucket.WEEK.truncUnit()).isEqualTo("week");
		assertThat(TimeBucket.MONTH.truncUnit()).isEqualTo("month");
	}

}
