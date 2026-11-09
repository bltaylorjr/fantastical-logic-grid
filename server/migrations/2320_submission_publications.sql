-- Player puzzles in Book Studio (server/src/studio-player-puzzles.js): every
-- book that included an approved player puzzle (story_submissions) when it was
-- exported. One row per puzzle and book: exporting the same book again only
-- updates last_at and adds to exports, so a puzzle's count is the number of
-- different books (publications) it went out in.
--   book      the Book Studio book's id (its sync id), or its title
--   title     the book's title at the last export; platform the publisher
--   by_email  who exported it first
CREATE TABLE IF NOT EXISTS submission_publications (
  submission_id INTEGER NOT NULL,
  book TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL DEFAULT '',
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  exports INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (submission_id, book)
);
CREATE INDEX IF NOT EXISTS submission_publications_book ON submission_publications (book);
