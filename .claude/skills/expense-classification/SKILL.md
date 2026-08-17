---
name: expense-classification
description: The category taxonomy and classification rules for this expense calculator. Use when adding or changing expense categories, writing or reviewing classification logic, building report groupings, or deciding which bucket an expense belongs in.
---

# Expense classification

The taxonomy is closed. Adding a category is a schema change plus a migration,
not a one-line enum edit — every existing expense needs a defined destination.

## Categories

| Category | Covers | Not this |
| --- | --- | --- |
| `HOUSING` | Rent, mortgage, property tax, home insurance | Repairs → `MAINTENANCE` |
| `UTILITIES` | Power, water, gas, internet, phone | Streaming → `DISCRETIONARY` |
| `GROCERIES` | Food and household consumables bought to use at home | Restaurant meals → `DINING` |
| `DINING` | Restaurants, cafes, delivery, bars | Groceries → `GROCERIES` |
| `TRANSPORT` | Fuel, transit, rideshare, parking, tolls | Vehicle repair → `MAINTENANCE` |
| `MAINTENANCE` | Repairs and upkeep of anything owned | Improvements that add value → `CAPITAL` |
| `HEALTH` | Medical, dental, pharmacy, insurance premiums | Gym → `DISCRETIONARY` |
| `DISCRETIONARY` | Entertainment, hobbies, subscriptions, gifts | — |
| `CAPITAL` | Purchases that hold value past the period | Consumables → the fitting category |
| `INCOME` | Money in that was never an expense — salary, reimbursements | Refunds → the category being refunded, as a negative amount |
| `UNCLASSIFIED` | Nothing matched | — |

## Rules

**`UNCLASSIFIED` is a real state, not a failure.** Never guess a category to
avoid it. An expense sitting in `UNCLASSIFIED` is a prompt for the user to
decide; a wrong confident guess silently corrupts every report that follows.

**Classification runs on merchant, then description, then amount — in that
order, first match wins.** Amount alone never determines a category; it only
disambiguates between candidates that already matched on text.

**Rules are ordered and the order is load-bearing.** A more specific rule must
precede a more general one. When adding a rule, add a test that fails without
it and a test that proves it didn't capture something the previous rule owned.

**Refunds keep the category of what they refund.** A grocery refund is a
negative `GROCERIES` amount, not `INCOME`. `INCOME` is reserved for money that
was never an expense. This keeps category totals net rather than gross, which
is what the reports show.

**Reclassification is an event, not an overwrite.** Changing an expense's
category writes a new classification record with the reason and leaves the
prior one intact — reports run over historical periods must stay reproducible.

## When reviewing classification code

- Every category in the table above has at least one test case.
- `UNCLASSIFIED` has a test proving unmatched input reaches it rather than
  falling through to a default bucket.
- Negative amounts have coverage in every category that can receive a refund.
- No rule matches on amount alone.
- Report grouping uses the same enum as classification — no parallel string
  taxonomy anywhere in the reporting path.
