package com.duanerontos.expensecalc.auth;

import java.util.List;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CORS on the chain that actually ships.
 *
 * <p>{@code CorsTest} runs under {@code insecure-local}, where every request is
 * {@code permitAll} — so its preflight test cannot fail. An unauthenticated
 * {@code OPTIONS} returns 200 there whether or not {@code CorsFilter} runs
 * before authorization, which is the single fact the whole change depends on.
 * It was green for a reason unrelated to what it asserted.
 *
 * <p>This runs on the default, secured chain, with credentials supplied so the
 * application starts. Every assertion here would fail if the filter ordering
 * were wrong.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@TestPropertySource(properties = { "app.cors.allowed-origins=http://localhost:8081",
		"app.auth.username=dev", "app.auth.password-hash=not-a-real-hash",
		"app.auth.jwt-secret=a-signing-key-long-enough-to-satisfy-the-guard" })
@Import(TestcontainersConfiguration.class)
class CorsSecuredChainTest {

	private static final String ALLOWED = "http://localhost:8081";

	@Autowired
	private TestRestTemplate http;

	@Test
	@DisplayName("answers an unauthenticated preflight, so a mutation can be sent at all")
	void answersPreflightWithoutCredentials() {
		// The load-bearing claim. A PATCH carrying Authorization and JSON is
		// never simple, so the browser sends OPTIONS first — with no credential,
		// because a preflight never carries one. If that were authorized like a
		// normal request it would 401, and the PATCH would never leave the
		// browser.
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(ALLOWED);
		headers.setAccessControlRequestMethod(HttpMethod.PATCH);
		headers.setAccessControlRequestHeaders(List.of(HttpHeaders.AUTHORIZATION, HttpHeaders.CONTENT_TYPE));

		ResponseEntity<String> response = this.http.exchange("/api/v1/expenses/any-id", HttpMethod.OPTIONS,
				new HttpEntity<>(headers), String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED);
	}

	@Test
	@DisplayName("a 401 still names the origin, or the client cannot see it to refresh")
	void unauthorizedResponseIsReadable() {
		// A browser hands JavaScript nothing from a cross-origin response it was
		// not told it may read — including the status. The client's refresh flow
		// is triggered by observing a 401, so a 401 the browser hides is a
		// session that cannot renew itself.
		ResponseEntity<String> response = get("/api/v1/categories");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED);
	}

	@Test
	@DisplayName("the sign-in preflight is answered, which is where a session starts")
	void answersLoginPreflight() {
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(ALLOWED);
		headers.setAccessControlRequestMethod(HttpMethod.POST);
		headers.setAccessControlRequestHeaders(List.of(HttpHeaders.CONTENT_TYPE));

		ResponseEntity<String> response = this.http.exchange("/api/v1/auth/login", HttpMethod.OPTIONS,
				new HttpEntity<>(headers), String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	@DisplayName("refuses a preflight asking for a header the allowlist does not name")
	void refusesUnlistedHeader() {
		// Proves the allowlist is doing something rather than echoing whatever
		// was asked for.
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(ALLOWED);
		headers.setAccessControlRequestMethod(HttpMethod.GET);
		headers.setAccessControlRequestHeaders(List.of("X-Requested-With"));

		ResponseEntity<String> response = this.http.exchange("/api/v1/categories", HttpMethod.OPTIONS,
				new HttpEntity<>(headers), String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
	}

	@Test
	@DisplayName("exposes Location on the response that actually carries one")
	void exposesLocationOnCreate() {
		// The previous version asserted this on GET /categories, which never
		// sends a Location — proving the configured value was echoed rather than
		// that a client can follow the expense it just created. This uses the
		// 201 path. Unauthenticated, so it stops at 401 — but the CORS headers
		// are attached by a filter that runs first, which is the point.
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(ALLOWED);
		headers.setContentType(MediaType.APPLICATION_JSON);

		ResponseEntity<String> response = this.http.exchange("/api/v1/expenses", HttpMethod.POST,
				new HttpEntity<>("{\"amount\":\"1.00\",\"currency\":\"PHP\",\"occurredOn\":\"2026-08-01\"}", headers),
				String.class);

		assertThat(response.getHeaders().getAccessControlExposeHeaders()).contains(HttpHeaders.LOCATION);
	}

	private ResponseEntity<String> get(String path) {
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(ALLOWED);
		return this.http.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), String.class);
	}

}
