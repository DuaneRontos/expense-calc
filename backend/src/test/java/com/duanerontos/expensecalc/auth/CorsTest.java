package com.duanerontos.expensecalc.auth;

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
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CORS, which the web target cannot work without (issue #58).
 *
 * <p>The gap shipped because nothing here is visible to the clients that were
 * being tested. iOS and Android send no {@code Origin} header and are not
 * subject to the policy; {@code curl} sends none either unless told to, so every
 * example in {@code docs/RUNNING-LOCALLY.md} passed throughout. The failure
 * existed only in a browser, and only once one actually called the API.
 *
 * <p>Every test here therefore sends an {@code Origin} header. Without one the
 * server answers normally and proves nothing.
 *
 * <p>These run under {@code insecure-local}, which is the profile the local web
 * client uses. {@code CorsSecuredChainTest} covers the chain that ships — and it
 * has to, because {@code permitAll} here means an unauthenticated preflight
 * would return 200 whether or not the filter ordering were right.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@ActiveProfiles(SecurityStartupGuard.INSECURE_PROFILE)
@TestPropertySource(properties = "app.cors.allowed-origins=http://localhost:8081")
@Import(TestcontainersConfiguration.class)
class CorsTest {

	private static final String ALLOWED = "http://localhost:8081";

	private static final String FOREIGN = "http://evil.example";

	@Autowired
	private TestRestTemplate http;

	@Test
	@DisplayName("names the configured origin, which is what the browser checks")
	void allowsConfiguredOrigin() {
		ResponseEntity<String> response = get("/api/v1/categories", ALLOWED);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED);
	}

	@Test
	@DisplayName("refuses an origin nobody configured")
	void refusesForeignOrigin() {
		// 403 from Spring Security's CorsFilter. The browser would have refused
		// the response even on a 200, since the header naming the origin is
		// absent — but rejecting outright means the request never reaches a
		// controller, which is the behaviour worth having.
		ResponseEntity<String> response = get("/api/v1/categories", FOREIGN);

		assertThat(response.getHeaders().getAccessControlAllowOrigin()).isNull();
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
	}

	@Test
	@DisplayName("answers a preflight without a token, or no mutation could ever be sent")
	void answersPreflight() {
		// A PATCH carrying Authorization and application/json is never simple,
		// so the browser sends OPTIONS first and gives up if that fails. The
		// CorsFilter has to answer it before authorization runs — otherwise the
		// preflight for an authenticated endpoint is rejected for lacking the
		// credential the real request was going to carry.
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(ALLOWED);
		headers.setAccessControlRequestMethod(HttpMethod.PATCH);
		headers.setAccessControlRequestHeaders(java.util.List.of(HttpHeaders.AUTHORIZATION,
				HttpHeaders.CONTENT_TYPE));

		ResponseEntity<String> response = this.http.exchange("/api/v1/expenses/any-id", HttpMethod.OPTIONS,
				new HttpEntity<>(headers), String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED);
		assertThat(response.getHeaders().getAccessControlAllowMethods()).contains(HttpMethod.PATCH);
		assertThat(response.getHeaders().getAccessControlAllowHeaders())
			.contains(HttpHeaders.AUTHORIZATION, HttpHeaders.CONTENT_TYPE);
	}

	@Test
	@DisplayName("does not allow credentials, because nothing here uses a cookie yet")
	void withholdsCredentials() {
		// Spec §9.2 keeps the access token in memory and sends it as a header.
		// The flag turns on with #57 and not before — and that is the same
		// change that must restore CSRF protection.
		ResponseEntity<String> response = get("/api/v1/categories", ALLOWED);

		assertThat(response.getHeaders().getAccessControlAllowCredentials()).isFalse();
	}

	private ResponseEntity<String> get(String path, String origin) {
		HttpHeaders headers = new HttpHeaders();
		headers.setOrigin(origin);
		return this.http.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), String.class);
	}

}
