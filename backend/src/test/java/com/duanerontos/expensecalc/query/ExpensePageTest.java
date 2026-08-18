package com.duanerontos.expensecalc.query;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Page arithmetic and the size cap (spec §6).
 */
class ExpensePageTest {

	@ParameterizedTest
	@CsvSource({ "1, 1", "50, 50", "200, 200", "201, 200", "5000, 200" })
	@DisplayName("clamps an oversized request rather than refusing it")
	void clampsOversizedRequests(int requested, int expected) {
		// A client asking for 500 wants as many as it can have, and the
		// response reports what was applied so it can tell. A 400 would be
		// defensible and annoying.
		assertThat(ExpensePage.clampSize(requested)).isEqualTo(expected);
	}

	@ParameterizedTest
	@CsvSource({ "0", "-1", "-200" })
	@DisplayName("falls back to the default for a nonsensical size")
	void fallsBackForNonsense(int requested) {
		// Honouring zero would return an empty page forever, which reads as
		// "no expenses" rather than as a malformed request.
		assertThat(ExpensePage.clampSize(requested)).isEqualTo(ExpensePage.DEFAULT_SIZE);
	}

	@Test
	@DisplayName("defaults the size when none is given")
	void defaultsWhenAbsent() {
		assertThat(ExpensePage.clampSize(null)).isEqualTo(50);
	}

	@ParameterizedTest
	@CsvSource({ "0, 50, 1", "1, 50, 1", "50, 50, 1", "51, 50, 2", "100, 50, 2", "101, 50, 3" })
	@DisplayName("counts pages so the last partial page is included")
	void countsPages(long totalItems, int size, int expectedPages) {
		assertThat(ExpensePage.of(List.of(), 0, size, totalItems).totalPages()).isEqualTo(expectedPages);
	}

	@Test
	@DisplayName("reports one page for an empty result, not zero")
	void reportsOnePageWhenEmpty() {
		// "Page 1 of 0" is a pager that cannot render itself.
		ExpensePage page = ExpensePage.of(List.of(), 0, 50, 0);

		assertThat(page.totalPages()).isEqualTo(1);
		assertThat(page.totalItems()).isZero();
		assertThat(page.items()).isEmpty();
	}

}
