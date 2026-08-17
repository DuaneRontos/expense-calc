# expense-calc

Expense calculator: classify expenses, sort and filter them, and produce
analytical reports with charts.

This repo doubles as a working reference for agentic workflows — the GitHub
Actions agents, skills, and subagents below are part of the deliverable, not
scaffolding around it.

## Layout

| Path | What lives here |
| --- | --- |
| `backend/` | Java Spring Boot API — expense model, classification, query, reporting |
| `frontend/` | Expo / React Native Web — iOS, Android, and desktop web from one codebase |
| `.claude/skills/` | Skills the agents load on demand |
| `.claude/agents/` | Subagent definitions |
| `.github/workflows/` | The agents themselves (see below) |

Both `backend/` and `frontend/` are still to be scaffolded.

## Agents in this repo

- **`.github/workflows/claude.yml`** — interactive. Mention `@claude` in an
  issue or PR comment and it does the work and opens a PR.
- **`.github/workflows/claude-code-review.yml`** — automatic. Reviews every PR
  on open and on each push.

Both need the `ANTHROPIC_API_KEY` repository secret.

## Conventions

**Money is `BigDecimal`, never `double` or `float`.** Every amount, subtotal,
and aggregate. Rounding is explicit at the presentation boundary only —
`RoundingMode.HALF_UP`, scale 2. A `double` anywhere in a money path is a bug
even when the test passes.

**Amounts are stored in minor units** (cents) as integers at the persistence
layer, converted to `BigDecimal` at the service boundary. This keeps summation
exact and avoids scale drift across a large expense set.

**Currency is `PHP` only in v1, enforced at the API boundary.** Anything else
is a 400 before it reaches the database. `amountMinor` is centavos. The client
formats with `Intl.NumberFormat("en-PH", …)` — never hardcode `₱`.

**Dates are `LocalDate` for expense dates, `Instant` for audit timestamps.**
Reporting periods are half-open — `[start, end)` — so month boundaries don't
double-count.

**Relative periods resolve against `Asia/Manila`, never UTC or the host
default.** At 17:00 UTC on 31 January it is already February in Manila; a
UTC-derived "this month" reports the wrong month for eight hours a day. The
zone is pinned in configuration. No DST since 1978, so the offset is a constant
+08:00.

**v1 is single-user.** No owner or tenant column anywhere. Adding one in v2 is
a migration plus a predicate on every query — don't half-add it early.

**Classification is deterministic and testable.** Rules live in code, not in
prompt text, so the same expense always lands in the same category. See
`.claude/skills/expense-classification/` for the category taxonomy the rules
must implement.

**Charts get pre-aggregated data.** The backend returns report-shaped
responses (buckets with labels and totals); the frontend does not aggregate
raw expense lists client-side.
