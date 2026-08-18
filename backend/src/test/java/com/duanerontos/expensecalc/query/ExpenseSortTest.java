package com.duanerontos.expensecalc.query;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/**
 * The one part of the query that cannot be a bound parameter.
 */
class ExpenseSortTest {

	@ParameterizedTest
	@EnumSource(ExpenseSort.class)
	@DisplayName("always appends the id tiebreaker")
	void alwaysAppendsTheTiebreaker(ExpenseSort sort) {
		// Spec §6: without it, a page of identical values drops and duplicates
		// rows across page boundaries. Making it part of the fragment rather
		// than something a caller adds is what stops it being forgotten.
		assertThat(sort.orderBy(true)).endsWith("e.id ASC");
		assertThat(sort.orderBy(false)).endsWith("e.id ASC");
	}

	@ParameterizedTest
	@EnumSource(ExpenseSort.class)
	@DisplayName("sorts nulls last whichever direction is asked for")
	void sortsNullsLast(ExpenseSort sort) {
		assertThat(sort.orderBy(true)).contains("NULLS LAST");
		assertThat(sort.orderBy(false)).contains("NULLS LAST");
	}

	@ParameterizedTest
	@ValueSource(strings = { "occurredOn", "OCCURRED_ON", "occurredon", " occurredOn " })
	@DisplayName("accepts the spelling the spec uses as well as the enum's")
	void parsesTheApiSpelling(String field) {
		// Spec §6 writes the parameter as occurredOn; a client copying the spec
		// should not get a 400 for it.
		assertThat(ExpenseSort.parse(field)).isEqualTo(ExpenseSort.OCCURRED_ON);
	}

	@Test
	@DisplayName("names the alternatives when the field is unknown")
	void refusesAnUnknownField() {
		assertThatIllegalArgumentException().isThrownBy(() -> ExpenseSort.parse("createdAt"))
			.withMessageContaining("occurredOn, amount, merchant, or category");
	}

	@Test
	@DisplayName("sorts amount on the stored integer column")
	void sortsAmountOnTheStoredInteger() {
		// Spec §6: not a converted BigDecimal. A per-row conversion is a chance
		// for two requests to order the same rows differently.
		assertThat(ExpenseSort.AMOUNT.orderBy(true)).startsWith("e.amount_minor");
	}

	@ParameterizedTest
	@ValueSource(strings = { "occurredOn; DROP TABLE expense", "amount) OR 1=1 --", "e.id; SELECT 1" })
	@DisplayName("refuses request text outright rather than letting it reach a fragment")
	void refusesRequestTextAsAField(String hostile) {
		// The whole of the dynamic SQL surface is ORDER BY, and this is what
		// keeps it closed: a field name is matched against the enum's own
		// constants, so a request either selects one of them or is rejected.
		// Nothing from the request is ever concatenated.
		assertThatIllegalArgumentException().isThrownBy(() -> ExpenseSort.parse(hostile));
	}

	@ParameterizedTest
	@EnumSource(ExpenseSort.class)
	@DisplayName("emits one of a fixed set of fragments, whatever the direction")
	void emitsOnlyKnownFragments(ExpenseSort sort) {
		// Belt to the braces above: no statement terminator, no comment marker,
		// so a fragment cannot end the statement or hide the rest of it.
		assertThat(sort.orderBy(true)).doesNotContain(";").doesNotContain("--");
		assertThat(sort.orderBy(false)).doesNotContain(";").doesNotContain("--");
	}

}
