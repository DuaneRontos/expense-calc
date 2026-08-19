package com.duanerontos.expensecalc.auth;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * One refresh token, stored as a hash (spec §9.2).
 *
 * <p><b>The token itself is never persisted.</b> This row is the only thing in
 * the schema directly usable as a credential, so a backup, a logged query, or an
 * errant {@code SELECT} must not hand anyone a working session.
 */
@Entity
@Table(name = "refresh_token")
public class RefreshToken {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@Column(name = "token_hash", nullable = false, updatable = false, length = 64)
	private String tokenHash;

	@Column(name = "issued_at", nullable = false, updatable = false)
	private Instant issuedAt;

	@Column(name = "expires_at", nullable = false, updatable = false)
	private Instant expiresAt;

	@Column(name = "revoked_at")
	private Instant revokedAt;

	protected RefreshToken() {
		// for JPA
	}

	private RefreshToken(UUID id, String tokenHash, Instant issuedAt, Instant expiresAt) {
		this.id = id;
		this.tokenHash = tokenHash;
		this.issuedAt = issuedAt;
		this.expiresAt = expiresAt;
	}

	public static RefreshToken issue(String tokenHash, Instant now, Instant expiresAt) {
		return new RefreshToken(UUID.randomUUID(), tokenHash, now, expiresAt);
	}

	/**
	 * Whether this token can still be exchanged.
	 *
	 * <p>Revoked and expired are checked separately from "not found" by the
	 * caller, because a presented-but-revoked token is a different event from a
	 * token that never existed: the first can mean a stolen token being
	 * replayed after the real client already rotated it.
	 */
	public boolean isUsableAt(Instant now) {
		return this.revokedAt == null && now.isBefore(this.expiresAt);
	}

	public void revoke(Instant now) {
		if (this.revokedAt == null) {
			this.revokedAt = now;
		}
	}

	public UUID getId() {
		return this.id;
	}

	public String getTokenHash() {
		return this.tokenHash;
	}

	public Instant getExpiresAt() {
		return this.expiresAt;
	}

	public Instant getRevokedAt() {
		return this.revokedAt;
	}

}
