---
name: test-driven-development
description: Test-driven development discipline for this repo — write the failing test first, prove it fails for the right reason, then make it pass. Use when implementing any new backend or frontend behavior, fixing a bug, adding tests to existing code, or deciding what to test; and especially whenever a test passes on its first run, which in this codebase usually means it is testing nothing.
---

# Test-driven development

Red, green, refactor. The order is the whole technique — a test written after
the code it tests has never been observed to fail, so nothing has established
that it *can*.

## The loop

**1. Red — write the test, run it, watch it fail.**

Running it is not optional and not a formality. You are not checking that the
feature is missing; you are checking that this test is wired to the thing it
claims to test. Read the failure message and confirm it names the behavior you
meant. A test that fails for the wrong reason — wrong fixture, typo'd method,
absent Docker — is indistinguishable from a working red at a glance, and it
goes green later for a reason you never learn.

**2. Green — the smallest change that passes it.**

Resist implementing the next three cases you can already see. They are the next
red, and writing them now means writing code no test demanded.

**3. Refactor — with the test green, change the shape, not the behavior.**

The test staying green is the licence to refactor; that is what it is for.

## Vacuous green is the failure mode here

**A test that passes the first time you run it has told you nothing.** Break
the code deliberately and watch it go red before you believe it. Two ways this
codebase produces a green that means nothing:

**An assertion too weak to fail.** This is the common one, and there is a real
instance in the repo. The period chips once carried `selected` alone, so on web
they announced identically whether or not they were active — and
`toBeSelected()` passed throughout the bug. `PeriodPicker.test.tsx` now asserts
`toBeChecked()`, which reads `aria-checked ?? accessibilityState.checked`, the
pair the platforms actually read. Same component, same render, same green — one
assertion could fail and the other could not. When you write the red step, ask
what would have to break for this line to fail; if the answer is "nothing
reachable", the test is decoration.

**`toBeChecked()` is not the general remedy — reading what the platform
actually exposes is.** `AppShell.test.tsx` hit the same class of bug with nav
items that differed only by colour and weight, and could not use that fix:
`role="button"` supports neither `checked` nor `selected` in ARIA, so the state
had to move into the accessible label and the assertion became
`getByLabelText('Expenses, current screen')`. Which matcher carries teeth
depends on the role, so check what the role supports before asserting on it
rather than copying an assertion that worked elsewhere.

**Backend Testcontainers tests need a running Docker daemon.** Without one they
fail in the test phase, which reads as red but is not *your* red. Never reach
for `-DskipTests` to get past it — that skips the test you just wrote, which is
the one thing you actually needed to run. Start Docker, or say plainly that you
could not run it.

## Frontend render tests work — write them

`@testing-library/react-native` 14 is a current dependency and renders
properly. The suites that mount are the `.test.tsx` files under
`frontend/src/**/__tests__/`; `renderHook` from the same library is how the
hook tests are written. Don't take a count from this file — `git grep -l
"@testing-library/react-native" -- frontend/src` is current and a roster is
stale the next time someone adds a test.

What fixed it (#64) was installing `test-renderer`, which RNTL 14 **requires as
a peer dependency** — not a workaround, and not something to remove later. The
original diagnosis went wrong because `react-test-renderer` is a different
package that is still in the tree transitively, so "React, `react-test-renderer`
and RNTL are all on matching versions" was true and irrelevant at the same time.

That mistake outlived the fix in four places and was corrected in #82. **If you
find a note claiming renders mount nothing, it predates #64 — check
`package.json` and the test files before believing it.**

Rendering is the right level for anything about **announced state,
accessibility, or what a user can actually perceive** — the chip bug above was
invisible to a pure-logic test because the logic was correct and the announced
state was not. Keep testing pure logic where the behavior is pure logic:
geometry, formatting, query serialization, period math.

RNTL's `getBy*` queries throw when nothing matches, which is a useful property
— a render test that passes has genuinely mounted something.

## Running just what you wrote

The full suite is too slow for a red-green cycle. Run the one thing:

```bash
cd backend && ./mvnw test -Dtest=TheNewTestClass
```

```bash
cd frontend && npm test -- path/to/the.test.ts
```

`npm test --` rather than `npx jest`, because that is what runs in both places.
The review workflow's allowlist permits `npm ci`, `npm run` and `npm test` but
deliberately excludes `npx`, which fetches and executes from the network — so
an agent told to `npx jest` is refused in CI and reports the behavior as
uncoverable. `npx jest` works locally if you prefer it.

Run the whole suite once before you open a PR, not on every cycle. CI runs the
backend on JDK 21 while your local JDK may be newer, and Hibernate's bytecode
generation is JDK-sensitive — **when local and CI disagree, CI is the parity
check and a local pass is advisory.**

## What to write a test for first

Start with the case that describes the behavior, then the cases that would
embarrass you in production. In this domain those are predictable:

- **A negative amount**, in anything touching money. A refund is a negative
  amount keeping its original category, so totals are net and may be zero or
  negative. A money test whose fixtures are all positive passes just as well
  against an implementation that `abs()`es everything.
- **A boundary date**, in anything touching periods. Reporting windows are
  half-open `[from, to)` and resolve against `Asia/Manila` — the bugs live on
  the first and last day, and at the hours where UTC and Manila disagree about
  which month it is.
- **The empty cases — both of them, because they differ.** A period with no
  expenses at all is a 200 with `buckets: []`, not a 404. But an empty *slice
  inside* a non-empty `over-time` period is a bucket with total `"0.00"` that
  is still present — omitting it lets a line chart draw two points three months
  apart as adjacent. Pinning "empty means absent" for `over-time` encodes the
  opposite of the contract.
- **The unmatched case**, in classification. `UNCLASSIFIED` is a real state
  that must be reached rather than fallen through to.

Compare money with `compareTo()`, never `equals()` — `BigDecimal.equals()`
compares scale, so `2.50` and `2.5` are unequal and the test fails for a reason
that has nothing to do with the behavior.

## Match the tests already there

AssertJ (`assertThat`, `assertThatThrownBy`), JUnit 5, mirrored package path
under `backend/src/test/java`. Frontend tests are colocated in `__tests__/`
next to the module. One behavior per test, named so a failure says what broke
without reading the body.

## When a convention can be machine-checked, make it a build failure

`NoAbsoluteValueInMoneyPathsTest` fails the build on `abs()` or on
`double`/`float`, scanning the whole backend main tree — `.java`, plus `.sql`
and `.yml` under `src/main/resources`, because reporting aggregates in SQL and
a Java-only scan would miss the path the arithmetic actually takes.
`SignedAmountAggregationTest` pins the arithmetic those would break. This is
TDD pointed at a convention rather than a feature, and it is the right move
whenever a rule has a spelling a machine can find — a convention in prose gets
violated by the next contributor, a convention with a red test does not.

**Assert that your guard found something to scan.** That class's third test
checks it saw at least 14 files, at least 200 code lines, and at least one
`.sql`. Without it the guard silently becomes a no-op the day a path changes:
a scan over zero files reports clean forever. *A guard that cannot fail is
worse than none, because it reads as coverage* — the same principle as the
failing-first rule, applied to the test itself.

Be honest about scope. That test's own comment says it catches spellings, not
intent: "filters out negatives" has no single spelling and it will not catch
that.

## Delegation

`test-writer` (subagent) writes and runs focused tests against a named module
and reports pass/fail with real output. Hand it the red step when the tests are
substantial enough to be their own task — it will not touch the code under
test, which is what keeps the discipline intact.

`money-safety-auditor` (subagent) is the verifier half: read-only, reports with
`file:line` evidence. Run it after green on anything carrying an amount. Tests
prove the cases you thought of; the auditor finds the money paths you didn't.

## When reviewing test-driven work

- The PR records the failure the new test produced before the fix — the message
  or the assertion diff. "Ran it and it failed" leaves no trace a reviewer can
  check; the actual output does.
- Every assertion could fail against some reachable state. An assertion that
  holds whether or not the behavior works is the vacuous green above.
- No `-DskipTests` anywhere near a change that added backend tests.
- Money tests include a negative amount; period tests include a boundary date.
- Amounts are compared with `compareTo()`, not `equals()`.
- The implementation is no larger than the tests demanded — untested code that
  arrived alongside tested code is the part that will break.
- A convention that could have been a failing test is one, or there is a stated
  reason it can't be.
