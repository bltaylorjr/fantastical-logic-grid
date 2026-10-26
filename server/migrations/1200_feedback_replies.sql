-- Thank-you emails for ideas and problem reports sent by signed-in players
-- with a confirmed email (src/replies.js). The Worker cannot send email (the
-- domain is not on Cloudflare), so it keeps a short queue that the GitHub
-- Action .github/workflows/feedback-replies.yml empties through Gmail.
-- The email address is removed as soon as the note is sent or given up on,
-- and nothing links a row to the idea or problem itself, which stays
-- anonymous. Rows go after 30 days (upkeep.js).
CREATE TABLE IF NOT EXISTS feedback_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  who        TEXT NOT NULL,                  -- a hash of the player's account id, for the per-player limit
  kind       TEXT NOT NULL,                  -- idea or problem
  email      TEXT,                           -- only until sent
  status     TEXT NOT NULL DEFAULT 'waiting', -- waiting, sending, sent, failed or dropped
  tries      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  sent_at    INTEGER
);
CREATE INDEX IF NOT EXISTS feedback_replies_status ON feedback_replies (status, created_at);
CREATE INDEX IF NOT EXISTS feedback_replies_who ON feedback_replies (who, created_at);
