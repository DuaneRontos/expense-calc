package com.duanerontos.expensecalc.expense;

import java.math.BigDecimal;
import java.time.LocalDate;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
// Boot 4 relocated the test slices out of org.springframework.boot.test.autoconfigure.*
// into per-module packages. Boot 3 imports do not compile here.
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Round-trips {@link Expense} through a real Postgres.
 *
 * <p>Requires a Docker daemon. Everything that can be proven without one lives
 * in {@link ExpenseTest} and
 * {@link com.duanerontos.expensecalc.money.MoneyTest} instead — a database is
 * not needed to check arithmetic, and tying money tests to Docker would mean
 * they stop running the moment Docker is unavailable.
 *
 * <p>{@code replace = NONE} because {@code @DataJpaTest} otherwise swaps in an
 * embedded database and the container would be ignored. An embedded H2 would
 * also silently accept SQL that Postgres rejects, which defeats the point.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class ExpenseRepositoryTest {

	private static final LocalDate WHEN = LocalDate.of(2026, 1, 15);

	@Autowired
	private ExpenseRepository repository;

	@Autowired
	private TestEntityManager entityManager;

	@Test
	@DisplayName("persists an expense and reads the amount back unchanged")
	void roundTripsAnExpense() {
		Expense saved = this.repository.save(Expense.record(new BigDecimal("1234.56"), "PHP", WHEN, "Puregold", "weekly groceries"));
		this.entityManager.flush();
		this.entityManager.clear();

		Expense found = this.repository.findById(saved.getId()).orElseThrow();

		assertThat(found.getAmountMinor()).isEqualTo(123456L);
		assertThat(found.getAmount()).isEqualByComparingTo("1234.56");
		assertThat(found.getCurrency()).isEqualTo("PHP");
		assertThat(found.getOccurredOn()).isEqualTo(WHEN);
		assertThat(found.getMerchant()).isEqualTo("Puregold");
	}

	@Test
	@DisplayName("stores a refund as a negative amount rather than clamping it")
	void storesRefundsNegative() {
		Expense saved = this.repository.save(Expense.record(new BigDecimal("-612.40"), "PHP", WHEN, "Puregold", "returned items"));
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.repository.findById(saved.getId()).orElseThrow().getAmountMinor()).isEqualTo(-61240L);
	}

	@Test
	@DisplayName("sets both audit timestamps on insert")
	void setsAuditTimestamps() {
		Expense saved = this.repository.save(Expense.record(BigDecimal.TEN, "PHP", WHEN, null, null));
		this.entityManager.flush();

		assertThat(saved.getCreatedAt()).isNotNull();
		assertThat(saved.getUpdatedAt()).isNotNull();
	}

	@Test
	@DisplayName("keeps the peso symbol intact through the database")
	void keepsNonAsciiTextIntact() {
		// Issue #5 asks for UTF-8 end to end. A broken column encoding shows up
		// here as mojibake rather than as an error.
		String description = "₱ payment at Ministop — branch 12";
		Expense saved = this.repository.save(Expense.record(new BigDecimal("99.00"), "PHP", WHEN, "Ministop", description));
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.repository.findById(saved.getId()).orElseThrow().getDescription()).isEqualTo(description);
	}

}
