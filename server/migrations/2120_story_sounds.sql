-- Sounds players add with a Puzzle Wizard puzzle (src/story-sounds.js), kept
-- with their entry (story_submissions) and played for the team in Storyline
-- submissions. Each is at most about 700 KB (MP3, M4A, OGG, WAV or WebM).
--   purpose  what the author said it is for (solved, music, effect, other)
--   use      1 when the author lets the team use it with the puzzle
--   credit   1 when the author asked to be credited for it; credit_as: screen or real
CREATE TABLE IF NOT EXISTS story_submission_sounds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL,
  name           TEXT,
  mime           TEXT NOT NULL,
  data           TEXT NOT NULL,
  bytes          INTEGER,
  purpose        TEXT,
  use_ok         INTEGER NOT NULL DEFAULT 0,
  credit         INTEGER NOT NULL DEFAULT 0,
  credit_as      TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS story_submission_sounds_entry ON story_submission_sounds (submission_id);
