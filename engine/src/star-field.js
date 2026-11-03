// Star Field: an N×N grid split into N outlined regions. Place stars so every
// row, every column and every region holds the same number of stars (one, or
// two on the bigger grids), and no two stars touch, not even at a corner.
// Every puzzle is proven by a solver that works the way a person does, so it
// has exactly one answer reachable without guessing, and its difficulty is
// the hardest step it needs.
//
// Cell values: 1 star, 2 blank (a dot), 0 not decided yet.
//
//   generateStarField({ difficulty, size, seed, avoid, toughness, practice, usedStories, story, theme })
//   getStarFieldHint(puzzle, entries)   a nudge, then where, then why
//   solveStarField(puzzle, entries)     the logical solver (used by the tests)
//   countStarField(puzzle, limit)       brute-force answer counter (tests only)
import { makeRng } from './rng.js';
import { cellName, cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES, listAnd } from './kit-common.js';
import { kitThemeStory } from './kit-story.js';

export const SF_TECHNIQUES = {
  neighbour: { level: 1, name: 'Stars never touch' },
  finished: { level: 1, name: 'Finished line or region' },
  onlyPlace: { level: 1, name: 'Only room left' },
  squeeze: { level: 2, name: 'Region claims a line' },
  touchAll: { level: 2, name: 'Touching every choice' },
  blocks: { level: 3, name: 'One star per 2×2 block' },
  noRoom: { level: 3, name: 'No room left' },
  groups: { level: 4, name: 'Regions share lines' },
  chain: { level: 5, name: 'Following it through' },
};

// stars: stars per row, column and region. tries: how many region layouts to
// look at; want: how many proven puzzles to choose between.
export const SF_TIERS = {
  basic: { name: 'Basic', sizes: [5], stars: 1, minTech: 1, maxTech: 2 },
  easy: { name: 'Easy', sizes: [6], stars: 1, minTech: 2, maxTech: 2 },
  medium: { name: 'Medium', sizes: [7, 8], stars: 1, minTech: 3, maxTech: 3 },
  hard: { name: 'Hard', sizes: [8, 9], stars: 1, minTech: 4, maxTech: 4 },
  expert: { name: 'Expert', sizes: [10], stars: 2, minTech: 3, maxTech: 4 },
  master: { name: 'Master', sizes: [10, 11], stars: 2, minTech: 5, maxTech: 5 },
};
export const SF_SIZES = [5, 6, 7, 8, 9, 10, 11];

// ---------- the grid's shape ----------

const shapes = new Map();
function shapeOf(N) {
  let s = shapes.get(N);
  if (s) return s;
  const adj = [], orth = [];
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N, a = [], o = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
      a.push(rr * N + cc);
      if (!dr || !dc) o.push(rr * N + cc);
    }
    adj.push(a); orth.push(o);
  }
  s = { adj, orth };
  shapes.set(N, s);
  return s;
}
const touches = (N, a, b) => a !== b && Math.abs(Math.floor(a / N) - Math.floor(b / N)) <= 1 && Math.abs((a % N) - (b % N)) <= 1;

function unitsOf(N, regions) {
  const units = [];
  for (let r = 0; r < N; r++) units.push([...Array(N)].map((_, c) => r * N + c));
  for (let c = 0; c < N; c++) units.push([...Array(N)].map((_, r) => r * N + c));
  for (let k = 0; k < N; k++) units.push([]);
  regions.forEach((k, i) => units[2 * N + k].push(i));
  const of = [...Array(N * N)].map((_, i) => [Math.floor(i / N), N + (i % N), 2 * N + regions[i]]);
  return { units, of };
}

const unitName = (N, u) => (u < N ? `row ${u + 1}` : u < 2 * N ? `column ${u - N + 1}` : `region ${u - 2 * N + 1}`);
// Cell names contain a comma ("row 2, column 3"), so lists of them use semicolons.
const semi = (xs, word) => (xs.length === 1 ? xs[0] : xs.length === 2 ? `${xs[0]} ${word} ${xs[1]}` : `${xs.slice(0, -1).join('; ')}; ${word} ${xs[xs.length - 1]}`);
const cellsText = (N, cells, word = 'and') => {
  const xs = cells.slice().sort((a, b) => a - b).map((c) => cellName(N, c));
  return xs.length > 4 ? `${xs.slice(0, 3).join('; ')} and ${xs.length - 3} more cells` : semi(xs, word);
};
const plural = (n, one, many) => (n === 1 ? one : many);
const starWord = (n) => (n === 1 ? 'one star' : n === 2 ? 'two stars' : `${n} stars`);

// ---------- the solver ----------

// Can these open cells still take `need` more stars that do not touch?
// (Five or more cells always can: at most four cells can all touch each other.)
function roomFor(N, open, need) {
  if (need <= 0) return true;
  if (open.length < need) return false;
  if (need === 1 || open.length >= 5) return true;
  for (let a = 0; a < open.length; a++) for (let b = a + 1; b < open.length; b++) if (!touches(N, open[a], open[b])) return true;
  return false;
}

// The grid as the solver sees it, with star and open counts kept per unit
// (rows 0..N-1, columns N..2N-1, regions 2N..3N-1).
class Grid {
  constructor(base, g, sc, oc) {
    this.base = base; this.N = base.N; this.K = base.K; this.units = base.units; this.of = base.of; this.adj = base.adj;
    this.g = g; this.sc = sc; this.oc = oc;
  }
  need(u) { return this.K - this.sc[u]; }
  open(u) { const g = this.g; return this.units[u].filter((c) => !g[c]); }
  set(c, v) {
    const was = this.g[c];
    if (was === v) return;
    for (const u of this.of[c]) {
      if (was === 1) this.sc[u]--; else if (!was) this.oc[u]--;
      if (v === 1) this.sc[u]++; else if (!v) this.oc[u]++;
    }
    this.g[c] = v;
  }
  copy() { return new Grid(this.base, this.g.slice(), this.sc.slice(), this.oc.slice()); }
}
function makeState(p, g) {
  const N = p.size, K = p.stars;
  const { units, of } = unitsOf(N, p.regions);
  const { adj } = shapeOf(N);
  const sc = new Int16Array(3 * N), oc = new Int16Array(3 * N);
  units.forEach((cells, u) => { for (const c of cells) { if (g[c] === 1) sc[u]++; else if (!g[c]) oc[u]++; } });
  return new Grid({ N, K, units, of, adj }, g, sc, oc);
}

function unitBroken(st, u) {
  const need = st.need(u);
  if (need < 0) return true;
  if (need === 0) return false;
  if (st.oc[u] < need) return true;
  if (need === 1 || st.oc[u] >= 5) return false;
  return !roomFor(st.N, st.open(u), need);
}

// The first thing that is wrong in a grid: a unit with too many stars, two
// stars touching, or a unit with no room for the stars it still needs.
function broken(st, only = null) {
  const { N, g, units, adj } = st;
  if (!only) for (let i = 0; i < N * N; i++) if (g[i] === 1 && adj[i].some((x) => g[x] === 1)) return { touch: i };
  for (const u of only || units.keys()) if (unitBroken(st, u)) return { unit: u, need: st.need(u) };
  return null;
}

// Each technique looks for one step and returns it (it does not change the grid).
const TECH = {
  neighbour(st) {
    const { N, g, adj } = st;
    for (let i = 0; i < N * N; i++) {
      if (g[i] !== 1) continue;
      const xs = adj[i].filter((x) => !g[x]);
      if (xs.length) return { technique: 'neighbour', marks: xs.map((x) => [x, 2]), focus: [i], look: `the star at ${cellName(N, i)}`, why: `Stars never touch, not even at a corner, so the ${xs.length === 1 ? 'open cell' : `${xs.length} open cells`} around the star at ${cellName(N, i)} ${plural(xs.length, 'is', 'are')} empty.` };
    }
    return null;
  },
  finished(st) {
    const { N, K, units } = st;
    for (let u = 0; u < units.length; u++) {
      if (!st.oc[u] || st.need(u) !== 0) continue;
      const open = st.open(u);
      return { technique: 'finished', marks: open.map((x) => [x, 2]), focus: units[u], look: unitName(N, u), why: `${cap(unitName(N, u))} already has ${K === 1 ? 'its star' : 'both its stars'}, so the rest of it is empty.` };
    }
    return null;
  },
  onlyPlace(st) {
    const { N, units } = st;
    for (let u = 0; u < units.length; u++) {
      const need = st.need(u);
      if (need <= 0 || st.oc[u] !== need) continue;
      const open = st.open(u);
      return { technique: 'onlyPlace', marks: open.map((x) => [x, 1]), focus: units[u], look: unitName(N, u), why: `${cap(unitName(N, u))} needs ${need === 1 ? 'one more star' : `${starWord(need)} more`} and has only ${need === 1 ? 'one open cell' : `${need} open cells`} left, so ${need === 1 ? `${cellName(N, open[0])} is a star` : `${cellsText(N, open)} are stars`}.` };
    }
    return null;
  },
  // A region whose open cells all sit in one row (or column) puts its
  // stars there; if that is all the line still needs, the rest of the line is blank.
  // The same works the other way round: a line whose open cells all sit in one region.
  squeeze(st) {
    const { N, g, units, of } = st;
    for (let reg = 2 * N; reg < 3 * N; reg++) {
      const need = st.need(reg);
      if (need <= 0) continue;
      for (const pick of [0, 1]) {
        // Do the region's open cells share one line?
        let line = -1;
        for (const c of units[reg]) if (!g[c]) { const l = of[c][pick]; if (line < 0) line = l; else if (l !== line) { line = -2; break; } }
        if (line < 0 || st.need(line) !== need || st.oc[line] === st.oc[reg]) continue;
        const xs = units[line].filter((c) => !g[c] && of[c][2] !== reg);
        if (xs.length) return { technique: 'squeeze', marks: xs.map((x) => [x, 2]), focus: units[reg], look: unitName(N, reg), why: `Every open cell left in ${unitName(N, reg)} is in ${unitName(N, line)}. ${need === 1 ? 'Its star' : 'Its stars'} must go there, which is all ${unitName(N, line)} still needs, so the other cells of ${unitName(N, line)} are empty.` };
      }
    }
    for (let line = 0; line < 2 * N; line++) {
      const need = st.need(line);
      if (need <= 0) continue;
      let reg = -1;
      for (const c of units[line]) if (!g[c]) { const k = of[c][2]; if (reg < 0) reg = k; else if (k !== reg) { reg = -2; break; } }
      if (reg < 0 || st.need(reg) !== need || st.oc[line] === st.oc[reg]) continue;
      const xs = units[reg].filter((c) => !g[c] && of[c][line < N ? 0 : 1] !== line);
      if (xs.length) return { technique: 'squeeze', marks: xs.map((x) => [x, 2]), focus: units[line], look: unitName(N, line), why: `Every open cell left in ${unitName(N, line)} is in ${unitName(N, reg)}. So ${unitName(N, reg)} gets ${need === 1 ? 'its star' : 'its stars'} from ${unitName(N, line)}, and the rest of ${unitName(N, reg)} is empty.` };
    }
    return null;
  },
  // A unit needing one star whose choices all touch each other: any cell that
  // touches every one of those choices is blank, wherever the star goes.
  touchAll(st) {
    const { N, g, units, adj } = st;
    for (let u = 0; u < units.length; u++) {
      if (st.need(u) !== 1 || st.oc[u] < 2 || st.oc[u] > 4) continue;
      const open = st.open(u);
      if (!open.every((a) => open.every((b) => a === b || touches(N, a, b)))) continue;
      const xs = adj[open[0]].filter((y) => !g[y] && !open.includes(y) && open.every((c) => touches(N, c, y)));
      if (xs.length) return { technique: 'touchAll', marks: xs.map((x) => [x, 2]), focus: open, look: unitName(N, u), why: `${cap(unitName(N, u))}'s ${st.K === 1 ? 'star' : 'last star'} must be in ${cellsText(N, open, 'or')}. ${cap(cellsText(N, xs))} ${plural(xs.length, 'touches', 'touch')} every one of those, so ${plural(xs.length, 'it is', 'they are')} empty.` };
    }
    return null;
  },
  // Try a star in a cell: if it, and the cells it crosses out at once, would
  // leave some row, column or region without room, the cell is blank.
  noRoom(st) {
    const { N, g } = st;
    for (let i = 0; i < N * N; i++) {
      if (g[i]) continue;
      const t = st.copy();
      t.set(i, 1);
      const touched = new Set(st.of[i]);
      for (const x of st.adj[i]) if (!t.g[x]) { t.set(x, 2); for (const u of st.of[x]) touched.add(u); }
      for (const u of st.of[i]) if (t.need(u) === 0) for (const c of t.open(u)) { t.set(c, 2); for (const v of st.of[c]) touched.add(v); }
      const bad = broken(t, touched);
      if (bad) {
        const need = st.need(bad.unit) - (st.of[i].includes(bad.unit) ? 1 : 0);
        return { technique: 'noRoom', marks: [[i, 2]], focus: st.units[bad.unit], look: cellName(N, i), why: `A star at ${cellName(N, i)} would cross out the cells around it and leave ${unitName(N, bad.unit)} with no room for ${need <= 1 ? (st.K === 1 ? 'its star' : 'its last star') : 'its two stars'}. So ${cellName(N, i)} is empty.` };
      }
    }
    return null;
  },
  // N regions that fit inside N rows (or columns) take every star those lines
  // have, so the rest of those lines is blank; and N lines that fit inside N
  // regions take every star those regions have.
  groups(st) {
    const { N, K, g, units } = st;
    const maxM = Math.floor(N / 2);
    for (const pick of [0, 1]) {
      const lineOf = (c) => (pick ? c % N : Math.floor(c / N));
      const lineWord = pick ? 'columns' : 'rows';
      // Regions inside lines.
      const span = [];
      for (let k = 0; k < N; k++) span.push(units[2 * N + k].filter((c) => g[c] !== 2).reduce((m, c) => m | (1 << lineOf(c)), 0));
      const found = subsetSearch(N, span, maxM, (set, mask) => {
        const xs = [];
        for (let l = 0; l < N; l++) if (mask & (1 << l)) for (const c of units[pick ? N + l : l]) if (!g[c] && !set.includes(st.of[c][2] - 2 * N)) xs.push(c);
        return xs.length ? xs : null;
      });
      if (found) {
        const { set, mask, xs } = found;
        const lines = bitsList(mask, N).map((l) => l + 1);
        return { technique: 'groups', marks: xs.map((x) => [x, 2]), focus: set.flatMap((k) => units[2 * N + k]), look: `regions ${listAnd(set.map((k) => k + 1))}`, why: `Regions ${listAnd(set.map((k) => k + 1))} fit entirely inside ${lineWord} ${listAnd(lines)}. Those ${set.length} regions need ${set.length * K} stars, which is every star those ${lineWord} hold, so the other cells of ${lineWord} ${listAnd(lines)} are empty.` };
      }
      // Lines inside regions.
      const lspan = [];
      for (let l = 0; l < N; l++) lspan.push(units[pick ? N + l : l].filter((c) => g[c] !== 2).reduce((m, c) => m | (1 << (st.of[c][2] - 2 * N)), 0));
      const found2 = subsetSearch(N, lspan, maxM, (set, mask) => {
        const xs = [];
        for (let k = 0; k < N; k++) if (mask & (1 << k)) for (const c of units[2 * N + k]) if (!g[c] && !set.includes(lineOf(c))) xs.push(c);
        return xs.length ? xs : null;
      });
      if (found2) {
        const { set, mask, xs } = found2;
        const regs = bitsList(mask, N).map((k) => k + 1);
        return { technique: 'groups', marks: xs.map((x) => [x, 2]), focus: set.flatMap((l) => units[pick ? N + l : l]), look: `${lineWord} ${listAnd(set.map((l) => l + 1))}`, why: `${cap(lineWord)} ${listAnd(set.map((l) => l + 1))} fit entirely inside regions ${listAnd(regs)}. Those ${set.length} ${lineWord} need ${set.length * K} stars, which is every star those regions hold, so the other cells of regions ${listAnd(regs)} are empty.` };
      }
    }
    return null;
  },
  // A 2×2 block can hold only one star. A unit needing two stars whose open
  // cells fit in two separate blocks has one star in each, so any cell that
  // touches all of one block's choices is blank.
  blocks(st) {
    const { N, g, units, adj } = st;
    for (let u = 0; u < units.length; u++) {
      if (st.need(u) !== 2 || st.oc[u] < 3 || st.oc[u] > 8) continue;
      const open = st.open(u);
      const first = open[0], r0 = Math.floor(first / N), c0 = first % N;
      for (const [wr, wc] of [[r0, c0], [r0, c0 - 1], [r0 - 1, c0], [r0 - 1, c0 - 1]]) {
        if (wr < 0 || wc < 0 || wr >= N - 1 || wc >= N - 1) continue;
        const inW = (c) => { const r = Math.floor(c / N), cc = c % N; return r >= wr && r <= wr + 1 && cc >= wc && cc <= wc + 1; };
        const a = open.filter(inW), b = open.filter((c) => !inW(c));
        if (!b.length) continue;
        const rs = b.map((c) => Math.floor(c / N)), cs = b.map((c) => c % N);
        if (Math.max(...rs) - Math.min(...rs) > 1 || Math.max(...cs) - Math.min(...cs) > 1) continue;
        // b fits in a 2×2 block too; the two groups do not share cells.
        if (a.length === 1 || b.length === 1) {
          const [one, rest] = a.length === 1 ? [a[0], b] : [b[0], a];
          return { technique: 'blocks', marks: [[one, 1]], focus: open, look: unitName(N, u), why: `${cap(unitName(N, u))} needs two more stars. Its open cells are ${cellName(N, one)}, plus ${cellsText(N, rest)}, which fit in one 2×2 block. A 2×2 block holds at most one star, so ${cellName(N, one)} must be a star.` };
        }
        const xs = [];
        for (const grp of [a, b]) for (const y of adj[grp[0]]) if (!g[y] && !grp.includes(y) && grp.every((c) => touches(N, c, y)) && !xs.includes(y)) xs.push(y);
        if (xs.length) return { technique: 'blocks', marks: xs.map((x) => [x, 2]), focus: open, look: unitName(N, u), why: `${cap(unitName(N, u))} needs two more stars, and its open cells fit in two 2×2 blocks, one with ${cellsText(N, a)} and one with ${cellsText(N, b)}. A 2×2 block holds at most one star, so each block gets one. ${cap(cellsText(N, xs))} ${plural(xs.length, 'touches', 'touch')} every choice in one of the blocks, so ${plural(xs.length, 'it is', 'they are')} empty.` };
      }
    }
    return null;
  },
  // Try a star in a cell and follow the simple steps from there: if that
  // leaves some row, column or region with no room, the cell is blank.
  chain(st) {
    const { N, g } = st;
    for (let i = 0; i < N * N; i++) {
      if (g[i]) continue;
      const t = st.copy();
      t.set(i, 1);
      const bad = propagate(t, 2, 60);
      if (bad && bad.unit != null) {
        return { technique: 'chain', marks: [[i, 2]], focus: st.units[bad.unit], look: cellName(N, i), why: `Suppose ${cellName(N, i)} held a star. Following the simple steps from there (crossing out its neighbours, finishing lines and regions) leaves ${unitName(N, bad.unit)} with no room for ${st.K === 1 ? 'its star' : 'the stars it needs'}. So ${cellName(N, i)} is empty.` };
      }
      if (bad) return { technique: 'chain', marks: [[i, 2]], focus: [i], look: cellName(N, i), why: `Suppose ${cellName(N, i)} held a star. Following the simple steps from there forces two stars to touch. So ${cellName(N, i)} is empty.` };
    }
    return null;
  },
};

const bitsList = (m, N) => [...Array(N).keys()].filter((b) => m & (1 << b));
const pop = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

// Sets of 2..maxM items whose spans together cover exactly as many lines as there are items.
function subsetSearch(N, span, maxM, test) {
  const items = [...Array(N).keys()].filter((k) => span[k] && pop(span[k]) <= maxM);
  const set = [];
  let out = null;
  const go = (start, mask) => {
    if (out) return;
    if (set.length >= 2 && pop(mask) === set.length) {
      const xs = test(set.slice(), mask);
      if (xs) { out = { set: set.slice(), mask, xs }; return; }
    }
    if (set.length >= maxM) return;
    for (let j = start; j < items.length && !out; j++) {
      const m2 = mask | span[items[j]];
      if (pop(m2) > maxM) continue;
      set.push(items[j]);
      go(j + 1, m2);
      set.pop();
    }
  };
  go(0, 0);
  return out;
}

const ORDER = ['neighbour', 'finished', 'onlyPlace', 'squeeze', 'touchAll', 'blocks', 'noRoom', 'groups', 'chain'];

// Apply techniques up to a level until nothing changes; returns what broke, if anything.
function propagate(st, maxLevel, guard = 200) {
  for (let n = 0; n < guard; n++) {
    const bad = broken(st);
    if (bad) return bad;
    let step = null;
    for (const name of ORDER) {
      if (SF_TECHNIQUES[name].level > maxLevel) break;
      step = TECH[name](st);
      if (step) break;
    }
    if (!step) return null;
    for (const [c, v] of step.marks) st.set(c, v);
  }
  return null;
}

export function solveStarField(p, entries = [], { maxTech = 5, stopAtChange = false, maxSteps = 2000 } = {}) {
  const N = p.size;
  const g = Array(N * N).fill(0);
  (p.givens || []).forEach((v, i) => { if (v) g[i] = v; });
  entries.forEach((v, i) => { if (v && !g[i] && (v === 1) === (p.solution[i] === 1)) g[i] = v; });
  const st = makeState(p, g);
  const steps = [];
  let hardest = 0, contradiction = false;
  for (let n = 0; n < maxSteps; n++) {
    if (g.every(Boolean)) break;
    let step = null;
    for (const name of ORDER) {
      if (SF_TECHNIQUES[name].level > maxTech) break;
      step = TECH[name](st);
      if (step) break;
    }
    if (!step) break;
    for (const [c, v] of step.marks) st.set(c, v);
    hardest = Math.max(hardest, SF_TECHNIQUES[step.technique].level);
    steps.push({ ...step, cells: step.marks.map(([c]) => c) });
    if (stopAtChange) break;
  }
  const solved = !contradiction && g.every(Boolean) && !broken(st);
  return { solved, steps, values: g, hardest, contradiction };
}

// ---------- brute force (tests) ----------

export function countStarField(p, limit = 2) {
  const N = p.size, K = p.stars, reg = p.regions;
  const colN = Array(N).fill(0), regN = Array(N).fill(0);
  let count = 0;
  // Every way to pick K non-touching columns in a row.
  const picks = [];
  for (let a = 0; a < N; a++) {
    if (K === 1) picks.push([a]);
    else for (let b = a + 2; b < N; b++) picks.push([a, b]);
  }
  const go = (r, prev) => {
    if (count >= limit) return;
    if (r === N) { if (regN.every((x) => x === K)) count++; return; }
    // Prune: a region can no longer reach K.
    for (const pk of picks) {
      if (pk.some((c) => colN[c] >= K || prev.some((q) => Math.abs(q - c) <= 1) || regN[reg[r * N + c]] >= K)) continue;
      if (K === 2 && reg[r * N + pk[0]] === reg[r * N + pk[1]] && regN[reg[r * N + pk[0]]] > 0) continue;
      pk.forEach((c) => { colN[c]++; regN[reg[r * N + c]]++; });
      go(r + 1, pk);
      pk.forEach((c) => { colN[c]--; regN[reg[r * N + c]]--; });
      if (count >= limit) return;
    }
  };
  go(0, []);
  return count;
}

// ---------- making a puzzle ----------

function randomSolution(N, K, rng) {
  const rows = [];
  const colN = Array(N).fill(0);
  let tries = 0;
  const go = (r, prev) => {
    if (r === N) return true;
    if (++tries > 20000) return false;
    const cand = [];
    for (let a = 0; a < N; a++) {
      if (K === 1) cand.push([a]);
      else for (let b = a + 2; b < N; b++) cand.push([a, b]);
    }
    for (const pk of rng.shuffle(cand)) {
      if (pk.some((c) => colN[c] >= K || prev.some((q) => Math.abs(q - c) <= 1))) continue;
      pk.forEach((c) => colN[c]++);
      rows.push(pk);
      if (go(r + 1, pk)) return true;
      rows.pop();
      pk.forEach((c) => colN[c]--);
    }
    return false;
  };
  if (!go(0, [])) return null;
  const sol = Array(N * N).fill(2);
  rows.forEach((pk, r) => pk.forEach((c) => { sol[r * N + c] = 1; }));
  return sol;
}

// Regions grown at random around the stars: one star each, or two joined by a path.
function growRegions(N, K, sol, rng) {
  const { orth } = shapeOf(N);
  const reg = Array(N * N).fill(-1);
  const stars = rng.shuffle(sol.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0));
  if (K === 1) stars.forEach((s, k) => { reg[s] = k; });
  else {
    const left = new Set(stars);
    let k = 0;
    for (const s of stars) {
      if (!left.has(s)) continue;
      left.delete(s);
      // The nearest other unpaired star reachable through free cells.
      const from = new Map([[s, -1]]);
      const q = [s];
      let hit = -1;
      for (let h = 0; h < q.length && hit < 0; h++) {
        for (const y of rng.shuffle(orth[q[h]])) {
          if (from.has(y) || reg[y] >= 0) continue;
          if (sol[y] === 1 && !left.has(y)) continue;
          from.set(y, q[h]);
          if (left.has(y)) { hit = y; break; }
          if (sol[y] === 1) continue;
          q.push(y);
        }
      }
      if (hit < 0) return null;
      left.delete(hit);
      for (let x = hit; x >= 0; x = from.get(x)) reg[x] = k;
      k++;
    }
  }
  // Grow: a random free cell next to a region joins it (never a star).
  const bias = [...Array(N)].map(() => 0.4 + rng.next());
  for (let guard = 0; guard < N * N * 4; guard++) {
    const free = [];
    for (let i = 0; i < N * N; i++) if (reg[i] < 0) free.push(i);
    if (!free.length) break;
    const i = rng.pick(free);
    const near = orth[i].filter((y) => reg[y] >= 0).map((y) => reg[y]);
    if (!near.length) continue;
    // Some regions grow faster than others, for a mix of big and small.
    const w = {};
    for (const k of near) w[k] = (w[k] || 0) + bias[k];
    reg[i] = Number(rng.weighted(w));
  }
  if (reg.some((k) => k < 0)) return null;
  return reg;
}

// True when some region is a single cell.
function tinyRegion(reg, N) {
  const count = Array(N).fill(0);
  for (const k of reg) count[k]++;
  return count.some((n) => n === 1);
}

// Renumber regions in reading order of their first cell.
function renumber(reg) {
  const map = new Map();
  return reg.map((k) => { if (!map.has(k)) map.set(k, map.size); return map.get(k); });
}

function connectedWithout(N, reg, k, skip) {
  const { orth } = shapeOf(N);
  const cells = [];
  for (let i = 0; i < reg.length; i++) if (reg[i] === k && i !== skip) cells.push(i);
  if (!cells.length) return false;
  const seen = new Set([cells[0]]), q = [cells[0]];
  for (let h = 0; h < q.length; h++) for (const y of orth[q[h]]) if (y !== skip && reg[y] === k && !seen.has(y)) { seen.add(y); q.push(y); }
  return seen.size === cells.length;
}

const fpOf = (N, K, reg) => fingerprint('sf', `${N}|${K}|${reg.join(',')}`);
const known = (res) => res.values.filter(Boolean).length;
const WEIGHT = { 1: 0.2, 2: 1, 3: 3, 4: 6, 5: 10 };
const scoreOf = (steps, N) => Math.round(steps.reduce((t, s) => t + WEIGHT[SF_TECHNIQUES[s.technique].level], 0) + N);

// One candidate: a random answer and regions, nudged cell by cell where the
// solver gets stuck until the solver can finish it; then, if it is too easy
// for the level, nudged again until the simpler steps alone no longer finish it.
function candidate(N, K, tier, rng) {
  const sol = randomSolution(N, K, rng);
  if (!sol) return null;
  let reg = growRegions(N, K, sol, rng);
  if (!reg) return null;
  const { orth } = shapeOf(N);
  const solve = (r, maxTech = tier.maxTech) => solveStarField({ size: N, stars: K, regions: r, solution: sol }, [], { maxTech });
  // A random border cell (not a star) near the cells still open moves to a neighbouring region.
  const mutate = (r, vals) => {
    const open = [];
    for (let i = 0; i < N * N; i++) if (sol[i] !== 1 && (!vals[i] || orth[i].some((y) => !vals[y])) && orth[i].some((y) => r[y] !== r[i])) open.push(i);
    if (!open.length) return null;
    const i = rng.pick(open);
    if (!connectedWithout(N, r, r[i], i)) return null;
    const r2 = r.slice();
    r2[i] = rng.pick(orth[i].filter((y) => r[y] !== r[i]).map((y) => r[y]));
    return r2;
  };
  // The long chains of the top level are slow to search, so the first climb
  // stops one level short of them; the second one asks for them.
  const climb = Math.min(tier.maxTech, 4);
  let res = solve(reg, climb);
  for (let m = 0; m < N * N * 1.5 && !res.solved; m++) {
    const r2 = mutate(reg, res.values);
    if (!r2) continue;
    const res2 = solve(r2, climb);
    if (known(res2) >= known(res)) { reg = r2; res = res2; }
  }
  if (!res.solved) return null;
  if (res.hardest < tier.minTech) {
    // Wander among layouts the full solver still finishes until the simpler levels alone cannot.
    const none = res.values.map(() => 0);
    for (let m = 0; m < N * N; m++) {
      const r2 = mutate(reg, none);
      if (!r2) continue;
      // The simpler levels first: if they finish it, so does the full solver.
      const low2 = solve(r2, tier.minTech - 1);
      const res2 = low2.solved ? low2 : solve(r2);
      if (!res2.solved) continue;
      reg = r2; res = res2;
      if (!low2.solved) break;
    }
  }
  reg = renumber(reg);
  return { sol, reg, res: solve(reg) };
}

// ---------- stories ----------

const STORY = {
  places: ['Hilltop', 'Lantern', 'Saltmarsh', 'Juniper', 'Meadow', 'Harbor', 'Pinewood', 'Copper', 'Bramble', 'Old Mill', 'Clockwork', 'Willow', 'Granite', 'Seaside', 'Thistle', 'Riverside', 'Orchard', 'Glasshouse'],
  things: ['Observatory', 'Star Chart', 'Night Garden', 'Sky Map', 'Planetarium', 'Lookout', 'Telescope', 'Almanac'],
  intros: [
    'The {place} {thing} lost its stars. Each row, column and region knows how many it had, and that no two ever touched.',
    'A storm smudged the {place} {thing}. Put every star back where it belongs.',
    'The keeper of the {place} {thing} left a grid of regions and one rule: stars keep their distance.',
    'Tonight the {place} {thing} opens, but its stars are missing. The regions remember where they go.',
  ],
  endings: [
    'The last star clicks into place. The {place} {thing} shines again.',
    'Every row, column and region glows. The {place} {thing} is whole.',
    'The sky over the {place} {thing} is back, one star at a time.',
  ],
};

function storyFor(seed, used = []) {
  const seen = new Set(used);
  for (let i = 0; i < 40; i++) {
    const r = makeRng(`${seed}:story:${i}`);
    const place = r.pick(STORY.places), thing = r.pick(STORY.things);
    const id = `sf-${place}-${thing}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(id) && i < 39) continue;
    const fill = (t) => t.replaceAll('{place}', place).replaceAll('{thing}', thing);
    return { id, title: `The ${place} ${thing}`, intro: fill(r.pick(STORY.intros)), ending: fill(r.pick(STORY.endings)) };
  }
  return null;
}

export function generateStarField({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story = true, theme = null } = {}) {
  const tier = SF_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = tier.sizes.includes(Number(size)) ? Number(size) : tier.sizes[0];
  const K = tier.stars;
  if (practice && (!SF_TECHNIQUES[practice] || SF_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seen = new Set(avoid);
  const want = N >= 9 ? 2 : 3;
  const found = [];
  let backup = null, practiceTries = 0;
  // A time budget: past it, the best proven puzzle found so far is used.
  const until = Date.now() + (N >= 10 ? 6000 : 2500);
  for (let attempt = 0; attempt < 400 && found.length < want; attempt++) {
    if (Date.now() > until && (found.length || backup)) break;
    const c = candidate(N, K, tier, makeRng(`${seed}:sf:${attempt}`));
    if (!c || !c.res.solved) continue;
    // A one-cell region hands over a free star: only Basic keeps them.
    if (difficulty !== 'basic' && tinyRegion(c.reg, N)) continue;
    if (seen.has(fpOf(N, K, c.reg))) continue;
    c.score = scoreOf(c.res.steps, N);
    if (c.res.hardest < tier.minTech) { if (!backup || c.res.hardest > backup.res.hardest || (c.res.hardest === backup.res.hardest && c.score > backup.score)) backup = c; continue; }
    if (practice && !c.res.steps.some((s) => s.technique === practice) && ++practiceTries < 30) continue;
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { sol, reg, res } = pick;
  const p = {
    kind: 'star-field', game: 'sf',
    id: `sf-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N, stars: K, regions: reg,
    givens: Array(N * N).fill(0), solution: sol,
    solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: SF_TECHNIQUES[s.technique].name, marks: s.marks, cells: s.cells, why: s.why })),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: pick.score,
    fingerprint: fpOf(N, K, reg),
    rules: [
      `Place ${K === 1 ? 'one star' : 'two stars'} in every row, every column and every outlined region.`,
      'Stars never touch, not even at a corner.',
      'Mark cells you know are empty with a dot. Dots are optional, but they help.',
    ],
  };
  if (story) p.story = kitThemeStory('sf', seed, { theme, used: usedStories, classic: () => storyFor(seed, usedStories) });
  return p;
}

// ---------- checking and hints ----------

export function checkStarField(p, entries = []) {
  const wrong = [];
  entries.forEach((v, i) => { if (v && !p.givens[i] && (v === 1) !== (p.solution[i] === 1)) wrong.push(i); });
  return { wrong, solved: p.solution.every((v, i) => (v === 1) === ((p.givens[i] || entries[i]) === 1)) };
}

export function getStarFieldHint(p, entries = []) {
  const N = p.size;
  const { wrong, solved } = checkStarField(p, entries);
  if (wrong.length) {
    const w = wrong[0];
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One cell is' : `${wrong.length} cells are`} marked wrong.`, `Check ${cellName(N, w)}.`, `${cap(cellName(N, w))} should be ${p.solution[w] === 1 ? 'a star' : 'empty'}.`] };
  }
  if (solved) return { kind: 'done', levels: ['Every star is in place.'] };
  const res = solveStarField(p, entries, { maxTech: 5, stopAtChange: true });
  const step = res.steps[0];
  if (!step) return { kind: 'stuck', levels: ['Look for a region with only a few open cells left.'] };
  const n = step.marks.length;
  const stars = step.marks.filter(([, v]) => v === 1).length;
  return {
    kind: 'step', technique: step.technique, techniqueName: SF_TECHNIQUES[step.technique].name,
    cell: step.marks[0][0], marks: step.marks, cells: step.cells,
    levels: [
      `Look at ${step.look}.`,
      stars ? `${n === 1 ? 'One cell' : `${n} cells`} must hold ${n === 1 ? 'a star' : 'stars'}: ${cellsText(N, step.cells)}.` : `${n === 1 ? `One cell can be marked empty now: ${cellName(N, step.cells[0])}` : `${n} cells can be marked empty now`}.`,
      step.why,
    ],
  };
}
