-- Self-tuning with approval (server/src/tuning.js): changes the analysis
-- suggests, waiting for an admin's yes or no, then measured after they apply.
CREATE TABLE IF NOT EXISTS tuning_proposals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,              -- level, theme, max_level, tips, support_asks, undo
  target     TEXT NOT NULL,              -- nudge:effort:<tier>, nudge:theme:<id> or setting:<key>
  label      TEXT NOT NULL,              -- what changes, in plain words
  from_value TEXT,                       -- JSON, the value when it was suggested
  to_value   TEXT NOT NULL,              -- JSON
  reason     TEXT NOT NULL,              -- why, with the numbers
  watch      TEXT NOT NULL,              -- what will be measured afterwards
  baseline   TEXT,                       -- JSON numbers before the change
  status     TEXT NOT NULL DEFAULT 'waiting', -- waiting, applied, declined, expired, undone, replaced
  auto       INTEGER NOT NULL DEFAULT 0, -- 1: applied by a pre-approval rule
  undo_of    INTEGER,                    -- for kind undo: the change it takes back
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  note       TEXT,
  check_at   INTEGER,                    -- when the result is measured
  result     TEXT,                       -- JSON { verdict, text, before, after }
  checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS tuning_proposals_status ON tuning_proposals (status, created_at);
CREATE INDEX IF NOT EXISTS tuning_proposals_target ON tuning_proposals (target, created_at);

-- Approved nudges on top of what everyone's games teach (GET /v1/learn/tuning):
-- effort:<tier> is added to a level's toughness, theme:<id> multiplies how often
-- a theme is picked.
CREATE TABLE IF NOT EXISTS house_nudges (
  target     TEXT PRIMARY KEY,
  value      REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

-- Pre-approval: a kind of change set to 'auto' applies by itself (still
-- within its limits, measured and undoable). Missing means 'ask'.
CREATE TABLE IF NOT EXISTS tuning_rules (
  kind       TEXT PRIMARY KEY,
  mode       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
