// Skyline: fill an N×N grid with building heights so every row and column
// holds 1..N once. The numbers around the outside say how many buildings are
// seen from that side, looking along the row or column: a taller building
// hides every shorter one behind it. Every puzzle is proven by a solver that
// works the way a person does, so it has exactly one answer reachable by logic
// alone, and its difficulty is the hardest technique it needs. Where the edge
// numbers alone are not enough for a level's techniques, a few heights are given.
//
//   generateSkyline({ difficulty, size, seed, avoid, toughness, practice, usedStories, story, theme })
//   getSkylineHint(puzzle, entries)   a nudge, then where, then why
//   solveSkyline(puzzle, entries)     the logical solver (used by the tests)
//   countSkyline(puzzle)              brute-force answer count (tests)
//
// clues: { top, bottom, left, right }, each N numbers (0 for no clue). top[c]
// looks down column c, left[r] looks along row r from the left.
import { makeRng } from './rng.js';
import { bit, bitsOf, cellName, cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES, listAnd } from './kit-common.js';
import { latinSquare, latinState, latinFinders, runSolver, countLatin, pruneClues, checkLatin, latinHint, latinStory, pathOf, toughnessOf, elimText, unitName } from './latin-kit.js';
import { kitThemeStory } from './kit-story.js';

export const SK_TECHNIQUES = {
  nakedSingle: { level: 1, name: 'Only number left' },
  hiddenSingle: { level: 1, name: 'Only place left' },
  edgeOne: { level: 1, name: 'Edge 1' },
  edgeAll: { level: 1, name: 'Edge sees all' },
  distance: { level: 2, name: 'Distance limits' },
  visibility: { level: 3, name: 'Visibility counting' },
  nakedPair: { level: 4, name: 'Matching pair' },
  hiddenPair: { level: 4, name: 'Hidden pair' },
  nakedTriple: { level: 5, name: 'Matching three' },
};

// keepClues: only heights are taken away (a first puzzle keeps every edge number).
export const SK_TIERS = {
  basic: { name: 'Basic', sizes: [4], keepClues: true, maxTech: 2, minTech: 1 },
  easy: { name: 'Easy', sizes: [5, 4], keepClues: true, maxTech: 2, minTech: 2 },
  medium: { name: 'Medium', sizes: [5, 4], maxTech: 3, minTech: 3 },
  hard: { name: 'Hard', sizes: [6, 5], maxTech: 4, minTech: 3, minTop: 3 },
  expert: { name: 'Expert', sizes: [6, 7], maxTech: 5, minTech: 4 },
  master: { name: 'Master', sizes: [8, 7], maxTech: 5, minTech: 4 },
};
export const SK_SIZES = [4, 5, 6, 7, 8];
const SIDES = ['top', 'bottom', 'left', 'right'];

// How many are seen looking along `heights` from its start.
export const seen = (heights) => { let m = 0, n = 0; for (const h of heights) if (h > m) { m = h; n++; } return n; };

export function cluesOf(N, sol) {
  const row = (r) => sol.slice(r * N, r * N + N), col = (c) => [...Array(N)].map((_, r) => sol[r * N + c]);
  return {
    top: [...Array(N)].map((_, c) => seen(col(c))), bottom: [...Array(N)].map((_, c) => seen(col(c).reverse())),
    left: [...Array(N)].map((_, r) => seen(row(r))), right: [...Array(N)].map((_, r) => seen(row(r).reverse())),
  };
}

// Each row and column, with the clue at its start and at its end.
function linesOf(N, clues) {
  const out = [];
  for (let r = 0; r < N; r++) out.push({ u: r, cells: [...Array(N)].map((_, c) => r * N + c), s: clues.left[r], e: clues.right[r], sName: 'left', eName: 'right' });
  for (let c = 0; c < N; c++) out.push({ u: N + c, cells: [...Array(N)].map((_, r) => r * N + c), s: clues.top[c], e: clues.bottom[c], sName: 'top', eName: 'bottom' });
  return out;
}
const fromSide = (L, end) => (end ? L.cells.slice().reverse() : L.cells);
const showText = (n) => `${n} building${n === 1 ? '' : 's'}`;

// Every way to fill a line with its open numbers that shows its clues: the
// numbers each cell takes in at least one of them (null if there is none).
// Checked against a table of every order of 1..N.
// Remembered across solves (the generator re-solves the same lines many times).
const OPTIONS = new Map();
function lineOptions(N, masks, s, e) {
  const key = `${N}:${s}:${e}:${masks.join(',')}`;
  if (OPTIONS.has(key)) return OPTIONS.get(key);
  if (OPTIONS.size > 50000) OPTIONS.clear();
  const res = lineOptionsNow(N, masks, s, e);
  OPTIONS.set(key, res);
  return res;
}
function lineOptionsNow(N, masks, s, e) {
  const list = arrangements(N, s, e);
  const ok = Array(N).fill(0);
  let any = false;
  outer: for (let k = 0; k < list.length; k += N) {
    for (let j = 0; j < N; j++) if (!(masks[j] & (1 << (list[k + j] - 1)))) continue outer;
    any = true;
    for (let j = 0; j < N; j++) ok[j] |= 1 << (list[k + j] - 1);
  }
  return any ? ok : null;
}

// Every order of 1..N, sorted by how many show from each end (0: either).
const TABLES = new Map();
function arrangements(N, s, e) {
  if (!TABLES.has(N)) {
    const buckets = new Map(), cur = [], used = Array(N + 1).fill(false);
    const add = (key, perm) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(...perm); };
    const go = () => {
      if (cur.length === N) {
        const a = seen(cur), b = seen(cur.slice().reverse());
        add(`${a},${b}`, cur); add(`${a},0`, cur); add(`0,${b}`, cur);
        return;
      }
      for (let d = 1; d <= N; d++) if (!used[d]) { used[d] = true; cur.push(d); go(); cur.pop(); used[d] = false; }
    };
    go();
    TABLES.set(N, new Map([...buckets].map(([k, v]) => [k, Uint8Array.from(v)])));
  }
  return TABLES.get(N).get(`${s},${e}`) || new Uint8Array(0);
}

// ---------- the solver ----------

export function solveSkyline(p, entries = [], { maxTech = 5, stopAtPlace = false } = {}) {
  const N = p.size;
  const S = latinState(N);
  const lines = linesOf(N, p.clues);
  p.givens.forEach((d, c) => { if (d) S.place(c, d); });
  entries.forEach((d, c) => { if (d && !S.val[c] && S.cand[c] & bit(d)) S.place(c, d); });
  const name = (c) => cellName(N, c);
  const ends = [];
  for (const L of lines) { if (L.s) ends.push({ L, k: L.s, side: L.sName, cells: fromSide(L, false) }); if (L.e) ends.push({ L, k: L.e, side: L.eName, cells: fromSide(L, true) }); }
  const from = (x) => `the ${x.side} of ${unitName(x.L.u, N)}`;

  // Edge 1: only the tallest can be seen, so it stands right at that edge.
  function edgeOne() {
    for (const x of ends) {
      const c = x.cells[0];
      if (x.k === 1 && !S.val[c]) return { technique: 'edgeOne', place: [c, N], cells: [c], why: `Only 1 building is seen from ${from(x)}, so the tallest, ${N}, must stand right at that edge, in ${name(c)}.` };
    }
    return null;
  }
  // Edge sees all: every building shows, so they rise 1, 2, 3... from that edge.
  function edgeAll() {
    for (const x of ends) {
      if (x.k !== N) continue;
      const i = x.cells.findIndex((c) => !S.val[c]);
      if (i >= 0) return { technique: 'edgeAll', place: [x.cells[i], i + 1], cells: x.cells.slice(), why: `All ${N} buildings are seen from ${from(x)}, so they must rise 1, 2, 3 and on in order from that edge. That makes ${name(x.cells[i])} ${i + 1}.` };
    }
    return null;
  }
  // Distance limits: with k seen, the cell i steps from the edge is at most N - k + 1 + i.
  // The limits never change, so each edge is checked until it has nothing more to give.
  const spent = new Set();
  function distance() {
    for (const x of ends) {
      if (x.k < 2 || spent.has(x)) continue;
      const elim = [], limits = [];
      x.cells.forEach((c, i) => {
        const max = N - x.k + 1 + i;
        if (S.val[c] || max >= N) return;
        const ds = bitsOf(S.cand[c]).filter((d) => d > max);
        if (ds.length) { ds.forEach((d) => elim.push([c, d])); limits.push(`${name(c)} can be at most ${max}`); }
      });
      if (!elim.length) spent.add(x);
      else return { technique: 'distance', remove: elim, cells: x.cells.slice(), why: `${showText(x.k)} are seen from ${from(x)}. A building too tall too close to that edge would hide too many of the rest, so ${listAnd(limits)}.` };
    }
    return null;
  }
  // Visibility counting: try every way to fill a line with the numbers still open.
  const quiet = new Map();
  function visibility() {
    for (const L of lines) {
      if (!L.s && !L.e) continue;
      if (L.cells.every((c) => S.val[c])) continue;
      const masks = L.cells.map((c) => S.cand[c]);
      const key = masks.join(',');
      if (quiet.get(L.u) === key) continue;
      const ok = lineOptions(N, masks, L.s, L.e);
      if (!ok) { S.contradiction = true; return null; }
      const elim = [];
      L.cells.forEach((c, i) => { if (!S.val[c]) for (const d of bitsOf(S.cand[c] & ~ok[i])) elim.push([c, d]); });
      if (!elim.length) { quiet.set(L.u, key); continue; }
      const views = [L.s ? `${showText(L.s)} from the ${L.sName}` : '', L.e ? `${showText(L.e)} from the ${L.eName}` : ''].filter(Boolean).join(' and ');
      return { technique: 'visibility', remove: elim, cells: L.cells.slice(), why: `${cap(unitName(L.u, N))} must show ${views}. Try every way to fill it with the numbers still open: the ones that show that all agree that ${elimText(N, elim)}.` };
    }
    return null;
  }

  const finders = [
    { level: 1, find: edgeOne },
    { level: 1, find: edgeAll },
    { level: 1, find: (s) => latinFinders.nakedSingle(s, 'every other number is already in its row or column, or does not fit the edge numbers') },
    { level: 1, find: latinFinders.hiddenSingle },
    { level: 2, find: distance },
    { level: 3, find: visibility },
    { level: 4, find: latinFinders.nakedPair },
    { level: 4, find: latinFinders.hiddenPair },
    { level: 5, find: latinFinders.nakedTriple },
  ];
  return runSolver(S, finders, SK_TECHNIQUES, { maxTech, stopAtPlace });
}

// A brute-force count of answers (stops at `limit`), independent of the logic
// solver: fills row by row and checks each row and column against its edge
// numbers as it goes.
export function countSkyline(p, limit = 2) {
  const N = p.size, { top, bottom, left, right } = p.clues;
  const lineOk = (c, g) => {
    const r = Math.floor(c / N), k = c % N;
    // From the left and top: never more than the clue so far; at the end, exactly.
    const row = g.slice(r * N, r * N + k + 1), col = [...Array(r + 1)].map((_, i) => g[i * N + k]);
    const sr = seen(row), sc = seen(col);
    if (left[r] && (sr > left[r] || (k === N - 1 && sr !== left[r]) || sr + N - Math.max(...row) < left[r])) return false;
    if (top[k] && (sc > top[k] || (r === N - 1 && sc !== top[k]) || sc + N - Math.max(...col) < top[k])) return false;
    if (k === N - 1 && right[r] && seen(row.slice().reverse()) !== right[r]) return false;
    if (r === N - 1 && bottom[k] && seen(col.slice().reverse()) !== bottom[k]) return false;
    return true;
  };
  return countLatin(N, p.givens, { lineOk, limit });
}

// ---------- building a puzzle ----------

const clueText = (clues) => SIDES.map((s) => clues[s].join('')).join('|');
const fpOf = (N, givens, clues) => fingerprint('sk', `${N}|${givens.join('')}|${clueText(clues)}`);

function candidate(N, tier, rng) {
  const sol = latinSquare(N, rng);
  const all = cluesOf(N, sol);
  // Clues: the N*N heights, then the 4N edge numbers. Heights go first, so the
  // puzzle leans on its edges.
  const keep = Array(N * N + 4 * N).fill(true);
  const build = (k) => ({
    size: N, givens: sol.map((d, c) => (k[c] ? d : 0)),
    clues: Object.fromEntries(SIDES.map((s, j) => [s, all[s].map((v, i) => (k[N * N + j * N + i] ? v : 0))])),
  });
  const order = [...rng.shuffle([...Array(N * N).keys()]), ...(tier.keepClues ? [] : rng.shuffle([...Array(4 * N).keys()]).map((j) => N * N + j))];
  pruneClues(order, keep, (k) => solveSkyline(build(k), [], { maxTech: tier.maxTech }).solved);
  const p = build(keep);
  const res = solveSkyline(p, [], { maxTech: tier.maxTech });
  if (!res.solved) return null;
  const top = res.steps.filter((s) => SK_TECHNIQUES[s.technique].level >= tier.minTech).length;
  const fits = res.hardest >= tier.minTech && (!tier.minTop || top >= tier.minTop);
  return { sol, givens: p.givens, clues: p.clues, res, fits, score: toughnessOf(res.steps, SK_TECHNIQUES, N) + p.givens.filter(Boolean).length * -0.5 };
}

export function generateSkyline({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story = true, theme = null } = {}) {
  const tier = SK_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = SK_SIZES.includes(Number(size)) ? Number(size) : tier.sizes[0];
  if (practice && (!SK_TECHNIQUES[practice] || SK_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seenFp = new Set(avoid);
  const want = N >= 7 ? 2 : 3;
  const found = [];
  let practiceTries = 0, backup = null;
  // A time budget, so a big grid never keeps the player waiting: past it, the
  // toughest proven puzzle found so far is used.
  // The build is bounded by work, not the clock: the same seed gives the same puzzle on every device, however fast or busy (attempt counts match the old time budget on the puzzle server, Nov 2026).
  for (let attempt = 0; attempt < 200 && found.length < want; attempt++) {
    const c = candidate(N, tier, makeRng(`${seed}:${attempt}`));
    if (!c) continue;
    if (seenFp.has(fpOf(N, c.givens, c.clues))) continue;
    if (!c.fits) { if (!backup || c.res.hardest > backup.res.hardest || (c.res.hardest === backup.res.hardest && c.score > backup.score)) backup = c; continue; }
    if (practice && !c.res.steps.some((s) => s.technique === practice) && ++practiceTries < 20) continue;
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { sol, givens, clues, res } = pick;
  const p = {
    kind: 'skyline', game: 'sk',
    id: `sk-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N, givens, clues,
    solution: sol,
    solvePath: pathOf(res.steps, SK_TECHNIQUES),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: Math.round(pick.score),
    fingerprint: fpOf(N, givens, clues),
    rules: [
      `Fill every cell with a building from 1 to ${N} floors tall.`,
      'Each row and each column holds every height exactly once.',
      'A number at the edge says how many buildings you see looking along that row or column from there. Taller buildings hide shorter ones behind them.',
    ],
  };
  if (story) p.story = kitThemeStory('sk', seed, { theme, used: usedStories, classic: () => latinStory('sk', seed, usedStories) });
  return p;
}

export const checkSkyline = checkLatin;

export function getSkylineHint(p, entries = []) {
  const N = p.size;
  return latinHint(p, entries, {
    solve: solveSkyline, techniques: SK_TECHNIQUES,
    stuck: 'Look for an edge number of 1, or one as big as the grid.',
    nudge: (step) => {
      const c = step.place[0];
      if (step.technique === 'hiddenSingle') return 'Look for a height that has only one place left in a row or column.';
      if (step.technique === 'edgeOne') return 'Look for a 1 at the edge of the grid.';
      if (step.technique === 'edgeAll') return `Look for a ${N} at the edge of the grid.`;
      return `Look at the edge numbers for row ${Math.floor(c / N) + 1} and column ${(c % N) + 1}.`;
    },
  });
}
