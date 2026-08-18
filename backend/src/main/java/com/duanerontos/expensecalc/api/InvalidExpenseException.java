package com.duanerontos.expensecalc.api;

/** A request body the caller cannot have meant. Becomes a 400 with violations. */
public class InvalidExpenseException extends RuntimeException {

	private final transient String field;

	public InvalidExpenseException(String message, String field) {
		super(message);
		this.field = field;
	}

	public String getField() {
		return this.field;
	}

}
