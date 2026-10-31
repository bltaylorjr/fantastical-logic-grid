// Game styles built on a Number Place puzzle. The puzzle itself is unchanged
// (one answer, logic only); a style adds a way to play it:
//
//   classic   the traditional game
//   rival     take turns with a computer rival; each cell goes to whoever proves it first
//   chain     each number placed next to the last one (same row, column or box) grows a combo
//   tide      pools of water hide some given numbers; each right number drains the cells around it
//   glyph     numbers become glyphs, with powers earned by finishing rows, columns and boxes
//
// This file holds the parts that need the solver: the rival's next move and
// the Tidewater ebb, which keeps the puzzle finishable by logic alone.

import { makeShape, solveLogically } from './number-place.js';
import { makeRng } from './rng.js';

export const NP_STYLE_IDS = ['classic', 'rival', 'chain', 'tide', 'glyph'];

const evenMaskOf = (p) => (p.variants.includes('parity') ? [...Array(p.size ** 2)].map((_, i) => p.evenCells.includes(i)) : null);

// The next number logic can place on this grid (0 for empty), or null when
// the techniques up to maxLevel find nothing. The grid must hold no mistakes.
export function nextPlacement(p, grid, { maxLevel = 5 } = {}) {
  const shape = makeShape(p.size, p.variants);
  const res = solveLogically(shape, grid, { maxLevel, evenMask: evenMaskOf(p), firstPlace: true });
  const step = res.steps.length ? res.steps[res.steps.length - 1] : null;
  if (!step?.place) return null;
  return { cell: step.place[0], digit: step.place[1], technique: step.technique, why: step.why };
}

// The cells touching a cell, corners included.
export function neighborsOf(N, c) {
  const r = Math.floor(c / N), k = c % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
    if (!dr && !dk) continue;
    const rr = r + dr, kk = k + dk;
    if (rr >= 0 && rr < N && kk >= 0 && kk < N) out.push(rr * N + kk);
  }
  return out;
}

// Where the water lies at the start: a few pools that together cover about
// depth (0 to 1) of the grid. Given numbers under water are hidden; empty
// cells under water can still be filled in. A right number drains the cells
// around it.
export function planTide(p, { depth = 0.5, seed = p.seed || 'tide' } = {}) {
  const N = p.size, rng = makeRng(`${seed}:tide`);
  const want = Math.round(N * N * Math.max(0.1, Math.min(0.85, depth)));
  const water = new Set();
  // Pools grow from a few springs, one touching cell at a time.
  const springs = rng.shuffle([...Array(N * N).keys()]).slice(0, Math.max(1, Math.round(N / 3)));
  springs.forEach((c) => water.add(c));
  for (let guard = 0; water.size < want && guard < N * N * 20; guard++) {
    const from = rng.pick([...water]);
    const next = neighborsOf(N, from).filter((n) => !water.has(n));
    if (next.length) water.add(rng.pick(next));
  }
  return { water: [...water].sort((a, b) => a - b) };
}

// When logic finds no next number from what the player can see, the tide
// ebbs: the hidden given that sees the most numbers comes up, one at a time,
// until logic has a next number again. grid holds the visible
// givens and the player's right numbers (0 elsewhere). Returns the cells to
// drain, often none. So the water never makes the puzzle need a guess.
export function ebbTide(p, grid, water) {
  const N = p.size, shape = makeShape(N, p.variants), evenMask = evenMaskOf(p);
  const g = grid.slice(), wet = new Set(water), drained = [];
  for (let guard = 0; guard < N * N; guard++) {
    if (g.every(Boolean)) break;
    const res = solveLogically(shape, g, { maxLevel: 5, evenMask, firstPlace: true });
    if (res.steps[res.steps.length - 1]?.place) break;
    const hidden = [...wet].filter((c) => p.givens[c] && !g[c]);
    if (!hidden.length) break;
    const seen = (c) => shape.peers[c].filter((x) => g[x]).length;
    const lift = hidden.reduce((a, b) => (seen(b) > seen(a) ? b : a));
    wet.delete(lift); drained.push(lift);
    g[lift] = p.givens[lift];
  }
  return drained;
}
