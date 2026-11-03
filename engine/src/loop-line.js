// Loop Line: a grid of dots, some cells hold 0 to 3. Draw one single closed
// loop along the dot lines so each number tells how many of its four sides the
// loop uses. Every puzzle is proven by a solver that works the way a person
// does, so it has exactly one answer reachable by logic alone, and its
// difficulty is the hardest technique it needs.
//
// Edges: flat ones first (row by row, (R+1)×C of them), then upright ones
// (R×(C+1)). Edge values: 1 line, 2 crossed (no line), 0 not decided yet.
//
//   generateLoopLine({ difficulty, size, seed, avoid, toughness, practice, usedStories, story })
//   getLoopLineHint(puzzle, entries)   a nudge, then where, then why
//   solveLoopLine(puzzle, entries)     the logical solver (used by the tests)
//   countLoopLine(puzzle, limit)       brute-force count of answers (tests, small grids)
import { makeRng } from './rng.js';
import { cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES } from './kit-common.js';

export const LL_TECHNIQUES = {
  zero: { level: 1, name: 'A zero' },
  full: { level: 1, name: 'Finished number' },
  fill: { level: 1, name: 'Every open side' },
  dotFull: { level: 1, name: 'Two lines at a dot' },
  deadEnd: { level: 1, name: 'Dead end' },
  goOn: { level: 1, name: 'A line must go on' },
  closed: { level: 1, name: 'The loop is closed' },
  corner: { level: 2, name: 'Corner rule' },
  smallLoop: { level: 2, name: 'No early loops' },
  enter: { level: 3, name: 'A line into a 1 or a 3' },
  threes: { level: 3, name: 'Two 3s side by side' },
  pass2: { level: 4, name: 'A line through a 2' },
  diag3: { level: 4, name: 'Two 3s corner to corner' },
  whatIf: { level: 5, name: 'Follow it through' },
};

export const LL_TIERS = {
  basic: { name: 'Basic', sizes: [5], minTech: 1, maxTech: 1, keep: 0.5, fill: 0.5 },
  easy: { name: 'Easy', sizes: [5, 6], minTech: 2, maxTech: 2, keep: 0.38, fill: 0.5 },
  medium: { name: 'Medium', sizes: [7, 6], minTech: 2, maxTech: 3, keep: 0.3, fill: 0.52 },
  hard: { name: 'Hard', sizes: [8, 7], minTech: 3, maxTech: 3, keep: 0, fill: 0.55 },
  expert: { name: 'Expert', sizes: [10, 8], minTech: 3, maxTech: 4, keep: 0, fill: 0.55 },
  master: { name: 'Master', sizes: [10, 12], minTech: 4, maxTech: 5, keep: 0, fill: 0.56 },
};
export const LL_SIZES = [5, 6, 7, 8, 10, 12];

// ---------- the grid's shape ----------

const GEO = new Map();
export function llGeometry(R, C) {
  const key = `${R}x${C}`;
  if (GEO.has(key)) return GEO.get(key);
  const W = C + 1, H = (R + 1) * C, E = H + R * W, D = (R + 1) * W;
  const hE = (r, c) => r * C + c, vE = (r, c) => H + r * W + c;
  const ends = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) ends[hE(r, c)] = [r * W + c, r * W + c + 1];
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) ends[vE(r, c)] = [r * W + c, (r + 1) * W + c];
  // Each dot's edges: up, right, down, left (-1 where the grid ends).
  const dotEdges = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
    dotEdges.push([r > 0 ? vE(r - 1, c) : -1, c < C ? hE(r, c) : -1, r < R ? vE(r, c) : -1, c > 0 ? hE(r, c - 1) : -1]);
  }
  // Each cell's sides: top, right, bottom, left.
  const sides = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) sides.push([hE(r, c), vE(r, c + 1), hE(r + 1, c), vE(r, c)]);
  // The cells on either side of an edge.
  const edgeCells = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) edgeCells[hE(r, c)] = [r > 0 ? (r - 1) * C + c : -1, r < R ? r * C + c : -1];
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) edgeCells[vE(r, c)] = [c > 0 ? r * C + c - 1 : -1, c < C ? r * C + c : -1];
  // Each cell's corners: top-left, top-right, bottom-right, bottom-left, with
  // the two sides that meet there (near), the other two (far) and the edges
  // at that dot outside the cell (out).
  const corners = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const [t, rt, b, l] = sides[r * C + c];
    const ds = [r * W + c, r * W + c + 1, (r + 1) * W + c + 1, (r + 1) * W + c];
    const near = [[t, l], [t, rt], [rt, b], [b, l]], far = [[rt, b], [b, l], [t, l], [t, rt]];
    corners.push(ds.map((d, k) => ({ d, near: near[k], far: far[k], out: dotEdges[d].filter((e) => e !== near[k][0] && e !== near[k][1]), opp: ds[(k + 2) % 4], k })));
  }
  const g = { R, C, W, H, E, D, hE, vE, ends, dotEdges, sides, edgeCells, corners };
  GEO.set(key, g);
  return g;
}

// ---------- names in plain words ----------

const cellText = (C, i) => `row ${Math.floor(i / C) + 1}, column ${(i % C) + 1}`;
export function edgeName(g, e) {
  if (e < g.H) {
    const r = Math.floor(e / g.C), c = e % g.C;
    return r < g.R ? `the top side of row ${r + 1}, column ${c + 1}` : `the bottom side of row ${g.R}, column ${c + 1}`;
  }
  const r = Math.floor((e - g.H) / g.W), c = (e - g.H) % g.W;
  return c < g.C ? `the left side of row ${r + 1}, column ${c + 1}` : `the right side of row ${r + 1}, column ${g.C}`;
}
export function dotName(g, d) {
  const r = Math.floor(d / g.W), c = d % g.W;
  const rr = Math.min(r, g.R - 1) + 1, cc = Math.min(c, g.C - 1) + 1;
  return `the ${r < g.R ? 'top' : 'bottom'}-${c < g.C ? 'left' : 'right'} corner of row ${rr}, column ${cc}`;
}
const clueText = (p, i) => `the ${p.clues[i]} in ${cellText(p.cols, i)}`;
const nEdges = (n) => `${n} edge${n === 1 ? '' : 's'}`;

// ---------- the rules ----------

const count = (v, es) => {
  let lines = 0, open = 0;
  for (const e of es) { if (e < 0) continue; if (v[e] === 1) lines++; else if (v[e] === 0) open++; }
  return { lines, open };
};
const openOf = (v, es) => es.filter((e) => e >= 0 && v[e] === 0);

// Groups of joined lines: for each dot, its group, and each group's line count.
function groups(g, v) {
  const parent = new Int32Array(g.D).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const size = new Int32Array(g.D);
  let cycle = -1, total = 0;
  for (let e = 0; e < g.E; e++) {
    if (v[e] !== 1) continue;
    total++;
    const [a, b] = g.ends[e];
    const ra = find(a), rb = find(b);
    if (ra === rb) { size[ra]++; cycle = ra; } else { parent[ra] = rb; size[rb] += size[ra] + 1; }
  }
  return { find, size, cycle, total };
}

function step(technique, marks, focus, why, extra = {}) {
  return { technique, marks, cells: marks.map(([e]) => e), focus, why, ...extra };
}

const RULES = [
  { id: 'zero', level: 1, fn(p, g, v) {
    for (let i = 0; i < p.clues.length; i++) {
      if (p.clues[i] !== 0) continue;
      const open = openOf(v, g.sides[i]);
      if (open.length) return step('zero', open.map((e) => [e, 2]), `Look at the 0 in ${cellText(g.C, i)}.`, `A 0 means the loop uses none of its four sides, so every side of ${cellText(g.C, i)} is empty. Mark them with a cross.`, { at: i });
    }
    return null;
  } },
  { id: 'full', level: 1, fn(p, g, v) {
    for (let i = 0; i < p.clues.length; i++) {
      const n = p.clues[i];
      if (n <= 0) continue;
      const { lines, open } = count(v, g.sides[i]);
      if (lines === n && open) return step('full', openOf(v, g.sides[i]).map((e) => [e, 2]), `Look at ${clueText(p, i)}.`, `${cap(clueText(p, i))} already has ${n} line${n === 1 ? '' : 's'} around it, so its other sides are empty.`, { at: i });
    }
    return null;
  } },
  { id: 'fill', level: 1, fn(p, g, v) {
    for (let i = 0; i < p.clues.length; i++) {
      const n = p.clues[i];
      if (n <= 0) continue;
      const { lines, open } = count(v, g.sides[i]);
      if (open && lines + open === n) return step('fill', openOf(v, g.sides[i]).map((e) => [e, 1]), `Look at ${clueText(p, i)}.`, `${cap(clueText(p, i))} needs ${n} line${n === 1 ? '' : 's'}, and only ${n} of its sides are still open, so the loop uses all of them.`, { at: i });
    }
    return null;
  } },
  { id: 'dotFull', level: 1, fn(p, g, v) {
    for (let d = 0; d < g.D; d++) {
      const { lines, open } = count(v, g.dotEdges[d]);
      if (lines === 2 && open) return step('dotFull', openOf(v, g.dotEdges[d]).map((e) => [e, 2]), `Look at the dot at ${dotName(g, d)}.`, `Two lines already meet at the dot at ${dotName(g, d)}. The loop passes through a dot only once, so its other edges are empty.`, { dot: d });
    }
    return null;
  } },
  { id: 'deadEnd', level: 1, fn(p, g, v) {
    for (let d = 0; d < g.D; d++) {
      const { lines, open } = count(v, g.dotEdges[d]);
      if (lines === 0 && open === 1) {
        const e = openOf(v, g.dotEdges[d])[0];
        return step('deadEnd', [[e, 2]], `Look at the dot at ${dotName(g, d)}.`, `Only one edge is still open at the dot at ${dotName(g, d)}. A line there would have nowhere to go next, so ${edgeName(g, e)} is empty.`, { dot: d });
      }
    }
    return null;
  } },
  { id: 'goOn', level: 1, fn(p, g, v) {
    for (let d = 0; d < g.D; d++) {
      const { lines, open } = count(v, g.dotEdges[d]);
      if (lines === 1 && open === 1) {
        const e = openOf(v, g.dotEdges[d])[0];
        return step('goOn', [[e, 1]], `Look at the end of the line at ${dotName(g, d)}.`, `A line ends at the dot at ${dotName(g, d)}, and the loop never ends. The only way on is ${edgeName(g, e)}.`, { dot: d });
      }
    }
    return null;
  } },
  { id: 'closed', level: 1, fn(p, g, v) {
    const gr = groups(g, v);
    if (gr.cycle < 0) return null;
    const open = [];
    for (let e = 0; e < g.E; e++) if (v[e] === 0) open.push(e);
    if (!open.length) return null;
    return step('closed', open.map((e) => [e, 2]), 'The loop is already closed.', 'The lines make a closed loop. Any other line would start a second loop, so every edge still open is empty.');
  } },
  { id: 'corner', level: 2, fn(p, g, v) {
    for (let i = 0; i < p.clues.length; i++) {
      const n = p.clues[i];
      if (n !== 1 && n !== 3) continue;
      for (const k of g.corners[i]) {
        if (!k.out.every((e) => v[e] === 2)) continue;
        const open = openOf(v, k.near);
        if (!open.length) continue;
        const shut = k.out.length ? 'the edges outside it are empty' : 'it sits in the corner of the grid';
        return n === 3
          ? step('corner', open.map((e) => [e, 1]), `Look at ${clueText(p, i)}.`, `At the ${['top-left', 'top-right', 'bottom-right', 'bottom-left'][k.k]} corner of ${cellText(g.C, i)}, ${shut}, so the loop either turns along both of its sides there or uses neither. A 3 cannot give up two sides, so it uses both.`, { at: i })
          : step('corner', open.map((e) => [e, 2]), `Look at ${clueText(p, i)}.`, `At the ${['top-left', 'top-right', 'bottom-right', 'bottom-left'][k.k]} corner of ${cellText(g.C, i)}, ${shut}, so the loop either turns along both of its sides there or uses neither. A 1 cannot take two sides, so it uses neither.`, { at: i });
      }
    }
    return null;
  } },
  { id: 'smallLoop', level: 2, fn(p, g, v) {
    const gr = groups(g, v);
    if (gr.cycle >= 0) return null;
    for (let e = 0; e < g.E; e++) {
      if (v[e] !== 0) continue;
      const [a, b] = g.ends[e];
      const ra = gr.find(a);
      if (ra !== gr.find(b)) continue;
      if (gr.size[ra] === gr.total) {
        // Closing it would make the only loop: fine if every number is then right.
        let ok = true;
        for (let i = 0; i < p.clues.length && ok; i++) {
          if (p.clues[i] < 0) continue;
          const { lines } = count(v, g.sides[i]);
          ok = lines + (g.sides[i].includes(e) ? 1 : 0) === p.clues[i];
        }
        if (ok) continue;
        return step('smallLoop', [[e, 2]], 'Look at the two ends of one line.', `The two ends of one line meet at ${edgeName(g, e)}. Joining them would close the loop, but some numbers would still be wrong, so it stays empty.`);
      }
      return step('smallLoop', [[e, 2]], 'Look at the two ends of one line.', `The two ends of one line meet at ${edgeName(g, e)}. Joining them would close a small loop and leave other lines out, but there is only one loop. So it stays empty.`);
    }
    return null;
  } },
  { id: 'enter', level: 3, fn(p, g, v) {
    for (let i = 0; i < p.clues.length; i++) {
      const n = p.clues[i];
      if (n !== 1 && n !== 3) continue;
      for (const k of g.corners[i]) {
        const o = count(v, k.out);
        if (o.lines !== 1 || o.open || openOf(v, k.near).length !== 2) continue;
        const open = openOf(v, k.far);
        if (!open.length) continue;
        const where = `the ${['top-left', 'top-right', 'bottom-right', 'bottom-left'][k.k]} corner of ${cellText(g.C, i)}`;
        return n === 1
          ? step('enter', open.map((e) => [e, 2]), `Look at ${clueText(p, i)}.`, `A line comes into ${where} and has to turn along exactly one of the 1's sides there. That uses up the 1, so its two far sides are empty.`, { at: i })
          : step('enter', open.map((e) => [e, 1]), `Look at ${clueText(p, i)}.`, `A line comes into ${where} and has to turn along exactly one of the 3's sides there. The 3 still needs two more, so both of its far sides are lines.`, { at: i });
      }
    }
    return null;
  } },
  { id: 'threes', level: 3, fn(p, g, v) {
    const { R, C, vE, hE } = g;
    for (let i = 0; i < p.clues.length; i++) {
      if (p.clues[i] !== 3) continue;
      const r = Math.floor(i / C), c = i % C;
      const tries = [];
      if (c + 1 < C && p.clues[i + 1] === 3) tries.push({ j: i + 1, lines: [vE(r, c), vE(r, c + 1), vE(r, c + 2)], crosses: [r > 0 ? vE(r - 1, c + 1) : -1, r + 1 < R ? vE(r + 1, c + 1) : -1] });
      if (r + 1 < R && p.clues[i + C] === 3) tries.push({ j: i + C, lines: [hE(r, c), hE(r + 1, c), hE(r + 2, c)], crosses: [c > 0 ? hE(r + 1, c - 1) : -1, c + 1 < C ? hE(r + 1, c + 1) : -1] });
      for (const t of tries) {
        const marks = [...openOf(v, t.lines).map((e) => [e, 1]), ...openOf(v, t.crosses).map((e) => [e, 2])];
        if (marks.length) return step('threes', marks, `Look at the two 3s in ${cellText(C, i)} and ${cellText(C, t.j)}.`, `Two 3s side by side always take the side between them and their two outer sides. The edges that carry on from the middle line are empty: a line there would leave a 3 with too few sides or a dot with three lines.`, { at: i });
      }
    }
    return null;
  } },
  { id: 'pass2', level: 4, fn(p, g, v) {
    for (let i = 0; i < p.clues.length; i++) {
      if (p.clues[i] !== 2) continue;
      for (const k of g.corners[i]) {
        const o = count(v, k.out);
        if (o.lines !== 1 || o.open || openOf(v, k.near).length !== 2) continue;
        const kk = g.corners[i][(k.k + 2) % 4];
        if (count(v, kk.near).lines) continue;
        const open = openOf(v, kk.out);
        if (open.length !== 1 || count(v, kk.out).lines) continue;
        const e = open[0];
        return step('pass2', [[e, 1]], `Look at the 2 in ${cellText(g.C, i)}.`, `A line comes into one corner of the 2 in ${cellText(g.C, i)} and uses one side there, so the 2 uses exactly one of its other two sides as well. That line leaves at the far corner, and the only way out there is ${edgeName(g, e)}.`, { at: i });
      }
    }
    return null;
  } },
  { id: 'diag3', level: 4, fn(p, g, v) {
    const { R, C, vE, hE } = g;
    for (let i = 0; i < p.clues.length; i++) {
      if (p.clues[i] !== 3) continue;
      const r = Math.floor(i / C), c = i % C;
      if (r + 1 >= R) continue;
      const tries = [];
      if (c + 1 < C && p.clues[i + C + 1] === 3) tries.push({ j: i + C + 1, lines: [hE(r, c), vE(r, c), hE(r + 2, c + 1), vE(r + 1, c + 2)] });
      if (c > 0 && p.clues[i + C - 1] === 3) tries.push({ j: i + C - 1, lines: [hE(r, c), vE(r, c + 1), hE(r + 2, c - 1), vE(r + 1, c - 1)] });
      for (const t of tries) {
        const open = openOf(v, t.lines);
        if (open.length) return step('diag3', open.map((e) => [e, 1]), `Look at the 3s in ${cellText(C, i)} and ${cellText(C, t.j)}.`, 'Two 3s that touch corner to corner always take the two outer sides at the far corners: the loop has to wrap around each 3 there, or the dot between them would get too many lines.', { at: i });
      }
    }
    return null;
  } },
  { id: 'whatIf', level: 5, fn(p, g, v) {
    // Follow a loose end each way it could go; if one way breaks a rule, it goes the other.
    for (let d = 0; d < g.D; d++) {
      const { lines, open } = count(v, g.dotEdges[d]);
      if (lines !== 1 || open !== 2) continue;
      for (const e of openOf(v, g.dotEdges[d])) {
        for (const tryV of [1, 2]) {
          const t = v.slice();
          t[e] = tryV;
          const broke = propagate(p, g, t, 3, 40);
          if (broke) {
            const other = tryV === 1 ? 2 : 1;
            return step('whatIf', [[e, other]], `Follow the line that ends at ${dotName(g, d)}.`, `Suppose ${edgeName(g, e)} ${tryV === 1 ? 'were a line' : 'were empty'}. Following the rules from there, ${broke}. So it ${other === 1 ? 'must be a line' : 'is empty'}.`, { dot: d });
          }
        }
      }
    }
    return null;
  } },
];

// What breaks, in words, or '' if nothing does yet.
function broken(p, g, v) {
  for (let d = 0; d < g.D; d++) {
    const { lines, open } = count(v, g.dotEdges[d]);
    if (lines > 2) return 'a dot would get three lines';
    if (lines === 1 && !open) return 'a line would come to a dead end';
  }
  for (let i = 0; i < p.clues.length; i++) {
    const n = p.clues[i];
    if (n < 0) continue;
    const { lines, open } = count(v, g.sides[i]);
    if (lines > n) return `${clueText(p, i)} would get too many lines`;
    if (lines + open < n) return `${clueText(p, i)} would get too few lines`;
  }
  const gr = groups(g, v);
  if (gr.cycle >= 0 && gr.size[gr.cycle] < gr.total) return 'a small loop would close with other lines left over';
  return '';
}

// Runs the simpler rules on t (changed in place); returns what broke, or ''.
function propagate(p, g, t, maxLevel, maxSteps) {
  for (let n = 0; n < maxSteps; n++) {
    const why = broken(p, g, t);
    if (why) return why;
    let s = null;
    for (const r of RULES) { if (r.level > maxLevel) break; s = r.fn(p, g, t); if (s) break; }
    if (!s) return '';
    for (const [e, x] of s.marks) t[e] = x;
  }
  return broken(p, g, t);
}

// ---------- the whole grid ----------

export function solveLoopLine(p, entries = [], { maxLevel = 9, stopAtChange = false, maxSteps = 5000 } = {}) {
  const g = llGeometry(p.size, p.cols);
  const v = new Int8Array(g.E);
  if (p.solution) entries.forEach((x, e) => { if (x && e < g.E && x === p.solution[e]) v[e] = x; });
  const steps = [];
  let hardest = 0, contradiction = false;
  while (steps.length < maxSteps) {
    let s = null;
    for (const r of RULES) { if (r.level > maxLevel) continue; s = r.fn(p, g, v); if (s) break; }
    if (!s) break;
    for (const [e, x] of s.marks) v[e] = x;
    steps.push(s);
    hardest = Math.max(hardest, LL_TECHNIQUES[s.technique].level);
    if (stopAtChange) break;
  }
  if (!stopAtChange && broken(p, g, v)) contradiction = true;
  const solved = !contradiction && v.every((x) => x !== 0);
  return { solved, steps, values: [...v], hardest, contradiction };
}

// Brute force: how many loops fit the numbers (up to limit). Independent of the solver.
export function countLoopLine(p, limit = 2) {
  const g = llGeometry(p.size, p.cols);
  const { E, D, ends, dotEdges, sides, edgeCells } = g;
  // Edges in reading order of their middle points, so dots and cells close early.
  const pos = (e) => {
    if (e < g.H) { const r = Math.floor(e / g.C), c = e % g.C; return 2 * r * (2 * g.C + 1) + 2 * c + 1; }
    const r = Math.floor((e - g.H) / g.W), c = (e - g.H) % g.W; return (2 * r + 1) * (2 * g.C + 1) + 2 * c;
  };
  const order = [...Array(E).keys()].sort((a, b) => pos(a) - pos(b));
  const dotLines = new Int8Array(D), dotLeft = new Int8Array(D);
  for (let d = 0; d < D; d++) dotLeft[d] = dotEdges[d].filter((e) => e >= 0).length;
  const cellLines = new Int8Array(p.clues.length), cellLeft = new Int8Array(p.clues.length).fill(4);
  const parent = new Int32Array(D).map((_, i) => i), rank = new Int32Array(D), edges = new Int32Array(D);
  const find = (x) => { while (parent[x] !== x) x = parent[x]; return x; };
  let found = 0, total = 0;
  const cellsOk = (e, line) => {
    for (const c of edgeCells[e]) {
      if (c < 0) continue;
      const n = p.clues[c];
      if (n < 0) continue;
      if (cellLines[c] > n || cellLines[c] + cellLeft[c] < n) return false;
    }
    return true;
  };
  const restAllEmptyOk = () => {
    for (let d = 0; d < D; d++) if (dotLines[d] === 1) return false;
    for (let c = 0; c < p.clues.length; c++) if (p.clues[c] >= 0 && cellLines[c] !== p.clues[c]) return false;
    return true;
  };
  function go(k) {
    if (found >= limit) return;
    if (k === E) { if (total && restAllEmptyOk()) found++; return; }
    const e = order[k];
    const [a, b] = ends[e];
    for (const line of [0, 1]) {
      dotLeft[a]--; dotLeft[b]--;
      for (const c of edgeCells[e]) if (c >= 0) cellLeft[c]--;
      let ok = true, undo = null, closes = false;
      if (line) {
        dotLines[a]++; dotLines[b]++; total++;
        for (const c of edgeCells[e]) if (c >= 0) cellLines[c]++;
        ok = dotLines[a] <= 2 && dotLines[b] <= 2;
        if (ok) {
          let ra = find(a), rb = find(b);
          if (ra === rb) { closes = true; edges[ra]++; undo = { same: ra }; } else {
            if (rank[ra] > rank[rb]) [ra, rb] = [rb, ra];
            parent[ra] = rb; edges[rb] += edges[ra] + 1;
            const bump = rank[ra] === rank[rb];
            if (bump) rank[rb]++;
            undo = { ra, rb, bump, ea: edges[ra] };
          }
        }
      }
      if (ok) ok = (dotLeft[a] || dotLines[a] !== 1) && (dotLeft[b] || dotLines[b] !== 1) && cellsOk(e, line);
      if (ok) {
        if (closes) {
          // A loop just closed: it must hold every line, and every other edge stays empty.
          const r = find(a);
          if (edges[r] === total) {
            // Remaining edges empty: check every dot and number.
            const saved = [];
            for (let j = k + 1; j < E; j++) {
              const f = order[j];
              for (const c of edgeCells[f]) if (c >= 0) cellLeft[c]--;
              saved.push(f);
            }
            if (restAllEmptyOk()) found++;
            for (const f of saved) for (const c of edgeCells[f]) if (c >= 0) cellLeft[c]++;
          }
        } else go(k + 1);
      }
      if (line) {
        dotLines[a]--; dotLines[b]--; total--;
        for (const c of edgeCells[e]) if (c >= 0) cellLines[c]--;
        if (undo) {
          if (undo.same !== undefined) edges[undo.same]--;
          else { parent[undo.ra] = undo.ra; edges[undo.rb] -= undo.ea + 1; if (undo.bump) rank[undo.rb]--; }
        }
      }
      dotLeft[a]++; dotLeft[b]++;
      for (const c of edgeCells[e]) if (c >= 0) cellLeft[c]++;
      if (found >= limit) return;
    }
  }
  go(0);
  return found;
}

// ---------- making a loop ----------

// Grow one joined patch of cells with no holes and no two cells touching only
// at a corner; its outline is one single loop.
function makeRegion(R, C, rng, fill) {
  const inside = new Uint8Array(R * C);
  const at = (r, c) => (r < 0 || c < 0 || r >= R || c >= C ? 0 : inside[r * C + c]);
  const target = Math.max(3, Math.round(R * C * fill));
  const start = rng.int(R * C);
  inside[start] = 1;
  let n = 1;
  const neighbours = (i) => {
    const r = Math.floor(i / C), c = i % C, out = [];
    if (r > 0) out.push(i - C);
    if (r < R - 1) out.push(i + C);
    if (c > 0) out.push(i - 1);
    if (c < C - 1) out.push(i + 1);
    return out;
  };
  const pinched = (i) => {
    // The four dots around cell i, each with its 2×2 block of cells.
    const r = Math.floor(i / C), c = i % C;
    for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const a = at(r + dr - 1, c + dc - 1), b = at(r + dr - 1, c + dc), x = at(r + dr, c + dc - 1), y = at(r + dr, c + dc);
      if (a === y && b === x && a !== b) return true;
    }
    return false;
  };
  const noHoles = () => {
    const seen = new Uint8Array(R * C), q = [];
    for (let i = 0; i < R * C; i++) {
      const r = Math.floor(i / C), c = i % C;
      if (!inside[i] && (r === 0 || c === 0 || r === R - 1 || c === C - 1)) { seen[i] = 1; q.push(i); }
    }
    while (q.length) { const i = q.pop(); for (const j of neighbours(i)) if (!inside[j] && !seen[j]) { seen[j] = 1; q.push(j); } }
    for (let i = 0; i < R * C; i++) if (!inside[i] && !seen[i]) return false;
    return true;
  };
  for (let tries = 0; n < target && tries < R * C * 30; tries++) {
    const front = [];
    for (let i = 0; i < R * C; i++) {
      if (inside[i]) continue;
      const k = neighbours(i).filter((j) => inside[j]).length;
      if (k) front.push({ i, k });
    }
    if (!front.length) break;
    // Mostly cells touching the patch on one side, so the loop winds.
    const thin = front.filter((f) => f.k === 1);
    const pick = (thin.length && rng.next() < 0.75 ? rng.pick(thin) : rng.pick(front)).i;
    inside[pick] = 1;
    if (pinched(pick) || !noHoles()) { inside[pick] = 0; continue; }
    n++;
  }
  return inside;
}

function loopFrom(R, C, inside) {
  const g = llGeometry(R, C);
  const sol = Array(g.E).fill(2);
  for (let e = 0; e < g.E; e++) {
    const [a, b] = g.edgeCells[e];
    if ((a >= 0 ? inside[a] : 0) !== (b >= 0 ? inside[b] : 0)) sol[e] = 1;
  }
  return sol;
}

// ---------- stories ----------

const STORY = {
  places: ['Lantern', 'Harbor', 'Orchard', 'Clockwork', 'Meadow', 'Quarry', 'Copper', 'Willow', 'Thistle', 'Riverside', 'Pinewood', 'Saltmarsh', 'Granite', 'Signal', 'Juniper', 'Starlight', 'Bramble', 'Hilltop', 'Old Mill', 'Ember'],
  things: ['Garden', 'Fair', 'Park', 'Racetrack', 'Pasture', 'Fort', 'Square', 'Rink'],
  intros: [
    'The {place} {thing} needs one fence, all the way round, with no gaps and no branches. The numbers say how many sides of each plot it runs along.',
    'A night watch walks the {place} {thing} on one closed path. The numbers count the sides of each square the path follows.',
    'Someone is stringing lights around the {place} {thing}: one loop, never crossing itself. The numbers are all the plan they left.',
    'The {place} {thing} wants a single ribbon round its edge. Each number tells how many of its square\'s sides the ribbon takes.',
  ],
  endings: [
    'The last stretch of fence clicks into place. The {place} {thing} is closed in.',
    'One loop, no loose ends. The {place} {thing} is ready.',
    'The lights come on all the way round the {place} {thing}.',
  ],
};
function story(seed, used = []) {
  const seen = new Set(used);
  for (let i = 0; i < 40; i++) {
    const r = makeRng(`${seed}:story:${i}`);
    const place = r.pick(STORY.places), thing = r.pick(STORY.things);
    const id = `ll-${place}-${thing}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(id) && i < 39) continue;
    const fill = (t) => t.replaceAll('{place}', place).replaceAll('{thing}', thing);
    return { id, title: `The ${place} ${thing}`, intro: fill(r.pick(STORY.intros)), ending: fill(r.pick(STORY.endings)) };
  }
  return null;
}

// ---------- making a puzzle ----------

const fpOf = (R, C, clues) => fingerprint('ll', `${R}x${C}|${clues.map((n) => (n < 0 ? '.' : n)).join('')}`);
const scoreOf = (res, nClues, cells) => Math.round(res.steps.reduce((s, x) => s + LL_TECHNIQUES[x.technique].level ** 2, 0) + (1 - nClues / cells) * 40);

function attempt(R, C, tier, rng) {
  const g = llGeometry(R, C);
  const inside = makeRegion(R, C, rng, tier.fill * (0.85 + rng.next() * 0.3));
  const sol = loopFrom(R, C, inside);
  const full = g.sides.map((s) => s.filter((e) => sol[e] === 1).length);
  const clues = full.slice();
  const solves = (cl, maxLevel = tier.maxTech) => solveLoopLine({ size: R, cols: C, clues: cl, solution: sol }, [], { maxLevel }).solved;
  if (!solves(clues)) return null;
  // Take numbers away, one at a time, while the logic still solves it. The
  // slow "follow it through" step only joins in a second pass, on what is left.
  const keep = Math.ceil(R * C * tier.keep);
  let left = R * C;
  const order = rng.shuffle([...Array(R * C).keys()]);
  for (const level of tier.maxTech >= 5 ? [4, tier.maxTech] : [tier.maxTech]) {
    for (const i of order) {
      if (left <= keep) break;
      const n = clues[i];
      if (n < 0) continue;
      clues[i] = -1;
      if (solves(clues, level)) left--; else clues[i] = n;
    }
  }
  const res = solveLoopLine({ size: R, cols: C, clues, solution: sol }, [], { maxLevel: tier.maxTech });
  if (!res.solved) return null;
  return { clues, sol, res, nClues: left, score: scoreOf(res, left, R * C) };
}

export function generateLoopLine({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story: wantStory = true } = {}) {
  const tier = LL_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = tier.sizes.includes(Number(size)) ? Number(size) : tier.sizes[0];
  if (practice && (!LL_TECHNIQUES[practice] || LL_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seen = new Set(avoid);
  const found = [];
  let backup = null;
  const budget = N >= 12 ? 5000 : N >= 10 ? 6000 : 2200, started = Date.now();
  for (let k = 0; k < 400 && found.length < 3; k++) {
    if (Date.now() - started > budget && (found.length || (backup && k >= 2))) break;
    const rng = makeRng(`${seed}:ll:${k}`);
    const c = attempt(N, N, tier, rng);
    if (!c) continue;
    const fp = fpOf(N, N, c.clues);
    if (seen.has(fp)) continue;
    c.fp = fp;
    if (c.res.hardest < tier.minTech) { if (!backup || c.res.hardest > backup.res.hardest || (c.res.hardest === backup.res.hardest && c.score > backup.score)) backup = c; continue; }
    if (practice && !c.res.steps.some((s) => s.technique === practice) && k < 60) { if (!backup) backup = c; continue; }
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { res } = pick;
  const g = llGeometry(N, N);
  const p = {
    kind: 'loop-line', game: 'll',
    id: `ll-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N, edges: g.E,
    clues: pick.clues, solution: pick.sol, givens: Array(g.E).fill(0),
    solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: LL_TECHNIQUES[s.technique].name, marks: s.marks, cells: s.cells, why: s.why })),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: pick.score,
    fingerprint: pick.fp,
    rules: [
      'Draw one single loop along the lines between the dots. It never crosses or touches itself, and has no loose ends.',
      'A number tells how many of its four sides the loop uses. Squares with no number can have any.',
      'Mark edges you know are empty with a cross. Crosses are optional, but they help.',
    ],
  };
  if (wantStory) p.story = story(seed, usedStories);
  return p;
}

// ---------- checking and hints ----------

export function checkLoopLine(p, entries = []) {
  const wrong = [];
  entries.forEach((x, e) => { if (x && e < p.solution.length && (x === 1) !== (p.solution[e] === 1)) wrong.push(e); });
  return { wrong, solved: p.solution.every((s, e) => (s === 1) === (entries[e] === 1)) };
}

export function getLoopLineHint(p, entries = []) {
  const g = llGeometry(p.size, p.cols);
  const { wrong, solved } = checkLoopLine(p, entries);
  if (wrong.length) {
    const w = wrong[0];
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One edge is' : `${wrong.length} edges are`} marked wrong.`, `Check ${edgeName(g, w)}.`, `${cap(edgeName(g, w))} should ${p.solution[w] === 1 ? 'be a line' : 'be empty'}.`] };
  }
  if (solved) return { kind: 'done', levels: ['The loop is complete.'] };
  const res = solveLoopLine(p, entries, { stopAtChange: true });
  const s = res.steps[0];
  if (!s) return { kind: 'stuck', levels: ['Look for a number whose open sides match what it needs.'] };
  const lines = s.marks.filter(([, x]) => x === 1).length, crosses = s.marks.length - lines;
  const what = [lines ? `${nEdges(lines)} that must be lines` : '', crosses ? `${nEdges(crosses)} that must be empty` : ''].filter(Boolean).join(' and ');
  return {
    kind: 'step', technique: s.technique, techniqueName: LL_TECHNIQUES[s.technique].name,
    cell: s.marks[0][0], marks: s.marks, cells: s.cells,
    levels: [s.focus, `There ${s.marks.length === 1 ? 'is' : 'are'} ${what} there.`, s.why],
  };
}

