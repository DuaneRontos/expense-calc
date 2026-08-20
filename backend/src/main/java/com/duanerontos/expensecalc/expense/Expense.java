package com.duanerontos.expensecalc.expense;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

import com.duanerontos.expensecalc.money.Money;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

import org.springframework.data.domain.Persistable;

/**
 * A single recorded expense.
 *
 * <p>Two things about this entity are load-bearing and easy to undo by accident:
 *
 * <ul>
 * <li><b>There is no {@code category} column.</b> Per spec §4 the current
 * category is derived from the latest {@code ClassificationRecord} (#9), so that
 * reclassifying an expense does not silently rewrite historical reports. Issue
 * #5 lists category among the fields; the spec takes precedence.
 * <li><b>{@code amountMinor} is signed.</b> A negative amount is a refund, and
 * per spec §5 it keeps the category of what it refunds. Aggregations must not
 * {@code abs()} it or filter it out.
 * </ul>
 */
@Entity
@Table(name = "expense")
public class Expense implements Persistable<UUID> {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	/**
	 * Whether this instance has yet to be inserted (issue #43).
	 *
	 * <p><b>Transient, and false for anything Hibernate loaded.</b>
	 * {@code SimpleJpaRepository.save} calls {@code merge()} rather than
	 * {@code persist()} whenever {@code isNew()} is false, and the default
	 * {@code isNew()} is {@code id != null}. This entity assigns its own
	 * {@code UUID} in the constructor, so every insert looked like an update:
	 * Hibernate issued a select that returned nothing, then the insert.
	 *
	 * <p>The field is not persisted, so an entity read back from the database
	 * has the field's default of {@code false} — which is correct, because a row
	 * that was loaded is by definition not new. {@code @PostLoad} sets it
	 * explicitly all the same, so the behaviour does not rest on a default that
	 * a later refactor could change.
	 */
	@Transient
	private boolean isNew = true;

	@Column(name = "amount_minor", nullable = false)
	private long amountMinor;

	// The migration declares CHAR(3) per spec §4, which Postgres stores as
	// bpchar. A plain String maps to VARCHAR by default, so ddl-auto=validate
	// rejects the mismatch at startup. Naming the JDBC type keeps entity and
	// schema agreeing without a Postgres-specific columnDefinition.
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "currency", nullable = false, length = 3)
	private String currency;

	@Column(name = "occurred_on", nullable = false)
	private LocalDate occurredOn;

	@Column(name = "merchant", length = 200)
	private String merchant;

	@Column(name = "description")
	private String description;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	protected Expense() {
		// for JPA
	}

	private Expense(UUID id, long amountMinor, String currency, LocalDate occurredOn, String merchant,
			String description) {
		this.id = id;
		this.amountMinor = amountMinor;
		this.currency = currency;
		this.occurredOn = occurredOn;
		this.merchant = merchant;
		this.description = description;
	}

	/**
	 * Creates an expense from a service-boundary amount.
	 *
	 * <p>Currency is checked first, so an unsupported currency is rejected before
	 * any conversion or persistence happens (spec §9.6).
	 *
	 * @param amount pesos; negative means a refund
	 * @param currencyCode must be {@code PHP} in v1
	 * @throws com.duanerontos.expensecalc.money.UnsupportedCurrencyException if
	 *     the currency is not supported
	 * @throws IllegalArgumentException if the amount carries sub-centavo precision
	 */
	public static Expense record(BigDecimal amount, String currencyCode, LocalDate occurredOn, String merchant,
			String description) {
		Money.requireSupportedCurrency(currencyCode);
		Objects.requireNonNull(occurredOn, "occurredOn must not be null");
		return new Expense(UUID.randomUUID(), Money.toMinorUnits(amount), currencyCode, occurredOn, merchant,
				description);
	}

	/**
	 * Applies a partial update, ignoring nulls.
	 *
	 * <p>Null means "leave alone" rather than "clear", which is what {@code
	 * PATCH} means (spec §8). Clearing a nullable field therefore has no
	 * expression here — a client that needs it wants an explicit sentinel, and
	 * inventing one before anybody asks would be guessing at a shape.
	 *
	 * @return true when the merchant or description changed, which is the
	 *     signal to re-run classification: those are the only fields the rule
	 *     engine reads as text, so re-classifying on an amount or date edit
	 *     would append a record asserting a decision nobody made
	 */
	public boolean applyUpdate(BigDecimal amount, String currencyCode, LocalDate occurredOn, String merchant,
			String description) {
		boolean textChanged = false;

		if (currencyCode != null) {
			Money.requireSupportedCurrency(currencyCode);
			this.currency = currencyCode;
		}
		if (amount != null) {
			// Checked against the currency now in force, so changing both at
			// once cannot slip a non-PHP amount past the boundary (spec §9.6).
			Money.requireSupportedCurrency(this.currency);
			this.amountMinor = Money.toMinorUnits(amount);
		}
		if (occurredOn != null) {
			this.occurredOn = occurredOn;
		}
		if (merchant != null && !merchant.equals(this.merchant)) {
			this.merchant = merchant;
			textChanged = true;
		}
		if (description != null && !description.equals(this.description)) {
			this.description = description;
			textChanged = true;
		}
		return textChanged;
	}

	@Override
	public boolean isNew() {
		return this.isNew;
	}

	/** Inserted now, so subsequent saves are updates and should merge. */
	@PostPersist
	@PostLoad
	void markNotNew() {
		this.isNew = false;
	}

	@PrePersist
	void onCreate() {
		Instant now = Instant.now();
		this.createdAt = now;
		this.updatedAt = now;
	}

	@PreUpdate
	void onUpdate() {
		this.updatedAt = Instant.now();
	}

	public UUID getId() {
		return this.id;
	}

	/** The amount as the service boundary exposes it. Negative means a refund. */
	public BigDecimal getAmount() {
		return Money.toMajorUnits(this.amountMinor);
	}

	/**
	 * Raw stored centavos. Sorting and range filters use this rather than
	 * {@link #getAmount()} so comparisons stay integer and paging stays stable
	 * (spec §6).
	 */
	public long getAmountMinor() {
		return this.amountMinor;
	}

	public String getCurrency() {
		return this.currency;
	}

	public LocalDate getOccurredOn() {
		return this.occurredOn;
	}

	public String getMerchant() {
		return this.merchant;
	}

	public String getDescription() {
		return this.description;
	}

	public Instant getCreatedAt() {
		return this.createdAt;
	}

	public Instant getUpdatedAt() {
		return this.updatedAt;
	}

}
