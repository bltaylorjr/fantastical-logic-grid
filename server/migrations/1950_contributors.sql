-- Contributor badges (contributors.js). A signed-in player who ticks "Count
-- this toward my Contributor badge" when sending an idea, a problem report or
-- a character suggestion gets one row here, linked to what they sent. It
-- counts once the team uses it: an idea or problem marked addressed, or a
-- suggested character published. Admins can also add credits by hand for help
-- given outside the game. The idea or character itself stays anonymous in the
-- dashboard; only this table knows who sent it.
CREATE TABLE IF NOT EXISTS contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,                  -- idea, problem, character or admin
  ref         TEXT NOT NULL,                  -- the feedback id, character id, or a made-up one for admin credits
  status      TEXT NOT NULL DEFAULT 'waiting', -- waiting or counted
  note        TEXT,                           -- admin credits: what it was for
  created_at  INTEGER NOT NULL,
  counted_at  INTEGER,
  created_by  TEXT,
  UNIQUE (kind, ref)
);
CREATE INDEX IF NOT EXISTS contributions_user ON contributions (user_id, status);
