-- Daily puzzle by email (src/daily-email.js): signed-in players with a
-- confirmed email who asked for each day's puzzle. The GitHub Action
-- .github/workflows/daily-email.yml sends it once a day. Turning it off, the
-- unsubscribe link in every email and deleting the account remove the row.
CREATE TABLE IF NOT EXISTS daily_email (
  uid        TEXT PRIMARY KEY,               -- the player's account id
  email      TEXT NOT NULL,                  -- the account's confirmed address
  token      TEXT NOT NULL UNIQUE,           -- random, for the unsubscribe link
  created_at INTEGER NOT NULL,
  last_sent  TEXT                            -- the last day (YYYY-MM-DD) sent
);
CREATE INDEX IF NOT EXISTS daily_email_sent ON daily_email (last_sent, created_at);
