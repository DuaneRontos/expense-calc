package com.duanerontos.expensecalc.auth;

/**
 * The presented refresh token cannot be exchanged.
 *
 * <p>Carries no detail on purpose. Unknown, already rotated, revoked and expired
 * are one error to the caller: distinguishing them would let someone probe for
 * tokens that exist.
 */
public class InvalidRefreshTokenException extends RuntimeException {

	public InvalidRefreshTokenException() {
		super("The refresh token is not valid. Sign in again.");
	}

}
