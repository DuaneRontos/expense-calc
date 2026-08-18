package com.duanerontos.expensecalc.money;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Issue #8's prohibition, as a build failure rather than a convention.
 *
 * <p>A refund is a negative amount that keeps the category of what it refunds,
 * so a category total is <em>net</em>. {@code abs()} anywhere in a money path
 * turns that back into gross and does it silently: every number still looks
 * plausible, the report is simply wrong by twice the refunds, and nothing fails
 * until somebody reconciles against a bank statement.
 *
 * <p>The aggregation this protects does not exist yet — grouping by category
 * needs #9 — which is exactly why the guard goes in now. It costs nothing while
 * there is nothing to catch, and it is waiting when #12 is written.
 *
 * <p><b>Scope, stated honestly.</b> This catches the mechanical half of the
 * prohibition. "Filters out negatives" and "assumes totals are non-negative"
 * have no single spelling to grep for — a {@code WHERE amount_minor > 0} in a
 * future query, or a chart clamping an axis, will not be caught here. The
 * {@code money-safety-auditor} subagent covers the judgement half; this covers
 * the half a machine can be certain about.
 */
class NoAbsoluteValueInMoneyPathsTest {

	/** Relative to the module directory, which is Surefire's working directory. */
	private static final Path SOURCE_ROOT = Path.of("src/main/java/com/duanerontos/expensecalc");

	private static List<Path> sources() throws IOException {
		try (Stream<Path> paths = Files.walk(SOURCE_ROOT)) {
			return paths.filter(path -> path.toString().endsWith(".java")).toList();
		}
	}

	@Test
	@DisplayName("finds the sources it claims to scan, so it cannot pass by looking at nothing")
	void findsTheSources() throws IOException {
		// Without this the whole guard degrades to a no-op the day the path
		// changes: Files.walk over a missing directory throws, but a scan that
		// found zero files would report clean forever. A guard that cannot fail
		// is worse than no guard, because it reads like coverage.
		assertThat(SOURCE_ROOT).exists().isDirectory();
		assertThat(sources()).hasSizeGreaterThanOrEqualTo(10);
	}

	@Test
	@DisplayName("takes no absolute value anywhere in main")
	void takesNoAbsoluteValue() throws IOException {
		for (Path source : sources()) {
			String body = Files.readString(source);

			assertThat(body)
				.as("%s calls abs(). A refund is a negative amount that keeps its category (spec §5), so a total is net; abs() makes it gross and nothing fails until someone reconciles against a bank statement. If this is genuinely not a money path, exclude it here deliberately.",
						source)
				.doesNotContain("Math.abs")
				.doesNotContain(".abs()");
		}
	}

}
