-- Guest puzzles (src/guest-plays.js): how many new puzzles guests started on a
-- day, per device and per internet connection. who is a one-way hash (of the
-- device's random id, or of the connection's address with that day's salt);
-- no address or id is kept. Rows go after 3 days (src/upkeep.js).
CREATE TABLE IF NOT EXISTS guest_plays (
  day  TEXT NOT NULL,
  who  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);

-- A random salt for each day's connection hashes, made by the Worker on the
-- day's first guest puzzle and deleted with that day's counts.
CREATE TABLE IF NOT EXISTS guest_salts (
  day   TEXT PRIMARY KEY,
  salt  TEXT NOT NULL
);
