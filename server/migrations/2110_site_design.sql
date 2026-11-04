-- The website's design (admin dashboard > Website, src/site-design.js).
--   state   'draft' (at most one row: the changes being tried out) or
--           'published' (one row per Publish; the newest is live, older ones can be restored)
--   design  the choices that differ from the defaults, as JSON (web/js/site-design.js)
CREATE TABLE IF NOT EXISTS site_design (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'published')),
  design TEXT NOT NULL,
  actor TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_design_state ON site_design (state, id);
