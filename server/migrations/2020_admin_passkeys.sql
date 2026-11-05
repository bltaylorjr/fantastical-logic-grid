-- Face ID and fingerprint sign-in for the admin dashboard (src/passkeys.js).

-- One row per device an admin set up. id is the passkey's credential id
-- (base64url); public_key is a JWK; alg is -7 (ES256) or -257 (RS256).
CREATE TABLE IF NOT EXISTS admin_passkeys (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,     -- lowercase
  public_key   TEXT NOT NULL,
  alg          INTEGER NOT NULL,
  sign_count   INTEGER NOT NULL DEFAULT 0,
  device       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS admin_passkeys_email ON admin_passkeys (email);

-- Dashboard sessions started with a passkey. Only the SHA-256 of the key the
-- browser holds is kept. They end after 12 hours, or 30 idle minutes.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  passkey_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One-time challenges a passkey must sign, for 5 minutes. purpose: get
-- (sign in) or create (set up a device, for that email).
CREATE TABLE IF NOT EXISTS admin_challenges (
  challenge  TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL,
  email      TEXT,
  expires_at INTEGER NOT NULL
);
