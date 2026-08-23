package com.duanerontos.expensecalc.auth;

import java.net.URI;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * RFC 7807 for the auth endpoints (spec §8).
 *
 * <p>The two credential failures are 401 and both carry a deliberately
 * unhelpful detail. An error that distinguishes "unknown user" from "wrong
 * password", or "expired token" from "no such token", is a probing oracle — and
 * the user who typed their password wrong is no better served by knowing which
 * half was wrong.
 *
 * <p>A rate-limited attempt is a 429 and says nothing about the credentials at
 * all, because it is raised before they are looked at (issue #52).
 */
@RestControllerAdvice(assignableTypes = AuthController.class)
public class AuthProblemHandler {

	private static final URI UNAUTHENTICATED = URI.create("https://expense-calc.invalid/problems/unauthenticated");

	private static final URI RATE_LIMITED = URI.create("https://expense-calc.invalid/problems/too-many-attempts");

	@ExceptionHandler(InvalidCredentialsException.class)
	public ProblemDetail handleInvalidCredentials(InvalidCredentialsException problem) {
		return asProblem(problem.getMessage(), "Sign in failed");
	}

	@ExceptionHandler(InvalidRefreshTokenException.class)
	public ProblemDetail handleInvalidRefreshToken(InvalidRefreshTokenException problem) {
		return asProblem(problem.getMessage(), "Session expired");
	}

	/**
	 * {@code 429} with {@code Retry-After}, in seconds.
	 *
	 * <p>Rounded <em>up</em>: a client that waits the number of seconds this
	 * reports should find the lockout over, and rounding down would send it
	 * back a few milliseconds early to be refused again. A sub-second lockout
	 * still reports 1 for the same reason.
	 *
	 * <p>Returned as a {@code ResponseEntity} rather than a bare
	 * {@link ProblemDetail} because the header is the part a client can act on
	 * without parsing the body.
	 */
	@ExceptionHandler(TooManyLoginAttemptsException.class)
	public ResponseEntity<ProblemDetail> handleTooManyAttempts(TooManyLoginAttemptsException problem) {
		long retryAfterSeconds = Math.max(1, (problem.retryAfter().toMillis() + 999) / 1000);

		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS,
				"Too many sign-in attempts. Try again in %d second(s).".formatted(retryAfterSeconds));
		detail.setType(RATE_LIMITED);
		detail.setTitle("Too many attempts");

		return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
			.header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds))
			.body(detail);
	}

	private static ProblemDetail asProblem(String detail, String title) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, detail);
		problem.setType(UNAUTHENTICATED);
		problem.setTitle(title);
		return problem;
	}

}
