# expense-calc

Expense calculator: classify expenses, sort and filter them, and produce
analytical reports with charts.

This repo doubles as a working reference for agentic workflows — the GitHub
Actions agents, skills, and subagents below are part of the deliverable, not
scaffolding around it.

## Layout

| Path | What lives here |
| --- | --- |
| [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | **Read this before implementing anything.** Domain model, API surface, resolved decisions |
| `backend/` | Java Spring Boot API — expense model, classification, query, reporting |
| `frontend/` | Expo / React Native Web — iOS, Android, and desktop web from one codebase |
| `.claude/skills/` | Skills the agents load on demand |
| `.claude/agents/` | Subagent definitions |
| `.github/workflows/` | The agents themselves (see below) |

Both `backend/` and `frontend/` are still to be scaffolded.

## Start with the specification

[`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) is the source of truth for
*what* to build. This file covers *how* to build it. They do not overlap: if a
convention here contradicts the spec, the spec wins and this file is the bug.

The spec carries the pieces you cannot infer from the code, because the code
does not exist yet — the entity fields and their types, the exact query and
report contracts, the endpoint list, and six decisions that are settled and
should not be relitigated in a PR (§9). Read the relevant section before
starting an issue; most issue bodies name the section that governs them.

## Agents in this repo

- **`.github/workflows/claude.yml`** — interactive. Mention `@claude` in an
  issue or PR comment and it does the work and opens a PR.
- **`.github/workflows/claude-code-review.yml`** — automatic. Reviews every PR
  on open and on each push.

Both need the `ANTHROPIC_API_KEY` repository secret.

## Building

```bash
cd backend && ./gradlew build          # compile + test (tests need Docker)
cd backend && ./gradlew build -x test  # compile only, no Docker required
cd backend && ./gradlew bootRun        # needs a Postgres on localhost:5432
```

Spring Boot 4.1 on Java 21, Gradle with the Kotlin DSL. The build targets
Java 21 via a toolchain; if the machine has a different JDK, Gradle provisions
one automatically through the Foojay resolver in `settings.gradle.kts`.

**Boot 4 renamed things.** Starters are `spring-boot-starter-webmvc` (not
`-web`), and test starters are split per module (`-data-jpa-test`,
`-webmvc-test`). Boot 3 snippets found online will not copy-paste cleanly.

**Boot 4 also relocated the test slices** out of
`org.springframework.boot.test.autoconfigure.*` into per-module packages. Boot 3
imports fail to compile with a bare "cannot find symbol", which reads like a
missing dependency rather than a moved class:

| Class | Boot 4 package |
| --- | --- |
| `DataJpaTest` | `org.springframework.boot.data.jpa.test.autoconfigure` |
| `AutoConfigureTestDatabase` | `org.springframework.boot.jdbc.test.autoconfigure` |
| `TestEntityManager` | `org.springframework.boot.jpa.test.autoconfigure` |

When an annotation you know exists won't resolve, find its real package rather
than adding dependencies:

```bash
unzip -l ~/.gradle/caches/modules-2/**/spring-boot-*-test-*.jar | grep TheClass
```

**Tests require Docker** — `ExpenseCalcBackendApplicationTests` starts a real
Postgres via Testcontainers. Without a Docker daemon, `./gradlew build` fails
at the test task, not at compilation. Use `-x test` when you only need to know
the code compiles.

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
