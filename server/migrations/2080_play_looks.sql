-- What each finished puzzle looked like, so the weekly improvement run can
-- learn from the picture clues and the color looks (report.js quality()).
-- Still nothing personal: two short words from a fixed list.
ALTER TABLE plays ADD COLUMN look TEXT;  -- light, dark or contrast (the colors the player saw)
ALTER TABLE plays ADD COLUMN pic TEXT;   -- none, off, locked or solved (the picture clue)
