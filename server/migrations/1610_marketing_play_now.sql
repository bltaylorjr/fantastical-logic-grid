-- Starter ads land on a quick Easy puzzle (?play=now) instead of the setup screen.
UPDATE campaign_ads SET landing = '/?play=now' WHERE created_by = 'starter plan' AND landing = '/';
