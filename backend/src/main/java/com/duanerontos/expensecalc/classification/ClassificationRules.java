package com.duanerontos.expensecalc.classification;

import java.util.List;

import com.duanerontos.expensecalc.expense.Category;

/**
 * The rule table, in match order.
 *
 * <p><b>The order is load-bearing.</b> First match wins, so a specific rule has
 * to precede the general one it is an exception to. Every position below that
 * carries weight says which rule it is defending against and what breaks if it
 * moves; {@code ClassificationRulesTest} pins the sequence so a reorder fails
 * the build rather than quietly reclassifying a category's worth of expenses.
 *
 * <p>Two conventions run through the table:
 *
 * <ul>
 * <li><b>Brand rules that collide with ordinary words are merchant-only.</b>
 * {@code Smart} and {@code Globe} are telcos, {@code Shell} sells fuel — and all
 * three appear in descriptions meaning something else entirely.
 * <li><b>Nothing keys on the word "refund".</b> Spec §5: a refund keeps the
 * category of what it refunds, as a negative amount. A rule that caught refunds
 * would file them all in one bucket and leave every category's total gross.
 * </ul>
 *
 * <p>Keywords lean Philippine — {@code PHP} is the only currency in v1 (spec
 * §9.6) and the merchants a user here actually types are Meralco and Jollibee,
 * not utilities and restaurants in the abstract. Unrecognized merchants reach
 * {@code UNCLASSIFIED}, which is the designed outcome rather than a gap: the
 * user reclassifies once (issue #9) and the record explains itself.
 */
public final class ClassificationRules {

	private static final List<ClassificationRule> ORDERED = List.of(

			// Owns "home insurance" outright. The health rule below matches a bare
			// "insurance" as its last resort, so if these two ever swap, every
			// home insurance premium silently becomes HEALTH.
			ClassificationRule.onAnyText("housing.rent-and-dues", Category.HOUSING, "rent", "monthly rent", "mortgage",
					"amortization", "landlord", "condo dues", "association dues", "property tax", "home insurance",
					"homeowners insurance"),

			// Merchant-only, and that is the entire reason this rule is separate
			// from the one below it: "Smart TV" and "Globe trotter" are not phone
			// bills. As a merchant, "Smart" is unambiguous.
			ClassificationRule.onMerchant("utilities.telco-brand", Category.UTILITIES, "PLDT", "Globe", "Smart",
					"Converge", "Sky Cable", "Starlink", "DITO"),

			// Precedes capital.durable-goods, which owns "phone" and "TV". "Phone
			// bill" and "cable TV" have to be caught here first or a monthly bill
			// becomes a durable good.
			ClassificationRule.onAnyText("utilities.household-service", Category.UTILITIES, "Meralco", "Maynilad",
					"Manila Water", "electricity", "electric bill", "water bill", "gas bill", "LPG", "internet",
					"fiber", "phone bill", "postpaid", "cable TV", "cable bill"),

			// Precedes both dining rules. "Coffee beans from the grocery" is
			// GROCERIES; the dining rule's "coffee" must not reach it first.
			//
			// "groceries" is spelled out because matching handles a trailing "s"
			// and nothing more — grocery plus an s is "grocerys". Regular plurals
			// elsewhere in this table need no second keyword.
			ClassificationRule.onAnyText("groceries.market", Category.GROCERIES, "SM Supermarket", "Puregold",
					"Robinsons Supermarket", "S&R", "Landers", "WalterMart", "grocery", "groceries", "palengke",
					"wet market", "sari-sari"),

			// Precedes transport.fare-and-fuel, which owns "Grab". Whole-word
			// matching already keeps "Grab" out of "GrabFood", but "Grab Food"
			// spelled with a space would land in TRANSPORT if this rule moved.
			ClassificationRule.onAnyText("dining.delivery-platform", Category.DINING, "GrabFood", "Grab Food",
					"foodpanda", "food panda"),

			ClassificationRule.onAnyText("dining.eating-out", Category.DINING, "Jollibee", "Mang Inasal", "Chowking",
					"McDonald's", "McDonalds", "KFC", "Starbucks", "restaurant", "cafe", "coffee", "lunch", "dinner",
					"merienda", "milk tea"),

			// Merchant-only: "shell out" and "phoenix" are ordinary description
			// words. As merchants they are fuel stations. "Total" is left out
			// entirely — TotalEnergies does operate here, but the word is common
			// enough in a merchant field ("Total") that the rule would cost more
			// than it earns.
			ClassificationRule.onMerchant("transport.fuel-brand", Category.TRANSPORT, "Shell", "Petron", "Caltex",
					"Seaoil", "Phoenix", "Unioil"),

			// Owns "car insurance" for the same reason housing owns "home
			// insurance": the bare "insurance" in the health rule below would
			// otherwise take it.
			ClassificationRule.onAnyText("transport.fare-and-fuel", Category.TRANSPORT, "Grab", "Angkas", "JoyRide",
					"taxi", "jeepney", "tricycle", "MRT", "LRT", "beep card", "gasoline", "diesel", "toll",
					"Autosweep", "Easytrip", "parking", "car insurance", "motor insurance"),

			// Precedes capital.durable-goods deliberately. Repairing an aircon is
			// upkeep; buying one is a durable good. Both say "aircon", so the
			// order is what separates them (skill: improvements that add value
			// are CAPITAL, repairs are MAINTENANCE).
			ClassificationRule.onAnyText("maintenance.upkeep", Category.MAINTENANCE, "repair", "plumber",
					"electrician", "aircon cleaning", "tune-up", "preventive maintenance", "car service",
					"spare parts"),

			// The bare "insurance" here is the catch-all, which only works because
			// housing and transport have already claimed their own kinds above.
			ClassificationRule.onAnyText("health.care-and-pharmacy", Category.HEALTH, "Mercury Drug", "Watsons",
					"clinic", "hospital", "dental", "dentist", "pharmacy", "drugstore", "medicine", "laboratory",
					"consultation", "HMO", "insurance"),

			// The guard is what keeps this rule off ordinary expenses: paying a
			// helper's salary is money out, so "salary" alone never reaches
			// INCOME — it falls through to UNCLASSIFIED, which is honest.
			//
			// It says "gift from" and "gift received" rather than a bare "gift",
			// and that phrasing is load-bearing. A refund is money in, so a
			// returned gift purchase satisfies MONEY_IN exactly as a gift
			// received does; if this rule owned the bare word it would take both,
			// and spec §5 says the refund keeps the category it refunds. The
			// guard separates money in from money out, but nothing can separate
			// two money-in meanings of one word — so the vocabularies of a
			// guarded and an unguarded rule have to stay disjoint. Bare "gift"
			// belongs to discretionary.leisure below, refunds included.
			// ClassificationRulesTest.keepsGuardedAndUnguardedVocabulariesDisjoint
			// enforces this for the whole table rather than for "gift" alone.
			//
			// No "refund" or "reimbursement" keyword, on purpose. A reimbursed
			// client dinner is negative DINING, not INCOME (skill) — recording it
			// here would leave the by-category report showing dining nobody paid
			// for, offset invisibly in another bucket.
			ClassificationRule
				.onAnyText("income.money-in", Category.INCOME, "salary", "payroll", "13th month pay", "bonus",
						"interest", "dividend", "pension", "commission", "gift from", "gift received")
				.guardedBy(AmountGuard.MONEY_IN),

			// Owns "subscription", which is why utilities.household-service has to
			// precede it: "internet subscription" is a utility bill, and streaming
			// is DISCRETIONARY (skill).
			ClassificationRule.onAnyText("discretionary.leisure", Category.DISCRETIONARY, "Netflix", "Spotify",
					"Steam", "cinema", "movie", "gym", "fitness", "concert", "videoke", "hobby", "gift",
					"subscription", "streaming"),

			// Last among the matching rules, because its keywords are the nouns
			// every earlier rule qualifies: a phone has a bill, an aircon gets
			// cleaned, a TV comes with cable. Anything that reaches here is the
			// object itself rather than a service around it.
			ClassificationRule.onAnyText("capital.durable-goods", Category.CAPITAL, "laptop", "phone", "refrigerator",
					"aircon", "air conditioner", "television", "TV", "furniture", "appliance", "washing machine"));

	private ClassificationRules() {
	}

	/** The rules, in match order. Immutable. */
	public static List<ClassificationRule> ordered() {
		return ORDERED;
	}

}
