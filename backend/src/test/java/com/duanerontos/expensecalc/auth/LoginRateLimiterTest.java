package com.duanerontos.expensecalc.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

/**
 * The login rate limit of issue #52.
 *
 * <p>No Spring context and no Docker: the limiter takes a {@link Clock}, so
 * every question here — how far the backoff has grown, whether the window has
 * rolled — is answerable by moving the clock rather than by sleeping.
 */
class LoginRateLimiterTest {

	private static final String CLIENT = "203.0.113.7";

	private static final Instant START = Instant.parse("2026-08-23T10:00:00Z");

	/** A clock the test moves by hand. */
	private static final class MovableClock extends Clock {

		private Instant now = START;

		@Override
		public Instant instant() {
			return this.now;
		}

		@Override
		public ZoneOffset getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(java.time.ZoneId zone) {
			return this;
		}

		void advance(Duration by) {
			this.now = this.now.plus(by);
		}

	}

	private static LoginRateLimitProperties properties() {
		return new LoginRateLimitProperties(2, Duration.ofSeconds(1), Duration.ofMinutes(5), 60, 10_000);
	}

	@Test
	@DisplayName("lets a mistyped password through without any delay")
	void freeAttemptsAreFree() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(properties(), clock);

		// Two failures cost nothing: someone mistyping their own password is
		// the common case, and punishing it is how a limit becomes a support
		// ticket rather than a defence.
		for (int attempt = 0; attempt < 2; attempt++) {
			limiter.check(CLIENT);
			limiter.recordFailure(CLIENT);
		}

		assertThatCode(() -> limiter.check(CLIENT)).doesNotThrowAnyException();
	}

	@Test
	@DisplayName("locks out after the free attempts, and the lockout grows")
	void backoffGrows() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(properties(), clock);

		for (int attempt = 0; attempt < 3; attempt++) {
			limiter.check(CLIENT);
			limiter.recordFailure(CLIENT);
		}

		Duration first = lockoutFor(limiter);
		assertThat(first).isEqualTo(Duration.ofSeconds(1));

		clock.advance(first);
		limiter.check(CLIENT);
		limiter.recordFailure(CLIENT);

		// 1s, then 4s: the factor is 4 rather than 2 because a single user has
		// no legitimate reason to keep failing, so the sequence should leave
		// the useful range fast.
		assertThat(lockoutFor(limiter)).isEqualTo(Duration.ofSeconds(4));
	}

	@Test
	@DisplayName("stops growing at the ceiling, so a forgotten password is not a permanent lockout")
	void backoffIsCapped() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(properties(), clock);

		for (int attempt = 0; attempt < 20; attempt++) {
			clock.advance(Duration.ofMinutes(10));
			limiter.check(CLIENT);
			limiter.recordFailure(CLIENT);
		}

		assertThat(lockoutFor(limiter)).isEqualTo(Duration.ofMinutes(5));
	}

	@Test
	@DisplayName("clears the backoff once the client gets it right")
	void successResets() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(properties(), clock);

		for (int attempt = 0; attempt < 5; attempt++) {
			clock.advance(Duration.ofMinutes(10));
			limiter.check(CLIENT);
			limiter.recordFailure(CLIENT);
		}

		clock.advance(Duration.ofMinutes(10));
		limiter.recordSuccess(CLIENT);

		assertThatCode(() -> limiter.check(CLIENT)).doesNotThrowAnyException();
	}

	@Test
	@DisplayName("locks out one client without touching another")
	void backoffIsPerClient() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(properties(), clock);

		for (int attempt = 0; attempt < 3; attempt++) {
			limiter.check(CLIENT);
			limiter.recordFailure(CLIENT);
		}

		assertThatExceptionOfType(TooManyLoginAttemptsException.class).isThrownBy(() -> limiter.check(CLIENT));
		assertThatCode(() -> limiter.check("198.51.100.4")).doesNotThrowAnyException();
	}

	@Test
	@DisplayName("caps attempts across every client, which one client's backoff cannot do")
	void globalCeilingApplies() {
		MovableClock clock = new MovableClock();
		// Three attempts a minute, globally. Each from a different address, so
		// no per-client backoff ever engages — this is the distributed attack
		// the per-client limit is blind to by construction.
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(2, Duration.ofSeconds(1), Duration.ofMinutes(5), 3, 10_000), clock);

		for (int attempt = 0; attempt < 3; attempt++) {
			limiter.check("203.0.113." + attempt);
		}

		assertThatExceptionOfType(TooManyLoginAttemptsException.class)
			.isThrownBy(() -> limiter.check("203.0.113.99"));
	}

	@Test
	@DisplayName("refills the global budget when the minute rolls over")
	void globalCeilingRolls() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(2, Duration.ofSeconds(1), Duration.ofMinutes(5), 3, 10_000), clock);

		for (int attempt = 0; attempt < 3; attempt++) {
			limiter.check("203.0.113." + attempt);
		}

		clock.advance(Duration.ofMinutes(1));

		assertThatCode(() -> limiter.check("203.0.113.99")).doesNotThrowAnyException();
	}

	@Test
	@DisplayName("counts a successful attempt against the global budget too")
	void successStillCostsGlobalBudget() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(2, Duration.ofSeconds(1), Duration.ofMinutes(5), 2, 10_000), clock);

		// The ceiling is about who spends the server's Argon2 time, and a
		// correct password costs exactly as much to verify as a wrong one.
		limiter.check(CLIENT);
		limiter.recordSuccess(CLIENT);
		limiter.check(CLIENT);
		limiter.recordSuccess(CLIENT);

		assertThatExceptionOfType(TooManyLoginAttemptsException.class).isThrownBy(() -> limiter.check(CLIENT));
	}

	@Test
	@DisplayName("does not grow its map without bound as addresses keep changing")
	void trackedClientsAreBounded() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(0, Duration.ofSeconds(1), Duration.ofMinutes(5), 100_000, 16), clock);

		// The map is keyed by remote address, so without a cap this loop is a
		// memory-exhaustion vector reachable by the attacker the class exists
		// to stop. Past the cap a client goes untracked and the global ceiling
		// is what covers it.
		for (int attempt = 0; attempt < 500; attempt++) {
			limiter.recordFailure("198.51.100." + attempt);
		}

		assertThat(trackedClients(limiter)).isLessThanOrEqualTo(16);
	}

	@Test
	@DisplayName("keeps a client inside its lockout even when the map is full")
	void evictionNeverFreesALockedClient() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(0, Duration.ofMinutes(5), Duration.ofMinutes(5), 100_000, 4), clock);

		limiter.recordFailure(CLIENT);
		for (int attempt = 0; attempt < 200; attempt++) {
			limiter.recordFailure("198.51.100." + attempt);
		}

		// Serving the limit must not be a way to escape it.
		assertThatExceptionOfType(TooManyLoginAttemptsException.class).isThrownBy(() -> limiter.check(CLIENT));
	}

	@Test
	@DisplayName("reports how long the caller should wait")
	void reportsRetryAfter() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(properties(), clock);

		for (int attempt = 0; attempt < 3; attempt++) {
			limiter.check(CLIENT);
			limiter.recordFailure(CLIENT);
		}

		clock.advance(Duration.ofMillis(400));

		assertThatExceptionOfType(TooManyLoginAttemptsException.class).isThrownBy(() -> limiter.check(CLIENT))
			.satisfies((thrown) -> assertThat(thrown.retryAfter()).isEqualTo(Duration.ofMillis(600)));
	}

	@Test
	@DisplayName("refuses a negative lockout rather than counting attempts and blocking none")
	void rejectsNegativeLockout() {
		assertThatExceptionOfType(IllegalArgumentException.class)
			.isThrownBy(() -> new LoginRateLimitProperties(2, Duration.ofSeconds(-1), Duration.ofMinutes(5), 60, 10))
			.withMessageContaining("counting attempts and blocking none");
	}

	@Test
	@DisplayName("refuses a ceiling below the first lockout, which could never grow")
	void rejectsCeilingBelowInitial() {
		assertThatExceptionOfType(IllegalArgumentException.class)
			.isThrownBy(() -> new LoginRateLimitProperties(2, Duration.ofMinutes(5), Duration.ofSeconds(1), 60, 10))
			.withMessageContaining("could never grow");
	}

	@Test
	@DisplayName("treats a zero lockout as 'count but never delay' rather than looping forever")
	void zeroLockoutIsLegal() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(1, Duration.ZERO, Duration.ofMinutes(5), 60, 10_000), clock);

		// Multiplying zero by the backoff factor never reaches the ceiling, so
		// the growth loop has to special-case it or it does not terminate.
		for (int attempt = 0; attempt < 5; attempt++) {
			limiter.recordFailure(CLIENT);
		}

		assertThatCode(() -> limiter.check(CLIENT)).doesNotThrowAnyException();
	}

	@Test
	@DisplayName("locks out from the very first failure when no attempts are free")
	void zeroFreeAttemptsIsExpressible() {
		MovableClock clock = new MovableClock();
		// Zero has to survive binding. As a primitive it is what an *unset*
		// property binds to, so a limiter that defaults `<= 0` to two silently
		// turns the strictest configuration into a lenient one.
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(0, Duration.ofSeconds(1), Duration.ofMinutes(5), 60, 10_000), clock);

		limiter.check(CLIENT);
		limiter.recordFailure(CLIENT);

		assertThatExceptionOfType(TooManyLoginAttemptsException.class).isThrownBy(() -> limiter.check(CLIENT));
	}

	@Test
	@DisplayName("tracking nobody leaves the global ceiling as the only limit")
	void zeroTrackedClientsIsExpressible() {
		MovableClock clock = new MovableClock();
		LoginRateLimiter limiter = new LoginRateLimiter(
				new LoginRateLimitProperties(0, Duration.ofMinutes(5), Duration.ofMinutes(5), 4, 0), clock);

		limiter.check(CLIENT);
		limiter.recordFailure(CLIENT);

		// No per-client memory, so no backoff — but the ceiling still bites.
		assertThatCode(() -> limiter.check(CLIENT)).doesNotThrowAnyException();
		limiter.check(CLIENT);
		limiter.check(CLIENT);
		assertThatExceptionOfType(TooManyLoginAttemptsException.class).isThrownBy(() -> limiter.check(CLIENT));
	}

	@Test
	@DisplayName("refuses a global ceiling that would turn every sign-in away")
	void rejectsUnreachableGlobalCeiling() {
		assertThatExceptionOfType(IllegalArgumentException.class)
			.isThrownBy(() -> new LoginRateLimitProperties(2, Duration.ofSeconds(1), Duration.ofMinutes(5), 0, 10))
			.withMessageContaining("refuses every sign-in");
	}

	@Test
	@DisplayName("refuses a negative count rather than treating it as a default")
	void rejectsNegativeCounts() {
		assertThatExceptionOfType(IllegalArgumentException.class)
			.isThrownBy(() -> new LoginRateLimitProperties(-1, Duration.ofSeconds(1), Duration.ofMinutes(5), 60, 10))
			.withMessageContaining("Neither can be negative");
	}

	/** The lockout currently in force, read back through the public surface. */
	private static Duration lockoutFor(LoginRateLimiter limiter) {
		try {
			limiter.check(CLIENT);
			return Duration.ZERO;
		}
		catch (TooManyLoginAttemptsException refused) {
			return refused.retryAfter();
		}
	}

	private static int trackedClients(LoginRateLimiter limiter) {
		int tracked = 0;
		for (int attempt = 0; attempt < 500; attempt++) {
			try {
				limiter.check("198.51.100." + attempt);
			}
			catch (TooManyLoginAttemptsException refused) {
				tracked++;
			}
		}
		return tracked;
	}

}
