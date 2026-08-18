package com.duanerontos.expensecalc.classification;

import java.util.Arrays;
import java.util.EnumSet;
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
		List<ClassificationRule> matchingRefund = ClassificationRules.ordered()
			.stream()
			.filter(rule -> rule.matches(MatchField.DESCRIPTION, "refund", -100)
					|| rule.matches(MatchField.DESCRIPTION, "reimbursement", -100))
			.toList();

		assertThat(matchingRefund).isEmpty();
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
