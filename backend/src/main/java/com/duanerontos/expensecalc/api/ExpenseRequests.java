package com.duanerontos.expensecalc.api;

import java.math.BigDecimal;
import java.time.LocalDate;

import com.duanerontos.expensecalc.expense.Category;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * The write-side request bodies of spec §8.
 *
 * <p>Money arrives as a <b>decimal string</b>, not a JSON number — the same rule
 * that governs responses, for the same reason. A JSON number is a double by the
 * time Jackson sees it, so {@code 1234.56} can arrive as {@code 1234.5599999}
 * and the precision is gone before any validation could notice.
 */
public final class ExpenseRequests {

	private ExpenseRequests() {
	}

	/**
	 * {@code POST /expenses}.
	 *
	 * @param amount decimal string; negative means a refund (spec §5)
	 * @param currency must be {@code PHP} in v1, rejected at this boundary
	 * @param occurredOn the date the money moved
	 */
	public record Create(@NotNull String amount, @NotNull String currency, @NotNull LocalDate occurredOn,
			@Size(max = 200) String merchant, String description) {
	}

	/**
	 * {@code PATCH /expenses/{id}}.
	 *
	 * <p>Every field is optional and null means "leave alone". Changing the
	 * merchant or description re-runs classification; changing the amount or
	 * date does not, because the rule engine reads neither as text.
	 */
	public record Update(String amount, String currency, LocalDate occurredOn, @Size(max = 200) String merchant,
			String description) {
	}

	/**
	 * {@code POST /expenses/{id}/classification}.
	 *
	 * @param reason required — an unexplained category change is exactly the
	 *     question the history exists to answer
	 */
	public record Reclassify(@NotNull Category category, @NotNull @Size(max = 200) String reason) {
	}

}
