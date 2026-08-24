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

This codebase has two well-documented ways for a test to pass while testing
nothing, and both look exactly like success:

**Frontend component renders mount nothing.** `@testing-library/react-native`
was installed and removed because `render()` returns an empty result under the
`jest-expo` preset (see `frontend/README.md`). A component test written today
passes without asserting anything real. **So don't write one** — test the logic
underneath the component: the geometry function, the formatter, the query
serializer, the hook. Every frontend test in this repo is pure logic for this
reason. If the behavior you were asked to cover genuinely needs a mounted
component, say so rather than producing a green that means nothing.

**Backend Testcontainers tests need a running Docker daemon.** Without one they
fail in the test phase, which reads as red but is not *your* red. Never reach
for `-DskipTests` to get past it — that skips the test you just wrote, which is
the one thing you actually needed to run. Start Docker, or say plainly that you
could not run it.

The general rule both cases point at: **a test that passes the first time you
run it has told you nothing.** Break the code deliberately and watch it go red
before you believe it.

## Running just what you wrote

The full suite is too slow for a red-green cycle. Run the one thing:

```bash
cd backend && ./mvnw test -Dtest=TheNewTestClass
```

```bash
cd frontend && npx jest path/to/the.test.ts
```

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
- **The empty case.** An empty period is a 200 with no buckets, not a 404.
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

`NoAbsoluteValueInMoneyPathsTest` scans the source for `abs()` and for
`double`/`float` in money paths and fails the build on a hit;
`SignedAmountAggregationTest` pins the arithmetic those would break. This is
TDD pointed at a convention rather than a feature, and it is the right move
whenever a rule has a spelling a machine can find — a convention in prose gets
violated by the next contributor, a convention with a red test does not.

Be honest about scope when you write one. That test's own comment says it
catches spellings, not intent: "filters out negatives" has no single spelling
and it will not catch that.

## Delegation

`test-writer` (subagent) writes and runs focused tests against a named module
and reports pass/fail with real output. Hand it the red step when the tests are
substantial enough to be their own task — it will not touch the code under
test, which is what keeps the discipline intact.

`money-safety-auditor` (subagent) is the verifier half: read-only, reports with
`file:line` evidence. Run it after green on anything carrying an amount. Tests
prove the cases you thought of; the auditor finds the money paths you didn't.

## When reviewing test-driven work

- Every new test was run and observed to fail before the code existed. If it
  cannot be shown to have failed, it has not been established that it can.
- No frontend test mounts a component — that green is vacuous here.
- No `-DskipTests` anywhere near a change that added backend tests.
- Money tests include a negative amount; period tests include a boundary date.
- Amounts are compared with `compareTo()`, not `equals()`.
- The implementation is no larger than the tests demanded — untested code that
  arrived alongside tested code is the part that will break.
- A convention that could have been a failing test is one, or there is a stated
  reason it can't be.
