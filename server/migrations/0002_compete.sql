-- Screen names, races against other players, and the scoreboard. Only
-- players who choose a screen name appear here; it is the only thing other
-- players ever see about them.

-- name_key is the screen name folded for uniqueness (lowercase, no spaces or
-- punctuation), so "Sky Fox" and "skyfox" cannot both exist.
CREATE TABLE IF NOT EXISTS players (
  user_id     TEXT PRIMARY KEY,
  screen_name TEXT NOT NULL,
  name_key    TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- One row per solved puzzle that counts for the scoreboard. story_id stops
-- the same puzzle from being scored twice. kind is 'solo' or 'race'.
CREATE TABLE IF NOT EXISTS scores (
  user_id    TEXT NOT NULL,
  story_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  tier       TEXT NOT NULL,
  cells      INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  hints      INTEGER NOT NULL,
  checks     INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, story_id)
);
CREATE INDEX IF NOT EXISTS scores_by_time ON scores (created_at);

-- A race: every player solves the same puzzle (the host's), and the fastest
-- solve wins. puzzle is the puzzle JSON the host's game made.
CREATE TABLE IF NOT EXISTS races (
  code       TEXT PRIMARY KEY,
  host_id    TEXT,
  tier       TEXT NOT NULL,
  cells      INTEGER NOT NULL,
  story_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  puzzle     TEXT NOT NULL,
  public     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  closes_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS races_open ON races (public, closes_at);

-- Each player in a race. joined_at is the server's clock, so a finish time
-- can never be shorter than the real time since joining. adjusted_ms is the
-- race time: solve time plus a penalty for each hint and check.
CREATE TABLE IF NOT EXISTS race_entries (
  code        TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  joined_at   INTEGER NOT NULL,
  finished_at INTEGER,
  solved      INTEGER NOT NULL DEFAULT 0,
  elapsed_ms  INTEGER,
  hints       INTEGER,
  checks      INTEGER,
  adjusted_ms INTEGER,
  PRIMARY KEY (code, user_id)
);
CREATE INDEX IF NOT EXISTS race_entries_by_user ON race_entries (user_id);
