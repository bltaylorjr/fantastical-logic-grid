// Sum Cross: a crossword of numbers. Each white run across or down adds up to
// the clue at its start, using 1..9 with no number twice in a run. Every
// puzzle is proven by a solver that works the way a person does, so it has one
// answer reachable by logic alone; a few starting numbers are given only where
// the logic needs them.
//
//   generateSumCross({ difficulty, size, seed, avoid, toughness, practice, usedStories, story })
//   getSumCrossHint(puzzle, entries)   a nudge, then where, then why
//   solveSumCross(puzzle, entries)     the logical solver (used by the tests)
import { makeRng } from './rng.js';
import { aNum, bit, bitCount, bitsOf, onlyBit, cellName, cap, clamp01, fingerprint, pickByToughness, kitStory, KIT_LEVEL_NAMES, listOr } from './kit-common.js';

export const SC_TECHNIQUES = {
  nakedSingle: { level: 1, name: 'Only number left' },
  hiddenSingle: { level: 1, name: 'A run needs it here' },
  combo: { level: 2, name: 'Run combinations' },
  comboFit: { level: 3, name: 'Fitting the combinations' },
  nakedPair: { level: 4, name: 'Matching pair' },
  nakedTriple: { level: 5, name: 'Matching three' },
};

// size: the whole grid, clue row and column included.
export const SC_TIERS = {
  basic: { name: 'Basic', sizes: [5], density: 0.12, maxTech: 2, minTech: 1, givens: 0.25 },
  easy: { name: 'Easy', sizes: [6, 7], density: 0.16, maxTech: 2, minTech: 2, givens: 0.2 },
  medium: { name: 'Medium', sizes: [7, 8], density: 0.2, maxTech: 3, minTech: 2, givens: 0.16 },
  hard: { name: 'Hard', sizes: [8, 9], density: 0.22, maxTech: 4, minTech: 3, givens: 0.15 },
  expert: { name: 'Expert', sizes: [9, 10], density: 0.22, maxTech: 5, minTech: 3, givens: 0.14, minTop: 4 },
  master: { name: 'Master', sizes: [10, 12], density: 0.23, maxTech: 5, minTech: 3, givens: 0.13, minTop: 6 },
};
export const SC_SIZES = [5, 6, 7, 8, 9, 10, 12];

const WEIGHT = { 1: 0, 2: 0.4, 3: 3, 4: 6, 5: 10 };
const toughnessOf = (steps, whites, givens) => Math.max(0, Math.round(steps.reduce((t, s) => t + WEIGHT[SC_TECHNIQUES[s.technique].level], 0) + whites / 6 - givens * 2));

// Every set of distinct numbers 1..9 by count and total.
const COMBOS = (() => {
  const t = {};
  for (let m = 1; m < 512; m++) {
    const k = bitCount(m), s = bitsOf(m).reduce((a, b) => a + b, 0);
    ((t[k] ||= {})[s] ||= []).push(m);
  }
  return t;
})();
export const combosFor = (k, s) => (COMBOS[k] && COMBOS[k][s]) || [];

// Runs from a layout: each with its cells, direction and clue cell.
export function runsOf(R, C, white) {
  const runs = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c;
    if (white[i]) continue;
    for (const [dir, step, ok] of [['across', 1, (x) => x % C !== 0], ['down', C, (x) => x < R * C]]) {
      const cells = [];
      for (let x = i + step; ok(x) && x < R * C && white[x]; x += step) cells.push(x);
      if (cells.length) runs.push({ dir, clue: i, cells });
    }
  }
  return runs;
}

const runName = (run, C) => `the ${run.sum} ${run.dir} at ${cellName(C, run.clue)}`;
const combosText = (masks) => (masks.length > 3 ? 'several ways' : masks.map((m) => bitsOf(m).join(' + ')).join(', or '));

// ---------- the solver ----------

export function solveSumCross(p, entries = [], { maxTech = 5, stopAtPlace = false } = {}) {
  const R = p.size, C = p.cols, NN = R * C;
  const white = p.solution.map((d) => d > 0);
  const runs = runsOf(R, C, white).map((r) => ({ ...r, sum: r.cells.reduce((s, x) => s + p.solution[x], 0) }));
  const clueSum = new Map(p.clues.map(([cell, a, d]) => [cell, { across: a, down: d }]));
  for (const run of runs) run.sum = clueSum.get(run.clue)?.[run.dir] ?? run.sum;
  const runsAt = Array.from({ length: NN }, () => []);
  runs.forEach((run, k) => run.cells.forEach((c) => runsAt[c].push(k)));
  const cand = Array(NN).fill(0), val = Array(NN).fill(0);
  for (let c = 0; c < NN; c++) if (white[c]) cand[c] = 511;
  let contradiction = false;
  const placeVal = (c, d) => {
    val[c] = d; cand[c] = bit(d);
    for (const k of runsAt[c]) for (const x of runs[k].cells) if (x !== c) cand[x] &= ~bit(d);
  };
  p.givens.forEach((d, c) => { if (d) placeVal(c, d); });
  entries.forEach((d, c) => { if (d && white[c] && !val[c] && cand[c] & bit(d)) placeVal(c, d); });
  const steps = [];
  const placedMask = (run) => run.cells.reduce((m, c) => m | (val[c] ? bit(val[c]) : 0), 0);
  // Combinations still possible for a run: they hold its placed numbers, and
  // every open cell has at least one of the rest it can take.
  const combosOf = (run) => {
    const pm = placedMask(run), open = run.cells.filter((c) => !val[c]);
    return combosFor(run.cells.length, run.sum).filter((m) => (m & pm) === pm && open.every((c) => cand[c] & m & ~pm));
  };
  // Exact fitting: for each open cell, the numbers some full arrangement gives it.
  const fitOf = (run, masks) => {
    const pm = placedMask(run), open = run.cells.filter((c) => !val[c]);
    const can = open.map(() => 0);
    let budget = 200000;
    for (const m of masks) {
      const rest = m & ~pm, pick = Array(open.length);
      const go = (i, used) => {
        if (budget-- < 0) return true;
        if (i === open.length) { pick.forEach((d, j) => { can[j] |= bit(d); }); return can.every((x, j) => x === (cand[open[j]] & ~pm)); }
        for (const d of bitsOf(cand[open[i]] & rest & ~used)) { pick[i] = d; if (go(i + 1, used | bit(d))) return true; }
        return false;
      };
      if (go(0, 0)) break;
    }
    return budget < 0 ? null : { open, can };
  };
  const elimsFrom = (cells, mask) => {
    const out = [];
    for (const c of cells) if (!val[c]) for (const d of bitsOf(cand[c] & mask)) out.push([c, d]);
    return out;
  };

  function nextStep() {
    for (let c = 0; c < NN; c++) {
      if (!white[c] || val[c]) continue;
      if (!cand[c]) { contradiction = true; return null; }
      const d = onlyBit(cand[c]);
      if (d) {
        const [a, b] = runsAt[c].map((k) => runs[k]);
        return { technique: 'nakedSingle', place: [c, d], cells: [c], why: `${cap(cellName(C, c))} can only be ${d}: it has to fit ${runName(a, C)}${b ? ` and ${runName(b, C)}` : ''}, and every other number is used or does not add up.` };
      }
    }
    for (const run of runs) {
      const masks = combosOf(run);
      if (!masks.length) { contradiction = true; return null; }
      const pm = placedMask(run);
      const need = masks.reduce((m, x) => m & x, 511) & ~pm;
      for (const d of bitsOf(need)) {
        const spots = run.cells.filter((c) => !val[c] && cand[c] & bit(d));
        if (!spots.length) { contradiction = true; return null; }
        if (spots.length === 1) return { technique: 'hiddenSingle', place: [spots[0], d], cells: run.cells.slice(), why: `${cap(runName(run, C))} needs ${aNum(d)} (it can only be ${combosText(masks)}), and ${cellName(C, spots[0])} is the only cell in it that can take it.` };
      }
    }
    if (maxTech < 2) return null;
    for (const run of runs) {
      if (run.cells.every((c) => val[c])) continue;
      const masks = combosOf(run);
      const ok = masks.reduce((m, x) => m | x, 0);
      const elim = elimsFrom(run.cells, 511 & ~ok);
      if (elim.length) {
        const nums = [...new Set(elim.map(([, d]) => d))].sort((a, b) => a - b);
        return { technique: 'combo', remove: elim, cells: run.cells.slice(), why: `${run.sum} in ${run.cells.length} cells can only be ${combosText(masks)} here, so ${cap(runName(run, C)).replace(/^The/, 'the')} has no ${listOr(nums)}.` };
      }
    }
    if (maxTech < 3) return null;
    for (const run of runs) {
      if (run.cells.every((c) => val[c])) continue;
      const masks = combosOf(run);
      const fit = fitOf(run, masks);
      if (!fit) continue;
      const elim = [];
      fit.open.forEach((c, j) => { for (const d of bitsOf(cand[c] & ~fit.can[j])) elim.push([c, d]); });
      if (elim.length) {
        const [c, d] = elim[0];
        return { technique: 'comboFit', remove: elim, cells: run.cells.slice(), why: `Try fitting ${combosText(masks)} into ${runName(run, C)}: no arrangement that suits the crossing runs puts ${d} at ${cellName(C, c)}${elim.length > 1 ? ', and a few other numbers drop out the same way' : ''}.` };
      }
    }
    if (maxTech < 4) return null;
    for (const run of runs) {
      const open = run.cells.filter((c) => !val[c]);
      for (let i = 0; i < open.length; i++) {
        if (bitCount(cand[open[i]]) !== 2) continue;
        for (let j = i + 1; j < open.length; j++) {
          if (cand[open[j]] !== cand[open[i]]) continue;
          const elim = elimsFrom(open.filter((c) => c !== open[i] && c !== open[j]), cand[open[i]]);
          if (elim.length) {
            const [a, b] = bitsOf(cand[open[i]]);
            return { technique: 'nakedPair', remove: elim, cells: [open[i], open[j]], why: `In ${runName(run, C)}, ${cellName(C, open[i])} and ${cellName(C, open[j])} can only be ${a} or ${b}. They take both, so no other cell of the run can.` };
          }
        }
      }
    }
    if (maxTech < 5) return null;
    for (const run of runs) {
      const open = run.cells.filter((c) => !val[c] && bitCount(cand[c]) <= 3);
      for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) for (let k = j + 1; k < open.length; k++) {
        const m = cand[open[i]] | cand[open[j]] | cand[open[k]];
        if (bitCount(m) !== 3) continue;
        const three = [open[i], open[j], open[k]];
        const elim = elimsFrom(run.cells.filter((c) => !three.includes(c)), m);
        if (elim.length) return { technique: 'nakedTriple', remove: elim, cells: three, why: `In ${runName(run, C)}, three cells can only hold ${bitsOf(m).join(', ')} between them, so the rest of the run cannot.` };
      }
    }
    return null;
  }

  let guard = 0;
  const done = () => white.every((w, c) => !w || val[c]);
  while (guard++ < 5000 && !done()) {
    const s = nextStep();
    if (!s || contradiction) break;
    steps.push(s);
    if (s.place) placeVal(s.place[0], s.place[1]);
    if (s.remove) for (const [c, d] of s.remove) cand[c] &= ~bit(d);
    if (stopAtPlace && s.place) break;
  }
  const solved = !contradiction && done();
  return { solved, steps, values: val, cand, hardest: steps.reduce((m, s) => Math.max(m, SC_TECHNIQUES[s.technique].level), 1), contradiction };
}

// ---------- building a puzzle ----------

function layout(R, C, density, rng) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const white = Array(R * C).fill(false);
    for (let r = 1; r < R; r++) for (let c = 1; c < C; c++) white[r * C + c] = true;
    const sym = (i) => { const r = Math.floor(i / C), c = i % C; return (R - r) * C + (C - c); };
    const black = (i) => { white[i] = false; const s = sym(i); if (s >= 0 && s < R * C && Math.floor(s / C) >= 1 && s % C >= 1) white[s] = false; };
    for (let r = 1; r < R; r++) for (let c = 1; c < C; c++) if (rng.next() < density / 2) black(r * C + c);
    // Every white cell needs a run of 2 to 9 both ways.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < R * C; i++) {
        if (!white[i]) continue;
        for (const step of [1, C]) {
          let a = i, b = i;
          while (white[a - step] && (step === C || (a - 1) % C !== C - 1)) a -= step;
          while (b + step < R * C && white[b + step] && (step === C || (b + 1) % C !== 0)) b += step;
          const len = (b - a) / step + 1;
          if (len === 1) { black(i); changed = true; break; }
          if (len > 9) { black(a + step * Math.floor(len / 2)); changed = true; break; }
        }
      }
    }
    const whites = white.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
    if (whites.length < (R - 1) * (C - 1) * 0.55) continue;
    // One connected shape.
    const seen = new Set([whites[0]]), q = [whites[0]];
    while (q.length) {
      const i = q.pop();
      for (const j of [i - 1, i + 1, i - C, i + C]) if (j >= 0 && j < R * C && white[j] && !seen.has(j) && (Math.abs(j - i) === C || Math.floor(j / C) === Math.floor(i / C))) { seen.add(j); q.push(j); }
    }
    if (seen.size === whites.length) return white;
  }
  return null;
}

function fill(R, C, white, rng) {
  const runs = runsOf(R, C, white);
  const runsAt = Array.from({ length: R * C }, () => []);
  runs.forEach((run, k) => run.cells.forEach((c) => runsAt[c].push(k)));
  const used = runs.map(() => 0), val = Array(R * C).fill(0);
  const order = white.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  // Each run leans low or high, the way setters build puzzles: totals near the
  // ends have few ways to be made, so the logic has places to start.
  const lean = runs.map(() => (rng.next() < 0.5 ? -1 : 1) * (0.6 + rng.next()));
  const digitsFor = (c) => [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((d) => [d, runsAt[c].reduce((t, k) => t + lean[k] * (d - 5), 0) + (rng.next() - 0.5) * 3])
    .sort((a, b) => b[1] - a[1]).map(([d]) => d);
  let budget = 20000;
  const go = (n) => {
    if (n === order.length) return true;
    if (budget-- < 0) return false;
    const c = order[n];
    const block = runsAt[c].reduce((m, k) => m | used[k], 0);
    for (const d of digitsFor(c)) {
      if (block & bit(d)) continue;
      val[c] = d;
      for (const k of runsAt[c]) used[k] |= bit(d);
      if (go(n + 1)) return true;
      for (const k of runsAt[c]) used[k] &= ~bit(d);
    }
    val[c] = 0;
    return false;
  };
  return go(0) ? val : null;
}

const fpOf = (R, C, clues, givens) => fingerprint('sc', `${R}x${C}|${clues.map((c) => c.join('.')).join('/')}|${givens.join('')}`);

function candidate(R, C, tier, rng) {
  const white = layout(R, C, tier.density, rng);
  if (!white) return null;
  const sol = fill(R, C, white, rng);
  if (!sol) return null;
  const runs = runsOf(R, C, white);
  const clueMap = new Map();
  for (const run of runs) {
    const e = clueMap.get(run.clue) || [run.clue, 0, 0];
    e[run.dir === 'across' ? 1 : 2] = run.cells.reduce((s, c) => s + sol[c], 0);
    clueMap.set(run.clue, e);
  }
  const clues = [...clueMap.values()].sort((a, b) => a[0] - b[0]);
  const whites = white.filter(Boolean).length;
  const givens = Array(R * C).fill(0);
  const maxGivens = Math.ceil(whites * tier.givens);
  // Give a number only where the logic stalls, choosing the cell that tells the most.
  for (let n = 0; n <= maxGivens; n++) {
    const p = { size: R, cols: C, clues, givens, solution: sol };
    const res = solveSumCross(p, [], { maxTech: tier.maxTech });
    if (res.solved) {
      const top = res.steps.filter((s) => SC_TECHNIQUES[s.technique].level >= tier.minTech).length;
      const fits = res.hardest >= tier.minTech && (!tier.minTop || top >= tier.minTop);
      return { sol, clues, givens: givens.slice(), res, fits, score: toughnessOf(res.steps, whites, n) };
    }
    if (res.contradiction) return null;
    let best = -1, bestN = 0;
    for (let c = 0; c < R * C; c++) if (white[c] && !res.values[c] && bitCount(res.cand[c]) > bestN) { best = c; bestN = bitCount(res.cand[c]); }
    if (best < 0) return null;
    givens[best] = sol[best];
  }
  return null;
}

export function generateSumCross({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story = true } = {}) {
  const tier = SC_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const R = SC_SIZES.includes(Number(size)) ? Number(size) : tier.sizes[0], C = R;
  if (practice && (!SC_TECHNIQUES[practice] || SC_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seen = new Set(avoid);
  const want = R >= 10 ? 2 : 4;
  const found = [];
  let backup = null, practiceTries = 0;
  const until = Date.now() + (R >= 10 ? 6000 : 3500);
  for (let attempt = 0; attempt < 400 && found.length < want; attempt++) {
    if (Date.now() > until && (found.length || backup)) break;
    const c = candidate(R, C, tier, makeRng(`${seed}:${attempt}`));
    if (!c || seen.has(fpOf(R, C, c.clues, c.givens))) continue;
    if (!c.fits) { if (!backup || c.score > backup.score) backup = c; continue; }
    if (practice && !c.res.steps.some((s) => s.technique === practice) && ++practiceTries < 30) continue;
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { sol, clues, givens, res } = pick;
  const p = {
    kind: 'sum-cross', game: 'sc',
    id: `sc-${R}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: R, cols: C, clues, givens, solution: sol,
    solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: SC_TECHNIQUES[s.technique].name, place: s.place || null, remove: s.remove || null, cells: s.cells || [], why: s.why })),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: pick.score,
    fingerprint: fpOf(R, C, clues, givens),
    rules: [
      'Fill every white cell with a number from 1 to 9.',
      'Each run of white cells adds up to its clue. In a clue square, the number at the upper right is the total for the run going across, and the number at the lower left is the total for the run going down.',
      'No number appears twice in the same run.',
    ],
  };
  if (story) p.story = kitStory('sc', seed, usedStories);
  return p;
}

export function checkSumCross(p, entries = []) {
  const wrong = [];
  entries.forEach((d, c) => { if (d && !p.givens[c] && p.solution[c] && d !== p.solution[c]) wrong.push(c); });
  return { wrong, solved: p.solution.every((d, c) => !d || (p.givens[c] || entries[c]) === d) };
}

export function getSumCrossHint(p, entries = []) {
  const C = p.cols;
  const { wrong, solved } = checkSumCross(p, entries);
  if (wrong.length) return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One number does' : `${wrong.length} numbers do`} not fit.`, `Check ${cellName(C, wrong[0])}.`, `${cap(cellName(C, wrong[0]))} is not ${entries[wrong[0]]}.`] };
  if (solved) return { kind: 'done', levels: ['Every cell is filled in correctly.'] };
  const res = solveSumCross(p, entries, { maxTech: 5, stopAtPlace: true });
  const at = res.steps.findIndex((s) => s.place);
  if (at < 0) return { kind: 'stuck', levels: ['Look for a short run with a very small or very big total: it has only one way to be made.'] };
  const step = res.steps[at], lead = res.steps.slice(0, at);
  const [c, d] = step.place;
  return {
    kind: 'step', technique: step.technique, techniqueName: SC_TECHNIQUES[step.technique].name,
    cell: c, digit: d, value: d, cells: [c],
    levels: [lead.length ? `First: ${lead[lead.length - 1].why}` : `Look near ${cellName(C, c)}.`, `Look at ${cellName(C, c)}.`, step.why],
  };
}
