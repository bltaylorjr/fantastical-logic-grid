-- Special badges (special-badges.js): badges the team awards by hand, such as
-- Tester or Contributor, and badges a player earns automatically by reaching a
-- milestone the admin sets (rule), such as 250 puzzles solved. They sit beside
-- the game's own achievement badges, which each device works out for itself.
-- rule NULL means awarded by hand only. A paused badge (active 0) shows
-- nowhere and is not awarded automatically; its awards are kept.
CREATE TABLE IF NOT EXISTS special_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rule TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL
);
-- One row per award. A removed award keeps its row (removed_at), so an
-- automatic badge an admin took away is not given back by the next check.
-- An award made out to an email reaches the player the next time they sign
-- in with that confirmed email.
CREATE TABLE IF NOT EXISTS badge_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  badge_id INTEGER NOT NULL,
  user_id TEXT,
  email TEXT,
  source TEXT NOT NULL,
  note TEXT,
  awarded_at INTEGER NOT NULL,
  awarded_by TEXT,
  removed_at INTEGER,
  removed_by TEXT
);
CREATE INDEX IF NOT EXISTS badge_awards_badge ON badge_awards (badge_id);
CREATE INDEX IF NOT EXISTS badge_awards_user ON badge_awards (user_id);
CREATE INDEX IF NOT EXISTS badge_awards_email ON badge_awards (email);
-- Starting badges. Change, pause or delete them under Badges in the admin app.
INSERT INTO special_badges (name, icon, description, rule, active, sort, created_at, created_by, updated_at) VALUES
  ('Tester', '🧪', 'Helped test the game before everyone else.', NULL, 1, 1, 0, 'setup', 0),
  ('Contributor', '🤝', 'Helped make the game better with ideas, stories or fixes.', NULL, 1, 2, 0, 'setup', 0),
  ('Bug Hunter', '🐞', 'Found and reported a real problem in the game.', NULL, 1, 3, 0, 'setup', 0),
  ('Puzzle Master', '🏆', 'Solved 250 puzzles.', '{"kind":"solved","count":250}', 1, 10, 0, 'setup', 0),
  ('Quantum Mind', '⚛️', 'Solved 25 Quantum Physicist puzzles.', '{"kind":"tier","tier":"mensa","count":25}', 1, 11, 0, 'setup', 0);
