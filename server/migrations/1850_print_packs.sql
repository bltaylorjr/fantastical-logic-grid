-- Printable puzzle packs (src/print-packs.js): signed-in players can print a
-- small pack of brand-new puzzles a few times each period. One row per pack
-- printed, and one row per story in it so a story is never handed out twice
-- to the same account, on any device. Deleting the account removes both;
-- the nightly cleanup drops rows after 400 days.
CREATE TABLE IF NOT EXISTS print_packs (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid   TEXT NOT NULL,                       -- the player's account id
  at    INTEGER NOT NULL,                    -- when it was printed (ms)
  count INTEGER NOT NULL                     -- puzzles in the pack
);
CREATE INDEX IF NOT EXISTS print_packs_uid ON print_packs (uid, at);
CREATE TABLE IF NOT EXISTS print_pack_stories (
  uid      TEXT NOT NULL,
  story_id TEXT NOT NULL,                    -- puzzle.story.id from the engine
  at       INTEGER NOT NULL,
  PRIMARY KEY (uid, story_id)
);
CREATE INDEX IF NOT EXISTS print_pack_stories_at ON print_pack_stories (at);
