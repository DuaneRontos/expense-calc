package com.duanerontos.expensecalc.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What the cleanup deletes, and more importantly what it does not (issue #51).
 *
 * <p>The easy half is that expired rows go. The half worth testing is the three
 * kinds of row that must survive: a live token, a rotated one still inside its
 * original lifetime, and one that expired recently enough that a replay of it
 * is still worth recognising.
 *
 * <p>Requires Docker.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class RefreshTokenCleanupTest {

	private static final Instant NOW = Instant.parse("2026-08-20T03:15:00Z");

	private static final Duration RETENTION = Duration.ofDays(7);

	@Autowired
	private RefreshTokenRepository refreshTokens;

	private RefreshTokenCleanup cleanup;

	@BeforeEach
	void setUp() {
		this.refreshTokens.deleteAll();
		this.cleanup = new RefreshTokenCleanup(this.refreshTokens,
				new AuthProperties("dev", "hash", "a".repeat(32), null, null, RETENTION),
				Clock.fixed(NOW, ZoneOffset.UTC));
	}

	@Test
	@DisplayName("deletes a row that expired longer ago than the retention window")
	void deletesLongExpired() {
		save("long-expired", NOW.minus(Duration.ofDays(40)), NOW.minus(Duration.ofDays(10)));

		assertThat(this.cleanup.purgeExpired()).isEqualTo(1);
		assertThat(this.refreshTokens.count()).isZero();
	}

	@Test
	@DisplayName("keeps a row that expired inside the window, so a replay is still recognisable")
	void keepsRecentlyExpired() {
		// The whole reason rows outlive their expiry: this is the difference
		// between "your session ended" and "someone is trying tokens".
		save("recently-expired", NOW.minus(Duration.ofDays(31)), NOW.minus(Duration.ofDays(1)));

		assertThat(this.cleanup.purgeExpired()).isZero();
		assertThat(this.refreshTokens.count()).isEqualTo(1);
	}

	@Test
	@DisplayName("keeps a live token")
	void keepsLive() {
		save("live", NOW, NOW.plus(Duration.ofDays(30)));

		assertThat(this.cleanup.purgeExpired()).isZero();
		assertThat(this.refreshTokens.count()).isEqualTo(1);
	}

	@Test
	@DisplayName("keeps a rotated token until its original expiry, not its revocation")
	void keepsRevokedButUnexpired() {
		// Rotation revokes immediately, and this row is the one a replay would
		// present. Deleting on revocation would discard the evidence at the
		// exact moment it starts being interesting.
		RefreshToken rotated = save("rotated", NOW.minus(Duration.ofMinutes(15)), NOW.plus(Duration.ofDays(29)));
		rotated.revoke(NOW.minus(Duration.ofMinutes(15)));
		this.refreshTokens.saveAndFlush(rotated);

		assertThat(this.cleanup.purgeExpired()).isZero();
		assertThat(this.refreshTokens.count()).isEqualTo(1);
	}

	@Test
	@DisplayName("deletes only what is past the window when rows of every age are present")
	void deletesOnlyThePastWindowRows() {
		save("live", NOW, NOW.plus(Duration.ofDays(30)));
		save("recently-expired", NOW.minus(Duration.ofDays(31)), NOW.minus(Duration.ofDays(1)));
		save("long-expired-a", NOW.minus(Duration.ofDays(40)), NOW.minus(Duration.ofDays(10)));
		save("long-expired-b", NOW.minus(Duration.ofDays(60)), NOW.minus(Duration.ofDays(30)));

		assertThat(this.cleanup.purgeExpired()).isEqualTo(2);
		assertThat(this.refreshTokens.findAll()).extracting(RefreshToken::getTokenHash)
			.containsExactlyInAnyOrder("live", "recently-expired");
	}

	@Test
	@DisplayName("boundary: a row expiring exactly at the cutoff is kept")
	void keepsRowAtTheCutoff() {
		// `<` rather than `<=`, so the row that is exactly at the edge survives.
		// An off-by-one here deletes a day early, which nothing would notice.
		save("exactly-at-cutoff", NOW.minus(Duration.ofDays(37)), NOW.minus(RETENTION));

		assertThat(this.cleanup.purgeExpired()).isZero();
	}

	private RefreshToken save(String hash, Instant issuedAt, Instant expiresAt) {
		return this.refreshTokens.saveAndFlush(RefreshToken.issue(hash, issuedAt, expiresAt));
	}

}
