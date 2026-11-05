-- Races in every game: the game a race (and a race score) belongs to. 'flg'
-- is The Fantastical Logic Grid; np NINETIMESNINE, cm Cage Math, sc Sum
-- Cross, pg Picture Grid (server/src/compete.js, GAMES).
ALTER TABLE races ADD COLUMN game TEXT NOT NULL DEFAULT 'flg';
ALTER TABLE scores ADD COLUMN game TEXT NOT NULL DEFAULT 'flg';
