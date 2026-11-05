-- Editing storyline submissions (src/story-submissions.js). The author's
-- original stays in `form`; the latest version (edited by the team, or edited
-- and resubmitted by the author) is in `current`, and every earlier version
-- is kept in story_submission_versions.
--   current        the latest version of the form (JSON), empty until edited
--   edited_at/by   the last edit and who made it (an admin, or 'author')
--   resubmitted_at when the author last edited and resubmitted it
--   edit_key       a hashed key for the author's edit link (emailed), until edit_until
--   edit_invited   1 when the team asked the author to edit (a decided entry opens again)
ALTER TABLE story_submissions ADD COLUMN current TEXT;
ALTER TABLE story_submissions ADD COLUMN edited_at INTEGER;
ALTER TABLE story_submissions ADD COLUMN edited_by TEXT;
ALTER TABLE story_submissions ADD COLUMN resubmitted_at INTEGER;
ALTER TABLE story_submissions ADD COLUMN edit_key TEXT;
ALTER TABLE story_submissions ADD COLUMN edit_until INTEGER;
ALTER TABLE story_submissions ADD COLUMN edit_invited INTEGER NOT NULL DEFAULT 0;

-- One row per replaced version: the form as it was, and the puzzle built from it.
CREATE TABLE IF NOT EXISTS story_submission_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  form          TEXT NOT NULL,
  puzzle        TEXT,
  replaced_by   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS story_submission_versions_entry ON story_submission_versions (submission_id, created_at);
