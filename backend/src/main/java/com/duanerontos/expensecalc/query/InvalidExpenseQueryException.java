package com.duanerontos.expensecalc.query;

import java.util.List;

/**
 * A query the caller cannot have meant.
 *
 * <p>Carries the offending fields so the response can point at them: spec §8
 * wants field-level violations on a 400, and the client surfaces {@code detail}
 * inline against the field rather than in a toast.
 */
public class InvalidExpenseQueryException extends RuntimeException {

	private final transient List<String> fields;

	public InvalidExpenseQueryException(String message, List<String> fields) {
		super(message);
		this.fields = List.copyOf(fields);
	}

	public List<String> getFields() {
		return this.fields;
	}

}
