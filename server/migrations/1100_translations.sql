-- Translations of the game's text for players who choose another language
-- (src/translate.js). Each English text is translated once per language and
-- kept here for every player; the daily cleanup removes ones unused for 180 days.
CREATE TABLE IF NOT EXISTS translations (
  lang TEXT NOT NULL,           -- the language code, for example 'es'
  hash TEXT NOT NULL,           -- SHA-256 of the English text
  text TEXT NOT NULL,           -- the translation
  day TEXT NOT NULL,            -- YYYY-MM-DD (UTC) it was last used
  PRIMARY KEY (lang, hash)
);
CREATE INDEX IF NOT EXISTS translations_day ON translations (day);
