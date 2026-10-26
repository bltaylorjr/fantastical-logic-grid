-- "Addressed" marks in the admin dashboard: when a player's problem, idea or
-- error report has been fixed, the team marks it addressed with a short
-- plain-language note of what was done.
--
-- feedback.status gains a third value, 'addressed' (new, addressed or done);
-- addressed items are deleted after 180 days like done ones (upkeep.js).
ALTER TABLE feedback ADD COLUMN note TEXT;

-- Error reports are counted per day, so a fix is stored once per error
-- (message + file) with the version it shipped in. Reports from older
-- versions show as addressed; one from the fixed version or later shows that
-- the fix did not cover it.
CREATE TABLE IF NOT EXISTS error_fixes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  file       TEXT NOT NULL DEFAULT '',
  fixed_in   TEXT NOT NULL,
  note       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (message, file)
);
