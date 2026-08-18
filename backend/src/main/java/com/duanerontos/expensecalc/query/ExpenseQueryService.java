package com.duanerontos.expensecalc.query;

import java.time.Clock;

import org.springframework.stereotype.Service;
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
	 * <p><b>The page and the count run in one transaction against one
	 * {@code asOf}.</b> Two reads that disagreed about either could report a
	 * total that does not match the rows returned — a pager showing "51 of 50",
	 * or a page 2 that is empty because a row moved out of the filter between
	 * the two statements.
	 */
	@Transactional(readOnly = true)
	public ExpensePage list(ExpenseFilter filter, ExpenseSort sort, boolean descending, int page, Integer size) {
		int pageSize = ExpensePage.clampSize(size);
		int pageNumber = Math.max(page, 0);
		var asOf = this.clock.instant();

		long total = this.repository.count(filter, asOf);
		var items = this.repository.findPage(filter, sort, descending, pageNumber, pageSize, asOf);

		return ExpensePage.of(items, pageNumber, pageSize, total);
	}

}
