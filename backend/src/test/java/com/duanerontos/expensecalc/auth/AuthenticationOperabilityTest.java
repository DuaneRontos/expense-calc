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
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Authentication end to end (spec §9.2, issue #21).
 *
 * <p>Runs the real filter chain against a real database, because the questions
 * worth answering here are not unit-testable: does an unauthenticated request
 * actually get turned away, does a rotated refresh token actually stop working,
 * does the token this application signs actually verify against the decoder it
 * configured.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Import(TestcontainersConfiguration.class)
class AuthenticationOperabilityTest {

	private static final String USERNAME = "duane";

	private static final String PASSWORD = "a password nobody guessed";

	@DynamicPropertySource
	static void credentials(DynamicPropertyRegistry registry) {
		registry.add("app.auth.username", () -> USERNAME);
		registry.add("app.auth.password-hash",
				() -> Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(PASSWORD));
		registry.add("app.auth.jwt-secret", () -> "authentication-test-signing-key-well-over-32-bytes");
		// Out of the way: this class asks whether authentication works, and it
		// signs in repeatedly from one address to ask it. The limit itself is
		// LoginRateLimitOperabilityTest's subject (issue #52).
		registry.add("app.auth.rate-limit.free-attempts", () -> 1_000);
		registry.add("app.auth.rate-limit.global-attempts-per-minute", () -> 10_000);
	}

	@Autowired
	private TestRestTemplate http;

	private ResponseEntity<Map<String, Object>> post(String path, Object body) {
		return this.http.exchange(
				RequestEntity.post(path).contentType(MediaType.APPLICATION_JSON).body(body),
				new ParameterizedTypeReference<>() {
				});
	}

	private Map<String, Object> signIn() {
		return post("/api/v1/auth/login", Map.of("username", USERNAME, "password", PASSWORD, "client", "device")).getBody();
	}

	@Test
	@DisplayName("turns away a request with no token")
	void refusesAnonymousRequests() {
		// The assertion the whole issue exists for. Before #21 this returned
		// 200 and a list of somebody's spending.
		assertThat(this.http.getForEntity("/api/v1/expenses", String.class).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(this.http.getForEntity("/api/v1/categories", String.class).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(this.http.getForEntity("/api/v1/reports/by-category", String.class).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	@DisplayName("turns away a token this application did not sign")
	void refusesForgedTokens() {
		// A JWT is only a credential because of the signature. This one is
		// structurally valid and signed with a different key.
		String forged = "eyJhbGciOiJIUzI1NiJ9."
				+ "eyJpc3MiOiJleHBlbnNlLWNhbGMiLCJzdWIiOiJkdWFuZSIsImV4cCI6NDEwMjQ0NDgwMH0."
				+ "not-a-valid-signature-for-this-key";

		ResponseEntity<String> response = this.http.exchange(
				RequestEntity.get("/api/v1/expenses").header("Authorization", "Bearer " + forged).build(),
				String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	@DisplayName("signs in with the right credentials and admits the token afterwards")
	void signsInAndAdmits() {
		Map<String, Object> tokens = signIn();

		assertThat(tokens).containsKeys("accessToken", "refreshToken", "expiresInSeconds");
		// Spec §9.2: 15 minutes. The access token cannot be revoked, so its
		// lifetime is the window a leaked one works in.
		assertThat(tokens.get("expiresInSeconds")).isEqualTo(900);

		ResponseEntity<String> authorized = this.http.exchange(RequestEntity.get("/api/v1/categories")
			.header("Authorization", "Bearer " + tokens.get("accessToken"))
			.build(), String.class);

		assertThat(authorized.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	@DisplayName("refuses a wrong password and a wrong username identically")
	void refusesBadCredentials() {
		ResponseEntity<Map<String, Object>> wrongPassword = post("/api/v1/auth/login",
				Map.of("username", USERNAME, "password", "not it", "client", "device"));
		ResponseEntity<Map<String, Object>> wrongUsername = post("/api/v1/auth/login",
				Map.of("username", "someone-else", "password", PASSWORD, "client", "device"));

		assertThat(wrongPassword.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(wrongUsername.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		// Identical bodies: "no such user" and "wrong password" are the same
		// answer to anyone who is not the account's owner.
		assertThat(wrongPassword.getBody().get("detail")).isEqualTo(wrongUsername.getBody().get("detail"));
	}

	@Test
	@DisplayName("rotates the refresh token and kills the one it replaced")
	void rotationInvalidatesThePreviousToken() {
		// The issue's requirement, and the reason refresh tokens have a table at
		// all: one that survives being exchanged is a bearer credential with no
		// practical expiry, because whoever captured it can keep renewing.
		String first = (String) signIn().get("refreshToken");

		ResponseEntity<Map<String, Object>> rotated = post("/api/v1/auth/refresh", Map.of("refreshToken", first));
		assertThat(rotated.getStatusCode()).isEqualTo(HttpStatus.OK);

		String second = (String) rotated.getBody().get("refreshToken");
		assertThat(second).isNotEqualTo(first);

		// The old one is dead the moment it is used.
		assertThat(post("/api/v1/auth/refresh", Map.of("refreshToken", first)).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);
		// The new one works.
		assertThat(post("/api/v1/auth/refresh", Map.of("refreshToken", second)).getStatusCode())
			.isEqualTo(HttpStatus.OK);
	}

	@Test
	@DisplayName("refuses a refresh token that was never issued")
	void refusesAnUnknownRefreshToken() {
		assertThat(post("/api/v1/auth/refresh", Map.of("refreshToken", "made-up")).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	@DisplayName("logs out every session, and needs a token to do it")
	void logsOut() {
		String refreshToken = (String) signIn().get("refreshToken");
		String accessToken = (String) signIn().get("accessToken");

		// Logging out is not something an anonymous caller may do to someone else.
		assertThat(this.http.exchange(RequestEntity.post("/api/v1/auth/logout").build(), String.class).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);

		ResponseEntity<Map<String, Object>> loggedOut = this.http.exchange(RequestEntity.post("/api/v1/auth/logout")
			.header("Authorization", "Bearer " + accessToken)
			.contentType(MediaType.APPLICATION_JSON)
			.build(), new ParameterizedTypeReference<>() {
			});

		assertThat(loggedOut.getStatusCode()).isEqualTo(HttpStatus.OK);

		// Every refresh token is dead, so the session cannot be renewed.
		assertThat(post("/api/v1/auth/refresh", Map.of("refreshToken", refreshToken)).getStatusCode())
			.isEqualTo(HttpStatus.UNAUTHORIZED);
	}

}
