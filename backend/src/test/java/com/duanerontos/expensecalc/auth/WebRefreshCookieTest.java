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
 * The web client's {@code httpOnly} refresh cookie (issue #57, spec §9.2).
 *
 * <p>Every assertion here is about a header, which is why it runs end to end:
 * whether {@code Set-Cookie} carries the attributes that make the cookie worth
 * having is not observable from inside the application.
 *
 * <p>The cookie is round-tripped by hand rather than by a cookie-aware client.
 * That is deliberate — it makes "the browser sends this back automatically" an
 * explicit step, which is the exact property CSRF exploits and which the header
 * check below exists to answer.
 *
 * <p>Requires Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Import(TestcontainersConfiguration.class)
class WebRefreshCookieTest {

	private static final String USERNAME = "duane";

	private static final String PASSWORD = "a password nobody guessed";

	@DynamicPropertySource
	static void credentials(DynamicPropertyRegistry registry) {
		registry.add("app.auth.username", () -> USERNAME);
		registry.add("app.auth.password-hash",
				() -> Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(PASSWORD));
		registry.add("app.auth.jwt-secret", () -> "web-cookie-test-signing-key-well-over-32-bytes");
		registry.add("app.auth.rate-limit.free-attempts", () -> 1_000);
		registry.add("app.auth.rate-limit.global-attempts-per-minute", () -> 10_000);
	}

	@Autowired
	private TestRestTemplate http;

	private ResponseEntity<Map<String, Object>> login(String client) {
		return this.http.exchange(RequestEntity.post("/api/v1/auth/login")
			.contentType(MediaType.APPLICATION_JSON)
			.body(Map.of("username", USERNAME, "password", PASSWORD, "client", client)),
				new ParameterizedTypeReference<>() {
				});
	}

	/** The `name=value` pair a browser would send back, without the attributes. */
	private static String cookiePair(ResponseEntity<?> response) {
		String setCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
		assertThat(setCookie).isNotNull();
		return setCookie.split(";", 2)[0];
	}

	private ResponseEntity<Map<String, Object>> refreshWithCookie(String cookiePair, boolean withCsrfHeader) {
		RequestEntity.BodyBuilder request = RequestEntity.post("/api/v1/auth/refresh")
			.contentType(MediaType.APPLICATION_JSON)
			.header(HttpHeaders.COOKIE, cookiePair);

		if (withCsrfHeader) {
			request = request.header(RefreshCookies.CSRF_HEADER, "cookie");
		}

		return this.http.exchange(request.body(Map.of()), new ParameterizedTypeReference<>() {
		});
	}

	@Test
	@DisplayName("gives a web client a cookie and keeps the token out of the body")
	void webGetsCookieOnly() {
		ResponseEntity<Map<String, Object>> response = login("web");
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

		String setCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
		assertThat(setCookie).contains("refresh_token=")
			// The flag the whole issue is about: unreadable from JavaScript, so
			// XSS cannot lift the credential the way it can from localStorage.
			.contains("HttpOnly")
			.contains("Secure")
			.contains("SameSite=Strict")
			// Scoped, so the refresh token is not attached to every expense read.
			.contains("Path=/api/v1/auth");

		// The point of the cookie, undone if the body carried it too: a script
		// that can read the login response can read a body token.
		assertThat(response.getBody()).containsKey("accessToken").doesNotContainKey("refreshToken");
	}

	@Test
	@DisplayName("gives a device client a body token and no cookie")
	void deviceGetsBodyOnly() {
		ResponseEntity<Map<String, Object>> response = login("device");

		assertThat(response.getBody()).containsKeys("accessToken", "refreshToken");
		// iOS and Android put theirs in the Keychain or Keystore. A cookie they
		// cannot read would be a credential they could not use.
		assertThat(response.getHeaders().getFirst(HttpHeaders.SET_COOKIE)).isNull();
	}

	@Test
	@DisplayName("refreshes from the cookie and hands back a new one, still not in the body")
	void refreshesFromCookie() {
		String cookie = cookiePair(login("web"));

		ResponseEntity<Map<String, Object>> refreshed = refreshWithCookie(cookie, true);

		assertThat(refreshed.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(refreshed.getBody()).containsKey("accessToken").doesNotContainKey("refreshToken");
		assertThat(refreshed.getHeaders().getFirst(HttpHeaders.SET_COOKIE)).contains("HttpOnly");
	}

	@Test
	@DisplayName("refuses a cookie refresh that carries no proof it was not cross-site")
	void refusesCookieRefreshWithoutCsrfHeader() {
		// The attack this closes. A browser attaches the cookie by itself, so
		// without this check any page on the internet could cause a refresh —
		// and while it could not read the response, each forced rotation kills
		// the token the real client holds, signing the user out repeatedly.
		String cookie = cookiePair(login("web"));

		ResponseEntity<Map<String, Object>> refused = refreshWithCookie(cookie, false);

		assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(refused.getBody()).containsEntry("title", "Cross-site request blocked");
	}

	@Test
	@DisplayName("leaves the cookie usable after refusing it, so the refusal is not itself a logout")
	void refusalDoesNotConsumeTheToken() {
		String cookie = cookiePair(login("web"));

		assertThat(refreshWithCookie(cookie, false).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

		// If the blocked attempt had rotated the token anyway, the CSRF defence
		// would deliver the exact outcome the attack was after.
		assertThat(refreshWithCookie(cookie, true).getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	@DisplayName("rotates the cookie token, so the one it replaced stops working")
	void rotationStillApplies() {
		String first = cookiePair(login("web"));

		ResponseEntity<Map<String, Object>> rotated = refreshWithCookie(first, true);
		String second = cookiePair(rotated);
		assertThat(second).isNotEqualTo(first);

		// Rotation is not weakened by living in a cookie: a refresh token that
		// survives being exchanged is a bearer credential with no practical
		// expiry.
		assertThat(refreshWithCookie(first, true).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	@DisplayName("tells a caller that sent nothing apart from one whose session expired")
	void missingTokenIsNotAnExpiredSession() {
		ResponseEntity<Map<String, Object>> response = this.http.exchange(RequestEntity
			.post("/api/v1/auth/refresh")
			.contentType(MediaType.APPLICATION_JSON)
			.body(Map.of()), new ParameterizedTypeReference<Map<String, Object>>() {
			});

		// 400, not 401. A web client that forgot `credentials: 'include'` would
		// otherwise look exactly like an expired session, and the client would
		// answer by bouncing the user to a sign-in that works once and then
		// fails again on the next refresh.
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("title", "No refresh token");
		// Pinned because the web client keys off this exact URI to tell "signed
		// out" from "the request was rejected". It is a cross-tier contract, and
		// renaming it would turn every web sign-out into a request error with
		// both suites still green.
		assertThat(response.getBody()).containsEntry("type",
				"https://expense-calc.invalid/problems/bad-request");
	}

	@Test
	@DisplayName("clears the cookie on logout, so the browser stops holding a revoked credential")
	void logoutClearsTheCookie() {
		Map<String, Object> session = login("web").getBody();

		ResponseEntity<Map<String, Object>> loggedOut = this.http.exchange(RequestEntity.post("/api/v1/auth/logout")
			.header(HttpHeaders.AUTHORIZATION, "Bearer " + session.get("accessToken"))
			.build(), new ParameterizedTypeReference<>() {
			});

		assertThat(loggedOut.getStatusCode()).isEqualTo(HttpStatus.OK);

		String setCookie = loggedOut.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
		// Same attributes as the cookie it replaces, or the browser stores this
		// one beside the original and keeps sending the original.
		assertThat(setCookie).contains("refresh_token=").contains("Max-Age=0").contains("Path=/api/v1/auth");
	}

	@Test
	@DisplayName("answers a wrong content type with 415 rather than a bare 401")
	void wrongContentTypeIsNotACredentialFailure() {
		// Unhandled, this escapes to /error and that dispatch requires
		// authentication — so "you sent text/plain" comes back as "your
		// credentials are wrong", with an empty body and nothing to act on.
		ResponseEntity<String> response = this.http.exchange(RequestEntity.post("/api/v1/auth/login")
			.contentType(MediaType.TEXT_PLAIN)
			.body("username=demo"), String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
	}

	@Test
	@DisplayName("clears a cookie it has just rejected, instead of leaving it for 30 days")
	void rejectedCookieIsCleared() {
		// A script cannot delete an httpOnly cookie, so a browser would keep a
		// dead refresh token until Max-Age and attach it to every /auth request
		// — each a wasted round trip that 401s, with logout the only cure and a
		// signed-out user unable to reach it.
		String cookie = cookiePair(login("web"));
		refreshWithCookie(cookie, true);

		ResponseEntity<Map<String, Object>> rejected = refreshWithCookie(cookie, true);

		assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(rejected.getHeaders().getFirst(HttpHeaders.SET_COOKIE)).contains("Max-Age=0");
	}

	@Test
	@DisplayName("refuses a login that does not say which client it is")
	void clientTypeIsRequired() {
		ResponseEntity<String> response = this.http.exchange(RequestEntity.post("/api/v1/auth/login")
			.contentType(MediaType.APPLICATION_JSON)
			.body(Map.of("username", USERNAME, "password", PASSWORD)), String.class);

		// Guessing is the failure this avoids: a web caller mistaken for a
		// device gets its token in a body it must not keep, and a device
		// mistaken for web gets a cookie it cannot read and no token at all.
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
	}

}
