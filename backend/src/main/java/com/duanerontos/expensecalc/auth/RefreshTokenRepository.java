package com.duanerontos.expensecalc.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

	/** Lookup is by hash because the token itself is never stored. */
	Optional<RefreshToken> findByTokenHash(String tokenHash);

	/**
	 * Revokes every live token. This is "sign out everywhere".
	 *
	 * <p>Expired rows are left alone: revoking something already unusable
	 * changes nothing and would only obscure when the revocation happened.
	 */
	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("UPDATE RefreshToken t SET t.revokedAt = :now WHERE t.revokedAt IS NULL AND t.expiresAt > :now")
	int revokeAllLive(@Param("now") Instant now);

	/**
	 * Revokes one token, and reports whether this call is the one that did it.
	 *
	 * <p><b>The check and the write are one statement, deliberately.</b> Reading
	 * the row, testing it, then writing leaves a window where two concurrent
	 * refreshes both pass the test and both mint a session — which is precisely
	 * the "a token that survives being used" outcome rotation exists to
	 * prevent, reached by a narrower path. The triggers are mundane: a client
	 * retrying a refresh that timed out, or two instances waking together.
	 *
	 * <p>Returns 1 for the caller that won and 0 for everyone else, so the
	 * caller issues a new pair only on 1.
	 */
	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			UPDATE RefreshToken t SET t.revokedAt = :now
			WHERE t.tokenHash = :hash AND t.revokedAt IS NULL AND t.expiresAt > :now
			""")
	int revokeIfUsable(@Param("hash") String hash, @Param("now") Instant now);

}
