-- Every account that has signed in to the game, even one that has not chosen
-- a screen name or synced anything yet (src/sync.js recordSignIn). Before
-- this, a new account only reached the game's server once it had a name or
-- synced, so the admin Players list could not show players who signed up or
-- signed in and stopped there. last_at is updated at most every 10 minutes.
-- counted = 1: this first sign-in counted the account as made in account_days
-- (it had no name or synced saves yet), so its first sync does not count it again.
CREATE TABLE IF NOT EXISTS account_logins (
  user_id  TEXT PRIMARY KEY,
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL,
  counted  INTEGER NOT NULL DEFAULT 0
);
