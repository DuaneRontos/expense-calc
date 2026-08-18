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

	private long totalMinor() {
		return this.entityManager.getEntityManager()
			.createQuery("SELECT SUM(e.amountMinor) FROM Expense e", Long.class)
			.getSingleResult();
	}

	private void record(String merchant, String amount) {
		this.repository.save(Expense.record(new BigDecimal(amount), "PHP", WHEN, merchant, null));
	}

	@Test
	@DisplayName("nets a refund against its expense rather than adding or dropping it")
	void netsRefundsAgainstSpending() {
		record("Puregold", "1200.00");
		record("Puregold", "-350.00");
		this.entityManager.flush();

		// The two wrong answers this is here to exclude: 155000 if the refund
		// were abs()'d and added, 120000 if negatives were filtered out.
		assertThat(totalMinor()).isEqualTo(85_000L);
	}

	@Test
	@DisplayName("lets a total go negative when refunds exceed spending in the period")
	void allowsANegativeTotal() {
		// Spec §7: "Buckets may be negative. A category with more refunds than
		// spending in a period nets negative. Charts must render this rather
		// than clamping at zero."
		record("Landers", "500.00");
		record("Landers", "-1250.00");
		this.entityManager.flush();

		assertThat(totalMinor()).isEqualTo(-75_000L);
		assertThat(totalMinor()).isNegative();
	}

	@Test
	@DisplayName("nets to exactly zero when a refund cancels its expense")
	void netsToZero() {
		// Zero is a real total, not an absent one. A report that omits a
		// zero-netting bucket loses the fact that anything happened at all,
		// and spec §7 wants contiguous buckets rather than gaps.
		record("S&R", "899.50");
		record("S&R", "-899.50");
		this.entityManager.flush();

		assertThat(totalMinor()).isZero();
	}

	@Test
	@DisplayName("keeps each bucket's sign independent when totalling by group")
	void groupsWithoutLosingSigns() {
		// The shape spec §7 returns: buckets with their own totals, one of them
		// negative here. A GROUP BY that clamped or filtered would flatten the
		// second bucket into the first's sign.
		record("Meralco", "3890.50");
		record("Watsons", "650.00");
		record("Watsons", "-1200.00");
		this.entityManager.flush();

		List<Object[]> buckets = this.entityManager.getEntityManager()
			.createQuery("SELECT e.merchant, SUM(e.amountMinor) FROM Expense e GROUP BY e.merchant ORDER BY e.merchant",
					Object[].class)
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
		// Integer centavos, so this is exact by construction — the point is to
		// have a test that fails the day someone routes a total through a
		// double, which is the failure this storage choice exists to prevent
		// and which only shows up in aggregate.
		long expected = 0;
		for (int i = 1; i <= 500; i++) {
			String amount = "%d.%02d".formatted(i, i % 100);
			long minor = i * 100L + (i % 100);
			if (i % 3 == 0) {
				record("Bulk", "-" + amount);
				expected -= minor;
			}
			else {
				record("Bulk", amount);
				expected += minor;
			}
		}
		this.entityManager.flush();

		assertThat(totalMinor()).isEqualTo(expected);
	}

}
