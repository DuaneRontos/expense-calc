package com.duanerontos.expensecalc.query;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

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
		return asProblem(problem.getMessage(), problem.getFields());
	}

	/**
	 * Spring's own binding failures, which never reached this advice before.
	 *
	 * <p>{@code ?from=2026-13-99} is the most ordinary typo on this endpoint and
	 * it produced a 400 with an <em>empty body</em> — no type, no title, no
	 * violations — so the client's "surface detail against the offending field"
	 * path, the reason {@link InvalidExpenseQueryException} carries fields at
	 * all, had nothing to render for the commonest case. Same for a non-numeric
	 * {@code page} or {@code size}.
	 *
	 * <p>{@code getName()} is the parameter that failed to bind, so the
	 * violation points at the right field without guessing.
	 */
	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	public ProblemDetail handleUnbindableParameter(MethodArgumentTypeMismatchException problem) {
		return asProblem("%s is not a valid value for %s.".formatted(problem.getValue(), problem.getName()),
				List.of(problem.getName()));
	}

	private static ProblemDetail asProblem(String detail, List<String> fields) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
		problem.setType(INVALID_QUERY);
		problem.setTitle("Invalid expense query");
		// Each violation names its own field. The message repeats detail only
		// because every failure here reports one field; when one reports two,
		// this is where they need to diverge rather than both describing one.
		problem.setProperty("violations", fields.stream().map(field -> Map.of("field", field, "message", detail)).toList());
		return problem;
	}

}
