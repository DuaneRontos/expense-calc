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

**Dates are `LocalDate` for expense dates, `Instant` for audit timestamps.**
Reporting periods are half-open — `[start, end)` — so month boundaries don't
double-count.

**Classification is deterministic and testable.** Rules live in code, not in
prompt text, so the same expense always lands in the same category. See
`.claude/skills/expense-classification/` for the category taxonomy the rules
must implement.

**Charts get pre-aggregated data.** The backend returns report-shaped
responses (buckets with labels and totals); the frontend does not aggregate
raw expense lists client-side.
