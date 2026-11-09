-- The Puzzle submissions page (admin/puzzle-submissions.js): every entry in
-- the Storyline Submission Database moves through four stages, kept in the
-- existing `status` column:
--   new        Awaiting approval
--   edits      Awaiting edits (the team asked the author for changes)
--   approved   Approved
--   published  Published (the team marked it as out in the game or a book)
-- declined and closed stay as they were (shown under Not used).
--   published_at/by/note  when the team published it, who, and where
--   pushed_at/by          the last time the team put its puzzle in the
--                         player's Saved puzzles; push_count how many times
ALTER TABLE story_submissions ADD COLUMN published_at INTEGER;
ALTER TABLE story_submissions ADD COLUMN published_by TEXT;
ALTER TABLE story_submissions ADD COLUMN published_note TEXT;
ALTER TABLE story_submissions ADD COLUMN pushed_at INTEGER;
ALTER TABLE story_submissions ADD COLUMN pushed_by TEXT;
ALTER TABLE story_submissions ADD COLUMN push_count INTEGER NOT NULL DEFAULT 0;

-- Every earlier entry the team asked the author to edit, and that the author
-- has not resubmitted yet, is Awaiting edits.
UPDATE story_submissions SET status = 'edits' WHERE edit_invited = 1 AND status IN ('new', 'approved', 'declined', 'closed');
