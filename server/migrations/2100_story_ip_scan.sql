-- The trademark and copyright scan of a storyline submission
-- (src/ip-scan.js, admin > Storyline submissions > Scan).
--   ip_verdict  clear, check or problem (empty until scanned)
--   ip_scan     the findings, as JSON
--   ip_scan_at  when it was scanned
ALTER TABLE story_submissions ADD COLUMN ip_verdict TEXT;
ALTER TABLE story_submissions ADD COLUMN ip_scan TEXT;
ALTER TABLE story_submissions ADD COLUMN ip_scan_at INTEGER;
