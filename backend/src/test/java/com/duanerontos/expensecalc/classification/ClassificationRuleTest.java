package com.duanerontos.expensecalc.classification;

import java.util.List;
import java.util.Set;

import com.duanerontos.expensecalc.expense.Category;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/**
 * The invariants a single rule has to hold before the table is even considered.
 * No Spring context and no database — a rule is a value, and its constraints
 * should be provable without Docker running.
 */
class ClassificationRuleTest {

	@Test
	@DisplayName("refuses a rule with no keywords, so amount can never classify alone")
	void refusesRuleWithoutKeywords() {
		// Spec §5's "amount alone never determines a category" holds here rather
		// than in a comment: there is no constructor path to a rule that matches
		// nothing textual, so no future rule can be written in violation of it.
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRule.onAnyText("bad.no-keywords", Category.DINING))
			.withMessageContaining("Amount alone never determines a category");
	}

	@Test
	@DisplayName("refuses a rule that assigns UNCLASSIFIED")
	void refusesUnclassifiedRule() {
		// UNCLASSIFIED means "nothing matched". A rule assigning it would make an
		// unmatched expense indistinguishable from a matched one, and the user
		// would have no way to tell which rows still need a decision.
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRule.onAnyText("bad.unclassified", Category.UNCLASSIFIED, "whatever"))
			.withMessageContaining("UNCLASSIFIED");
	}

	@Test
	@DisplayName("refuses a rule that reads no field")
	void refusesRuleWithoutFields() {
		assertThatIllegalArgumentException()
			.isThrownBy(() -> new ClassificationRule("bad.no-fields", Category.DINING, Set.of(), List.of("coffee"),
					AmountGuard.ANY))
			.withMessageContaining("reads no field");
	}

	@ParameterizedTest
	@ValueSource(strings = { "", "   " })
	@DisplayName("refuses a blank rule name, which is what a classification record cites")
	void refusesBlankName(String name) {
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRule.onAnyText(name, Category.DINING, "coffee"));
	}

	@Test
	@DisplayName("names the malformed rule when a keyword is null or blank")
	void refusesNullOrBlankKeyword() {
		// The check runs before List.copyOf, which would otherwise reject a null
		// element with a bare NPE naming neither the rule nor the problem.
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRule.onAnyText("bad.null-keyword", Category.DINING, "coffee", null))
			.withMessageContaining("bad.null-keyword");
		assertThatIllegalArgumentException()
			.isThrownBy(() -> ClassificationRule.onAnyText("bad.blank-keyword", Category.DINING, "coffee", "  "))
			.withMessageContaining("bad.blank-keyword");
	}

	@Test
	@DisplayName("matches whole words only")
	void matchesWholeWords() {
		ClassificationRule rule = ClassificationRule.onAnyText("test.smart", Category.UTILITIES, "Smart");

		assertThat(rule.matches(MatchField.MERCHANT, "Smart", 100)).isTrue();
		assertThat(rule.matches(MatchField.MERCHANT, "Smart Communications", 100)).isTrue();
		// The reason substring matching is not good enough: a smartphone is not a
		// phone plan, and neither is a smartwatch.
		assertThat(rule.matches(MatchField.MERCHANT, "smartphone", 100)).isFalse();
		assertThat(rule.matches(MatchField.MERCHANT, "Walmart", 100)).isFalse();
	}

	@Test
	@DisplayName("matches keywords that carry punctuation")
	void matchesPunctuatedKeywords() {
		// Word boundaries are lookarounds rather than \b precisely so these work.
		ClassificationRule rule = ClassificationRule.onAnyText("test.punctuation", Category.GROCERIES, "S&R",
				"McDonald's", "sari-sari");

		assertThat(rule.matches(MatchField.MERCHANT, "S&R Membership Shopping", 100)).isTrue();
		assertThat(rule.matches(MatchField.MERCHANT, "McDonald's", 100)).isTrue();
		assertThat(rule.matches(MatchField.DESCRIPTION, "sari-sari store", 100)).isTrue();
		assertThat(rule.matches(MatchField.MERCHANT, "MS&RT Holdings", 100)).isFalse();
	}

	@Test
	@DisplayName("ignores case")
	void ignoresCase() {
		ClassificationRule rule = ClassificationRule.onAnyText("test.case", Category.DINING, "Jollibee");

		assertThat(rule.matches(MatchField.MERCHANT, "JOLLIBEE", 100)).isTrue();
		assertThat(rule.matches(MatchField.MERCHANT, "jollibee", 100)).isTrue();
	}

	@Test
	@DisplayName("does not match a field it was not scoped to")
	void respectsFieldScope() {
		ClassificationRule rule = ClassificationRule.onMerchant("test.merchant-only", Category.UTILITIES, "Globe");

		assertThat(rule.matches(MatchField.MERCHANT, "Globe", 100)).isTrue();
		assertThat(rule.matches(MatchField.DESCRIPTION, "Globe", 100)).isFalse();
	}

	@Test
	@DisplayName("does not match absent text")
	void doesNotMatchNull() {
		ClassificationRule rule = ClassificationRule.onAnyText("test.null", Category.DINING, "coffee");

		assertThat(rule.matches(MatchField.MERCHANT, null, 100)).isFalse();
	}

	@Test
	@DisplayName("consults the amount guard only after the text matched")
	void guardNarrowsAnExistingMatch() {
		ClassificationRule rule = ClassificationRule.onAnyText("test.guarded", Category.INCOME, "salary")
			.guardedBy(AmountGuard.MONEY_IN);

		assertThat(rule.matches(MatchField.DESCRIPTION, "salary", -100)).isTrue();
		// Same text, opposite direction: the guard removes a match the text made.
		// It can never add one, which is what keeps amount a disambiguator.
		assertThat(rule.matches(MatchField.DESCRIPTION, "salary", 100)).isFalse();
		assertThat(rule.matches(MatchField.DESCRIPTION, "anything else", -100)).isFalse();
	}

}
