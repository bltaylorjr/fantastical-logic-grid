-- Every account has a screen name. An account that signed up or signed in
-- without choosing one is given a made-up name from the Suggest a name list
-- (src/auto-names.js), so it never sits nameless. auto_named = 1 until the
-- player keeps or changes that name: the game asks them at their next sign-in.
ALTER TABLE players ADD COLUMN auto_named INTEGER NOT NULL DEFAULT 0;
