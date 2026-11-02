-- Passwords (src/vault.js, admin > Passwords): the owner's password manager.
-- Everything a login holds (site, address, username, password, notes, 2-step
-- code key, extra fields) is locked on the owner's device before it is sent,
-- so these tables keep only scrambled text the Worker cannot read. The master
-- password itself is never sent or stored.

-- One row. A random vault key locks every login; the master password (turned
-- into a key with the salt and rounds) locks the vault key, kept here as
-- key_iv + key_ct. Changing the master password only changes this row.
CREATE TABLE IF NOT EXISTS vault_meta (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  salt        TEXT NOT NULL,
  iterations  INTEGER NOT NULL,
  key_iv      TEXT NOT NULL,
  key_ct      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- One row per saved login. deleted_at: in the bin (can be put back for 30 days).
CREATE TABLE IF NOT EXISTS vault_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  iv          TEXT NOT NULL,
  ct          TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
