-- Alerts for the owner and admins (alerts.js): push to their devices and email.

-- Each admin's own choices. email_to is typed in by hand in the dashboard.
CREATE TABLE IF NOT EXISTS alert_prefs (
  actor TEXT PRIMARY KEY,
  email_to TEXT,
  email_on INTEGER NOT NULL DEFAULT 0,
  problems INTEGER NOT NULL DEFAULT 1,
  approvals INTEGER NOT NULL DEFAULT 1,
  messages INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Phones and computers where an admin turned on push alerts.
CREATE TABLE IF NOT EXISTS alert_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS alert_devices_actor ON alert_devices (actor);

-- The push sign-in key pair, made once by the Worker (never shown).
CREATE TABLE IF NOT EXISTS alert_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Alerts waiting to go out, and recent ones (kept 30 days).
CREATE TABLE IF NOT EXISTS alert_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  instant INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  dedupe TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS alert_queue_waiting ON alert_queue (sent_at, created_at);
CREATE INDEX IF NOT EXISTS alert_queue_dedupe ON alert_queue (dedupe, created_at);
