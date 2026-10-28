-- Contributors (contributors.js): players the team thanks with a Contributor
-- badge, for example for a story idea that became a Player Story. One row per
-- player; the badge never ends unless an admin takes it back.
CREATE TABLE IF NOT EXISTS contributors (
  user_id TEXT PRIMARY KEY,
  note TEXT,                   -- what they contributed, shown to the team only
  created_at INTEGER NOT NULL,
  created_by TEXT
);
