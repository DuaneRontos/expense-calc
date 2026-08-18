package com.duanerontos.expensecalc.classification;

import java.util.List;
import java.util.regex.Pattern;

import com.duanerontos.expensecalc.expense.Expense;

import org.springframework.stereotype.Component;

/**
 * The deterministic rule engine of spec §5.
 *
 * <p>Two nested loops, and the nesting is the specification:
 *
 * <pre>
 * for each field in (merchant, description)     ← the outer loop is spec §5's match order
 *     for each rule in declared order           ← the inner loop is first-match-wins
 * </pre>
 *
 * <p>Fields outside, rules inside, means <b>any merchant match beats every
 * description match</b>, including one from a rule declared earlier. That is the
 * intended reading of "merchant, then description": a merchant is evidence about
 * who was paid, a description is free text, and when they disagree the merchant
 * is right more often. A grocery run at {@code SM Supermarket} noted as "dinner
 * ingredients" is {@code GROCERIES}, not {@code DINING}.
 *
 * <p><b>No third loop over amounts.</b> Spec §5 lists amount after description
 * in the match order but also forbids it from determining a category alone, and
 * an amount stage that ran after description would do exactly that — by the time
 * it ran, both text stages would have already declined. Amount is therefore a
 * guard on a text match rather than a stage of its own; see {@link AmountGuard}.
 * This is the one place where the implementation shape differs from a literal
 * reading of the spec's three-item list, and it is the only shape that satisfies
 * both of the spec's sentences at once.
 *
 * <p>Deterministic in the strict sense: no clock, no random, no I/O, no model
 * call. The same expense classifies the same way forever, which is what makes a
 * report over a closed period reproducible (issue #9).
 */
@Component
public class ExpenseClassifier {

	// UNICODE_CHARACTER_CLASS is load-bearing: Java's \s is ASCII-only by
	// default, so a non-breaking space — which pasted statement text carries
	// routinely — would survive normalization and then break keyword matching
	// in a way that files a phone bill under CAPITAL.
	private static final Pattern WHITESPACE = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

	// Typed input, not pasted: smart punctuation is on by default on iOS and
	// macOS, and the keywords are written in ASCII.
	private static final Pattern SMART_QUOTES = Pattern.compile("[\u2018\u2019]");

	private static final Pattern DASHES = Pattern.compile("[\u2013\u2014]");

	private final List<ClassificationRule> rules;

	public ExpenseClassifier() {
		this(ClassificationRules.ordered());
	}

	/** Visible for tests that need a rule table other than the real one. */
	ExpenseClassifier(List<ClassificationRule> rules) {
		this.rules = List.copyOf(rules);
	}

	/**
	 * Classifies a persisted expense.
	 *
	 * <p>Reads {@code amountMinor} rather than the {@code BigDecimal} amount: the
	 * only question a guard asks is which direction the money moved, and an
	 * integer comparison answers it without a conversion.
	 */
	public Classification classify(Expense expense) {
		return classify(expense.getMerchant(), expense.getDescription(), expense.getAmountMinor());
	}

	/**
	 * Classifies loose fields, for {@code POST} and {@code PATCH} bodies that have
	 * not become an {@link Expense} yet (spec §8).
	 *
	 * @param merchant may be null or blank
	 * @param description may be null or blank
	 * @param amountMinor signed centavos; negative is money in
	 * @return never null; {@link Classification#unmatched()} when no rule fired
	 */
	public Classification classify(String merchant, String description, long amountMinor) {
		String normalizedMerchant = normalize(merchant);
		String normalizedDescription = normalize(description);

		for (MatchField field : MatchField.values()) {
			String text = switch (field) {
				case MERCHANT -> normalizedMerchant;
				case DESCRIPTION -> normalizedDescription;
			};
			for (ClassificationRule rule : this.rules) {
				if (rule.matches(field, text, amountMinor)) {
					return Classification.from(rule, field);
				}
			}
		}
		return Classification.unmatched();
	}

	/** The table this engine is running, in match order. */
	public List<ClassificationRule> rules() {
		return this.rules;
	}

	/**
	 * Folds the typographic characters a keyboard produces down to the ASCII the
	 * keywords are written in, collapses whitespace, and treats blank as absent.
	 *
	 * <p>Multi-word keywords are written with single spaces, so "home  insurance"
	 * pasted from a bank statement would otherwise miss a rule that "home
	 * insurance" hits — a difference invisible in a bug report.
	 *
	 * <p>The quote and dash folding is for typed input rather than pasted. iOS
	 * and macOS substitute smart punctuation as you type and the client is Expo
	 * on iOS, so {@code McDonald’s} with U+2019 is what a user actually enters —
	 * it matches neither {@code McDonald's} nor {@code McDonalds} unmapped. The
	 * dashes protect {@code tune-up} and {@code sari-sari} the same way.
	 *
	 * <p>Folding does not make {@code McDonalds} and {@code McDonald's} the same
	 * string, so both spellings stay in the table. It maps the curly form onto
	 * the straight one; it does not delete punctuation.
	 */
	private static String normalize(String text) {
		if (text == null) {
			return null;
		}
		String folded = SMART_QUOTES.matcher(text).replaceAll("'");
		folded = DASHES.matcher(folded).replaceAll("-");
		String collapsed = WHITESPACE.matcher(folded).replaceAll(" ").strip();
		return collapsed.isEmpty() ? null : collapsed;
	}

}
