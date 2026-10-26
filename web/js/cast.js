// The game's own characters inside one puzzle (made in the admin dashboard,
// see characters.js). A puzzle keeps a copy of the ones it uses, so a saved
// or shared puzzle looks and sounds the same later. No imports, so the
// portrait and voice code (and the tests) can use it anywhere.

// The character called `name` in this puzzle's cast, or null.
export function characterOf(puzzle, name) {
  const list = (puzzle && puzzle.characters) || [];
  return list.find((c) => c.name === name && c.inCast) || null;
}

// The character telling this puzzle's story, or null for the usual narrator.
export function narratorOf(puzzle) {
  const list = (puzzle && puzzle.characters) || [];
  return (puzzle && puzzle.narrator && list.find((c) => c.id === puzzle.narrator)) || null;
}

// One of the character's lines for this moment ('clue', 'hint' or 'solve'),
// the same one each time for the same n, or null when they have none.
export function lineOf(c, kind, n = 0) {
  const lines = (c && c.lines && c.lines[kind]) || [];
  return lines.length ? lines[Math.abs(n) % lines.length] : null;
}
