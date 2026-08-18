package com.duanerontos.expensecalc.api;

import java.util.UUID;

/** No expense with that id. Becomes a 404 (spec §8). */
public class ExpenseNotFoundException extends RuntimeException {

	public ExpenseNotFoundException(UUID id) {
		super("No expense with id %s.".formatted(id));
	}

}
