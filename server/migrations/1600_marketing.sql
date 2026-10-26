-- Marketing (src/marketing.js): every campaign and ad, the media they use,
-- and anonymous daily counts of what each campaign link brought in.

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,          -- the utm_campaign value in its links
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', -- draft, active, paused, ended
  starts TEXT,                        -- YYYY-MM-DD
  ends TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One post or listing on one channel.
CREATE TABLE IF NOT EXISTS campaign_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  channel TEXT NOT NULL,              -- utm_source, e.g. reddit
  medium TEXT NOT NULL DEFAULT 'social', -- utm_medium
  content TEXT NOT NULL,              -- utm_content, tells two ads on one channel apart
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',      -- the words to post
  media TEXT NOT NULL DEFAULT '[]',   -- JSON list of marketing_media ids
  landing TEXT NOT NULL DEFAULT '/',  -- the page on the website the link opens
  status TEXT NOT NULL DEFAULT 'draft', -- draft, approved, posted, removed
  where_to TEXT NOT NULL DEFAULT '',  -- where to post it (a link or place)
  post_url TEXT,                      -- the live post, once posted
  posted_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_ads_campaign ON campaign_ads(campaign_id);

-- Videos, pictures and other files the ads use. The files themselves live in
-- the repository (media/promo, media/marketing) or on the channel; this is the list.
CREATE TABLE IF NOT EXISTS marketing_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image', -- video, image, text, other
  url TEXT NOT NULL,                  -- where to download or view it
  preview TEXT,                       -- a small picture under /admin/marketing/, if any
  size TEXT NOT NULL DEFAULT '',      -- e.g. 1080x1920, 30 s
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- Anonymous counts per day: no ids, no addresses, only how many.
-- campaign '(none)' is a visit from another site without a campaign link.
CREATE TABLE IF NOT EXISTS campaign_stats (
  day TEXT NOT NULL,
  campaign TEXT NOT NULL,
  source TEXT NOT NULL,
  medium TEXT NOT NULL,
  content TEXT NOT NULL,
  event TEXT NOT NULL,                -- visit, play, solve, install, download
  platform TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, campaign, source, medium, content, event, platform)
);

-- Starter campaigns added once (src/marketing-seed.js), so a deleted one stays deleted.
CREATE TABLE IF NOT EXISTS marketing_seeds (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
