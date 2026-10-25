-- Self-maintenance: anonymous error reports from the apps, and a log of the
-- daily cleanup the Worker runs on its own (src/upkeep.js).

-- One row per distinct error per day. fingerprint is a hash of the cleaned
-- message and where it happened, so repeats only raise count. Nothing
-- personal is kept: no player id, IP address, page address or saved puzzle.
CREATE TABLE IF NOT EXISTS app_errors (
  day         TEXT NOT NULL,    -- YYYY-MM-DD
  fingerprint TEXT NOT NULL,
  platform    TEXT NOT NULL,    -- web, desktop, android, ios
  version     TEXT NOT NULL,
  kind        TEXT NOT NULL,    -- error, rejection, engine
  message     TEXT NOT NULL,
  place       TEXT,             -- file:line of the first few stack frames
  count       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, fingerprint)
);

-- What each daily cleanup removed (JSON { table: rows }), so the health check
-- can tell the cleanup is still running.
CREATE TABLE IF NOT EXISTS upkeep_log (
  ran_at  INTEGER PRIMARY KEY,
  removed TEXT NOT NULL
);
