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
	@Modifying
	@Query("UPDATE RefreshToken t SET t.revokedAt = :now WHERE t.revokedAt IS NULL AND t.expiresAt > :now")
	int revokeAllLive(@Param("now") Instant now);

}
