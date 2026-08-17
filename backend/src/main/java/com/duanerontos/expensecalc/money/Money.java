package com.duanerontos.expensecalc.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * Conversion between the minor units we store and the {@link BigDecimal}
 * amounts the service boundary exposes.
 *
 * <p>Per spec §4, amounts persist as signed integer centavos and surface as
 * {@code BigDecimal}. Keeping the arithmetic in integers means summation over a
 * large expense set is exact and scale never drifts. This class is the only
 * place that crosses between the two representations — a second conversion
 * written inline somewhere else is how a 100x error gets in.
 *
 * <p>There is deliberately no {@code double} anywhere in this file, including
 * intermediates.
 */
public final class Money {

	/** v1 is Philippine Peso only — spec §4 and §9.6. */
	public static final String CURRENCY_CODE = "PHP";

	/** PHP's minor unit is the centavo: two decimal places. */
	public static final int MINOR_UNIT_SCALE = 2;

	private Money() {
	}

	/**
	 * Widens stored centavos to pesos, e.g. {@code 123456} to {@code 1234.56}.
	 * Always exact — no rounding is possible in this direction.
	 */
	public static BigDecimal toMajorUnits(long minorUnits) {
		return BigDecimal.valueOf(minorUnits, MINOR_UNIT_SCALE);
	}

	/**
	 * Narrows pesos to stored centavos, e.g. {@code 1234.56} to {@code 123456}.
	 *
	 * <p>Rejects anything finer than a centavo rather than rounding it. Silent
	 * rounding here would discard money the user actually entered, and the loss
	 * is invisible until someone reconciles against a bank statement. A caller
	 * that genuinely wants to round must say so explicitly first.
	 *
	 * @throws IllegalArgumentException if the amount carries sub-centavo
	 *     precision, or does not fit in a {@code long}
	 */
	public static long toMinorUnits(BigDecimal majorUnits) {
		Objects.requireNonNull(majorUnits, "amount must not be null");

		BigDecimal exact;
		try {
			exact = majorUnits.setScale(MINOR_UNIT_SCALE, RoundingMode.UNNECESSARY);
		}
		catch (ArithmeticException ex) {
			throw new IllegalArgumentException(
					"Amount %s carries more precision than a centavo. Round it explicitly before converting rather than letting the conversion discard it silently."
						.formatted(majorUnits.toPlainString()),
					ex);
		}

		try {
			return exact.movePointRight(MINOR_UNIT_SCALE).longValueExact();
		}
		catch (ArithmeticException ex) {
			throw new IllegalArgumentException(
					"Amount %s does not fit in a 64-bit centavo value.".formatted(majorUnits.toPlainString()), ex);
		}
	}

	/**
	 * Enforces the single-currency rule at the domain boundary.
	 *
	 * <p>Comparison is exact rather than case-insensitive: ISO 4217 codes are
	 * uppercase, and quietly accepting {@code "php"} would mean the value stored
	 * differs from the value sent, which is its own small class of bug.
	 *
	 * @throws UnsupportedCurrencyException if the code is anything but {@code PHP}
	 */
	public static void requireSupportedCurrency(String currencyCode) {
		if (!CURRENCY_CODE.equals(currencyCode)) {
			throw new UnsupportedCurrencyException(currencyCode);
		}
	}

}
