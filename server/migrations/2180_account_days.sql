-- Accounts made and deleted each day (admin Overview and Accounts details), as
-- counts only. sync_users loses an account's row when it is deleted, and the
-- list of deleted accounts is cleared after 30 days (upkeep.js), so counting
-- from those tables made new accounts shrink after the fact. These daily
-- totals stay put; nothing in them can be tied to anyone. Kept 400 days.
--   day      the UTC day (YYYY-MM-DD)
--   made     accounts made that day (first saved to the server, sync.js)
--   deleted  accounts deleted that day, by the player or by an admin
CREATE TABLE IF NOT EXISTS account_days (
  day TEXT PRIMARY KEY,
  made INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);

-- Start from what is still known: the accounts there are now, by the day they
-- were made, and the deletions of the last 30 days. Accounts deleted before
-- this table existed cannot be added back to the day they were made.
INSERT INTO account_days (day, made, deleted)
  SELECT date(created_at / 1000, 'unixepoch'), COUNT(*), 0 FROM sync_users GROUP BY 1
  ON CONFLICT (day) DO UPDATE SET made = excluded.made;
INSERT INTO account_days (day, made, deleted)
  SELECT date(deleted_at / 1000, 'unixepoch'), 0, COUNT(*) FROM sync_deleted_users GROUP BY 1
  ON CONFLICT (day) DO UPDATE SET deleted = excluded.deleted;
