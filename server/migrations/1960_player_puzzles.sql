-- Puzzles for contributors (messages.js): a puzzle the team made from a
-- player's suggestion, attached to a reply in the admin Communication thread.
-- The player finds it in Menu > Messages > Puzzles for you, where they can
-- play it or download it as a puzzle file. Each one is kept 30 days
-- (expires_at), then removed by the nightly cleanup (upkeep.js); it also goes
-- with its conversation or when the account is deleted.
CREATE TABLE IF NOT EXISTS player_puzzles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  conversation_id INTEGER,
  title           TEXT NOT NULL,
  tier            TEXT NOT NULL DEFAULT '',
  puzzle          TEXT NOT NULL,              -- the puzzle as the game's own JSON
  size            INTEGER NOT NULL DEFAULT 0, -- characters, for the storage totals
  created_by      TEXT,                       -- the admin's email (only shown in the dashboard)
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  opened_at       INTEGER                     -- first time the player played or downloaded it
);
CREATE INDEX IF NOT EXISTS player_puzzles_user ON player_puzzles (user_id, expires_at);
CREATE INDEX IF NOT EXISTS player_puzzles_conv ON player_puzzles (conversation_id);
CREATE INDEX IF NOT EXISTS player_puzzles_expires ON player_puzzles (expires_at);
