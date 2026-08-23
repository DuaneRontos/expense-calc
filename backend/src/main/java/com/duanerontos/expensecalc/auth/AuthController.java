package com.duanerontos.expensecalc.auth;

import java.util.Map;
import java.util.Objects;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sign in, refresh, sign out (spec §9.2).
 *
 * <p><b>Nothing here returns the refresh token in a cookie.</b> Spec §9.2 puts
 * the web client's refresh token in an {@code httpOnly; Secure;
 * SameSite=Strict} cookie, and device clients in the Keychain or Keystore —
 * three targets, two storage mechanisms, and only the client knows which it is.
 * The API returns both tokens in the body and each client stores them per that
 * table (#13). Setting the cookie server-side would be right for web and wrong
 * for the other two.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

	private final TokenService tokens;

	private final AuthProperties properties;

	private final PasswordEncoder passwordEncoder;

	private final LoginRateLimiter rateLimiter;

	public AuthController(TokenService tokens, AuthProperties properties, PasswordEncoder passwordEncoder,
			LoginRateLimiter rateLimiter) {
		this.tokens = tokens;
		this.properties = properties;
		this.passwordEncoder = passwordEncoder;
		this.rateLimiter = rateLimiter;
	}

	public record LoginRequest(@NotBlank String username, @NotBlank String password) {
	}

	public record RefreshRequest(@NotBlank String refreshToken) {
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
	public ResponseEntity<TokenService.Tokens> login(@Valid @RequestBody LoginRequest request,
			HttpServletRequest httpRequest) {
		// `getRemoteAddr()` may be null — the servlet contract permits it, and
		// connectors where the peer address is not resolvable do return it. The
		// limiter keys a ConcurrentHashMap, which rejects null, so passing it
		// straight through is a 500 on an unauthenticated endpoint. Such callers
		// share one bucket, which is the conservative reading.
		String client = Objects.requireNonNullElse(httpRequest.getRemoteAddr(), "unknown");
		this.rateLimiter.check(client);

		boolean passwordMatches = this.passwordEncoder.matches(request.password(), this.properties.passwordHash());
		boolean usernameMatches = this.properties.username().equals(request.username());

		if (!passwordMatches || !usernameMatches) {
			// Recorded after both comparisons so the limiter cannot become the
			// oracle the constant-time comparison above exists to prevent: a
			// wrong username and a wrong password cost the same and count the
			// same.
			this.rateLimiter.recordFailure(client);
			throw new InvalidCredentialsException();
		}

		this.rateLimiter.recordSuccess(client);
		return ResponseEntity.ok(this.tokens.issue());
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
	public ResponseEntity<TokenService.Tokens> refresh(@Valid @RequestBody RefreshRequest request) {
		return ResponseEntity.ok(this.tokens.rotate(request.refreshToken()));
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
		return ResponseEntity.ok(Map.of("revokedSessions", revoked, "note",
				"Access tokens already issued remain valid until they expire."));
	}

}
