-- The admin dashboard's Connections and setup guide (src/connections.js):
-- the GitHub Action's last report of which secret and variable NAMES have a
-- value (never the values) and the Pages settings. One row per source.
CREATE TABLE IF NOT EXISTS connection_reports (
  source TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  reported_at INTEGER NOT NULL
);
