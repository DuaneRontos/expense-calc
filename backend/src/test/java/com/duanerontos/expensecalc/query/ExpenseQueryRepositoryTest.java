package com.duanerontos.expensecalc.query;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import com.duanerontos.expensecalc.classification.ClassificationRecord;
import com.duanerontos.expensecalc.classification.ClassificationRecordRepository;
import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.expense.Expense;
import com.duanerontos.expensecalc.expense.ExpenseRepository;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The filtered, sorted, paged read against a real Postgres (spec §6).
 *
 * <p>Needs the database: the {@code LATERAL} join, {@code ILIKE}, the enum cast,
 * the text-array binding, and {@code NULLS LAST} are all properties of Postgres
 * rather than of the code.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({ TestcontainersConfiguration.class, ExpenseQueryRepository.class })
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
class ExpenseQueryRepositoryTest {

	private static final Instant CLASSIFIED_AT = Instant.parse("2026-01-02T00:00:00Z");

	private static final Instant NOW = Instant.parse("2026-06-01T00:00:00Z");

	@Autowired
	private ExpenseQueryRepository queries;

	@Autowired
	private ExpenseRepository expenses;

	@Autowired
	private ClassificationRecordRepository records;

	@Autowired
	private TestEntityManager entityManager;

	private UUID given(String amount, LocalDate on, String merchant, String description, Category category) {
		UUID id = this.expenses.save(Expense.record(new BigDecimal(amount), "PHP", on, merchant, description)).getId();
		this.records.save(ClassificationRecord.fromUser(id, category, "fixture", CLASSIFIED_AT));
		return id;
	}

	private List<ExpenseSummary> find(ExpenseFilter filter) {
		this.entityManager.flush();
		this.entityManager.clear();
		return this.queries.findPage(filter, ExpenseSort.OCCURRED_ON, true, 0, 50, NOW);
	}

	private ExpenseFilter filter(Set<Category> categories, LocalDate from, LocalDate to, String merchant, String text,
			Long min, Long max) {
		return new ExpenseFilter(categories, from, to, merchant, text, min, max);
	}

	@Test
	@DisplayName("resolves each row's current category in the same query")
	void resolvesCategories() {
		given("1200.00", LocalDate.of(2026, 1, 8), "Puregold", "weekly shop", Category.GROCERIES);

		assertThat(find(ExpenseFilter.unfiltered())).singleElement()
			.satisfies(row -> {
				assertThat(row.category()).isEqualTo("GROCERIES");
				assertThat(row.categoryLabel()).isEqualTo("Groceries");
				assertThat(row.amount()).isEqualTo("1200.00");
				assertThat(row.currency()).isEqualTo("PHP");
			});
	}

	@Test
	@DisplayName("ORs categories within the filter and ANDs them against the rest")
	void combinesCategoryFilter() {
		given("100.00", LocalDate.of(2026, 1, 8), "Puregold", null, Category.GROCERIES);
		given("200.00", LocalDate.of(2026, 1, 9), "Jollibee", null, Category.DINING);
		given("300.00", LocalDate.of(2026, 1, 10), "Grab", null, Category.TRANSPORT);

		assertThat(find(filter(Set.of(Category.GROCERIES, Category.DINING), null, null, null, null, null, null)))
			.extracting(ExpenseSummary::category)
			.containsExactlyInAnyOrder("GROCERIES", "DINING");

		// AND against a merchant: either category, but only at Puregold.
		assertThat(find(filter(Set.of(Category.GROCERIES, Category.DINING), null, null, "puregold", null, null, null)))
			.singleElement()
			.extracting(ExpenseSummary::category)
			.isEqualTo("GROCERIES");
	}

	@Test
	@DisplayName("keeps the date range half-open")
	void filtersHalfOpenDates() {
		given("100.00", LocalDate.of(2025, 12, 31), "A", null, Category.DINING);
		given("200.00", LocalDate.of(2026, 1, 1), "B", null, Category.DINING);
		given("400.00", LocalDate.of(2026, 1, 31), "C", null, Category.DINING);
		given("800.00", LocalDate.of(2026, 2, 1), "D", null, Category.DINING);

		assertThat(find(filter(Set.of(), LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1), null, null, null, null)))
			.extracting(ExpenseSummary::merchant)
			.containsExactlyInAnyOrder("B", "C");
	}

	@Test
	@DisplayName("matches merchant and description case-insensitively, as substrings")
	void filtersText() {
		given("100.00", LocalDate.of(2026, 1, 8), "SM Supermarket", "weekly GROCERY run", Category.GROCERIES);
		given("200.00", LocalDate.of(2026, 1, 9), "Jollibee", "lunch with Ana", Category.DINING);

		assertThat(find(filter(Set.of(), null, null, "supermarket", null, null, null))).hasSize(1);
		assertThat(find(filter(Set.of(), null, null, null, "grocery", null, null))).hasSize(1);
		assertThat(find(filter(Set.of(), null, null, null, "ANA", null, null))).hasSize(1);
	}

	@Test
	@DisplayName("treats a percent or underscore in a filter as text, not as a wildcard")
	void escapesLikeMetacharacters() {
		// The value was always bound, so this was never injection — but % and _
		// are LIKE metacharacters, so ?merchant=% returned every expense and
		// ?merchant=_M matched SM. The results looked plausible enough that
		// nobody would check, and "100% Fitness" is a real merchant name.
		given("100.00", LocalDate.of(2026, 1, 8), "Puregold", "weekly shop", Category.GROCERIES);
		given("200.00", LocalDate.of(2026, 1, 9), "SM", "monthly stock up", Category.GROCERIES);
		given("300.00", LocalDate.of(2026, 1, 10), "100% Fitness", "gym dues", Category.DISCRETIONARY);

		// A literal % now matches only the merchant that contains one, rather
		// than matching everything as a wildcard.
		assertThat(find(filter(Set.of(), null, null, "%", null, null, null))).singleElement()
			.extracting(ExpenseSummary::merchant)
			.isEqualTo("100% Fitness");
		// And _ is a character, not "any character" — so this matches nothing,
		// where before it matched SM.
		assertThat(find(filter(Set.of(), null, null, "_M", null, null, null))).isEmpty();
		assertThat(find(filter(Set.of(), null, null, "100%", null, null, null))).singleElement()
			.extracting(ExpenseSummary::merchant)
			.isEqualTo("100% Fitness");
		// And an ordinary substring still works.
		assertThat(find(filter(Set.of(), null, null, "pure", null, null, null))).hasSize(1);
	}

	@Test
	@DisplayName("sorts unclassified rows last, where the taxonomy puts them")
	void sortsUnclassifiedLast() {
		// UNCLASSIFIED is declared last precisely so it sorts to the bottom.
		// Ordering on the text cast put it between TRANSPORT and UTILITIES.
		this.expenses.save(Expense.record(new BigDecimal("50.00"), "PHP", LocalDate.of(2026, 1, 8), "none", null));
		given("100.00", LocalDate.of(2026, 1, 9), "housing", null, Category.HOUSING);
		given("100.00", LocalDate.of(2026, 1, 10), "transport", null, Category.TRANSPORT);
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.CATEGORY, false, 0, 50, NOW))
			.extracting(ExpenseSummary::category)
			.containsExactly("HOUSING", "TRANSPORT", "UNCLASSIFIED");
	}

	@Test
	@DisplayName("compares amount bounds against the signed value, not the magnitude")
	void filtersOnSignedAmount() {
		// A refund is negative, so a minimum of zero must exclude it rather
		// than including it because it is large in magnitude (issue #8).
		given("1200.00", LocalDate.of(2026, 1, 8), "Puregold", null, Category.GROCERIES);
		given("-3500.00", LocalDate.of(2026, 1, 9), "Puregold", null, Category.GROCERIES);

		assertThat(find(filter(Set.of(), null, null, null, null, 0L, null))).singleElement()
			.extracting(ExpenseSummary::amount)
			.isEqualTo("1200.00");
		assertThat(find(filter(Set.of(), null, null, null, null, null, 0L))).singleElement()
			.extracting(ExpenseSummary::amount)
			.isEqualTo("-3500.00");
	}

	@Test
	@DisplayName("keeps an unclassified expense in the results")
	void includesUnclassifiedExpenses() {
		// No classification record at all. An inner join would drop the row and
		// the expense would be invisible in every list — worse than showing it
		// as UNCLASSIFIED, which is a state spec §5 treats as real.
		this.expenses.save(Expense.record(new BigDecimal("50.00"), "PHP", LocalDate.of(2026, 1, 8), "Mystery", null));

		assertThat(find(ExpenseFilter.unfiltered())).singleElement()
			.extracting(ExpenseSummary::category)
			.isEqualTo("UNCLASSIFIED");
		assertThat(find(filter(Set.of(Category.UNCLASSIFIED), null, null, null, null, null, null))).hasSize(1);
	}

	@Test
	@DisplayName("does not drop or duplicate rows across pages of identical amounts")
	void pagesStablyThroughIdenticalAmounts() {
		// Issue #11 asks for this explicitly. Without the id tiebreaker the
		// database may return equal rows in any order, and a different order
		// for page 2 than for page 1 — so a row appears twice and another never
		// appears at all. It only shows on real data, and it looks like the
		// data changed underneath the user.
		for (int i = 0; i < 25; i++) {
			given("500.00", LocalDate.of(2026, 1, 15), "Same", null, Category.DINING);
		}
		this.entityManager.flush();
		this.entityManager.clear();

		List<UUID> paged = new ArrayList<>();
		for (int page = 0; page < 5; page++) {
			this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.AMOUNT, true, page, 5, NOW)
				.forEach(row -> paged.add(row.id()));
		}

		assertThat(paged).hasSize(25).doesNotHaveDuplicates();
	}

	@Test
	@DisplayName("sorts amount on the stored integer, refunds below spending")
	void sortsBySignedAmount() {
		given("-100.00", LocalDate.of(2026, 1, 8), "refund", null, Category.GROCERIES);
		given("50.00", LocalDate.of(2026, 1, 9), "small", null, Category.GROCERIES);
		given("900.00", LocalDate.of(2026, 1, 10), "large", null, Category.GROCERIES);
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.AMOUNT, false, 0, 50, NOW))
			.extracting(ExpenseSummary::merchant)
			.containsExactly("refund", "small", "large");
	}

	@Test
	@DisplayName("sorts categories in taxonomy order, not alphabetically")
	void sortsCategoriesByTaxonomyOrder() {
		given("100.00", LocalDate.of(2026, 1, 8), "a", null, Category.DINING);
		given("100.00", LocalDate.of(2026, 1, 9), "b", null, Category.HOUSING);
		given("100.00", LocalDate.of(2026, 1, 10), "c", null, Category.CAPITAL);
		this.entityManager.flush();
		this.entityManager.clear();

		// Declaration order is essentials first: HOUSING, then DINING, then
		// CAPITAL. Alphabetically it would be CAPITAL, DINING, HOUSING.
		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.CATEGORY, false, 0, 50, NOW))
			.extracting(ExpenseSummary::category)
			.containsExactly("HOUSING", "DINING", "CAPITAL");
	}

	@Test
	@DisplayName("sorts null merchants last in both directions")
	void sortsNullMerchantsLast() {
		given("100.00", LocalDate.of(2026, 1, 8), null, null, Category.DINING);
		given("100.00", LocalDate.of(2026, 1, 9), "Zed", null, Category.DINING);
		this.entityManager.flush();
		this.entityManager.clear();

		// A descending sort opening with a screen of blanks looks broken.
		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.MERCHANT, true, 0, 50, NOW))
			.extracting(ExpenseSummary::merchant)
			.containsExactly("Zed", null);
		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.MERCHANT, false, 0, 50, NOW))
			.extracting(ExpenseSummary::merchant)
			.containsExactly("Zed", null);
	}

	@Test
	@DisplayName("counts every match, not just the page")
	void countsAllMatches() {
		for (int i = 0; i < 12; i++) {
			given("100.00", LocalDate.of(2026, 1, 8), "M", null, Category.DINING);
		}
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.queries.count(ExpenseFilter.unfiltered(), NOW)).isEqualTo(12);
		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.OCCURRED_ON, true, 0, 5, NOW))
			.hasSize(5);
	}

	@Test
	@DisplayName("resolves a page of categories in one statement, not one per row")
	void doesNotIssueNPlusOneQueries() {
		// Spec §10 forbids N+1 in the expense path. The category is per-row by
		// nature, so this is the query that would regress if the lateral join
		// were replaced by a lookup per expense.
		for (int i = 0; i < 30; i++) {
			given("100.00", LocalDate.of(2026, 1, 8), "M" + i, null, Category.DINING);
		}
		this.entityManager.flush();
		this.entityManager.clear();

		Statistics statistics = this.entityManager.getEntityManager()
			.getEntityManagerFactory()
			.unwrap(SessionFactory.class)
			.getStatistics();
		statistics.clear();

		assertThat(this.queries.findPage(ExpenseFilter.unfiltered(), ExpenseSort.OCCURRED_ON, true, 0, 30, NOW))
			.hasSize(30);
		assertThat(statistics.getPrepareStatementCount()).as("one statement for a page of 30").isEqualTo(1);
	}

}
