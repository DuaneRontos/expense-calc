package com.duanerontos.expensecalc.auth;

import java.util.Map;
import java.util.Objects;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sign in, refresh, sign out (spec §9.2).
 *
 * <p><b>Where the refresh token goes depends on who asked</b> (issue #57). Spec
 * §9.2 gives three targets two storage mechanisms: an {@code httpOnly; Secure;
 * SameSite=Strict} cookie for web, the Keychain or Keystore for iOS and
 * Android. Only the client knows which it is, so {@link ClientType} is declared
 * on the login request and the server honours exactly one mechanism per caller
 * — the cookie <em>or</em> the body, never both. Both would put the credential
 * somewhere a script can read it, which is the single thing {@code httpOnly}
 * exists to prevent.
 *
 * <p><b>Refresh follows the token it was given.</b> A cookie in means a cookie
 * out; a body token in means a body token out. Nothing has to be declared twice,
 * and a client cannot accidentally migrate its own credential between
 * mechanisms halfway through a session.
 *
 * <p><b>The cookie path carries a CSRF obligation the header path does not.</b>
 * A browser attaches a cookie on its own, so {@code /auth/refresh} becomes
 * cross-site reachable the moment it accepts one. See
 * {@link RefreshCookies#CSRF_HEADER}.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

	private final TokenService tokens;

	private final AuthProperties properties;

	private final PasswordEncoder passwordEncoder;

	private final LoginRateLimiter rateLimiter;

	private final RefreshCookies cookies;

	public AuthController(TokenService tokens, AuthProperties properties, PasswordEncoder passwordEncoder,
			LoginRateLimiter rateLimiter, RefreshCookies cookies) {
		this.tokens = tokens;
		this.properties = properties;
		this.passwordEncoder = passwordEncoder;
		this.rateLimiter = rateLimiter;
		this.cookies = cookies;
	}

	/**
	 * @param client required, because guessing it is the failure this avoids. A
	 *     web caller mistaken for a device gets its refresh token in a body it
	 *     must not keep; a device mistaken for web gets a cookie it cannot read
	 *     and no token at all. Both fail silently
	 */
	public record LoginRequest(@NotBlank String username, @NotBlank String password,
			@NotNull ClientType client) {
	}

	/**
	 * @param refreshToken omitted by a web client, whose token is in a cookie
	 *     the browser attaches and JavaScript cannot read. No longer
	 *     {@code @NotBlank}: that annotation made a cookie-only refresh a 400
	 *     before it reached the service
	 */
	public record RefreshRequest(String refreshToken) {
	}

	/**
	 * What a caller gets back.
	 *
	 * <p>{@code refreshToken} is null for a web client and omitted from the
	 * JSON: its token is in the {@code Set-Cookie} on the same response, and
	 * putting it in both places would hand a script the value the cookie is
	 * hiding.
	 */
	@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
	public record TokenResponse(String accessToken, String refreshToken, long expiresInSeconds) {

		static TokenResponse forDevice(TokenService.Tokens issued) {
			return new TokenResponse(issued.accessToken(), issued.refreshToken(), issued.expiresInSeconds());
		}

		static TokenResponse forWeb(TokenService.Tokens issued) {
			return new TokenResponse(issued.accessToken(), null, issued.expiresInSeconds());
		}

	}

	/**
	 * {@code POST /auth/login}.
	 *
	 * <p><b>The hash is always verified, even when the username is wrong.</b>
	 * Returning early on an unknown username makes the response measurably
	 * faster than a wrong password, which tells an attacker which usernames
	 * exist. There is only one username here, so the leak is small — but the
	 * habit of comparing before verifying is how it stops being small.
	 *
	 * <p><b>The rate limit is checked before the hash, not after</b> (issue
	 * #52). Argon2id is deliberately expensive, so a refused attempt that still
	 * ran the comparison would cost the server exactly what the limit exists to
	 * protect. See {@link LoginRateLimiter}.
	 */
	@PostMapping("/login")
	public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request,
			HttpServletRequest httpRequest) {
		// `getRemoteAddr()` may be null — the servlet contract permits it, and
		// connectors where the peer address is not resolvable do return it. The
		// limiter keys a ConcurrentHashMap, which rejects null, so passing it
		// straight through is a 500 on an unauthenticated endpoint. Such callers
		// share one bucket, which is the conservative reading.
		//
		// Named `caller` rather than `client`: in this file `client` now means
		// the ClientType on the request, which is a different thing entirely.
		String caller = Objects.requireNonNullElse(httpRequest.getRemoteAddr(), "unknown");
		this.rateLimiter.check(caller);

		boolean passwordMatches = this.passwordEncoder.matches(request.password(), this.properties.passwordHash());
		boolean usernameMatches = this.properties.username().equals(request.username());

		if (!passwordMatches || !usernameMatches) {
			// Recorded after both comparisons so the limiter cannot become the
			// oracle the constant-time comparison above exists to prevent: a
			// wrong username and a wrong password cost the same and count the
			// same.
			this.rateLimiter.recordFailure(caller);
			throw new InvalidCredentialsException();
		}

		this.rateLimiter.recordSuccess(caller);
		return issueTo(request.client(), this.tokens.issue());
	}

	/**
	 * {@code POST /auth/refresh} — exchanges a refresh token, invalidating it.
	 *
	 * <p>The old token stops working the moment this succeeds. A client that
	 * loses the response has to sign in again, which is the correct trade: the
	 * alternative is a token that survives being used, and one of those in the
	 * wrong hands never expires in practice.
	 */
	@PostMapping("/refresh")
	public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshRequest request,
			HttpServletRequest httpRequest) {
		String fromBody = request.refreshToken();

		if (fromBody != null && !fromBody.isBlank()) {
			// A device client. The token is in a body an attacker's page cannot
			// construct, so there is nothing for CSRF to exploit and no header
			// to demand.
			return issueTo(ClientType.DEVICE, this.tokens.rotate(fromBody));
		}

		String fromCookie = this.cookies.read(httpRequest).orElseThrow(MissingRefreshTokenException::new);

		// The browser attached that cookie on its own, which is exactly what
		// CSRF exploits. A cross-site request cannot set this header.
		if (!this.cookies.hasCsrfHeader(httpRequest)) {
			throw new MissingCsrfHeaderException();
		}

		return issueTo(ClientType.WEB, this.tokens.rotate(fromCookie));
	}

	/**
	 * {@code POST /auth/logout} — revokes every refresh token.
	 *
	 * <p>Requires a valid access token, so this is not a way for an unauthenticated
	 * caller to sign someone else out.
	 *
	 * <p><b>Access tokens already issued keep working until they expire.</b> That
	 * is what stateless means, and it is why spec §9.2 makes them short: the
	 * 15-minute window is the price of not checking a revocation list on every
	 * request.
	 */
	@PostMapping("/logout")
	public ResponseEntity<Map<String, Object>> logout() {
		int revoked = this.tokens.revokeAll();

		// Cleared unconditionally rather than only for a caller that sent one.
		// A device client has no cookie and discards the header; a web client
		// that kept it would be holding a credential the server has already
		// revoked — which works, but only because the server says no, and the
		// browser has no way to tell.
		return ResponseEntity.ok()
			.header(this.cookies.header(), this.cookies.cleared())
			.body(Map.of("revokedSessions", revoked, "note",
					"Access tokens already issued remain valid until they expire."));
	}

	/**
	 * Hands the token back by whichever mechanism {@code client} uses.
	 *
	 * <p>One place, so "cookie or body, never both" is a property of the code
	 * rather than a rule three call sites have to remember.
	 */
	private ResponseEntity<TokenResponse> issueTo(ClientType client, TokenService.Tokens issued) {
		if (client == ClientType.WEB) {
			return ResponseEntity.ok()
				.header(this.cookies.header(), this.cookies.issued(issued.refreshToken()))
				.body(TokenResponse.forWeb(issued));
		}

		return ResponseEntity.ok(TokenResponse.forDevice(issued));
	}

}
