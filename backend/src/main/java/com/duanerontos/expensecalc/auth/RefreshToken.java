package com.duanerontos.expensecalc.auth;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

import org.springframework.data.domain.Persistable;

/**
 * One refresh token, stored as a hash (spec §9.2).
 *
 * <p><b>The token itself is never persisted.</b> This row is the only thing in
 * the schema directly usable as a credential, so a backup, a logged query, or an
 * errant {@code SELECT} must not hand anyone a working session.
 */
@Entity
@Table(name = "refresh_token")
public class RefreshToken implements Persistable<UUID> {

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

	/**
	 * Whether this instance has yet to be inserted (issue #43).
	 *
	 * <p>Same defect and same fix as {@code Expense} and
	 * {@code ClassificationRecord}: {@link #issue} assigns a {@code UUID} up
	 * front, so {@code SimpleJpaRepository.save} saw a non-null id, called
	 * {@code merge()} instead of {@code persist()}, and Hibernate probed for a
	 * row that could not exist before every insert.
	 *
	 * <p>By frequency this was the worst of the three: {@code TokenService}
	 * writes one of these on every login <em>and</em> every rotation, so a
	 * client refreshing every fifteen minutes paid the round trip that often.
	 */
	@Transient
	private boolean isNew = true;

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
	 * <p><b>Not on the rotation path.</b> {@code TokenService.rotate} decides
	 * with a single conditional UPDATE, because a read-then-check here leaves a
	 * window two concurrent refreshes can both pass through.
	 *
	 * <p>The row keeps {@code revokedAt} rather than being deleted, so a
	 * replayed token can be told apart from one that never existed. <b>Nothing
	 * currently acts on that distinction</b> — every failure is one error to the
	 * caller, on purpose, so as not to confirm which tokens exist. Presenting a
	 * revoked token is the canonical signal to revoke the whole family, and this
	 * is where that would be built; the data is recorded for it, the behaviour
	 * is not implemented.
	 */
	public boolean isUsableAt(Instant now) {
		return this.revokedAt == null && now.isBefore(this.expiresAt);
	}

	@Override
	public boolean isNew() {
		return this.isNew;
	}

	/**
	 * Inserted now, so a later save is an update.
	 *
	 * <p>Without this an instance that was persisted and then detached keeps
	 * {@code isNew == true}, and saving it again becomes a second insert with a
	 * duplicate key rather than the no-op Hibernate intends.
	 */
	@PostPersist
	@PostLoad
	void markNotNew() {
		this.isNew = false;
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
