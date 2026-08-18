package com.duanerontos.expensecalc.classification;

import java.util.regex.Pattern;

/**
 * The one normalization both sides of a match pass through.
 *
 * <p><b>Both sides is the point.</b> This began as two normalizers: the input
 * path folded typographic punctuation, the keyword-compilation path only
 * collapsed whitespace. That asymmetry makes a keyword written with a curly
 * apostrophe — {@code Jollibee’s} pasted from the brand's own site — compile
 * into a pattern that no normalized input can ever match. It fails silently: no
 * exception, no failing test, just a rule that never fires. Routing keywords and
 * input through the same function makes the guarantee structural rather than a
 * matter of keeping two methods in step.
 *
 * <p>The whitespace class is Unicode-aware because Java's {@code \s} is not: a
 * non-breaking space, which pasted statement text carries routinely, would
 * otherwise survive and break keyword matching. The quote and dash folding is
 * for typed input — iOS and macOS substitute smart punctuation as you type, and
 * the client is Expo on iOS, so U+2019 is what a user actually enters.
 *
 * <p>Folding maps the curly forms onto the straight ones; it does not delete
 * punctuation. {@code McDonalds} and {@code McDonald's} remain different
 * strings, so a table wanting both still lists both.
 */
final class TextNormalizer {

	private static final Pattern WHITESPACE = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

	private static final Pattern SMART_QUOTES = Pattern.compile("[\u2018\u2019]");

	private static final Pattern DASHES = Pattern.compile("[\u2013\u2014]");

	private static final Pattern COMBINING_MARKS = Pattern.compile("\\p{M}+");

	private TextNormalizer() {
	}

	/**
	 * Decomposes accented letters and drops the accents, so {@code Café} matches
	 * the keyword {@code cafe}.
	 *
	 * <p>Typed input again: an iOS long-press produces {@code é}, and
	 * {@code café} is an ordinary spelling of a word already in the table.
	 *
	 * <p><b>This folds {@code ñ} to {@code n}</b>, which is a real decision
	 * rather than a side effect. For a Philippine keyword set it is the useful
	 * direction — {@code Parañaque}, {@code piña} and {@code Añejo} all reach
	 * their unaccented spellings, which is how they are typed at least as often.
	 * It does mean the engine cannot tell {@code año} from {@code ano}; nothing
	 * in the taxonomy turns on that distinction, and a category is not the place
	 * to be precious about it.
	 */
	private static String stripDiacritics(String text) {
		String decomposed = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD);
		return COMBINING_MARKS.matcher(decomposed).replaceAll("");
	}

	/**
	 * @param text may be null
	 * @return the normalized text, or null when the input was null or blank
	 */
	static String normalize(String text) {
		if (text == null) {
			return null;
		}
		String folded = SMART_QUOTES.matcher(text).replaceAll("'");
		folded = DASHES.matcher(folded).replaceAll("-");
		folded = stripDiacritics(folded);
		String collapsed = WHITESPACE.matcher(folded).replaceAll(" ").strip();
		return collapsed.isEmpty() ? null : collapsed;
	}

}
