package com.duanerontos.expensecalc.query;

import java.util.Locale;

/**
 * The sortable columns of {@code GET /expenses} (spec §6).
 *
 * <p>A closed set, and it has to be: a sort field is the one part of a query
 * that cannot be a bound parameter, because {@code ORDER BY ?} is not a thing
 * SQL does. Every value that reaches the query is therefore a constant declared
 * here, never a string from the request — the request only ever selects among
 * these.
 *
 * <p><b>Amount sorts on the stored integer</b>, not on a converted
 * {@code BigDecimal}. Spec §6 is explicit, and the reason is paging: a
 * conversion per row is a chance for two requests to order the same rows
 * differently, which drops and duplicates rows across page boundaries.
 *
 * <p><b>Category sorts by the Postgres enum's declaration order</b>, which V2
 * deliberately made the taxonomy's own order rather than alphabetical. So
 * {@code sort=category} groups essentials first, which is what a person reading
 * a list expects, rather than putting Capital before Dining.
 */
public enum ExpenseSort {

	/** The date the money moved. The default. */
	OCCURRED_ON("e.occurred_on"),

	/** Signed centavos, so a refund sorts below everything it refunds. */
	AMOUNT("e.amount_minor"),

	/** Null merchants sort last in both directions — see {@link #orderBy}. */
	MERCHANT("e.merchant"),

	/** Taxonomy order, not alphabetical. */
	CATEGORY("current_category");

	private final String column;

	ExpenseSort(String column) {
		this.column = column;
	}

	/**
	 * The {@code ORDER BY} fragment, tiebreaker included.
	 *
	 * <p><b>The {@code e.id} tiebreaker is appended automatically and is not
	 * optional.</b> Spec §6: without it, a page of identical amounts drops and
	 * duplicates rows across page boundaries, because the database is free to
	 * return equal rows in any order and will happily return a different one for
	 * page 2 than it did for page 1. The bug appears only on real data, only
	 * sometimes, and looks like the data changed underneath the user.
	 *
	 * <p>{@code NULLS LAST} in both directions rather than Postgres's default
	 * (nulls first when descending): merchant is nullable, and a descending sort
	 * that opens with a screen of blank merchants looks broken. Sorting them to
	 * the end in both directions is the less surprising answer.
	 */
	public String orderBy(boolean descending) {
		String direction = descending ? "DESC" : "ASC";
		return "%s %s NULLS LAST, e.id ASC".formatted(this.column, direction);
	}

	/**
	 * Parses the {@code field} half of {@code sort=field,dir}.
	 *
	 * <p>Accepts the camelCase spelling the API uses ({@code occurredOn}) as
	 * well as the enum's own name, because spec §6 writes the parameter as
	 * {@code occurredOn} and a client copying the spec should not get a 400.
	 */
	public static ExpenseSort parse(String field) {
		String normalized = field.strip().replace("_", "").toLowerCase(Locale.ENGLISH);
		for (ExpenseSort sort : values()) {
			if (sort.name().replace("_", "").toLowerCase(Locale.ENGLISH).equals(normalized)) {
				return sort;
			}
		}
		throw new IllegalArgumentException(
				"%s is not a sortable field. Use occurredOn, amount, merchant, or category.".formatted(field));
	}

}
