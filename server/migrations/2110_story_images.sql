-- Pictures for story beats and storyline submissions (src/story-images.js).
-- Pictures arrive already shrunk and turned into WebP, JPEG or PNG by the
-- browser (web/js/image-prep.js), so each one is small enough for a D1 row.

-- Story beat pictures the team uploads in the admin dashboard (Story beat
-- pictures). The game shows one beside a story beat (web/js/director.js).
--   theme   a theme id, or 'default' for every theme without its own
--   stage   early, middle or late, or 'any' for every stage
--   alt     what the picture shows, for screen readers
--   mime    image/webp, image/jpeg or image/png
--   data    the picture, base64
--   from_submission  the storyline submission it came from, if any
CREATE TABLE IF NOT EXISTS beat_images (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  theme            TEXT NOT NULL DEFAULT 'default',
  stage            TEXT NOT NULL DEFAULT 'any',
  alt              TEXT NOT NULL,
  mime             TEXT NOT NULL,
  data             TEXT NOT NULL,
  width            INTEGER,
  height           INTEGER,
  bytes            INTEGER,
  from_submission  INTEGER,
  created_at       INTEGER NOT NULL,
  created_by       TEXT
);
CREATE INDEX IF NOT EXISTS beat_images_theme ON beat_images (theme, stage);

-- Pictures players add to the Suggest a storyline form, kept with their entry
-- (story_submissions) and shown to the team in Storyline submissions.
CREATE TABLE IF NOT EXISTS story_submission_images (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL,
  name           TEXT,
  mime           TEXT NOT NULL,
  data           TEXT NOT NULL,
  width          INTEGER,
  height         INTEGER,
  bytes          INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS story_submission_images_entry ON story_submission_images (submission_id);
