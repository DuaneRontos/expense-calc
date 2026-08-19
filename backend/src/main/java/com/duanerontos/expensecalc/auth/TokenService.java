package com.duanerontos.expensecalc.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;

import com.nimbusds.jose.jwk.source.ImmutableSecret;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.spec.SecretKeySpec;

/**
 * Issues access tokens and rotates refresh tokens (spec §9.2).
 *
 * <p><b>Two different kinds of credential, deliberately.</b> The access token is
 * a signed JWT the API verifies without a database read — that is what keeps the
 * API stateless as spec §3 requires. The refresh token is opaque random bytes
 * with a row behind it, because rotation needs somewhere to record that the
 * previous one is dead, and a stateless token cannot be revoked.
 *
 * <p>The access token's 15-minute life is the whole revocation story: it cannot
 * be withdrawn, so its lifetime <em>is</em> the window in which a leaked one
 * works.
 *
 * <p>{@code @DependsOn} the guard because this constructor builds a
 * {@link SecretKeySpec} eagerly: with no signing key configured it fails first,
 * with {@code IllegalArgumentException: Empty key}, and that message names no
 * property, no profile and no document. The guard exists to say the useful
 * thing, and it has to run first to get the chance.
 */
@Service
@DependsOn("securityStartupGuard")
public class TokenService {

	/** Claimed by every access token and required by the decoder. */
	public static final String ISSUER = "expense-calc";

	/** 256 bits of CSPRNG output. Long enough that guessing is not a strategy. */
	private static final int REFRESH_TOKEN_BYTES = 32;

	private final RefreshTokenRepository refreshTokens;

	private final AuthProperties properties;

	private final Clock clock;

	private final JwtEncoder jwtEncoder;

	private final SecureRandom random = new SecureRandom();

	public TokenService(RefreshTokenRepository refreshTokens, AuthProperties properties, Clock clock) {
		this.refreshTokens = refreshTokens;
		this.properties = properties;
		this.clock = clock;
		this.jwtEncoder = new NimbusJwtEncoder(
				new ImmutableSecret<>(new SecretKeySpec(properties.jwtSecret().getBytes(StandardCharsets.UTF_8),
						"HmacSHA256")));
	}

	/**
	 * A fresh session: an access token and a new refresh token.
	 */
	@Transactional
	public Tokens issue() {
		Instant now = this.clock.instant();
		return new Tokens(accessToken(now), newRefreshToken(now), this.properties.accessTokenTtl().toSeconds());
	}

	/**
	 * Exchanges a refresh token for a new pair, invalidating the old one.
	 *
	 * <p><b>Rotation is the point.</b> A refresh token that stays valid after
	 * being exchanged is a bearer credential with no practical expiry — whoever
	 * captured it once can keep renewing indefinitely, and the real user's
	 * continued use gives no sign of it.
	 *
	 * @throws InvalidRefreshTokenException if the token is unknown, already
	 *     rotated, revoked, or expired. All four are one error to the caller on
	 *     purpose: telling them which would let an attacker probe for tokens
	 *     that exist.
	 */
	@Transactional
	public Tokens rotate(String presentedToken) {
		Instant now = this.clock.instant();

		// One statement, not read-check-write. Two concurrent refreshes of the
		// same token would otherwise both pass the check and both mint a
		// session; exactly one of them gets the 1 back from this.
		if (this.refreshTokens.revokeIfUsable(hash(presentedToken), now) != 1) {
			throw new InvalidRefreshTokenException();
		}

		return new Tokens(accessToken(now), newRefreshToken(now), this.properties.accessTokenTtl().toSeconds());
	}

	/** Signs out every session. Access tokens already issued still work until they expire. */
	@Transactional
	public int revokeAll() {
		return this.refreshTokens.revokeAllLive(this.clock.instant());
	}

	private String accessToken(Instant now) {
		JwtClaimsSet claims = JwtClaimsSet.builder()
			.issuer(ISSUER)
			.subject(this.properties.username())
			.issuedAt(now)
			.expiresAt(now.plus(this.properties.accessTokenTtl()))
			.build();

		return this.jwtEncoder
			.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
			.getTokenValue();
	}

	private String newRefreshToken(Instant now) {
		byte[] bytes = new byte[REFRESH_TOKEN_BYTES];
		this.random.nextBytes(bytes);
		String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

		this.refreshTokens.save(RefreshToken.issue(hash(token), now, now.plus(this.properties.refreshTokenTtl())));

		return token;
	}

	/**
	 * SHA-256, not a password hash.
	 *
	 * <p>The token is 256 bits of CSPRNG output rather than something a human
	 * chose, so there is no dictionary to attack and nothing for a KDF's work
	 * factor to buy. Paying Argon2's cost on every refresh would slow the API
	 * down to defend against an attack that cannot happen.
	 */
	private static String hash(String token) {
		try {
			return HexFormat.of()
				.formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("SHA-256 is required by every JVM and is missing.", ex);
		}
	}

	/**
	 * @param accessToken a signed JWT, sent as {@code Authorization: Bearer …}
	 * @param refreshToken opaque; the client stores it per spec §9.2's table —
	 *     Keychain/Keystore on device, an httpOnly cookie on web, never
	 *     localStorage
	 * @param expiresInSeconds lifetime of the access token, so a client can
	 *     refresh before it expires rather than after a request fails
	 */
	public record Tokens(String accessToken, String refreshToken, long expiresInSeconds) {
	}

}
