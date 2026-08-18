package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.util.List;

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

		if ((from == null) != (to == null)) {
			throw new InvalidReportPeriodException(
					"Give both from and to, or neither. One bound alone has more than one sensible reading, and guessing which produces a report that is wrong without looking wrong.",
					List.of(from == null ? "from" : "to"));
		}

		ReportPeriod period;
		try {
			period = (from == null) ? this.reports.defaultPeriod() : new ReportPeriod(from, to);
		}
		catch (IllegalArgumentException ex) {
			// Converted here, where the exception is known to describe the
			// request. Handling IllegalArgumentException in the advice instead
			// would also catch server-side failures further down the stack and
			// report them as the caller's bad dates.
			throw new InvalidReportPeriodException(ex.getMessage(), List.of("from", "to"));
		}

		return ResponseEntity.ok(this.reports.byCategory(period));
	}

}
