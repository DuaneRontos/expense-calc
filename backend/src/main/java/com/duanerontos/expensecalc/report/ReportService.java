package com.duanerontos.expensecalc.report;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;

import com.duanerontos.expensecalc.expense.Category;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Turns periods into chart-shaped answers (spec §7).
 *
 * <p>The backend owns all aggregation (spec §3): the client receives buckets
 * with labels and totals and never sums a list of expenses. That keeps the
 * arithmetic on the JVM in exact integers rather than in JavaScript numbers,
 * and keeps two platforms from disagreeing about a total.
 */
@Service
public class ReportService {

	private final ReportRepository repository;

	private final Clock clock;

	private final ZoneId reportingZone;

	public ReportService(ReportRepository repository, Clock clock,
			@Value("${app.reporting.zone}") ZoneId reportingZone) {
		this.repository = repository;
		this.clock = clock;
		this.reportingZone = reportingZone;
	}

	/** The zone relative periods resolve against — {@code Asia/Manila}, from configuration. */
	public ZoneId reportingZone() {
		return this.reportingZone;
	}

	/**
	 * Category breakdown for a period, using categories as they stand now.
	 *
	 * <p>This is the ordinary report. A reclassification therefore <em>does</em>
	 * change what a closed period reports, which is usually what someone wants
	 * when they correct a miscategorised expense — the correction should show up
	 * in the history it applies to.
	 */
	public CategoryBreakdown byCategory(ReportPeriod period) {
		return byCategory(period, this.clock.instant());
	}

	/**
	 * Category breakdown as the categories stood at {@code asOf}.
	 *
	 * <p>This is what makes a closed period reproducible (issue #9): re-running
	 * January pinned to 1 February returns what it returned then, whatever has
	 * been reclassified since. Spec §7's response has nowhere to carry an
	 * {@code asOf}, so no endpoint exposes this yet — the mechanism is here so
	 * that exposing it is a parameter rather than a rewrite.
	 *
	 * <p><b>What this does not claim.</b> It pins the <em>category</em> as of an
	 * instant, not the expense set: an expense entered after {@code asOf} but
	 * dated inside the period still appears. Full point-in-time reproduction
	 * would have to filter on {@code created_at} as well, which is a larger
	 * decision than #9 settled and belongs with whoever needs it.
	 */
	public CategoryBreakdown byCategory(ReportPeriod period, Instant asOf) {
		List<CategoryTotal> totals = this.repository.totalsByCategory(period.from(), period.to(), asOf)
			.stream()
			.map(row -> new CategoryTotal(Category.valueOf(row.getCategory()), row.getTotalMinor()))
			.toList();

		return CategoryBreakdown.of(period, totals);
	}

}
