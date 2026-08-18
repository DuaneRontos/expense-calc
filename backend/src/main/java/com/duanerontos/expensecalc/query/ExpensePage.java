package com.duanerontos.expensecalc.query;

import java.util.List;

/**
 * A page of expenses with the counts a pager needs (spec §6).
 *
 * <p><b>No endpoint returns an unbounded result set.</b> Size is capped, and the
 * total is returned so a client can render "page 3 of 27" without asking for
 * everything to count it.
 *
 * @param items this page, in the requested order
 * @param page zero-based
 * @param size the page size actually applied, which may be smaller than asked
 *     for if the request exceeded the cap
 * @param totalItems matching rows across all pages
 * @param totalPages at least 1, so an empty result still reads as "page 1 of 1"
 *     rather than "page 1 of 0"
 */
public record ExpensePage(List<ExpenseSummary> items, int page, int size, long totalItems, int totalPages) {

	/** Spec §6: default 50, max 200. */
	public static final int DEFAULT_SIZE = 50;

	public static final int MAX_SIZE = 200;

	public static ExpensePage of(List<ExpenseSummary> items, int page, int size, long totalItems) {
		int totalPages = (totalItems == 0) ? 1 : (int) Math.ceilDiv(totalItems, size);
		return new ExpensePage(items, page, size, totalItems, totalPages);
	}

	/**
	 * Clamps a requested size into range.
	 *
	 * <p>Clamped rather than rejected: a client asking for 500 wants as many as
	 * it can have, and the response reports the size actually applied so it can
	 * tell. A 400 here would be technically defensible and practically annoying.
	 * Zero or negative is a different thing — that is a malformed request, and
	 * it falls back to the default rather than returning an empty page forever.
	 */
	public static int clampSize(Integer requested) {
		if (requested == null || requested < 1) {
			return DEFAULT_SIZE;
		}
		return Math.min(requested, MAX_SIZE);
	}

}
