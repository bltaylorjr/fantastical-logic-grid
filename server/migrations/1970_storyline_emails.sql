-- Storyline submissions (replies.js): a story idea from a signed-in player who
-- ticked "Email me an update" gets exactly one email. When the team approves
-- the storyline, that email thanks them, carries the team's note and the first
-- puzzle made with it as a PDF with its answer key (kind story_approved), and
-- the puzzle waits in the player's game for 30 days (player_puzzles). If the
-- idea is closed without being used, the one email is a plain thank-you.
--   topic      the idea's topic ('story' for storylines), on the held row
--   user_id    the player's account id, only while the row is held (to store
--              the puzzle for them); removed with the address once sent
--   puzzle_id  the stored puzzle the email attaches (player_puzzles.id)
ALTER TABLE feedback_replies ADD COLUMN topic TEXT;
ALTER TABLE feedback_replies ADD COLUMN user_id TEXT;
ALTER TABLE feedback_replies ADD COLUMN puzzle_id INTEGER;
