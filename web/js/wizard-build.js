// Builds the Puzzle Wizard's puzzle from a checked entry (wizard-fields.js),
// checks that it has exactly one answer, makes its PDF and saves it to the
// player's Saved puzzles.
//
// - The Fantastical Logic Grid: the engine writes the clues for the author's
//   world (generatePuzzle with custom and, when the author chose it, their
//   answer key). The engine proves every puzzle has exactly one answer.
// - NINETIMESNINE: a grid the wizard makes (generateNumberPlace), or the
//   author's own starting numbers, checked here: exactly one answer, and
//   reachable by reasoning alone (no guessing), with a suggestion when not.
import { flgWorld, checkEntry, cellName, NTN_LEVELS } from './wizard-fields.js';
import { npAnalyze, npGenerate } from './np-engine.js';
import { flgPdf, ntnPdf } from './wizard-pdf.js';

const seedOf = () => Math.floor(Math.random() * 2 ** 32).toString(36);

// ---------------------------------------------------------------- one-answer check
// For an author's NINETIMESNINE numbers: { ok, words, suggestion: { cell, digit } | null, level }.
// The solving is engine/src/number-place-wizard.js (on the puzzle server in server mode).
export async function checkGivens(v) {
  const N = Number(v.size);
  const a = await npAnalyze({ size: N, diagonal: !!v.diagonal, givens: v.givens.slice(0, N * N) });
  if (a.count === 0) {
    return { ok: false, words: 'These starting numbers cannot all fit: there is no way to fill the grid. Remove or change the last number you added.', suggestion: null };
  }
  const { cell: c, digit } = a.suggestion || {};
  if (a.count > 1) {
    return a.unique
      ? { ok: false, words: `These numbers allow more than one answer. Add a ${digit} at ${cellName(N, c)} and there is only one.`, suggestion: a.suggestion }
      : { ok: false, words: `These numbers allow more than one answer. Add more starting numbers; for example a ${digit} at ${cellName(N, c)}.`, suggestion: a.suggestion };
  }
  if (!a.solved) {
    return { ok: false, words: `There is exactly one answer, but players would have to guess to find it. Add a ${digit} at ${cellName(N, c)} so it can be reasoned out.`, suggestion: a.suggestion, oneAnswer: true };
  }
  const level = levelName(a.levelId);
  return { ok: true, words: `Exactly one answer, and it can be found by reasoning alone (${level}).`, suggestion: null, solution: a.solution, analysis: a, level };
}

const levelName = (id) => (NTN_LEVELS.find(([x]) => x === id) || ['', 'Medium'])[1];

// ---------------------------------------------------------------- building
// Returns { game, puzzle, pdf (Uint8Array), credit }. Throws an Error with
// words for the author when the puzzle cannot be built.
export async function buildPuzzle(entry, { seed = seedOf(), credit = '', paper = 'letter', generate } = {}) {
  const { value: v, ready, errors } = checkEntry(entry);
  if (!ready) throw new Error(Object.values(errors)[0]);
  if (v.game === 'ninetimesnine') {
    const puzzle = await buildNtn(v, seed);
    return { game: v.game, puzzle, pdf: ntnPdf(puzzle, { paper, credit }), credit };
  }
  const w = flgWorld(v);
  const opts = { custom: w.custom, answer: w.answer || undefined, difficulty: v.difficulty, categories: v.categories.length + 1, items: v.names.length, seed, questions: 3, title: v.title };
  const puzzle = await (generate || (await import('./engine-client.js')).generate)(opts);
  // The author's look (colors, pictures, music) and credit go with the puzzle.
  puzzle.wizard = { look: v.look || null, credit: credit || null, tone: v.tone || null };
  return { game: v.game, puzzle, pdf: flgPdf(puzzle, { paper, credit }), credit };
}

async function buildNtn(v, seed) {
  const N = Number(v.size);
  const variants = v.diagonal ? ['diagonal'] : [];
  const story = { id: `wizard-${seed}`, theme: { id: v.world || 'vault', name: 'Puzzle Wizard', world: v.world || 'mystery' }, title: v.title, intro: `${v.opening}${v.stakes ? ` ${v.stakes}` : ''}`, ending: v.ending };
  if (v.givensMode === 'auto') {
    const p = await npGenerate({ difficulty: v.level || 'medium', size: N, variants, seed, story: false });
    return { ...p, id: `np-wizard-${seed}`, story };
  }
  const check = await checkGivens(v);
  if (!check.ok) throw new Error(check.words);
  const { analysis: a } = check;
  return {
    kind: 'number-place', id: `np-wizard-${seed}`, seed, difficulty: { id: a.levelId, name: check.level }, size: N, box: a.puzzle.box, variants,
    givens: a.puzzle.givens, evenCells: [], solution: a.puzzle.solution,
    solvePath: a.puzzle.solvePath, hardestTechnique: a.puzzle.hardestTechnique, techniques: a.puzzle.techniques,
    toughness: a.puzzle.toughness, fingerprint: a.puzzle.fingerprint,
    rules: [`Fill every empty cell with a number from 1 to ${N}.`, `Each row, each column and each ${a.puzzle.box.join('×')} box holds every number exactly once.`, ...(v.diagonal ? ['Both long diagonals also hold every number exactly once.'] : [])],
    story,
  };
}

// ---------------------------------------------------------------- saving
const MINUTES_PER_CELL = { basic: 0.05, easy: 0.08, medium: 0.12, hard: 0.18, expert: 0.25, mensa: 0.35, theorist: 0.45 };
const newId = () => (crypto.randomUUID && crypto.randomUUID()) || `s${Date.now()}${Math.random().toString(36).slice(2)}`;

// Saves the built puzzle where the game lists it: Saved puzzles in The
// Fantastical Logic Grid (the game's own store), or NINETIMESNINE's saved games.
export async function savePuzzle(built, { store } = {}) {
  const now = Date.now();
  if (built.game === 'ninetimesnine') {
    const key = 'flg.np.games';
    let all = {};
    try { all = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { all = {}; }
    const p = built.puzzle;
    const id = `g${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    all[id] = {
      id, p, mode: 'free', daily: null, practice: null, tuned: null, name: p.story.title,
      v: Array(p.size ** 2).fill(0), n: Array(p.size ** 2).fill(0), undo: [], redo: [],
      ms: 0, hints: 0, mistakes: 0, checks: 0, stuck: [], solved: false, revealed: false,
      created: now, updated: now, sel: p.givens.findIndex((d) => !d), style: 'classic', wizard: true,
    };
    localStorage.setItem(key, JSON.stringify(all));
    return { id, where: 'NINETIMESNINE, Saved puzzles' };
  }
  const p = built.puzzle;
  const K = p.categories.length; const N = p.categories[0].items.length;
  const save = {
    id: newId(), name: p.title, storyId: String(p.story.id), puzzle: p,
    marks: {}, ticked: [], answers: {}, undo: [], redo: [],
    hintsUsed: 0, checksUsed: 0, elapsedMs: 0, mistakes: 0, expectedMs: (K * (K - 1) / 2) * N * N * (MINUTES_PER_CELL[p.difficulty.id] || 0.2) * 60000,
    focus: null, view: 'grid', solved: false, revealed: false, completedAt: null, coach: false,
    created: now, lastPlayed: now, percent: 0, wizard: true,
  };
  const s = store || await import('./store.js');
  await s.putSave(save);
  return { id: save.id, where: 'The Fantastical Logic Grid, Saved puzzles' };
}

// Offers the PDF as a file download.
export function downloadPdf(bytes, title) {
  const name = `${String(title || 'puzzle').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'puzzle'}.pdf`;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

// Opens the PDF in a frame and prints it (the browser's own print window).
export function printPdf(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const f = Object.assign(document.createElement('iframe'), { src: url, title: 'Printable puzzle' });
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(url, '_blank', 'noopener'); } };
  document.body.append(f);
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120_000);
}
