package com.duanerontos.expensecalc.expense;

import java.time.LocalDate;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import com.duanerontos.expensecalc.classification.Classification;
import com.duanerontos.expensecalc.classification.ClassificationRecord;
import com.duanerontos.expensecalc.classification.ClassificationRecordRepository;
import jakarta.persistence.EntityManager;
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
 * {@code id != null}. Both entities assign a {@code UUID} in their constructors,
 * so every save looked like an update: a select that returns nothing, then the
 * insert.
 *
 * <p>Counted with Hibernate's own statistics rather than read from the log,
 * because a log assertion passes whenever logging is off.
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
	private EntityManager entityManager;

	private Statistics statistics;

	@BeforeEach
	void resetStatistics() {
		this.statistics = this.entityManager.getEntityManagerFactory().unwrap(org.hibernate.SessionFactory.class)
			.getStatistics();
		this.statistics.clear();
	}

	@Test
	@DisplayName("inserts an expense without selecting it first")
	void insertsExpenseInOneStatement() {
		this.expenses.save(Expense.record(new java.math.BigDecimal("-1200.00"), "PHP", LocalDate.of(2026, 8, 8),
				"SM Supermarket", "Refund for spoiled produce"));
		this.entityManager.flush();

		// A select that returns nothing, issued to decide something the caller
		// already knew: this row is new.
		assertThat(this.statistics.getPrepareStatementCount())
			.describedAs("one insert, no preceding select")
			.isEqualTo(1);
	}

	@Test
	@DisplayName("inserts a classification record without selecting it first")
	void insertsClassificationRecordInOneStatement() {
		// A real expense first: the record carries a foreign key, and counting
		// statements for an insert that was going to fail proves nothing.
		Expense expense = this.expenses.save(Expense.record(new java.math.BigDecimal("1200.00"), "PHP",
				LocalDate.of(2026, 8, 3), "SM Supermarket", "Weekly groceries"));
		this.entityManager.flush();
		this.statistics.clear();

		// This one is on the write path of every expense creation and every
		// reclassification, so it is the doubling that compounds.
		this.records.save(ClassificationRecord.fromRuleEngine(expense.getId(),
				new Classification(Category.GROCERIES, "groceries.supermarket", "matched supermarket"),
				java.time.Instant.now()));
		this.entityManager.flush();

		assertThat(this.statistics.getPrepareStatementCount())
			.describedAs("one insert, no preceding select")
			.isEqualTo(1);
	}

}
