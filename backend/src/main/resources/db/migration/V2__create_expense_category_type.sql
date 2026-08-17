-- The closed expense taxonomy as a Postgres enum type.
-- Mirrors com.duanerontos.expensecalc.expense.Category and
-- .claude/skills/expense-classification/SKILL.md.
--
-- A native enum type rather than VARCHAR + CHECK because the taxonomy is meant
-- to be closed at the database level: spec §4 states that adding a category is
-- a schema change with a defined destination for every existing expense, and
-- ALTER TYPE ... ADD VALUE makes that an explicit, reviewable migration step.
--
-- This is the opposite call from currency in V1, which deliberately has no
-- CHECK constraint. The intents differ: spec §9.6 wants v2 multi-currency to be
-- a validation-only change, whereas a new category is supposed to be a
-- migration. Same-looking decision, opposite reasoning.
--
-- Declaration order matters. Postgres orders enum values by declaration, so
-- this is what ORDER BY category yields — the taxonomy's own order, essentials
-- first, rather than alphabetical. CategoryTypeTest asserts this list stays
-- identical to the Java enum, in order.
--
-- No column uses this type yet. It lands with classification_record in #9;
-- category is not a column on expense, because the current category is derived
-- from the latest classification record so that reclassifying cannot rewrite
-- historical reports (spec §4).

CREATE TYPE expense_category AS ENUM (
    'HOUSING',
    'UTILITIES',
    'GROCERIES',
    'DINING',
    'TRANSPORT',
    'MAINTENANCE',
    'HEALTH',
    'DISCRETIONARY',
    'CAPITAL',
    'INCOME',
    'UNCLASSIFIED'
);
