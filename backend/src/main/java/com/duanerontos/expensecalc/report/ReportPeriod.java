package com.duanerontos.expensecalc.report;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
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

	/**
	 * The month in progress according to {@code clock}.
	 *
	 * <p>Takes a {@link Clock} rather than reading {@link LocalDate#now(ZoneId)}
	 * so that <em>which month gets reported</em> is testable. That is the §4
	 * behaviour with the eight-hours-a-day failure mode, and reading the JVM
	 * clock here left it as the one decision no test could pin — while the
	 * injected clock governed only the as-of instant, so a single request read
	 * two clocks.
	 *
	 * <p>The clock carries the zone: pass one already set to {@code Asia/Manila}
	 * (see {@code ReportService}), because an instant alone cannot say which
	 * calendar day it is.
	 */
	public static ReportPeriod currentMonth(Clock clock) {
		return monthOf(LocalDate.now(clock));
	}

	/**
	 * The last {@code days} days ending today, today included.
	 *
	 * <p>"Last 30 days" means the 30 days up to and including today, so the
	 * exclusive bound is tomorrow. Ending it at today would silently drop
	 * everything spent this morning.
	 */
	public static ReportPeriod lastDays(int days, Clock clock) {
		if (days < 1) {
			throw new IllegalArgumentException("A period of %d days is not a period.".formatted(days));
		}
		LocalDate tomorrow = LocalDate.now(clock).plusDays(1);
		return new ReportPeriod(tomorrow.minusDays(days), tomorrow);
	}

	/**
	 * True when this period spans whole calendar months — one, three, twelve.
	 *
	 * <p>Deliberately not just one month. An earlier version matched a single
	 * month only, which meant a quarter or a year fell to the equal-length rule
	 * and drifted: Q1 2026 compared against {@code [2025-10-03, 2026-01-01)}
	 * rather than Q4, and whether a calendar year landed correctly depended on
	 * whether its neighbour was a leap year. The principle was always "calendar
	 * windows compare against calendar windows"; the test for it was narrower
	 * than the principle.
	 */
	public boolean isWholeCalendarMonths() {
		return this.from.getDayOfMonth() == 1 && this.to.getDayOfMonth() == 1;
	}

	/**
	 * The period this one should be compared against (spec §7's grouped bar).
	 *
	 * <p><b>Calendar-aware when this period is a whole month, equal-length
	 * otherwise.</b> Both rules are wrong for the other's case, which is why the
	 * shape of the period decides rather than a flag:
	 *
	 * <ul>
	 * <li>Equal-length on March gives {@code [2026-01-29, 2026-03-01)} — 31 days
	 * ending at February's end, which is not February. A user who picked March
	 * from a month picker expects February, and would read that as a bug.
	 * <li>Calendar-aware on "last 30 days" is meaningless: there is no previous
	 * calendar window for one that straddles two of them.
	 * </ul>
	 *
	 * <p>Comparing February against January is comparing 28 days against 31, and
	 * that is the honest comparison rather than a defect — a month picker is
	 * asking about months, and normalising the lengths would report a February
	 * that never happened. The client should say which months it is showing so
	 * the reader can see the difference for themselves.
	 */
	public ReportPeriod previous() {
		if (isWholeCalendarMonths()) {
			long months = ChronoUnit.MONTHS.between(this.from, this.to);
			return new ReportPeriod(this.from.minusMonths(months), this.from);
		}
		long length = this.to.toEpochDay() - this.from.toEpochDay();
		return new ReportPeriod(this.from.minusDays(length), this.from);
	}

	/** Days in this period. */
	public long lengthInDays() {
		return this.to.toEpochDay() - this.from.toEpochDay();
	}

	public boolean contains(LocalDate day) {
		return !day.isBefore(this.from) && day.isBefore(this.to);
	}

}
