package com.duanerontos.expensecalc.auth;

import java.net.URI;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * RFC 7807 for the auth endpoints (spec §8).
 *
 * <p>Both failures are 401 and both carry a deliberately unhelpful detail. An
 * error that distinguishes "unknown user" from "wrong password", or "expired
 * token" from "no such token", is a probing oracle — and the user who typed
 * their password wrong is no better served by knowing which half was wrong.
 */
@RestControllerAdvice(assignableTypes = AuthController.class)
public class AuthProblemHandler {

	private static final URI UNAUTHENTICATED = URI.create("https://expense-calc.invalid/problems/unauthenticated");

	@ExceptionHandler(InvalidCredentialsException.class)
	public ProblemDetail handleInvalidCredentials(InvalidCredentialsException problem) {
		return asProblem(problem.getMessage(), "Sign in failed");
	}

	@ExceptionHandler(InvalidRefreshTokenException.class)
	public ProblemDetail handleInvalidRefreshToken(InvalidRefreshTokenException problem) {
		return asProblem(problem.getMessage(), "Session expired");
	}

	private static ProblemDetail asProblem(String detail, String title) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, detail);
		problem.setType(UNAUTHENTICATED);
		problem.setTitle(title);
		return problem;
	}

}
