package com.duanerontos.expensecalc.auth;

/**
 * Wrong username or wrong password.
 *
 * <p>One exception for both, with a message that does not say which. "No such
 * user" and "wrong password" are the same answer to anyone who is not the
 * account's owner.
 */
public class InvalidCredentialsException extends RuntimeException {

	public InvalidCredentialsException() {
		super("Those credentials are not valid.");
	}

}
