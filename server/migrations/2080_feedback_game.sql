-- Which game an idea or a problem report came from, so each game's inbox can
-- be read on its own (admin > Communication and Error tracking have a Game
-- filter; admin > Number Place lists its own). Everything sent before this
-- came from The Fantastical Logic Grid.
--   game  logic-grid | number-place
ALTER TABLE feedback ADD COLUMN game TEXT NOT NULL DEFAULT 'logic-grid';
ALTER TABLE puzzle_reports ADD COLUMN game TEXT NOT NULL DEFAULT 'logic-grid';
CREATE INDEX IF NOT EXISTS feedback_game ON feedback (game, kind, status, created_at);
CREATE INDEX IF NOT EXISTS puzzle_reports_game ON puzzle_reports (game, category, created_at);
