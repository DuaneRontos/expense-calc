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
 * <p><b>It handles one exception type, and that is the point.</b> An earlier
 * version also mapped {@link IllegalArgumentException} here, reasoning that
 * {@link ReportPeriod}'s own validation throws it. Two things went wrong. The
 * controller's stack reaches into {@code ReportService}, where
 * {@code Category.valueOf} throws the same type — so a schema ahead of the jar
 * (V2 describes exactly that migration shape) reported a money-path failure as
 * the caller's bad dates, and never as a 500 anybody investigates. And Spring
 * matches handlers on the cause chain, so it also swallowed
 * {@code MethodArgumentTypeMismatchException}, replacing Boot's own problem
 * detail with one that blamed both bounds when only one was malformed.
 *
 * <p>The conversion now happens in the controller, where the exception is known
 * to describe the request. That is the only place it can be known.
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

	private static ProblemDetail asProblem(String detail, List<String> fields) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
		problem.setType(INVALID_PERIOD);
		problem.setTitle("Invalid reporting period");
		problem.setProperty("violations", fields.stream().map(field -> Map.of("field", field, "message", detail)).toList());
		return problem;
	}

}
