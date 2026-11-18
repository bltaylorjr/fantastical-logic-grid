-- Guests now get 3 new puzzles a WEEK, not a day (src/guest-plays.js, 18 Nov 2026).
-- Starter ads not yet posted that still have the old guest line say "a week" now;
-- only that line changes, and posted ads stay as they are.
UPDATE campaign_ads SET body = REPLACE(REPLACE(REPLACE(body,
    'Guests can play a few new puzzles a day', 'Guests can play a few new puzzles a week'),
    'Guests can play a few puzzles a day', 'Guests can play a few puzzles a week'),
    'Guests can try a few puzzles a day', 'Guests can try a few puzzles a week')
  WHERE created_by = 'starter plan' AND status <> 'posted'
    AND (body LIKE '%Guests can play a few new puzzles a day%' OR body LIKE '%Guests can play a few puzzles a day%' OR body LIKE '%Guests can try a few puzzles a day%');
