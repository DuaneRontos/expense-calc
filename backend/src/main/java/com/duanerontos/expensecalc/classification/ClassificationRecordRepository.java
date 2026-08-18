package com.duanerontos.expensecalc.classification;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads over the classification history (spec §4).
 *
 * <p>Every method here orders by {@code recordedAt DESC, id DESC} and takes the
 * first row. The {@code id} half is the tiebreaker: two records can share a
 * microsecond, and an arbitrary winner between them would make "the current
 * category" non-deterministic — the one property this table exists to provide.
 * Arbitrary but stable is fine; arbitrary and unstable is not. The index in V3
 * carries both columns so neither read sorts.
 *
 * <p><b>These are single-expense reads, and a list endpoint must not loop over
 * them.</b> Spec §10 forbids N+1 in the expense and report paths, so #10 and
 * #12 need a bulk form — one query returning the latest record per expense for
 * a set of them, which on Postgres is a {@code DISTINCT ON (expense_id)} or a
 * lateral join. Deliberately not written here: its shape depends on the query
 * and report projections, and guessing it now would produce an unused method
 * that the real one has to replace.
 */
public interface ClassificationRecordRepository extends JpaRepository<ClassificationRecord, UUID> {

	/**
	 * The classification in force now — the latest record for the expense.
	 *
	 * <p>Empty only if the expense has never been classified, which should not
	 * happen: creating an expense runs the engine, and an unmatched result is
	 * recorded as {@code UNCLASSIFIED} rather than as nothing.
	 */
	Optional<ClassificationRecord> findFirstByExpenseIdOrderByRecordedAtDescIdDesc(UUID expenseId);

	/**
	 * The classification that was in force at {@code asOf}.
	 *
	 * <p>This is what makes a report over a closed period reproducible. Append-
	 * only storage keeps the history, but only a read pinned to an instant can
	 * <em>use</em> it — asking for the current category and expecting last
	 * quarter's answer gets today's. See {@code ClassificationRecordRepositoryTest}
	 * for the case that distinguishes them.
	 *
	 * @param asOf inclusive; a record written exactly at this instant counts
	 */
	Optional<ClassificationRecord> findFirstByExpenseIdAndRecordedAtLessThanEqualOrderByRecordedAtDescIdDesc(
			UUID expenseId, Instant asOf);

	/** Full history for one expense, newest first. Feeds {@code GET /expenses/{id}} (spec §8). */
	List<ClassificationRecord> findByExpenseIdOrderByRecordedAtDescIdDesc(UUID expenseId);

}
