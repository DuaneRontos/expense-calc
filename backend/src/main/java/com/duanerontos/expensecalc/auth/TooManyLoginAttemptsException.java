package com.duanerontos.expensecalc.auth;

import java.time.Duration;

/**
 * Thrown when {@code POST /auth/login} is refused before the password is checked
 * (issue #52).
 *
 * <p><b>Before, not after, and that is the whole point.</b> Verifying the hash
 * first would spend exactly the CPU the limit exists to protect, so a refused
 * attempt would cost the server the same as an accepted one.
 *
 * <p>Carries how long the caller should wait so the handler can answer with a
 * {@code Retry-After} header. That figure says nothing about whether the
 * credentials were right — a client that is locked out is locked out either
 * way, which is what keeps this from becoming a probing oracle.
 */
public class TooManyLoginAttemptsException extends RuntimeException {

	private final transient Duration retryAfter;

	public TooManyLoginAttemptsException(Duration retryAfter) {
		super("Too many sign-in attempts. Try again later.");
		this.retryAfter = retryAfter;
	}

	public Duration retryAfter() {
		return this.retryAfter;
	}

}
