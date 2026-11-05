-- Report a Problem, part two (server/PUZZLE-REPORTS.md):
--
-- report_files: pictures and files a player attaches to a report on the
-- Report a Problem page (web/report/). Up to 3 per report, each at most 1 MB.
-- Pictures are re-drawn by the player's browser before sending, which drops
-- hidden details such as where a photo was taken. The Worker checks each
-- file's first bytes and keeps only PNG, JPEG, WebP, GIF, PDF and plain text
-- (txt, log, json, csv); the type is decided here, never taken from the
-- player. Only the admin dashboard can open them, always as a download or a
-- picture, never as a page. Removed after 90 days (upkeep.js).
CREATE TABLE IF NOT EXISTS report_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL,
  tracking   TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_files_report ON report_files (report_id);
CREATE INDEX IF NOT EXISTS report_files_created ON report_files (created_at);

-- error_log: the errors database. One row for every step a report goes
-- through, from the moment the player submits it: received, files attached,
-- the doctor called, its review, its repair (or why it could not), the
-- report sent to the admins, the player emailed, closed by a code fix or by
-- the team. The admin Error tracking page shows it as each report's timeline
-- and as the latest-events list. Nothing personal: never the player's words
-- or email, only the tracking id and plain-language details.
--   event   received, files, doctor_called, doctor_waiting, reviewed,
--           repaired, needs_fix, no_fault, display, closed, done, alerted
--   status  the report's status after this step
--   detail  one plain sentence
CREATE TABLE IF NOT EXISTS error_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER,
  tracking   TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS error_log_report ON error_log (report_id, id);
CREATE INDEX IF NOT EXISTS error_log_created ON error_log (created_at);

-- How many files a report has, so lists need not count them.
ALTER TABLE puzzle_reports ADD COLUMN files INTEGER NOT NULL DEFAULT 0;
