package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import com.duanerontos.expensecalc.money.Money;

/**
 * The {@code /reports/over-time} response (spec §7).
 *
 * <p><b>Buckets are contiguous.</b> A month with no expenses appears with total
 * {@code "0.00"} rather than being omitted, so the x-axis has no invisible gaps.
 * A chart that silently skips empty periods draws a line between two points
 * three months apart as though they were adjacent, which reads as a trend that
 * did not happen.
 *
 * @param period the window reported on, half-open
 * @param bucket the slice width the buckets were cut at
 * @param currency ISO 4217; always {@code PHP} in v1
 * @param total the net of every bucket, which may be negative
 * @param buckets in chronological order, one per slice, none missing
 */
public record SpendOverTime(ReportPeriod period, TimeBucket bucket, String currency, String total,
		List<Bucket> buckets) {

	/**
	 * One slice.
	 *
	 * @param key the bucket's first day, ISO — what the client sorts and plots on
	 * @param label a rendered name such as {@code Jan 2026}
	 * @param total decimal string; {@code "0.00"} for a slice with no expenses
	 */
	public record Bucket(String key, String label, String total) {
	}

	/**
	 * Builds the response, filling every empty slice with zero.
	 *
	 * <p>{@code totalsByBucketStart} carries only the slices the query found
	 * rows for; {@link TimeBucket#bucketStartsIn} supplies the full sequence.
	 * The total is summed from the query's own values rather than from the
	 * filled sequence — identical arithmetic, but it makes the zero-filling
	 * visibly a presentation concern rather than something that could affect a
	 * number.
	 */
	public static SpendOverTime of(ReportPeriod period, TimeBucket bucket, Map<LocalDate, Long> totalsByBucketStart) {
		long netMinor = totalsByBucketStart.values().stream().mapToLong(Long::longValue).sum();

		List<Bucket> buckets = bucket.bucketStartsIn(period)
			.stream()
			.map(start -> new Bucket(start.toString(), bucket.label(start),
					Money.toMajorUnits(totalsByBucketStart.getOrDefault(start, 0L)).toPlainString()))
			.toList();

		return new SpendOverTime(period, bucket, Money.CURRENCY_CODE, Money.toMajorUnits(netMinor).toPlainString(),
				buckets);
	}

}
