package com.duanerontos.expensecalc.classification;

/**
 * An extra condition on the amount that a rule's text match must also satisfy.
 *
 * <p><b>A guard can only ever stop a rule from firing, never make one fire.</b>
 * That asymmetry is the whole point. Spec §5 allows amount to disambiguate
 * candidates that already matched on text and forbids it from determining a
 * category on its own, and a condition that is only ever consulted after a text
 * match — and can only subtract — cannot do the forbidden thing.
 *
 * <p>The motivating case is a gift. "Gift for mom" is money out and belongs in
 * {@code DISCRETIONARY}; "Gift from tita" is money in and belongs in
 * {@code INCOME}. Both match the same word, so the text alone cannot separate
 * them and neither can the amount — only the two together.
 *
 * <p>Amounts here are signed centavos, matching the storage convention in spec
 * §4: <b>negative is money in</b> — a refund, or income.
 *
 * <p>Deliberately an enum of directions rather than an arbitrary predicate. A
 * threshold guard ("over ₱10,000 is CAPITAL") would be legal under the letter of
 * the spec but is a bad idea in practice: it makes classification depend on how
 * expensive something was rather than what it was, and the boundary case is
 * always somebody's real expense.
 */
public enum AmountGuard {

	/** No condition. The rule fires on its text match alone. */
	ANY {
		@Override
		public boolean permits(long amountMinor) {
			return true;
		}
	},

	/** Money in: salary, interest, a refund. Stored negative. */
	MONEY_IN {
		@Override
		public boolean permits(long amountMinor) {
			return amountMinor < 0;
		}
	},

	/** Money out: an ordinary expense. Stored positive. */
	MONEY_OUT {
		@Override
		public boolean permits(long amountMinor) {
			return amountMinor > 0;
		}
	};

	/**
	 * Whether an amount satisfies this guard.
	 *
	 * <p>A zero amount is neither in nor out, so only {@link #ANY} permits it. A
	 * zero-amount expense described as "salary" is not income — it is a data
	 * entry mistake, and letting it fall through to {@code UNCLASSIFIED} surfaces
	 * it instead of filing it somewhere plausible.
	 *
	 * @param amountMinor signed centavos; negative is money in
	 */
	public abstract boolean permits(long amountMinor);

}
