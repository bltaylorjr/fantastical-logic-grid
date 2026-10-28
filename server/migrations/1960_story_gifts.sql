-- Storyline gifts (story-gifts.js): a player who suggests a storyline and
-- ticks "make me a puzzle from it" gets, once it is approved, a puzzle told
-- with their storyline in their saved puzzles and as a PDF by email. The
-- admin can also give a storyline to a player by screen name.
-- status: asked (waiting for the team), approved (waiting to be built),
-- building, sent, failed, declined. email is removed once sent.
CREATE TABLE IF NOT EXISTS story_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER,
  user_id TEXT,
  email TEXT,
  credit TEXT,
  status TEXT NOT NULL,
  theme TEXT,
  topic TEXT,
  difficulty TEXT,
  parts TEXT,
  force TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  claimed_at INTEGER,
  sent_at INTEGER,
  save_key TEXT
);
CREATE INDEX IF NOT EXISTS story_gifts_feedback ON story_gifts (feedback_id);
CREATE INDEX IF NOT EXISTS story_gifts_status ON story_gifts (status, approved_at);
CREATE INDEX IF NOT EXISTS story_gifts_user ON story_gifts (user_id, created_at);
