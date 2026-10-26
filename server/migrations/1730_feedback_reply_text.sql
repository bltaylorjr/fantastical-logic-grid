-- "Email me an update" (src/replies.js): the thank-you email now quotes what
-- the player wrote, and a second email goes when the team marks that idea or
-- problem addressed, with the team's note on what was done. The player's
-- words and the note are kept only until the email is sent, like the address.
-- feedback_id links the held update to its idea or problem until then; the
-- feedback row itself still has nothing about the player.
ALTER TABLE feedback_replies ADD COLUMN text TEXT;        -- what the player wrote (cleaned), until sent
ALTER TABLE feedback_replies ADD COLUMN note TEXT;        -- the team's "what we did" note, for an update
ALTER TABLE feedback_replies ADD COLUMN feedback_id INTEGER; -- the idea or problem an update is about
CREATE INDEX IF NOT EXISTS feedback_replies_feedback ON feedback_replies (feedback_id, status);
