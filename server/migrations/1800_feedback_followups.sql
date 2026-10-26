-- Puzzle details on ideas and problems, and telling players when what they
-- sent is addressed (src/followups.js).
--
-- puzzle: when a player sends an idea or problem while a puzzle is open (and
-- leaves "Include the puzzle I'm playing" ticked), the puzzle's own details
-- come along as JSON: story id, title, theme, topic, difficulty, seed, size,
-- engine version and the clue texts. Nothing about the player or device.
ALTER TABLE feedback ADD COLUMN puzzle TEXT;

-- The version a fix shipped in, set with "Mark addressed" (its plain-words
-- note is feedback.note, migration 1320).
ALTER TABLE feedback ADD COLUMN fixed_in TEXT;

-- Players who ticked "Let the team reply to me" (so the idea or problem is
-- already linked to their account) and have a confirmed email: the address
-- to tell them once it is addressed. Removed as soon as that email is queued,
-- after 180 days, or when the account is deleted.
CREATE TABLE IF NOT EXISTS feedback_followups (
  feedback_id INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_followups_user ON feedback_followups (user_id);

-- The "Addressed" email carries the team's note (never what the player wrote).
ALTER TABLE feedback_replies ADD COLUMN note TEXT;
