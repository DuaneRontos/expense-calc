package com.duanerontos.expensecalc.report;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The HTTP contract of {@code /reports/by-category} (spec §7, §8).
 *
 * <p>No database: the aggregation is proven in {@link ReportRepositoryTest}
 * against a real Postgres, and what is left to check here is the wire — that
 * money is a string, that an empty period is a 200, and that the period
 * parameters bind the way the spec's half-open range expects.
 */
@WebMvcTest(ReportController.class)
class ReportControllerTest {

	private static final ReportPeriod JANUARY = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1));

	@Autowired
	private MockMvc mvc;

	@MockitoBean
	private ReportService reports;

	@Test
	@DisplayName("serves money as JSON strings, not numbers")
	void servesMoneyAsStrings() throws Exception {
		// The assertion that matters most on this endpoint. A JSON number is a
		// double once JavaScript parses it, and 18420.00 would come back as
		// 18420 — the client then formats a value the backend never sent.
		given(this.reports.byCategory(any())).willReturn(CategoryBreakdown.of(JANUARY,
				List.of(new CategoryTotal(com.duanerontos.expensecalc.expense.Category.GROCERIES, 1_842_000L))));

		this.mvc.perform(get("/api/v1/reports/by-category").param("from", "2026-01-01").param("to", "2026-02-01"))
			.andExpect(status().isOk())
			.andExpect(content().contentTypeCompatibleWith("application/json"))
			.andExpect(jsonPath("$.total").value("18420.00"))
			.andExpect(jsonPath("$.currency").value("PHP"))
			.andExpect(jsonPath("$.buckets[0].key").value("GROCERIES"))
			.andExpect(jsonPath("$.buckets[0].label").value("Groceries"))
			.andExpect(jsonPath("$.buckets[0].total").value("18420.00"))
			// Spec §7 defines this shape with four keys. isEmpty() was being
			// picked up as a bean property and serialised a fifth.
			.andExpect(jsonPath("$.empty").doesNotExist());
	}

	@Test
	@DisplayName("answers an empty period with 200 and no buckets")
	void answersEmptyPeriodsWithOk() throws Exception {
		// Spec §7: "Empty periods return an empty bucket array, not 404." A 404
		// would make the client render an error where it should render an empty
		// state, and "no spending in March" is a real answer.
		given(this.reports.byCategory(any())).willReturn(CategoryBreakdown.of(JANUARY, List.of()));

		this.mvc.perform(get("/api/v1/reports/by-category").param("from", "2026-01-01").param("to", "2026-02-01"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.buckets").isEmpty())
			.andExpect(jsonPath("$.total").value("0.00"));
	}

	@Test
	@DisplayName("passes the requested period through unchanged")
	void passesThePeriodThrough() throws Exception {
		given(this.reports.byCategory(any())).willReturn(CategoryBreakdown.of(JANUARY, List.of()));

		this.mvc.perform(get("/api/v1/reports/by-category").param("from", "2026-01-01").param("to", "2026-02-01"))
			.andExpect(status().isOk());

		verify(this.reports).byCategory(JANUARY);
	}

	@Test
	@DisplayName("defaults to the period the service decides, not one it builds itself")
	void defaultsToTheCurrentMonth() throws Exception {
		// The default belongs to the service, which owns both the clock and the
		// zone. A controller assembling a period from a zone it fetched is doing
		// the service's job with the service's data.
		given(this.reports.defaultPeriod()).willReturn(JANUARY);
		given(this.reports.byCategory(any())).willReturn(CategoryBreakdown.of(JANUARY, List.of()));

		this.mvc.perform(get("/api/v1/reports/by-category")).andExpect(status().isOk());

		verify(this.reports).defaultPeriod();
		verify(this.reports).byCategory(JANUARY);
	}

	@Test
	@DisplayName("serves over-time buckets with money as strings")
	void servesOverTime() throws Exception {
		given(this.reports.overTime(any(), any())).willReturn(SpendOverTime.of(JANUARY, TimeBucket.MONTH,
				java.util.Map.of(LocalDate.of(2026, 1, 1), 150_000L)));

		this.mvc
			.perform(get("/api/v1/reports/over-time").param("from", "2026-01-01")
				.param("to", "2026-02-01")
				.param("bucket", "MONTH"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.bucket").value("MONTH"))
			.andExpect(jsonPath("$.buckets[0].key").value("2026-01-01"))
			.andExpect(jsonPath("$.buckets[0].label").value("Jan 2026"))
			.andExpect(jsonPath("$.buckets[0].total").value("1500.00"))
			.andExpect(jsonPath("$.total").value("1500.00"));
	}

	@Test
	@DisplayName("defaults the over-time slice to a month")
	void defaultsBucketToMonth() throws Exception {
		given(this.reports.overTime(any(), any())).willReturn(SpendOverTime.of(JANUARY, TimeBucket.MONTH,
				java.util.Map.of()));

		this.mvc.perform(get("/api/v1/reports/over-time").param("from", "2026-01-01").param("to", "2026-02-01"))
			.andExpect(status().isOk());

		verify(this.reports).overTime(JANUARY, TimeBucket.MONTH);
	}

	@Test
	@DisplayName("refuses a slice width that is not day, week or month, as problem+json")
	void refusesAnUnknownBucket() throws Exception {
		// The previous version asserted only is4xxClientError, which passed
		// whether the 400 came from our handler or from Spring's converter —
		// so it could not see that the response was a plainer 400 than spec §8
		// asks for, nor that lowercase was being rejected too.
		this.mvc
			.perform(get("/api/v1/reports/over-time").param("from", "2026-01-01")
				.param("to", "2026-02-01")
				.param("bucket", "FORTNIGHT"))
			.andExpect(status().isBadRequest())
			.andExpect(content().contentTypeCompatibleWith("application/problem+json"))
			.andExpect(jsonPath("$.violations[0].field").value("bucket"));
	}

	@ParameterizedTest
	@ValueSource(strings = { "day", "week", "month", "DAY", "Month" })
	@DisplayName("accepts the slice width in the case the documentation uses")
	void acceptsAnyCaseOfBucket(String bucket) throws Exception {
		// The javadoc documented bucket=day|week|month while only the uppercase
		// form bound, so a client written against the documentation got a 400
		// on its first request. Every test used MONTH, so nothing noticed.
		given(this.reports.overTime(any(), any()))
			.willReturn(SpendOverTime.of(JANUARY, TimeBucket.MONTH, java.util.Map.of()));

		this.mvc
			.perform(get("/api/v1/reports/over-time").param("from", "2026-01-01")
				.param("to", "2026-02-01")
				.param("bucket", bucket))
			.andExpect(status().isOk());
	}

	@Test
	@DisplayName("refuses a window that would return more buckets than a response may carry")
	void refusesAnUnboundedWindow() throws Exception {
		// Spec §6: no endpoint returns an unbounded result set. Zero-filling
		// made this one unbounded through the response rather than the query —
		// two centuries of days is 73,049 buckets and 4.2 MB, from an empty
		// database.
        this.mvc
			.perform(get("/api/v1/reports/over-time").param("from", "1900-01-01")
				.param("to", "2100-01-01")
				.param("bucket", "day"))
			.andExpect(status().isBadRequest())
			.andExpect(content().contentTypeCompatibleWith("application/problem+json"))
			.andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("widen the slice")))
			.andExpect(jsonPath("$.violations[0].field").value("from"));
	}

	@Test
	@DisplayName("still serves a year of days, which is inside the cap")
	void servesAYearOfDays() throws Exception {
		given(this.reports.overTime(any(), any()))
			.willReturn(SpendOverTime.of(JANUARY, TimeBucket.DAY, java.util.Map.of()));

		this.mvc
			.perform(get("/api/v1/reports/over-time").param("from", "2026-01-01")
				.param("to", "2027-01-01")
				.param("bucket", "day"))
			.andExpect(status().isOk());
	}

	@Test
	@DisplayName("serves a comparison with both periods on each row")
	void servesComparison() throws Exception {
		ReportPeriod march = ReportPeriod.monthOf(LocalDate.of(2026, 3, 1));
		given(this.reports.compare(any())).willReturn(PeriodComparison.of(march, march.previous(),
				List.of(new CategoryTotal(com.duanerontos.expensecalc.expense.Category.GROCERIES, 500_000L)),
				List.of(new CategoryTotal(com.duanerontos.expensecalc.expense.Category.GROCERIES, 420_000L))));

		this.mvc.perform(get("/api/v1/reports/compare").param("from", "2026-03-01").param("to", "2026-04-01"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.current.from").value("2026-03-01"))
			.andExpect(jsonPath("$.previous.from").value("2026-02-01"))
			.andExpect(jsonPath("$.buckets[0].current").value("5000.00"))
			.andExpect(jsonPath("$.buckets[0].previous").value("4200.00"))
			.andExpect(jsonPath("$.buckets[0].change").value("800.00"));
	}

	@Test
	@DisplayName("applies the both-or-neither rule to every report, not just one")
	void appliesThePeriodRuleEverywhere() throws Exception {
		// The three endpoints share one helper; this is what stops a future
		// fourth endpoint quietly reintroducing the guess.
		for (String path : List.of("by-category", "over-time", "compare")) {
			this.mvc.perform(get("/api/v1/reports/" + path).param("from", "2026-01-01"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.violations[0].field").value("to"));
		}
	}

	@Test
	@DisplayName("refuses one bound without the other rather than guessing")
	void refusesAHalfSpecifiedPeriod() throws Exception {
		// "January to unspecified" reads as either "to now" or "to end of
		// January". Guessing produces a report that is wrong without looking
		// wrong, which is the failure this endpoint can least afford.
		this.mvc.perform(get("/api/v1/reports/by-category").param("from", "2026-01-01"))
			.andExpect(status().isBadRequest())
			// Spec §8: RFC 7807, with field-level violations the client can
			// surface inline against the offending input rather than in a toast.
			.andExpect(content().contentTypeCompatibleWith("application/problem+json"))
			.andExpect(jsonPath("$.title").value("Invalid reporting period"))
			.andExpect(jsonPath("$.detail").isNotEmpty())
			.andExpect(jsonPath("$.violations[0].field").value("to"));

		this.mvc.perform(get("/api/v1/reports/by-category").param("to", "2026-02-01"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.violations[0].field").value("from"));
	}

	@Test
	@DisplayName("reports an inverted period as a 400 rather than a 500")
	void refusesAnInvertedPeriod() throws Exception {
		// ReportPeriod's own constructor rejects this. Without the handler it
		// would surface as a servlet failure — a 500 blaming the server for
		// something the caller sent.
		this.mvc
			.perform(get("/api/v1/reports/by-category").param("from", "2026-02-01").param("to", "2026-01-01"))
			.andExpect(status().isBadRequest())
			.andExpect(content().contentTypeCompatibleWith("application/problem+json"))
			.andExpect(jsonPath("$.detail").isNotEmpty());
	}

}
