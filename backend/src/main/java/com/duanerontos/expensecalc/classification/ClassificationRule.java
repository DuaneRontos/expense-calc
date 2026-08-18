package com.duanerontos.expensecalc.classification;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import com.duanerontos.expensecalc.expense.Category;

/**
 * One rule in the ordered table: some keywords, the category they imply, the
 * fields they may be found in, and an optional {@link AmountGuard}.
 *
 * <p><b>There is no way to build a rule without keywords.</b> The constructor
 * rejects it, and every factory below requires at least one. This is spec §5's
 * "amount alone never determines a category" expressed as a type invariant
 * rather than a convention — a convention is something a future rule can be
 * written in violation of, and this is not.
 *
 * <p><b>Keywords match whole words, case-insensitively, with an optional
 * trailing "s".</b> Plain substring matching would put {@code Smart} inside
 * {@code smartphone} and {@code SM} inside {@code Smart}, which is how a phone
 * purchase becomes a phone bill. The boundaries are lookarounds rather than
 * {@code \b} so that a keyword may begin or end with punctuation — {@code S&R}
 * works, and still does not match inside {@code MS&RT}. The optional plural
 * covers the ordinary phrasings ({@code tolls}, {@code subscriptions}) without
 * a second keyword each; irregular plurals still need spelling out, since
 * {@code grocery} plus an {@code s} is not {@code groceries}.
 *
 * <p><b>Character classes are Unicode-aware.</b> Java's {@code \s} and {@code
 * \w} default to ASCII, and {@code UNICODE_CASE} does not change that — it
 * affects case folding only. Without {@code UNICODE_CHARACTER_CLASS} a
 * non-breaking space, which pasted statement text carries routinely, does not
 * count as whitespace and does not break a word: "phone bill" would miss
 * the {@code phone bill} keyword and then match a bare {@code phone}, filing a
 * monthly bill as a durable good.
 *
 * <p>Not a record, deliberately. {@link Pattern} inherits identity equality, so
 * a record holding one would compare rules by reference — two rules built from
 * identical arguments unequal, and a hash that changes run to run. Keywords are
 * therefore the value identity and the compiled pattern is derived from them
 * and excluded from {@link #equals}.
 */
public final class ClassificationRule {

	/** Keywords are tokenized on single spaces, so collapse them first. */
	private static final Pattern WHITESPACE = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

	private final String name;

	private final Category category;

	private final Set<MatchField> fields;

	private final List<String> keywords;

	private final AmountGuard amountGuard;

	/** Derived from {@link #keywords}; excluded from equality. */
	private final Pattern pattern;

	public ClassificationRule(String name, Category category, Set<MatchField> fields, List<String> keywords,
			AmountGuard amountGuard) {
		if (name == null || name.isBlank()) {
			throw new IllegalArgumentException("A rule needs a name; it is what the classification record cites.");
		}
		if (category == null) {
			throw new IllegalArgumentException("Rule %s needs a category.".formatted(name));
		}
		if (category == Category.UNCLASSIFIED) {
			throw new IllegalArgumentException(
					"Rule %s targets UNCLASSIFIED, which is where an expense lands when nothing matched. A rule that assigns it would make an unmatched expense indistinguishable from a matched one."
						.formatted(name));
		}
		if (fields == null || fields.isEmpty()) {
			throw new IllegalArgumentException("Rule %s reads no field, so it can never match.".formatted(name));
		}
		if (keywords == null || keywords.isEmpty()) {
			throw new IllegalArgumentException(
					"Rule %s has no keywords. Amount alone never determines a category (spec §5), so a rule with nothing to match text against is not a rule."
						.formatted(name));
		}
		if (amountGuard == null) {
			throw new IllegalArgumentException(
					"Rule %s needs an amount guard; use AmountGuard.ANY for no condition.".formatted(name));
		}
		// Before List.copyOf, which rejects a null element with a bare NPE that
		// says nothing about which rule is malformed.
		for (String keyword : keywords) {
			if (keyword == null || keyword.isBlank()) {
				throw new IllegalArgumentException("Rule %s has a null or blank keyword.".formatted(name));
			}
		}
		this.name = name;
		this.category = category;
		this.fields = Set.copyOf(fields);
		this.keywords = List.copyOf(keywords);
		this.amountGuard = amountGuard;
		this.pattern = compile(name, this.keywords);
	}

	/**
	 * A rule whose keywords may match either the merchant or the description.
	 *
	 * <p>The default. Users put a merchant name in whichever field is at hand,
	 * and a rule that only watched one of them would miss half the entries.
	 */
	public static ClassificationRule onAnyText(String name, Category category, String... keywords) {
		return new ClassificationRule(name, category, Set.of(MatchField.MERCHANT, MatchField.DESCRIPTION),
				Arrays.asList(keywords), AmountGuard.ANY);
	}

	/**
	 * A rule that only reads the merchant.
	 *
	 * <p>For brand names that are also ordinary words. {@code Smart} and
	 * {@code Globe} are telcos; they are also a description of a television and a
	 * thing you put on a desk. Scoping those rules to the merchant field keeps
	 * "Smart TV" out of {@code UTILITIES} without needing a longer keyword that
	 * would then miss the merchant "Smart" on its own.
	 */
	public static ClassificationRule onMerchant(String name, Category category, String... keywords) {
		return new ClassificationRule(name, category, Set.of(MatchField.MERCHANT), Arrays.asList(keywords),
				AmountGuard.ANY);
	}

	/** Returns this rule with an amount guard added. See {@link AmountGuard}. */
	public ClassificationRule guardedBy(AmountGuard guard) {
		return new ClassificationRule(this.name, this.category, this.fields, this.keywords, guard);
	}

	/**
	 * Whether this rule fires on the given field.
	 *
	 * <p>Order of the checks is deliberate: text first, guard second. The guard
	 * is never consulted for a rule whose text did not match, which is what keeps
	 * it a disambiguator rather than a classifier.
	 *
	 * @param field the field being consulted this pass
	 * @param text that field's value, already normalized; null when absent
	 * @param amountMinor signed centavos
	 */
	boolean matches(MatchField field, String text, long amountMinor) {
		if (text == null || !this.fields.contains(field)) {
			return false;
		}
		return this.pattern.matcher(text).find() && this.amountGuard.permits(amountMinor);
	}

	public String name() {
		return this.name;
	}

	public Category category() {
		return this.category;
	}

	public Set<MatchField> fields() {
		return this.fields;
	}

	/** The rule's vocabulary. Its value identity, and what tests reason over. */
	public List<String> keywords() {
		return this.keywords;
	}

	public AmountGuard amountGuard() {
		return this.amountGuard;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof ClassificationRule that)) {
			return false;
		}
		// The pattern is omitted: it is a pure function of the keywords, and
		// Pattern does not define value equality anyway.
		return this.name.equals(that.name) && this.category == that.category && this.fields.equals(that.fields)
				&& this.keywords.equals(that.keywords) && this.amountGuard == that.amountGuard;
	}

	@Override
	public int hashCode() {
		return Objects.hash(this.name, this.category, this.fields, this.keywords, this.amountGuard);
	}

	@Override
	public String toString() {
		return "%s → %s".formatted(this.name, this.category);
	}

	private static Pattern compile(String name, List<String> keywords) {
		String alternation = keywords.stream()
			.map(keyword -> WHITESPACE.matcher(keyword.strip()).replaceAll(" "))
			.map(ClassificationRule::asWholeWord)
			.collect(Collectors.joining("|"));
		// UNICODE_CHARACTER_CLASS implies UNICODE_CASE, and is what makes the
		// \w in the boundaries below see more than ASCII.
		return Pattern.compile(alternation, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CHARACTER_CLASS);
	}

	/**
	 * Wraps one keyword in word boundaries, tolerating punctuation at either end
	 * and an optional plural on <em>every</em> word of a phrase.
	 *
	 * <p>A boundary is only added where the keyword's own edge is a word
	 * character. {@code \b} would be wrong here: it asserts a transition, so
	 * {@code \bS&R\b} demands a word character after the {@code R} it already
	 * consumed in one direction and fails outright in the other.
	 *
	 * <p><b>The plural is per token, not per keyword.</b> Appending it once to
	 * the whole keyword only ever pluralizes the last word, which silently
	 * defeats a phrase whose plural falls earlier — {@code gift from} would miss
	 * "gifts from", and the bare {@code gift} in another rule would take it
	 * instead. That is worse than missing outright: the expense lands in a
	 * confidently wrong category rather than in {@code UNCLASSIFIED}.
	 *
	 * <p>Note the plural can only ever add an {@code s}, never remove one, so a
	 * keyword is written in the singular. {@code spare part} covers both forms;
	 * {@code spare parts} covers only the plural.
	 */
	private static String asWholeWord(String keyword) {
		String[] tokens = keyword.split(" ");
		StringBuilder pattern = new StringBuilder();
		for (int index = 0; index < tokens.length; index++) {
			String token = tokens[index];
			boolean isFirst = index == 0;
			boolean isLast = index == tokens.length - 1;
			if (isFirst && isWordCharacter(token.charAt(0))) {
				pattern.append("(?<!\\w)");
			}
			pattern.append(Pattern.quote(token));
			if (isWordCharacter(token.charAt(token.length() - 1))) {
				pattern.append("(?:s)?");
				if (isLast) {
					pattern.append("(?!\\w)");
				}
			}
			if (!isLast) {
				// The literal space is itself the boundary between tokens.
				pattern.append(" ");
			}
		}
		return pattern.toString();
	}

	private static boolean isWordCharacter(char character) {
		return Character.isLetterOrDigit(character) || character == '_';
	}

}
