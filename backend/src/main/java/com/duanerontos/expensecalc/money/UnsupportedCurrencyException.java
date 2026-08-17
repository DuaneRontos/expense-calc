package com.duanerontos.expensecalc.money;

/**
 * Raised when an amount arrives in a currency v1 does not support.
 *
 * <p>A distinct type rather than a bare {@link IllegalArgumentException} so the
 * web layer can map it to a 400 without string-matching a message. Spec §9.6
 * requires rejection at the API boundary, before persistence, so that no
 * aggregation can ever sum across currencies.
 */
public class UnsupportedCurrencyException extends RuntimeException {

	private final String currencyCode;

	public UnsupportedCurrencyException(String currencyCode) {
		super("Currency %s is not supported. v1 handles %s only."
			.formatted(currencyCode == null ? "<null>" : currencyCode, Money.CURRENCY_CODE));
		this.currencyCode = currencyCode;
	}

	/** The rejected code, for the error response's field detail. May be null. */
	public String getCurrencyCode() {
		return this.currencyCode;
	}

}
