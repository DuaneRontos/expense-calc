package com.duanerontos.expensecalc.auth;

import java.time.Clock;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deletes refresh tokens nobody can use any more (issue #51).
 *
 * <p>Every login and every rotation inserts a row and nothing ever removed one,
 * so a client refreshing every fifteen minutes added roughly 35,000 rows a year,
 * none of them usable after thirty days.
 *
 * <p><b>Rows are kept past expiry on purpose, which is why this deletes on a
 * delay rather than on revocation.</b> {@code V4__create_refresh_token.sql} sets
 * out the reason: a retained row lets a replayed token be told apart from one
 * that never existed — the difference between "expired session" and "someone is
 * trying tokens". That argues for keeping them a while, not forever, and
 * {@code app.auth.refresh-token-retention} is that while.
 *
 * <p>Nothing acts on the distinction yet — {@link RefreshToken#isUsableAt}
 * records that the data is there and the behaviour is not. When family
 * revocation is built, it reads rows this job would otherwise have deleted, so
 * the retention window is its input rather than an unrelated setting.
 */
@Component
public class RefreshTokenCleanup {

	private static final Logger log = LoggerFactory.getLogger(RefreshTokenCleanup.class);

	private final RefreshTokenRepository refreshTokens;

	private final AuthProperties properties;

	private final Clock clock;

	public RefreshTokenCleanup(RefreshTokenRepository refreshTokens, AuthProperties properties, Clock clock) {
		this.refreshTokens = refreshTokens;
		this.properties = properties;
		this.clock = clock;
	}

	/**
	 * Removes rows that expired longer ago than the retention window.
	 *
	 * <p>Runs on a cron rather than a fixed delay so it does not fire during
	 * application startup — including in tests, where a job deleting rows a test
	 * had just written would be a confusing way to fail.
	 *
	 * <p><b>The zone is pinned, because a bare cron resolves against the JVM
	 * default.</b> Nothing here sets that default, so "03:15, off-peak" meant
	 * 03:15 UTC in a container — the middle of a Manila working day.
	 * {@code CLAUDE.md} states the rule without qualification: wall-clock
	 * decisions resolve against {@code Asia/Manila}, never UTC and never the
	 * host default. A cron is a wall-clock decision.
	 *
	 * <p>Neither placeholder carries an inline default, on purpose. The value
	 * lives once, in {@code application.yml}; a default here would be a second
	 * copy with nothing comparing the two.
	 *
	 * <p><b>Safe to run on every instance.</b> A second instance running this
	 * concurrently deletes rows the first already took, which is a no-op rather
	 * than a conflict, so this needs no leader election. Worth stating because
	 * the reflex for a scheduled job in a multi-instance deployment is to reach
	 * for one.
	 */
	@Scheduled(cron = "${app.auth.refresh-token-cleanup-cron}", zone = "${app.auth.refresh-token-cleanup-zone}")
	@Transactional
	public int purgeExpired() {
		Instant cutoff = this.clock.instant().minus(this.properties.refreshTokenRetention());
		int deleted = this.refreshTokens.deleteExpiredBefore(cutoff);

		if (deleted > 0) {
			log.info("Deleted {} refresh token(s) that expired before {}.", deleted, cutoff);
		}
		return deleted;
	}

}
