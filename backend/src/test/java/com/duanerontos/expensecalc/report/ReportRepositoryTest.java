package com.duanerontos.expensecalc.report;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

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
 * The aggregation itself, against a real Postgres.
 *
 * <p>This is the query spec §10 constrains: one statement, no N+1, and the
 * category resolved inside the aggregate rather than per expense. A mock would
 * prove none of that — {@code LEFT JOIN LATERAL}, the native enum cast, and the
 * statement count are all properties of the database.
 *
 * <p>Requires Docker.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
class ReportRepositoryTest {

	private static final ReportPeriod JANUARY = new ReportPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1));

	private static final Instant CLASSIFIED_AT = Instant.parse("2026-01-05T02:00:00Z");

	private static final Instant RECLASSIFIED_AT = Instant.parse("2026-02-10T02:00:00Z");

	private static final Instant NOW = Instant.parse("2026-03-01T00:00:00Z");

	@Autowired
	private ReportRepository reports;

	@Autowired
	private ExpenseRepository expenses;

	@Autowired
	private ClassificationRecordRepository records;

	@Autowired
	private TestEntityManager entityManager;

	private UUID expense(String amount, LocalDate on) {
		return this.expenses.save(Expense.record(new BigDecimal(amount), "PHP", on, "Fixture", null)).getId();
	}

	private void classify(UUID expenseId, Category category, Instant when) {
		this.records.save(ClassificationRecord.fromUser(expenseId, category, "fixture", when));
	}

	private Map<Category, Long> totals(Instant asOf) {
		this.entityManager.flush();
		this.entityManager.clear();
		return this.reports.totalsByCategory(JANUARY.from(), JANUARY.to(), asOf)
			.stream()
			.collect(Collectors.toMap(row -> Category.valueOf(row.getCategory()),
					ReportRepository.CategoryTotalRow::getTotalMinor));
	}

	@Test
	@DisplayName("groups by the current category and nets the signed amounts")
	void groupsAndNets() {
		classify(expense("1200.00", LocalDate.of(2026, 1, 8)), Category.GROCERIES, CLASSIFIED_AT);
		classify(expense("-350.00", LocalDate.of(2026, 1, 20)), Category.GROCERIES, CLASSIFIED_AT);
		classify(expense("640.00", LocalDate.of(2026, 1, 12)), Category.DINING, CLASSIFIED_AT);

		assertThat(totals(NOW)).containsExactlyInAnyOrderEntriesOf(
				Map.of(Category.GROCERIES, 85_000L, Category.DINING, 64_000L));
	}

	@Test
	@DisplayName("lets a bucket net negative when refunds exceed spending")
	void allowsNegativeBuckets() {
		classify(expense("500.00", LocalDate.of(2026, 1, 8)), Category.DISCRETIONARY, CLASSIFIED_AT);
		classify(expense("-1250.00", LocalDate.of(2026, 1, 20)), Category.DISCRETIONARY, CLASSIFIED_AT);

		assertThat(totals(NOW)).containsEntry(Category.DISCRETIONARY, -75_000L);
	}

	@Test
	@DisplayName("excludes the upper bound and includes the lower one")
	void respectsTheHalfOpenPeriod() {
		classify(expense("100.00", LocalDate.of(2025, 12, 31)), Category.DINING, CLASSIFIED_AT);
		classify(expense("200.00", LocalDate.of(2026, 1, 1)), Category.DINING, CLASSIFIED_AT);
		classify(expense("400.00", LocalDate.of(2026, 1, 31)), Category.DINING, CLASSIFIED_AT);
		classify(expense("800.00", LocalDate.of(2026, 2, 1)), Category.DINING, CLASSIFIED_AT);

		// 1 Jan and 31 Jan are in; 31 Dec and 1 Feb are not. If the bound were
		// closed, February's first day would be counted twice across two reports.
		assertThat(totals(NOW)).containsEntry(Category.DINING, 60_000L);
	}

	@Test
	@DisplayName("keeps an expense whose category is not yet visible, rather than losing its money")
	void keepsUnclassifiedMoney() {
		// LEFT JOIN plus COALESCE. An inner join would drop this row entirely
		// and the money would vanish from the total — a worse failure than money
		// sitting in UNCLASSIFIED, which is at least visible (spec §5).
		UUID lateEntry = expense("999.00", LocalDate.of(2026, 1, 15));
		classify(lateEntry, Category.GROCERIES, RECLASSIFIED_AT);

		Instant beforeItWasClassified = Instant.parse("2026-01-20T00:00:00Z");

		assertThat(totals(beforeItWasClassified)).containsEntry(Category.UNCLASSIFIED, 99_900L);
		assertThat(totals(NOW)).containsEntry(Category.GROCERIES, 99_900L);
	}

	@Test
	@DisplayName("reproduces a closed period when pinned to an instant, and moves when not")
	void asOfPinsTheCategory() {
		UUID expenseId = expense("1000.00", LocalDate.of(2026, 1, 15));
		classify(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		classify(expenseId, Category.DINING, RECLASSIFIED_AT);

		Instant januaryClosed = Instant.parse("2026-02-01T00:00:00Z");

		// Issue #9's reproducibility, and the reason both reads exist: pinned to
		// 1 February, January still reports what it reported then.
		assertThat(totals(januaryClosed)).containsEntry(Category.GROCERIES, 100_000L)
			.doesNotContainKey(Category.DINING);
		// Unpinned, the correction applies to the history it corrects.
		assertThat(totals(NOW)).containsEntry(Category.DINING, 100_000L).doesNotContainKey(Category.GROCERIES);
	}

	@Test
	@DisplayName("returns nothing at all for a period with no expenses")
	void returnsNothingForAnEmptyPeriod() {
		classify(expense("500.00", LocalDate.of(2026, 6, 1)), Category.DINING, CLASSIFIED_AT);

		assertThat(totals(NOW)).isEmpty();
	}

	@Test
	@DisplayName("resolves every expense's category in one statement, whatever the row count")
	void doesNotIssueNPlusOneQueries() {
		// Spec §10 forbids N+1 in the report path. The category read is
		// per-expense by nature, so this is the one that would regress if the
		// lateral join were replaced by a loop — and the statement count is the
		// only thing that notices.
		for (int i = 1; i <= 25; i++) {
			classify(expense("%d.00".formatted(i), LocalDate.of(2026, 1, 10)),
					i % 2 == 0 ? Category.GROCERIES : Category.DINING, CLASSIFIED_AT);
		}
		this.entityManager.flush();
		this.entityManager.clear();

		Statistics statistics = this.entityManager.getEntityManager()
			.getEntityManagerFactory()
			.unwrap(SessionFactory.class)
			.getStatistics();
		statistics.clear();

		List<ReportRepository.CategoryTotalRow> rows = this.reports.totalsByCategory(JANUARY.from(), JANUARY.to(), NOW);

		assertThat(rows).hasSize(2);
		assertThat(statistics.getPrepareStatementCount())
			.as("one aggregate over 25 expenses, not one query per expense")
			.isEqualTo(1);
	}

	private Map<LocalDate, Long> timeBuckets(TimeBucket bucket) {
		this.entityManager.flush();
		this.entityManager.clear();
		return this.reports.totalsByTimeBucket(JANUARY.from(), JANUARY.to(), bucket.truncUnit())
			.stream()
			.collect(Collectors.toMap(ReportRepository.BucketTotalRow::getBucketStart,
					ReportRepository.BucketTotalRow::getTotalMinor));
	}

	@Test
	@DisplayName("agrees with TimeBucket about where a week starts")
	void weekBoundariesMatchTheJavaSide() {
		// The load-bearing agreement in the over-time report. Postgres
		// date_trunc('week') snaps to Monday; TimeBucket.WEEK must snap to the
		// same day, or the zero-filling would generate bucket starts the query
		// never returns — every week reading zero while the real totals sat in
		// buckets nothing looked for. Asserting it against the database is the
		// only way to know they agree.
		LocalDate wednesday = LocalDate.of(2026, 1, 7);
		classify(expense("100.00", wednesday), Category.DINING, CLASSIFIED_AT);

		Map<LocalDate, Long> weeks = timeBuckets(TimeBucket.WEEK);

		assertThat(weeks).containsExactly(java.util.Map.entry(LocalDate.of(2026, 1, 5), 10_000L));
		assertThat(TimeBucket.WEEK.startOfBucket(wednesday)).isEqualTo(LocalDate.of(2026, 1, 5));
	}

	@Test
	@DisplayName("groups by day, week and month at the same data")
	void groupsAtEveryWidth() {
		classify(expense("100.00", LocalDate.of(2026, 1, 5)), Category.DINING, CLASSIFIED_AT);
		classify(expense("200.00", LocalDate.of(2026, 1, 6)), Category.DINING, CLASSIFIED_AT);
		classify(expense("400.00", LocalDate.of(2026, 1, 20)), Category.DINING, CLASSIFIED_AT);

		assertThat(timeBuckets(TimeBucket.DAY)).hasSize(3);
		// 5 and 6 January are the same week; 20 January is not.
		assertThat(timeBuckets(TimeBucket.WEEK)).hasSize(2)
			.containsEntry(LocalDate.of(2026, 1, 5), 30_000L);
		assertThat(timeBuckets(TimeBucket.MONTH)).containsExactly(
				java.util.Map.entry(LocalDate.of(2026, 1, 1), 70_000L));
	}

	@Test
	@DisplayName("nets refunds inside a time bucket and lets one go negative")
	void netsRefundsWithinATimeBucket() {
		classify(expense("500.00", LocalDate.of(2026, 1, 12)), Category.DINING, CLASSIFIED_AT);
		classify(expense("-1250.00", LocalDate.of(2026, 1, 13)), Category.DINING, CLASSIFIED_AT);

		assertThat(timeBuckets(TimeBucket.MONTH)).containsEntry(LocalDate.of(2026, 1, 1), -75_000L);
	}

	@Test
	@DisplayName("returns only the slices that have expenses, leaving the fill to the response")
	void returnsOnlyPopulatedSlices() {
		// The query is deliberately sparse; SpendOverTime generates the
		// contiguous sequence. Asserting the sparseness keeps the two halves of
		// that contract honest about which one fills the gaps.
		classify(expense("100.00", LocalDate.of(2026, 1, 5)), Category.DINING, CLASSIFIED_AT);

		assertThat(timeBuckets(TimeBucket.DAY)).hasSize(1);
	}

	@Test
	@DisplayName("keeps each category's sign independent")
	void keepsBucketSignsIndependent() {
		classify(expense("3890.50", LocalDate.of(2026, 1, 3)), Category.UTILITIES, CLASSIFIED_AT);
		classify(expense("650.00", LocalDate.of(2026, 1, 4)), Category.HEALTH, CLASSIFIED_AT);
		classify(expense("-1200.00", LocalDate.of(2026, 1, 5)), Category.HEALTH, CLASSIFIED_AT);

		Map<Category, Long> totals = totals(NOW);

		assertThat(totals).containsEntry(Category.UTILITIES, 389_050L).containsEntry(Category.HEALTH, -55_000L);
	}

}
