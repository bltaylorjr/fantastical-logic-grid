-- The Storyline Submission Database (src/story-submissions.js): every theme
-- idea, category idea and storyline players send, kept exactly as they
-- submitted it, with the player, the author credit, their consent and the
-- first puzzle made from an approved storyline. The admin dashboard's
-- Storyline submissions page searches it, prints entries and emails them.
--   kind       theme, category or storyline
--   source     form (the Suggest a storyline page) or idea box (Share an idea)
--   feedback_id  the Share an idea row it came from (idea box only)
--   form       the original submission, field by field, as JSON
--   text       the original words as one block (for search and old ideas)
--   polished   the team's corrected wording (spelling, grammar), as JSON
--   user_id    the signed-in player's account, if any
--   email      where copies and the approval email go: the player's confirmed
--              address, or the one a guest typed to get a copy
--   copy_key   a one-time key (hashed) that lets a guest ask for a copy
--   puzzle     the first puzzle built from an approved storyline (JSON)
--   status     new, approved, declined or closed
CREATE TABLE IF NOT EXISTS story_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'form',
  feedback_id  INTEGER,
  theme        TEXT,
  title        TEXT,
  pitch        TEXT,
  credit       TEXT,
  consent      INTEGER NOT NULL DEFAULT 0,
  consent_text TEXT,
  form         TEXT NOT NULL,
  text         TEXT NOT NULL,
  polished     TEXT,
  user_id      TEXT,
  email        TEXT,
  copy_key     TEXT,
  copy_until   INTEGER,
  puzzle       TEXT,
  puzzle_at    INTEGER,
  status       TEXT NOT NULL DEFAULT 'new',
  platform     TEXT,
  version      TEXT,
  created_at   INTEGER NOT NULL,
  decided_at   INTEGER,
  decided_by   TEXT
);
CREATE INDEX IF NOT EXISTS story_submissions_status ON story_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS story_submissions_kind ON story_submissions (kind, created_at);
CREATE INDEX IF NOT EXISTS story_submissions_user ON story_submissions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS story_submissions_feedback ON story_submissions (feedback_id) WHERE feedback_id IS NOT NULL;

-- Emails about a submission (the confirmation with a copy of the form, the
-- approval with its puzzle, a copy the team emails) go through the same queue
-- as every other player email, linked here.
ALTER TABLE feedback_replies ADD COLUMN submission_id INTEGER;

-- Every storyline and theme idea players already sent from Share an idea,
-- in the words they sent.
INSERT OR IGNORE INTO story_submissions (kind, source, feedback_id, theme, form, text, status, platform, version, created_at, decided_at)
SELECT CASE topic WHEN 'story' THEN 'storyline' ELSE 'theme' END, 'idea box', id, theme,
  json_object('kind', CASE topic WHEN 'story' THEN 'storyline' ELSE 'theme' END, 'idea', text, 'theme', theme),
  text,
  CASE WHEN status IN ('addressed', 'approved') THEN 'approved' WHEN status = 'done' AND declined = 1 THEN 'declined' WHEN status = 'done' THEN 'closed' ELSE 'new' END,
  platform, version, created_at, COALESCE(done_at, approved_at)
FROM feedback WHERE kind = 'idea' AND topic IN ('story', 'theme');

-- The player behind an old storyline, where they asked for an email and it
-- has not gone yet (otherwise ideas were kept anonymous).
UPDATE story_submissions SET
  user_id = (SELECT r.user_id FROM feedback_replies r WHERE r.feedback_id = story_submissions.feedback_id AND r.status = 'held' AND r.user_id IS NOT NULL LIMIT 1),
  email = (SELECT r.email FROM feedback_replies r WHERE r.feedback_id = story_submissions.feedback_id AND r.status = 'held' AND r.email IS NOT NULL LIMIT 1)
WHERE source = 'idea box';
