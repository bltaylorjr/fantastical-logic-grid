-- Challenge a friend (src/challenges.js): one solved puzzle shared by a link,
-- with the sharer's time. No account, name or address is kept; only how many
-- people played the link and how many beat the time.
CREATE TABLE IF NOT EXISTS challenges (
  code TEXT PRIMARY KEY,
  puzzle TEXT NOT NULL,            -- the puzzle JSON
  story_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  title TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,     -- the sharer's time
  hints INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0, -- friends who finished it
  beat INTEGER NOT NULL DEFAULT 0,  -- friends who were faster
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_created ON challenges(created_at);
