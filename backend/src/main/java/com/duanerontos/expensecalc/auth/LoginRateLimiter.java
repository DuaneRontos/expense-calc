package com.duanerontos.expensecalc.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.stereotype.Component;

/**
 * Rate limits {@code POST /auth/login} (issue #52).
 *
 * <p><b>Checked before the password is verified.</b> Argon2id at 4 MiB × 3
 * iterations is what makes each guess expensive, which is the point against
 * brute force and a denial-of-service lever on the one endpoint that cannot
 * require authentication. A limiter that ran after the hash comparison would
 * spend exactly the CPU it exists to protect.
 *
 * <p><b>Two limits, defending against different attacks.</b> Consecutive
 * failures from one client earn a lockout that grows by
 * {@link #BACKOFF_FACTOR}; separately, a global ceiling caps attempts across
 * every client each minute. The first stops guessing from one source. The
 * second stops the distributed version, where no single source ever trips it —
 * and it is deliberately *not* the only limit, because a global limit alone
 * lets any attacker lock the real user out by burning the budget.
 *
 * <p><b>A client's failures decay after {@code maxLockout} of silence</b>, so
 * someone who mistyped their password last week does not meet a minute-long
 * lockout on their first mistake today. The escalation exists to stop
 * <em>rapid</em> guessing; spread out far enough to survive the decay, guessing
 * is slow enough that the global ceiling is the limit that matters.
 *
 * <p>That threshold is deliberately the same one {@code evictSettled} uses to
 * forget an idle client. <b>They have to agree.</b> When they did not, a quiet
 * client's history survived or vanished depending on how full the map happened
 * to be — so the same person, doing the same thing, was treated differently
 * according to how many strangers had failed in between.
 *
 * <p>The boundary reads as "wait out your penalty in full and you are
 * forgiven": a client that waits exactly {@code maxLockout} is not decayed, and
 * one that waits any longer is.
 *
 * <p><b>The global ceiling is itself a lockout lever, and the number is worth
 * stating.</b> A locked-out client throws before spending budget, so one
 * address burns roughly three to five attempts a minute — meaning fifteen to
 * twenty addresses are enough to keep 60/min spent and hold the real user out
 * indefinitely, at negligible cost to the attacker. This is strictly better
 * than a global limit alone, and it is not immunity. The cheap mitigation, if
 * it ever matters, is to reserve a slice of the budget for addresses with no
 * recorded failures: an attacker's addresses acquire history on their first
 * failure, so holding the reserve would need a constant supply of fresh ones
 * rather than a fixed handful.
 *
 * <p><b>{@code /auth/refresh} is deliberately not limited here.</b> It verifies
 * a SHA-256 digest against one indexed row rather than running Argon2, so it
 * lacks the asymmetry that makes login worth defending — but it is now the only
 * unauthenticated endpoint without a limit, which is worth knowing rather than
 * rediscovering.
 *
 * <p><b>State is in memory, and that is a real constraint.</b> v1 is
 * single-user and single-instance (spec §9.3), so there is nothing to share.
 * A second instance would give each its own counters and multiply the
 * effective limits by the instance count — so horizontal scaling needs this
 * moved to the database or a shared cache, not merely more instances.
 *
 * <p><b>Client identity is {@code getRemoteAddr()}, never a forwarded header.</b>
 * Parsing {@code X-Forwarded-For} here would let any caller pick their own
 * bucket by setting it, which is a bypass rather than a limit. Behind a proxy,
 * set {@code server.forward-headers-strategy} so the servlet container resolves
 * the real address from headers it has been told to trust — then this sees it.
 */
@Component
public class LoginRateLimiter {

	/**
	 * How fast the lockout grows: 1s, 4s, 16s, 64s, 256s, then the ceiling.
	 *
	 * <p>Four rather than two because a single user has no legitimate reason to
	 * fail repeatedly, so the sequence should leave the useful range quickly.
	 * Doubling gives an attacker roughly twice as many attempts before the same
	 * wall.
	 */
	static final int BACKOFF_FACTOR = 4;

	private static final Duration GLOBAL_WINDOW = Duration.ofMinutes(1);

	private final LoginRateLimitProperties properties;

	private final Clock clock;

	private final Map<String, Attempts> byClient = new ConcurrentHashMap<>();

	private final AtomicReference<Window> global;

	public LoginRateLimiter(LoginRateLimitProperties properties, Clock clock) {
		this.properties = properties;
		this.clock = clock;
		this.global = new AtomicReference<>(new Window(clock.instant(), 0));
	}

	/**
	 * Refuses the attempt, or spends one unit of the global budget on it.
	 *
	 * @param client the caller's remote address
	 * @throws TooManyLoginAttemptsException if this client is locked out, or the
	 *     global ceiling for the current minute is already spent
	 */
	public void check(String client) {
		Instant now = this.clock.instant();

		Attempts attempts = this.byClient.get(client);
		if (attempts != null) {
			Duration remaining = attempts.remainingLockout(now);
			if (!remaining.isZero()) {
				throw new TooManyLoginAttemptsException(remaining);
			}
		}

		// Consumed by every attempt that gets this far, successes included: the
		// hash verification below costs the same either way, and this ceiling
		// is about who spends the server's time rather than about who is
		// guessing.
		Duration untilBudgetRefills = consumeGlobalBudget(now);
		if (untilBudgetRefills != null) {
			throw new TooManyLoginAttemptsException(untilBudgetRefills);
		}
	}

	/** Records a rejected attempt and extends this client's lockout. */
	public void recordFailure(String client) {
		Instant now = this.clock.instant();

		if (!this.byClient.containsKey(client) && this.byClient.size() >= this.properties.maxTrackedClients()) {
			evictSettled(now);
			if (this.byClient.size() >= this.properties.maxTrackedClients()) {
				// Untracked rather than unbounded. The map is keyed by remote
				// address, so growing it without limit is a memory-exhaustion
				// vector reachable by the same attacker this class stops. A
				// client arriving past the cap is exactly the distributed case
				// the global ceiling was sized for.
				return;
			}
		}

		this.byClient.compute(client, (key, existing) -> {
			Attempts attempts = (existing == null) ? new Attempts() : existing;

			if (attempts.hasDecayed(now, this.properties.maxLockout())) {
				attempts.consecutiveFailures = 0;
			}

			attempts.consecutiveFailures++;
			attempts.lockedUntil = now.plus(lockoutAfter(attempts.consecutiveFailures));
			attempts.lastFailure = now;
			return attempts;
		});
	}

	/**
	 * Clears this client's backoff.
	 *
	 * <p>The global budget is deliberately not refunded — the attempt cost the
	 * server the same whether or not the password was right.
	 */
	public void recordSuccess(String client) {
		this.byClient.remove(client);
	}

	/**
	 * How long a client waits after {@code consecutiveFailures} rejections.
	 *
	 * <p>Capped, because unbounded growth turns a forgotten password into a
	 * permanent lockout — a denial of service the user inflicts on themselves.
	 */
	private Duration lockoutAfter(int consecutiveFailures) {
		int beyondFree = consecutiveFailures - this.properties.freeAttempts();
		Duration initial = this.properties.initialLockout();

		// Zero is a legal setting meaning "count, but never delay". Multiplying
		// it would loop forever without ever reaching the ceiling.
		if (beyondFree <= 0 || initial.isZero()) {
			return Duration.ZERO;
		}

		Duration ceiling = this.properties.maxLockout();
		Duration lockout = initial;
		for (int step = 1; step < beyondFree && lockout.compareTo(ceiling) < 0; step++) {
			lockout = lockout.multipliedBy(BACKOFF_FACTOR);
		}

		return (lockout.compareTo(ceiling) > 0) ? ceiling : lockout;
	}

	/**
	 * Takes one attempt from the current minute, rolling the window if it is over.
	 *
	 * <p>A fixed window rather than a sliding one: it needs a single reference
	 * to hold and it cannot be starved by bookkeeping. The known cost is that a
	 * burst straddling a boundary can reach twice the ceiling in quick
	 * succession, which for a limit this generous is not the interesting case.
	 *
	 * @return {@code null} when the attempt was allowed, otherwise how long
	 *     until the budget refills — derived from the window the refusal was
	 *     decided against, so the answer cannot disagree with the decision
	 */
	private Duration consumeGlobalBudget(Instant now) {
		while (true) {
			Window current = this.global.get();
			Window next;

			Duration elapsed = Duration.between(current.start(), now);
			if (elapsed.compareTo(GLOBAL_WINDOW) >= 0) {
				next = new Window(now, 1);
			}
			else if (current.used() >= this.properties.globalAttemptsPerMinute()) {
				// Measured against the window this decision was made against,
				// not against whatever `global` holds by the time the caller
				// asks. Re-reading it afterwards let another thread roll the
				// window in between, and the refused caller was then told to
				// wait a full minute when the budget had just refilled.
				Duration remaining = GLOBAL_WINDOW.minus(elapsed);
				return remaining.isNegative() ? Duration.ZERO : remaining;
			}
			else {
				next = new Window(current.start(), current.used() + 1);
			}

			if (this.global.compareAndSet(current, next)) {
				return null;
			}
		}
	}

	/**
	 * Drops clients whose lockout has expired and who have been quiet since.
	 *
	 * <p>Only entries past {@code maxLockout} of silence go: a client still
	 * inside its backoff is the one entry that must survive, or serving the
	 * limit would be a way to escape it.
	 *
	 * <p><b>A full scan, run on each failure from a new client once the map is
	 * full.</b> Bounded by the global ceiling rather than by anything here — at
	 * 60 attempts a minute that is at most 60 sweeps of
	 * {@code maxTrackedClients} entries per minute. Cheap at these numbers, and
	 * worth knowing before either is raised.
	 */
	private void evictSettled(Instant now) {
		for (Iterator<Map.Entry<String, Attempts>> entries = this.byClient.entrySet().iterator(); entries.hasNext();) {
			Attempts attempts = entries.next().getValue();
			// The same predicate the escalation decays on: an entry is
			// forgettable exactly when keeping it would no longer change what
			// happens to that client next.
			if (attempts.remainingLockout(now).isZero()
					&& attempts.hasDecayed(now, this.properties.maxLockout())) {
				entries.remove();
			}
		}
	}

	/** One client's consecutive failures. Mutated only inside {@code compute}. */
	private static final class Attempts {

		private int consecutiveFailures;

		private Instant lockedUntil = Instant.EPOCH;

		private Instant lastFailure = Instant.EPOCH;

		private Duration remainingLockout(Instant now) {
			Duration remaining = Duration.between(now, this.lockedUntil);
			return remaining.isNegative() ? Duration.ZERO : remaining;
		}

		/**
		 * Whether this client has been quiet long enough to start over.
		 *
		 * <p>One definition, used by both the escalation and the eviction sweep,
		 * so the two cannot drift into disagreeing about how long a failure
		 * counts for.
		 */
		private boolean hasDecayed(Instant now, Duration after) {
			return Duration.between(this.lastFailure, now).compareTo(after) > 0;
		}

	}

	/** The global ceiling's current minute. Replaced wholesale, never mutated. */
	private record Window(Instant start, int used) {
	}

}
