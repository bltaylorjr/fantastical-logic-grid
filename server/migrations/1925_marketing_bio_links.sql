-- Every ad must carry its tracked link. Two starter ads go on channels with
-- no clickable links in posts (Instagram, TikTok), so their notes now say to
-- put the ad's tracked link ({link}, filled in by the dashboard) in the
-- profile bio. Only notes still as first written are changed.
UPDATE campaign_ads SET notes = 'Instagram does not make links in captions clickable: put {link} in the profile bio while this is the newest post, so visits from the bio count for it.'
  WHERE created_by = 'starter plan' AND channel = 'instagram' AND content = 'post-square' AND notes = '';
UPDATE campaign_ads SET notes = 'Put {link} in the profile bio while this is the newest video (TikTok shows bio links once the account is allowed one. Until then say "search The Fantastical Logic Grid").'
  WHERE created_by = 'starter plan' AND channel = 'tiktok' AND content = 'launch-30s' AND notes LIKE 'Links in bio need a set follower count%';
