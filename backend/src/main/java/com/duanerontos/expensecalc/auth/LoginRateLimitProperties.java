package com.duanerontos.expensecalc.auth;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * How hard {@code POST /auth/login} pushes back on repeated attempts (issue #52).
 *
 * <p><b>Argon2id is the reason this exists, in both directions.</b> Spec §9.2
 * asks for it precisely because 4 MiB × 3 iterations makes each guess expensive
 * — and that same cost, on the one endpoint that must stay unauthenticated,
 * is a denial-of-service lever. Every attempt buys the caller a slice of a CPU
 * core. So the limit is not only about brute force; it is about who gets to
 * spend the server's time.
 *
 * <p><b>Two limits, because they defend against different things.</b> The
 * per-client backoff answers brute force: consecutive failures from one source
 * earn a lockout that grows fast. The global ceiling answers the distributed
 * version of the same attack, where no single source ever trips the first
 * limit. Neither subsumes the other, and a global limit alone would let any
 * attacker lock the real user out of their own account by burning the budget.
 *
 * @param freeAttempts consecutive failures a client may make before any lockout
 *     applies. Someone mistyping their own password twice should not be
 *     punished for it. Zero is legal and means "lock out from the first
 *     failure"
 * @param initialLockout the first lockout, applied on the failure after
 *     {@code freeAttempts}. Multiplied by {@link LoginRateLimiter#BACKOFF_FACTOR}
 *     on each further failure
 * @param maxLockout the ceiling the backoff stops at. Unbounded growth turns a
 *     forgotten password into a permanent lockout, which is a self-inflicted
 *     denial of service
 * @param globalAttemptsPerMinute attempts allowed across <em>all</em> clients
 *     each minute. Sized so a single user never notices it and a distributed
 *     guessing run does: at this rate an attacker gets fewer attempts per year
 *     than a password worth using has candidates
 * @param maxTrackedClients how many distinct clients the backoff remembers.
 *     <b>Bounded on purpose:</b> an unbounded map keyed by remote address is
 *     itself a memory-exhaustion vector, reachable by the same attacker this
 *     class exists to stop. Past the cap new clients go untracked and the
 *     global ceiling covers them, which is the case it was sized for. Zero
 *     turns the per-client backoff off and leaves only that ceiling
 */
@ConfigurationProperties(prefix = "app.auth.rate-limit")
public record LoginRateLimitProperties(Integer freeAttempts, Duration initialLockout, Duration maxLockout,
		Integer globalAttemptsPerMinute, Integer maxTrackedClients) {

	public LoginRateLimitProperties {
		// Boxed so that "unset" and "zero" are different values. As primitives
		// an absent property binds to 0, which is indistinguishable from
		// someone deliberately asking for no free attempts — and defaulting
		// `<= 0` to 2 then makes a strict configuration silently lenient.
		freeAttempts = (freeAttempts == null) ? 2 : freeAttempts;
		initialLockout = (initialLockout == null) ? Duration.ofSeconds(1) : initialLockout;
		maxLockout = (maxLockout == null) ? Duration.ofMinutes(5) : maxLockout;
		globalAttemptsPerMinute = (globalAttemptsPerMinute == null) ? 60 : globalAttemptsPerMinute;
		maxTrackedClients = (maxTrackedClients == null) ? 10_000 : maxTrackedClients;

		if (freeAttempts < 0 || maxTrackedClients < 0) {
			throw new IllegalArgumentException(
					("Refusing to start: app.auth.rate-limit.free-attempts is %d and max-tracked-clients is %d. "
							+ "Neither can be negative; use zero to lock out from the first failure, or to turn "
							+ "the per-client backoff off entirely.")
						.formatted(freeAttempts, maxTrackedClients));
		}

		// Zero here is not a strict setting, it is a closed door: the ceiling
		// is consumed by every attempt, so nobody could ever sign in.
		if (globalAttemptsPerMinute < 1) {
			throw new IllegalArgumentException(
					("Refusing to start: app.auth.rate-limit.global-attempts-per-minute is %d. Every attempt "
							+ "spends one, so anything below 1 refuses every sign-in including the right one.")
						.formatted(globalAttemptsPerMinute));
		}

		// A negative lockout reads as "no delay" and behaves as one, but it
		// would also make `lockedUntil` land in the past on every failure — the
		// limiter would run, count, log and let everything through. Same
		// argument as AuthProperties' retention check: a configuration that
		// works perfectly and does nothing is worse than one that fails.
		if (initialLockout.isNegative() || maxLockout.isNegative()) {
			throw new IllegalArgumentException(
					("Refusing to start: app.auth.rate-limit lockouts are %s and %s. A negative lockout leaves "
							+ "the limiter counting attempts and blocking none. Use zero to disable the backoff "
							+ "deliberately.")
						.formatted(initialLockout, maxLockout));
		}

		if (maxLockout.compareTo(initialLockout) < 0) {
			throw new IllegalArgumentException(
					("Refusing to start: app.auth.rate-limit.max-lockout (%s) is below initial-lockout (%s), so "
							+ "the ceiling would cap the first lockout and the backoff could never grow.")
						.formatted(maxLockout, initialLockout));
		}
	}

}
