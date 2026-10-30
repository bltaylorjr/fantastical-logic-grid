-- Site visitors (visits.js): how many people opened the game each day, as
-- counts only. Each device is counted once a day (the game remembers the day
-- it last sent, web/js/visit.js). Nothing about the person, address or device
-- is kept beyond these broad groups, so a count can never be tied to anyone.
--   who      'guest' (not signed in) or 'player' (signed in to an account)
--   app      'web', 'desktop', 'android' or 'ios': which copy of the game
--   os       'windows', 'mac', 'android', 'ios', 'linux', 'chromeos' or 'other'
--   device   'mobile', 'tablet' or 'desktop'
--   country  two-letter country code from Cloudflare, or 'XX' when unknown
--   region   state or province code (US, Canada and Australia only), or ''
CREATE TABLE IF NOT EXISTS visit_stats (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  app TEXT NOT NULL,
  os TEXT NOT NULL,
  device TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who, app, os, device, country, region)
);
