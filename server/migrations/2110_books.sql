-- The books database (src/books.js, admin > Book publishing > Books database):
-- every print book made on the Book publishing page and every puzzle in it,
-- so a new book or a new edition never reuses a puzzle, and each puzzle can
-- be scanned for trademark and copyright problems before it is published.
--   status     draft (made, not published), published or retired
--   series     groups a book with its later editions and volumes
--   parent_id  the earlier edition this one updates (books.id)
--   settings   the Book publishing settings used, as JSON
--   ip_verdict worst scan result of its puzzles: clear, check or problem
CREATE TABLE IF NOT EXISTS books (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  volume       TEXT,
  edition      TEXT,
  series       TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  parent_id    INTEGER,
  isbn         TEXT,
  pages        INTEGER,
  trim         TEXT,
  ink          TEXT,
  settings     TEXT,
  notes        TEXT,
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  published_at INTEGER,
  ip_verdict   TEXT,
  ip_scan_at   INTEGER
);
CREATE INDEX IF NOT EXISTS books_series ON books (series);

-- One row per puzzle in a book, in book order.
--   story_id     the engine's story id (the same story is never printed twice)
--   fingerprint  a hash of the puzzle's categories, answers and clues
--   text         the puzzle's words (title, story, clues, questions, answers) for the scan
--   ip_scan      the scan's findings, as JSON
CREATE TABLE IF NOT EXISTS book_puzzles (
  book_id     INTEGER NOT NULL,
  position    INTEGER NOT NULL,
  story_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title       TEXT,
  theme       TEXT,
  topic       TEXT,
  tier        TEXT,
  size        TEXT,
  seed        TEXT,
  engine      TEXT,
  text        TEXT,
  ip_verdict  TEXT,
  ip_scan     TEXT,
  ip_scan_at  INTEGER,
  PRIMARY KEY (book_id, position)
);
CREATE INDEX IF NOT EXISTS book_puzzles_story ON book_puzzles (story_id);
CREATE INDEX IF NOT EXISTS book_puzzles_fingerprint ON book_puzzles (fingerprint);
