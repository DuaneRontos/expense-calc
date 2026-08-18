package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

/**
 * A reporting window, half-open: {@code [from, to)}.
 *
 * <p><b>Half-open is not a detail</b> (spec §6). {@code [2026-01-01,
 * 2026-02-01)} is January with no possibility of counting the boundary day into
 * February as well. A closed range gets that wrong in a way nobody notices until
 * two adjacent reports sum to more than the year.
 *
 * <p><b>Relative periods resolve against {@code Asia/Manila}</b> (spec §4), and
 * the zone arrives as a parameter rather than being read from the host. At 17:00
 * UTC on 31 January it is already 1 February in Manila, so a UTC-derived "this
 * month" reports the wrong month for eight hours out of every day — and does it
 * only in the evening, which is a miserable thing to reproduce.
 *
 * @param from inclusive
 * @param to exclusive
 */
public record ReportPeriod(LocalDate from, LocalDate to) {

	public ReportPeriod {
		if (from == null || to == null) {
			throw new IllegalArgumentException("A period needs both bounds.");
		}
		if (!to.isAfter(from)) {
			// Equal bounds would be an empty half-open range, which reads like a
			// mistake rather than an intent — and spec §7 already has a way to
			// say "nothing happened" (an empty bucket array over a real period).
			throw new IllegalArgumentException(
					"A period must end after it starts; [%s, %s) is empty or inverted.".formatted(from, to));
		}
	}

	/** The calendar month containing {@code day}. */
	public static ReportPeriod monthOf(LocalDate day) {
		LocalDate first = day.with(TemporalAdjusters.firstDayOfMonth());
		return new ReportPeriod(first, first.plusMonths(1));
	}

	/** The month in progress right now, in {@code zone}. */
	public static ReportPeriod currentMonth(ZoneId zone) {
		return monthOf(LocalDate.now(zone));
	}

	/**
	 * The last {@code days} days ending today, today included.
	 *
	 * <p>"Last 30 days" means the 30 days up to and including today, so the
	 * exclusive bound is tomorrow. Ending it at today would silently drop
	 * everything spent this morning.
	 */
	public static ReportPeriod lastDays(int days, ZoneId zone) {
		if (days < 1) {
			throw new IllegalArgumentException("A period of %d days is not a period.".formatted(days));
		}
		LocalDate tomorrow = LocalDate.now(zone).plusDays(1);
		return new ReportPeriod(tomorrow.minusDays(days), tomorrow);
	}

	/** The period of equal length immediately before this one, for §7's comparison report. */
	public ReportPeriod immediatelyBefore() {
		long length = this.to.toEpochDay() - this.from.toEpochDay();
		return new ReportPeriod(this.from.minusDays(length), this.from);
	}

	public boolean contains(LocalDate day) {
		return !day.isBefore(this.from) && day.isBefore(this.to);
	}

}
