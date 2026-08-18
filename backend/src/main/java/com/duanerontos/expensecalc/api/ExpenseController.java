package com.duanerontos.expensecalc.api;

import java.math.BigDecimal;
import java.net.URI;
import java.util.UUID;

import com.duanerontos.expensecalc.money.Money;

import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The write side of {@code /expenses} (spec §8).
 */
@RestController
@RequestMapping("/api/v1/expenses")
public class ExpenseController {

	private final ExpenseService expenses;

	public ExpenseController(ExpenseService expenses) {
		this.expenses = expenses;
	}

	/** {@code POST /expenses} — creates and classifies. 201 with a Location header. */
	@PostMapping
	public ResponseEntity<ExpenseDetail> create(@Valid @RequestBody ExpenseRequests.Create request) {
		ExpenseDetail created = this.expenses.create(amount(request.amount()), request.currency(),
				request.occurredOn(), request.merchant(), request.description());

		return ResponseEntity.created(URI.create("/api/v1/expenses/" + created.id())).body(created);
	}

	/** {@code GET /expenses/{id}} — one expense with its classification history. */
	@GetMapping("/{id}")
	public ResponseEntity<ExpenseDetail> get(@PathVariable UUID id) {
		return ResponseEntity.ok(this.expenses.get(id));
	}

	/** {@code PATCH /expenses/{id}} — partial update; re-classifies if the text changed. */
	@PatchMapping("/{id}")
	public ResponseEntity<ExpenseDetail> update(@PathVariable UUID id,
			@Valid @RequestBody ExpenseRequests.Update request) {
		return ResponseEntity.ok(this.expenses.update(id, amount(request.amount()), request.currency(),
				request.occurredOn(), request.merchant(), request.description()));
	}

	/** {@code POST /expenses/{id}/classification} — appends a user reclassification. */
	@PostMapping("/{id}/classification")
	public ResponseEntity<ExpenseDetail> reclassify(@PathVariable UUID id,
			@Valid @RequestBody ExpenseRequests.Reclassify request) {
		return ResponseEntity.ok(this.expenses.reclassify(id, request.category(), request.reason()));
	}

	/** {@code DELETE /expenses/{id}} — 204, history cascaded. */
	@DeleteMapping("/{id}")
	public ResponseEntity<Void> delete(@PathVariable UUID id) {
		this.expenses.delete(id);
		return ResponseEntity.noContent().build();
	}

	/**
	 * Parses a decimal-string amount.
	 *
	 * <p>Rejects sub-centavo precision rather than rounding it, matching
	 * {@link Money#toMinorUnits}: an amount the server quietly moved is money
	 * the user did not enter, and the difference only surfaces when somebody
	 * reconciles against a bank statement.
	 */
	private static BigDecimal amount(String amount) {
		if (amount == null) {
			return null;
		}
		try {
			BigDecimal parsed = new BigDecimal(amount.strip());
			Money.toMinorUnits(parsed);
			return parsed;
		}
		catch (NumberFormatException ex) {
			throw new InvalidExpenseException("%s is not an amount.".formatted(amount), "amount");
		}
		catch (IllegalArgumentException ex) {
			throw new InvalidExpenseException(ex.getMessage(), "amount");
		}
	}

}
