-- Google Search Console and Bing Webmaster numbers for the admin dashboard
-- (src/search.js). One row per source, replaced by each daily fetch. data is
-- JSON; error is the last failed fetch, kept beside the last good data.
CREATE TABLE IF NOT EXISTS search_snapshots (
  source     TEXT PRIMARY KEY,  -- google or bing
  fetched_at INTEGER,           -- last good fetch
  data       TEXT,
  error      TEXT,
  tried_at   INTEGER NOT NULL   -- last attempt
);
