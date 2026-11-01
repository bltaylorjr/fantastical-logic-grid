-- NINETIMESNINE (modules/number-place): anonymous play summaries for the shared
-- learning service. Nothing identifies a player. pid is a random key for one
-- game, so a "how did it feel" answer sent later updates the same row.
--   level     basic | easy | medium | hard | expert | master
--   size      4, 6 or 9
--   variants  '' or 'diagonal', 'parity', 'diagonal+parity'
--   mode      free | daily | race | file
--   outcome   solved | revealed | abandoned
--   tuned     the toughness the game aimed for inside the level (0 to 1)
--   score     the puzzle's toughness score from the engine
--   stuck     JSON list of techniques the player asked hints for
CREATE TABLE IF NOT EXISTS np_plays (
  day TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  level TEXT NOT NULL,
  size INTEGER NOT NULL,
  variants TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'free',
  outcome TEXT NOT NULL,
  feel TEXT,
  minutes REAL,
  hints INTEGER NOT NULL DEFAULT 0,
  mistakes INTEGER NOT NULL DEFAULT 0,
  checks INTEGER NOT NULL DEFAULT 0,
  tuned REAL,
  score INTEGER,
  stuck TEXT NOT NULL DEFAULT '[]',
  pid TEXT,
  version TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS np_plays_pid ON np_plays (pid) WHERE pid IS NOT NULL;
CREATE INDEX IF NOT EXISTS np_plays_day ON np_plays (day);
