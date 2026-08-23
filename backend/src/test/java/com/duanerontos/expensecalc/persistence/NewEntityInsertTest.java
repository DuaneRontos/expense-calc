package com.duanerontos.expensecalc.persistence;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import com.duanerontos.expensecalc.auth.RefreshToken;
import com.duanerontos.expensecalc.auth.RefreshTokenRepository;
import com.duanerontos.expensecalc.classification.Classification;
import com.duanerontos.expensecalc.classification.ClassificationRecord;
import com.duanerontos.expensecalc.classification.ClassificationRecordRepository;
import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.expense.Expense;
import com.duanerontos.expensecalc.expense.ExpenseRepository;
import jakarta.persistence.EntityManager;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * That inserting a new entity costs one statement, not two (issue #43).
 *
 * <p>{@code SimpleJpaRepository.save} calls {@code merge()} rather than
 * {@code persist()} whenever {@code isNew()} is false, and with a manually
 * assigned {@code @Id} and no {@code @Version} that reduces to
 * {@code id != null}. Every entity here assigns a {@code UUID} in its
 * constructor, so every save looked like an update: a select that returns
 * nothing, then the insert.
 *
 * <p>Counted with Hibernate's own statistics rather than read from the log,
 * because a log assertion passes whenever logging is off. Each test asserts the
 * statement count <em>and</em> the insert count, so a future failure says which
 * half moved rather than only that the number did.
 *
 * <p><b>The {@code Statistics} object belongs to the {@code SessionFactory}, not
 * to this class.</b> The context is shared with any test carrying an identical
 * configuration — matching {@code ReportRepositoryTest}'s property string
 * deliberately, since diverging would fork the context and start a second
 * Testcontainers Postgres. The counter is therefore factory-wide: it is cleared
 * per test here, which is sufficient while JUnit runs classes serially, and
 * would need revisiting if parallel execution were ever enabled.
 *
 * <p>Lives in a neutral package because it now covers three entities across
 * three packages, and the guard that stops a fourth repeating this
 * ({@code AssignedIdEntitiesArePersistableTest}) sits beside it.
 *
 * <p>Requires Docker.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@Import(TestcontainersConfiguration.class)
class NewEntityInsertTest {

	@Autowired
	private ExpenseRepository expenses;

	@Autowired
	private ClassificationRecordRepository records;

	@Autowired
	private RefreshTokenRepository refreshTokens;

	@Autowired
	private EntityManager entityManager;

	private Statistics statistics;

	@BeforeEach
	void resetStatistics() {
		this.statistics = this.entityManager.getEntityManagerFactory()
			.unwrap(SessionFactory.class)
			.getStatistics();
		this.statistics.clear();
	}

	@Test
	@DisplayName("inserts an expense without selecting it first")
	void insertsExpenseInOneStatement() {
		this.expenses.save(Expense.record(new BigDecimal("-1200.00"), "PHP", LocalDate.of(2026, 8, 8),
				"SM Supermarket", "Refund for spoiled produce"));
		this.entityManager.flush();

		assertOneInsert();
	}

	@Test
	@DisplayName("inserts a classification record without selecting it first")
	void insertsClassificationRecordInOneStatement() {
		// A real expense first: the record carries a foreign key, and counting
		// statements for an insert that was going to fail proves nothing.
		Expense expense = this.expenses.save(Expense.record(new BigDecimal("1200.00"), "PHP",
				LocalDate.of(2026, 8, 3), "SM Supermarket", "Weekly groceries"));
		this.entityManager.flush();
		this.statistics.clear();

		// On the write path of every expense creation and every reclassification.
		this.records.save(ClassificationRecord.fromRuleEngine(expense.getId(),
				new Classification(Category.GROCERIES, "groceries.supermarket", "matched supermarket"),
				Instant.now()));
		this.entityManager.flush();

		assertOneInsert();
	}

	@Test
	@DisplayName("inserts a refresh token without selecting it first")
	void insertsRefreshTokenInOneStatement() {
		// The most frequent of the three by some distance: one row per login and
		// one per rotation, so a client refreshing every fifteen minutes paid
		// this round trip that often. It was missed when the other two were
		// fixed, which is what AssignedIdEntitiesArePersistableTest now prevents.
		Instant now = Instant.now();
		this.refreshTokens.save(RefreshToken.issue(UUID.randomUUID().toString(), now, now.plus(Duration.ofDays(30))));
		this.entityManager.flush();

		assertOneInsert();
	}

	private void assertOneInsert() {
		assertThat(this.statistics.getPrepareStatementCount())
			.describedAs("one insert, no preceding select")
			.isEqualTo(1);
		assertThat(this.statistics.getEntityInsertCount())
			.describedAs("and that statement is the insert")
			.isEqualTo(1);
	}

}
