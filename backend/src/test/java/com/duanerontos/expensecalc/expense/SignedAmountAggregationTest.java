package com.duanerontos.expensecalc.expense;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What a total does when refunds are in it (issue #8, spec §5 and §7).
 *
 * <p>Reporting aggregates in SQL — spec §10 wants a report over 50,000 expenses
 * inside 500ms, which rules out pulling rows into the JVM to add up. So the
 * guarantee that matters is the database's, and this asserts it at that layer
 * rather than over a Java list that reporting will never build.
 *
 * <p>No aggregation code exists to test yet: grouping by category needs the
 * category to be persisted, which is #9. These tests therefore pin the
 * behaviour the aggregation must preserve, so that #12 inherits a failing test
 * if it reaches for {@code abs()}, a {@code WHERE amount_minor > 0}, or a
 * non-negative assumption. Each one asserts what the wrong answers would have
 * been, so the test states the bug it exists to prevent.
 *
 * <p>Requires Docker, like the other Testcontainers suites.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class SignedAmountAggregationTest {

	private static final LocalDate WHEN = LocalDate.of(2026, 3, 4);

	@Autowired
	private ExpenseRepository repository;

	@Autowired
	private TestEntityManager entityManager;

	/**
	 * Scoped to one merchant, and null-safe.
	 *
	 * <p>Scoped because a whole-table aggregate would make these tests depend on
	 * the table being empty — true today only because there is no seed data and
	 * {@code @DataJpaTest} rolls back. The day a seed migration or a committing
	 * fixture arrives, an unscoped version fails with an arithmetic mismatch
	 * pointing at the aggregation rather than at the fixture.
	 *
	 * <p>Null-safe because JPQL {@code SUM} over zero rows returns null, and
	 * unboxing that to a {@code long} throws instead of reporting a total. Spec
	 * §7 has empty periods returning an empty bucket array rather than an error,
	 * so zero rows is a real case rather than a defensive nicety.
	 */
	private long totalMinorFor(String merchant) {
		Long total = this.entityManager.getEntityManager()
			.createQuery("SELECT SUM(e.amountMinor) FROM Expense e WHERE e.merchant = :merchant", Long.class)
			.setParameter("merchant", merchant)
			.getSingleResult();
		return total == null ? 0L : total;
	}

	/** Amount first, matching {@link Expense#record}, which this delegates to. */
	private void record(String amount, String merchant) {
		this.repository.save(Expense.record(new BigDecimal(amount), "PHP", WHEN, merchant, null));
	}

	@Test
	@DisplayName("nets a refund against its expense rather than adding or dropping it")
	void netsRefundsAgainstSpending() {
		record("1200.00", "Puregold");
		record("-350.00", "Puregold");
		this.entityManager.flush();

		// The two wrong answers this is here to exclude: 155000 if the refund
		// were abs()'d and added, 120000 if negatives were filtered out.
		assertThat(totalMinorFor("Puregold")).isEqualTo(85_000L);
	}

	@Test
	@DisplayName("lets a total go negative when refunds exceed spending in the period")
	void allowsANegativeTotal() {
		// Spec §7: "Buckets may be negative. A category with more refunds than
		// spending in a period nets negative. Charts must render this rather
		// than clamping at zero."
		record("500.00", "Landers");
		record("-1250.00", "Landers");
		this.entityManager.flush();

		assertThat(totalMinorFor("Landers")).isEqualTo(-75_000L).isNegative();
	}

	@Test
	@DisplayName("nets to exactly zero when a refund cancels its expense")
	void netsToZero() {
		// Zero is a real total, not an absent one. A report that omits a
		// zero-netting bucket loses the fact that anything happened at all,
		// and spec §7 wants contiguous buckets rather than gaps.
		record("899.50", "S&R");
		record("-899.50", "S&R");
		this.entityManager.flush();

		assertThat(totalMinorFor("S&R")).isZero();
	}

	@Test
	@DisplayName("keeps each bucket's sign independent when totalling by group")
	void groupsWithoutLosingSigns() {
		// The shape spec §7 returns: buckets with their own totals, one of them
		// negative here. A GROUP BY that clamped or filtered would flatten the
		// second bucket into the first's sign.
		record("3890.50", "Meralco");
		record("650.00", "Watsons");
		record("-1200.00", "Watsons");
		this.entityManager.flush();

		List<Object[]> buckets = this.entityManager.getEntityManager()
			.createQuery(
					"SELECT e.merchant, SUM(e.amountMinor) FROM Expense e WHERE e.merchant IN :merchants GROUP BY e.merchant ORDER BY e.merchant",
					Object[].class)
			.setParameter("merchants", List.of("Meralco", "Watsons"))
			.getResultList();

		assertThat(buckets).hasSize(2);
		assertThat(buckets.get(0)[0]).isEqualTo("Meralco");
		assertThat(buckets.get(0)[1]).isEqualTo(389_050L);
		assertThat(buckets.get(1)[0]).isEqualTo("Watsons");
		assertThat(buckets.get(1)[1]).isEqualTo(-55_000L);
	}

	@Test
	@DisplayName("sums exactly across a set large enough to expose drift")
	void sumsExactlyAtScale() {
		// Exact by construction: integer centavos, every partial sum far below
		// 2^53. That is the pin — not a double detector. A double accumulator
		// returns this same answer, in centavos and via pesos, so claiming
		// otherwise would be claiming coverage this does not have.
		// NoAbsoluteValueInMoneyPathsTest is where double is actually excluded.
		long expected = 0;
		for (int i = 1; i <= 500; i++) {
			String amount = "%d.%02d".formatted(i, i % 100);
			long minor = i * 100L + (i % 100);
			if (i % 3 == 0) {
				record("-" + amount, "Bulk");
				expected -= minor;
			}
			else {
				record(amount, "Bulk");
				expected += minor;
			}
		}
		this.entityManager.flush();

		assertThat(totalMinorFor("Bulk")).isEqualTo(expected);
	}

}
