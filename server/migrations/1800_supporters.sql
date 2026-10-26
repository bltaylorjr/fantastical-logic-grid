-- Supporters and premium extras (supporters.js). One row per grant: added by
-- an admin, or later by a payment service's webhook. A grant found by email is
-- linked to the player's account the first time they sign in with that
-- (confirmed) email. until NULL means it never ends.
CREATE TABLE IF NOT EXISTS supporters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  email TEXT,
  kind TEXT NOT NULL,          -- 'supporter' (badge) or 'premium' (badge and extras)
  tier INTEGER NOT NULL DEFAULT 1, -- badge level: 1 Bronze, 2 Silver, 3 Gold, 4 Platinum
  source TEXT NOT NULL,        -- 'admin', or the payment service
  ref TEXT NOT NULL,           -- the payment's id, so a repeated webhook adds nothing
  note TEXT,
  created_at INTEGER NOT NULL,
  until INTEGER,
  created_by TEXT,
  UNIQUE (source, ref)
);
CREATE INDEX IF NOT EXISTS supporters_user ON supporters (user_id);
CREATE INDEX IF NOT EXISTS supporters_email ON supporters (email);
