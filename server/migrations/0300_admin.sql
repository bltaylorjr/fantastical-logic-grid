-- The admin dashboard (src/admin.js, app in admin/). Who may sign in to it,
-- what every admin did, settings the dashboard can change without a deploy,
-- announcements shown in the game, and screen-name moderation.

-- Admins sign in with their Firebase game account. The owner comes from the
-- OWNER_EMAIL Worker secret and is never stored here. role: admin, moderator
-- or viewer.
CREATE TABLE IF NOT EXISTS admins (
  email    TEXT PRIMARY KEY,      -- lowercase
  role     TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

-- One row per admin request, allowed or refused. actor is the admin's email,
-- "break-glass token" or "unknown". Kept for a year (upkeep.js).
CREATE TABLE IF NOT EXISTS admin_audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  role   TEXT,
  action TEXT NOT NULL,           -- e.g. "players.ban"
  target TEXT,                    -- e.g. a player id or a setting name
  detail TEXT,                    -- JSON
  status INTEGER NOT NULL         -- the HTTP status the request got
);
CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at);

-- Settings changed from the dashboard. value is JSON. A missing row means the
-- default in src/settings.js.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

-- Messages shown at the top of the game, between starts_at and ends_at.
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info', -- info or warning
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER,                      -- NULL: until ended
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Players kept out of races, scores and screen names. until NULL: no end.
CREATE TABLE IF NOT EXISTS bans (
  user_id   TEXT PRIMARY KEY,
  reason    TEXT,
  banned_by TEXT NOT NULL,
  banned_at INTEGER NOT NULL,
  until     INTEGER
);

-- Screen names a moderator has looked at. A name that changes since then
-- (a different name_key) is waiting for review again.
CREATE TABLE IF NOT EXISTS name_reviews (
  user_id     TEXT PRIMARY KEY,
  name_key    TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL
);
