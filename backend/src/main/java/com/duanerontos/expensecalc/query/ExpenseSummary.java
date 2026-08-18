package com.duanerontos.expensecalc.query;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One row of {@code GET /expenses}.
 *
 * <p>Money is a decimal string, never a JSON number — a JSON number is a double
 * once JavaScript parses it (spec §8).
 *
 * <p>Carries the category resolved at query time rather than a link to fetch it
 * with. The alternative is the client asking per row, which is the N+1 spec §10
 * forbids, moved from the server to the network.
 */
public record ExpenseSummary(UUID id, String amount, String currency, LocalDate occurredOn, String merchant,
		String description, String category, String categoryLabel) {
}
