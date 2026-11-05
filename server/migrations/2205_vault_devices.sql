-- Passwords: unlock with Face ID, a fingerprint or Windows Hello (src/vault.js).
-- Each device keeps a passkey made for Passwords. The browser's PRF extension
-- gives a secret only that passkey can make, after the face or finger check;
-- that secret locks a copy of the vault key, kept here as key_iv + key_ct.
-- Without the device itself the copy cannot be opened.
CREATE TABLE IF NOT EXISTS vault_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cred_id       TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  prf_salt      TEXT NOT NULL,
  key_iv        TEXT NOT NULL,
  key_ct        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
