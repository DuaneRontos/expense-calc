package com.duanerontos.expensecalc.query;

import java.time.Clock;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Filtered, sorted, paged reads over expenses (spec §6).
 */
@Service
public class ExpenseQueryService {

	private final ExpenseQueryRepository repository;

	private final Clock clock;

	public ExpenseQueryService(ExpenseQueryRepository repository, Clock clock) {
		this.repository = repository;
		this.clock = clock;
	}

	/**
	 * One page of expenses.
	 *
	 * <p><b>The page and the count run in one transaction, at one {@code asOf},
	 * under one snapshot.</b> All three are needed and they are not the same
	 * thing. Sharing {@code asOf} pins the classification lateral join, so a
	 * reclassification between the statements cannot move a row in or out of a
	 * category filter. But Postgres defaults to READ COMMITTED, where every
	 * statement takes a <em>fresh</em> snapshot — so a concurrent insert
	 * between the count and the page still produces "51 of 50".
	 * {@code REPEATABLE_READ} is what makes the two statements see one
	 * database, and it costs nothing here: this transaction is read-only and
	 * v1 is single-user, so there is no contention to serialise against.
	 */
	@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
	public ExpensePage list(ExpenseFilter filter, ExpenseSort sort, boolean descending, int page, Integer size) {
		int pageSize = ExpensePage.clampSize(size);
		int pageNumber = Math.max(page, 0);
		var asOf = this.clock.instant();

		long total = this.repository.count(filter, asOf);
		var items = this.repository.findPage(filter, sort, descending, pageNumber, pageSize, asOf);

		return ExpensePage.of(items, pageNumber, pageSize, total);
	}

}
