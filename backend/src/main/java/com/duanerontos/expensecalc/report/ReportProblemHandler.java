package com.duanerontos.expensecalc.report;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns a bad reporting period into RFC 7807 {@code application/problem+json}
 * (spec §8).
 *
 * <p><b>Scoped to {@link ReportController} deliberately.</b> A global
 * {@code IllegalArgumentException → 400} would be the shorter version of this
 * class and a much worse one: every internal precondition failure in the
 * application — a null nobody guarded, an invariant a service broke — would be
 * reported to the client as "you sent something wrong" and would stop appearing
 * as a 500 anybody investigates. The mapping is only safe where the exception is
 * known to describe the request.
 *
 * <p>This is the first piece of what spec §8 asks for across the whole API.
 * When #10 adds the expense endpoints it will want the same treatment, and the
 * shared parts of this belong in one place at that point rather than being
 * copied.
 */
@RestControllerAdvice(assignableTypes = ReportController.class)
public class ReportProblemHandler {

	private static final URI INVALID_PERIOD = URI.create("https://expense-calc.invalid/problems/invalid-period");

	@ExceptionHandler(InvalidReportPeriodException.class)
	public ProblemDetail handleInvalidPeriod(InvalidReportPeriodException problem) {
		return asProblem(problem.getMessage(), problem.getFields());
	}

	/**
	 * {@link ReportPeriod}'s own validation — an inverted or empty range —
	 * arrives as {@link IllegalArgumentException} from the record's constructor.
	 * It describes the request just as directly, so it gets the same treatment.
	 */
	@ExceptionHandler(IllegalArgumentException.class)
	public ProblemDetail handleInvalidArgument(IllegalArgumentException problem) {
		return asProblem(problem.getMessage(), List.of("from", "to"));
	}

	private static ProblemDetail asProblem(String detail, List<String> fields) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
		problem.setType(INVALID_PERIOD);
		problem.setTitle("Invalid reporting period");
		problem.setProperty("violations", fields.stream().map(field -> Map.of("field", field, "message", detail)).toList());
		return problem;
	}

}
