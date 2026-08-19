package com.duanerontos.expensecalc.api;

import java.net.URI;
import java.util.List;
import java.util.Map;

import com.duanerontos.expensecalc.money.UnsupportedCurrencyException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * RFC 7807 for the expense write endpoints (spec §8).
 *
 * <p>Scoped to {@link ExpenseController}, like the other two handlers in this
 * codebase and for the same reason: a broader mapping would catch server-side
 * precondition failures deeper in the stack and report them as the caller's bad
 * input, which stops them appearing as the 500s somebody investigates.
 */
@RestControllerAdvice(assignableTypes = ExpenseController.class)
public class ExpenseProblemHandler {

	private static final URI INVALID_EXPENSE = URI.create("https://expense-calc.invalid/problems/invalid-expense");

	private static final URI NOT_FOUND = URI.create("https://expense-calc.invalid/problems/expense-not-found");

	@ExceptionHandler(ExpenseNotFoundException.class)
	public ProblemDetail handleNotFound(ExpenseNotFoundException problem) {
		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, problem.getMessage());
		detail.setType(NOT_FOUND);
		detail.setTitle("Expense not found");
		return detail;
	}

	/**
	 * A currency other than {@code PHP}.
	 *
	 * <p>Spec §9.6 rejects this at the API boundary, before persistence, so no
	 * aggregation can ever sum across currencies. A 400 rather than a 422
	 * because the value is simply not one the API accepts.
	 */
	@ExceptionHandler(UnsupportedCurrencyException.class)
	public ProblemDetail handleUnsupportedCurrency(UnsupportedCurrencyException problem) {
		return asProblem(problem.getMessage(), List.of("currency"));
	}

	@ExceptionHandler(InvalidExpenseException.class)
	public ProblemDetail handleInvalidExpense(InvalidExpenseException problem) {
		return asProblem(problem.getMessage(), List.of(problem.getField()));
	}

	/**
	 * The domain layer's own guards, as a net.
	 *
	 * <p>{@code Money.toMinorUnits} rejects sub-centavo amounts and long
	 * overflow; {@code ClassificationRecord.fromUser} rejects a reason past
	 * {@code MAX_REASON_LENGTH}. Each is currently shadowed by a controller
	 * pre-check or a bean-validation annotation — which is fine until the two
	 * copies drift. {@code MAX_REASON_LENGTH = 200} and {@code @Size(max = 200)}
	 * are independent literals with nothing tying them together; raise one and
	 * the other becomes a 500 for what is still bad input.
	 *
	 * <p>Scoped to this controller, so it cannot swallow a precondition failure
	 * from elsewhere in the application and report it as the caller's fault.
	 */
	@ExceptionHandler(IllegalArgumentException.class)
	public ProblemDetail handleDomainRejection(IllegalArgumentException problem) {
		return asProblem(problem.getMessage(), List.of("body"));
	}

	/**
	 * Bean-validation failures, one violation per offending field.
	 *
	 * <p>Each violation carries the message for <em>its own</em> field rather
	 * than repeating a summary, so a client rendering them inline points at the
	 * right input — which is the whole reason spec §8 asks for field-level
	 * violations instead of a single string.
	 */
	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ProblemDetail handleValidationFailure(MethodArgumentNotValidException problem) {
		List<Map<String, String>> violations = problem.getBindingResult()
			.getFieldErrors()
			.stream()
			.map(error -> Map.of("field", error.getField(), "message",
					error.getDefaultMessage() == null ? "is invalid" : error.getDefaultMessage()))
			.toList();

		ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
				"The request body is not valid.");
		detail.setType(INVALID_EXPENSE);
		detail.setTitle("Invalid expense");
		detail.setProperty("violations", violations);
		return detail;
	}

	private static ProblemDetail asProblem(String detail, List<String> fields) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
		problem.setType(INVALID_EXPENSE);
		problem.setTitle("Invalid expense");
		problem.setProperty("violations", fields.stream().map(field -> Map.of("field", field, "message", detail)).toList());
		return problem;
	}

}
