-- The closed expense taxonomy as a Postgres enum type.
-- Mirrors com.duanerontos.expensecalc.expense.Category and
-- .claude/skills/expense-classification/SKILL.md.
--
-- A native enum type rather than VARCHAR + CHECK because the taxonomy is meant
-- to be closed at the database level: spec §4 states that adding a category is
-- a schema change with a defined destination for every existing expense, and
-- ALTER TYPE ... ADD VALUE makes that an explicit, reviewable migration step.
--
-- The cost of that choice, recorded honestly: Postgres has no
-- ALTER TYPE ... DROP VALUE. Retiring a category means creating a replacement
-- type, rewriting every dependent column, and dropping the old one. Removals
-- are meant to be rare, so that is an acceptable trade — but it is a real one.
--
-- ---------------------------------------------------------------------------
-- ADDING A CATEGORY LATER — two traps, both of which produce working-looking
-- code that is wrong.
--
-- 1. The value and its backfill must be SEPARATE versioned migrations.
--    Flyway wraps each migration in a transaction, and Postgres refuses to let
--    a newly added enum value be *used* in the transaction that added it:
--
--        ALTER TYPE expense_category ADD VALUE 'DELIVERY';
--        UPDATE classification_record SET category = 'DELIVERY' WHERE ...;
--        -- ERROR: unsafe use of new value "DELIVERY" of enum type
--
--    Splitting DINING into DINING + DELIVERY is the ordinary shape of a
--    taxonomy change, and "a defined destination for every existing expense"
--    is exactly what spec §4 asks for — so the failing case is the intended
--    workflow, not an exotic one. Vn adds the value, Vn+1 backfills.
--
-- 2. ADD VALUE appends unless told otherwise, and order is load-bearing here.
--    A bare ADD VALUE 'EDUCATION' sorts after UNCLASSIFIED, putting the
--    catch-all mid-list and the new category last in every report and picker.
--    Give new values an explicit position:
--
--        ALTER TYPE expense_category ADD VALUE 'EDUCATION' BEFORE 'INCOME';
--
--    CategoryTypeTest catches a Java/Postgres mismatch, but note the trap in
--    the fix it invites: appending to the Java enum as well turns the test
--    green while both orderings are wrong.
-- ---------------------------------------------------------------------------
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
