-- Cage Math, Sum Cross and Picture Grid (modules/grid-kit): anonymous play
-- summaries for the shared learning service, one table for the three games.
-- Nothing identifies a player. pid is a random key for one game, so a "how did
-- it feel" answer sent later updates the same row.
--   game      cm (Cage Math) | sc (Sum Cross) | pg (Picture Grid)
--   level     basic | easy | medium | hard | expert | master
--   size      the grid's size (4 to 25)
--   mode      free | daily | file
--   outcome   solved | revealed | abandoned
--   tuned     the toughness the game aimed for inside the level (0 to 1)
--   score     the puzzle's toughness score from the engine
--   stuck     JSON list of techniques the player asked hints for
CREATE TABLE IF NOT EXISTS kit_plays (
  game TEXT NOT NULL,
  day TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  level TEXT NOT NULL,
  size INTEGER NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS kit_plays_pid ON kit_plays (game, pid) WHERE pid IS NOT NULL;
CREATE INDEX IF NOT EXISTS kit_plays_game_day ON kit_plays (game, day);
