-- Challenges: a player in a race invites another player by screen name. The
-- invited player sees it in the game and can accept (join the race) or decline.
-- status: pending, accepted or declined. Deleted with the race (45 days).
CREATE TABLE IF NOT EXISTS race_invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  UNIQUE (code, to_id)
);
CREATE INDEX IF NOT EXISTS race_invites_to ON race_invites (to_id, status);
CREATE INDEX IF NOT EXISTS race_invites_from ON race_invites (from_id, created_at);

-- Players can turn challenges from others off (on by default).
ALTER TABLE players ADD COLUMN accept_invites INTEGER NOT NULL DEFAULT 1;
