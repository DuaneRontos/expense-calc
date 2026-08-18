package com.duanerontos.expensecalc.classification;

/**
 * The expense fields a rule may read, in the order the engine consults them.
 *
 * <p><b>Declaration order is the match order</b> required by spec §5: merchant
 * first, then description. It is not cosmetic. A merchant is a fact about who
 * was paid; a description is whatever the user typed, and the two disagree often
 * enough that which one wins has to be decided once rather than per rule. A
 * grocery run at {@code SM Supermarket} described as "dinner ingredients" is
 * {@code GROCERIES}, and it is the merchant stage running first that makes it so.
 *
 * <p>{@code ExpenseClassifier} iterates {@link #values()} directly, so reordering
 * this enum silently reverses that precedence. {@code MatchFieldTest} pins the
 * order for exactly that reason.
 */
public enum MatchField {

	/** Who was paid. The stronger signal, so it is consulted first. */
	MERCHANT("Merchant"),

	/** Whatever the user typed. Consulted only when no merchant rule matched. */
	DESCRIPTION("Description");

	private final String label;

	MatchField(String label) {
		this.label = label;
	}

	/**
	 * Human-readable name, used to build the {@code reason} that lands on a
	 * {@code ClassificationRecord} (spec §4).
	 */
	public String getLabel() {
		return this.label;
	}

}
