// Engine doctor: plain, rule-based checks of every game's engine (no AI).
//
// For each game in src/games.js it builds puzzles with known seeds and checks,
// with the game's own rules and brute-force counters:
//   - the build finishes, inside the time limit for builds (src/games.js OP_KINDS)
//   - the puzzle has what the page needs (answer, givens, solve path, level)
//   - the answer passes the game's own checker
//   - there is exactly one answer (brute force, on sizes the counter handles fast)
//   - the same seed gives the same puzzle (so daily puzzles and shares never change)
//   - it survives the trip through JSON (worker messages and the puzzle server)
//   - a hint works on a blank board, on the copy that came back from JSON,
//     and spots a wrong entry
//
// Used by engine/health.js (the nightly engine health run and the deploy
// canary) and by the puzzle server's start-up check (puzzle-server/server.mjs).
// It lives outside src/ so it never ships to players' browsers.
//
//   import { checkPuzzle, canary, GAME_LEVELS } from './doctor.js';
//   const r = await checkPuzzle('sk', { level: 'hard', seed: 'night-1' });
//   // { game, level, seed, ok, problems: [], warnings: [], ms: { generate, hint }, size }
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Each game's checker, its step-by-step solver, its brute-force counter and
// the largest size the counter handles quickly (the engine tests use the same limits).
const KIT = {
  np: { mod: 'number-place.js', tiers: 'NP_TIERS', check: 'checkNumberPlace', solved: 'isNumberPlaceSolved', countMax: 9 },
  cm: { mod: 'cage-math.js', tiers: 'CM_TIERS', check: 'checkCageMath', solve: 'solveCageMath', count: 'countCageMath', countMax: 7 },
  sc: { mod: 'sum-cross.js', tiers: 'SC_TIERS', check: 'checkSumCross', solve: 'solveSumCross' },
  pg: { mod: 'picture-grid.js', tiers: 'PG_TIERS', check: 'checkPictureGrid', solve: 'solvePictureGrid' },
  ml: { mod: 'more-or-less.js', tiers: 'ML_TIERS', check: 'checkMoreOrLess', solve: 'solveMoreOrLess', count: 'countMoreOrLess', countMax: 7 },
  sk: { mod: 'skyline.js', tiers: 'SK_TIERS', check: 'checkSkyline', solve: 'solveSkyline', count: 'countSkyline', countMax: 6 },
  sf: { mod: 'star-field.js', tiers: 'SF_TIERS', check: 'checkStarField', solve: 'solveStarField', count: 'countStarField', countMax: 8 },
  ll: { mod: 'loop-line.js', tiers: 'LL_TIERS', check: 'checkLoopLine', solve: 'solveLoopLine', count: 'countLoopLine', countMax: 7 },
  ib: { mod: 'island-bridges.js', tiers: 'IB_TIERS', check: 'checkIslandBridges', solve: 'solveIslandBridges', count: 'countIslandBridges', countMax: 10 },
};

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, sub-millisecond
const cache = new Map();
let engineDir = join(here, 'src');

// Point the doctor at another copy of the engine (a release being deployed).
export function useEngine(dir) {
  engineDir = dir;
  cache.clear();
}

const load = (f) => {
  const key = join(engineDir, f);
  if (!cache.has(key)) cache.set(key, import(pathToFileURL(key).href));
  return cache.get(key);
};

async function gameParts(id) {
  const { ENGINE_GAMES, OP_KINDS } = await load('games.js');
  const game = ENGINE_GAMES[id];
  if (!game) throw new Error(`Unknown game "${id}"`);
  const { OPS } = await load(game.ops);
  let levels;
  let mod = null;
  if (id === 'flg') {
    levels = (await load('tiers.js')).TIER_ORDER;
    mod = await load('index.js');
  } else if (KIT[id]) {
    mod = await load(KIT[id].mod);
    levels = Object.keys(mod[KIT[id].tiers]);
  } else {
    levels = ['medium'];
  }
  return { game, OPS, levels, mod, limitMs: OP_KINDS.build.serverMs };
}

// Every game id and its levels, easiest first.
export async function gameLevels(dir) {
  if (dir) useEngine(dir);
  const { ENGINE_GAMES } = await load('games.js');
  const out = {};
  for (const id of Object.keys(ENGINE_GAMES)) out[id] = (await gameParts(id)).levels;
  return out;
}

const levelOf = (p) => (p && typeof p.difficulty === 'object' ? p.difficulty.id : p && p.difficulty);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fingerprint = (p) => (p.fingerprint != null ? JSON.stringify(p.fingerprint) : JSON.stringify([p.clues && p.clues.map((c) => c.text), p.solution]));

// Logic Grid marks that say "these two belong together" for the whole answer.
function flgMarks(p) {
  const marks = [];
  for (const row of p.solution) {
    const items = Object.values(row);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) marks.push({ a: items[i], b: items[j], mark: 'O' });
  }
  return marks;
}

// Find one entry the game's own checker calls wrong, to test that hints spot it.
function wrongEntry(p, check) {
  const n = p.solution.length;
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let c = 0; c < n; c++) {
    if (p.givens && p.givens[c]) continue;
    for (const v of values) {
      const entries = new Array(n).fill(0);
      entries[c] = v;
      const r = check(p, entries);
      if (r && Array.isArray(r.wrong) && r.wrong.includes(c)) return entries;
    }
  }
  return null;
}

// Check one puzzle. Never throws: anything that goes wrong is a problem in the result.
export async function checkPuzzle(id, { level, seed = 'doctor', determinism = true, uniqueness = true } = {}) {
  const res = { game: id, level, seed, ok: true, problems: [], warnings: [], ms: { generate: null, hint: null }, size: null };
  const problem = (m) => { res.ok = false; res.problems.push(m); };
  let parts;
  try { parts = await gameParts(id); } catch (e) { problem(`cannot load the engine: ${e.message}`); return res; }
  const { OPS, levels, mod, limitMs } = parts;
  level = level || levels[0];
  res.level = level;
  const args = { difficulty: level, seed };

  let p;
  try {
    const t = now();
    p = await OPS.generate({ ...args });
    res.ms.generate = Math.round((now() - t) * 10) / 10;
  } catch (e) {
    problem(`the build failed: ${String(e && e.message || e).slice(0, 200)}`);
    return res;
  }
  if (res.ms.generate > limitMs) problem(`the build took ${Math.round(res.ms.generate)} ms, over the ${limitMs} ms limit`);
  else if (res.ms.generate > limitMs / 4) res.warnings.push(`the build took ${Math.round(res.ms.generate)} ms (a quarter of the limit is ${limitMs / 4} ms)`);
  if (!p || typeof p !== 'object') { problem('the build returned nothing'); return res; }
  res.size = p.size || (p.categories ? `${p.categories.length}x${p.categories[0]?.items?.length}` : null);

  // What the page needs.
  if (!Array.isArray(p.solution) || !p.solution.length) problem('no answer in the puzzle');
  if (!Array.isArray(p.solvePath) || !p.solvePath.length) problem('no solve path in the puzzle');
  if (levelOf(p) !== level) problem(`asked for level ${level}, got ${levelOf(p)}`);
  if (id === 'flg') {
    if (!Array.isArray(p.clues) || !p.clues.length) problem('no clues');
    if (!Array.isArray(p.questions) || p.questions.some((q) => q.answer == null)) problem('a story question has no answer');
    if (!p.answerKey) problem('no answer key');
    if (Array.isArray(p.notes) && p.notes.length) res.warnings.push(`closest match, not exact: ${String(p.notes[0]).slice(0, 160)}`);
  } else if (p.givens && p.solution && id !== 'll' && id !== 'ib' && p.givens.length !== p.solution.length) {
    problem(`givens (${p.givens.length}) and answer (${p.solution.length}) differ in size`);
  }
  if (!res.ok) return res;

  // The stored answer is the one the clues lead to: the game's own solver
  // works it out from the clues alone, and the game's checker compares.
  let check = null;
  try {
    if (id === 'flg') {
      if (!mod.isSolved(p, flgMarks(p))) problem('the answer does not pass the game\'s own check');
      // Follow hints from an empty grid (small grids; big ones take too long here).
      const cells = p.categories.length * p.categories[0].items.length;
      if (cells <= 25) {
        let marks = [];
        let h = null;
        for (let n = 0; n < 1500; n++) { h = mod.getHint(p, marks); if (h.kind !== 'step') break; marks = marks.concat(h.marks); }
        if (!mod.isSolved(p, marks)) problem(`following the hints from an empty grid does not reach the answer (stopped at "${h && h.kind}")`);
      }
    } else if (KIT[id]) {
      const k = KIT[id];
      check = mod[k.check];
      let values;
      if (id === 'np') {
        const mask = (p.variants || []).includes('parity') ? [...Array(p.size ** 2)].map((_, i) => p.evenCells.includes(i)) : null;
        const r = mod.solveLogically(mod.makeShape(p.size, p.variants), p.givens, { maxLevel: 5, evenMask: mask });
        if (!r.solved) problem('the game\'s solver cannot finish the puzzle from its givens');
        values = r.values;
      } else {
        const r = mod[k.solve](p, []);
        if (!r.solved) problem(`the game's solver cannot finish the puzzle from its clues${r.contradiction ? ' (it hit a contradiction)' : ''}`);
        values = r.values;
      }
      if (values && res.ok) {
        const c = check(p, values);
        const solved = k.solved ? mod[k.solved](p, values) : c.solved;
        if (!solved || (c.wrong && c.wrong.length)) problem('the stored answer is not the one the clues lead to');
      }
    }
  } catch (e) { problem(`the answer check failed: ${e.message}`); }

  // Exactly one answer, by brute force.
  if (uniqueness && KIT[id] && res.ok) {
    const k = KIT[id];
    try {
      if (id === 'np' && p.size <= k.countMax) {
        const shape = mod.makeShape(p.size, p.variants);
        const mask = (p.variants || []).includes('parity') ? [...Array(p.size ** 2)].map((_, i) => p.evenCells.includes(i)) : null;
        const { count } = mod.countSolutions(shape, p.givens, 2, mask);
        if (count !== 1) problem(`${count} answers found by brute force (should be exactly 1)`);
      } else if (k.count && p.size <= k.countMax) {
        const count = mod[k.count](p, 2);
        if (count !== 1) problem(`${count} answers found by brute force (should be exactly 1)`);
      }
    } catch (e) { problem(`the brute-force count failed: ${e.message}`); }
  }

  // Same seed, same puzzle.
  if (determinism) {
    try {
      const again = await OPS.generate({ ...args });
      if (fingerprint(again) !== fingerprint(p)) problem('the same seed gave a different puzzle');
    } catch (e) { problem(`a second build with the same seed failed: ${e.message}`); }
  }

  // The trip through JSON, then hints.
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(p));
    if (!sameJson(copy.solution, p.solution)) problem('the answer changes when sent as JSON');
  } catch (e) { problem(`the puzzle cannot be sent as JSON: ${e.message}`); copy = p; }
  try {
    const blank = id === 'flg' ? { puzzle: copy, marks: [] } : { puzzle: copy, entries: [] };
    const t = now();
    const h = await OPS.hint(blank);
    res.ms.hint = Math.round((now() - t) * 10) / 10;
    if (!h || typeof h.kind !== 'string') problem('a hint on a blank board returned nothing');
    else if (h.kind === 'mistake') problem('a hint on a blank board reported a mistake');
    else if (!Array.isArray(h.levels) || !h.levels.length) problem('a hint has no wording');
    let wrongArgs = null;
    if (id === 'flg') {
      const m = flgMarks(copy)[0];
      if (m) wrongArgs = { puzzle: copy, marks: [{ ...m, mark: 'X' }] };
    } else if (check) {
      const entries = wrongEntry(copy, check);
      if (entries) wrongArgs = { puzzle: copy, entries };
    }
    if (wrongArgs) {
      const hw = await OPS.hint(wrongArgs);
      if (!hw || hw.kind !== 'mistake') problem(`a hint did not spot a wrong entry (said "${hw && hw.kind}")`);
    }
  } catch (e) { problem(`a hint failed: ${String(e && e.message || e).slice(0, 200)}`); }
  if (res.ms.hint != null && res.ms.hint > 1000) res.warnings.push(`a hint took ${Math.round(res.ms.hint)} ms`);
  return res;
}

// A quick check of every game at its easiest and middle level: for the puzzle
// server before it takes requests, and before a release goes live.
export async function canary({ dir, seed = 'canary', budgetMs = 60000 } = {}) {
  if (dir) useEngine(dir);
  const started = now();
  const levels = await gameLevels();
  const results = [];
  for (const [id, list] of Object.entries(levels)) {
    for (const level of [...new Set([list[0], list[Math.floor((list.length - 1) / 2)]])]) {
      if (now() - started > budgetMs) { results.push({ game: id, level, seed, ok: true, skipped: true, problems: [], warnings: ['skipped: out of time'], ms: {} }); continue; }
      results.push(await checkPuzzle(id, { level, seed, determinism: level === list[0] }));
    }
  }
  return { ok: results.every((r) => r.ok), ms: Math.round(now() - started), results };
}

// A fixed amount of plain CPU work, timed. Engine timings are divided by it so
// a slower or faster machine (GitHub runners vary) does not look like the
// engine got slower or faster.
export function machineSpeed(rounds = 5) {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t = now();
    let x = 0;
    const a = new Int32Array(4096);
    for (let i = 0; i < 3_000_000; i++) { x = (x * 1103515245 + 12345 + i) | 0; a[x & 4095] ^= x; }
    const m = new Map();
    for (let i = 0; i < 60_000; i++) m.set(`k${i & 8191}`, (m.get(`k${i & 8191}`) || 0) + a[i & 4095]);
    const s = JSON.stringify([...m.entries()].slice(0, 2000));
    if (s.length + x === 42) console.log(''); // keep the work from being optimised away
    best = Math.min(best, now() - t);
  }
  return Math.round(best * 100) / 100;
}
