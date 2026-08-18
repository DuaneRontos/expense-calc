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

  **On a PR it checks out the PR head, and that step is load-bearing.** None of
  the four events it listens to is a `pull_request` event, so
  `actions/checkout` defaults to the default branch — which meant a PR mention
  landed the agent in a tree containing none of the PR's files and it died
  computing SHAs in about 30 seconds. That was true from the beginning and only
  surfaced when #38 made `@claude` the re-review path. Same-repo PRs check out
  the head branch by name so the agent can push to it; forks get the read-only
  `refs/pull/N/head`.
- **`.github/workflows/claude-code-review.yml`** — automatic, but **once per PR,
  not once per push.** It runs when a PR opens or leaves draft. **To re-review
  after pushing fixes, comment `@claude` on the PR** — that goes to
  `claude.yml`, so nothing is lost by the narrower trigger.

  It reviewed on every push until #38. One PR cost four rounds of roughly six
  minutes of Opus each, and reviews share the subscription quota with
  interactive Claude Code, so the later rounds — which mostly re-verified the
  earlier rounds' fixes — were taking quota from whoever was at a terminal.
  Whether a push deserves another round is a judgement only the author has.

  It can run `cd backend && ./mvnw -B -q verify`, and is asked to reproduce a
  bug before reporting it and to run a fix before suggesting one — a reviewer
  that could only read the code got its diagnoses right but its remedies wrong.
  Bash is otherwise off; the allowlist covers the build wrapper only.

Both authenticate with the `CLAUDE_CODE_OAUTH_TOKEN` repository secret, which
draws on a Claude Pro/Max subscription. Regenerate it with `claude setup-token`
and store it with `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.

The `ANTHROPIC_API_KEY` secret is *not* the credential these workflows use.
Billing on platform.claude.com is prepaid and separate from a claude.ai
subscription, so an API key on an unfunded account fails with "credit balance
is too low" — which the action reports as a bare `is_error:true`. Only
`claude-code-review.yml` sets `show_full_output: true` to unmask that; a
failing interactive run still needs the flag added before it will say why.

Both pin `--model claude-opus-5`, and CI shares the subscription quota with
interactive Claude Code — so dropping the pin is the first remedy if runs
start failing with `is_error:true`.

## Building

```bash
cd backend && ./mvnw verify              # compile + test (tests need Docker)
cd backend && ./mvnw -DskipTests package # compile only, no Docker required
cd backend && ./mvnw spring-boot:run     # needs a Postgres on localhost:5432
```

Spring Boot 4.1 on Java 21, Maven. `spring-boot-starter-parent` supplies
dependency management, which is why no dependency in `pom.xml` carries a
version.

The `java.version` property drives `maven.compiler.release`, so the compiler
enforces Java 21 APIs and bytecode whatever JDK runs the build. A newer JDK
produces a correct Java 21 artifact — there is nothing to install or provision
to match.

**`release` governs compilation only.** Surefire forks the test JVM on whatever
JDK is running the build, so tests run on your local JDK while CI runs them on
21. Hibernate's bytecode generation is JDK-sensitive, so a failure that appears
on one and not the other is possible in both directions. **CI on JDK 21 is the
parity check; a local pass on a newer JDK is advisory.** Trust CI when they
disagree.

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
find ~/.m2/repository -name 'spring-boot-*test*.jar' -exec unzip -l {} \; | grep TheClass
```

The matched line is the class's path inside the jar, which is its package.

**Tests require Docker** — `ExpenseCalcBackendApplicationTests`,
`ExpenseRepositoryTest`, and `CategoryTypeTest` start a real Postgres via
Testcontainers. Without a Docker daemon `./mvnw verify` fails in the test
phase, not at compilation. Use `-DskipTests` when you only need to know the
code compiles, and rely on CI to run the rest.

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
