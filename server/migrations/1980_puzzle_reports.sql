-- Report a Problem (puzzle-reports.js): the button in the footer of every
-- screen of the game and every page of the website. When the report arrives it
-- is given its tracking id and its category at once:
--   category 'puzzle'        a Puzzle Problem, tracking PZ-XXXXXXXX
--   category 'webstructure'  a Web Page Issue, tracking WS-XXXXXXXX
-- Both live here, so the puzzle doctor and the admin Error tracking page can
-- use each to explain the other (related). The player's words are also an
-- ordinary problem in `feedback` (topic 'puzzle' or 'page'). Nothing here
-- identifies the player: one who asked to be emailed is linked only through
-- the held email in feedback_replies.
--   puzzle    the puzzle as the game's JSON (Puzzle Problems from the game)
--   image     the puzzle's picture as the game drew it (SVG text)
--   page      where it happened: the game screen or the website page
--   status    new (waiting for the doctor), checking, repaired, needs_fix
--             (wrong, but today's engine still gets it wrong: fixed when a
--             later engine passes the doctor's probe, or Check again),
--             no_fault (nothing wrong in the puzzle), manual (no puzzle to
--             check: the team looks), page (a Web Page Issue), done
--   findings  JSON [{ code, text }]: the reason for failure, in plain words
--   note      the correction made, in plain words
--   strategy  which rebuild worked (puzzle-doctor.mjs STRATEGIES)
--   related   JSON tracking ids of reports in the other category that point
--             at the same screen and app version
-- Reports go after 365 days (the learning table keeps their counts); repaired
-- copies after 30.
CREATE TABLE IF NOT EXISTS puzzle_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking    TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL DEFAULT 'puzzle',
  feedback_id INTEGER,
  puzzle      TEXT,
  image       TEXT,
  title       TEXT NOT NULL DEFAULT '',
  tier        TEXT NOT NULL DEFAULT '',
  theme       TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '',
  page        TEXT NOT NULL DEFAULT '',
  screen      TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new',
  findings    TEXT,
  note        TEXT,
  strategy    TEXT,
  related     TEXT,
  repaired    TEXT,
  token       TEXT UNIQUE,
  engine      TEXT,
  tries       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  claimed_at  INTEGER,
  checked_at  INTEGER,
  repaired_at INTEGER,
  opened_at   INTEGER
);
CREATE INDEX IF NOT EXISTS puzzle_reports_status ON puzzle_reports (status, created_at);
CREATE INDEX IF NOT EXISTS puzzle_reports_category ON puzzle_reports (category, created_at);
CREATE INDEX IF NOT EXISTS puzzle_reports_feedback ON puzzle_reports (feedback_id);
CREATE INDEX IF NOT EXISTS puzzle_reports_where ON puzzle_reports (page, version);

-- What the doctor has learned, for both categories. One row per kind of fault:
--   puzzle        key = fault code | theme | difficulty (for example false_clue|cooking|hard)
--   webstructure  key = page | app version (for example Puzzle screen|1.9.0)
-- seen / repaired / needs_fix count reports; strategies is JSON
-- { name: { tried, worked } } so the doctor tries the best rebuild first
-- (playbook); clue_types counts which clue types were false; the probe_*
-- columns record the doctor's self-diagnosis: fresh puzzles made like the faulty
-- ones with the newest engine, and how many still had the fault. When a probe
-- with a newer engine finds no fault, the waiting needs_fix reports go back to
-- the doctor and are repaired and emailed automatically.
CREATE TABLE IF NOT EXISTS fault_patterns (
  key           TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  code          TEXT NOT NULL,
  theme         TEXT NOT NULL DEFAULT '',
  tier          TEXT NOT NULL DEFAULT '',
  size          TEXT NOT NULL DEFAULT '',
  page          TEXT NOT NULL DEFAULT '',
  version       TEXT NOT NULL DEFAULT '',
  seen          INTEGER NOT NULL DEFAULT 0,
  repaired      INTEGER NOT NULL DEFAULT 0,
  needs_fix     INTEGER NOT NULL DEFAULT 0,
  strategies    TEXT NOT NULL DEFAULT '{}',
  clue_types    TEXT NOT NULL DEFAULT '{}',
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  last_engine   TEXT NOT NULL DEFAULT '',
  last_tracking TEXT NOT NULL DEFAULT '',
  probe_engine  TEXT,
  probe_at      INTEGER,
  probe_tested  INTEGER,
  probe_faults  INTEGER,
  resolved_at   INTEGER
);
CREATE INDEX IF NOT EXISTS fault_patterns_category ON fault_patterns (category, last_seen);

-- The repaired-puzzle email (kind problem_repaired) carries what the doctor
-- found, in plain words, and the link to get the repaired puzzle. Removed
-- with the address once sent.
ALTER TABLE feedback_replies ADD COLUMN explain TEXT;
ALTER TABLE feedback_replies ADD COLUMN link TEXT;
