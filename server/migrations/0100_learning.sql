-- The Fantastical Logic Grid shared learning service (Cloudflare D1).
-- Nothing personal is stored: no player id, name, email or IP address.

-- One row per finished puzzle, summarized.
CREATE TABLE IF NOT EXISTS plays (
  day TEXT NOT NULL,            -- YYYY-MM-DD, no time of day
  platform TEXT NOT NULL,       -- web, desktop, android, ios
  tier TEXT NOT NULL,
  theme TEXT NOT NULL,
  size TEXT,                    -- e.g. 4x5
  clue_types TEXT,              -- JSON { type: count }
  effort REAL NOT NULL DEFAULT 0,
  signal REAL NOT NULL DEFAULT 0, -- -1 too hard .. 1 too easy
  outcome TEXT NOT NULL,        -- solved, revealed, abandoned
  rating INTEGER,               -- 1-5 or NULL
  feel TEXT,                    -- easy, right, hard or NULL
  parts TEXT,                   -- JSON story part keys
  minutes REAL, hints INTEGER, mistakes INTEGER
);
CREATE INDEX IF NOT EXISTS plays_day ON plays(day);

-- Story parts players submitted. Only approved parts are sent to players.
CREATE TABLE IF NOT EXISTS parts (
  key TEXT PRIMARY KEY,         -- theme|kind|part key
  theme TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,          -- JSON
  source TEXT NOT NULL,         -- mine or ai
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  submitted TEXT NOT NULL,
  reviewed TEXT
);
CREATE INDEX IF NOT EXISTS parts_status ON parts(status);

-- Daily counters (voice clips made) that protect the free Gemini quota.
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
