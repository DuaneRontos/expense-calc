package com.duanerontos.expensecalc.auth;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
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

	private static final URI BAD_REFRESH_REQUEST = URI.create("https://expense-calc.invalid/problems/bad-request");

	private static final URI CSRF_REQUIRED = URI.create("https://expense-calc.invalid/problems/csrf-required");

	private static final URI INVALID_REQUEST = URI.create("https://expense-calc.invalid/problems/invalid-request");

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

	/**
	 * {@code 400} — nothing was sent to exchange.
	 *
	 * <p>Not a 401. An expired session and a client that forgot to include its
	 * credentials both leave a caller signed out, but only one of them is fixed
	 * by signing in again (issue #57).
	 */
	@ExceptionHandler(MissingRefreshTokenException.class)
	public ProblemDetail handleMissingRefreshToken(MissingRefreshTokenException problem) {
		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, problem.getMessage());
		detail.setType(BAD_REFRESH_REQUEST);
		detail.setTitle("No refresh token");
		return detail;
	}

	/** {@code 403} — a cookie-borne refresh with nothing to show it was not cross-site. */
	@ExceptionHandler(MissingCsrfHeaderException.class)
	public ProblemDetail handleMissingCsrfHeader(MissingCsrfHeaderException problem) {
		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, problem.getMessage());
		detail.setType(CSRF_REQUIRED);
		detail.setTitle("Cross-site request blocked");
		return detail;
	}

	/**
	 * Bean-validation failures on an auth request, as spec §8's field-level
	 * violations.
	 *
	 * <p><b>Without this the answer is a 401, which is a lie.</b> An unhandled
	 * exception leaves the controller, Spring forwards to {@code /error}, and
	 * that dispatch goes back through a filter chain requiring authentication —
	 * so "you left out a field" arrives as "your credentials are wrong". The
	 * client then retries the same broken request with the same credentials,
	 * forever. Reachable since the login request required {@code client}
	 * (issue #57), and no less wrong for a blank username before that.
	 */
	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ProblemDetail handleValidationFailure(MethodArgumentNotValidException problem) {
		List<Map<String, String>> violations = problem.getBindingResult()
			.getFieldErrors()
			.stream()
			.map((error) -> Map.of("field", error.getField(), "message",
					(error.getDefaultMessage() == null) ? "is invalid" : error.getDefaultMessage()))
			.toList();

		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
				"The request body is not valid.");
		detail.setType(INVALID_REQUEST);
		detail.setTitle("Invalid request");
		detail.setProperty("violations", violations);
		return detail;
	}

	/**
	 * A body Jackson could not read at all — including an unknown
	 * {@link ClientType}.
	 *
	 * <p>Same reasoning as above: it would otherwise surface as a 401. The
	 * detail comes from the deserialiser, which for a bad client says which
	 * values are accepted.
	 */
	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ProblemDetail handleUnreadableBody(HttpMessageNotReadableException problem) {
		Throwable cause = problem.getMostSpecificCause();

		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
				(cause instanceof IllegalArgumentException) ? cause.getMessage() : "The request body is not valid.");
		detail.setType(INVALID_REQUEST);
		detail.setTitle("Invalid request");
		return detail;
	}

	private static ProblemDetail asProblem(String detail, String title) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, detail);
		problem.setType(UNAUTHENTICATED);
		problem.setTitle(title);
		return problem;
	}

}
