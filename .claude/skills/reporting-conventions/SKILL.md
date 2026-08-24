---
name: reporting-conventions
description: The report contract for this expense calculator's three chart endpoints — bucket shape, half-open periods, where rounding happens, empty/zero-filled buckets, and the backend-owns-aggregation rule. Use when adding or changing report endpoints, building chart or dashboard features, or reviewing reporting/aggregation code.
---

# Reporting and chart conventions

Three reports, each returning pre-aggregated buckets. The backend owns all
aggregation — the client never sums a list of raw expenses.

## Endpoints

| Report | Endpoint | Chart | Bucket key |
| --- | --- | --- | --- |
| Category breakdown | `/api/v1/reports/by-category` | Donut, ranked legend with values | Category enum name |
| Spend over time | `/api/v1/reports/over-time?bucket=day\|week\|month` | Bar (discrete) or line (trend) | ISO date of the bucket's first day |
| Period comparison | `/api/v1/reports/compare` | Grouped bar, current vs. prior | Category enum name |

All three take optional `from`/`to` (ISO dates, half-open); both or neither —
one bound alone has two plausible readings and there is no correct default for
just the other.

## Response shape

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

Every bucket carries `key` (what the client sorts/groups/colours on), `label`
(server-supplied display string — the client never hardcodes the taxonomy or a
date format), and `total` as a **decimal string**, never a JSON number. A JSON
number is a double on arrival in JavaScript and reintroduces the precision
problem the integer storage exists to avoid, at the point it's hardest to see.

`compare` buckets carry `current`, `previous`, and `change` instead of a single
`total` — `change` is `current − previous`, deliberately absolute rather than a
percentage: every category that was zero last period has a zero denominator,
and with signed amounts a category can cross from negative to positive, where a
ratio is worse than undefined.

## Rules

**Aggregate as signed integers (minor units), convert to decimal once, at the
presentation boundary.** Summing centavos is exact by construction — no scale
to drift, no rounding mode to get wrong mid-accumulation. `RoundingMode.HALF_UP`
at scale 2 only becomes relevant the moment something divides — a
percentage-of-total, say — and that conversion should happen where it's
computed, not preemptively on every bucket.

**Totals and buckets may be negative. Never `abs()`, clamp, or filter.** A
category with more refunds than spending in a period nets below zero, and a
period with a salary recorded can turn a headline "category breakdown" total
negative — `total` is net cash flow including `INCOME`, not just spending. A
donut can't draw a negative slice; that's a rendering decision for the client
(surface the category in the legend with its real value, exclude it from the
arc), not a reason for the backend to hide or reshape the number.

**Empty periods return `200` with an empty bucket array, not `404`.** "No
spending in March" is a valid answer and the client renders an empty state for
it.

**`over-time` buckets are contiguous and zero-filled — never omit an empty
slice.** A month with no expenses appears with total `"0.00"`. Omitting it lets
a line chart draw a straight line between two points that are actually three
months apart, which reads as a trend that didn't happen. Zero-filling is
bounded: a request whose window would produce more than 1000 slices at the
requested granularity is a `400`, not a multi-megabyte response — the width
limit exists precisely because zero-filling makes response size a function of
the window asked for, not the data in it.

**Periods are half-open, `[from, to)`, and resolved against `Asia/Manila`,
never UTC or host default.** A closed range double-counts the boundary day
across two adjacent reports; a UTC-derived "this month" reports the wrong month
for eight hours a day.

**`compare` takes one period and derives the other — never two arbitrary
windows.** The prior period is calendar-aware when the current one is a whole
number of calendar months (so March compares against February, not against a
31-day window ending at February's end) and equal-length otherwise (so "last 30
days" compares against the 30 days before that). The comparison is the union of
both periods' categories, not the intersection — a category spent on only last
month still appears, at `"0.00"` on the side it's missing from, because that
disappearance is exactly what the report exists to show.

**Charts consume server-shaped buckets only — no client-side aggregation, no
parallel grouping logic.** If a chart needs a total the current endpoints
don't return, that's a backend change, not a client-side sum over a list
fetched some other way.

## When reviewing reporting code

- No aggregation calls `.abs()`, filters negatives, or clamps a total to zero.
- A period with no matching expenses returns `200` with `buckets: []`, not an
  error.
- `over-time` fills every slice in the window, including zero-total ones, and
  still enforces a bucket-count cap on the request.
- Every amount crosses the API boundary as a decimal string, never a bare JSON
  number.
- Date/period math uses `Asia/Manila`, not the host zone or UTC, and periods
  stay half-open.
- `compare`'s prior-period derivation is tested for both a whole-calendar-month
  input and a non-calendar (e.g. "last N days") input — they take different
  branches and one regressing doesn't fail the other's tests.
- Bucket `key` matches what the client actually needs to sort/group on (enum
  name for category-keyed reports, ISO date for `over-time`) — not a
  human-readable label doing double duty.
- A chart-facing change adds or reads a report endpoint; it doesn't reach for
  the expense list and sum client-side.
