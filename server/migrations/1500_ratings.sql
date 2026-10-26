-- Puzzle ratings and insights (src/ratings.js). More about each anonymous
-- play summary, so ratings can be compared by topic, story, character, app
-- version and play mode. Still nothing personal: pid is a random key made
-- for one puzzle only, so a rating given later updates the same row instead
-- of counting the game twice. It never links two puzzles or a player.
ALTER TABLE plays ADD COLUMN pid TEXT;
ALTER TABLE plays ADD COLUMN topic TEXT;
ALTER TABLE plays ADD COLUMN story TEXT;      -- the story id (which story parts were used)
ALTER TABLE plays ADD COLUMN chars TEXT;      -- JSON list of the game's own character ids in the puzzle
ALTER TABLE plays ADD COLUMN version TEXT;    -- app version, e.g. 1.8.0
ALTER TABLE plays ADD COLUMN mode TEXT;       -- free, daily or race
ALTER TABLE plays ADD COLUMN whatif INTEGER;  -- what-if reasoning steps the puzzle needs
CREATE UNIQUE INDEX IF NOT EXISTS plays_pid ON plays(pid) WHERE pid IS NOT NULL;

-- The plain-words analysis, kept per day and period so the dashboard, the
-- nightly report and the emails share one Workers AI summary a day.
CREATE TABLE IF NOT EXISTS rating_insights (
  day TEXT NOT NULL,
  days INTEGER NOT NULL,
  at INTEGER NOT NULL,
  findings TEXT NOT NULL,       -- JSON from the rules (always there)
  summary TEXT,                 -- Workers AI text, or NULL
  PRIMARY KEY (day, days)
);
