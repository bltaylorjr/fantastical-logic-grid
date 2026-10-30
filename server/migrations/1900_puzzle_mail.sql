-- Puzzle emails (src/puzzle-mail.js): the weekly puzzle and special edition
-- puzzles by email, for players and guests. A guest's address is only used
-- after they open the confirm link we email them; a signed-in player's
-- confirmed account address needs no second check. Unsubscribing from both
-- lists, the admin removing it, or deleting the account removes the row.
CREATE TABLE IF NOT EXISTS puzzle_mail (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE,          -- lower case
  uid          TEXT,                          -- the account, when signed up signed in
  weekly       INTEGER NOT NULL DEFAULT 0,    -- confirmed lists
  special      INTEGER NOT NULL DEFAULT 0,
  token        TEXT NOT NULL UNIQUE,          -- random, for the unsubscribe and settings links
  want         TEXT,                          -- lists waiting for the confirm link ('weekly,special')
  confirm      TEXT UNIQUE,                   -- random, the confirm link while one is waiting
  confirm_due  INTEGER NOT NULL DEFAULT 0,    -- 1 = a confirm email is waiting to be sent
  confirm_at   INTEGER,                       -- when the last confirm email was asked for
  confirm_day  TEXT,                          -- the day (UTC) of confirm_n
  confirm_n    INTEGER NOT NULL DEFAULT 0,    -- confirm emails asked for that day
  source       TEXT NOT NULL DEFAULT 'game',  -- game | account | admin
  created_at   INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS puzzle_mail_due ON puzzle_mail (confirm_due, confirm_at);
CREATE INDEX IF NOT EXISTS puzzle_mail_uid ON puzzle_mail (uid);

-- Who has had which send ('weekly-2026-11-02', 'special-<id>'), so a send is
-- never repeated; a failed address is taken off again and tried next run.
CREATE TABLE IF NOT EXISTS puzzle_mail_got (
  send    TEXT NOT NULL,
  mail_id INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (send, mail_id)
);
CREATE INDEX IF NOT EXISTS puzzle_mail_got_at ON puzzle_mail_got (at);

-- Puzzle emails handed to the sender each day (UTC), for the daily cap.
CREATE TABLE IF NOT EXISTS puzzle_mail_days (
  day TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);

-- Special edition puzzles, planned in the admin dashboard. The website build
-- (scripts/seo.mjs) makes each one's puzzle with a story never used before,
-- in date order with the daily and weekly puzzles, so an edition can only be
-- changed or cancelled before its day.
CREATE TABLE IF NOT EXISTS special_editions (
  id         TEXT PRIMARY KEY,                -- like se-2026-11-26-k3f9
  date       TEXT NOT NULL,                   -- the day it comes out (UTC)
  title      TEXT NOT NULL,
  note       TEXT NOT NULL,                   -- a few words to players, in the email and the game
  theme      TEXT,
  difficulty TEXT,
  categories INTEGER,
  items      INTEGER,
  status     TEXT NOT NULL DEFAULT 'planned', -- planned | cancelled
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS special_editions_date ON special_editions (date);
