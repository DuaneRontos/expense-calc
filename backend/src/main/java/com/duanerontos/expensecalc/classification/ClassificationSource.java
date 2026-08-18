package com.duanerontos.expensecalc.classification;

/**
 * Where a classification came from (spec §4).
 *
 * <p>Recorded on every {@link ClassificationRecord} so that a category months
 * old can be traced to whatever decided it. "The rule engine guessed" and "the
 * user said so" carry very different weight when a report looks wrong, and
 * without this column they are indistinguishable.
 *
 * <p>Backed by the {@code classification_source} Postgres type, so the set is
 * closed at the database level in the same way the taxonomy is.
 */
public enum ClassificationSource {

	/** {@link ExpenseClassifier} matched a rule. The default for a new expense. */
	RULE_ENGINE,

	/** The user reclassified it. Outranks the engine by being later, not by rank. */
	USER,

	/**
	 * Carried in from an external source.
	 *
	 * <p>Nothing produces this in v1 — bank and card import are out of scope per
	 * spec §1. It is here because spec §4 names it, and because a source column
	 * that cannot express "this came from outside" would need a migration on the
	 * day import lands rather than a new value.
	 */
	IMPORT

}
