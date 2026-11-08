-- Automatic deletion of inactive accounts, and of accounts that never chose a
-- screen name (src/inactive-accounts.js). One row per account that has been
-- warned (or is being warned) by email that it will be deleted. kind:
-- 'inactive' (no activity) or 'name' (no screen name). The row is removed with the account, and a player who comes back
-- starts a new cycle (sent_at older than their last activity counts as no
-- warning). token identifies the row to the email Action, so the Action never
-- sees account ids. unreachable = 1: the mail service refused the address, so
-- the account is deleted without a warning, like an account with no email.
CREATE TABLE IF NOT EXISTS inactive_warnings (
  user_id     TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'inactive',
  token       TEXT NOT NULL UNIQUE,
  email       TEXT,
  claimed_at  INTEGER,
  sent_at     INTEGER,
  unreachable INTEGER NOT NULL DEFAULT 0
);
