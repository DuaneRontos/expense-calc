---
name: spring-service-conventions
description: Backend structure conventions for this expense calculator's Spring Boot API — layering, transaction boundaries, DTO mapping, RFC 7807 error responses, and which of the three validation layers a given check belongs in. Use when adding or changing a controller, service, repository, request/response record, or exception handler in backend/.
---

# Spring Boot service conventions

These are the patterns the existing backend already follows. The point is
drift: without them each new endpoint reinvents the structure slightly
differently, and the differences are all individually defensible.

## Layering

`Controller → Service → Repository → Entity`, one direction only. A controller
never touches a repository; a repository never returns a DTO.

| Layer | Owns | Never |
| --- | --- | --- |
| Controller | HTTP shape, path/param binding, parsing a wire string into a domain type, `ResponseEntity` status and headers | Business rules, `@Transactional`, repository access |
| Service | Orchestration, transaction boundaries, "what happens when" | HTTP types, `ResponseEntity`, servlet anything |
| Repository | Data access and nothing else | Business rules, DTO construction |
| Entity / domain | Its own invariants — an entity that cannot be constructed invalid | Knowing about HTTP, DTOs, or Spring |

**Packages are by feature, not by layer.** `api/` is the write side, `query/`
the filtered read, `report/` the aggregations, `classification/` the rule
engine, `expense/` the entity and its repository, `money/` the minor-unit
conversion. A new feature gets its own package with its controller, service,
DTOs, and exception handler in it — not a new class in four existing
layer-shaped packages.

## Transaction boundaries

**`@Transactional` goes on the service method. Not the controller, not the
repository, not the class.** The service method is the unit of work; anything
wider commits things that were never one operation, anything narrower splits
things that were.

**Every read path is `@Transactional(readOnly = true)`.**

**Two statements that must agree about the database need one transaction *and*
the right isolation.** Postgres defaults to READ COMMITTED, where each
statement takes a fresh snapshot — a count and a page in one READ COMMITTED
transaction can still return "51 of 50". `ExpenseQueryService.list` uses
`Isolation.REPEATABLE_READ` for exactly this, and pins its own `asOf` instant
so a concurrent reclassification cannot move a row across a category filter
mid-request.

**A write that changes a category appends its `ClassificationRecord` in the
same transaction as the change.** An expense with no record is
indistinguishable from one nobody classified.

## DTO mapping

**Entities never cross the controller boundary — in either direction.**

**Request bodies are records nested in a `XxxRequests` container** (see
`ExpenseRequests`), carrying their bean-validation annotations. **Responses are
records with a static `of(...)` factory** that does the entity→DTO mapping
(`ExpenseDetail.of`, `CategoryBreakdown.of`). Mapping lives in the DTO, not
scattered through the service.

**Money crosses the wire as a decimal string in both directions**, never a JSON
number — a JSON number is a double by the time Jackson sees it, so the
precision is gone before validation could notice. Parse it at the controller,
convert through `Money`, and let `Money` be the only place minor and major
units cross.

**Watch what Jackson picks up off a record.** An `isXxx()` method on a response
record serializes as an extra property — `CategoryBreakdown.hasNoBuckets()` is
named that way because `isEmpty()` added a fifth key to a four-key contract.

## Error responses

**RFC 7807 `ProblemDetail`, with a typed URI, a title, and field-level
`violations` for 400s** — the client renders `detail` inline against the
offending field rather than in a toast.

**Every `@RestControllerAdvice` is scoped to its controller with
`assignableTypes`. Never a global advice.** All four handlers in this codebase
are scoped this way for one reason: a broad mapping catches server-side precondition
failures deeper in the stack and reports them as the caller's bad input, which
stops them showing up as the 500s somebody actually investigates. This applies
especially to the `IllegalArgumentException` net that catches domain guards.

**Convert exceptions where the meaning is known.** `ReportController` turns an
`IllegalArgumentException` from `ReportPeriod`'s constructor into a 400 at the
call site, because only there is it known to describe the request rather than a
server-side failure.

**Custom exceptions carry the field they concern**, so the handler can build
the violation without guessing (`InvalidExpenseException.getField()`,
`InvalidReportPeriodException`'s field list).

## Where validation lives

Three layers, deliberately overlapping — each catches what the others can't:

1. **Bean validation on the request record** — presence, size, shape.
   `@NotNull`, `@NotBlank`, `@Size`. Cheapest, and produces per-field
   violations for free.
2. **Controller pre-checks** — anything needing a parse or a specific
   field-level message: parsing a decimal string, rejecting a blank `PATCH`
   field that would otherwise mean something different from both "leave alone"
   and "clear".
3. **Domain guards in the entity or `Money`** — the invariants that must hold
   however the object was constructed, as the last net.

**The overlap is intentional, and it drifts.** `MAX_REASON_LENGTH = 200` and
`@Size(max = 200)` are independent literals with nothing tying them together;
raise one and the other turns into a 500 for what is still bad input. When you
change a bound in one layer, grep for the others.

**Reject at the boundary, before persistence, for anything that would poison
aggregates** — a non-`PHP` currency is a 400 before it reaches the database, so
no aggregation can ever sum across currencies.

## Wiring

**Constructor injection into `final` fields.** No `@Autowired` fields. The
native-SQL repository's `@PersistenceContext EntityManager` is the one
exception.

**Inject a `Clock`; never call `Instant.now()` or `LocalDate.now()` at a call
site.** Which month a report covers must be testable. Fix time in a test by
constructing the service directly with `Clock.fixed(...)` rather than
overriding the bean — `@ConditionalOnMissingBean` outside an auto-configuration
is order-dependent and silently ignored a test's replacement clock.

**Native SQL only where Criteria cannot express the query** (the lateral join
for current category), and then: every value is a bound parameter, and the only
concatenated text comes from enum constants declared in code.

## When reviewing backend code

- `@Transactional` is on service methods only; reads carry `readOnly = true`.
- No controller reaches a repository directly, and no entity is returned from a
  controller.
- A multi-statement read whose parts must agree sets isolation and shares one
  `asOf` — not just one transaction.
- Every `@RestControllerAdvice` names `assignableTypes`; none is global.
- New request records carry bean validation; new bounds don't silently
  duplicate an existing constant.
- Amounts cross the wire as decimal strings, and minor↔major conversion goes
  through `Money` and nowhere else.
- `Clock` is injected, not read statically, anywhere a date or period is
  derived.
- No N+1: a per-row lookup in a list or report path is a defect (spec §10),
  not an optimization to do later.
