package com.duanerontos.expensecalc.classification;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import com.duanerontos.expensecalc.TestcontainersConfiguration;
import com.duanerontos.expensecalc.expense.Category;
import com.duanerontos.expensecalc.expense.Expense;
import com.duanerontos.expensecalc.expense.ExpenseRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.jpa.test.autoconfigure.TestEntityManager;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The append-only history and the two reads over it (issue #9, spec §4).
 *
 * <p>Requires Docker, and genuinely needs a real Postgres rather than a mock:
 * the append-only guarantee is a trigger, the two enum columns are native
 * Postgres types, and {@code ddl-auto: validate} only has an opinion when there
 * is a schema to validate against.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class ClassificationRecordRepositoryTest {

	private static final Instant CLASSIFIED_AT = Instant.parse("2026-01-10T02:00:00Z");

	/** Three weeks later — after January closed, in the reproducibility test. */
	private static final Instant RECLASSIFIED_AT = Instant.parse("2026-02-03T09:30:00Z");

	@Autowired
	private ClassificationRecordRepository records;

	@Autowired
	private ExpenseRepository expenses;

	@Autowired
	private TestEntityManager entityManager;

	private UUID anExpense() {
		Expense saved = this.expenses
			.save(Expense.record(new BigDecimal("2345.00"), "PHP", LocalDate.of(2026, 1, 9), "SM Supermarket", null));
		return saved.getId();
	}

	private ClassificationRecord classified(UUID expenseId, Category category, Instant when) {
		return this.records.save(ClassificationRecord.fromUser(expenseId, category, "test fixture", when));
	}

	@Test
	@DisplayName("keeps the previous record when a category changes")
	void appendsRatherThanOverwrites() {
		UUID expenseId = anExpense();
		classified(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		classified(expenseId, Category.DINING, RECLASSIFIED_AT);
		this.entityManager.flush();
		this.entityManager.clear();

		List<ClassificationRecord> history = this.records.findByExpenseIdOrderByRecordedAtDescIdDesc(expenseId);

		assertThat(history).hasSize(2);
		assertThat(history).extracting(ClassificationRecord::getCategory)
			.containsExactly(Category.DINING, Category.GROCERIES);
	}

	@Test
	@DisplayName("treats the latest record as the current category")
	void latestRecordWins() {
		UUID expenseId = anExpense();
		classified(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		classified(expenseId, Category.DINING, RECLASSIFIED_AT);
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.records.findFirstByExpenseIdOrderByRecordedAtDescIdDesc(expenseId))
			.get()
			.extracting(ClassificationRecord::getCategory)
			.isEqualTo(Category.DINING);
	}

	@Test
	@DisplayName("answers a closed period the same before and after a reclassification")
	void closedPeriodsStayReproducible() {
		// Issue #9's requirement, and the test that shows what it actually
		// takes. January closed on the 31st. Reclassifying in February must not
		// change what a January report said.
		UUID expenseId = anExpense();
		classified(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		Instant januaryClosed = Instant.parse("2026-02-01T00:00:00Z");

		Category januaryAnswerBefore = this.records
			.findFirstByExpenseIdAndRecordedAtLessThanEqualOrderByRecordedAtDescIdDesc(expenseId, januaryClosed)
			.orElseThrow()
			.getCategory();

		classified(expenseId, Category.DINING, RECLASSIFIED_AT);
		this.entityManager.flush();
		this.entityManager.clear();

		Category januaryAnswerAfter = this.records
			.findFirstByExpenseIdAndRecordedAtLessThanEqualOrderByRecordedAtDescIdDesc(expenseId, januaryClosed)
			.orElseThrow()
			.getCategory();

		assertThat(januaryAnswerAfter).isEqualTo(januaryAnswerBefore).isEqualTo(Category.GROCERIES);

		// And the part worth being explicit about: append-only storage alone
		// does not give reproducibility. The current-category read — the one a
		// report would use by default — now answers DINING for that same
		// January expense. Only a read pinned to an instant reproduces the
		// closed period, so #12's report contract needs somewhere to put one.
		assertThat(this.records.findFirstByExpenseIdOrderByRecordedAtDescIdDesc(expenseId))
			.get()
			.extracting(ClassificationRecord::getCategory)
			.isEqualTo(Category.DINING);
	}

	@Test
	@DisplayName("counts a record written exactly at the boundary instant")
	void asOfIsInclusive() {
		// Half-open periods are [start, end) for expense dates (spec §6), but
		// this bound is on when the classification was recorded, not on when
		// money moved. Inclusive is the useful reading: "as the world looked at
		// this instant" should include what was written at it.
		UUID expenseId = anExpense();
		classified(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		this.entityManager.flush();

		assertThat(this.records.findFirstByExpenseIdAndRecordedAtLessThanEqualOrderByRecordedAtDescIdDesc(expenseId,
				CLASSIFIED_AT))
			.isPresent();
		assertThat(this.records.findFirstByExpenseIdAndRecordedAtLessThanEqualOrderByRecordedAtDescIdDesc(expenseId,
				CLASSIFIED_AT.minus(1, ChronoUnit.MICROS)))
			.isEmpty();
	}

	@Test
	@DisplayName("rejects an update at the database, not only in the mapping")
	void rejectsUpdates() {
		UUID expenseId = anExpense();
		ClassificationRecord record = classified(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		this.entityManager.flush();

		// Native SQL on purpose: @Immutable stops Hibernate issuing an UPDATE,
		// so going through the ORM would prove the mapping rather than the
		// guarantee. psql and any future service bypass the mapping entirely.
		assertThatThrownBy(() -> {
			this.entityManager.getEntityManager()
				.createNativeQuery("UPDATE classification_record SET category = 'DINING' WHERE id = :id")
				.setParameter("id", record.getId())
				.executeUpdate();
		}).rootCause().hasMessageContaining("append-only");
	}

	/**
	 * Postgres orders {@code uuid} as sixteen unsigned bytes.
	 *
	 * <p>{@link UUID#compareTo} compares the most-significant bits as a
	 * <em>signed</em> long, so it disagrees with the database for roughly half
	 * of all pairs — using it here would make this test flaky in exactly the way
	 * the tiebreaker exists to prevent.
	 */
	private static final Comparator<UUID> POSTGRES_UUID_ORDER = Comparator
		.comparing(UUID::getMostSignificantBits, Long::compareUnsigned)
		.thenComparing(UUID::getLeastSignificantBits, Long::compareUnsigned);

	@Test
	@DisplayName("breaks a same-instant tie on the greater id, not merely consistently")
	void breaksSameInstantTiesOnId() {
		// Microsecond resolution means a reclassification can land in the same
		// instant as the record it replaces, and "the current category" changing
		// between two reads of unchanged data is the one thing this table must
		// never do.
		//
		// Asserting only that five reads agree is not enough: Postgres returns a
		// stable row for a two-row table with or without the tiebreaker, so that
		// version passed even with id DESC removed from the query and the index.
		// Naming which row must win is what actually pins it.
		UUID expenseId = anExpense();
		UUID groceries = classified(expenseId, Category.GROCERIES, CLASSIFIED_AT).getId();
		UUID dining = classified(expenseId, Category.DINING, CLASSIFIED_AT).getId();
		this.entityManager.flush();
		this.entityManager.clear();

		UUID expected = POSTGRES_UUID_ORDER.compare(groceries, dining) >= 0 ? groceries : dining;

		assertThat(this.records.findFirstByExpenseIdOrderByRecordedAtDescIdDesc(expenseId).orElseThrow().getId())
			.isEqualTo(expected);
	}

	@Test
	@DisplayName("silently ignores a backdated write, which is a recorded limit")
	void aBackdatedWriteIsSilentlyIgnored() {
		// Pinned as a known gap, not as intent — and measured rather than
		// reasoned about, because the reasoning got it backwards first time.
		//
		// The read takes the greatest recorded_at, so a record stamped in the
		// past does NOT become current: it is accepted, stored, and has no
		// effect. The hazard is a silent no-op, not a silent revert. A user
		// reclassifies, the write succeeds, the category does not change, and
		// nothing anywhere says why.
		//
		// Unreachable today since nothing writes these rows. It becomes
		// reachable in #10 and #12 through clock skew between instances, and
		// deliberately so for IMPORT, which is the source most likely to want a
		// backdated stamp. The remedy is V3's monotonic sequence column or a
		// service-level check that a stamp does not go backwards; both want a
		// caller to constrain them first.
		UUID expenseId = anExpense();
		classified(expenseId, Category.DINING, RECLASSIFIED_AT);
		classified(expenseId, Category.GROCERIES, CLASSIFIED_AT);
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.records.findFirstByExpenseIdOrderByRecordedAtDescIdDesc(expenseId))
			.get()
			.extracting(ClassificationRecord::getCategory)
			.isEqualTo(Category.DINING);

		// Both rows are there — the backdated decision is recorded history, it
		// simply never becomes current.
		assertThat(this.records.findByExpenseIdOrderByRecordedAtDescIdDesc(expenseId)).hasSize(2);
	}

	@Test
	@DisplayName("round-trips both native enum columns")
	void mapsBothNativeEnums() {
		// The bill V2 said would come due here: these columns are Postgres enum
		// types, so the mapping needs NAMED_ENUM. Without it the insert fails
		// with "column is of type expense_category but expression is of type
		// character varying", and ddl-auto: validate objects at startup.
		UUID expenseId = anExpense();
		ClassificationRecord saved = this.records
			.save(ClassificationRecord.fromRuleEngine(expenseId, Classification.unmatched(), CLASSIFIED_AT));
		this.entityManager.flush();
		this.entityManager.clear();

		ClassificationRecord found = this.records.findById(saved.getId()).orElseThrow();

		assertThat(found.getCategory()).isEqualTo(Category.UNCLASSIFIED);
		assertThat(found.getSource()).isEqualTo(ClassificationSource.RULE_ENGINE);
		assertThat(found.getReason()).isEqualTo(Classification.unmatched().reason());
	}

	@Test
	@DisplayName("keeps each expense's history to itself")
	void scopesHistoryToOneExpense() {
		UUID one = anExpense();
		UUID other = anExpense();
		classified(one, Category.GROCERIES, CLASSIFIED_AT);
		classified(other, Category.TRANSPORT, CLASSIFIED_AT);
		this.entityManager.flush();
		this.entityManager.clear();

		assertThat(this.records.findByExpenseIdOrderByRecordedAtDescIdDesc(one)).hasSize(1)
			.first()
			.extracting(ClassificationRecord::getCategory)
			.isEqualTo(Category.GROCERIES);
	}

}
