# Expense Calculator — Specification

**Version** 0.2 · **Status** Nothing implemented · **Decisions** all six resolved

This spec is written forward from the domain, not derived from existing code —
at time of writing the repository contains no `backend/` or `frontend/` source.
Conventions referenced here are already committed in [`CLAUDE.md`](../CLAUDE.md)
and [`.claude/skills/expense-classification/SKILL.md`](../.claude/skills/expense-classification/SKILL.md);
this document is the layer above them.

Remaining assumptions are marked **[A]**. Decisions are collected in §9 — all
six are resolved as of v0.2.

---

## 1. Purpose and scope

An expense calculator that records spending, classifies it into a fixed
taxonomy, lets the user query it by any dimension, and turns the result into
analytical reports with charts.

**Primary user: one person.** Confirmed single-user for v1. The data model
carries no tenant or owner column, and that is a decision rather than an
omission — see §9.3 for what changing it later costs.

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

**Auth: JWT, built at first deployment.** Decided now, implemented when the
API first leaves localhost — see §9.2 for the mechanism and the safety rule
that keeps the local-dev bypass from ever reaching production.

---

## 4. Domain model

### Expense

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Server-generated |
| `amountMinor` | `BIGINT` | **Minor units** (centavos). Signed — negative means refund. |
| `currency` | `CHAR(3)` | ISO 4217, always `PHP` in v1. Stored so v2 isn't a migration. |
| `occurredOn` | `LocalDate` | The date the money moved, user-supplied |
| `merchant` | `VARCHAR(200)` | Nullable |
| `description` | `TEXT` | Nullable |
| `createdAt` / `updatedAt` | `Instant` | Audit, server-set |

Amounts are stored as integers and exposed as `BigDecimal` at the service
boundary. Summation stays exact and scale never drifts across a large set.

The current category is **not** a column — it is derived from the latest
`ClassificationRecord` (§4.2).

### Currency and locale

**v1 is Philippine Peso only.** `PHP` has a two-decimal minor unit (centavo),
so `amountMinor` is centavos and the existing integer model needs no change.

- **Validation:** any expense whose `currency` is not `PHP` is rejected at the
  API boundary with a 400. Mixed currencies never enter the database, so no
  aggregation can silently sum across them (§9.6).
- **Formatting is the client's job.** The API returns a decimal string plus the
  ISO code; the client formats with `Intl.NumberFormat("en-PH", { style:
  "currency", currency: "PHP" })` → `₱1,234.56`. Never hardcode `₱` in the
  client — the moment v2 adds a second currency, every hardcoded symbol is a
  bug, and there will be more of them than anyone expects.
- **The peso symbol is `₱` (U+20B1)**, not `P`. Ensure the database, API, and
  client are UTF-8 end to end.

### Time zone

**Reporting periods are computed in `Asia/Manila` (UTC+8), never UTC.**

`occurredOn` is a `LocalDate` with no zone attached, so "this month" has to be
resolved against *some* zone. Resolve it against UTC and a user in Manila sees
the wrong month for eight hours a day — at 17:00 UTC on 31 January it is
already 01:00 on 1 February in Manila, and a UTC-derived "current month" would
still be reporting January.

The Philippines has observed no DST since 1978, so the offset is a constant
+08:00 and none of the usual spring-forward boundary problems apply. Pin the
zone in configuration rather than reading the server's default, so the behavior
does not change when the deployment host does.

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

Relative periods — "this month", "last 30 days" — resolve against
`Asia/Manila`, not the server's zone (§4).

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
  "currency": "PHP",
  "total": "48250.75",
  "buckets": [
    { "key": "GROCERIES", "label": "Groceries", "total": "18420.00" },
    { "key": "DINING",    "label": "Dining",    "total": "6135.50" }
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

**9.2 — Authentication. RESOLVED — JWT, implemented at first deployment.**

Mechanism: short-lived access token (15 min) plus a rotating refresh token,
credentials verified against an Argon2id hash, issued by Spring Security. This
keeps the API stateless as §3 requires, works identically on iOS, Android, and
web, and avoids taking a third-party identity provider as a dependency for a
single-user application.

Token storage is where this goes wrong in practice, so it is specified rather
than left to the implementer:

| Target | Access token | Refresh token |
| --- | --- | --- |
| iOS / Android | In memory | Expo SecureStore (Keychain / Keystore) |
| Web | In memory only | `httpOnly; Secure; SameSite=Strict` cookie |

**Never `localStorage`.** A token in `localStorage` is readable by any script
that achieves XSS, and "we don't have XSS" is a claim with a poor track record.

**The local-dev bypass must be impossible to deploy.** Development runs
permit-all behind a Spring profile, and the production build fails to start if
that profile is active. A dev bypass that ships is a total authentication
bypass, and it is a well-worn way to lose a database.

**9.3 — Multi-user. RESOLVED — single-user for v1.**

Confirmed explicitly. No owner or tenant column. Recorded here so that adding
tenancy in v2 is understood as what it is: a migration across every table plus
a predicate on every query and every report aggregation, not a column addition.

**9.4 — Offline behavior. RESOLVED — deferred to v2.**

Out of scope for v1, planned for a future version. The work is a local store, a
mutation queue, and conflict resolution for edits made on two devices while
partitioned — comparable in size to the entire query layer. Stated in the
README so it reads as a decision rather than an oversight.

**9.5 — Charting library. FOLDED INTO #3.** Now that 9.1 is Option A, React
Native Web support is a hard requirement rather than a preference. Evaluate two,
verify on the web target, decide in issue #3's PR, record the reasoning.

**9.6 — Currency. RESOLVED — `PHP` only, enforced at the API boundary.**

Philippine Peso for v1. Any expense with a `currency` other than `PHP` is
rejected with a 400 before it reaches the database, so no aggregation can sum
across currencies. Details, including the `Asia/Manila` reporting-period rule,
are in §4.

The column stays in the schema so a v2 multi-currency feature is a validation
change and a conversion service, not a migration.

---

**All six decisions are resolved.** New questions get appended here with the
same numbering rather than being settled in a PR comment.

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

**Security:** TLS everywhere once deployed. Tokens stored per the table in
§9.2 — never `localStorage`. The dev auth bypass is profile-gated and the
production build refuses to start with that profile active.

**Testing:** classification has a case per category plus negative-amount
coverage; pagination has a stable-sort test using a page of identical amounts;
reporting has a test proving results are unchanged after a reclassification;
currency validation has a test proving a non-`PHP` expense is rejected before
persistence, not after.

---

## 11. Delivery plan

Mapped to the existing [board](https://github.com/users/DuaneRontos/projects/2).

| Phase | Issues | Gate |
| --- | --- | --- |
| **0 — Foundations** | [#2](https://github.com/DuaneRontos/expense-calc/issues/2) [#3](https://github.com/DuaneRontos/expense-calc/issues/3) [#4](https://github.com/DuaneRontos/expense-calc/issues/4) | Both modules build in CI; frontend runs on iOS, Android, and web |
| **1 — Domain** | [#5](https://github.com/DuaneRontos/expense-calc/issues/5) [#6](https://github.com/DuaneRontos/expense-calc/issues/6) [#7](https://github.com/DuaneRontos/expense-calc/issues/7) [#8](https://github.com/DuaneRontos/expense-calc/issues/8) [#9](https://github.com/DuaneRontos/expense-calc/issues/9) | Classification correct on the full category matrix, refunds included |
| **2 — Query** | [#10](https://github.com/DuaneRontos/expense-calc/issues/10) [#11](https://github.com/DuaneRontos/expense-calc/issues/11) | Filters compose; pagination stable under duplicate sort keys |
| **3 — Reporting** | [#12](https://github.com/DuaneRontos/expense-calc/issues/12) | All three reports; totals reconcile against a filtered list sum |
| **4 — Client** | [#13](https://github.com/DuaneRontos/expense-calc/issues/13) [#14](https://github.com/DuaneRontos/expense-calc/issues/14) [#15](https://github.com/DuaneRontos/expense-calc/issues/15) [#16](https://github.com/DuaneRontos/expense-calc/issues/16) | Runs on iOS, Android, and desktop web |
| **5 — Agentic** | [#17](https://github.com/DuaneRontos/expense-calc/issues/17) [#18](https://github.com/DuaneRontos/expense-calc/issues/18) [#19](https://github.com/DuaneRontos/expense-calc/issues/19) [#20](https://github.com/DuaneRontos/expense-calc/issues/20) | Skills and subagents documented and exercised |

Phases 1–3 are strictly ordered; each depends on the correctness of the one
before. Phase 4 can start against a mocked API once §8 is frozen, and phase 5
runs alongside from phase 1 onward.
