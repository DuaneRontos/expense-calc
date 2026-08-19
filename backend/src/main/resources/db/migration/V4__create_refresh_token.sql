-- Refresh tokens. Spec §9.2.
--
-- Stored so rotation can invalidate the previous one: a refresh token that
-- stays valid after being exchanged is a bearer credential with no expiry in
-- practice, because anyone who captured it once can keep renewing.
--
-- token_hash, never the token. This table is the one thing in the schema whose
-- contents are directly usable as a credential, so a database backup, a log of
-- a query, or an errant SELECT must not hand someone a working session. SHA-256
-- rather than Argon2 deliberately: the token is 256 bits of CSPRNG output, not
-- a human-chosen password, so there is nothing to brute-force and no reason to
-- pay a KDF's cost on every request.
--
-- v1 is single-user (spec §9.3), so there is no owner column here either. The
-- rows are still per-session: signing in on a phone and a laptop is two rows.

CREATE TABLE refresh_token (
    id          UUID        PRIMARY KEY,
    -- VARCHAR, not CHAR(64), even though a hex SHA-256 is exactly 64 characters.
    -- Expense.currency is CHAR because spec §4 dictates CHAR(3) for ISO 4217;
    -- nothing dictates it here, and Postgres compares bpchar ignoring trailing
    -- spaces — so 'abc' and 'abc   ' are equal. For a value used as a lookup
    -- key that is a silent-match waiting for the day something trims.
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    issued_at   TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    -- Set on rotation and on logout. Kept rather than deleted so a replayed
    -- token can be told apart from one that never existed, which is the
    -- difference between "expired session" and "someone is trying tokens".
    revoked_at  TIMESTAMPTZ
);

-- Every refresh exchange looks a token up by its hash, so this must not scan.
-- UNIQUE above already creates the index; named here so the intent is visible.
COMMENT ON COLUMN refresh_token.token_hash IS 'SHA-256 of the opaque token; the token itself is never stored';
