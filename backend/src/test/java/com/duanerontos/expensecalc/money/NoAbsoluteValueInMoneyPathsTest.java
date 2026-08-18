package com.duanerontos.expensecalc.money;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The money conventions that a machine can be certain about, as build failures
 * rather than as conventions.
 *
 * <p><b>No absolute value</b> (issue #8). A refund is a negative amount that
 * keeps the category of what it refunds, so a category total is <em>net</em>.
 * {@code abs()} anywhere in a money path turns it back into gross and does it
 * silently: every number still looks plausible, the report is simply wrong by
 * twice the refunds, and nothing fails until somebody reconciles against a bank
 * statement.
 *
 * <p><b>No {@code double} or {@code float}</b> (CLAUDE.md: "a {@code double}
 * anywhere in a money path is a bug even when the test passes"). Same idea,
 * same reason it needs a machine: the arithmetic looks right until the set is
 * large enough or the value awkward enough.
 *
 * <p>Both scans cover Java <em>and</em> {@code src/main/resources} — the
 * migrations and any JPQL live there or in {@code @Query} strings, and
 * reporting aggregates in SQL rather than in the JVM, so a scan that only read
 * Java would miss the path the aggregation will actually take.
 *
 * <p><b>Scope, stated honestly.</b> This catches spellings. "Filters out
 * negatives" and "assumes totals are non-negative" have no single spelling — a
 * future {@code WHERE amount_minor > 0}, or a chart clamping an axis, is not
 * caught here. The {@code money-safety-auditor} subagent covers the judgement
 * half; this covers the half that is mechanical.
 */
class NoAbsoluteValueInMoneyPathsTest {

	/** Relative to the module directory, which is Surefire's working directory. */
	private static final List<Path> SOURCE_ROOTS = List.of(Path.of("src/main/java/com/duanerontos/expensecalc"),
			Path.of("src/main/resources"));

	private static final Set<String> SCANNED_EXTENSIONS = Set.of(".java", ".sql", ".yml");

	/**
	 * Deliberate exclusions, by path suffix. Empty, and adding to it should feel
	 * like a decision — it exists so that an exclusion is a one-line change with
	 * a reason next to it rather than a rewrite of the assertion.
	 */
	private static final Set<String> ALLOWED = Set.of();

	/** Any call spelled {@code abs(}, including JPQL, SQL, and {@code Math.abs}. */
	private static final Pattern ABS = Pattern.compile("\\babs\\s*\\(", Pattern.CASE_INSENSITIVE);

	/** The types, not the words — {@code double-counting} in prose is fine. */
	private static final Pattern BINARY_FLOAT = Pattern.compile("\\b(double|float)\\b");

	private record Line(Path file, int number, String text) {

		@Override
		public String toString() {
			return "%s:%d  %s".formatted(this.file, this.number, this.text.strip());
		}
	}

	private static List<Path> sources() throws IOException {
		List<Path> found = new ArrayList<>();
		for (Path root : SOURCE_ROOTS) {
			try (Stream<Path> paths = Files.walk(root)) {
				paths.filter(Files::isRegularFile)
					.filter(path -> SCANNED_EXTENSIONS.stream().anyMatch(path.toString()::endsWith))
					.filter(path -> ALLOWED.stream().noneMatch(path.toString()::endsWith))
					.forEach(found::add);
			}
		}
		return found;
	}

	/**
	 * Code lines only.
	 *
	 * <p>Comments are skipped because the rule has to be describable in the prose
	 * that explains it — before this, rewording a javadoc to mention
	 * {@code Math.abs} failed the build with no code change, which makes the
	 * guard punish the documentation it depends on.
	 *
	 * <p>Imports stay in scope: {@code import static java.lang.Math.abs;} is a
	 * real hit and the line is not a comment.
	 */
	private static List<Line> codeLines() throws IOException {
		List<Line> lines = new ArrayList<>();
		for (Path source : sources()) {
			List<String> all = Files.readAllLines(source);
			boolean inBlockComment = false;
			for (int index = 0; index < all.size(); index++) {
				String raw = all.get(index);
				String trimmed = raw.strip();
				if (inBlockComment) {
					if (trimmed.contains("*/")) {
						inBlockComment = false;
					}
					continue;
				}
				if (trimmed.startsWith("/*")) {
					inBlockComment = !trimmed.contains("*/");
					continue;
				}
				if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("--")
						|| trimmed.startsWith("#")) {
					continue;
				}
				lines.add(new Line(source, index + 1, raw));
			}
		}
		return lines;
	}

	@Test
	@DisplayName("finds the sources it claims to scan, so it cannot pass by looking at nothing")
	void findsTheSources() throws IOException {
		// Without this the whole guard degrades to a no-op the day a path
		// changes: a scan that found zero files would report clean forever. A
		// guard that cannot fail is worse than none, because it reads as coverage.
		assertThat(sources()).hasSizeGreaterThanOrEqualTo(14);
		assertThat(sources()).anyMatch(path -> path.toString().endsWith(".sql"));
		assertThat(codeLines()).hasSizeGreaterThanOrEqualTo(200);
	}

	@Test
	@DisplayName("takes no absolute value, in Java or in SQL")
	void takesNoAbsoluteValue() throws IOException {
		List<Line> offenders = codeLines().stream().filter(line -> ABS.matcher(line.text()).find()).toList();

		assertThat(offenders)
			.as("abs() makes a net total gross. A refund is a negative amount that keeps its category (spec §5), so nothing fails until someone reconciles against a bank statement. If a path genuinely is not a money path, add it to ALLOWED with a reason.")
			.isEmpty();
	}

	@Test
	@DisplayName("keeps binary floating point out of the money packages")
	void usesNoBinaryFloatingPoint() throws IOException {
		List<Line> offenders = codeLines().stream().filter(line -> BINARY_FLOAT.matcher(line.text()).find()).toList();

		assertThat(offenders)
			.as("CLAUDE.md: a double anywhere in a money path is a bug even when the test passes. Amounts are integer centavos and BigDecimal; neither needs binary floating point.")
			.isEmpty();
	}

}
