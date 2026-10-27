-- Each ad gets the day it should go out (post_on, YYYY-MM-DD) and a note from
-- the automatic poster (auto_note: last error, or how it was posted). The
-- starter ads get the days from the launch plan (docs/reports/2026-10-26-launch-plan.pdf).
ALTER TABLE campaign_ads ADD COLUMN post_on TEXT;
ALTER TABLE campaign_ads ADD COLUMN auto_note TEXT;
UPDATE campaign_ads SET post_on = '2026-11-02' WHERE created_by = 'starter plan' AND channel = 'email' AND content = 'friends-family' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-03' WHERE created_by = 'starter plan' AND channel = 'linkedin' AND content = 'maker-post' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-03' WHERE created_by = 'starter plan' AND channel = 'bluesky' AND content = 'launch' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-04' WHERE created_by = 'starter plan' AND channel = 'mastodon' AND content = 'launch' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-04' WHERE created_by = 'starter plan' AND channel = 'facebook' AND content = 'page-video' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-05' WHERE created_by = 'starter plan' AND channel = 'instagram' AND content = 'reel-launch' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-05' WHERE created_by = 'starter plan' AND channel = 'threads' AND content = 'launch' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-06' WHERE created_by = 'starter plan' AND channel = 'x' AND content = 'launch-video' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-06' WHERE created_by = 'starter plan' AND channel = 'alternativeto' AND content = 'listing' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-07' WHERE created_by = 'starter plan' AND channel = 'itch' AND content = 'game-page' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-09' WHERE created_by = 'starter plan' AND channel = 'youtube' AND content = 'promo-90s' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-10' WHERE created_by = 'starter plan' AND channel = 'youtube' AND content = 'shorts-30s' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-10' WHERE created_by = 'starter plan' AND channel = 'tiktok' AND content = 'launch-30s' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-11' WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'webgames-launch' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-12' WHERE created_by = 'starter plan' AND channel = 'instagram' AND content = 'post-square' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-14' WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'sideproject-story' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-17' WHERE created_by = 'starter plan' AND channel = 'producthunt' AND content = 'launch' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-18' WHERE created_by = 'starter plan' AND channel = 'hackernews' AND content = 'show-hn' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-19' WHERE created_by = 'starter plan' AND channel = 'pinterest' AND content = 'printable-pin' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-21' WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'playmygame' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-23' WHERE created_by = 'starter plan' AND channel = 'facebook' AND content = 'groups-printable' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-24' WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'logicpuzzles-daily' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-11-30' WHERE created_by = 'starter plan' AND channel = 'microsoftstore' AND content = 'pwa-listing' AND post_on IS NULL;
UPDATE campaign_ads SET post_on = '2026-12-07' WHERE created_by = 'starter plan' AND channel = 'indiehackers' AND content = 'launch-post' AND post_on IS NULL;
