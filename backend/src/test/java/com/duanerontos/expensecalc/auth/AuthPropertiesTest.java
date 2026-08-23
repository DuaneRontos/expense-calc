package com.duanerontos.expensecalc.auth;

import java.time.Duration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The defaults and the one value that must not bind (issue #51).
 */
class AuthPropertiesTest {

	@Test
	@DisplayName("refuses a negative retention, which would delete live sessions")
	void rejectsNegativeRetention() {
		// Spring's DurationStyle parses a leading sign, so `-7d` binds cleanly.
		// The cutoff then lands seven days in the *future* and
		// `expires_at < cutoff` matches every live token — the housekeeping job
		// becomes a daily mass logout, logged as a success. Same argument as
		// SecurityStartupGuard: a configuration that works perfectly and does
		// the wrong thing is the worst outcome.
		assertThatThrownBy(() -> properties(Duration.ofDays(-7)))
			.isInstanceOf(IllegalArgumentException.class)
			.hasMessageContaining("app.auth.refresh-token-retention")
			.hasMessageContaining("sign every device out");
	}

	@Test
	@DisplayName("allows zero, which means delete at expiry")
	void allowsZeroRetention() {
		// A real choice, not a typo: keep no evidence window at all.
		assertThat(properties(Duration.ZERO).refreshTokenRetention()).isZero();
	}

	@Test
	@DisplayName("defaults the retention rather than requiring it")
	void defaultsRetention() {
		assertThat(properties(null).refreshTokenRetention()).isEqualTo(Duration.ofDays(7));
	}

	@Test
	@DisplayName("keeps the token lifetimes spec §9.2 names")
	void defaultsTokenLifetimes() {
		AuthProperties defaults = properties(null);

		// Short because an access token cannot be revoked: its lifetime is the
		// window a leaked one works in.
		assertThat(defaults.accessTokenTtl()).isEqualTo(Duration.ofMinutes(15));
		assertThat(defaults.refreshTokenTtl()).isEqualTo(Duration.ofDays(30));
	}

	private static AuthProperties properties(Duration retention) {
		return new AuthProperties("dev", "hash", "a".repeat(32), null, null, retention);
	}

}
