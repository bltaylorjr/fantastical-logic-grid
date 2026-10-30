-- Lifelike faces for the talking characters (pictures.js, kind 'face'). Each
-- is painted once by Workers AI and kept here for every player.
CREATE TABLE IF NOT EXISTS faces (
  key TEXT PRIMARY KEY,
  image BLOB NOT NULL,
  made_at INTEGER NOT NULL
);
