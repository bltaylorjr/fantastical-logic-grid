-- Bobby approved every starter ad on 2026-10-26 ("all approved"): set them to
-- Approved to post and make the launch campaign active (posting starts 2 Nov).
UPDATE campaign_ads SET status = 'approved', updated_at = 1793044800000 WHERE created_by = 'starter plan' AND status = 'draft';
UPDATE campaigns SET status = 'active', updated_at = 1793044800000 WHERE code = 'launch-2026' AND status = 'draft';
