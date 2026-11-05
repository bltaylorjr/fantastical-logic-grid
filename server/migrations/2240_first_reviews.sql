-- Rate this puzzle on every game: NINETIMESNINE and the grid-kit games now
-- take 1 to 5 stars too. Only a player's first rating (and first "how did it
-- feel") of a game counts: a later change from the same game (same pid) is
-- ignored by the service (learn.js, number-place.js, kit-games.js).
ALTER TABLE np_plays ADD COLUMN rating INTEGER;
ALTER TABLE kit_plays ADD COLUMN rating INTEGER;
