-- Sign in with a screen name: the account email behind each screen name, taken
-- from the player's verified sign-in token. It is never shown or sent to
-- anyone; the Worker only uses it to pass a screen-name sign-in to Firebase.
ALTER TABLE players ADD COLUMN email TEXT;
