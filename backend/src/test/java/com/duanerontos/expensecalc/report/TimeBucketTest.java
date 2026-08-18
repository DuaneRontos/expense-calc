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

	@Test
	@DisplayName("names the unit Postgres date_trunc expects")
	void namesTheTruncUnit() {
		assertThat(TimeBucket.DAY.truncUnit()).isEqualTo("day");
		assertThat(TimeBucket.WEEK.truncUnit()).isEqualTo("week");
		assertThat(TimeBucket.MONTH.truncUnit()).isEqualTo("month");
	}

}
