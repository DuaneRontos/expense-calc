package com.duanerontos.expensecalc.expense;

/**
 * The closed expense taxonomy defined in
 * {@code .claude/skills/expense-classification/SKILL.md}.
 *
 * <p><b>Closed means closed.</b> Adding a value here is not a one-line edit: it
 * needs a Flyway migration extending the {@code expense_category} Postgres type
 * and a defined destination for every existing expense. {@code CategoryTest}
 * asserts the exact membership so an addition cannot land silently.
 *
 * <p><b>{@link #UNCLASSIFIED} is a real state, not a failure mode.</b> An
 * expense no rule matched belongs here, waiting for the user to decide. Never
 * guess a category to avoid it — a wrong confident guess corrupts every report
 * downstream, whereas an unclassified expense is visible and fixable.
 *
 * <p>Declaration order is the taxonomy's own order, roughly essentials first.
 * Postgres compares enum values by declaration order, so this is also what
 * {@code ORDER BY category} produces — deliberately not alphabetical.
 *
 * <p>Reporting groups on this type. Spec §7 forbids a parallel string taxonomy
 * anywhere in the reporting path.
 */
public enum Category {

	/** Rent, mortgage, property tax, home insurance. Repairs are MAINTENANCE. */
	HOUSING("Housing"),

	/** Power, water, gas, internet, phone. Streaming is DISCRETIONARY. */
	UTILITIES("Utilities"),

	/** Food and household consumables bought to use at home. */
	GROCERIES("Groceries"),

	/** Restaurants, cafes, delivery, bars. */
	DINING("Dining"),

	/** Fuel, transit, rideshare, parking, tolls. Vehicle repair is MAINTENANCE. */
	TRANSPORT("Transport"),

	/** Repairs and upkeep of anything owned. Value-adding work is CAPITAL. */
	MAINTENANCE("Maintenance"),

	/** Medical, dental, pharmacy, insurance premiums. Gym is DISCRETIONARY. */
	HEALTH("Health"),

	/** Entertainment, hobbies, subscriptions, gifts. */
	DISCRETIONARY("Discretionary"),

	/** Purchases that hold value past the period. */
	CAPITAL("Capital"),

	/** Money in that offsets no particular expense — salary, interest, a gift
	 * received. Money in that <em>does</em> offset one keeps that expense's
	 * category as a negative amount instead: a grocery refund is negative
	 * GROCERIES, and a reimbursed client dinner is negative DINING, however the
	 * money reached you (spec §5). */
	INCOME("Income"),

	/** Nothing matched. A prompt for the user, not an error. */
	UNCLASSIFIED("Unclassified");

	private final String label;

	Category(String label) {
		this.label = label;
	}

	/**
	 * Human-readable name for display.
	 *
	 * <p>Served by {@code GET /categories} (spec §8) so clients render the
	 * taxonomy from the API rather than hardcoding it — a hardcoded copy drifts
	 * the first time a label changes, and drifts silently.
	 */
	public String getLabel() {
		return this.label;
	}

}
