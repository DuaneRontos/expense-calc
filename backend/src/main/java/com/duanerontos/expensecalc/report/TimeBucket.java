package com.duanerontos.expensecalc.report;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * How {@code /reports/over-time} slices a period (spec §7).
 *
 * <p>Each constant knows three things: the Postgres {@code date_trunc} unit that
 * groups rows, how to snap a date to its bucket in Java, and how to advance to
 * the next one. The Java half exists because the buckets have to be
 * <b>contiguous</b> — spec §7 wants a month with no expenses to appear with
 * total {@code "0.00"} rather than be omitted, so the x-axis has no invisible
 * gaps. SQL returns only the buckets that have rows; the full sequence is
 * generated here and the totals filled in.
 *
 * <p><b>Labels are formatted in {@link Locale#ENGLISH} explicitly.</b> A
 * host-default locale would render month names differently on a developer's
 * machine and in the container, which turns into a diff nobody can reproduce.
 */
public enum TimeBucket {

	/** One bucket per day. */
	DAY("day", DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)) {
		@Override
		public LocalDate startOfBucket(LocalDate day) {
			return day;
		}

		@Override
		public LocalDate nextBucket(LocalDate bucketStart) {
			return bucketStart.plusDays(1);
		}
	},

	/**
	 * One bucket per week, starting Monday.
	 *
	 * <p>Monday because that is what Postgres {@code date_trunc('week', …)}
	 * does, and the Java side has to agree with it or the fill step would
	 * generate bucket starts the query never returns — every week would read
	 * zero while the real totals sat in buckets nothing looked for.
	 */
	WEEK("week", DateTimeFormatter.ofPattern("'Week of' d MMM yyyy", Locale.ENGLISH)) {
		@Override
		public LocalDate startOfBucket(LocalDate day) {
			return day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
		}

		@Override
		public LocalDate nextBucket(LocalDate bucketStart) {
			return bucketStart.plusWeeks(1);
		}
	},

	/** One bucket per calendar month. */
	MONTH("month", DateTimeFormatter.ofPattern("MMM yyyy", Locale.ENGLISH)) {
		@Override
		public LocalDate startOfBucket(LocalDate day) {
			return day.with(TemporalAdjusters.firstDayOfMonth());
		}

		@Override
		public LocalDate nextBucket(LocalDate bucketStart) {
			return bucketStart.plusMonths(1);
		}
	};

	private final String truncUnit;

	private final DateTimeFormatter labelFormat;

	TimeBucket(String truncUnit, DateTimeFormatter labelFormat) {
		this.truncUnit = truncUnit;
		this.labelFormat = labelFormat;
	}

	/** The unit passed to Postgres {@code date_trunc}. Bound as a parameter, never concatenated. */
	public String truncUnit() {
		return this.truncUnit;
	}

	public abstract LocalDate startOfBucket(LocalDate day);

	public abstract LocalDate nextBucket(LocalDate bucketStart);

	public String label(LocalDate bucketStart) {
		return this.labelFormat.format(bucketStart);
	}

	/**
	 * Every bucket start in {@code period}, in order, with no gaps.
	 *
	 * <p>Starts from the bucket containing {@code from}, which may begin before
	 * the period does — a week-bucketed January starts on Monday 29 December.
	 * That bucket is included because its total covers the days of it that fall
	 * inside the period, and omitting it would drop the first days of January
	 * from the chart entirely.
	 */
	public List<LocalDate> bucketStartsIn(ReportPeriod period) {
		List<LocalDate> starts = new ArrayList<>();
		for (LocalDate start = startOfBucket(period.from()); start.isBefore(period.to()); start = nextBucket(start)) {
			starts.add(start);
		}
		return starts;
	}

}
