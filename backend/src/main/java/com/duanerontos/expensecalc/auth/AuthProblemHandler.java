package com.duanerontos.expensecalc.auth;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
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

	/**
	 * Named for its meaning, not its status.
	 *
	 * <p>A generic {@code /problems/bad-request} is what the next auth handler
	 * needing a 400 would reach for — and the web client reads this exact URI as
	 * "signed out", so that reuse would sign a user out over an unrelated
	 * validation failure with both test suites still green. Distinct from
	 * {@link #INVALID_REQUEST} for the same reason.
	 */
	private static final URI NO_REFRESH_TOKEN = URI.create("https://expense-calc.invalid/problems/no-refresh-token");

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
	 * {@code 401} that takes the dead cookie with it.
	 *
	 * <p>A script cannot delete an {@code httpOnly} cookie, so without this a
	 * browser keeps a rejected refresh token for the full {@code Max-Age} — 30
	 * days — and attaches it to every {@code /auth} request, each one a wasted
	 * round trip that 401s. Only {@code /auth/logout} could clear it, and a
	 * signed-out user cannot reach that.
	 *
	 * <p><b>The header arrives on the exception rather than being built here.</b>
	 * This advice deliberately has no constructor dependencies: an
	 * {@code @RestControllerAdvice} is loaded into every {@code @WebMvcTest}
	 * slice in the project, not only the ones testing its own controller, so a
	 * dependency the slice does not supply fails all of them at context load.
	 * The controller has the cookie helper and knows the request came by cookie,
	 * so it is the right place to decide.
	 */
	@ExceptionHandler(RejectedRefreshCookieException.class)
	public ResponseEntity<ProblemDetail> handleRejectedRefreshCookie(RejectedRefreshCookieException problem) {
		return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
			.header(HttpHeaders.SET_COOKIE, problem.clearingCookie())
			.body(asProblem(problem.getMessage(), "Session expired"));
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
		detail.setType(NO_REFRESH_TOKEN);
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

	/**
	 * A body sent as the wrong content type.
	 *
	 * <p>Same {@code /error}-dispatch mechanism as the two handlers above: left
	 * unhandled it answers {@code 401} with an empty body, so "you sent
	 * text/plain" arrives as "your credentials are wrong". A correct client
	 * always sends JSON, which is exactly why this one is worth catching — the
	 * caller who trips it has no other clue.
	 *
	 * <p>{@code HttpRequestMethodNotSupportedException} is deliberately not here:
	 * it is raised at mapping time, before a handler resolves, so a
	 * controller-scoped advice never sees it.
	 */
	@ExceptionHandler(HttpMediaTypeNotSupportedException.class)
	public ProblemDetail handleUnsupportedMediaType(HttpMediaTypeNotSupportedException problem) {
		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
				"Send this as application/json.");
		detail.setType(INVALID_REQUEST);
		detail.setTitle("Unsupported media type");
		return detail;
	}

	private static ProblemDetail asProblem(String detail, String title) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, detail);
		problem.setType(UNAUTHENTICATED);
		problem.setTitle(title);
		return problem;
	}

}
