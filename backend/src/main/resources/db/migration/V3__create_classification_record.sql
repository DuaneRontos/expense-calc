-- ClassificationRecord. Spec §4.
--
-- Append-only: changing an expense's category writes a new row and leaves the
-- previous one intact. The current category is the latest row for an expense,
-- which is why there is no category column on expense itself.
--
-- category reuses the native expense_category type from V2 rather than a
-- varchar, so the taxonomy stays closed at the database level. source gets the
-- same treatment for the same reason: a closed set is better spelled as a type
-- than as a string somebody can typo. Both carry V2's cost — Postgres has no
-- ALTER TYPE ... DROP VALUE — and V2 documents the two traps that come with
-- adding a value later.

CREATE TYPE classification_source AS ENUM ('RULE_ENGINE', 'USER', 'IMPORT');

CREATE TABLE classification_record (
    id          UUID                  PRIMARY KEY,
    expense_id  UUID                  NOT NULL REFERENCES expense (id) ON DELETE CASCADE,
    category    expense_category      NOT NULL,
    source      classification_source NOT NULL,
    reason      VARCHAR(200)          NOT NULL,
    recorded_at TIMESTAMPTZ           NOT NULL
);

-- Spec §4 asks for (expense_id, recorded_at DESC): the current-category read
-- happens on every list and every report, so it must not table-scan.
--
-- id DESC is appended as a tiebreaker. TIMESTAMPTZ is microsecond-resolution
-- and a reclassification can land in the same microsecond as the record it
-- replaces — most easily in a test, which is where an arbitrary winner would
-- first make a suite flaky. The winner between same-instant rows is arbitrary
-- but *stable*, which is what reproducibility needs; if genuine ordering
-- within an instant ever matters, that wants a monotonic sequence column
-- rather than a different tiebreaker.
CREATE INDEX idx_classification_record_expense_recorded
    ON classification_record (expense_id, recorded_at DESC, id DESC);

-- Append-only, enforced by the database rather than by convention, so it holds
-- for psql and future services too and not only for code that goes through the
-- ORM.
--
-- UPDATE only, deliberately. DELETE has to stay available because expense_id
-- cascades and spec §8 has DELETE /expenses/{id}: a blanket ban would make
-- deleting an expense fail. That leaves a direct DELETE as a way to rewrite
-- history, which this does not close — the overwrite it does close is the one
-- that happens by accident, from a service calling save() on a loaded record.
CREATE OR REPLACE FUNCTION reject_classification_record_update() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'classification_record is append-only (spec §4): % rejected on row %. Correct a category by appending a new record, not by editing this one.',
        TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER classification_record_append_only
    BEFORE UPDATE ON classification_record
    FOR EACH ROW EXECUTE FUNCTION reject_classification_record_update();
