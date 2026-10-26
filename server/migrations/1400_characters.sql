-- The game's own characters, made in the admin dashboard's Character creator
-- (src/characters.js). Published ones join puzzles as cast members or tell
-- the story as its narrator, with their own portrait, voice and lines.
-- Players can suggest one from the game; it waits here for review.
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,            -- short id from the name, for example 'captain-mo'
  name TEXT NOT NULL,             -- as players see it in the grid
  gender TEXT NOT NULL,           -- 'f' or 'm': drives both the portrait and the voice
  personality TEXT NOT NULL,      -- a few words for the AI writer and painter
  look TEXT NOT NULL DEFAULT '',  -- what the AI portrait should show
  role TEXT NOT NULL,             -- 'cast', 'narrator' or 'both'
  themes TEXT NOT NULL,           -- JSON list of theme ids; [] = every theme
  style TEXT NOT NULL,            -- 'notionists', 'lorelei', 'openPeeps' or 'ai'
  seed TEXT NOT NULL,             -- the drawn face for the built-in styles
  voice TEXT NOT NULL,            -- JSON { gemini, kokoro, speed }
  lines TEXT NOT NULL,            -- JSON { clue: [], hint: [], solve: [] }
  portrait BLOB,                  -- the AI portrait (JPEG), when style is 'ai'
  portrait_at INTEGER,            -- when it was painted (ms)
  status TEXT NOT NULL DEFAULT 'draft', -- 'suggested' (from a player), 'draft' or 'published'
  source TEXT NOT NULL DEFAULT 'admin', -- 'admin' or 'player' (the game's Suggest a character questions)
  voice_style TEXT NOT NULL DEFAULT '',  -- what a player asked the voice to sound like
  version INTEGER NOT NULL DEFAULT 0,   -- goes up on every publish
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS characters_status ON characters (status);
