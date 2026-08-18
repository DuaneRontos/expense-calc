package com.duanerontos.expensecalc.api;

import java.util.List;
import java.util.Map;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Does the whole thing actually work?
 *
 * <p>Every other suite proves a layer. This one boots the real application on a
 * real port against a real Postgres, with Flyway applying every migration, and
 * drives it over HTTP the way a client would — create an expense, watch the
 * rule engine classify it, list it, reclassify it, see the reports move,
 * delete it.
 *
 * <p>It exists because "each layer passes its tests" and "the service runs" are
 * different claims, and only one of them is what someone starting the app cares
 * about. It is also the closest thing to a smoke test a deployment has.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Import(TestcontainersConfiguration.class)
class BackendOperabilityTest {

	@Autowired
	private TestRestTemplate http;

	private static RequestEntity<Object> json(String method, String path, Object body) {
		return RequestEntity.method(org.springframework.http.HttpMethod.valueOf(method), path)
			.contentType(MediaType.APPLICATION_JSON)
			.body(body);
	}

	@Test
	@DisplayName("serves the taxonomy so a client never hardcodes it")
	void servesTheTaxonomy() {
		ResponseEntity<List<Map<String, String>>> response = this.http.exchange(
				RequestEntity.get("/api/v1/categories").build(),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).hasSize(11);
		// Declaration order, not alphabetical — the same order sort=category
		// produces, so a picker and a sorted list agree.
		assertThat(response.getBody().getFirst()).containsEntry("key", "HOUSING").containsEntry("label", "Housing");
		assertThat(response.getBody().getLast()).containsEntry("key", "UNCLASSIFIED");
	}

	@Test
	@DisplayName("carries one expense through create, classify, list, reclassify, report and delete")
	@SuppressWarnings("unchecked")
	void carriesAnExpenseThroughItsWholeLife() {
		// 1. Create. The rule engine should classify a Puregold purchase as
		//    groceries without anyone saying so.
		ResponseEntity<Map<String, Object>> created = this.http.exchange(
				json("POST", "/api/v1/expenses",
						Map.of("amount", "1234.56", "currency", "PHP", "occurredOn", "2026-01-15", "merchant",
								"Puregold", "description", "weekly shop")),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(created.getHeaders().getLocation()).isNotNull();
		String id = (String) created.getBody().get("id");

		assertThat(created.getBody()).containsEntry("category", "GROCERIES")
			// Money is a string on the wire, never a JSON number (spec §8).
			.containsEntry("amount", "1234.56")
			.containsEntry("currency", "PHP");

		List<Map<String, Object>> history = (List<Map<String, Object>>) created.getBody().get("classifications");
		assertThat(history).singleElement()
			.satisfies(record -> assertThat(record).containsEntry("source", "RULE_ENGINE"));

		// 2. List. The category is resolved in the query, not fetched per row.
		ResponseEntity<Map<String, Object>> listed = this.http.exchange(
				RequestEntity.get("/api/v1/expenses?category=GROCERIES&from=2026-01-01&to=2026-02-01").build(),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat((List<?>) listed.getBody().get("items")).hasSize(1);
		assertThat(listed.getBody()).containsEntry("totalItems", 1);

		// 3. Report. The expense should be in January's groceries bucket.
		ResponseEntity<Map<String, Object>> report = this.http.exchange(
				RequestEntity.get("/api/v1/reports/by-category?from=2026-01-01&to=2026-02-01").build(),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat(report.getBody()).containsEntry("total", "1234.56");
		assertThat((List<Map<String, Object>>) report.getBody().get("buckets")).singleElement()
			.satisfies(bucket -> assertThat(bucket).containsEntry("key", "GROCERIES")
				.containsEntry("total", "1234.56"));

		// 4. Reclassify. Appends; it must not overwrite the engine's record.
		ResponseEntity<Map<String, Object>> reclassified = this.http.exchange(
				json("POST", "/api/v1/expenses/" + id + "/classification",
						Map.of("category", "DINING", "reason", "it was a restaurant meal")),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat(reclassified.getBody()).containsEntry("category", "DINING");
		assertThat((List<?>) reclassified.getBody().get("classifications")).hasSize(2);

		// 5. The report follows the correction, because it reads the current
		//    category (the as-of read exists for reproducing a closed period).
		ResponseEntity<Map<String, Object>> afterReclassification = this.http.exchange(
				RequestEntity.get("/api/v1/reports/by-category?from=2026-01-01&to=2026-02-01").build(),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat((List<Map<String, Object>>) afterReclassification.getBody().get("buckets")).singleElement()
			.satisfies(bucket -> assertThat(bucket).containsEntry("key", "DINING"));

		// 6. Delete, and it is gone.
		this.http.delete("/api/v1/expenses/" + id);

		assertThat(this.http.getForEntity("/api/v1/expenses/" + id, String.class).getStatusCode())
			.isEqualTo(HttpStatus.NOT_FOUND);
	}

	@Test
	@DisplayName("refuses a currency other than PHP before it reaches the database")
	void refusesForeignCurrency() {
		// Spec §9.6: rejected at the API boundary, so no aggregation can ever
		// sum across currencies.
		ResponseEntity<Map<String, Object>> response = this.http.exchange(
				json("POST", "/api/v1/expenses",
						Map.of("amount", "10.00", "currency", "USD", "occurredOn", "2026-01-15")),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("title", "Invalid expense");
	}

	@Test
	@DisplayName("keeps a refund in the category it refunds, and nets the total")
	@SuppressWarnings("unchecked")
	void netsRefundsAgainstSpending() {
		// The rule this whole codebase is built around (issue #8), end to end.
		this.http.exchange(json("POST", "/api/v1/expenses", Map.of("amount", "2000.00", "currency", "PHP",
				"occurredOn", "2026-03-10", "merchant", "SM Supermarket")),
				new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
				});
		this.http.exchange(json("POST", "/api/v1/expenses", Map.of("amount", "-500.00", "currency", "PHP",
				"occurredOn", "2026-03-11", "merchant", "SM Supermarket", "description", "returned items")),
				new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
				});

		ResponseEntity<Map<String, Object>> report = this.http.exchange(
				RequestEntity.get("/api/v1/reports/by-category?from=2026-03-01&to=2026-04-01").build(),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});

		// Net, not gross: 2000 minus 500. Neither abs()'d nor filtered out.
		assertThat((List<Map<String, Object>>) report.getBody().get("buckets")).singleElement()
			.satisfies(bucket -> assertThat(bucket).containsEntry("key", "GROCERIES")
				.containsEntry("total", "1500.00"));
	}

	@Test
	@DisplayName("re-runs classification when the text changes, and not when it does not")
	@SuppressWarnings("unchecked")
	void reclassifiesOnTextChangeOnly() {
		ResponseEntity<Map<String, Object>> created = this.http.exchange(
				json("POST", "/api/v1/expenses", Map.of("amount", "300.00", "currency", "PHP", "occurredOn",
						"2026-04-01", "merchant", "Jollibee")),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});
		String id = (String) created.getBody().get("id");
		assertThat(created.getBody()).containsEntry("category", "DINING");

		// An amount edit is not a text change, so no record is appended: the
		// rule engine reads neither amount nor date as text.
		ResponseEntity<Map<String, Object>> amountEdited = this.http.exchange(
				json("PATCH", "/api/v1/expenses/" + id, Map.of("amount", "350.00")),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});
		assertThat((List<?>) amountEdited.getBody().get("classifications")).hasSize(1);
		assertThat(amountEdited.getBody()).containsEntry("amount", "350.00");

		// Changing the merchant is, so it reclassifies.
		ResponseEntity<Map<String, Object>> merchantEdited = this.http.exchange(
				json("PATCH", "/api/v1/expenses/" + id, Map.of("merchant", "Meralco")),
				new org.springframework.core.ParameterizedTypeReference<>() {
				});
		assertThat((List<?>) merchantEdited.getBody().get("classifications")).hasSize(2);
		assertThat(merchantEdited.getBody()).containsEntry("category", "UTILITIES");
	}

}
