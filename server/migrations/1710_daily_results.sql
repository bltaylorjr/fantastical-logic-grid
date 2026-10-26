-- Daily puzzle results everyone can see (src/daily-results.js): anonymous
-- counts per day. bucket -1 = started, -2 = revealed, 0 and up = solved in
-- that many whole minutes (240 = four hours or more). Nothing about a player.
CREATE TABLE IF NOT EXISTS daily_results (
  day TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);
