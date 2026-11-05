-- Puzzle quality (admin > Puzzle quality, server/src/quality-puzzles.js).
-- Play summaries now also say which puzzle it was (puzzle_id: the engine's
-- own id, theme-topic-level-size-seed, nothing about the player), how long
-- the game expected it to take, and its clue count and difficulty score, so
-- a puzzle's numbers can be checked against its level's normal limits.
ALTER TABLE plays ADD COLUMN puzzle_id TEXT;
ALTER TABLE plays ADD COLUMN expected REAL;   -- minutes the game expected
ALTER TABLE plays ADD COLUMN clues INTEGER;
ALTER TABLE plays ADD COLUMN score REAL;      -- the engine's difficulty score
CREATE INDEX IF NOT EXISTS plays_puzzle ON plays(puzzle_id) WHERE puzzle_id IS NOT NULL;

-- Problem puzzles: one row per puzzle a player gave up on, rated low, found
-- too hard or too easy, or played far outside its level's normal limits. The
-- game sends the puzzle itself only then (POST /v1/learn/problem). Stored
-- gzip-compressed to keep the database small.
CREATE TABLE IF NOT EXISTS quality_puzzles (
  id TEXT PRIMARY KEY,          -- the puzzle's own id (theme-topic-level-size-seed)
  tier TEXT NOT NULL,
  theme TEXT NOT NULL,
  topic TEXT,
  story TEXT,                   -- story id: Delete retires it so no game builds it again
  size TEXT,                    -- e.g. 4x5
  seed TEXT,
  title TEXT,
  puzzle BLOB NOT NULL,         -- as players got it (gzip JSON)
  fixed BLOB,                   -- the edited or rebuilt version (gzip JSON)
  status TEXT NOT NULL DEFAULT 'open', -- open, fixed, published, retired
  before_retire TEXT,           -- the status to go back to on Undo
  note TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS quality_puzzles_status ON quality_puzzles(status, last_seen);
