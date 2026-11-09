-- Passwords drop box (src/vault.js): lets Claude and the owner's automations
-- add logins they set up without being able to read any.
-- The vault has an ECDH P-256 key pair. drop_pub (public, safe to share) can
-- only lock; its private half is locked with the vault key (drop_priv_iv +
-- drop_priv_ct), so only the owner's unlocked dashboard can open what arrives.
ALTER TABLE vault_meta ADD COLUMN drop_pub TEXT;
ALTER TABLE vault_meta ADD COLUMN drop_priv_iv TEXT;
ALTER TABLE vault_meta ADD COLUMN drop_priv_ct TEXT;

-- Logins waiting to move into the vault the next time the owner unlocks it.
-- epk: the sender's one-time public key; iv + ct: the locked login.
CREATE TABLE IF NOT EXISTS vault_inbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  epk         TEXT NOT NULL,
  iv          TEXT NOT NULL,
  ct          TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
