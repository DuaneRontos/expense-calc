# Running the backend on your machine

Everything here has been exercised in CI. What CI cannot tell you is whether it
works on *your* laptop, which is what this is for.

## What you need

| | |
| --- | --- |
| **JDK 21 or newer** | `java -version`. A newer JDK is fine — the build targets 21 bytecode whatever you compile with, so there is nothing to install to match. |
| **Docker** | Only for the tests and for the throwaway database below. Not needed to compile. |

You do **not** need Maven installed. `./mvnw` downloads the right version.

## The fastest way to see it work

One command, no database setup, no configuration:

```bash
cd backend && ./mvnw -B verify
```

That compiles everything and runs all 377 tests, including nine suites that
start a real PostgreSQL in Docker. The one worth watching is
`BackendOperabilityTest` — it boots the whole application on a random port
against that database, then drives it over HTTP: creates an expense, watches
the rule engine file it under Groceries unprompted, lists it, checks the
report, reclassifies it, watches the report follow, and deletes it.

**If that passes, the backend works.** Everything below is for poking at it by
hand.

## Running the app for real

The application needs a PostgreSQL on `localhost:5432`. The quickest one:

```bash
docker run --name expensecalc-db -e POSTGRES_DB=expensecalc -e POSTGRES_USER=expensecalc -e POSTGRES_PASSWORD=expensecalc -p 5432:5432 -d postgres:17
```

Then:

```bash
cd backend && ./mvnw spring-boot:run
```

Flyway creates the schema on first start — there is no migration step to run
yourself. The API is on `http://localhost:8080/api/v1`.

To stop and throw the database away afterwards:

```bash
docker rm -f expensecalc-db
```

## Trying the API

**There is no authentication yet** (issue #21, deliberately deferred to first
deployment per spec §9.2), so these work as-is.

Create an expense — note the amount is a **string**, not a number:

```bash
curl -s -X POST http://localhost:8080/api/v1/expenses -H 'Content-Type: application/json' -d '{"amount":"1234.56","currency":"PHP","occurredOn":"2026-01-15","merchant":"Puregold","description":"weekly shop"}'
```

The response comes back classified as `GROCERIES` with a `classifications`
array showing `RULE_ENGINE` decided it. Nobody told it that — the rules are in
code (`ClassificationRules.java`).

Record a refund by sending a negative amount:

```bash
curl -s -X POST http://localhost:8080/api/v1/expenses -H 'Content-Type: application/json' -d '{"amount":"-500.00","currency":"PHP","occurredOn":"2026-01-20","merchant":"Puregold","description":"returned items"}'
```

List with filters, sorting and paging:

```bash
curl -s 'http://localhost:8080/api/v1/expenses?category=GROCERIES&from=2026-01-01&to=2026-02-01&sort=amountMinor,desc&size=10'
```

See the refund netted against the spending — the total is 734.56, not 1734.56:

```bash
curl -s 'http://localhost:8080/api/v1/reports/by-category?from=2026-01-01&to=2026-02-01'
```

Spend over time, and a period comparison:

```bash
curl -s 'http://localhost:8080/api/v1/reports/over-time?from=2026-01-01&to=2026-04-01&bucket=month'
```

```bash
curl -s 'http://localhost:8080/api/v1/reports/compare?from=2026-03-01&to=2026-04-01'
```

The taxonomy, which the client is meant to read rather than hardcode:

```bash
curl -s http://localhost:8080/api/v1/categories
```

## Things that will look like bugs and are not

**A total can be negative.** More refunds than spending in a period nets below
zero, and the report says so rather than clamping at zero. `INCOME` is included
in the headline total, so a month with a salary in it reports negative — that is
net cash flow, and it is argued in `CategoryBreakdown`'s javadoc.

**`minAmount=0` excludes refunds.** Bounds compare against the signed amount, so
a minimum of zero means "at least zero pesos", not "at least zero in magnitude".

**Dates are half-open.** `to=2026-02-01` means *up to but not including* the
1st, so January and February cannot both count the same day.

**An unrecognised merchant is `UNCLASSIFIED`, not a guess.** That is a real
state, not a failure — a wrong confident guess corrupts every report after it,
and an unclassified row is visible and fixable.

## When something goes wrong

**Tests fail with a Docker or Testcontainers error.** The daemon is not running.
`./mvnw -DskipTests package` compiles without it, and CI runs the rest.

**The app fails to start with a connection error.** Nothing is listening on
5432, or the credentials differ from the `docker run` above. They are read from
`DB_URL`, `DB_USERNAME` and `DB_PASSWORD` if you would rather set those.

**The app fails to start complaining about schema validation.** The database has
an older schema than the code. Simplest fix locally is to drop the container and
let Flyway rebuild it: `docker rm -f expensecalc-db` and start again.

**Tests pass locally but fail in CI, or the reverse.** CI runs JDK 21; you may
be on something newer. Hibernate's bytecode generation is JDK-sensitive, so a
difference is possible in both directions. **CI is the parity check** — trust it
when they disagree.
