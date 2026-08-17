-- Expense table. Spec §4.
--
-- amount_minor is signed centavos: negative is a refund, which per spec §5
-- keeps the category of what it refunds. Do not add a NOT NULL CHECK forcing
-- it positive.
--
-- There is deliberately no category column. The current category is derived
-- from the latest classification_record (#9) so that reclassifying an expense
-- does not rewrite historical report output.
--
-- There is also deliberately no CHECK (currency = 'PHP'). Spec §9.6 wants v2
-- multi-currency to be a validation change plus a conversion service rather
-- than a schema migration; a constraint here would make it both. The rule is
-- enforced in Money.requireSupportedCurrency before persistence.

CREATE TABLE expense (
    id           UUID         PRIMARY KEY,
    amount_minor BIGINT       NOT NULL,
    currency     CHAR(3)      NOT NULL,
    occurred_on  DATE         NOT NULL,
    merchant     VARCHAR(200),
    description  TEXT,
    created_at   TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL
);

-- Default list order is occurred_on DESC with id as the tiebreaker (spec §6).
-- Including id in the index keeps that exact ordering servable without a sort,
-- and the tiebreaker is what stops rows duplicating and vanishing across pages
-- when several expenses share a date.
CREATE INDEX idx_expense_occurred_on_id ON expense (occurred_on DESC, id);
