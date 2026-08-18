package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Report endpoints (spec §8).
 *
 * <p>Returns pre-aggregated buckets. Nothing here streams a list of expenses for
 * the client to add up — spec §3 puts aggregation on the backend so the totals
 * stay in exact integers and iOS, Android and web cannot disagree about them.
 */
@RestController
@RequestMapping("/api/v1/reports")
public class ReportController {

	private final ReportService reports;

	public ReportController(ReportService reports) {
		this.reports = reports;
	}

	/**
	 * {@code GET /api/v1/reports/by-category}.
	 *
	 * <p>Both bounds are optional and default together to the current month in
	 * {@code Asia/Manila}. Defaulting one without the other is deliberately not
	 * supported: "January to unspecified" has two plausible readings — to now,
	 * or to the end of January — and picking one silently is how a report comes
	 * back subtly wrong.
	 *
	 * <p>Returns 200 with an empty bucket array for a period with no expenses,
	 * per spec §7. "No spending in March" is an answer, and a 404 would make the
	 * client render an error where it should render an empty state.
	 *
	 * @param from inclusive, ISO date
	 * @param to exclusive, ISO date — half-open, so {@code 2026-02-01} means
	 *     "up to but not including 1 February"
	 */
	@GetMapping("/by-category")
	public ResponseEntity<CategoryBreakdown> byCategory(
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

		return ResponseEntity.ok(this.reports.byCategory(periodFrom(from, to)));
	}

	/**
	 * {@code GET /api/v1/reports/over-time?bucket=day|week|month}.
	 *
	 * <p>Returns one bucket per slice with no gaps: an empty month comes back as
	 * {@code "0.00"} rather than being absent, so a line chart cannot draw two
	 * points three months apart as though they were adjacent.
	 *
	 * @param bucket slice width; defaults to {@code month}
	 */
	@GetMapping("/over-time")
	public ResponseEntity<SpendOverTime> overTime(
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
			@RequestParam(defaultValue = "month") String bucket) {

		ReportPeriod period = periodFrom(from, to);
		TimeBucket slice = sliceWidth(bucket);
		long slices = slice.bucketCountIn(period);

		// Zero-filling makes the response as large as the window asked for
		// rather than as large as the data, so the period needs a bound that
		// by-category does not: two centuries of days is 73,049 buckets and
		// 4.2 MB from an empty database. Checked here rather than in TimeBucket
		// because the conversion to a 400 only exists at this boundary — thrown
		// deeper, it surfaces as a 500 blaming the server.
		if (slices > TimeBucket.MAX_BUCKETS) {
			throw new InvalidReportPeriodException(
					"[%s, %s) is %d %s buckets, over the %d a response may carry. Narrow the period or widen the slice."
						.formatted(period.from(), period.to(), slices, slice.name().toLowerCase(Locale.ENGLISH),
								TimeBucket.MAX_BUCKETS),
					List.of("from", "to", "bucket"));
		}

		return ResponseEntity.ok(this.reports.overTime(period, slice));
	}

	/**
	 * Parses {@code bucket} case-insensitively.
	 *
	 * <p>Bound as a {@code String} rather than as the enum directly because
	 * Spring's default converter is case-sensitive: this javadoc documented
	 * {@code bucket=day|week|month} while only {@code DAY|WEEK|MONTH} bound, so
	 * a client written against the documentation got a 400 on its first request.
	 * Every test used the uppercase form, and the unknown-value test passed
	 * either way, so nothing noticed.
	 *
	 * <p>Parsing here also means a bad value produces the same
	 * {@code problem+json} with violations as every other bad input on these
	 * endpoints — Spring's own {@code MethodArgumentTypeMismatchException} path
	 * returns a plainer 400 that spec §8 does not ask for.
	 */
	private TimeBucket sliceWidth(String bucket) {
		try {
			return TimeBucket.valueOf(bucket.toUpperCase(Locale.ENGLISH));
		}
		catch (IllegalArgumentException ex) {
			throw new InvalidReportPeriodException("%s is not a slice width. Use day, week, or month."
				.formatted(bucket), List.of("bucket"));
		}
	}

	/**
	 * {@code GET /api/v1/reports/compare}.
	 *
	 * <p>Takes one period and derives what to compare it against, rather than
	 * taking two. Spec §7 calls this "current vs. prior", and letting a caller
	 * pass two arbitrary windows would let it compare a month against a week and
	 * render the difference as a fall in spending.
	 *
	 * <p>A whole calendar month is compared against the calendar month before
	 * it; any other window against the equally long window before it. See
	 * {@link ReportPeriod#previous()} for why the shape decides.
	 */
	@GetMapping("/compare")
	public ResponseEntity<PeriodComparison> compare(
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

		return ResponseEntity.ok(this.reports.compare(periodFrom(from, to)));
	}

	/**
	 * Both bounds, or neither.
	 *
	 * <p>Shared by all three endpoints. Defaulting one without the other is
	 * deliberately unsupported: "January to unspecified" reads as either "to
	 * now" or "to the end of January", and picking one silently is how a report
	 * comes back subtly wrong.
	 */
	private ReportPeriod periodFrom(LocalDate from, LocalDate to) {
		if ((from == null) != (to == null)) {
			throw new InvalidReportPeriodException(
					"Give both from and to, or neither. One bound alone has more than one sensible reading, and guessing which produces a report that is wrong without looking wrong.",
					List.of(from == null ? "from" : "to"));
		}
		try {
			return (from == null) ? this.reports.defaultPeriod() : new ReportPeriod(from, to);
		}
		catch (IllegalArgumentException ex) {
			// Converted here, where the exception is known to describe the
			// request. Handling IllegalArgumentException in the advice instead
			// would also catch server-side failures further down the stack and
			// report them as the caller's bad dates.
			throw new InvalidReportPeriodException(ex.getMessage(), List.of("from", "to"));
		}
	}

}
