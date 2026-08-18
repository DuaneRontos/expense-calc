package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.time.ZoneId;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/**
 * Period arithmetic, provable without a database or a clock.
 */
class ReportPeriodTest {

	private static final ZoneId MANILA = ZoneId.of("Asia/Manila");

	@Test
	@DisplayName("excludes the upper bound, so adjacent months cannot double-count")
	void isHalfOpen() {
		ReportPeriod january = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1));

		assertThat(january.contains(LocalDate.of(2026, 1, 1))).isTrue();
		assertThat(january.contains(LocalDate.of(2026, 1, 31))).isTrue();
		// The boundary day belongs to February, and only to February.
		assertThat(january.contains(LocalDate.of(2026, 2, 1))).isFalse();

		ReportPeriod february = ReportPeriod.monthOf(LocalDate.of(2026, 2, 14));
		assertThat(february.contains(LocalDate.of(2026, 2, 1))).isTrue();
	}

	@Test
	@DisplayName("builds a calendar month from any day in it")
	void buildsMonths() {
		ReportPeriod month = ReportPeriod.monthOf(LocalDate.of(2026, 2, 14));

		assertThat(month.from()).isEqualTo(LocalDate.of(2026, 2, 1));
		assertThat(month.to()).isEqualTo(LocalDate.of(2026, 3, 1));
	}

	@Test
	@DisplayName("resolves the current month in Manila, not in the host's zone")
	void resolvesCurrentMonthInManila() {
		// Spec §4's worked example: at 17:00 UTC on 31 January it is already
		// 1 February in Manila. A UTC-derived "this month" would report January
		// for another seven hours. This asserts the two zones genuinely differ
		// at that instant rather than asserting a fixed month, which would only
		// hold while the test was being written.
		LocalDate manilaDay = LocalDate.now(MANILA);
		LocalDate utcDay = LocalDate.now(ZoneId.of("UTC"));

		assertThat(ReportPeriod.currentMonth(MANILA).contains(manilaDay)).isTrue();
		assertThat(ReportPeriod.currentMonth(MANILA)).isEqualTo(ReportPeriod.monthOf(manilaDay));
		// Manila is never behind UTC, so its date is the same or one day ahead.
		assertThat(manilaDay).isBetween(utcDay, utcDay.plusDays(1));
	}

	@Test
	@DisplayName("counts today in the last N days")
	void lastDaysIncludesToday() {
		// Ending at today rather than tomorrow would drop everything spent this
		// morning, and the report would look right until someone checked.
		ReportPeriod week = ReportPeriod.lastDays(7, MANILA);
		LocalDate today = LocalDate.now(MANILA);

		assertThat(week.contains(today)).isTrue();
		assertThat(week.to()).isEqualTo(today.plusDays(1));
		assertThat(week.from()).isEqualTo(today.minusDays(6));
	}

	@Test
	@DisplayName("puts the preceding period immediately before this one, with no gap or overlap")
	void findsThePrecedingPeriod() {
		ReportPeriod february = new ReportPeriod(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 3, 1));

		ReportPeriod january = february.immediatelyBefore();

		assertThat(january.to()).isEqualTo(february.from());
		assertThat(january.from()).isEqualTo(LocalDate.of(2026, 1, 4));
		// Equal length rather than equal calendar month: February is 28 days, so
		// the comparison window is the 28 days before it. Comparing a 28-day
		// month against a 31-day one would show a fall in spending that is
		// really just three fewer days.
		assertThat(january.to().toEpochDay() - january.from().toEpochDay())
			.isEqualTo(february.to().toEpochDay() - february.from().toEpochDay());
	}

	@Test
	@DisplayName("refuses an empty or inverted period")
	void refusesDegeneratePeriods() {
		LocalDate day = LocalDate.of(2026, 1, 15);

		assertThatIllegalArgumentException().isThrownBy(() -> new ReportPeriod(day, day));
		assertThatIllegalArgumentException().isThrownBy(() -> new ReportPeriod(day, day.minusDays(1)));
		assertThatIllegalArgumentException().isThrownBy(() -> ReportPeriod.lastDays(0, MANILA));
	}

}
