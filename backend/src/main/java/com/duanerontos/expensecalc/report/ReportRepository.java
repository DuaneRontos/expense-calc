package com.duanerontos.expensecalc.report;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.duanerontos.expensecalc.expense.Expense;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * The report aggregations, in SQL.
 *
 * <p>Spec §10 budgets any report at p95 under 500ms over 50,000 expenses and
 * forbids N+1 in the report path. That rules out reading rows into the JVM to
 * add up, and it rules out resolving each expense's category with its own
 * query — so the current category is resolved <em>inside</em> the aggregation
 * rather than before it. This is the bulk read #9 deliberately left unwritten
 * until something needed a specific shape.
 */
public interface ReportRepository extends Repository<Expense, UUID> {

	/** One row per category present in the period. */
	interface CategoryTotalRow {

		String getCategory();

		long getTotalMinor();

	}

	/**
	 * Net total per category over {@code [from, to)}, using each expense's
	 * category as of {@code asOf}.
	 *
	 * <p><b>{@code LEFT JOIN LATERAL} with {@code LIMIT 1}</b> is the
	 * latest-record-wins read from #9, evaluated once per expense by the planner
	 * against the {@code (expense_id, recorded_at DESC, id DESC)} index, rather
	 * than once per expense as a round trip. The {@code ORDER BY} matches that
	 * index exactly, including the {@code id} tiebreaker that keeps a
	 * same-instant pair resolving the same way every time.
	 *
	 * <p><b>{@code LEFT} rather than an inner join, and the {@code COALESCE},
	 * are load-bearing.</b> An expense with no classification visible at
	 * {@code asOf} — entered late and classified after that instant, say — would
	 * be dropped entirely by an inner join, and its money would silently vanish
	 * from the total. Money disappearing from a report is a worse failure than
	 * money sitting in {@code UNCLASSIFIED}, which is at least visible and is
	 * what spec §5 says to do with a category nobody has decided.
	 *
	 * <p><b>No {@code abs()}, no filter on sign.</b> {@code SUM} over signed
	 * centavos is the net that spec §7 wants, and a bucket may come back
	 * negative.
	 *
	 * @param from inclusive lower bound on {@code occurred_on}
	 * @param to exclusive upper bound — half-open, so month boundaries cannot
	 *     double-count
	 * @param asOf resolves each expense's category to the record in force at
	 *     this instant; pass the current time for the ordinary report
	 */
	/** One row per time slice that has expenses in it. Empty slices are absent. */
	interface BucketTotalRow {

		LocalDate getBucketStart();

		long getTotalMinor();

	}

	/**
	 * Net total per time slice over {@code [from, to)}.
	 *
	 * <p>No category resolution here, so no lateral join: this report is spend
	 * over time, not spend per category over time. That keeps it a single
	 * grouped scan over the {@code (occurred_on DESC, id)} index.
	 *
	 * <p><b>{@code :unit} is bound, never concatenated.</b> It reaches this
	 * query only from {@link TimeBucket#truncUnit()}, so the value set is closed
	 * by the enum — but binding it means the query is not string-assembled even
	 * if a future caller is careless.
	 *
	 * <p>Returns only slices that have rows. Spec §7 wants contiguous buckets,
	 * and the gaps are filled in {@link SpendOverTime} rather than by making the
	 * database generate a series — the period already knows its own shape, and
	 * generating it in Java keeps the zero-filling testable without a database.
	 */
	@Query(value = """
			SELECT date_trunc(:unit, e.occurred_on::timestamp)::date AS bucket_start,
			       SUM(e.amount_minor)                               AS total_minor
			FROM expense e
			WHERE e.occurred_on >= :from
			  AND e.occurred_on <  :to
			GROUP BY 1
			ORDER BY 1
			""", nativeQuery = true)
	List<BucketTotalRow> totalsByTimeBucket(@Param("from") LocalDate from, @Param("to") LocalDate to,
			@Param("unit") String unit);

	@Query(value = """
			SELECT COALESCE(current_record.category::text, 'UNCLASSIFIED') AS category,
			       SUM(e.amount_minor)                                     AS total_minor
			FROM expense e
			LEFT JOIN LATERAL (
			    SELECT r.category
			    FROM classification_record r
			    WHERE r.expense_id = e.id
			      AND r.recorded_at <= :asOf
			    ORDER BY r.recorded_at DESC, r.id DESC
			    LIMIT 1
			) AS current_record ON TRUE
			WHERE e.occurred_on >= :from
			  AND e.occurred_on <  :to
			GROUP BY 1
			""", nativeQuery = true)
	List<CategoryTotalRow> totalsByCategory(@Param("from") LocalDate from, @Param("to") LocalDate to,
			@Param("asOf") Instant asOf);

}
