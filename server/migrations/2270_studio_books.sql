-- Book Studio sync (server/src/studio-sync.js): each publisher's books, kept
-- on their account so they open on any device and in the Book Studio app.
-- A book's JSON is stored in parts (studio_book_parts) because it can carry
-- pictures; token is the save that wrote the current parts.
CREATE TABLE IF NOT EXISTS studio_books (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  rev INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  parts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS studio_book_parts (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (owner, id, idx)
);
