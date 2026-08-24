package com.duanerontos.expensecalc.auth;

import java.util.Map;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The login rate limit through the real filter chain (issue #52).
 *
 * <p>{@code LoginRateLimiterTest} covers the arithmetic. What only an end-to-end
 * run can answer is whether the refusal actually reaches the client as a 429
 * with a {@code Retry-After} — the limiter throws, and everything between it and
 * the wire is Spring's exception handling rather than this application's logic.
 *
 * <p>Configured to lock out on the first failure so the test does not have to
 * spend real Argon2 verifications to reach the interesting state.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Import(TestcontainersConfiguration.class)
class LoginRateLimitOperabilityTest {

	private static final String USERNAME = "duane";

	private static final String PASSWORD = "a password nobody guessed";

	@DynamicPropertySource
	static void credentials(DynamicPropertyRegistry registry) {
		registry.add("app.auth.username", () -> USERNAME);
		registry.add("app.auth.password-hash",
				() -> Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(PASSWORD));
		registry.add("app.auth.jwt-secret", () -> "rate-limit-test-signing-key-well-over-32-bytes");
		registry.add("app.auth.rate-limit.free-attempts", () -> 0);
		registry.add("app.auth.rate-limit.initial-lockout", () -> "60s");
		registry.add("app.auth.rate-limit.max-lockout", () -> "60s");
	}

	@Autowired
	private TestRestTemplate http;

	private ResponseEntity<Map<String, Object>> login(String password) {
		return this.http.exchange(RequestEntity.post("/api/v1/auth/login")
			.contentType(MediaType.APPLICATION_JSON)
			.body(Map.of("username", USERNAME, "password", password, "client", "device")),
			new ParameterizedTypeReference<>() {
			});
	}

	@Test
	@DisplayName("locks out after a failure, and refuses the right password too")
	void locksOutBeforeCheckingCredentials() {
		// One test rather than three, because this is one lockout observed at
		// three points and the limiter's state is deliberately shared across a
		// context. Splitting it would make the methods order-dependent.

		// Free attempts are configured to zero, so the first failure is a
		// normal 401 and also the last attempt this caller gets.
		assertThat(login("not it").getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

		ResponseEntity<Map<String, Object>> refused = login("not it");
		assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
		// The header is the part a client can act on without parsing the body.
		assertThat(refused.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isEqualTo("60");
		assertThat(refused.getBody()).containsEntry("title", "Too many attempts");

		// The assertion that matters most, in two ways. It proves the Argon2
		// verification the limit exists to protect is genuinely skipped — a
		// limiter running after it would spend exactly the CPU it defends. And
		// it proves the 429 is not a probing oracle: a locked-out caller learns
		// nothing about whether they finally guessed right.
		assertThat(login(PASSWORD).getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
	}

}
