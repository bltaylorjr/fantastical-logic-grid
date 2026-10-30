// Number Place: fill the grid so every row, column and box holds each number once.
// Variants: 'diagonal' (both long diagonals too) and 'parity' (shaded cells are even).
//
// Like the logic grid, every puzzle has exactly one answer, can be solved by
// deduction alone, and comes with a full step-by-step solve path and hints.

import { makeRng } from './rng.js';

export const NP_SIZES = {
  4: { box: [2, 2] },
  6: { box: [2, 3] },
  9: { box: [3, 3] },
};

// Techniques in the order a person would try them. Each tier allows up to a level.
export const NP_TECHNIQUES = {
  nakedSingle: { level: 1, name: 'Only number left' },
  hiddenSingle: { level: 1, name: 'Only place left' },
  intersection: { level: 2, name: 'Line and box overlap' },
  nakedPair: { level: 3, name: 'Matching pair' },
  hiddenPair: { level: 3, name: 'Hidden pair' },
  nakedTriple: { level: 4, name: 'Matching three' },
  hiddenTriple: { level: 4, name: 'Hidden three' },
  xWing: { level: 4, name: 'Rectangle' },
  swordfish: { level: 5, name: 'Three-line pattern' },
  xyWing: { level: 5, name: 'Bent triple' },
};

export const NP_TIERS = {
  basic: { name: 'Basic', maxLevel: 1, size: 4, minLevel: 1 },
  easy: { name: 'Easy', maxLevel: 1, size: 6, minLevel: 1 },
  medium: { name: 'Medium', maxLevel: 2, size: 9, minLevel: 1 },
  hard: { name: 'Hard', maxLevel: 3, size: 9, minLevel: 2 },
  expert: { name: 'Expert', maxLevel: 5, size: 9, minLevel: 4 },
  // Master needs the top techniques at least twice.
  master: { name: 'Master', maxLevel: 5, size: 9, minLevel: 5, minTopSteps: 2 },
};
export const NP_TIER_ORDER = Object.keys(NP_TIERS);

const bit = (d) => 1 << (d - 1);
const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const digitsOf = (m) => { const out = []; for (let d = 1; m; d++, m >>= 1) if (m & 1) out.push(d); return out; };

// ---------- board shape ----------

export function makeShape(size, variants = []) {
  const N = size, [br, bc] = NP_SIZES[N].box;
  const units = [];
  for (let r = 0; r < N; r++) units.push({ kind: 'row', n: r + 1, cells: [...Array(N)].map((_, c) => r * N + c) });
  for (let c = 0; c < N; c++) units.push({ kind: 'column', n: c + 1, cells: [...Array(N)].map((_, r) => r * N + c) });
  for (let b = 0; b < N; b++) {
    const r0 = Math.floor(b / (N / bc)) * br, c0 = (b % (N / bc)) * bc, cells = [];
    for (let r = r0; r < r0 + br; r++) for (let c = c0; c < c0 + bc; c++) cells.push(r * N + c);
    units.push({ kind: 'box', n: b + 1, cells });
  }
  if (variants.includes('diagonal')) {
    units.push({ kind: 'diagonal', n: 1, cells: [...Array(N)].map((_, i) => i * N + i) });
    units.push({ kind: 'diagonal', n: 2, cells: [...Array(N)].map((_, i) => i * N + (N - 1 - i)) });
  }
  const unitsOf = [...Array(N * N)].map(() => []);
  units.forEach((u, ui) => u.cells.forEach((c) => unitsOf[c].push(ui)));
  const peers = [...Array(N * N)].map((_, c) => {
    const s = new Set();
    unitsOf[c].forEach((ui) => units[ui].cells.forEach((p) => p !== c && s.add(p)));
    return [...s];
  });
  return { N, all: (1 << N) - 1, units, unitsOf, peers };
}

export const cellName = (N, c) => `row ${Math.floor(c / N) + 1}, column ${(c % N) + 1}`;
const unitName = (u) => (u.kind === 'diagonal' ? (u.n === 1 ? 'the falling diagonal' : 'the rising diagonal') : `${u.kind} ${u.n}`);

// ---------- brute-force counter (for uniqueness, independent of the logic solver) ----------

export function countSolutions(shape, grid, limit = 2, evenMask = null) {
  const { N, all, peers } = shape;
  const v = grid.slice();
  const even = evenMask ? [...Array(N)].reduce((m, _, i) => ((i + 1) % 2 === 0 ? m | bit(i + 1) : m), 0) : 0;
  const allowed = (c) => {
    let m = evenMask ? (evenMask[c] ? even : all & ~even) : all;
    for (const p of peers[c]) if (v[p]) m &= ~bit(v[p]);
    return m;
  };
  let count = 0, solution = null;
  const go = () => {
    let best = -1, bestM = 0, bestN = 99;
    for (let c = 0; c < N * N; c++) {
      if (v[c]) continue;
      const m = allowed(c), n = popcount(m);
      if (n === 0) return;
      if (n < bestN) { best = c; bestM = m; bestN = n; if (n === 1) break; }
    }
    if (best < 0) { count++; if (!solution) solution = v.slice(); return; }
    for (const d of digitsOf(bestM)) {
      v[best] = d; go(); v[best] = 0;
      if (count >= limit) return;
    }
  };
  go();
  return { count, solution };
}

// ---------- logic solver with a step trace ----------

function initCandidates(shape, grid, evenMask) {
  const { N, all } = shape;
  let even = 0;
  for (let d = 2; d <= N; d += 2) even |= bit(d);
  const cand = [...Array(N * N)].map((_, c) => (evenMask ? (evenMask[c] ? even : all & ~even) : all));
  const v = grid.slice();
  for (let c = 0; c < N * N; c++) if (v[c]) { cand[c] = bit(v[c]); for (const p of shape.peers[c]) cand[p] &= ~bit(v[c]); }
  return { v, cand };
}

function place(shape, st, c, d) {
  st.v[c] = d; st.cand[c] = bit(d);
  for (const p of shape.peers[c]) st.cand[p] &= ~bit(d);
}

// Each finder returns a step or null. A step either places one number
// ({ place: [cell, digit] }) or removes candidates ({ remove: [[cell, digit], ...] }).
const FINDERS = {
  nakedSingle(shape, st) {
    for (let c = 0; c < shape.N ** 2; c++) {
      if (!st.v[c] && popcount(st.cand[c]) === 1) {
        const d = digitsOf(st.cand[c])[0];
        return { place: [c, d], focus: { cell: c }, why: `${cap(cellName(shape.N, c))} can only be ${d}: every other number is already in its row, column or box.` };
      }
    }
    return null;
  },
  hiddenSingle(shape, st) {
    for (const u of shape.units) {
      for (let d = 1; d <= shape.N; d++) {
        if (u.cells.some((c) => st.v[c] === d)) continue;
        const spots = u.cells.filter((c) => !st.v[c] && st.cand[c] & bit(d));
        if (spots.length === 1) return { place: [spots[0], d], focus: { unit: u, cell: spots[0] }, why: `In ${unitName(u)}, ${d} fits only at ${cellName(shape.N, spots[0])}.` };
      }
    }
    return null;
  },
  intersection(shape, st) {
    const { units, N } = shape;
    for (let a = 0; a < units.length; a++) {
      for (let d = 1; d <= N; d++) {
        const spots = units[a].cells.filter((c) => !st.v[c] && st.cand[c] & bit(d));
        if (spots.length < 2) continue;
        for (let b = 0; b < units.length; b++) {
          if (a === b) continue;
          const inB = new Set(units[b].cells);
          if (!spots.every((c) => inB.has(c))) continue;
          const remove = units[b].cells.filter((c) => !spots.includes(c) && !st.v[c] && st.cand[c] & bit(d)).map((c) => [c, d]);
          if (remove.length) return { remove, focus: { unit: units[a], cells: spots }, why: `In ${unitName(units[a])}, ${d} must go in ${unitName(units[b])}, so ${d} can be crossed off the rest of ${unitName(units[b])}.` };
        }
      }
    }
    return null;
  },
  nakedPair: (shape, st) => nakedSubset(shape, st, 2),
  nakedTriple: (shape, st) => nakedSubset(shape, st, 3),
  hiddenPair: (shape, st) => hiddenSubset(shape, st, 2),
  hiddenTriple: (shape, st) => hiddenSubset(shape, st, 3),
  xWing: (shape, st) => fish(shape, st, 2),
  swordfish: (shape, st) => fish(shape, st, 3),
  xyWing(shape, st) {
    const { N, peers } = shape;
    const two = [...Array(N * N).keys()].filter((c) => !st.v[c] && popcount(st.cand[c]) === 2);
    for (const pivot of two) {
      const [a, b] = digitsOf(st.cand[pivot]);
      const seen = new Set(peers[pivot]);
      const wings = two.filter((c) => c !== pivot && seen.has(c));
      for (const p of wings) for (const q of wings) {
        if (p >= q) continue;
        const mp = st.cand[p], mq = st.cand[q];
        // p holds a + c, q holds b + c (either way round), c not in the pivot.
        const c1 = mp & ~bit(a), c2 = mq & ~bit(b), c3 = mp & ~bit(b), c4 = mq & ~bit(a);
        let z = 0;
        if (mp & bit(a) && mq & bit(b) && popcount(c1) === 1 && c1 === c2 && !(c1 & st.cand[pivot])) z = c1;
        else if (mp & bit(b) && mq & bit(a) && popcount(c3) === 1 && c3 === c4 && !(c3 & st.cand[pivot])) z = c3;
        if (!z) continue;
        const sq = new Set(peers[q]);
        const remove = peers[p].filter((c) => c !== pivot && sq.has(c) && !st.v[c] && st.cand[c] & z).map((c) => [c, digitsOf(z)[0]]);
        const d = digitsOf(z)[0];
        if (remove.length) return { remove, focus: { cells: [pivot, p, q] }, why: `${cap(cellName(N, pivot))} is ${a} or ${b}. Either way, one of ${cellName(N, p)} and ${cellName(N, q)} must be ${d}, so any cell that sees both of them cannot be ${d}.` };
      }
    }
    return null;
  },
};

// Rows (or columns) where a number fits only in the same k columns (or rows):
// those columns get their number from these rows, so it is crossed off elsewhere.
function fish(shape, st, k) {
  const { N, units } = shape;
  const label = k === 2 ? 'rectangle' : 'three-line pattern';
  for (const [lineKind, crossKind] of [['row', 'column'], ['column', 'row']]) {
    const lines = units.filter((u) => u.kind === lineKind);
    const crosses = units.filter((u) => u.kind === crossKind);
    const pos = (c) => (lineKind === 'row' ? c % N : Math.floor(c / N));
    for (let d = 1; d <= N; d++) {
      const sets = lines.map((u) => u.cells.filter((c) => !st.v[c] && st.cand[c] & bit(d)));
      const usable = [...Array(N).keys()].filter((i) => sets[i].length >= 2 && sets[i].length <= k);
      for (const pick of combos(usable, k)) {
        const cols = new Set(pick.flatMap((i) => sets[i].map(pos)));
        if (cols.size !== k) continue;
        const corners = pick.flatMap((i) => sets[i]);
        const remove = [...cols].flatMap((x) => crosses[x].cells.filter((c) => !corners.includes(c) && !st.v[c] && st.cand[c] & bit(d)).map((c) => [c, d]));
        const ks = [...cols].sort((a, b) => a - b).map((x) => x + 1);
        if (remove.length) return { remove, focus: { cells: corners }, why: `In ${lineKind}s ${pick.map((i) => i + 1).join(', ')}, ${d} fits only in ${crossKind}s ${ks.join(', ')} (a ${label}). Those ${crossKind}s must get their ${d} from these ${lineKind}s, so cross ${d} off the rest of them.` };
      }
    }
  }
  return null;
}

function combos(arr, k, start = 0, acc = [], out = []) {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
  return out;
}

function nakedSubset(shape, st, k) {
  for (const u of shape.units) {
    const open = u.cells.filter((c) => !st.v[c] && popcount(st.cand[c]) <= k);
    for (const set of combos(open, k)) {
      const m = set.reduce((acc, c) => acc | st.cand[c], 0);
      if (popcount(m) !== k) continue;
      const remove = [];
      for (const c of u.cells) if (!st.v[c] && !set.includes(c)) for (const d of digitsOf(st.cand[c] & m)) remove.push([c, d]);
      if (remove.length) return { remove, focus: { unit: u, cells: set }, why: `In ${unitName(u)}, ${set.map((c) => cellName(shape.N, c)).join(' and ')} can only hold ${digitsOf(m).join(', ')} between them, so no other cell in ${unitName(u)} can.` };
    }
  }
  return null;
}

function hiddenSubset(shape, st, k) {
  for (const u of shape.units) {
    const missing = [];
    for (let d = 1; d <= shape.N; d++) if (!u.cells.some((c) => st.v[c] === d)) missing.push(d);
    for (const ds of combos(missing, k)) {
      const m = ds.reduce((acc, d) => acc | bit(d), 0);
      const cells = u.cells.filter((c) => !st.v[c] && st.cand[c] & m);
      if (cells.length !== k) continue;
      if (!ds.every((d) => cells.some((c) => st.cand[c] & bit(d)))) continue;
      const remove = [];
      for (const c of cells) for (const d of digitsOf(st.cand[c] & ~m)) remove.push([c, d]);
      if (remove.length) return { remove, focus: { unit: u, cells }, why: `In ${unitName(u)}, ${ds.join(', ')} fit only in ${cells.map((c) => cellName(shape.N, c)).join(' and ')}, so those cells hold nothing else.` };
    }
  }
  return null;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Solves by deduction only, using techniques up to maxLevel. Returns the steps
// taken and whether the grid was finished.
export function solveLogically(shape, grid, { maxLevel = 5, evenMask = null } = {}) {
  const st = initCandidates(shape, grid, evenMask);
  const order = Object.keys(NP_TECHNIQUES).filter((t) => NP_TECHNIQUES[t].level <= maxLevel);
  const steps = [];
  let hardest = 0;
  for (;;) {
    if (st.v.every(Boolean)) break;
    let step = null;
    for (const t of order) { step = FINDERS[t](shape, st); if (step) { step.technique = t; break; } }
    if (!step) break;
    hardest = Math.max(hardest, NP_TECHNIQUES[step.technique].level);
    if (step.place) place(shape, st, ...step.place);
    else for (const [c, d] of step.remove) st.cand[c] &= ~bit(d);
    steps.push(step);
  }
  return { solved: st.v.every(Boolean), values: st.v, steps, hardest };
}

// ---------- generator ----------

function fullGrid(shape, rng, evenMask) {
  const { N } = shape;
  // Seed the first row (or nothing, for parity, where the mask decides) and let the counter finish it.
  const g = Array(N * N).fill(0);
  if (!evenMask) rng.shuffle([...Array(N)].map((_, i) => i + 1)).forEach((d, i) => { g[i] = d; });
  // Randomized fill: try digits in random order.
  const { peers, all } = shape;
  let even = 0;
  for (let d = 2; d <= N; d += 2) even |= bit(d);
  const order = [...Array(N * N).keys()];
  const fill = (k) => {
    if (k === order.length) return true;
    const c = order[k];
    if (g[c]) return fill(k + 1);
    let m = evenMask ? (evenMask[c] ? even : all & ~even) : all;
    for (const p of peers[c]) if (g[p]) m &= ~bit(g[p]);
    for (const d of rng.shuffle(digitsOf(m))) { g[c] = d; if (fill(k + 1)) return true; }
    g[c] = 0;
    return false;
  };
  return fill(0) ? g : null;
}

function makeEvenMask(shape, solution) {
  return solution.map((d) => d % 2 === 0);
}

export function generateNumberPlace({ difficulty = 'medium', size, variants = [], seed = Math.random().toString(36).slice(2), symmetric = true } = {}) {
  const tier = NP_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}". Use one of ${NP_TIER_ORDER.join(', ')}.`);
  const N = size || tier.size;
  if (!NP_SIZES[N]) throw new Error(`Size must be one of ${Object.keys(NP_SIZES).join(', ')}.`);
  const shape = makeShape(N, variants);
  const parity = variants.includes('parity');

  for (let attempt = 0; attempt < 300; attempt++) {
    const rng = makeRng(`${seed}:${attempt}`);
    const solution = fullGrid(shape, rng, null);
    if (!solution) continue;
    const evenMask = parity ? makeEvenMask(shape, solution) : null;
    const givens = solution.slice();
    // Remove numbers (in symmetric pairs) while the answer stays unique and the
    // puzzle stays solvable within the tier.
    const cells = rng.shuffle([...Array(N * N).keys()]);
    for (const c of cells) {
      if (!givens[c]) continue;
      const mirror = N * N - 1 - c;
      const group = symmetric && mirror !== c ? [c, mirror] : [c];
      const saved = group.map((x) => givens[x]);
      group.forEach((x) => { givens[x] = 0; });
      // Hard tiers remove freely and grade at the end: minimal puzzles are the hard ones.
      const ok = countSolutions(shape, givens, 2, evenMask).count === 1
        && (tier.minLevel >= 4 || solveLogically(shape, givens, { maxLevel: tier.maxLevel, evenMask }).solved);
      if (!ok) group.forEach((x, i) => { givens[x] = saved[i]; });
    }
    // A minimal puzzle may need more than the tier allows: give back numbers
    // one (pair) at a time until it doesn't. This lands right at the tier's edge.
    let res = solveLogically(shape, givens, { maxLevel: tier.maxLevel, evenMask });
    for (const c of rng.shuffle([...Array(N * N).keys()])) {
      if (res.solved) break;
      if (givens[c] || res.values[c]) continue;
      givens[c] = solution[c];
      if (symmetric) givens[N * N - 1 - c] = solution[N * N - 1 - c];
      res = solveLogically(shape, givens, { maxLevel: tier.maxLevel, evenMask });
    }
    if (!res.solved || res.hardest < tier.minLevel) continue;
    if (tier.minTopSteps && res.steps.filter((x) => NP_TECHNIQUES[x.technique].level >= tier.minLevel).length < tier.minTopSteps) continue;
    return {
      kind: 'number-place',
      id: `np-${N}-${variants.join('+') || 'classic'}-${difficulty}-${seed}`,
      seed,
      difficulty: { id: difficulty, name: tier.name },
      size: N,
      box: NP_SIZES[N].box,
      variants: variants.slice(),
      givens,
      evenCells: evenMask ? evenMask.map((e, i) => (e ? i : -1)).filter((i) => i >= 0) : [],
      solution,
      solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: NP_TECHNIQUES[s.technique].name, place: s.place || null, remove: s.remove || null, why: s.why })),
      hardestTechnique: res.hardest,
      rules: rulesText(N, variants),
    };
  }
  throw new Error('Could not build a puzzle for those options. Try another seed.');
}

function rulesText(N, variants) {
  const [br, bc] = NP_SIZES[N].box;
  const out = [`Fill every empty cell with a number from 1 to ${N}.`, `Each row, each column and each ${br}×${bc} box holds every number exactly once.`];
  if (variants.includes('diagonal')) out.push('Both long diagonals also hold every number exactly once.');
  if (variants.includes('parity')) out.push('Shaded cells hold even numbers. Unshaded cells hold odd numbers.');
  return out;
}

// ---------- play ----------

const shapeOf = (p) => makeShape(p.size, p.variants);
const evenMaskOf = (p) => (p.variants.includes('parity') ? [...Array(p.size ** 2)].map((_, i) => p.evenCells.includes(i)) : null);

// entries: array the length of the grid, 0 for empty. Givens are ignored.
export function checkNumberPlace(p, entries) {
  const wrong = [];
  entries.forEach((d, c) => { if (d && !p.givens[c] && d !== p.solution[c]) wrong.push(c); });
  return { wrong, filled: p.givens.filter((d, c) => d || entries[c]).length };
}

export function isNumberPlaceSolved(p, entries) {
  return p.solution.every((d, c) => (p.givens[c] || entries[c]) === d);
}

// Stepped hints in the same shape as the logic grid's getHint: levels go from a nudge to the full reason.
export function getNumberPlaceHint(p, entries = []) {
  const N = p.size;
  const wrong = checkNumberPlace(p, entries).wrong;
  if (wrong.length) {
    return {
      kind: 'mistake', cells: wrong,
      levels: [
        `${wrong.length === 1 ? 'One number does' : `${wrong.length} numbers do`} not fit.`,
        `Check ${cellName(N, wrong[0])}.`,
        `${cap(cellName(N, wrong[0]))} is not ${entries[wrong[0]]}.`,
      ],
    };
  }
  const grid = p.givens.map((d, c) => d || entries[c] || 0);
  if (grid.every(Boolean)) return { kind: 'done', levels: ['Every cell is filled in correctly.'] };
  const shape = shapeOf(p);
  const res = solveLogically(shape, grid, { maxLevel: 5, evenMask: evenMaskOf(p) });
  const placeAt = res.steps.findIndex((s) => s.place);
  if (placeAt < 0) return { kind: 'stuck', levels: ['Try a cell with only two numbers left.'] };
  const step = res.steps[placeAt];
  const lead = res.steps.slice(0, placeAt);
  const [c, d] = step.place;
  const where = step.focus.unit ? unitName(step.focus.unit) : `row ${Math.floor(c / N) + 1}`;
  return {
    kind: 'step',
    technique: step.technique,
    techniqueName: NP_TECHNIQUES[step.technique].name,
    cell: c, digit: d,
    chain: lead.length ? lead.map((s) => s.why) : null,
    levels: [
      lead.length ? `First look for ${NP_TECHNIQUES[lead[0].technique].name.toLowerCase()}: ${lead[0].why}` : `Look at ${where}.`,
      `Look at ${cellName(N, c)}.`,
      step.why,
    ],
  };
}

export function formatNumberPlaceText(p, { answers = false } = {}) {
  const N = p.size, [br, bc] = p.box, src = answers ? p.solution : p.givens;
  const lines = [];
  for (let r = 0; r < N; r++) {
    if (r && r % br === 0) lines.push(Array(N / bc).fill('-'.repeat(bc * 2 - 1)).join('-+-'));
    const row = [];
    for (let c = 0; c < N; c++) {
      if (c && c % bc === 0) row.push('|');
      const i = r * N + c;
      row.push(src[i] ? String(src[i]) : p.evenCells.includes(i) ? '#' : '.');
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}
