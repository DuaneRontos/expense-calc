package com.duanerontos.expensecalc.expense;

import java.util.Arrays;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the taxonomy's shape. No Spring context and no database — membership
 * is a property of the code, and should fail fast when someone edits the enum.
 */
class CategoryTest {

	@Test
	@DisplayName("contains exactly the taxonomy, in the skill's order")
	void containsExactlyTheTaxonomy() {
		// Spelled out rather than derived, deliberately. This test exists to
		// fail when someone adds or removes a value, and a test that computes
		// its expectation from the enum would pass for any enum at all.
		// Adding a category means a Flyway migration extending
		// expense_category and a destination for every existing expense —
		// updating this list is the prompt to remember that.
		assertThat(Category.values()).containsExactly(Category.HOUSING, Category.UTILITIES, Category.GROCERIES,
				Category.DINING, Category.TRANSPORT, Category.MAINTENANCE, Category.HEALTH, Category.DISCRETIONARY,
				Category.CAPITAL, Category.INCOME, Category.UNCLASSIFIED);
	}

	@Test
	@DisplayName("keeps UNCLASSIFIED, which is a real state rather than an error")
	void keepsUnclassified() {
		// If this ever disappears, classification has nowhere to put an
		// unmatched expense and will start guessing — which corrupts every
		// report downstream instead of surfacing one row for the user to fix.
		assertThat(Category.values()).contains(Category.UNCLASSIFIED);
	}

	@ParameterizedTest
	@EnumSource(Category.class)
	@DisplayName("gives every category a non-blank display label")
	void labelsEveryCategory(Category category) {
		assertThat(category.getLabel()).isNotBlank();
	}

	@Test
	@DisplayName("keeps display labels distinct, so the picker is unambiguous")
	void keepsLabelsDistinct() {
		assertThat(Arrays.stream(Category.values()).map(Category::getLabel)).doesNotHaveDuplicates();
	}

}
