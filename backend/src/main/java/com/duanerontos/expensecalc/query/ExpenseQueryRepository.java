package com.duanerontos.expensecalc.query;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.money.Money;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.PersistenceContext;

import org.springframework.stereotype.Repository;

/**
 * The filtered, sorted, paged read behind {@code GET /expenses} (spec §6).
 *
 * <p><b>Why native SQL and not Criteria.</b> The current category comes from the
 * latest {@code classification_record}, and resolving it needs a
 * {@code LATERAL} join that JPA Criteria cannot express. Resolving it any other
 * way is a query per row — the N+1 spec §10 forbids — so the join wins and the
 * query is written out.
 *
 * <p><b>How injection is kept impossible.</b> Every value is a bound parameter.
 * The only text concatenated into the statement is
 * {@link ExpenseSort#orderBy(boolean)}, which is built from enum constants
 * declared in code; the request selects among them and never contributes
 * characters. That is the whole of the dynamic surface.
 *
 * <p><b>Why the substring filters escape their own input.</b> The value is
 * bound, so this was never injection — but {@code %} and {@code _} inside the
 * <em>value</em> are still {@code LIKE} metacharacters. Unescaped,
 * {@code ?merchant=%} returns every expense and {@code ?merchant=_M} matches
 * {@code SM}, and the result looks plausible enough that nobody checks. A
 * merchant called "100% Fitness" is not a hypothetical.
 *
 * <p><b>Why the filters are written as {@code (:x IS NULL OR …)}.</b> One static
 * statement handles every combination, so there is no query-string assembly to
 * get wrong, and Postgres can plan it. The cost is that an unused filter still
 * appears in the plan, which for this table's size is not worth trading a
 * hand-assembled query for.
 */
@Repository
public class ExpenseQueryRepository {

	/**
	 * Resolves each expense's current category once, in the join, rather than
	 * once per row from the service.
	 */
	private static final String FROM_AND_WHERE = """
			FROM expense e
			LEFT JOIN LATERAL (
			    SELECT r.category
			    FROM classification_record r
			    WHERE r.expense_id = e.id
			      AND r.recorded_at <= :asOf
			    ORDER BY r.recorded_at DESC, r.id DESC
			    LIMIT 1
			) AS cr ON TRUE
			WHERE (:noCategoryFilter = TRUE
			       OR COALESCE(cr.category::text, 'UNCLASSIFIED') = ANY(CAST(:categories AS text[])))
			  AND (CAST(:fromDate AS date) IS NULL OR e.occurred_on >= CAST(:fromDate AS date))
			  AND (CAST(:toDate   AS date) IS NULL OR e.occurred_on <  CAST(:toDate   AS date))
			  AND (CAST(:merchant AS text) IS NULL
			       OR e.merchant ILIKE '%' || REPLACE(REPLACE(REPLACE(CAST(:merchant AS text),
			              '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
			  AND (CAST(:text AS text) IS NULL
			       OR e.description ILIKE '%' || REPLACE(REPLACE(REPLACE(CAST(:text AS text),
			              '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
			  AND (CAST(:minAmount AS bigint) IS NULL OR e.amount_minor >= CAST(:minAmount AS bigint))
			  AND (CAST(:maxAmount AS bigint) IS NULL OR e.amount_minor <= CAST(:maxAmount AS bigint))
			""";

	@PersistenceContext
	private EntityManager entityManager;

	/**
	 * One page of matching expenses.
	 *
	 * @param asOf resolves each expense's category to the record in force at
	 *     this instant; pass the current time for an ordinary list
	 */
	public List<ExpenseSummary> findPage(ExpenseFilter filter, ExpenseSort sort, boolean descending, int page,
			int size, Instant asOf) {

		String sql = """
				SELECT e.id, e.amount_minor, e.currency, e.occurred_on, e.merchant, e.description,
				       COALESCE(cr.category::text, 'UNCLASSIFIED') AS current_category
				""" + FROM_AND_WHERE + "ORDER BY " + sort.orderBy(descending) + "\nLIMIT :size OFFSET :offset";

		Query query = this.entityManager.createNativeQuery(sql);
		bindFilters(query, filter, asOf);
		query.setParameter("size", size);
		query.setParameter("offset", (long) page * size);

		@SuppressWarnings("unchecked")
		List<Object[]> rows = query.getResultList();

		return rows.stream().map(ExpenseQueryRepository::toSummary).toList();
	}

	/** How many rows match, ignoring paging. */
	public long count(ExpenseFilter filter, Instant asOf) {
		Query query = this.entityManager.createNativeQuery("SELECT COUNT(*) " + FROM_AND_WHERE);
		bindFilters(query, filter, asOf);
		return ((Number) query.getSingleResult()).longValue();
	}

	private void bindFilters(Query query, ExpenseFilter filter, Instant asOf) {
		List<String> categories = filter.categoryNames();
		query.setParameter("noCategoryFilter", categories.isEmpty());
		// Postgres needs a real array even when the flag above short-circuits
		// the comparison, because the cast is evaluated regardless.
		query.setParameter("categories", categories.isEmpty() ? "{}" : "{" + String.join(",", categories) + "}");
		query.setParameter("fromDate", filter.from());
		query.setParameter("toDate", filter.to());
		query.setParameter("merchant", filter.merchant());
		query.setParameter("text", filter.text());
		query.setParameter("minAmount", filter.minAmountMinor());
		query.setParameter("maxAmount", filter.maxAmountMinor());
		query.setParameter("asOf", asOf);
	}

	private static ExpenseSummary toSummary(Object[] row) {
		Category category = Category.valueOf((String) row[6]);
		return new ExpenseSummary((UUID) row[0], Money.toMajorUnits(((Number) row[1]).longValue()).toPlainString(),
				(String) row[2], toLocalDate(row[3]), (String) row[4], (String) row[5], category.name(),
				category.getLabel());
	}

	/**
	 * A {@code date} column, whichever type the driver hands back.
	 *
	 * <p>Not defensive coding for its own sake: this cast is the one place a
	 * native query gives up the type safety the rest of the codebase has, and
	 * assuming {@link java.sql.Date} was wrong — the current pgjdbc returns
	 * {@link LocalDate} directly, so the assumption compiled, passed every test
	 * that did not need Docker, and failed only against a real database.
	 * Accepting both means a driver upgrade cannot reintroduce it.
	 */
	private static LocalDate toLocalDate(Object value) {
		if (value instanceof LocalDate date) {
			return date;
		}
		if (value instanceof java.sql.Date sqlDate) {
			return sqlDate.toLocalDate();
		}
		throw new IllegalStateException("occurred_on came back as %s, which is neither LocalDate nor java.sql.Date."
			.formatted(value == null ? "null" : value.getClass().getName()));
	}

}
