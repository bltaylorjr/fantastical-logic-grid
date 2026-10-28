-- Refunds and chargebacks (supporters.js). ended_reason says why a grant
-- ended early: 'ended' (by an admin), 'refund', 'chargeback', or 'blocked'
-- (a payment from a player blocked after a chargeback, recorded but never
-- active). A payment block stops payments from adding perks for that
-- player again until an admin lifts it; admins can still add them by hand.
ALTER TABLE supporters ADD COLUMN ended_reason TEXT;
CREATE TABLE IF NOT EXISTS payment_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  email TEXT,
  reason TEXT NOT NULL,        -- 'chargeback'
  note TEXT,
  supporter_id INTEGER,        -- the grant that was charged back
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS payment_blocks_user ON payment_blocks (user_id);
CREATE INDEX IF NOT EXISTS payment_blocks_email ON payment_blocks (email);
