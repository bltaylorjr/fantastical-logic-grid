-- Player accounts sync. Firebase Auth owns emails and passwords; this
-- database only keeps each player's game data, keyed by their Firebase uid.

-- rev is a per-player counter: every write gets the next number, so a device
-- can ask for "everything after rev N".
CREATE TABLE IF NOT EXISTS sync_users (
  user_id    TEXT PRIMARY KEY,
  rev        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One row per saved puzzle (kind 'save'), meta list (kind 'meta', such as the
-- used-story list) and the settings (kind 'settings'). data is the JSON text
-- the app sent. A deleted save stays as a row with deleted = 1 so other
-- devices learn about the deletion.
CREATE TABLE IF NOT EXISTS sync_records (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  key        TEXT NOT NULL,
  data       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);
CREATE INDEX IF NOT EXISTS sync_records_by_rev ON sync_records (user_id, rev);

-- Uids of deleted accounts (a random id, nothing personal). Another device may
-- still hold a sign-in token for up to an hour; this stops it from writing
-- the deleted account's data back. Firebase never reuses a uid.
CREATE TABLE IF NOT EXISTS sync_deleted_users (
  user_id    TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
