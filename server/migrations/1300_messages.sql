-- Messages between signed-in players and the game's team, and news for
-- everyone (src/messages.js). The admin dashboard's Communication section
-- reads and answers them.
--
-- A conversation belongs to one account (user_id). It starts when a player
-- writes to the team from Menu > Messages, when a player ticks "Let the team
-- reply to me" on an idea or problem (that feedback row then points at the
-- conversation; every other feedback row stays anonymous), or when an admin
-- writes to a player. Done conversations go after 180 days (upkeep.js), and
-- everything here goes when the account is deleted.
CREATE TABLE IF NOT EXISTS conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  topic         TEXT NOT NULL,                -- question, idea, problem or team (started by an admin)
  subject       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open', -- open or done
  player_unread INTEGER NOT NULL DEFAULT 0,   -- team messages the player has not opened
  admin_unread  INTEGER NOT NULL DEFAULT 0,   -- player messages no admin has opened
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  done_at       INTEGER
);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations (user_id, updated_at);
CREATE INDEX IF NOT EXISTS conversations_status ON conversations (status, updated_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender          TEXT NOT NULL,              -- player or team
  author          TEXT,                       -- the admin's email for team messages (only shown in the dashboard)
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_messages_conv ON conversation_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_messages_sender ON conversation_messages (sender, created_at);

-- Players who turned on "Email me when the team writes". The address is the
-- account's own confirmed email; turning it off, or deleting the account,
-- removes it. The email only says there is a new message, never what it says.
CREATE TABLE IF NOT EXISTS message_contacts (
  user_id    TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- News: a longer note from the team that every player sees in Messages
-- (announcements are the short banners on the home screen).
CREATE TABLE IF NOT EXISTS news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ends_at    INTEGER
);

ALTER TABLE feedback ADD COLUMN conversation_id INTEGER;
