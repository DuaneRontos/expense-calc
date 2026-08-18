package com.duanerontos.expensecalc.report;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import com.duanerontos.expensecalc.expense.Category;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

	/**
	 * The period a request means when it names none: the month in progress in
	 * {@code Asia/Manila}.
	 *
	 * <p>Here rather than in the controller because it needs the clock and the
	 * zone, and both live here. A controller reaching back through the service
	 * for a zone in order to build a period is doing the service's job with the
	 * service's data.
	 */
	@Transactional(readOnly = true)
	public ReportPeriod defaultPeriod() {
		return ReportPeriod.currentMonth(reportingClock());
	}

	/**
	 * The injected clock, zoned for reporting.
	 *
	 * <p>The bean answers "what instant is it", which has no zone; turning that
	 * into a Philippine calendar day is this step. Conflating them is how a
	 * report ends up in the host's timezone (spec §4).
	 */
	private Clock reportingClock() {
		return this.clock.withZone(this.reportingZone);
	}

	/**
	 * Category breakdown for a period, using categories as they stand now.
	 *
	 * <p>This is the ordinary report. A reclassification therefore <em>does</em>
	 * change what a closed period reports, which is usually what someone wants
	 * when they correct a miscategorised expense — the correction should show up
	 * in the history it applies to.
	 */
	@Transactional(readOnly = true)
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
	@Transactional(readOnly = true)
	public CategoryBreakdown byCategory(ReportPeriod period, Instant asOf) {
		return CategoryBreakdown.of(period, categoryTotals(period, asOf));
	}

	/**
	 * Spend over time, sliced at {@code bucket}.
	 *
	 * <p>Not category-resolved: this answers "how much, when", and pulling the
	 * classification history into it would cost a lateral join for a dimension
	 * the chart does not draw.
	 */
	@Transactional(readOnly = true)
	public SpendOverTime overTime(ReportPeriod period, TimeBucket bucket) {
		Map<LocalDate, Long> totals = this.repository
			.totalsByTimeBucket(period.from(), period.to(), bucket.truncUnit())
			.stream()
			.collect(Collectors.toMap(ReportRepository.BucketTotalRow::getBucketStart,
					ReportRepository.BucketTotalRow::getTotalMinor));

		return SpendOverTime.of(period, bucket, totals);
	}

	/**
	 * This period against the one before it (spec §7).
	 *
	 * <p><b>Both aggregations run in one transaction and against one {@code asOf}
	 * instant.</b> Two reads that disagree about either would compare periods as
	 * they looked at two different moments — and the difference would show up as
	 * a change in spending, which is precisely the number this report exists to
	 * report. That is why {@code byCategory}'s single-period form is not called
	 * twice here.
	 */
	@Transactional(readOnly = true)
	public PeriodComparison compare(ReportPeriod period) {
		Instant asOf = this.clock.instant();
		ReportPeriod previous = period.previous();

		return PeriodComparison.of(period, previous, categoryTotals(period, asOf), categoryTotals(previous, asOf));
	}

	private List<CategoryTotal> categoryTotals(ReportPeriod period, Instant asOf) {
		return this.repository.totalsByCategory(period.from(), period.to(), asOf)
			.stream()
			.map(row -> new CategoryTotal(Category.valueOf(row.getCategory()), row.getTotalMinor()))
			.toList();
	}

}
