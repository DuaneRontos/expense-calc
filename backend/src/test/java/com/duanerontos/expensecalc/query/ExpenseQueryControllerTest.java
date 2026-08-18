package com.duanerontos.expensecalc.query;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.duanerontos.expensecalc.expense.Category;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The HTTP contract of {@code GET /expenses} (spec §6, §8).
 *
 * <p>No database: the query itself is proven in {@link ExpenseQueryRepositoryTest}
 * against a real Postgres. What is left here is parameter binding and the wire
 * format, which is where a spec-reading client actually gets stuck.
 */
@WebMvcTest(ExpenseQueryController.class)
class ExpenseQueryControllerTest {

	private static final ExpensePage EMPTY = ExpensePage.of(List.of(), 0, 50, 0);

	@Autowired
	private MockMvc mvc;

	@MockitoBean
	private ExpenseQueryService expenses;

	@Test
	@DisplayName("serves money as strings and the category with its label")
	void servesRows() throws Exception {
		given(this.expenses.list(any(), any(), anyBoolean(), anyInt(), any()))
			.willReturn(ExpensePage.of(List.of(new ExpenseSummary(UUID.randomUUID(), "1234.56", "PHP",
					LocalDate.of(2026, 1, 15), "Puregold", "weekly shop", "GROCERIES", "Groceries")), 0, 50, 1));

		this.mvc.perform(get("/api/v1/expenses"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[0].amount").value("1234.56"))
			.andExpect(jsonPath("$.items[0].category").value("GROCERIES"))
			.andExpect(jsonPath("$.items[0].categoryLabel").value("Groceries"))
			.andExpect(jsonPath("$.totalItems").value(1))
			.andExpect(jsonPath("$.totalPages").value(1));
	}

	@Test
	@DisplayName("defaults to occurredOn descending, page 0, size 50")
	void appliesTheDefaults() throws Exception {
		given(this.expenses.list(any(), any(), anyBoolean(), anyInt(), any())).willReturn(EMPTY);

		this.mvc.perform(get("/api/v1/expenses")).andExpect(status().isOk());

		verify(this.expenses).list(any(), org.mockito.ArgumentMatchers.eq(ExpenseSort.OCCURRED_ON),
				org.mockito.ArgumentMatchers.eq(true), org.mockito.ArgumentMatchers.eq(0), any());
	}

	@Test
	@DisplayName("binds every filter the spec lists")
	void bindsEveryFilter() throws Exception {
		given(this.expenses.list(any(), any(), anyBoolean(), anyInt(), any())).willReturn(EMPTY);

		this.mvc
			.perform(get("/api/v1/expenses").param("category", "GROCERIES")
				.param("category", "DINING")
				.param("from", "2026-01-01")
				.param("to", "2026-02-01")
				.param("merchant", "puregold")
				.param("q", "weekly")
				.param("minAmount", "10.00")
				.param("maxAmount", "5000.00"))
			.andExpect(status().isOk());

		ArgumentCaptor<ExpenseFilter> filter = ArgumentCaptor.forClass(ExpenseFilter.class);
		verify(this.expenses).list(filter.capture(), any(), anyBoolean(), anyInt(), any());

		assertThat(filter.getValue().categories()).containsExactlyInAnyOrder(Category.GROCERIES, Category.DINING);
		assertThat(filter.getValue().from()).isEqualTo(LocalDate.of(2026, 1, 1));
		assertThat(filter.getValue().to()).isEqualTo(LocalDate.of(2026, 2, 1));
		assertThat(filter.getValue().merchant()).isEqualTo("puregold");
		assertThat(filter.getValue().text()).isEqualTo("weekly");
		// Decimal strings become centavos at the boundary, so the query
		// compares integers.
		assertThat(filter.getValue().minAmountMinor()).isEqualTo(1_000L);
		assertThat(filter.getValue().maxAmountMinor()).isEqualTo(500_000L);
	}

	@Test
	@DisplayName("accepts a negative amount bound, because a refund is negative")
	void acceptsNegativeAmountBounds() throws Exception {
		given(this.expenses.list(any(), any(), anyBoolean(), anyInt(), any())).willReturn(EMPTY);

		this.mvc.perform(get("/api/v1/expenses").param("maxAmount", "-0.01")).andExpect(status().isOk());

		ArgumentCaptor<ExpenseFilter> filter = ArgumentCaptor.forClass(ExpenseFilter.class);
		verify(this.expenses).list(filter.capture(), any(), anyBoolean(), anyInt(), any());

		assertThat(filter.getValue().maxAmountMinor()).isEqualTo(-1L);
	}

	@Test
	@DisplayName("parses sort as field,dir in either direction")
	void parsesSort() throws Exception {
		given(this.expenses.list(any(), any(), anyBoolean(), anyInt(), any())).willReturn(EMPTY);

		this.mvc.perform(get("/api/v1/expenses").param("sort", "amount,asc")).andExpect(status().isOk());

		verify(this.expenses).list(any(), org.mockito.ArgumentMatchers.eq(ExpenseSort.AMOUNT),
				org.mockito.ArgumentMatchers.eq(false), anyInt(), any());
	}

	@Test
	@DisplayName("rejects an unknown sort field as problem+json")
	void rejectsAnUnknownSortField() throws Exception {
		this.mvc.perform(get("/api/v1/expenses").param("sort", "createdAt,desc"))
			.andExpect(status().isBadRequest())
			.andExpect(content().contentTypeCompatibleWith("application/problem+json"))
			.andExpect(jsonPath("$.violations[0].field").value("sort"));
	}

	@Test
	@DisplayName("rejects an unknown category and says where to find the list")
	void rejectsAnUnknownCategory() throws Exception {
		this.mvc.perform(get("/api/v1/expenses").param("category", "TRAVEL"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.violations[0].field").value("category"))
			.andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("/api/v1/categories")));
	}

	@Test
	@DisplayName("rejects an amount finer than a centavo rather than rounding it")
	void rejectsSubCentavoAmounts() throws Exception {
		// A filter bound the server quietly moved returns rows the caller did
		// not ask for.
		this.mvc.perform(get("/api/v1/expenses").param("minAmount", "10.005"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.violations[0].field").value("minAmount"));
	}

	@Test
	@DisplayName("rejects an inverted date range")
	void rejectsAnInvertedRange() throws Exception {
		this.mvc.perform(get("/api/v1/expenses").param("from", "2026-02-01").param("to", "2026-01-01"))
			.andExpect(status().isBadRequest())
			.andExpect(content().contentTypeCompatibleWith("application/problem+json"));
	}

}
