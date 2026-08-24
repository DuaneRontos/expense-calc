package com.duanerontos.expensecalc.auth;

/**
 * Thrown when a cookie-authenticated refresh arrives without
 * {@link RefreshCookies#CSRF_HEADER} (issue #57).
 *
 * <p>403 rather than 400: the request is well-formed and the credential is
 * genuine — the browser attached it. What is missing is any evidence the
 * <em>page</em> that caused it was ours, which is the whole of CSRF. A 400
 * would read as "you sent something malformed" to a client that sent exactly
 * what it meant to.
 */
public class MissingCsrfHeaderException extends RuntimeException {

	public MissingCsrfHeaderException() {
		super("A refresh authenticated by cookie must carry the %s header. A browser attaches the cookie on "
				+ "its own, so the header is what shows the request came from this application rather than "
				+ "from a page that merely linked to it.".formatted(RefreshCookies.CSRF_HEADER));
	}

}
