-- "A storyline idea" in the game's Ideas box now has a "Which theme is it
-- for?" picker (web/js/feedback.js). The theme id is kept with the idea so
-- the admin inbox can show it; empty for every other kind of message.
ALTER TABLE feedback ADD COLUMN theme TEXT;
