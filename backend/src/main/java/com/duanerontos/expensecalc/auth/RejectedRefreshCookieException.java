package com.duanerontos.expensecalc.auth;

/**
 * A refresh token that arrived by cookie and was rejected (issue #57).
 *
 * <p>Separate from {@link InvalidRefreshTokenException} only so the response can
 * carry a {@code Set-Cookie} that removes the dead credential. The browser
 * cannot drop an {@code httpOnly} cookie on its own and a script cannot either,
 * so a rejection that says nothing leaves the token in place until its
 * {@code Max-Age} — attaching it to every subsequent {@code /auth} request,
 * each a wasted round trip that fails the same way.
 *
 * <p>Carries the header value rather than the means to build it: the advice that
 * handles this has no constructor dependencies on purpose, because an
 * {@code @RestControllerAdvice} loads into every {@code @WebMvcTest} slice in
 * the project and a dependency those slices do not supply fails them all at
 * context load.
 */
public class RejectedRefreshCookieException extends RuntimeException {

	private static final long serialVersionUID = 1L;

	private final String clearingCookie;

	public RejectedRefreshCookieException(String clearingCookie, InvalidRefreshTokenException cause) {
		super(cause.getMessage(), cause);
		this.clearingCookie = clearingCookie;
	}

	/** A {@code Set-Cookie} matching the one that set it, with {@code Max-Age=0}. */
	public String clearingCookie() {
		return this.clearingCookie;
	}

}
