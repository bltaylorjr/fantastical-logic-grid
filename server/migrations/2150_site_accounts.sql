-- Site accounts (src/site-accounts.js): the game's accounts on outside sites
-- (social media, developer portals, hosting), shown at the top of admin >
-- Connections and setup. Only details that are safe to read are kept: the
-- site, the profile address, the sign-in email, the handle, where its keys
-- live (names of GitHub or Cloudflare secrets, never their values) and notes.
-- Passwords stay in a password manager; the server refuses anything that
-- looks like a password, key or token.
CREATE TABLE IF NOT EXISTS site_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  login_email TEXT NOT NULL DEFAULT '',
  handle      TEXT NOT NULL DEFAULT '',
  keys_in     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'set-up',
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL
);

INSERT INTO site_accounts (site, url, login_email, handle, keys_in, status, notes, updated_at, updated_by) VALUES
  ('YouTube', 'https://www.youtube.com/@thelogicgridpuzzles', 'fantasticallogicgrid@gmail.com', '@thelogicgridpuzzles',
   'GitHub secrets YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN', 'waiting',
   'Channel "The Logic Grid", contact email support@thelogicgrid.com. Google Cloud project the-fantastical-logic-grid: YouTube Data API on, sign-in app "Logic Grid autopilot" published. Still to do: create the Web client, the YouTube API audit form, then Get the key.',
   1793606400000, 'setup'),
  ('Google Cloud', 'https://console.cloud.google.com/home/dashboard?project=the-fantastical-logic-grid', 'fantasticallogicgrid@gmail.com', 'the-fantastical-logic-grid',
   '', 'set-up', 'Holds the YouTube sign-in app (Google Auth Platform).', 1793606400000, 'setup'),
  ('Facebook Page', 'https://www.facebook.com/share/19pDDj5Ppf/', '', '',
   'GitHub secrets META_PAGE_ID, META_PAGE_TOKEN', 'set-up', '', 1793606400000, 'setup'),
  ('Instagram', 'https://www.instagram.com/fantastical_logic/', '', '@fantastical_logic',
   'GitHub secrets INSTAGRAM_ACCOUNT_ID, META_PAGE_TOKEN', 'set-up', '', 1793606400000, 'setup'),
  ('Mastodon', 'https://mastodon.social/@thelogicgrid', '', '@thelogicgrid@mastodon.social',
   'GitHub variable MASTODON_URL, secret MASTODON_TOKEN', 'set-up', '', 1793606400000, 'setup'),
  ('TikTok', '', '', '', 'GitHub secrets TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN', 'not-started', 'Make the account, then follow Connections > TikTok.', 1793606400000, 'setup'),
  ('Pinterest', '', '', '', 'GitHub secrets PINTEREST_APP_ID, PINTEREST_APP_SECRET, PINTEREST_REFRESH_TOKEN', 'not-started', 'Free business account. Make the board "Daily Logic Puzzles".', 1793606400000, 'setup'),
  ('X', '', '', '', 'GitHub secrets X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET', 'not-started', '', 1793606400000, 'setup'),
  ('Threads', '', '', '', 'GitHub secrets THREADS_USER_ID, THREADS_TOKEN', 'not-started', 'Uses the Instagram account.', 1793606400000, 'setup'),
  ('LinkedIn', '', '', '', 'GitHub secret LINKEDIN_TOKEN', 'not-started', '', 1793606400000, 'setup'),
  ('Reddit', '', '', '', 'GitHub secrets REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN', 'not-started', '', 1793606400000, 'setup'),
  ('Bluesky', '', '', '', 'GitHub secrets BLUESKY_HANDLE, BLUESKY_APP_PASSWORD', 'not-started', '', 1793606400000, 'setup');
