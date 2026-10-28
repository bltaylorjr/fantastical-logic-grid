-- App keys for the Windows and Android apps (licenses.js). One row per key,
-- made by an admin or, when the admin allows it, by a signed-in player for
-- themselves (that key waits for an admin's approval before it works). Each key installs on max_devices devices (1, or 2 when an admin
-- allows it) and can be used for max_downloads website downloads (2); after
-- that a new key is needed. A device is a random id the app makes once.
-- revoked_at set means the key no longer works.
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,     -- FLG-XXXXX-XXXXX-XXXXX-XXXXX
  label TEXT,                   -- who it is for, for the admin
  email TEXT,
  user_id TEXT,                 -- set for a key a player got for themselves
  max_devices INTEGER NOT NULL DEFAULT 1,
  max_downloads INTEGER NOT NULL DEFAULT 2,
  downloads INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER,
  source TEXT NOT NULL,         -- 'admin' or 'self'
  created_at INTEGER NOT NULL,
  created_by TEXT,
  expires_at INTEGER,
  revoked_at INTEGER,
  waiting INTEGER NOT NULL DEFAULT 0, -- 1: a player asked for it and an admin has not approved it yet
  approved_at INTEGER,
  approved_by TEXT
);
CREATE INDEX IF NOT EXISTS licenses_user ON licenses (user_id);

CREATE TABLE IF NOT EXISTS license_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  device TEXT NOT NULL,
  platform TEXT NOT NULL,       -- 'desktop', 'android' or 'ios'
  activated_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  removed_at INTEGER,           -- set when an admin frees the seat
  UNIQUE (license_id, device)
);
CREATE INDEX IF NOT EXISTS license_devices_license ON license_devices (license_id);
