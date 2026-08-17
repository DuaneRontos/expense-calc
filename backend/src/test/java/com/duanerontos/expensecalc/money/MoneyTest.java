package com.duanerontos.expensecalc.money;

import java.math.BigDecimal;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.assertj.core.api.Assertions.assertThatNoException;

/**
 * These are deliberately plain unit tests with no Spring context and no
 * database. Money arithmetic is the highest-risk logic in the system and should
 * be provable without Docker running.
 */
class MoneyTest {

	@ParameterizedTest(name = "{0} centavos is {1} pesos")
	@CsvSource({ "0, 0.00", "1, 0.01", "99, 0.99", "100, 1.00", "123456, 1234.56", "4825075, 48250.75" })
	@DisplayName("widens centavos to pesos exactly")
	void widensToMajorUnits(long minor, String expected) {
		assertThat(Money.toMajorUnits(minor)).isEqualByComparingTo(expected);
	}

	@ParameterizedTest(name = "{0} pesos is {1} centavos")
	@CsvSource({ "0.00, 0", "0.01, 1", "1.00, 100", "1234.56, 123456", "48250.75, 4825075" })
	@DisplayName("narrows pesos to centavos exactly")
	void narrowsToMinorUnits(String major, long expected) {
		assertThat(Money.toMinorUnits(new BigDecimal(major))).isEqualTo(expected);
	}

	@ParameterizedTest(name = "refund of {0} centavos survives the round trip")
	@ValueSource(longs = { -1, -100, -61240, -4825075, Long.MIN_VALUE + 1 })
	@DisplayName("carries negative amounts, which are refunds")
	void carriesRefunds(long minor) {
		BigDecimal asPesos = Money.toMajorUnits(minor);

		assertThat(asPesos).isNegative();
		assertThat(Money.toMinorUnits(asPesos)).isEqualTo(minor);
	}

	@ParameterizedTest
	@ValueSource(longs = { 0, 1, -1, 100, -100, 123456, -4825075, 999999999999L })
	@DisplayName("round-trips centavos unchanged in both directions")
	void roundTripsExactly(long minor) {
		assertThat(Money.toMinorUnits(Money.toMajorUnits(minor))).isEqualTo(minor);
	}

	@Test
	@DisplayName("accepts amounts written with fewer decimals than a centavo")
	void acceptsCoarserScale() {
		// No precision is lost widening 1.5 to 1.50, so this must not be rejected.
		assertThat(Money.toMinorUnits(new BigDecimal("1.5"))).isEqualTo(150L);
		assertThat(Money.toMinorUnits(new BigDecimal("7"))).isEqualTo(700L);
	}

	@ParameterizedTest(name = "rejects {0} rather than rounding it")
	@ValueSource(strings = { "0.001", "1.234", "1234.565", "-0.005" })
	@DisplayName("refuses sub-centavo precision instead of silently rounding")
	void refusesSubCentavoPrecision(String major) {
		// Rounding here would discard money the user actually entered, and the
		// loss stays invisible until someone reconciles against a statement.
		assertThatExceptionOfType(IllegalArgumentException.class)
			.isThrownBy(() -> Money.toMinorUnits(new BigDecimal(major)))
			.withMessageContaining("more precision than a centavo");
	}

	@Test
	@DisplayName("refuses amounts too large for a 64-bit centavo value")
	void refusesOverflow() {
		BigDecimal tooLarge = new BigDecimal("1E+30");

		assertThatExceptionOfType(IllegalArgumentException.class).isThrownBy(() -> Money.toMinorUnits(tooLarge))
			.withMessageContaining("does not fit");
	}

	@Test
	@DisplayName("rejects a null amount rather than treating it as zero")
	void rejectsNullAmount() {
		assertThatExceptionOfType(NullPointerException.class).isThrownBy(() -> Money.toMinorUnits(null));
	}

	@Test
	@DisplayName("accepts PHP")
	void acceptsPhp() {
		assertThatNoException().isThrownBy(() -> Money.requireSupportedCurrency("PHP"));
	}

	@ParameterizedTest(name = "rejects currency {0}")
	@ValueSource(strings = { "USD", "EUR", "JPY", "php", "Php", "", " PHP" })
	@DisplayName("rejects every currency but PHP, including differently-cased PHP")
	void rejectsOtherCurrencies(String code) {
		// Case-insensitive acceptance would mean the stored value differs from
		// the value sent, which is its own small class of bug.
		assertThatExceptionOfType(UnsupportedCurrencyException.class)
			.isThrownBy(() -> Money.requireSupportedCurrency(code));
	}

	@Test
	@DisplayName("rejects a null currency without throwing NullPointerException")
	void rejectsNullCurrency() {
		assertThatExceptionOfType(UnsupportedCurrencyException.class)
			.isThrownBy(() -> Money.requireSupportedCurrency(null))
			.withMessageContaining("<null>");
	}

}
