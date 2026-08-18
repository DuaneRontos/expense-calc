package com.duanerontos.expensecalc.report;

import java.time.Clock;
import java.time.Instant;
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
	@DisplayName("reports February in Manila while it is still January in UTC")
	void resolvesCurrentMonthInManila() {
		// Spec §4's worked example, pinned rather than approximated: at 17:00
		// UTC on 31 January it is already 01:00 on 1 February in Manila. A
		// UTC-derived "this month" reports January for another seven hours, and
		// only in the evening — which is a miserable thing to reproduce.
		//
		// A fixed clock is what makes this assertable at all. Reading the JVM
		// clock could only ever check that two zones differ today, which is not
		// the claim.
		Clock atManilaMidnightish = Clock.fixed(Instant.parse("2026-01-31T17:00:00Z"), MANILA);
		Clock sameInstantInUtc = Clock.fixed(Instant.parse("2026-01-31T17:00:00Z"), ZoneId.of("UTC"));

		assertThat(ReportPeriod.currentMonth(atManilaMidnightish))
			.isEqualTo(new ReportPeriod(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 3, 1)));
		// The bug this prevents, spelled out: same instant, wrong month.
		assertThat(ReportPeriod.currentMonth(sameInstantInUtc))
			.isEqualTo(new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1)));
	}

	@Test
	@DisplayName("counts today in the last N days")
	void lastDaysIncludesToday() {
		// Ending at today rather than tomorrow would drop everything spent this
		// morning, and the report would look right until someone checked.
		//
		// Fixed rather than wall-clock: the previous version read the clock
		// twice, and a Manila midnight landing between the two reads made it
		// fail for whoever was working at 00:00 +08:00.
		Clock manila = Clock.fixed(Instant.parse("2026-01-20T05:00:00Z"), MANILA);
		LocalDate today = LocalDate.of(2026, 1, 20);

		ReportPeriod week = ReportPeriod.lastDays(7, manila);

		assertThat(week.contains(today)).isTrue();
		assertThat(week.to()).isEqualTo(today.plusDays(1));
		assertThat(week.from()).isEqualTo(today.minusDays(6));
	}

	@Test
	@DisplayName("compares a calendar month against the calendar month before it")
	void comparesMonthsAgainstMonths() {
		// Equal-length would give [2026-01-29, 2026-03-01) for March — 31 days
		// ending where February ends, which is not February. Someone who picked
		// March from a month picker reads that as a bug.
		ReportPeriod march = ReportPeriod.monthOf(LocalDate.of(2026, 3, 10));

		assertThat(march.previous()).isEqualTo(ReportPeriod.monthOf(LocalDate.of(2026, 2, 1)));

		// And the honest consequence: 28 days against 31. Normalising the
		// lengths would report a February that never happened.
		assertThat(march.previous().lengthInDays()).isEqualTo(28);
		assertThat(march.lengthInDays()).isEqualTo(31);
	}

	@Test
	@DisplayName("compares a rolling window against the equally long window before it")
	void comparesRollingWindowsByLength() {
		// No previous calendar month exists for a window straddling two of them,
		// so equal-length is the only rule that means anything here.
		ReportPeriod thirtyDays = new ReportPeriod(LocalDate.of(2026, 2, 10), LocalDate.of(2026, 3, 12));

		ReportPeriod before = thirtyDays.previous();

		assertThat(before.to()).isEqualTo(thirtyDays.from());
		assertThat(before.lengthInDays()).isEqualTo(thirtyDays.lengthInDays());
		assertThat(before.from()).isEqualTo(LocalDate.of(2026, 1, 11));
	}

	@Test
	@DisplayName("recognises a whole calendar month, and only a whole one")
	void recognisesWholeCalendarMonths() {
		assertThat(ReportPeriod.monthOf(LocalDate.of(2026, 2, 14)).isWholeCalendarMonth()).isTrue();
		// Right length, wrong start: a month-long window from the 2nd is not a
		// calendar month and must not get a calendar-month comparison.
		assertThat(new ReportPeriod(LocalDate.of(2026, 2, 2), LocalDate.of(2026, 3, 2)).isWholeCalendarMonth())
			.isFalse();
		assertThat(new ReportPeriod(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 15)).isWholeCalendarMonth())
			.isFalse();
	}

	@Test
	@DisplayName("refuses an empty or inverted period")
	void refusesDegeneratePeriods() {
		LocalDate day = LocalDate.of(2026, 1, 15);

		assertThatIllegalArgumentException().isThrownBy(() -> new ReportPeriod(day, day));
		assertThatIllegalArgumentException().isThrownBy(() -> new ReportPeriod(day, day.minusDays(1)));
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ReportPeriod.lastDays(0, Clock.fixed(Instant.EPOCH, MANILA)));
	}

}
