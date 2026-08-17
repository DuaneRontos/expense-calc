package com.duanerontos.expensecalc.expense;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Persistence for {@link Expense}.
 *
 * <p>Intentionally bare. Filtering, sorting, and pagination arrive with #10 and
 * #11, where spec §6 requires a deterministic tiebreaker on every sort and an
 * upper bound on every result set — neither of which belongs in a derived query
 * method bolted on here.
 */
public interface ExpenseRepository extends JpaRepository<Expense, UUID> {

}
