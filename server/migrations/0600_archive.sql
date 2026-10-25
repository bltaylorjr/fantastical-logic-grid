-- The weekly archive (src/archive.js): old rows the game no longer needs are
-- zipped, emailed to the owner and then removed. One row per weekly run (or
-- run from the dashboard). Kept for a year by the daily cleanup.
CREATE TABLE IF NOT EXISTS archive_log (
  ran_at  INTEGER PRIMARY KEY,
  trigger TEXT NOT NULL,          -- weekly or the admin who ran it
  status  TEXT NOT NULL,          -- sent, empty, off, not_set_up, failed
  rows    TEXT NOT NULL,          -- JSON { table: rows in the zip }
  bytes   INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0, -- 1 when the rows were removed after sending
  message TEXT
);
