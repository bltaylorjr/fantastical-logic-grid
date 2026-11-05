-- Books for publishing (server/src/books.js, admin > Books): print puzzle
-- books made from every game, their covers, and every puzzle each one uses.
CREATE TABLE IF NOT EXISTS books (
  id           TEXT PRIMARY KEY,           -- bk-<time>-<random>
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  volume       INTEGER NOT NULL DEFAULT 1,
  edition      INTEGER NOT NULL DEFAULT 1,
  author       TEXT NOT NULL DEFAULT '',
  trim         TEXT NOT NULL,              -- 6x9, 7x10, 8x10, 8.25x11, 8.5x11
  paper        TEXT NOT NULL DEFAULT 'white', -- white or cream (sets the spine width)
  pages        INTEGER NOT NULL DEFAULT 0, -- interior page count when last saved
  status       TEXT NOT NULL DEFAULT 'draft', -- draft or published
  settings     TEXT NOT NULL DEFAULT '{}', -- JSON: sections, front matter, answer key place
  cover        TEXT NOT NULL DEFAULT '{}', -- JSON: template, colors, words
  css          TEXT NOT NULL DEFAULT '{}', -- JSON: each game's print styles { game: css }
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS books_status ON books (status, updated_at);

-- One row per puzzle in a book. The fingerprint is the key, so a puzzle can
-- be in one book only: never reused in a later volume or edition.
CREATE TABLE IF NOT EXISTS book_puzzles (
  fp        TEXT PRIMARY KEY,
  book_id   TEXT NOT NULL,
  game      TEXT NOT NULL,
  title     TEXT NOT NULL DEFAULT '',
  story     TEXT NOT NULL DEFAULT '',
  position  INTEGER NOT NULL,
  scan      TEXT NOT NULL DEFAULT 'clear', -- clear or check (trademark and copyright scan)
  content   TEXT NOT NULL DEFAULT '{}',    -- JSON: the puzzle and answer key pages as printed, so the book can be printed again
  added_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS book_puzzles_book ON book_puzzles (book_id, position);

-- Cover templates the team saved (the built-in ones live in admin/books.js).
CREATE TABLE IF NOT EXISTS book_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  design     TEXT NOT NULL,                -- JSON
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
