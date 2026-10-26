-- Puzzle details on ideas and problems, and the version a fix shipped in
-- (src/followups.js).
--
-- puzzle: when a player sends an idea or problem while a puzzle is open (and
-- leaves "Include the puzzle I'm playing" ticked), the puzzle's own details
-- come along as JSON: story id, title, theme, topic, difficulty, seed, size,
-- engine version and the clue texts. Nothing about the player or device.
ALTER TABLE feedback ADD COLUMN puzzle TEXT;

-- The version a fix shipped in, set with "Mark addressed" (its plain-words
-- note is feedback.note, migration 1320).
ALTER TABLE feedback ADD COLUMN fixed_in TEXT;
