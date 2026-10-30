-- The Instagram and TikTok ads' notes said to paste each post's tracked link
-- into the profile bio. The bio now points at thelogicgrid.com/links/, which
-- lists the newest posts with their tracked links (GET /v1/links), so the
-- notes say that instead. Only the starter plan's untouched notes change.
UPDATE campaign_ads SET notes = 'Instagram does not make links in captions clickable: the profile bio links to thelogicgrid.com/links/, which lists this post with its tracked link once it is posted.'
  WHERE created_by = 'starter plan' AND channel = 'instagram' AND notes LIKE 'Instagram does not make links in captions clickable: put {link} in the profile bio%';
UPDATE campaign_ads SET notes = 'The profile bio links to thelogicgrid.com/links/, which lists this Reel with its tracked link once it is posted.'
  WHERE created_by = 'starter plan' AND notes = 'Put {link} in the profile bio while this is the newest Reel.';
UPDATE campaign_ads SET notes = 'The profile bio links to thelogicgrid.com/links/, which lists this video with its tracked link once it is posted (TikTok shows bio links once the account is allowed one. Until then say "search The Fantastical Logic Grid").'
  WHERE created_by = 'starter plan' AND channel = 'tiktok' AND notes LIKE 'Put {link} in the profile bio while this is the newest video%';
UPDATE campaign_ads SET notes = 'The profile bio links to thelogicgrid.com/links/, which lists this video with its tracked link once it is posted.'
  WHERE created_by = 'starter plan' AND notes = 'Put {link} in the profile bio while this is the newest video.';
