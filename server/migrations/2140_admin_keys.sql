-- Assistant keys (src/admin-keys.js): a key the owner makes in admin > Admins
-- for a helper such as Claude to use the admin API, with a role (viewer,
-- moderator or admin, never owner), an end date, and Revoke. Only a hash of
-- the key is kept; the key itself is shown once when it is made.
CREATE TABLE IF NOT EXISTS admin_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,          -- the last 4 characters, to tell keys apart
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  uses         INTEGER NOT NULL DEFAULT 0,
  revoked_at   INTEGER,
  revoked_by   TEXT
);
