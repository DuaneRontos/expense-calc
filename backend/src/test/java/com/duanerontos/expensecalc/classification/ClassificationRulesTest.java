package com.duanerontos.expensecalc.classification;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import com.duanerontos.expensecalc.expense.Category;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The shape of the table itself, as opposed to what it decides. These are the
 * checks the classification skill asks a reviewer to make.
 */
class ClassificationRulesTest {

	@Test
	@DisplayName("declares the rules in this exact order, because the order is load-bearing")
	void declaresRulesInOrder() {
		// Spelled out rather than derived. First match wins, so several rules
		// here exist only as exceptions to a later one — housing owns "home
		// insurance" before health's bare "insurance" can take it, maintenance
		// owns "aircon repair" before capital's "aircon". Reordering the table
		// silently reclassifies whole categories of expense, and this list is
		// what makes that a build failure rather than a surprise in a report.
		assertThat(ClassificationRules.ordered()).extracting(ClassificationRule::name)
			.containsExactly("housing.rent-and-dues", "utilities.telco-brand", "utilities.household-service",
					"groceries.market", "dining.delivery-platform", "dining.eating-out", "transport.fuel-brand",
					"transport.fare-and-fuel", "maintenance.upkeep", "health.care-and-pharmacy", "income.money-in",
					"discretionary.leisure", "capital.durable-goods");
	}

	@Test
	@DisplayName("gives every category except UNCLASSIFIED at least one rule")
	void coversEveryCategory() {
		// A category with no rule is a bucket nothing can ever reach by itself —
		// either the rule is missing or the category should not exist.
		Set<Category> reachable = ClassificationRules.ordered()
			.stream()
			.map(ClassificationRule::category)
			.collect(Collectors.toCollection(() -> EnumSet.noneOf(Category.class)));

		assertThat(reachable).containsExactlyInAnyOrderElementsOf(
				EnumSet.complementOf(EnumSet.of(Category.UNCLASSIFIED)));
	}

	@Test
	@DisplayName("never assigns UNCLASSIFIED from a rule")
	void neverAssignsUnclassified() {
		assertThat(ClassificationRules.ordered()).extracting(ClassificationRule::category)
			.doesNotContain(Category.UNCLASSIFIED);
	}

	@Test
	@DisplayName("keeps rule names unique, so a classification record points at one rule")
	void keepsNamesUnique() {
		assertThat(ClassificationRules.ordered()).extracting(ClassificationRule::name).doesNotHaveDuplicates();
	}

	@Test
	@DisplayName("keys no rule on the word refund")
	void doesNotClassifyRefundsAsTheirOwnThing() {
		// Spec §5: a refund keeps the category of what it refunds, as a negative
		// amount. A rule matching "refund" would collect them all into one
		// bucket and leave every other category's total gross rather than net.
		// Asked of each field the rule actually reads. Hardcoding DESCRIPTION
		// would let a merchant-scoped rule pass without being examined at all,
		// since matches() declines an unscoped field before consulting the
		// pattern.
		List<ClassificationRule> matchingRefund = ClassificationRules.ordered()
			.stream()
			.filter(rule -> matchesAnyField(rule, "refund", -100) || matchesAnyField(rule, "reimbursement", -100))
			.toList();

		assertThat(matchingRefund).isEmpty();
	}

	@Test
	@DisplayName("keeps guarded and unguarded rules from sharing vocabulary")
	void keepsGuardedAndUnguardedVocabulariesDisjoint() {
		// The invariant a shared "gift" keyword broke. An amount guard separates
		// money in from money out, and that is all it can do — it cannot separate
		// two money-in meanings of the same word. A refund is money in, so any
		// word owned by both a MONEY_IN rule and a spending rule sends that
		// category's refunds to the guarded rule, when spec §5 says a refund
		// keeps the category it refunds.
		//
		// Stated over the whole table rather than as one more example, because
		// the example-driven tests only exercise the keywords someone thought to
		// write an example for.
		List<ClassificationRule> guarded = ClassificationRules.ordered()
			.stream()
			.filter(rule -> rule.amountGuard() != AmountGuard.ANY)
			.toList();

		for (ClassificationRule spending : ClassificationRules.ordered()) {
			if (spending.amountGuard() != AmountGuard.ANY) {
				continue;
			}
			for (String keyword : spending.keywords()) {
				for (ClassificationRule guardedRule : guarded) {
					// Every field the guarded rule reads, not a hardcoded one:
					// matches() declines a field the rule isn't scoped to before
					// it ever looks at the pattern, so asking only about
					// DESCRIPTION would let a merchant-scoped guarded rule — an
					// income brand like a payroll provider, say — pass this loop
					// without a single keyword being compared.
					assertThat(matchesAnyField(guardedRule, keyword, -100))
						.as("%s claims %s's keyword '%s' on money in, so a refund of a %s expense would be booked as %s",
								guardedRule.name(), spending.name(), keyword, spending.category(),
								guardedRule.category())
						.isFalse();
				}
			}
		}
	}

	@Test
	@DisplayName("asks about every field a rule reads, so a merchant-scoped rule is not skipped")
	void vocabularyCheckIsNotFieldBlind() {
		// Guards the guard. A merchant-only rule returns false from
		// matches(DESCRIPTION, ...) whatever its keywords are, so an invariant
		// that only asked about DESCRIPTION would go green on a table containing
		// exactly the overlap it exists to catch.
		ClassificationRule merchantScoped = ClassificationRule
			.onMerchant("test.merchant-scoped-income", Category.INCOME, "Netflix")
			.guardedBy(AmountGuard.MONEY_IN);

		assertThat(merchantScoped.matches(MatchField.DESCRIPTION, "Netflix", -100)).isFalse();
		assertThat(matchesAnyField(merchantScoped, "Netflix", -100)).isTrue();
	}

	private static boolean matchesAnyField(ClassificationRule rule, String text, long amountMinor) {
		return rule.fields().stream().anyMatch(field -> rule.matches(field, text, amountMinor));
	}

	@Test
	@DisplayName("compares rules by value, not by the identity of a compiled pattern")
	void comparesRulesByValue() {
		// Pattern inherits identity equality, so a record holding one would make
		// these unequal and give the rule a hash that changes run to run — which
		// would quietly break any Set or Map of rules, and with it the ordering
		// determinism the engine rests on.
		ClassificationRule one = ClassificationRule.onAnyText("test.equality", Category.DINING, "coffee");
		ClassificationRule other = ClassificationRule.onAnyText("test.equality", Category.DINING, "coffee");

		assertThat(one).isEqualTo(other).hasSameHashCodeAs(other);
		// A HashSet rather than Set.of, which rejects a duplicate by throwing
		// instead of collapsing it — that would pass for the wrong reason.
		assertThat(new HashSet<>(List.of(one, other))).hasSize(1);
	}

	@Test
	@DisplayName("consults merchant before description")
	void matchOrderIsMerchantThenDescription() {
		// ExpenseClassifier iterates MatchField.values() as its outer loop, so
		// this declaration order is the spec §5 match order. Reversing the enum
		// would make a description outrank a merchant with nothing else changing.
		assertThat(Arrays.asList(MatchField.values())).containsExactly(MatchField.MERCHANT, MatchField.DESCRIPTION);
	}

}
