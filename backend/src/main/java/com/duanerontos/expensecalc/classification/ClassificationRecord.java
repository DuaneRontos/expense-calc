package com.duanerontos.expensecalc.classification;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

import com.duanerontos.expensecalc.expense.Category;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * One classification decision, kept forever (spec §4).
 *
 * <p><b>Append-only.</b> Changing an expense's category writes a new record and
 * leaves the previous one alone, so the history of what an expense was
 * classified as remains readable. {@link Immutable} stops Hibernate issuing an
 * UPDATE for a loaded instance, and a database trigger rejects one anyway —
 * this is a property worth holding in two places, because the way it breaks is
 * a service innocently calling {@code save()} on a record it just read.
 *
 * <p><b>{@code expenseId} is a plain UUID, not a {@code @ManyToOne}.</b> Spec §4
 * lists it as a field, and an association here would invite exactly the N+1 the
 * spec's performance section forbids: the current-category read runs on every
 * list row and every report bucket, so it has to be a projection over this
 * table rather than a graph walk from {@code Expense}.
 *
 * <p><b>{@code when} must not go backwards for an expense.</b> "Latest wins"
 * reads the greatest {@code recordedAt}, and nothing here enforces that a new
 * record's stamp is at or after the newest existing one — append-only prevents
 * an overwrite, not an insertion into the past. A record stamped earlier than
 * the current one is accepted, stored, and has no effect: the reclassification
 * silently does nothing, and no error says so. Nothing produces these rows yet;
 * the callers that will (#10, #12) have to pass a clock reading rather than an
 * arbitrary instant, and clock skew across instances is the realistic way this
 * breaks. {@code IMPORT} is the source most likely to want a backdated stamp on
 * purpose, and is the point at which this wants the monotonic sequence column
 * V3's comment describes rather than a convention. Pinned by
 * {@code ClassificationRecordRepositoryTest}.
 *
 * <p>The two enum mappings need {@link JdbcTypeCode} with
 * {@link SqlTypes#NAMED_ENUM} because the columns are native Postgres enum
 * types. A plain {@code @Enumerated(EnumType.STRING)} binds a varchar and
 * Postgres rejects it outright — {@code column "category" is of type
 * expense_category but expression is of type character varying} — and
 * {@code ddl-auto: validate} flags the mismatch at startup.
 */
@Entity
@Immutable
@Table(name = "classification_record")
public class ClassificationRecord {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@Column(name = "expense_id", nullable = false, updatable = false)
	private UUID expenseId;

	@JdbcTypeCode(SqlTypes.NAMED_ENUM)
	@Enumerated(EnumType.STRING)
	@Column(name = "category", nullable = false, updatable = false, columnDefinition = "expense_category")
	private Category category;

	@JdbcTypeCode(SqlTypes.NAMED_ENUM)
	@Enumerated(EnumType.STRING)
	@Column(name = "source", nullable = false, updatable = false, columnDefinition = "classification_source")
	private ClassificationSource source;

	@Column(name = "reason", nullable = false, updatable = false, length = 200)
	private String reason;

	@Column(name = "recorded_at", nullable = false, updatable = false)
	private Instant recordedAt;

	protected ClassificationRecord() {
		// for JPA
	}

	private ClassificationRecord(UUID id, UUID expenseId, Category category, ClassificationSource source, String reason,
			Instant recordedAt) {
		this.id = id;
		this.expenseId = expenseId;
		this.category = category;
		this.source = source;
		this.reason = reason;
		this.recordedAt = recordedAt;
	}

	/**
	 * Records what the rule engine decided.
	 *
	 * <p>Takes the {@link Classification} the engine returned rather than a
	 * category and a string, so the reason on the row is the one the engine
	 * actually produced and cannot drift from the rule that fired.
	 */
	public static ClassificationRecord fromRuleEngine(UUID expenseId, Classification classification, Instant when) {
		Objects.requireNonNull(classification, "classification must not be null");
		return new ClassificationRecord(UUID.randomUUID(), required(expenseId, "expenseId"), classification.category(),
				ClassificationSource.RULE_ENGINE, classification.reason(), required(when, "when"));
	}

	/**
	 * Records a reclassification by the user.
	 *
	 * @param reason the user's note; required, because an unexplained category
	 *     change is the thing this table exists to make explicable
	 */
	public static ClassificationRecord fromUser(UUID expenseId, Category category, String reason, Instant when) {
		if (reason == null || reason.isBlank()) {
			throw new IllegalArgumentException(
					"A user reclassification needs a reason. Without one the record says a category changed but not why, which is the question it exists to answer.");
		}
		// Bounded here rather than left to the column. A user's free-text note
		// is the input most likely to run long, and without this it reaches the
		// VARCHAR(200) as a flush-time DataIntegrityViolationException — a 500
		// where the blank case a few lines above gives a controller a clean 400.
		// Classification enforces the same bound on the engine's side.
		if (reason.length() > Classification.MAX_REASON_LENGTH) {
			throw new IllegalArgumentException("Reason is %d characters; the column holds %d."
				.formatted(reason.length(), Classification.MAX_REASON_LENGTH));
		}
		return new ClassificationRecord(UUID.randomUUID(), required(expenseId, "expenseId"),
				required(category, "category"), ClassificationSource.USER, reason, required(when, "when"));
	}

	/**
	 * Fails at the call site rather than at flush.
	 *
	 * <p>The columns are all {@code NOT NULL}, so a null does get caught — but
	 * as a constraint violation raised when the transaction flushes, by which
	 * point the stack no longer shows who passed it. {@code Expense.record} sets
	 * the same precedent next door.
	 */
	private static <T> T required(T value, String field) {
		return Objects.requireNonNull(value, () -> "%s must not be null".formatted(field));
	}

	public UUID getId() {
		return this.id;
	}

	public UUID getExpenseId() {
		return this.expenseId;
	}

	public Category getCategory() {
		return this.category;
	}

	public ClassificationSource getSource() {
		return this.source;
	}

	public String getReason() {
		return this.reason;
	}

	public Instant getRecordedAt() {
		return this.recordedAt;
	}

}
