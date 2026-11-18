-- Player profiles in the admin dashboard (src/profiles.js). For each signed-in
-- account, one row per day per rough place and kind of device it played from,
-- so the profile can show when, from where and for about how long a player
-- played. The place is Cloudflare's own lookup of the connection (country,
-- state or region, nearest city); the address itself is never stored. Rows go
-- with the account when it is deleted, and are kept 180 days (upkeep.js).
--   day       the UTC day (YYYY-MM-DD)
--   country   two-letter country code, or XX when unknown
--   region    state, province or region name, or ''
--   city      nearest city as Cloudflare names it, or ''
--   os        windows, mac, android, ios, linux, chromeos or other
--   device    mobile, tablet or desktop
--   first_at  first time seen there that day
--   last_at   last time seen there that day (updated at most every 4 minutes)
--   minutes   rough minutes of play: gaps of up to 12 minutes between two
--             visits from the open game (it checks in every 5 minutes) count
--   sessions  times the game was opened there that day (a gap over 12 minutes
--             starts a new one)
CREATE TABLE IF NOT EXISTS account_places (
  user_id  TEXT NOT NULL,
  day      TEXT NOT NULL,
  country  TEXT NOT NULL,
  region   TEXT NOT NULL DEFAULT '',
  city     TEXT NOT NULL DEFAULT '',
  os       TEXT NOT NULL DEFAULT 'other',
  device   TEXT NOT NULL DEFAULT 'desktop',
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL,
  minutes  INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day, country, region, city, os, device)
);
CREATE INDEX IF NOT EXISTS account_places_by_day ON account_places (day);
