-- Report a problem on a puzzle (puzzle-reports.js). The game sends the
-- player's words (also an ordinary problem in `feedback`, topic 'puzzle') and
-- the puzzle itself, under a tracking id shown to the player (PZ-XXXXXXXX).
-- The puzzle doctor (scripts/puzzle-doctor.mjs, run by the GitHub Action
-- puzzle-reports.yml) checks it with the game's engine and rebuilds it when it
-- can. Nothing here identifies the player: a player who asked to be emailed is
-- linked only through the held email in feedback_replies.
--   status    new (waiting for the doctor), checking, repaired, no_fault
--             (nothing wrong found: the team looks) or needs_fix (wrong, but
--             today's engine cannot rebuild it: a code fix is needed, then Retry)
--   findings  JSON list of { code, text }: what the doctor found, in plain words
--   repaired  the rebuilt puzzle, kept 30 days for the link in the email
--   token     the secret in that link (thelogicgrid.com/?repaired=<token>)
-- Reports go after 90 days (upkeep.js).
CREATE TABLE IF NOT EXISTS puzzle_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking    TEXT NOT NULL UNIQUE,
  feedback_id INTEGER,
  puzzle      TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  tier        TEXT NOT NULL DEFAULT '',
  theme       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new',
  findings    TEXT,
  note        TEXT,
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
CREATE INDEX IF NOT EXISTS puzzle_reports_feedback ON puzzle_reports (feedback_id);

-- The repaired-puzzle email (kind problem_repaired) carries what the doctor
-- found, in plain words, and the link to get the repaired puzzle. Removed
-- with the address once sent.
ALTER TABLE feedback_replies ADD COLUMN explain TEXT;
ALTER TABLE feedback_replies ADD COLUMN link TEXT;
