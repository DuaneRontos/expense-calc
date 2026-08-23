package com.duanerontos.expensecalc.auth;

/**
 * Thrown when {@code POST /auth/refresh} carries no token at all (issue #57).
 *
 * <p>Distinct from {@link InvalidRefreshTokenException}, and deliberately so:
 * that one is a 401 meaning "your session is over", which is what a client acts
 * on by signing in again. This is a 400 meaning "you sent nothing to exchange",
 * which is a caller bug — most likely a web client that forgot
 * {@code credentials: 'include'}, so the cookie never left the browser.
 *
 * <p>Telling them apart matters more than it looks. Collapsing this into a 401
 * would make a misconfigured fetch indistinguishable from an expired session,
 * and the client would respond by bouncing the user to a sign-in screen that
 * "works" and then fails again on the next refresh.
 */
public class MissingRefreshTokenException extends RuntimeException {

	public MissingRefreshTokenException() {
		super("No refresh token. Send one in the body, or sign in as 'web' so the browser holds a cookie "
				+ "and call this with credentials included.");
	}

}
