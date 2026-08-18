package com.duanerontos.expensecalc.query;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * RFC 7807 for bad query parameters (spec §8).
 *
 * <p>Handles one exception type, scoped to one controller — the same shape
 * {@code ReportProblemHandler} arrived at, and for the same reason. A broader
 * mapping of {@link IllegalArgumentException} would also catch server-side
 * precondition failures deeper in the stack and report them to the client as
 * its own bad input, which stops them appearing as the 500s somebody
 * investigates.
 */
@RestControllerAdvice(assignableTypes = ExpenseQueryController.class)
public class ExpenseQueryProblemHandler {

	private static final URI INVALID_QUERY = URI.create("https://expense-calc.invalid/problems/invalid-query");

	@ExceptionHandler(InvalidExpenseQueryException.class)
	public ProblemDetail handleInvalidQuery(InvalidExpenseQueryException problem) {
		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, problem.getMessage());
		detail.setType(INVALID_QUERY);
		detail.setTitle("Invalid expense query");
		detail.setProperty("violations",
				problem.getFields().stream().map(field -> Map.of("field", field, "message", problem.getMessage())).toList());
		return detail;
	}

}
