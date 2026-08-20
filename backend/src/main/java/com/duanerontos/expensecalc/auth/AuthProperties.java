package com.duanerontos.expensecalc.auth;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The credential and token settings of spec §9.2.
 *
 * <p><b>None of these has a usable default, on purpose.</b> A default secret is
 * a published secret: anyone with the source can mint tokens. The application
 * refuses to start without them rather than falling back to something that
 * works and is worthless — see {@code SecurityStartupGuard}.
 *
 * @param username the single user's name; v1 is single-user (spec §9.3)
 * @param passwordHash an Argon2id hash, never a password. Generate one with the
 *     command in {@code docs/RUNNING-LOCALLY.md}
 * @param jwtSecret HMAC signing key for the access token; at least 32 bytes,
 *     because HS256 with a shorter key is weaker than it looks
 * @param accessTokenTtl spec §9.2 says 15 minutes — short because an access
 *     token cannot be revoked, so its lifetime <em>is</em> the revocation window
 * @param refreshTokenTtl how long a session survives without signing in again
 * @param refreshTokenRetention how long an expired row is kept before deletion
 *     (issue #51). This is not a security setting but an evidence one: the row
 *     is retained past expiry so a replayed token can still be told apart from
 *     one that never existed — the difference between "expired session" and
 *     "someone is trying tokens". Past this window that distinction has no
 *     practical value, and the row is only a slow leak: a client refreshing
 *     every fifteen minutes writes roughly 35,000 rows a year.
 */
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(String username, String passwordHash, String jwtSecret, Duration accessTokenTtl,
		Duration refreshTokenTtl, Duration refreshTokenRetention) {

	/** Shortest HS256 key that is not weaker than the algorithm it feeds. */
	public static final int MINIMUM_SECRET_BYTES = 32;

	public AuthProperties {
		accessTokenTtl = (accessTokenTtl == null) ? Duration.ofMinutes(15) : accessTokenTtl;
		refreshTokenTtl = (refreshTokenTtl == null) ? Duration.ofDays(30) : refreshTokenTtl;
		// A week past expiry. Long enough that a replay arriving after the
		// session lapsed is still recognisable as a replay, short enough that
		// the table stays a working set rather than an archive.
		refreshTokenRetention = (refreshTokenRetention == null) ? Duration.ofDays(7) : refreshTokenRetention;
	}

}
