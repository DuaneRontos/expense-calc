# Expense Calculator — Specification

**Version** 0.1 (initial draft) · **Status** Nothing implemented

This spec is written forward from the domain, not derived from existing code —
at time of writing the repository contains no `backend/` or `frontend/` source.
Conventions referenced here are already committed in [`CLAUDE.md`](../CLAUDE.md)
and [`.claude/skills/expense-classification/SKILL.md`](../.claude/skills/expense-classification/SKILL.md);
this document is the layer above them.

Assumptions are marked **[A]**. Open decisions are collected in §9.

---

## 1. Purpose and scope

An expense calculator that records spending, classifies it into a fixed
taxonomy, lets the user query it by any dimension, and turns the result into
analytical reports with charts.

**Primary user [A]:** one person tracking personal or household spending. The
data model does not currently carry a tenant or owner. If this is meant to be
multi-user, say so now — retrofitting tenancy after the reporting layer exists
is expensive.

### In scope for v1

- Manual expense entry and editing
- Deterministic classification into a closed category taxonomy
- Filtering, sorting, and pagination across the full expense set
- Three analytical reports rendered as charts
- Mobile and desktop clients from one codebase

### Explicitly out of scope for v1

Bank or card import · receipt OCR · budgets and forecasting · currency
conversion · recurring-expense detection · tax or accounting export ·
multi-user sharing · notifications

These are excluded to keep v1 shippable, not because they're bad ideas.
Several are natural v2 candidates; budgets in particular would reuse the
reporting aggregation almost unchanged.

---

## 2. Platform strategy

The requirement is desktop **and** mobile with a React Native frontend. React
Native is mobile-first, so this needs an explicit decision rather than an
assumption. Three viable paths:

| Option | Desktop story | Cost |
| --- | --- | --- |
| **A. React Native + React Native Web** | Runs in the browser; installable as a PWA | One codebase. Some RN libraries lack web support — charting and gestures need checking before commitment. |
| **B. React Native + Electron shell** | Native desktop binary | Adds packaging, auto-update, and code-signing work. Heavy for an expense tracker. |
| **C. RN mobile + separate React web app** | Purpose-built desktop UI | Two frontends, two sets of bugs, duplicated API client. Best desktop UX, worst maintenance. |

### Decision: Option A — React Native Web via Expo

**Decided.** One codebase, and "desktop" for this application means a resizable
window showing tables and charts — a browser tab serves that fully.

The realistic risk is the charting library: **it must have confirmed React
Native Web support, verified by rendering a chart on the web target** — not by
reading a README. Discovering the gap at the chart-screen stage means rewriting
the visualization layer.

Issue [#3](https://github.com/DuaneRontos/expense-calc/issues/3) has been
updated accordingly: the scaffold is Expo rather than bare React Native, the
acceptance criteria gain a web target alongside iOS and Android, and the
charting-library evaluation is folded into that PR.

### Responsive behavior

One layout system, three breakpoints:

| Width | Layout |
| --- | --- |
| < 600px | Single column. Bottom tab navigation. Charts full-bleed, one per screen. |
| 600–1024px | Two-column list + detail. Filters in a collapsible drawer. |
| > 1024px | Persistent filter sidebar, expense table, charts in a responsive grid. |

Touch targets stay at mobile sizing on all breakpoints — desktop users with
touchscreens are common and the cost of generous hit areas is nil.

---

## 3. Architecture

```
React Native (iOS · Android · Web)
            │  REST/JSON over HTTPS
            ▼
    Spring Boot API  ──►  PostgreSQL
     (stateless)          (Flyway-migrated)
```

**The backend owns all aggregation.** Report endpoints return chart-shaped
data — buckets with labels and totals. The client never sums a list of raw
expenses. This is stated in `CLAUDE.md` and is load-bearing: it keeps money
arithmetic in `BigDecimal` on the JVM rather than in JavaScript numbers, and
keeps report totals consistent across platforms.

**The API is stateless.** No server-side session. Every request carries what it
needs.

**Auth [A]:** deferred for v1 on the assumption of a single local user. If the
app is ever exposed beyond localhost this becomes blocking, not optional —
see §9.2.

---

## 4. Domain model

### Expense

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Server-generated |
| `amountMinor` | `BIGINT` | **Minor units** (cents). Signed — negative means refund. |
| `currency` | `CHAR(3)` | ISO 4217. Single-currency in v1; stored so v2 isn't a migration. |
| `occurredOn` | `LocalDate` | The date the money moved, user-supplied |
| `merchant` | `VARCHAR(200)` | Nullable |
| `description` | `TEXT` | Nullable |
| `createdAt` / `updatedAt` | `Instant` | Audit, server-set |

Amounts are stored as integers and exposed as `BigDecimal` at the service
boundary. Summation stays exact and scale never drifts across a large set.

The current category is **not** a column — it is derived from the latest
`ClassificationRecord` (§4.2).

### ClassificationRecord

Append-only. Changing a category writes a new row; the previous row stays.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | |
| `expenseId` | UUID | FK → Expense |
| `category` | enum | See taxonomy below |
| `source` | enum | `RULE_ENGINE` \| `USER` \| `IMPORT` |
| `reason` | `VARCHAR(200)` | Which rule fired, or the user's note |
| `recordedAt` | `Instant` | Latest wins for "current category" |

This exists so reports over historical periods stay reproducible. An overwrite
would silently change last quarter's numbers.

**Index:** `(expenseId, recordedAt DESC)` — the current-category read happens on
every list and every report, so it must not table-scan.

### Category

Closed taxonomy, defined in full in the classification skill:

`HOUSING` · `UTILITIES` · `GROCERIES` · `DINING` · `TRANSPORT` ·
`MAINTENANCE` · `HEALTH` · `DISCRETIONARY` · `CAPITAL` · `INCOME` ·
`UNCLASSIFIED`

Adding a category is a schema change plus a migration with a defined
destination for every existing expense — not an enum edit.

---

## 5. Classification

The rules live in [the classification skill](../.claude/skills/expense-classification/SKILL.md).
The specification-level commitments:

**Deterministic.** The same expense always lands in the same category. Rules
live in code, not in prompt text or model output.

**Ordered matching:** merchant → description → amount, first match wins. Amount
alone never determines a category; it only disambiguates candidates that
already matched on text.

**`UNCLASSIFIED` is a real state.** Unmatched input reaches it rather than
falling through to a default bucket. A wrong confident guess corrupts every
report downstream; an unclassified expense is a prompt for the user to decide.

**Refunds keep their original category as negative amounts.** A grocery refund
is negative `GROCERIES`, not `INCOME`. `INCOME` is reserved for money that was
never an expense. Category totals are therefore net, which is what the reports
show — and every aggregation must handle negatives rather than `abs()`-ing or
filtering them out.

---

## 6. Query: filtering and sorting

### Filters

All optional, all combining with AND semantics.

| Param | Type | Semantics |
| --- | --- | --- |
| `category` | repeated enum | OR within the param, AND against others |
| `from` / `to` | date | **Half-open `[from, to)`** |
| `merchant` | string | Case-insensitive substring |
| `q` | string | Case-insensitive substring over description |
| `minAmount` / `maxAmount` | decimal string | Compared against signed amount |

Half-open ranges are not a detail. `[2026-01-01, 2026-02-01)` is January with
no possibility of double-counting the boundary day into February.

### Sorting and pagination

`sort=field,dir` over `occurredOn` · `amountMinor` · `merchant` · `category`.
Default `occurredOn,desc`.

Amount sorting operates on the stored integer, not a converted `BigDecimal`.

**Every sort gets a deterministic tiebreaker** — `id` ascending, appended
automatically. Without it, a page of identical amounts will drop and duplicate
rows across page boundaries, and the bug appears only on real data.

Pagination is `page` + `size` (default 50, max 200) with a total count. No
endpoint returns an unbounded result set.

---

## 7. Reporting and charts

Three reports, each returning pre-aggregated buckets.

| Report | Endpoint | Chart |
| --- | --- | --- |
| Category breakdown | `/reports/by-category` | Donut, with a ranked legend carrying values |
| Spend over time | `/reports/over-time` | Bar (discrete periods) or line (trend) |
| Period comparison | `/reports/compare` | Grouped bar, current vs. prior |

### Response shape

```json
{
  "period": { "from": "2026-01-01", "to": "2026-02-01" },
  "currency": "USD",
  "total": "1842.55",
  "buckets": [
    { "key": "GROCERIES", "label": "Groceries", "total": "612.40" },
    { "key": "DINING",    "label": "Dining",    "total": "238.15" }
  ]
}
```

### Rules

**Aggregate in `BigDecimal`, round once** at the presentation boundary —
`RoundingMode.HALF_UP`, scale 2. Rounding during accumulation loses value in
proportion to expense count, and the loss is invisible until someone reconciles
against a bank statement.

**Buckets may be negative.** A category with more refunds than spending in a
period nets negative. Charts must render this rather than clamping at zero — a
donut cannot show a negative slice, so the category breakdown surfaces such
categories in the legend with their real value and excludes them from the arc.

**Empty periods return an empty bucket array, not 404.** "No spending in March"
is a valid answer and the client renders an empty state.

**Time buckets are contiguous.** A month with no expenses appears with total
`"0.00"` rather than being omitted, so the x-axis has no invisible gaps.

---

## 8. API surface

Base path `/api/v1`. Money crosses the wire as a **decimal string**, never a
JSON number — a JSON number is a float on arrival and reintroduces exactly the
precision problem the backend exists to avoid.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/expenses` | List with filters, sort, pagination (§6) |
| `POST` | `/expenses` | Create; runs classification |
| `GET` | `/expenses/{id}` | Fetch one, with classification history |
| `PATCH` | `/expenses/{id}` | Partial update; re-runs classification if text changed |
| `DELETE` | `/expenses/{id}` | Delete |
| `POST` | `/expenses/{id}/classification` | Manual reclassify; appends a record |
| `GET` | `/categories` | Taxonomy with display labels — the client never hardcodes it |
| `GET` | `/reports/by-category` | §7 |
| `GET` | `/reports/over-time` | §7, takes `bucket=day\|week\|month` |
| `GET` | `/reports/compare` | §7, takes two periods |

**Errors** are RFC 7807 `application/problem+json` with a machine-readable
`type`, a human `detail`, and field-level violations for 400s. The client
surfaces `detail` inline against the offending field rather than in a toast.

---

## 9. Open decisions

Each needs an answer before the affected work starts.

**9.1 — Desktop strategy. RESOLVED.** Option A, React Native Web via Expo. See
§2. Issue #3 updated.

**9.2 — Authentication.** Deferred on a single-user assumption. If the API is
ever reachable off-device this is blocking, and it touches every endpoint.
*Recommendation: decide now, implement when first deployed.*

**9.3 — Multi-user.** The model has no owner column. *Recommendation: confirm
single-user for v1 explicitly; adding tenancy after reporting exists is a
migration across every table and every query.*

**9.4 — Offline behavior.** Mobile expense entry without connectivity is a
reasonable expectation and a large piece of work (local store, queue, conflict
resolution). *Recommendation: out of scope for v1, stated in the README so it
reads as a decision rather than an oversight.*

**9.5 — Charting library. FOLDED INTO #3.** Now that 9.1 is Option A, React
Native Web support is a hard requirement rather than a preference. Evaluate two,
verify on the web target, decide in issue #3's PR, record the reasoning.

**9.6 — Currency.** Stored per-expense but unenforced. *Recommendation: reject
mixed currencies at the API boundary in v1 so the assumption is explicit rather
than implied.*

---

## 10. Non-functional requirements

**Money correctness is the top-priority quality attribute.** No `float` or
`double` in any money path, including intermediates. `BigDecimal` comparison
uses `compareTo`, never `equals` — `2.50` and `2.5` are unequal under `equals`
and that difference will pass code review. The
[`money-safety-auditor`](../.claude/agents/money-safety-auditor.md) subagent
exists to check this.

**Performance targets [A]** at 50,000 expenses — a decade of personal
spending: filtered list p95 under 300ms; any report p95 under 500ms. No N+1
queries in the expense or report path.

**Accessibility:** charts are never the only representation of their data.
Every chart pairs with an accessible table or legend carrying the same values.
Category color is supported by label or pattern, never carrying meaning alone.

**Testing:** classification has a case per category plus negative-amount
coverage; pagination has a stable-sort test using a page of identical amounts;
reporting has a test proving results are unchanged after a reclassification.

---

## 11. Delivery plan

Mapped to the existing [board](https://github.com/users/DuaneRontos/projects/2).

| Phase | Issues | Gate |
| --- | --- | --- |
| **0 — Foundations** | [#2](../../issues/2) [#3](../../issues/3) [#4](../../issues/4) | Both modules build in CI; frontend runs on iOS, Android, and web |
| **1 — Domain** | [#5](../../issues/5) [#6](../../issues/6) [#7](../../issues/7) [#8](../../issues/8) [#9](../../issues/9) | Classification correct on the full category matrix, refunds included |
| **2 — Query** | [#10](../../issues/10) [#11](../../issues/11) | Filters compose; pagination stable under duplicate sort keys |
| **3 — Reporting** | [#12](../../issues/12) | All three reports; totals reconcile against a filtered list sum |
| **4 — Client** | [#13](../../issues/13) [#14](../../issues/14) [#15](../../issues/15) [#16](../../issues/16) | Runs on iOS, Android, and desktop web |
| **5 — Agentic** | [#17](../../issues/17) [#18](../../issues/18) [#19](../../issues/19) [#20](../../issues/20) | Skills and subagents documented and exercised |

Phases 1–3 are strictly ordered; each depends on the correctness of the one
before. Phase 4 can start against a mocked API once §8 is frozen, and phase 5
runs alongside from phase 1 onward.
