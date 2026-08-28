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

`backend/` is scaffolded and carries the expense model, the money conversions,
and the classification rule engine. `frontend/` is scaffolded as an Expo app
(#3) — see [`frontend/README.md`](frontend/README.md) for its layout and the
charting decision.

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
  `actions/checkout` defaults to the default branch — which landed the agent in
  a tree containing none of the PR's files. Its changed-file SHAs came back
  `unknown` and it burned nine turns reasoning about code that was not there.
  The `git hash-object` errors in the log are warnings, not the cause; the run
  ended on `is_error:true`, which is why `show_full_output: true` is set here
  too. Broken from the beginning, and only surfaced when #38 made `@claude` the
  re-review path.

  Only an **open, same-repo** PR resolves to a branch. A merged or closed one
  falls back to the default branch, and that fallback is the point twice over.
  A merged PR's work is already *in* the default branch, so that is the tree to
  reason about — and the head branch may simply not exist, in which case naming
  it as `ref` fails checkout on a missing ref before the agent can report
  anything. **Closed-without-merging is the weak case** — neither reason covers
  it, since nothing landed and nobody cleans up the branch of a PR they
  abandoned — but the check cannot tell it apart from the others cheaply, and
  failing checkout is worse than reading the wrong tree.

  **The repo does not delete head branches automatically** —
  `deleteBranchOnMerge` is false, which `gh repo view --json
  deleteBranchOnMerge` will confirm. This file claimed the opposite for a while
  and used it as the sole justification for the fallback; the fallback was right
  and the reason was wrong. Branches here are deleted by hand, whenever someone
  gets round to it, which is exactly the unpredictability that makes the
  fallback worth having rather than a setting to look up.

  Fork PRs fall back too, deliberately — the action turns a PR-head checkout
  into a real branch and pushes it to `origin`, which is this repo, so a commit
  would land here attached to no PR while the fork saw nothing.

  `claude.yml` itself is exempt from the byte-identical rule below: its events
  always run the default branch's copy of the workflow, so it cannot differ
  from itself.
- **`.github/workflows/claude-code-review.yml`** — automatic, but **once per PR,
  not once per push.** It runs when a PR opens or leaves draft. **To re-review
  after pushing fixes, comment `@claude` on the PR** — that goes to
  `claude.yml`, so nothing is lost by the narrower trigger.

  It reviewed on every push until #38. One PR cost four rounds of roughly six
  minutes of Opus each, and reviews share the subscription quota with
  interactive Claude Code, so the later rounds — which mostly re-verified the
  earlier rounds' fixes — were taking quota from whoever was at a terminal.
  Whether a push deserves another round is a judgement only the author has.

  It can run `cd backend && ./mvnw -B -q verify` and the four frontend checks,
  and is asked to reproduce a bug before reporting it and to run a fix before
  suggesting one — a reviewer that could only read the code got its diagnoses
  right but its remedies wrong. The workflow installs `frontend/node_modules`
  before the agent starts, so the reviewer can read the installed
  `react-native` and `react-native-web` sources instead of recalling how a
  prop behaves. That was the whole failure mode on the a11y series (#71, #83):
  correct symptom, unusable fix, each one settled in seconds by opening the
  package.

  Bash is otherwise off; the allowlist covers the two build tools, `npm ci`,
  `npm run`, `npm test`, and git's read-only verbs (`status`, `log`, `diff`,
  `show`, `branch`, `ls-files`, `rev-parse`, `blame`) — nothing that moves a
  ref, and **not `npx`**, which fetches and executes from the network. Note
  Claude Code separately refuses `cd <dir> && git ...` because that can run
  hooks from the target directory — the allowlist does not override that.

  **Node is pinned to 22 to match `ci.yml`**, for the same reason the JDK is
  pinned to 21: a reviewer testing on a different runtime than the merge gate
  reports failures nobody else sees. The two files have to move together.

Both authenticate with the `CLAUDE_CODE_OAUTH_TOKEN` repository secret, which
draws on a Claude Pro/Max subscription. Regenerate it with `claude setup-token`
and store it with `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.

The `ANTHROPIC_API_KEY` secret is *not* the credential these workflows use.
Billing on platform.claude.com is prepaid and separate from a claude.ai
subscription, so an API key on an unfunded account fails with "credit balance
is too low" — which the action reports as a bare `is_error:true`. **Both
workflows set `show_full_output: true`** to unmask that. `claude.yml` gained it
in #39, after a failure there surfaced only as unrelated `git hash-object`
noise and cost a wrong diagnosis.

Both pin `--model claude-opus-5`, and CI shares the subscription quota with
interactive Claude Code — so dropping the pin is the first remedy if runs
start failing with `is_error:true`.

**Changing `claude-code-review.yml` costs every open branch its reviewer until
it takes the change.** The action requires the workflow file to be identical to
the default branch's copy and skips itself otherwise, so merge `main` into a
branch after that workflow changes. The reviewer also carries
`paths-ignore: '.github/**'`, so a PR touching only workflow files never
triggers a run in the first place — two different mechanisms with the same
visible outcome.

## Building

```bash
cd backend && ./mvnw verify              # compile + test (tests need Docker)
cd backend && ./mvnw -DskipTests package # compile only, no Docker required
cd backend && ./mvnw spring-boot:run     # needs a Postgres on localhost:5432
```

```bash
cd frontend && npm run web               # desktop web target
cd frontend && npm run lint              # the four checks CI runs, on Node 22
cd frontend && npm run typecheck
cd frontend && npm test
cd frontend && npm run export:check      # bundles iOS, Android, and web
```

`expo export --platform all` is the cheapest proof the JS compiles for iOS and
Android: it produces Hermes bytecode for both without Xcode or Android Studio
installed. It is **not** a substitute for running on a simulator — it cannot
catch a native module that is missing or misconfigured.

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

**Amounts are signed, and totals are net.** A refund is a negative amount that
keeps the category of what it refunds (spec §5), so a category total is
spending minus refunds and **may be zero or negative**. No aggregation may
`abs()` an amount, filter out negatives, or assume a total is non-negative —
each of those turns a net total back into a gross one silently, and the numbers
still look plausible until someone reconciles against a bank statement.
`NoAbsoluteValueInMoneyPathsTest` fails the build on the first of those;
`SignedAmountAggregationTest` pins the arithmetic the others would break.

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
