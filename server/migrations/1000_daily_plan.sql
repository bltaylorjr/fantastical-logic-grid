-- The daily puzzle planner in the admin dashboard (src/daily.js): changes to
-- an upcoming day's puzzle. The website build reads them from /v1/daily/plan
-- and rebuilds every day in order, so rows for past days must never change.
CREATE TABLE IF NOT EXISTS daily_plan (
  date TEXT PRIMARY KEY,        -- YYYY-MM-DD (UTC)
  theme TEXT,                   -- NULL: the usual theme for that day
  difficulty TEXT,              -- NULL: the usual level for that weekday
  categories INTEGER,           -- NULL with items: the level's usual size
  items INTEGER,
  reroll INTEGER NOT NULL DEFAULT 0, -- each "New story" press picks a different story
  note TEXT,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
