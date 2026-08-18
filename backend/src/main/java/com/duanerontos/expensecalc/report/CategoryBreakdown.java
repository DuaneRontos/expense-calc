package com.duanerontos.expensecalc.report;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;

import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.money.Money;

/**
 * The {@code /reports/by-category} response (spec §7).
 *
 * <p>Money crosses the wire as a <b>decimal string</b>, never a JSON number. A
 * JSON number is a double on arrival in JavaScript, which reintroduces exactly
 * the precision problem the integer storage exists to avoid — and it does so at
 * the last possible moment, in the client, where it is hardest to see.
 *
 * @param period the window reported on, half-open
 * @param currency ISO 4217; always {@code PHP} in v1 (spec §9.6)
 * @param total the net of every bucket, which may be negative — see below
 * @param buckets ranked by total descending; may be empty
 *
 * <p><b>{@code total} is net cash flow for the period, {@code INCOME}
 * included.</b> Stated because the consequence surprises: a month with a salary
 * recorded returns a negative headline total on a chart called "category
 * breakdown". The alternative — total as period spending, with {@code INCOME}
 * shown beside it but not summed in — was rejected because it makes
 * {@code total} stop equalling the sum of the buckets, and a legend whose
 * numbers do not add up to its own total is a worse thing to explain to a user
 * than a negative one.
 *
 * <p>Spec §7 already anticipates the rendering half: a donut cannot draw a
 * negative slice, so the client surfaces such categories in the legend with
 * their real value and excludes them from the arc. That means the arc and the
 * headline total legitimately disagree whenever a negative bucket exists, and
 * #16 needs to show that rather than hide it.
 */
public record CategoryBreakdown(ReportPeriod period, String currency, String total, List<Bucket> buckets) {

	/**
	 * One slice.
	 *
	 * @param key the enum name, which is what the client groups and colours on
	 * @param label the display name, served so the client never hardcodes the
	 *     taxonomy (spec §8)
	 * @param total decimal string; negative when refunds exceeded spending
	 */
	public record Bucket(String key, String label, String total) {
	}

	/**
	 * Builds the response from summed minor units.
	 *
	 * <p>This is the presentation boundary spec §7 talks about, and the only
	 * place the conversion happens. Note what the conversion does <em>not</em>
	 * need to do: {@link Money#toMajorUnits} is exact, and every total is a whole
	 * number of centavos, so scale is already 2 and {@code HALF_UP} has nothing
	 * to round. Adding a rounding call here would be ceremony that hides the
	 * fact that nothing is being rounded — the first operation that divides
	 * (a percentage-of-total, say) is where rounding becomes real, and it should
	 * be explicit at that point rather than implied here.
	 *
	 * <p>Buckets are ranked by total descending, which is the order the ranked
	 * legend in spec §7 renders. Ties break on the category's declaration order
	 * so the output is stable — an unstable order would make two identical
	 * reports differ, and the diff would look like a data change.
	 */
	public static CategoryBreakdown of(ReportPeriod period, List<CategoryTotal> totals) {
		long netMinor = totals.stream().mapToLong(CategoryTotal::totalMinor).sum();

		List<Bucket> buckets = totals.stream()
			.sorted(Comparator.comparingLong(CategoryTotal::totalMinor)
				.reversed()
				.thenComparing(CategoryTotal::category))
			.map(total -> new Bucket(total.category().name(), total.category().getLabel(), asDecimal(total.totalMinor())))
			.toList();

		return new CategoryBreakdown(period, Money.CURRENCY_CODE, asDecimal(netMinor), buckets);
	}

	private static String asDecimal(long minorUnits) {
		BigDecimal amount = Money.toMajorUnits(minorUnits);
		return amount.toPlainString();
	}

	/**
	 * True when the period had no expenses at all. Spec §7: that is a 200 with
	 * no buckets, not a 404.
	 *
	 * <p>Named {@code hasNoBuckets} rather than {@code isEmpty} because Jackson
	 * treats an {@code is}-prefixed method on a record as another property and
	 * serialised an {@code "empty"} field into the response — a fifth key in a
	 * shape spec §7 defines with four, on the payload the client's types get
	 * generated from.
	 */
	public boolean hasNoBuckets() {
		return this.buckets.isEmpty();
	}

	/** Categories present in this breakdown, in the order rendered. */
	public List<Category> categories() {
		return this.buckets.stream().map(bucket -> Category.valueOf(bucket.key())).toList();
	}

}
