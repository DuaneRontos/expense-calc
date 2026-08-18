package com.duanerontos.expensecalc.classification;

import java.util.Arrays;
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
 * <p><b>Keywords match whole words, case-insensitively.</b> Plain substring
 * matching would put {@code Smart} inside {@code smartphone} and {@code SM}
 * inside {@code Smart}, which is how a phone purchase becomes a phone bill. The
 * boundaries are lookarounds rather than {@code \b} so that a keyword may begin
 * or end with punctuation — {@code S&R} works, and still does not match inside
 * {@code MS&RT}.
 *
 * @param name stable identifier, recorded as the {@code rule} on a
 *     {@link Classification} and answering "which rule fired" for spec §4
 * @param category what the rule assigns; never {@code UNCLASSIFIED}
 * @param fields which of merchant and description the keywords may match
 * @param keywords compiled whole-word alternation over the rule's keywords
 * @param amountGuard extra condition on the amount; usually {@link AmountGuard#ANY}
 */
public record ClassificationRule(String name, Category category, Set<MatchField> fields, Pattern keywords,
		AmountGuard amountGuard) {

	public ClassificationRule {
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
		if (keywords == null) {
			throw new IllegalArgumentException(
					"Rule %s has no keywords. Amount alone never determines a category (spec §5), so a rule with nothing to match text against is not a rule."
						.formatted(name));
		}
		if (amountGuard == null) {
			throw new IllegalArgumentException(
					"Rule %s needs an amount guard; use AmountGuard.ANY for no condition.".formatted(name));
		}
		fields = Set.copyOf(fields);
	}

	/**
	 * A rule whose keywords may match either the merchant or the description.
	 *
	 * <p>The default. Users put a merchant name in whichever field is at hand,
	 * and a rule that only watched one of them would miss half the entries.
	 */
	public static ClassificationRule onAnyText(String name, Category category, String... keywords) {
		return new ClassificationRule(name, category, Set.of(MatchField.MERCHANT, MatchField.DESCRIPTION),
				compile(name, keywords), AmountGuard.ANY);
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
		return new ClassificationRule(name, category, Set.of(MatchField.MERCHANT), compile(name, keywords),
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
		return this.keywords.matcher(text).find() && this.amountGuard.permits(amountMinor);
	}

	private static Pattern compile(String name, String... keywords) {
		if (keywords == null || keywords.length == 0) {
			throw new IllegalArgumentException(
					"Rule %s has no keywords. Amount alone never determines a category (spec §5)."
						.formatted(name));
		}
		String alternation = Arrays.stream(keywords).map(keyword -> asWholeWord(name, keyword))
			.collect(Collectors.joining("|"));
		return Pattern.compile(alternation, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
	}

	/**
	 * Wraps one keyword in word boundaries, tolerating punctuation at either end.
	 *
	 * <p>A boundary is only added where the keyword's own edge is a word
	 * character. {@code \b} would be wrong here: it asserts a transition, so
	 * {@code \bS&R\b} demands a word character after the {@code R} it already
	 * consumed in one direction and fails outright in the other.
	 */
	private static String asWholeWord(String name, String keyword) {
		if (keyword == null || keyword.isBlank()) {
			throw new IllegalArgumentException("Rule %s has a blank keyword.".formatted(name));
		}
		String trimmed = keyword.strip();
		String prefix = isWordCharacter(trimmed.charAt(0)) ? "(?<!\\w)" : "";
		String suffix = isWordCharacter(trimmed.charAt(trimmed.length() - 1)) ? "(?!\\w)" : "";
		return prefix + Pattern.quote(trimmed) + suffix;
	}

	private static boolean isWordCharacter(char character) {
		return Character.isLetterOrDigit(character) || character == '_';
	}

}
