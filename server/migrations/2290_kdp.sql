-- Amazon KDP page (admin/kdp.js, server/src/kdp.js): each book's KDP listing
-- (one row per format, so a paperback and a hardcover of the same book are two
-- rows), its status on KDP, and what it sold each month.
-- listing: JSON with the Details, Content and Pricing tabs' answers.
CREATE TABLE IF NOT EXISTS kdp_listings (
  id TEXT PRIMARY KEY,
  book_id TEXT,
  format TEXT NOT NULL DEFAULT 'paperback',
  status TEXT NOT NULL DEFAULT 'planning',
  title TEXT NOT NULL DEFAULT '',
  asin TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  listing TEXT NOT NULL DEFAULT '{}',
  live_at INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kdp_listings_book ON kdp_listings (book_id);
-- month: YYYY-MM. royalty_cents: USD, as KDP's royalty report gives it.
CREATE TABLE IF NOT EXISTS kdp_sales (
  listing_id TEXT NOT NULL,
  month TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  royalty_cents INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (listing_id, month)
);
