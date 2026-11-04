// More or Less: fill an N×N grid so every row and column holds 1..N once. A
// few numbers are given, and signs between neighbouring cells say which of the
// two is less. Every puzzle is proven by a solver that works the way a person
// does, so it has exactly one answer reachable by logic alone, and its
// difficulty is the hardest technique it needs.
//
//   generateMoreOrLess({ difficulty, size, seed, avoid, toughness, practice, usedStories, story, theme })
//   getMoreOrLessHint(puzzle, entries)   a nudge, then where, then why
//   solveMoreOrLess(puzzle, entries)     the logical solver (used by the tests)
//   countMoreOrLess(puzzle)              brute-force answer count (tests)
//
// A sign is { c, d, lt }: between cell c and its neighbour to the right
// (d 'r') or below (d 'd'); lt is true when c is the smaller of the two.
import { makeRng } from './rng.js';
import { bit, bitsOf, cellName, cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES, listAnd, listOr } from './kit-common.js';
import { latinSquare, latinState, latinFinders, runSolver, countLatin, pruneClues, checkLatin, latinHint, latinStory, pathOf, toughnessOf, highBit, lowBit, elimText, unitName } from './latin-kit.js';
import { kitThemeStory } from './kit-story.js';

export const ML_TECHNIQUES = {
  nakedSingle: { level: 1, name: 'Only number left' },
  hiddenSingle: { level: 1, name: 'Only place left' },
  signLimit: { level: 2, name: 'Sign limits' },
  signChain: { level: 3, name: 'Sign chains' },
  nakedPair: { level: 4, name: 'Matching pair' },
  hiddenPair: { level: 4, name: 'Hidden pair' },
  nakedTriple: { level: 5, name: 'Matching three' },
};

// signs: the share of neighbouring pairs that start with a sign, before the
// generator takes away every clue the logic does not need (keepSigns: only
// numbers are taken away, so a first puzzle has plenty of signs to work with).
export const ML_TIERS = {
  basic: { name: 'Basic', sizes: [4], signs: 0.4, keepSigns: true, maxTech: 2, minTech: 1 },
  easy: { name: 'Easy', sizes: [5, 4], signs: 0.5, maxTech: 2, minTech: 2 },
  medium: { name: 'Medium', sizes: [6, 5], signs: 0.55, maxTech: 3, minTech: 3 },
  hard: { name: 'Hard', sizes: [7, 6], signs: 0.55, maxTech: 4, minTech: 3, minTop: 2 },
  expert: { name: 'Expert', sizes: [8, 7], signs: 0.6, maxTech: 5, minTech: 4 },
  master: { name: 'Master', sizes: [9, 8], signs: 0.6, maxTech: 5, minTech: 4, minTop: 3 },
};
export const ML_SIZES = [4, 5, 6, 7, 8, 9];

// Every pair of neighbouring cells, as signs that fit the answer.
export function allSigns(N, sol) {
  const out = [];
  for (let c = 0; c < N * N; c++) {
    if (c % N < N - 1) out.push({ c, d: 'r', lt: sol[c] < sol[c + 1] });
    if (c + N < N * N) out.push({ c, d: 'd', lt: sol[c] < sol[c + N] });
  }
  return out;
}
const other = (N, s) => (s.d === 'r' ? s.c + 1 : s.c + N);
// [smaller, bigger] for each sign.
export const edgesOf = (N, signs) => signs.map((s) => (s.lt ? [s.c, other(N, s)] : [other(N, s), s.c]));

// ---------- the solver ----------

export function solveMoreOrLess(p, entries = [], { maxTech = 5, stopAtPlace = false } = {}) {
  const N = p.size, NN = N * N;
  const S = latinState(N);
  const edges = edgesOf(N, p.signs);
  const bigger = [...Array(NN)].map(() => []), smaller = [...Array(NN)].map(() => []);
  for (const [a, b] of edges) { bigger[a].push(b); smaller[b].push(a); }
  p.givens.forEach((d, c) => { if (d) S.place(c, d); });
  entries.forEach((d, c) => { if (d && !S.val[c] && S.cand[c] & bit(d)) S.place(c, d); });
  const name = (c) => cellName(N, c);

  // Sign limits: a cell less than its neighbour is less than the neighbour's biggest option.
  function signLimit() {
    for (const [a, b] of edges) {
      const maxB = highBit(S.cand[b]), minA = lowBit(S.cand[a]);
      if (!maxB || !minA) { S.contradiction = true; return null; }
      const ea = S.val[a] ? [] : bitsOf(S.cand[a]).filter((d) => d >= maxB).map((d) => [a, d]);
      const eb = S.val[b] ? [] : bitsOf(S.cand[b]).filter((d) => d <= minA).map((d) => [b, d]);
      if (!ea.length && !eb.length) continue;
      const parts = [];
      if (ea.length) {
        const ds = ea.map(([, d]) => d);
        parts.push(S.val[b] ? `${cap(name(a))} is less than ${name(b)}, which is ${S.val[b]}, so it cannot be ${listOr(ds)}.`
          : maxB === N ? `${cap(name(a))} is less than ${name(b)}, so it cannot be ${N}, the biggest number.`
            : `${cap(name(a))} is less than ${name(b)}, which can be at most ${maxB}, so it cannot be ${listOr(ds)}.`);
      }
      if (eb.length) {
        const ds = eb.map(([, d]) => d);
        parts.push(S.val[a] ? `${cap(name(b))} is more than ${name(a)}, which is ${S.val[a]}, so it cannot be ${listOr(ds)}.`
          : minA === 1 ? `${cap(name(b))} is more than ${name(a)}, so it cannot be 1, the smallest number.`
            : `${cap(name(b))} is more than ${name(a)}, which is at least ${minA}, so it cannot be ${listOr(ds)}.`);
      }
      return { technique: 'signLimit', remove: [...ea, ...eb], cells: [a, b], why: parts.join(' ') };
    }
    return null;
  }

  // Sign chains: a cell that must be less than several cells of one row or
  // column (directly or along a chain of signs) is less than the smallest of
  // them, and those cells all differ.
  const reach = (start, next) => {
    const seen = new Set(), stack = [start], direct = new Set(next[start]);
    while (stack.length) for (const x of next[stack.pop()]) if (!seen.has(x)) { seen.add(x); stack.push(x); }
    return { cells: [...seen], direct };
  };
  function signChain() {
    for (let c = 0; c < NN; c++) {
      if (S.val[c]) continue;
      for (const up of [true, false]) {
        const { cells, direct } = reach(c, up ? bigger : smaller);
        if (cells.length < 2) continue;
        for (let u = 0; u < 2 * N; u++) {
          const group = cells.filter((x) => (u < N ? Math.floor(x / N) === u : x % N === u - N));
          if (group.length < 2) continue;
          const k = group.length;
          const union = bitsOf(group.reduce((m, x) => m | S.cand[x], 0));
          if (union.length < k) { S.contradiction = true; return null; }
          // k different numbers from `union`: the smallest is at most the k-th biggest.
          const bound = up ? union[union.length - k] : union[k - 1];
          const ds = bitsOf(S.cand[c]).filter((d) => (up ? d >= bound : d <= bound));
          if (!ds.length) continue;
          const chained = group.some((x) => !direct.has(x));
          const why = `${cap(name(c))} must be ${up ? 'less' : 'more'} than ${listAnd(group.map(name))}${chained ? ', following the signs' : ''}. They are all in ${unitName(u, N)}, so they are different numbers, and the ${up ? 'smallest' : 'biggest'} of them is at ${up ? 'most' : 'least'} ${bound}. So ${name(c)} cannot be ${listOr(ds)}.`;
          return { technique: 'signChain', remove: ds.map((d) => [c, d]), cells: [c, ...group], why };
        }
      }
    }
    return null;
  }

  const finders = [
    { level: 1, find: (s) => latinFinders.nakedSingle(s, 'every other number is already in its row or column, or does not fit the signs') },
    { level: 1, find: latinFinders.hiddenSingle },
    { level: 2, find: signLimit },
    { level: 3, find: signChain },
    { level: 4, find: latinFinders.nakedPair },
    { level: 4, find: latinFinders.hiddenPair },
    { level: 5, find: latinFinders.nakedTriple },
  ];
  return runSolver(S, finders, ML_TECHNIQUES, { maxTech, stopAtPlace });
}

// A brute-force count of answers (stops at `limit`), independent of the logic solver.
export function countMoreOrLess(p, limit = 2) {
  const N = p.size, NN = N * N, full = (1 << N) - 1;
  const lessLeft = Array(NN).fill(0), lessUp = Array(NN).fill(0); // 1: this cell is bigger than the one left/up, -1: smaller
  for (const s of p.signs) {
    const o = other(N, s), rel = s.lt ? 1 : -1; // o is bigger than c when lt
    if (s.d === 'r') lessLeft[o] = rel; else lessUp[o] = rel;
  }
  const below = (d) => (1 << (d - 1)) - 1; // numbers less than d
  const above = (d) => full & ~((1 << d) - 1); // numbers more than d
  const allowed = (c, g) => {
    let m = full;
    if (lessLeft[c]) m &= lessLeft[c] > 0 ? above(g[c - 1]) : below(g[c - 1]);
    if (lessUp[c]) m &= lessUp[c] > 0 ? above(g[c - N]) : below(g[c - N]);
    return m;
  };
  return countLatin(N, p.givens, { allowed, limit });
}

// ---------- building a puzzle ----------

const signKey = (s) => `${s.c}${s.d}${s.lt ? '<' : '>'}`;
const fpOf = (N, givens, signs) => fingerprint('ml', `${N}|${givens.join('')}|${signs.map(signKey).sort().join('.')}`);

function candidate(N, tier, rng) {
  const sol = latinSquare(N, rng);
  const pairs = rng.shuffle(allSigns(N, sol)).slice(0, Math.round(2 * N * (N - 1) * tier.signs));
  // Clues: the N*N numbers, then the signs. Numbers go first, so the puzzle
  // leans on its signs.
  const keep = Array(N * N + pairs.length).fill(true);
  const build = (k) => ({ size: N, givens: sol.map((d, c) => (k[c] ? d : 0)), signs: pairs.filter((_, j) => k[N * N + j]) });
  const order = [...rng.shuffle([...Array(N * N).keys()]), ...(tier.keepSigns ? [] : rng.shuffle([...Array(pairs.length).keys()]).map((j) => N * N + j))];
  pruneClues(order, keep, (k) => solveMoreOrLess(build(k), [], { maxTech: tier.maxTech }).solved);
  const p = build(keep);
  const res = solveMoreOrLess(p, [], { maxTech: tier.maxTech });
  if (!res.solved) return null;
  const top = res.steps.filter((s) => ML_TECHNIQUES[s.technique].level >= tier.minTech).length;
  const fits = res.hardest >= tier.minTech && (!tier.minTop || top >= tier.minTop);
  return { sol, givens: p.givens, signs: p.signs, res, fits, score: toughnessOf(res.steps, ML_TECHNIQUES, N) };
}

export function generateMoreOrLess({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story = true, theme = null } = {}) {
  const tier = ML_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = ML_SIZES.includes(Number(size)) ? Number(size) : tier.sizes[0];
  if (practice && (!ML_TECHNIQUES[practice] || ML_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seen = new Set(avoid);
  const want = N >= 8 ? 2 : N >= 6 ? 3 : 4;
  const found = [];
  let practiceTries = 0, backup = null;
  // The build is bounded by work, not the clock: the same seed gives the same
  // puzzle on every device, however fast or busy (200 attempts always fitted
  // in the old time budget on the puzzle server, Nov 2026).
  for (let attempt = 0; attempt < 200 && found.length < want; attempt++) {
    const c = candidate(N, tier, makeRng(`${seed}:${attempt}`));
    if (!c) continue;
    if (seen.has(fpOf(N, c.givens, c.signs))) continue;
    if (!c.fits) { if (!backup || c.res.hardest > backup.res.hardest || (c.res.hardest === backup.res.hardest && c.score > backup.score)) backup = c; continue; }
    if (practice && !c.res.steps.some((s) => s.technique === practice) && ++practiceTries < 20) continue;
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { sol, givens, signs, res } = pick;
  const p = {
    kind: 'more-or-less', game: 'ml',
    id: `ml-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N, givens, signs: signs.slice().sort((a, b) => a.c - b.c || (a.d < b.d ? 1 : -1)),
    solution: sol,
    solvePath: pathOf(res.steps, ML_TECHNIQUES),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: pick.score,
    fingerprint: fpOf(N, givens, signs),
    rules: [
      `Fill every cell with a number from 1 to ${N}.`,
      'Each row and each column holds every number exactly once.',
      'A sign between two cells points to the smaller number: in 2 < 3, the 2 is less.',
    ],
  };
  if (story) p.story = kitThemeStory('ml', seed, { theme, used: usedStories, classic: () => latinStory('ml', seed, usedStories) });
  return p;
}

export const checkMoreOrLess = checkLatin;

export function getMoreOrLessHint(p, entries = []) {
  const N = p.size;
  return latinHint(p, entries, {
    solve: solveMoreOrLess, techniques: ML_TECHNIQUES,
    stuck: 'Look for a sign next to a cell with only a few numbers left.',
    nudge: (step) => {
      const c = step.place[0];
      if (step.technique === 'hiddenSingle') return `Look for a number that has only one place left in a row or column.`;
      return `Look at the numbers and signs around ${cellName(N, c)}.`;
    },
  });
}
