package com.duanerontos.expensecalc.expense;

import java.math.BigDecimal;
import java.time.LocalDate;

import com.duanerontos.expensecalc.money.UnsupportedCurrencyException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

/**
 * Construction-time rules for {@link Expense}, with no Spring context and no
 * database — the point being that an unsupported currency never reaches either.
 */
class ExpenseTest {

	private static final LocalDate WHEN = LocalDate.of(2026, 1, 15);

	@Test
	@DisplayName("stores the amount as centavos and exposes it back as pesos")
	void storesMinorUnitsAndExposesMajor() {
		Expense expense = Expense.record(new BigDecimal("1234.56"), "PHP", WHEN, "Puregold", "weekly groceries");

		assertThat(expense.getAmountMinor()).isEqualTo(123456L);
		assertThat(expense.getAmount()).isEqualByComparingTo("1234.56");
	}

	@Test
	@DisplayName("keeps a refund negative rather than normalising it")
	void keepsRefundsNegative() {
		Expense refund = Expense.record(new BigDecimal("-612.40"), "PHP", WHEN, "Puregold", "returned items");

		assertThat(refund.getAmountMinor()).isEqualTo(-61240L);
		assertThat(refund.getAmount()).isEqualByComparingTo("-612.40");
	}

	@ParameterizedTest(name = "currency {0} is rejected outright")
	@ValueSource(strings = { "USD", "EUR", "php", "" })
	@DisplayName("rejects an unsupported currency before the object can exist")
	void rejectsUnsupportedCurrencyBeforeConstruction(String code) {
		// This is the "before persistence" guarantee in issue #5: there is no
		// route to the repository, because there is no object to save. The
		// check runs ahead of amount conversion too, so a request that is wrong
		// in both respects reports the currency rather than the precision.
		assertThatExceptionOfType(UnsupportedCurrencyException.class)
			.isThrownBy(() -> Expense.record(new BigDecimal("100.005"), code, WHEN, "Somewhere", null));
	}

	@Test
	@DisplayName("gives every expense its own id")
	void assignsDistinctIds() {
		Expense one = Expense.record(BigDecimal.TEN, "PHP", WHEN, null, null);
		Expense two = Expense.record(BigDecimal.TEN, "PHP", WHEN, null, null);

		assertThat(one.getId()).isNotNull().isNotEqualTo(two.getId());
	}

	@Test
	@DisplayName("requires a date, since reporting periods key on it")
	void requiresOccurredOn() {
		assertThatExceptionOfType(NullPointerException.class)
			.isThrownBy(() -> Expense.record(BigDecimal.ONE, "PHP", null, null, null));
	}

	@Test
	@DisplayName("allows a null merchant and description")
	void allowsOptionalText() {
		Expense expense = Expense.record(new BigDecimal("50.00"), "PHP", WHEN, null, null);

		assertThat(expense.getMerchant()).isNull();
		assertThat(expense.getDescription()).isNull();
	}

}
