// Cage Math: fill an N×N grid so every row and column holds 1..N once, and the
// numbers in each outlined cage make its target with its operation
// (add, subtract, multiply or divide). Every puzzle is proven by a solver that
// works the way a person does, so it has exactly one answer reachable by logic
// alone, and its difficulty is the hardest technique it needs.
//
//   generateCageMath({ difficulty, size, seed, avoid, toughness, practice, usedStories, story })
//   getCageMathHint(puzzle, entries)   a nudge, then where, then why
//   solveCageMath(puzzle, entries)     the logical solver (used by the tests)
import { makeRng } from './rng.js';
import { aNum, bit, bitCount, bitsOf, onlyBit, cellName, cap, clamp01, fingerprint, pickByToughness, kitStory, KIT_LEVEL_NAMES, listOr, listAnd } from './kit-common.js';

export const CM_TECHNIQUES = {
  nakedSingle: { level: 1, name: 'Only number left' },
  hiddenSingle: { level: 1, name: 'Only place left' },
  cageCombo: { level: 2, name: 'Cage combinations' },
  cageLine: { level: 3, name: 'Cage claims a line' },
  nakedPair: { level: 4, name: 'Matching pair' },
  hiddenPair: { level: 4, name: 'Hidden pair' },
  nakedTriple: { level: 5, name: 'Matching three' },
  cageTotal: { level: 5, name: 'Line total' },
};

// ops: weights for two-cell cages; big: weights for cages of three or more.
export const CM_TIERS = {
  basic: { name: 'Basic', sizes: [4], cage: { 1: 2, 2: 8 }, ops: { '+': 1 }, big: { '+': 1 }, maxTech: 2, minTech: 1 },
  easy: { name: 'Easy', sizes: [4, 5], cage: { 1: 1, 2: 6, 3: 3 }, ops: { '+': 3, '−': 3, '×': 1 }, big: { '+': 3, '×': 1 }, maxTech: 2, minTech: 2 },
  medium: { name: 'Medium', sizes: [5, 6], cage: { 1: 0.6, 2: 5, 3: 4 }, ops: { '+': 2, '−': 3, '×': 2, '÷': 2 }, big: { '+': 2, '×': 2 }, maxTech: 3, minTech: 2 },
  hard: { name: 'Hard', sizes: [6, 7], cage: { 1: 0.3, 2: 4.5, 3: 4, 4: 1.5 }, ops: { '+': 2, '−': 3, '×': 2, '÷': 2 }, big: { '+': 3, '×': 2 }, maxTech: 4, minTech: 3 },
  expert: { name: 'Expert', sizes: [7, 8], cage: { 2: 4, 3: 4, 4: 2 }, ops: { '+': 2, '−': 3, '×': 2, '÷': 2 }, big: { '+': 3, '×': 2 }, maxTech: 5, minTech: 4 },
  master: { name: 'Master', sizes: [8, 9], cage: { 2: 4, 3: 4, 4: 2 }, ops: { '+': 2, '−': 3, '×': 1, '÷': 2 }, big: { '+': 3, '×': 2 }, maxTech: 5, minTech: 3, minTop: 8 },
};
export const CM_SIZES = [4, 5, 6, 7, 8, 9];

const WEIGHT = { 1: 0, 2: 0.5, 3: 3, 4: 6, 5: 10 };
const toughnessOf = (steps, N) => Math.round(steps.reduce((t, s) => t + WEIGHT[CM_TECHNIQUES[s.technique].level], 0) + N);

export const cageLabel = (cg) => (cg.op === '=' ? String(cg.target) : `${cg.target}${cg.op}`);

// ---------- the solver ----------

function opOk(op, target, vals) {
  if (op === '=') return vals[0] === target;
  if (op === '+') return vals.reduce((a, b) => a + b, 0) === target;
  if (op === '×') return vals.reduce((a, b) => a * b, 1) === target;
  const [a, b] = vals;
  if (op === '−') return Math.abs(a - b) === target;
  if (op === '÷') return Math.max(a, b) === target * Math.min(a, b);
  return false;
}

// Every way to fill a cage (numbers in a shared row or column differ).
function cageTuples(N, cg) {
  const cells = cg.cells, k = cells.length, out = [], cur = [];
  const r = (c) => Math.floor(c / N), col = (c) => c % N;
  const go = (i, acc) => {
    if (i === k) { if (opOk(cg.op, cg.target, cur)) out.push(cur.slice()); return; }
    for (let v = 1; v <= N; v++) {
      let bad = false;
      for (let j = 0; j < i; j++) if (cur[j] === v && (r(cells[j]) === r(cells[i]) || col(cells[j]) === col(cells[i]))) { bad = true; break; }
      if (bad) continue;
      if (cg.op === '+' && acc + v > cg.target) break;
      if (cg.op === '×' && cg.target % (acc * v)) continue;
      cur[i] = v;
      go(i + 1, cg.op === '×' ? acc * v : acc + v);
    }
  };
  go(0, cg.op === '×' ? 1 : 0);
  return out;
}

const unitName = (u, N) => (u < N ? `row ${u + 1}` : `column ${u - N + 1}`);
const where = (cg, N) => `the ${cageLabel(cg)} cage at ${cellName(N, Math.min(...cg.cells))}`;

function combosText(tuples) {
  const sets = [...new Set(tuples.map((t) => t.slice().sort((a, b) => a - b).join(',')))].map((x) => x.split(',').map(Number));
  if (sets.length > 4) return null;
  return sets.map((xs) => listAnd(xs)).join(', or from ');
}

// The solver, from a puzzle and the numbers already placed. Returns the steps
// it took (each with its technique and a plain-words reason) and the grid.
export function solveCageMath(p, entries = [], { maxTech = 5, stopAtPlace = false } = {}) {
  const N = p.size, NN = N * N, full = (1 << N) - 1;
  const cand = Array(NN).fill(full), val = Array(NN).fill(0);
  const units = [];
  for (let r = 0; r < N; r++) units.push([...Array(N)].map((_, c) => r * N + c));
  for (let c = 0; c < N; c++) units.push([...Array(N)].map((_, r) => r * N + c));
  const cages = p.cages.map((cg) => ({ ...cg, tuples: cageTuples(N, cg) }));
  const cageOf = Array(NN);
  cages.forEach((cg, k) => cg.cells.forEach((c) => { cageOf[c] = k; }));
  const steps = [];
  let contradiction = false;
  const placeVal = (c, d) => {
    val[c] = d; cand[c] = bit(d);
    const r = Math.floor(c / N), co = c % N;
    for (const x of units[r]) if (x !== c) cand[x] &= ~bit(d);
    for (const x of units[N + co]) if (x !== c) cand[x] &= ~bit(d);
  };
  for (const cg of cages) if (cg.op === '=') placeVal(cg.cells[0], cg.target);
  entries.forEach((d, c) => { if (d && !val[c] && cand[c] & bit(d)) placeVal(c, d); });
  const filterTuples = (cg) => { cg.tuples = cg.tuples.filter((t) => t.every((v, k) => cand[cg.cells[k]] & bit(v))); };

  const remove = (list) => { for (const [c, d] of list) cand[c] &= ~bit(d); };
  const elimsFrom = (cells, mask) => {
    const out = [];
    for (const c of cells) if (!val[c]) for (const d of bitsOf(cand[c] & mask)) out.push([c, d]);
    return out;
  };

  function nextStep() {
    // Only number left.
    for (let c = 0; c < NN; c++) {
      if (val[c]) continue;
      if (!cand[c]) { contradiction = true; return null; }
      const d = onlyBit(cand[c]);
      if (d) return { technique: 'nakedSingle', place: [c, d], cells: [c], why: `${cap(cellName(N, c))} can only be ${d}: every other number is already in its row or column, or cannot make ${where(cages[cageOf[c]], N)}.` };
    }
    // Only place left in a row or column.
    for (let u = 0; u < 2 * N; u++) {
      for (let d = 1; d <= N; d++) {
        const spots = units[u].filter((c) => cand[c] & bit(d));
        if (!spots.length) { contradiction = true; return null; }
        if (spots.length === 1 && !val[spots[0]]) {
          const c = spots[0];
          return { technique: 'hiddenSingle', place: [c, d], cells: [c], why: `In ${unitName(u, N)}, ${d} can only go in ${u < N ? `column ${(c % N) + 1}` : `row ${Math.floor(c / N) + 1}`}.` };
        }
      }
    }
    if (maxTech < 2) return null;
    // Cage combinations: only some ways to make the target fit the row and column.
    for (const cg of cages) {
      if (cg.op === '=' || cg.cells.every((c) => val[c])) continue;
      filterTuples(cg);
      if (!cg.tuples.length) { contradiction = true; return null; }
      const elim = [];
      cg.cells.forEach((c, k) => {
        if (val[c]) return;
        let ok = 0;
        for (const t of cg.tuples) ok |= bit(t[k]);
        for (const d of bitsOf(cand[c] & ~ok)) elim.push([c, d]);
      });
      if (elim.length) {
        const nums = [...new Set(elim.map(([, d]) => d))].sort((a, b) => a - b);
        return { technique: 'cageCombo', remove: elim, cells: cg.cells.slice(), why: `${combosText(cg.tuples) ? `${cap(where(cg, N))} can only be made from ${combosText(cg.tuples)} with the numbers still open here` : `Only a few ways of making ${where(cg, N)} fit the numbers still open here`}, so ${elim.length === 1 ? cellName(N, elim[0][0]) : 'some of its cells'} cannot be ${listOr(nums)}.` };
      }
    }
    if (maxTech < 3) return null;
    // A cage that must put a number in one row or column claims it there.
    for (const cg of cages) {
      if (cg.op === '=' || cg.cells.every((c) => val[c])) continue;
      for (let d = 1; d <= N; d++) {
        for (const kind of [0, 1]) {
          let line = -2;
          for (const t of cg.tuples) {
            const lines = new Set(cg.cells.filter((c, k) => t[k] === d).map((c) => (kind ? c % N : Math.floor(c / N))));
            if (lines.size !== 1) { line = -1; break; }
            const l = [...lines][0];
            if (line === -2) line = l; else if (line !== l) { line = -1; break; }
          }
          if (line < 0) continue;
          const u = kind ? N + line : line;
          const elim = elimsFrom(units[u].filter((c) => !cg.cells.includes(c)), bit(d));
          if (elim.length) return { technique: 'cageLine', remove: elim, cells: cg.cells.slice(), why: `Every way to make ${where(cg, N)} puts ${aNum(d)} in ${unitName(u, N)}, so no other cell in ${unitName(u, N)} can be ${d}.` };
        }
      }
    }
    if (maxTech < 4) return null;
    for (let u = 0; u < 2 * N; u++) {
      const open = units[u].filter((c) => !val[c]);
      // Matching pair: two cells that can only be the same two numbers.
      for (let i = 0; i < open.length; i++) {
        if (bitCount(cand[open[i]]) !== 2) continue;
        for (let j = i + 1; j < open.length; j++) {
          if (cand[open[j]] !== cand[open[i]]) continue;
          const elim = elimsFrom(open.filter((c) => c !== open[i] && c !== open[j]), cand[open[i]]);
          if (elim.length) {
            const [a, b] = bitsOf(cand[open[i]]);
            return { technique: 'nakedPair', remove: elim, cells: [open[i], open[j]], why: `In ${unitName(u, N)}, ${cellName(N, open[i])} and ${cellName(N, open[j])} can only be ${a} or ${b}. Between them they take both, so the rest of ${unitName(u, N)} cannot be ${a} or ${b}.` };
          }
        }
      }
      // Hidden pair: two numbers that only fit the same two cells.
      for (let a = 1; a <= N; a++) {
        const sa = open.filter((c) => cand[c] & bit(a));
        if (sa.length !== 2) continue;
        for (let b = a + 1; b <= N; b++) {
          const sb = open.filter((c) => cand[c] & bit(b));
          if (sb.length !== 2 || sb[0] !== sa[0] || sb[1] !== sa[1]) continue;
          const elim = elimsFrom(sa, full & ~(bit(a) | bit(b)));
          if (elim.length) return { technique: 'hiddenPair', remove: elim, cells: sa.slice(), why: `In ${unitName(u, N)}, ${a} and ${b} can only go in ${cellName(N, sa[0])} and ${cellName(N, sa[1])}, so those two cells hold nothing else.` };
        }
      }
    }
    if (maxTech < 5) return null;
    for (let u = 0; u < 2 * N; u++) {
      const open = units[u].filter((c) => !val[c] && bitCount(cand[c]) <= 3);
      for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) for (let k = j + 1; k < open.length; k++) {
        const m = cand[open[i]] | cand[open[j]] | cand[open[k]];
        if (bitCount(m) !== 3) continue;
        const three = [open[i], open[j], open[k]];
        const elim = elimsFrom(units[u].filter((c) => !three.includes(c)), m);
        if (elim.length) return { technique: 'nakedTriple', remove: elim, cells: three, why: `In ${unitName(u, N)}, three cells can only hold ${bitsOf(m).join(', ')} between them, so no other cell in ${unitName(u, N)} can.` };
      }
    }
    // Line total: a row or column adds up to 1 + 2 + ... + N. When every cage
    // but one cell's lies wholly inside it, that cell is what is left over.
    const total = (N * (N + 1)) / 2;
    for (let u = 0; u < 2 * N; u++) {
      const inside = new Set(units[u]);
      const sumCages = cages.filter((cg) => cg.op === '+' || cg.op === '=').filter((cg) => cg.cells.every((c) => inside.has(c)));
      const covered = new Set(sumCages.flatMap((cg) => cg.cells));
      const rest = units[u].filter((c) => !covered.has(c) && !val[c]);
      if (rest.length !== 1) continue;
      const known = units[u].filter((c) => !covered.has(c) && val[c]).reduce((s, c) => s + val[c], 0);
      const d = total - sumCages.reduce((s, cg) => s + cg.target, 0) - known;
      const c = rest[0];
      if (d >= 1 && d <= N && cand[c] & bit(d) && bitCount(cand[c]) > 1) {
        return { technique: 'cageTotal', place: [c, d], cells: [c], why: `${cap(unitName(u, N))} adds up to ${total}. Its whole adding cages make ${sumCages.reduce((s, cg) => s + cg.target, 0)}${known ? ` and its other cells ${known}` : ''}, so ${cellName(N, c)} is what is left: ${d}.` };
      }
    }
    return null;
  }

  let guard = 0;
  while (guard++ < 4000) {
    if (val.every(Boolean)) break;
    const s = nextStep();
    if (!s || contradiction) break;
    steps.push(s);
    if (s.place) placeVal(s.place[0], s.place[1]);
    if (s.remove) remove(s.remove);
    if (stopAtPlace && s.place) break;
  }
  const solved = !contradiction && val.every(Boolean);
  const hardest = steps.reduce((m, s) => Math.max(m, CM_TECHNIQUES[s.technique].level), 1);
  return { solved, steps, values: val, hardest, contradiction };
}

// A brute-force count of answers (stops at `limit`), independent of the logic solver.
export function countCageMath(p, limit = 2) {
  const N = p.size, NN = N * N;
  const cages = p.cages.map((cg) => ({ ...cg, tuples: cageTuples(N, cg) }));
  const grid = Array(NN).fill(0);
  const rowUsed = Array(N).fill(0), colUsed = Array(N).fill(0);
  let count = 0;
  cages.sort((a, b) => a.tuples.length - b.tuples.length);
  const go = (k) => {
    if (count >= limit) return;
    if (k === cages.length) { count++; return; }
    const cg = cages[k];
    for (const t of cg.tuples) {
      let ok = true;
      for (let i = 0; i < t.length; i++) { const c = cg.cells[i], b = bit(t[i]); if (rowUsed[Math.floor(c / N)] & b || colUsed[c % N] & b) { ok = false; break; } }
      if (!ok) continue;
      t.forEach((v, i) => { const c = cg.cells[i]; rowUsed[Math.floor(c / N)] |= bit(v); colUsed[c % N] |= bit(v); grid[c] = v; });
      go(k + 1);
      t.forEach((v, i) => { const c = cg.cells[i]; rowUsed[Math.floor(c / N)] &= ~bit(v); colUsed[c % N] &= ~bit(v); });
      if (count >= limit) return;
    }
  };
  go(0);
  return count;
}

// ---------- building a puzzle ----------

function latinSquare(N, rng) {
  // Row by row, each a random arrangement that fits the columns so far.
  for (let attempt = 0; attempt < 50; attempt++) {
    const g = [], colUsed = Array(N).fill(0);
    let ok = true;
    for (let r = 0; r < N && ok; r++) {
      const row = Array(N).fill(0), used = new Set();
      const go = (c) => {
        if (c === N) return true;
        for (const v of rng.shuffle([...Array(N)].map((_, i) => i + 1))) {
          if (used.has(v) || colUsed[c] & bit(v)) continue;
          used.add(v); row[c] = v;
          if (go(c + 1)) return true;
          used.delete(v);
        }
        return false;
      };
      if (!go(0)) { ok = false; break; }
      row.forEach((v, c) => { colUsed[c] |= bit(v); });
      g.push(...row);
    }
    if (ok) return g;
  }
  // A shuffled cyclic square, always possible.
  const rows = rng.shuffle([...Array(N).keys()]), cols = rng.shuffle([...Array(N).keys()]), syms = rng.shuffle([...Array(N)].map((_, i) => i + 1));
  return [...Array(N * N)].map((_, i) => syms[(rows[Math.floor(i / N)] + cols[i % N]) % N]);
}

function partition(N, tier, rng) {
  const NN = N * N, owner = Array(NN).fill(-1), cages = [];
  const nbrs = (c) => [c - N, c + N, c % N ? c - 1 : -1, c % N < N - 1 ? c + 1 : -1].filter((x) => x >= 0 && x < NN);
  const sizes = Object.fromEntries(Object.entries(tier.cage).map(([k, w]) => [k, w]));
  for (const start of rng.shuffle([...Array(NN).keys()])) {
    if (owner[start] >= 0) continue;
    const want = Number(rng.weighted(sizes));
    const cells = [start];
    owner[start] = cages.length;
    while (cells.length < want) {
      const opts = [...new Set(cells.flatMap(nbrs))].filter((x) => owner[x] < 0);
      if (!opts.length) break;
      const x = rng.pick(opts);
      owner[x] = cages.length;
      cells.push(x);
    }
    cages.push({ cells });
  }
  // Single cells nobody asked for join a neighboring cage that has room.
  const maxSize = Math.max(...Object.keys(tier.cage).map(Number));
  const allowSingles = !!tier.cage[1];
  for (const cg of cages) {
    if (cg.cells.length !== 1 || allowSingles) continue;
    const c = cg.cells[0];
    const near = rng.shuffle(nbrs(c).map((x) => owner[x])).find((k) => cages[k] !== cg && cages[k].cells.length < maxSize);
    if (near === undefined) continue;
    cages[near].cells.push(c);
    owner[c] = near;
    cg.cells = [];
  }
  return cages.filter((cg) => cg.cells.length).map((cg) => ({ cells: cg.cells.sort((a, b) => a - b) }));
}

function assignOps(cages, sol, tier, rng) {
  for (const cg of cages) {
    const vals = cg.cells.map((c) => sol[c]);
    if (vals.length === 1) { cg.op = '='; cg.target = vals[0]; continue; }
    const w = { ...(vals.length === 2 ? tier.ops : tier.big) };
    if (vals.length === 2) {
      const [a, b] = [Math.max(...vals), Math.min(...vals)];
      if (a % b) delete w['÷'];
    }
    const prod = vals.reduce((x, y) => x * y, 1);
    if (prod > 3000) delete w['×'];
    const op = rng.weighted(Object.keys(w).length ? w : { '+': 1 });
    cg.op = op;
    cg.target = op === '+' ? vals.reduce((x, y) => x + y, 0) : op === '×' ? prod : op === '−' ? Math.abs(vals[0] - vals[1]) : Math.max(...vals) / Math.min(...vals);
  }
  return cages;
}

const fpOf = (N, cages) => fingerprint('cm', `${N}|${cages.map((cg) => `${cg.cells.join('.')}${cg.op}${cg.target}`).join('/')}`);

function candidate(N, tier, rng) {
  const sol = latinSquare(N, rng);
  const cages = assignOps(partition(N, tier, rng), sol, tier, rng);
  const p = { size: N, cages };
  const res = solveCageMath(p, [], { maxTech: tier.maxTech });
  if (!res.solved) return null;
  const top = res.steps.filter((s) => CM_TECHNIQUES[s.technique].level >= tier.minTech).length;
  const fits = res.hardest >= tier.minTech && (!tier.minTop || top >= tier.minTop);
  return { sol, cages, res, fits, score: toughnessOf(res.steps, N) };
}

export function generateCageMath({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story = true } = {}) {
  const tier = CM_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = CM_SIZES.includes(Number(size)) ? Number(size) : tier.sizes[0];
  if (practice && (!CM_TECHNIQUES[practice] || CM_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seen = new Set(avoid);
  const want = N >= 8 ? 2 : 4;
  const found = [];
  let practiceTries = 0, backup = null;
  // A time budget, so a big grid never keeps the player waiting: past it, the
  // toughest proven puzzle found so far is used.
  const until = Date.now() + (N >= 8 ? 5000 : 3000);
  for (let attempt = 0; attempt < 600 && found.length < want; attempt++) {
    if (Date.now() > until && (found.length || backup)) break;
    const c = candidate(N, tier, makeRng(`${seed}:${attempt}`));
    if (!c) continue;
    if (seen.has(fpOf(N, c.cages))) continue;
    if (!c.fits) { if (!backup || c.score > backup.score) backup = c; continue; }
    if (practice && !c.res.steps.some((s) => s.technique === practice) && ++practiceTries < 40) continue;
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { sol, cages, res } = pick;
  const p = {
    kind: 'cage-math', game: 'cm',
    id: `cm-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N, cages,
    givens: Array(N * N).fill(0).map((_, c) => { const cg = cages.find((x) => x.cells.includes(c)); return cg.op === '=' ? cg.target : 0; }),
    solution: sol,
    solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: CM_TECHNIQUES[s.technique].name, place: s.place || null, remove: s.remove || null, cells: s.cells || [], why: s.why })),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: pick.score,
    fingerprint: fpOf(N, cages),
    rules: [
      `Fill every cell with a number from 1 to ${N}.`,
      'Each row and each column holds every number exactly once.',
      'The numbers in each outlined cage make its target with its sign: + adds, − is the difference, × multiplies, ÷ divides the bigger by the smaller.',
      'A number may repeat inside a cage, as long as it is not twice in one row or column.',
    ],
  };
  if (story) p.story = kitStory('cm', seed, usedStories);
  return p;
}

export function checkCageMath(p, entries = []) {
  const wrong = [];
  entries.forEach((d, c) => { if (d && !p.givens[c] && d !== p.solution[c]) wrong.push(c); });
  return { wrong, solved: p.solution.every((d, c) => (p.givens[c] || entries[c]) === d) };
}

export function getCageMathHint(p, entries = []) {
  const N = p.size;
  const { wrong } = checkCageMath(p, entries);
  if (wrong.length) {
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One number does' : `${wrong.length} numbers do`} not fit.`, `Check ${cellName(N, wrong[0])}.`, `${cap(cellName(N, wrong[0]))} is not ${entries[wrong[0]]}.`] };
  }
  if (p.solution.every((d, c) => (p.givens[c] || entries[c]) === d)) return { kind: 'done', levels: ['Every cell is filled in correctly.'] };
  const res = solveCageMath(p, entries, { maxTech: 5, stopAtPlace: true });
  const at = res.steps.findIndex((s) => s.place);
  if (at < 0) return { kind: 'stuck', levels: ['Look for a small cage with only one or two ways to make its target.'] };
  const step = res.steps[at], lead = res.steps.slice(0, at);
  const [c, d] = step.place;
  const cg = p.cages.find((x) => x.cells.includes(c));
  return {
    kind: 'step', technique: step.technique, techniqueName: CM_TECHNIQUES[step.technique].name,
    cell: c, digit: d, value: d, cells: [c],
    levels: [
      lead.length ? `First: ${lead[lead.length - 1].why}` : `Look at the ${cageLabel(cg)} cage at ${cellName(N, Math.min(...cg.cells))}.`,
      `Look at ${cellName(N, c)}.`,
      step.why,
    ],
  };
}
