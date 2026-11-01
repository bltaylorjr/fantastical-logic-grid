// Builds the first puzzle from an approved storyline (server/FEEDBACK-EMAILS.md),
// with the game's own engine: the player's lists become a custom world
// (admin/storyline-parse.js, engine/src/classroom.js) and the engine makes a
// fully checked puzzle from it (Medium with 4 lists, Easy with 3). Run by
// scripts/feedback-replies.py when the approval email is sent; the puzzle is
// then stored in the player's game and printed as the PDF.
// Usage: node scripts/storyline-puzzle.mjs <in.json> <out.json>
//   in.json:  { "text": "the storyline", "theme": "theme name or empty", "seed": "any" }
//             or { "submission": { "form": {...}, "polished": {...} }, "seed": "any" } for an entry
//             from the Suggest a storyline page (its corrected words and the level the author chose)
//   out.json: the puzzle, or { "error": "why" } (exit code 3) when the
//             storyline has no lists the game can read.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePuzzle } from '../engine/src/index.js';
import { checkCustom } from '../engine/src/classroom.js';
import { readStoryline, readSubmission } from '../admin/storyline-parse.js';

const ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa', 'theorist'];

// The genders the author chose for their characters (Male or Female on the
// form) go with the puzzle, so the game says he or she and picks a fitting
// voice and face (web/js/gender.js reads puzzle.characters). inCast: false, so
// they carry no portrait or lines of their own.
function withGenders(p, submission) {
  const chosen = (submission?.form?.characters || []).filter((c) => c && (c.gender === 'Male' || c.gender === 'Female'));
  const names = new Set((p.categories?.[0]?.items || []).map((i) => i.label));
  const list = chosen.filter((c) => names.has(String(c.name).trim())).map((c) => ({ name: String(c.name).trim(), gender: c.gender === 'Female' ? 'f' : 'm', inCast: false }));
  if (list.length) p.characters = list;
  return p;
}

export function buildStorylinePuzzle({ text, theme = '', seed = 'storyline', submission = null }) {
  const read = submission ? readSubmission(submission.form, submission.polished, theme) : readStoryline(text, theme);
  if (!read.def) return { error: read.reason };
  const checked = checkCustom(read.def);
  if (checked.errors) return { error: checked.errors.join(' ') };
  const custom = checked.value;
  const most = Math.min(...custom.categories.map((c) => c.items.length), custom.names.length >= 3 ? custom.names.length : 8);
  // 4 categories (Medium) when there are enough lists, otherwise 3 (Easy);
  // 5 items when every list has enough, so the size always suits the level.
  const categories = Math.min(4, custom.categories.length + 1);
  const items = Math.max(4, Math.min(5, most));
  // A number list keeps only as many values as the puzzle uses, so its
  // "runs from ... to ..." line matches the grid.
  for (const c of custom.categories) if (c.order) c.items = c.items.slice(0, items);
  let levels = categories >= 4 ? ['medium', 'easy'] : ['easy', 'basic'];
  // The level the author picked, when the grid can carry it (Medium and up need
  // 4 categories); the usual levels are the fallback.
  const asked = ORDER.indexOf(read.difficulty || '');
  if (asked >= 0) levels = [...new Set([ORDER[Math.min(asked, categories >= 4 ? ORDER.length - 1 : 1)], ...levels])];
  let last;
  for (const difficulty of levels) {
    try {
      const p = generatePuzzle({ difficulty, custom, categories, items: difficulty === 'basic' ? Math.min(items, 4) : items, seed: `${seed}-${difficulty}`, timeLimitMs: 30000 });
      if (p.stats.meetsTier || difficulty === levels[levels.length - 1]) return withGenders(p, submission);
    } catch (e) { last = e; }
  }
  return { error: `The engine could not build a puzzle from it (${last?.message || 'unknown'}).` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) { console.error('Usage: node scripts/storyline-puzzle.mjs <in.json> <out.json>'); process.exit(2); }
  const out = buildStorylinePuzzle(JSON.parse(readFileSync(inFile, 'utf8')));
  writeFileSync(outFile, JSON.stringify(out));
  if (out.error) { console.error(out.error); process.exit(3); }
}
