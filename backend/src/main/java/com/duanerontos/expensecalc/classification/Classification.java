package com.duanerontos.expensecalc.classification;

import com.duanerontos.expensecalc.expense.Category;

/**
 * What the engine decided, and why.
 *
 * <p>The {@code why} is not decoration. Spec §4 gives {@code
 * ClassificationRecord} a {@code reason} column precisely so that a category
 * sitting on an expense months later can be traced to the rule that put it
 * there — without it, a misclassification is a mystery rather than a one-line
 * fix to a named rule. Issue #9 persists these; this type is what it persists.
 *
 * @param category the assigned category, {@code UNCLASSIFIED} when nothing matched
 * @param rule the name of the rule that fired, or null when nothing matched
 * @param reason human-readable, sized for the spec's {@code VARCHAR(200)}
 */
public record Classification(Category category, String rule, String reason) {

	/** Matches the {@code reason} column width in spec §4. */
	public static final int MAX_REASON_LENGTH = 200;

	private static final Classification UNMATCHED = new Classification(Category.UNCLASSIFIED, null,
			"No rule matched the merchant or description.");

	public Classification {
		if (category == null) {
			throw new IllegalArgumentException("A classification needs a category.");
		}
		if (reason == null || reason.isBlank()) {
			throw new IllegalArgumentException("A classification needs a reason; it is what makes it auditable.");
		}
		if (reason.length() > MAX_REASON_LENGTH) {
			throw new IllegalArgumentException("Reason is %d characters; the column holds %d."
				.formatted(reason.length(), MAX_REASON_LENGTH));
		}
		// The two states are "a rule fired" and "nothing matched". Anything else
		// is a bug that would otherwise surface as an unattributable category.
		if ((category == Category.UNCLASSIFIED) != (rule == null)) {
			throw new IllegalArgumentException(
					"A classification either names the rule that fired or is UNCLASSIFIED; %s with rule %s is neither."
						.formatted(category, rule));
		}
	}

	static Classification from(ClassificationRule rule, MatchField field) {
		return new Classification(rule.category(), rule.name(),
				"%s matched rule %s.".formatted(field.getLabel(), rule.name()));
	}

	/**
	 * The result when no rule matched.
	 *
	 * <p>This is a real answer, not a failure. Spec §5: an unclassified expense
	 * is a prompt for the user to decide, and a wrong confident guess corrupts
	 * every report that reads it afterwards.
	 */
	public static Classification unmatched() {
		return UNMATCHED;
	}

	/** Whether no rule fired. Equivalent to {@code category() == UNCLASSIFIED}. */
	public boolean isUnmatched() {
		return this.rule == null;
	}

}
