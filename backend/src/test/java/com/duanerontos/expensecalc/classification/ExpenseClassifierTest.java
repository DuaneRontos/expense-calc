package com.duanerontos.expensecalc.classification;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Stream;

import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.expense.Expense;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What the engine decides. Plain unit tests: classification is pure, so proving
 * it needs neither a Spring context nor Docker.
 *
 * <p>{@link #EXAMPLES} carries one canonical expense per rule, in table order,
 * and drives most of what follows. Two of the issue's requirements fall out of
 * it at once: an example that resolves to its own rule is a test that fails if
 * the rule is deleted, and — because the assertion names the rule rather than
 * only the category — it is simultaneously proof that no neighbouring rule
 * captured territory it does not own.
 */
class ExpenseClassifierTest {

	private final ExpenseClassifier classifier = new ExpenseClassifier();

	/**
	 * One expense per rule, in the table's order. Amounts are signed centavos;
	 * negative is money in.
	 */
	private record RuleExample(String rule, String merchant, String description, long amountMinor, Category expected) {

		@Override
		public String toString() {
			return "%s → %s".formatted(this.rule, this.expected);
		}
	}

	private static final List<RuleExample> EXAMPLES = List.of(
			new RuleExample("housing.rent-and-dues", null, "Monthly rent for August", 2_500_000, Category.HOUSING),
			new RuleExample("utilities.telco-brand", "Globe", null, 149_900, Category.UTILITIES),
			new RuleExample("utilities.household-service", "Meralco", null, 389_050, Category.UTILITIES),
			new RuleExample("groceries.market", "SM Supermarket", null, 234_500, Category.GROCERIES),
			new RuleExample("dining.delivery-platform", "foodpanda", null, 45_000, Category.DINING),
			new RuleExample("dining.eating-out", "Jollibee", null, 32_000, Category.DINING),
			new RuleExample("transport.fuel-brand", "Shell", null, 150_000, Category.TRANSPORT),
			new RuleExample("transport.fare-and-fuel", "Grab", null, 18_000, Category.TRANSPORT),
			new RuleExample("maintenance.upkeep", null, "Aircon cleaning", 80_000, Category.MAINTENANCE),
			new RuleExample("health.care-and-pharmacy", "Mercury Drug", null, 65_000, Category.HEALTH),
			new RuleExample("income.money-in", null, "Salary for August", -4_500_000, Category.INCOME),
			new RuleExample("discretionary.leisure", "Netflix", null, 54_900, Category.DISCRETIONARY),
			new RuleExample("capital.durable-goods", null, "New laptop", 6_500_000, Category.CAPITAL));

	static Stream<RuleExample> examples() {
		return EXAMPLES.stream();
	}

	/** Every example except income's, which is money in by definition. */
	static Stream<RuleExample> spendingExamples() {
		return EXAMPLES.stream().filter(example -> example.expected() != Category.INCOME);
	}

	@Test
	@DisplayName("has a worked example for every rule, and no example for a rule that is gone")
	void hasAnExamplePerRule() {
		// Adding a rule without an example would leave it untested by everything
		// below, which is the failure mode this pins shut.
		assertThat(EXAMPLES).extracting(RuleExample::rule)
			.containsExactlyElementsOf(ClassificationRules.ordered().stream().map(ClassificationRule::name).toList());
	}

	@ParameterizedTest
	@MethodSource("examples")
	@DisplayName("fires the rule each example was written for, and no other")
	void firesTheIntendedRule(RuleExample example) {
		Classification result = this.classifier.classify(example.merchant(), example.description(),
				example.amountMinor());

		// Asserting the rule name, not just the category, is what makes this a
		// non-capture test as well: if an earlier rule had swallowed this input
		// the category could still be right by coincidence, but the attribution
		// would not be.
		assertThat(result.rule()).isEqualTo(example.rule());
		assertThat(result.category()).isEqualTo(example.expected());
	}

	@ParameterizedTest
	@MethodSource("examples")
	@DisplayName("gives every rule a reason that fits the classification record column")
	void reasonFitsTheColumn(RuleExample example) {
		Classification result = this.classifier.classify(example.merchant(), example.description(),
				example.amountMinor());

		// Spec §4 sizes reason at VARCHAR(200). A rule name long enough to
		// overflow it would fail on insert, in production, on one expense.
		assertThat(result.reason()).isNotBlank().hasSizeLessThanOrEqualTo(Classification.MAX_REASON_LENGTH);
	}

	@ParameterizedTest
	@MethodSource("spendingExamples")
	@DisplayName("keeps a refund in the category it refunds, in every category that can receive one")
	void refundsKeepTheirCategory(RuleExample example) {
		// Spec §5 and the skill: a grocery refund is negative GROCERIES, never
		// INCOME. This is the check that keeps category totals net rather than
		// gross, and it runs across every spending category rather than one.
		Classification result = this.classifier.classify(example.merchant(), example.description(),
				-example.amountMinor());

		assertThat(result.category()).isEqualTo(example.expected());
		assertThat(result.rule()).isEqualTo(example.rule());
	}

	@Test
	@DisplayName("keeps a reimbursed client dinner in DINING rather than INCOME")
	void reimbursementKeepsTheOriginalCategory() {
		// The skill's worked example. Money arriving from an employer rather than
		// the restaurant changes nothing: recording ₱2,000 as INCOME would leave
		// the by-category report showing dining nobody ultimately paid for,
		// offset invisibly in another bucket.
		Classification result = this.classifier.classify(null, "Client dinner reimbursed by employer", -200_000);

		assertThat(result.category()).isEqualTo(Category.DINING);
	}

	@Test
	@DisplayName("keeps salary in INCOME, because it offsets no particular expense")
	void salaryIsIncome() {
		assertThat(this.classifier.classify(null, "Salary for August", -4_500_000).category())
			.isEqualTo(Category.INCOME);
	}

	// --- Ordering traps -----------------------------------------------------
	//
	// Each pair below is two inputs sharing a word, landing in different
	// categories because one rule precedes another. Swap the rules and the pair
	// swaps with them.

	@ParameterizedTest(name = "[{index}] {0} / {1} → {2}")
	@CsvSource(delimiter = '|',
			textBlock = """
					Grab Food delivery      |                  | DINING        | delivery platform precedes rideshare
					Grab to the office      |                  | TRANSPORT     | and rideshare still owns the bare word
					Phone bill for August   |                  | UTILITIES     | a bill precedes the device
					New phone               |                  | CAPITAL       | and the device is still capital
					Cable TV bill           |                  | UTILITIES     | a cable bill is not a television
					New television          |                  | CAPITAL       | but a television is
					Home insurance premium  |                  | HOUSING       | housing owns its own insurance
					Car insurance renewal   |                  | TRANSPORT     | transport owns its own insurance
					Insurance premium       |                  | HEALTH        | health takes what is left over
					Aircon repair           |                  | MAINTENANCE   | repairing precedes buying
					Aircon unit for bedroom |                  | CAPITAL       | and buying is still capital
					Internet subscription   |                  | UTILITIES     | a utility precedes a subscription
					Netflix subscription    |                  | DISCRETIONARY | and streaming is still discretionary
					Starlink subscription   |                  | UTILITIES     | a provider named in a description is a utility
					Converge subscription   |                  | UTILITIES     | not only the generic word
					PLDT subscription       |                  | UTILITIES     | merchant-only scoping hid these before
					Phone subscription      |                  | UTILITIES     | a plan is a utility, not only a bill
					Mobile subscription     |                  | UTILITIES     | however the user words it
					Broadband subscription  |                  | UTILITIES     | and whichever word they use for the line
					Cable subscription      |                  | UTILITIES     | the third spelling of a cable bill
					Gym subscription        |                  | DISCRETIONARY | while a gym is still discretionary
					Coffee beans from the grocery |            | GROCERIES     | groceries precede dining
					Coffee with Ana at the cafe   |            | DINING        | but a cafe is still dining
					""")
	@DisplayName("resolves overlapping keywords by rule order")
	void resolvesOverlapsByOrder(String description, String merchant, Category expected, String why) {
		Classification result = this.classifier.classify(merchant, description, 100_000);

		assertThat(result.category()).as(why).isEqualTo(expected);
	}

	@Test
	@DisplayName("scopes ambiguous brand names to the merchant field")
	void ambiguousBrandsAreMerchantOnly() {
		// "Smart" and "Shell" are a telco and a fuel station as merchants, and
		// ordinary words in a description. Scoping their rules to the merchant
		// field is what keeps the two apart.
		assertThat(this.classifier.classify("Smart", null, 149_900).category()).isEqualTo(Category.UTILITIES);
		assertThat(this.classifier.classify(null, "Smart TV for the living room", 3_500_000).category())
			.isEqualTo(Category.CAPITAL);

		assertThat(this.classifier.classify("Shell", null, 150_000).category()).isEqualTo(Category.TRANSPORT);
		assertThat(this.classifier.classify(null, "Shell out for lunch with the team", 90_000).category())
			.isEqualTo(Category.DINING);
	}

	@Test
	@DisplayName("lets a merchant match outrank a description match from an earlier rule")
	void merchantOutranksDescription() {
		// The outer loop is the field, not the rule. groceries.market is declared
		// after nothing relevant here — what settles this is that the merchant
		// stage runs to completion before the description stage begins.
		Classification result = this.classifier.classify("SM Supermarket", "ingredients for dinner", 234_500);

		assertThat(result.category()).isEqualTo(Category.GROCERIES);
		assertThat(result.reason()).startsWith("Merchant matched");
	}

	@Test
	@DisplayName("keeps a gym in DISCRETIONARY rather than HEALTH")
	void gymIsDiscretionary() {
		// Called out explicitly in the skill's taxonomy table.
		assertThat(this.classifier.classify(null, "Gym membership", 250_000).category())
			.isEqualTo(Category.DISCRETIONARY);
	}

	// --- Amount as a disambiguator, never as a classifier --------------------

	@Test
	@DisplayName("separates a gift received from a gift given, and both from a refunded gift")
	void amountDisambiguatesTwoTextMatches() {
		// The guard's real job: money out never reaches INCOME, whatever the
		// text says. What it cannot do is separate two money-in meanings of one
		// word, which is why the income rule says "gift from" rather than "gift"
		// and the refund below stays in DISCRETIONARY.
		assertThat(this.classifier.classify(null, "Gift from tita", -200_000).category()).isEqualTo(Category.INCOME);
		assertThat(this.classifier.classify(null, "Gift from tita", 200_000).category())
			.isEqualTo(Category.DISCRETIONARY);
		assertThat(this.classifier.classify(null, "Gift for mom", 200_000).category())
			.isEqualTo(Category.DISCRETIONARY);
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|',
			textBlock = """
					Gift from tita   | INCOME
					Gifts from tita  | INCOME
					Gift received    | INCOME
					Gifts received   | INCOME
					""")
	@DisplayName("reads a phrase keyword whose plural falls on a word other than the last")
	void pluralizesEveryWordOfAPhrase(String description, Category expected) {
		// The skill's own wording is "gifts received", so the phrasing that has
		// to work is the plural one. Pluralizing only the last word of a phrase
		// left "gifts from" unmatched and handed it to the bare "gift" in
		// discretionary.leisure — money in booked as a negative DISCRETIONARY,
		// which subtracts from a category the user did spend in and leaves no
		// unclassified row to prompt them.
		assertThat(this.classifier.classify(null, description, -200_000).category()).isEqualTo(expected);
	}

	@Test
	@DisplayName("reads a keyword written in the singular in both numbers")
	void singularKeywordsCoverPlurals() {
		// The optional plural can add an s, never remove one — so "spare part"
		// covers both and "spare parts" would cover only the plural.
		assertThat(this.classifier.classify(null, "Spare part for the car", 150_000).category())
			.isEqualTo(Category.MAINTENANCE);
		assertThat(this.classifier.classify(null, "Spare parts for the car", 150_000).category())
			.isEqualTo(Category.MAINTENANCE);
	}

	@Test
	@DisplayName("folds the smart punctuation an iOS keyboard produces")
	void foldsSmartPunctuation() {
		// Escapes rather than literals, as with the non-breaking space: the
		// curly forms are indistinguishable from the straight ones in a diff.
		assertThat(this.classifier.classify("McDonald\u2019s", null, 32_000).category()).isEqualTo(Category.DINING);
		assertThat(this.classifier.classify(null, "Aircon tune\u2013up", 250_000).category())
			.isEqualTo(Category.MAINTENANCE);
		// Folding maps the curly form onto the straight one; it does not delete
		// the apostrophe, so the spelling without one still needs its own
		// keyword and still works.
		assertThat(this.classifier.classify("McDonalds", null, 32_000).category()).isEqualTo(Category.DINING);
	}

	@Test
	@DisplayName("folds the accents an iOS long-press produces")
	void foldsDiacritics() {
		// "cafe" is already a keyword and "cafe" with an acute is an ordinary
		// spelling of it, so the accented form reaching UNCLASSIFIED was an
		// avoidable prompt for a word the table already knows.
		assertThat(this.classifier.classify(null, "Caf\u00E9 with Ana", 45_000).category())
			.isEqualTo(Category.DINING);
		// Keywords take the same path, so the guarantee is symmetric — see
		// ClassificationRuleTest.normalizesAccentedKeywordsAndInputAlike, which
		// can build an accented keyword. Every keyword in the real table is
		// ASCII today, so there is nothing here to assert it against.
	}

	@Test
	@DisplayName("reads a hyphenated keyword written without the hyphen")
	void matchesUnhyphenatedForms() {
		assertThat(this.classifier.classify(null, "Aircon tune-up", 250_000).category())
			.isEqualTo(Category.MAINTENANCE);
		assertThat(this.classifier.classify(null, "Aircon tune up", 250_000).category())
			.isEqualTo(Category.MAINTENANCE);
	}

	@Test
	@DisplayName("lets an ambiguous merchant outrank a description that names a more specific rule")
	void ambiguousMerchantStillOutranksDescription() {
		// Pinned as intended rather than fixed. "Grab" is one merchant string
		// covering rideshare and food delivery, so the merchant stage answers
		// TRANSPORT before dining.delivery-platform is ever consulted, even
		// though the description names GrabFood outright.
		//
		// The field-outer loop is the spec's match order and is right in
		// general; making an ambiguous merchant defer to the description would
		// be a cross-field rule for one brand. Recorded here so the next reader
		// finds a decision rather than a gap.
		Classification result = this.classifier.classify("Grab", "GrabFood order", 45_000);

		assertThat(result.category()).isEqualTo(Category.TRANSPORT);
		assertThat(result.rule()).isEqualTo("transport.fare-and-fuel");

		// The same mechanism, but this one crosses a line the skill draws in its
		// own table — TRANSPORT says "Vehicle repair → MAINTENANCE", and fuel
		// stations here do run service bays. Recorded rather than fixed: the
		// remedy would be a cross-field exception, and the field order is the
		// spec's rather than this rule's. Worth revisiting if real data shows
		// service-bay receipts are common.
		Classification atTheServiceBay = this.classifier.classify("Petron", "Car service and tune-up", 450_000);

		assertThat(atTheServiceBay.category()).isEqualTo(Category.TRANSPORT);
		assertThat(atTheServiceBay.rule()).isEqualTo("transport.fuel-brand");
	}

	@Test
	@DisplayName("answers a provider name with UTILITIES whatever the description says it bought")
	void providerNameOutranksWhatWasBought() {
		// Recorded, not endorsed. A Starlink dish is a five-figure purchase that
		// holds value past the period, which the skill puts in CAPITAL — but
		// capital.durable-goods is declared last on the reasoning that its
		// keywords are nouns an earlier rule qualifies, and a brand name is not
		// such a noun. The Phone bill / New phone split has no analogue here.
		//
		// Same shape as the Grab and Petron cases: a cross-rule exception for
		// one brand costs more than it earns. Became reachable when cdb6706
		// moved Starlink off the merchant-only rule; it was UNCLASSIFIED before.
		assertThat(this.classifier.classify(null, "Starlink hardware kit", 2_900_000).category())
			.isEqualTo(Category.UTILITIES);
	}

	@Test
	@DisplayName("answers an internet cafe with UTILITIES, which is a recorded limit")
	void internetCafeIsAUtility() {
		// Pinned as a known wrong answer, not as intent. An afternoon at a
		// computer shop is DISCRETIONARY, but utilities.household-service owns
		// "internet" and is declared third, so dining.eating-out's "cafe" is
		// never consulted.
		//
		// Not cheap to fix: the table resolves specificity by declaration order
		// and no rule ahead of utilities.household-service could carry the
		// phrase, so it needs a new rule plus its entries in declaresRulesInOrder
		// and EXAMPLES. Pre-existing rather than introduced here. Revisit if
		// real data shows computer-shop entries are common.
		assertThat(this.classifier.classify(null, "Internet cafe with the kids", 15_000).category())
			.isEqualTo(Category.UTILITIES);
	}

	@Test
	@DisplayName("books the reversal of a charge no rule classifies as income, which is a recorded limit")
	void reversedChargeOnAnUnclassifiedWordBecomesIncome() {
		// Pinned as a known limit, not asserted as correct. "interest" is owned
		// by the guarded income rule and by no spending rule, so the
		// disjointness invariant has no keyword to compare and cannot see this
		// case. A credit-card interest charge is UNCLASSIFIED going out; its
		// reversal comes back as INCOME rather than keeping that UNCLASSIFIED,
		// so a refunded fee inflates income slightly.
		//
		// Narrowing "interest" to "interest earned" would fix it and cost the
		// common case — bare "Interest" from a bank is real income. See
		// AmountGuard's javadoc. Change this test deliberately, not to make it
		// pass.
		assertThat(this.classifier.classify(null, "Credit card interest", 50_000).category())
			.isEqualTo(Category.UNCLASSIFIED);
		assertThat(this.classifier.classify(null, "Credit card interest", -50_000).category())
			.isEqualTo(Category.INCOME);
	}

	@Test
	@DisplayName("covers the taxonomy entries the skill names outright")
	void coversTheSkillsNamedExamples() {
		// DINING is "Restaurants, cafes, delivery, bars" and TRANSPORT covers
		// transit; both had a named example no keyword reached.
		assertThat(this.classifier.classify(null, "Bar tab with friends", 120_000).category())
			.isEqualTo(Category.DINING);
		assertThat(this.classifier.classify(null, "Bus fare to Baguio", 85_000).category())
			.isEqualTo(Category.TRANSPORT);
	}

	@Test
	@DisplayName("keeps a returned gift in DISCRETIONARY rather than turning it into income")
	void refundOfAGiftKeepsItsCategory() {
		// A gift given and a refund of that gift share both the word and the
		// direction of the money, so the guard alone cannot separate them —
		// only keeping the vocabulary of the guarded and unguarded rules
		// disjoint can. Spec §5: the refund keeps the category it refunds.
		assertThat(this.classifier.classify(null, "Gift for mom", -200_000).category())
			.isEqualTo(Category.DISCRETIONARY);
	}

	@ParameterizedTest
	@ValueSource(longs = { 800_000, 0 })
	@DisplayName("does not make money going out into income, whatever the description says")
	void moneyOutIsNeverIncome(long amountMinor) {
		// Paying a helper's salary is money out. The word matches the income rule
		// and the guard declines it, so it falls through to UNCLASSIFIED — the
		// honest answer — rather than being booked as money arriving.
		Classification result = this.classifier.classify(null, "Salary", amountMinor);

		assertThat(result.category()).isEqualTo(Category.UNCLASSIFIED);
	}

	@Test
	@DisplayName("classifies on text alone when no amount would change the answer")
	void amountNeverClassifiesAlone() {
		// No text, any amount, however large: there is no rule an amount can
		// reach on its own.
		assertThat(this.classifier.classify(null, null, 99_999_999).category()).isEqualTo(Category.UNCLASSIFIED);
		assertThat(this.classifier.classify(null, null, -99_999_999).category()).isEqualTo(Category.UNCLASSIFIED);
	}

	// --- UNCLASSIFIED --------------------------------------------------------

	@Test
	@DisplayName("reaches UNCLASSIFIED when nothing matched, rather than a default bucket")
	void unmatchedReachesUnclassified() {
		Classification result = this.classifier.classify("Tita Baby's Store", "sundries", 45_000);

		assertThat(result.category()).isEqualTo(Category.UNCLASSIFIED);
		assertThat(result.isUnmatched()).isTrue();
		assertThat(result.rule()).isNull();
		// Still carries a reason: the record has to say why, even when the answer
		// is "nothing matched".
		assertThat(result.reason()).isNotBlank();
	}

	@ParameterizedTest
	@CsvSource(value = { "null,null", "'',''", "'   ','  '" }, nullValues = "null")
	@DisplayName("treats absent and blank text as unclassifiable")
	void handlesAbsentText(String merchant, String description) {
		assertThat(this.classifier.classify(merchant, description, 100_000).category())
			.isEqualTo(Category.UNCLASSIFIED);
	}

	@Test
	@DisplayName("does not match a keyword buried inside a longer word")
	void doesNotMatchInsideWords() {
		// "Smartphone" contains "phone", and a substring matcher would file a
		// phone purchase under the phone bill rule. It reaching UNCLASSIFIED is
		// the correct outcome: no rule claims the whole word.
		assertThat(this.classifier.classify("Smartphone Store", null, 3_500_000).category())
			.isEqualTo(Category.UNCLASSIFIED);
	}

	// --- Determinism and plumbing -------------------------------------------

	@Test
	@DisplayName("normalizes a non-breaking space, which pasted statement text carries")
	void normalizesNonBreakingSpace() {
		// Java's \s is ASCII-only unless told otherwise, and U+00A0 is not a word
		// character either — so before UNICODE_CHARACTER_CLASS this text survived
		// normalization intact, missed the "phone bill" keyword, and then matched
		// a bare "phone": a monthly bill filed as a durable good.
		// The separator is written as an escape on purpose: a literal U+00A0 in
		// the source is indistinguishable from a space, and the next person to
		// touch this line would "tidy" it and silently retire the test.
		String pastedFromAStatement = "Phone\u00A0bill for August";

		Classification result = this.classifier.classify(null, pastedFromAStatement, 149_900);

		assertThat(result.category()).isEqualTo(Category.UTILITIES);
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|',
			textBlock = """
					Monthly subscriptions   | DISCRETIONARY
					Gifts for the family    | DISCRETIONARY
					Tolls on the expressway | TRANSPORT
					Aircon repairs          | MAINTENANCE
					Weekly groceries        | GROCERIES
					Property taxes          | HOUSING
					Pharmacies downtown     | HEALTH
					Laboratories            | HEALTH
					Hobbies                 | DISCRETIONARY
					Bus fares               | TRANSPORT
					""")
	@DisplayName("matches ordinary plural phrasings")
	void matchesPlurals(String description, Category expected) {
		// Three regular patterns, generated rather than spelled out: +s, +es
		// after a sibilant (tax → taxes), and consonant-y → ies (grocery →
		// groceries, hobby → hobbies). The table carries no plural keywords at
		// all, so coverage is predictable from reading it rather than depending
		// on which entries someone remembered to double up.
		assertThat(this.classifier.classify(null, description, 100_000).category()).isEqualTo(expected);
	}

	@Test
	@DisplayName("generates the plural without swallowing words that merely end in y")
	void pluralGenerationRespectsVowelY() {
		// "pay" pluralizes as "pays", not "paies", so the y → ies mapping only
		// applies after a consonant. Without the check, "13th month pay" would
		// compile to a pattern matching neither.
		assertThat(this.classifier.classify(null, "13th month pay", -4_500_000).category())
			.isEqualTo(Category.INCOME);
		assertThat(this.classifier.classify(null, "13th month pays", -4_500_000).category())
			.isEqualTo(Category.INCOME);
	}

	@Test
	@DisplayName("returns the same answer for the same input")
	void isDeterministic() {
		// Spec §5. No clock, no random, no model call — a report over a closed
		// period has to reproduce, and this is the property it rests on.
		Classification first = this.classifier.classify("Jollibee", "lunch", 32_000);
		Classification second = this.classifier.classify("Jollibee", "lunch", 32_000);

		assertThat(first).isEqualTo(second);
	}

	@Test
	@DisplayName("ignores case and collapsed whitespace")
	void normalizesText() {
		assertThat(this.classifier.classify("JOLLIBEE", null, 32_000).category()).isEqualTo(Category.DINING);
		// Pasted from a statement, "home  insurance" would otherwise miss a rule
		// that "home insurance" hits.
		assertThat(this.classifier.classify(null, "Home  insurance  premium", 1_200_000).category())
			.isEqualTo(Category.HOUSING);
	}

	@Test
	@DisplayName("classifies a persisted expense the same as its loose fields")
	void classifiesAnExpense() {
		Expense expense = Expense.record(new BigDecimal("2345.00"), "PHP", LocalDate.of(2026, 8, 17), "SM Supermarket",
				"weekly groceries");

		assertThat(this.classifier.classify(expense))
			.isEqualTo(this.classifier.classify("SM Supermarket", "weekly groceries", 234_500));
		assertThat(this.classifier.classify(expense).category()).isEqualTo(Category.GROCERIES);
	}

}
