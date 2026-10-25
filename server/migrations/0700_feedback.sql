-- Ideas and problem reports players send from the game's "Ideas and
-- problems" boxes (src/feedback.js). Anonymous: no account, name, email or
-- device id is stored, and the text has email addresses and long numbers
-- blanked. Done items are deleted after 180 days (upkeep.js).
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,              -- idea or problem
  topic      TEXT NOT NULL,              -- story or other (ideas); play, sound, pictures, saving or other (problems)
  text       TEXT NOT NULL,
  platform   TEXT NOT NULL,
  version    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new', -- new or done
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);
CREATE INDEX IF NOT EXISTS feedback_kind_status ON feedback (kind, status, created_at);
