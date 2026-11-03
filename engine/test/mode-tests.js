// Lab modes (src/modes.js): Timeline Case and Seating Plan.
//   node test/mode-tests.js
// For every difficulty and two seeds in each mode: the puzzle is unique (an
// independent brute-force count that knows nothing of the solver), meets its
// tier, every clue is true, the new clue types appear, and hints taken one
// after another from an empty grid play it to solved. Also checks the
// solver's wrap-around reasoning on a hand-made table, and that a puzzle
// with no mode carries no lab fields.
import assert from 'node:assert/strict';
import { generatePuzzle, getHint, isSolved } from '../src/index.js';
import { solveWithTrace } from '../src/solver.js';
import { clueHolds } from '../src/clues.js';
import { TIER_ORDER } from '../src/tiers.js';
import { makeLanguage } from '../src/language.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

// Independent brute force: give each item of each category to a cast
// member, one item at a time (the ordered category first, since most clues
// name it), and count the full grids where every clue holds. Each clue is
// checked as soon as everything it names has been given out. The clue
// meanings are written out again here, apart from the engine.
function countSolutions(p, limit = 2, budgetMs = 60000) {
  const K = p.categories.length, N = p.categories[0].items.length;
  const ci = Object.fromEntries(p.categories.map((c, i) => [c.id, i]));
  const parse = (id) => { const [c, i] = id.split(':'); return [ci[c], Number(i)]; };
  const ordered = p.categories.findIndex((c) => c.ordinal);
  const catOrder = [ordered, ...[...Array(K).keys()].filter((c) => c && c !== ordered)];
  const steps = catOrder.flatMap((c) => [...Array(N).keys()].map((i) => [c, i]));
  const stepOf = (c, i) => (c === 0 ? -1 : catOrder.indexOf(c) * N + i);
  // owner[c][i]: the cast member given item i of category c (category 0 is the cast).
  const owner = Array.from({ length: K }, (_, c) => (c === 0 ? [...Array(N).keys()] : Array(N).fill(-1)));
  const pos = Array(N).fill(-1); // each cast member's place in the ordered category
  const ent = (id) => { const [c, i] = parse(id); return owner[c][i]; };
  const near = (x, y) => { const d = (y - x + N) % N; return d === 1 || d === N - 1; };
  const byStep = steps.map(() => []);
  for (const c of p.clues) {
    const L = c.logic;
    const ids = Object.entries(L).filter(([k]) => !['type', 'o', 'd'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    let at = Math.max(-1, ...ids.map((id) => stepOf(...parse(id))));
    if ('o' in L) at = Math.max(at, N - 1); // places are known once the ordered category is given out
    const val = (id) => pos[ent(id)];
    const same = (x, y) => ent(x) === ent(y);
    const tests = {
      is: () => same(L.a, L.b),
      not: () => !same(L.a, L.b),
      neither: () => L.xs.every((x) => !same(x, L.b)),
      either: () => same(L.a, L.b1) || same(L.a, L.b2),
      pairs: () => (same(L.x1, L.y1) && same(L.x2, L.y2)) || (same(L.x1, L.y2) && same(L.x2, L.y1)),
      allDiff: () => new Set(L.items.map(ent)).size === L.items.length,
      less: () => val(L.a) < val(L.b),
      diff: () => val(L.b) - val(L.a) === L.d,
      ifthen: () => !same(L.p[0], L.p[1]) || same(L.q[0], L.q[1]),
      // Timeline Case
      next: () => val(L.b) === val(L.a) + 1,
      between: () => val(L.a) < val(L.m) && val(L.m) < val(L.b),
      first: () => val(L.a) === 0,
      last: () => val(L.a) === N - 1,
      // Seating Plan (seat N is next to seat 1; a guest's left is clockwise)
      nextTo: () => !same(L.a, L.b) && near(val(L.a), val(L.b)),
      across: () => !same(L.a, L.b) && (val(L.b) - val(L.a) + N) % N === N / 2,
      left2: () => !same(L.a, L.b) && (val(L.a) - val(L.b) + N) % N === 2,
      notNext: () => !same(L.a, L.b) && !near(val(L.a), val(L.b)),
    };
    if (!tests[L.type]) throw new Error(`unknown clue type ${L.type}`);
    if ('o' in L && L.o !== ordered) throw new Error('clue compares a category that is not the ordered one');
    byStep[Math.max(0, at)].push(tests[L.type]);
  }
  const used = Array.from({ length: K }, () => Array(N).fill(false));
  let count = 0, timedOut = false, ticks = 0;
  const t0 = Date.now();
  const dfs = (s) => {
    if (count >= limit || timedOut) return;
    if (s === steps.length) { count++; return; }
    if (++ticks % 4096 === 0 && Date.now() - t0 > budgetMs) { timedOut = true; return; }
    const [c, i] = steps[s];
    for (let e = 0; e < N; e++) {
      if (used[c][e]) continue;
      used[c][e] = true; owner[c][i] = e;
      if (c === ordered) pos[e] = i;
      if (byStep[s].every((t) => t())) dfs(s + 1);
      used[c][e] = false; owner[c][i] = -1;
      if (c === ordered) pos[e] = -1;
      if (count >= limit || timedOut) return;
    }
  };
  dfs(0);
  return timedOut ? -1 : count;
}

// Take hints one at a time from an empty grid until the puzzle is solved.
function playHints(p) {
  const marks = [];
  for (let i = 0; i < 2000; i++) {
    if (isSolved(p, marks)) return { solved: true, hints: i };
    const h = getHint(p, marks);
    if (h.kind !== 'step' || !h.levels.every((t) => typeof t === 'string' && t && !/undefined|NaN/.test(t))) return { solved: false, hints: i, h };
    for (const m of h.marks) marks.push(m);
  }
  return { solved: false, hints: 2000 };
}

const MODE_TYPES = { timeline: ['next', 'between', 'first', 'last', 'less', 'diff'], seating: ['nextTo', 'across', 'left2', 'notNext'] };
const samples = {};
for (const mode of ['timeline', 'seating']) {
  for (const tier of TIER_ORDER) {
    for (const seed of ['one', 'two']) {
      const name = `${mode} ${tier} ${seed}`;
      const t0 = Date.now();
      const p = generatePuzzle({ mode, difficulty: tier, seed });
      const ms = Date.now() - t0;
      check(`${name}: marked as ${mode}`, p.mode === mode && p.options.mode === mode);
      check(`${name}: meets the tier`, p.stats.meetsTier, p.notes.join(' '));
      check(`${name}: notes`, p.notes.every((n) => !/Closest match/.test(n)), p.notes.join(' '));
      const N = p.categories[0].items.length;
      if (mode === 'seating') check(`${name}: 5 to 8 seats`, N >= 5 && N <= 8 && p.table && p.table.seats === N);
      if (mode === 'timeline') check(`${name}: suspects, places, object, time`, ['name', 'place', 'object', 'time'].every((id) => p.categories.some((c) => c.id === id)));
      // Equal clock steps in the timeline.
      const ord = p.categories.find((c) => c.ordinal);
      const vals = ord.items.map((it) => it.value);
      check(`${name}: equal steps`, vals.every((v, i) => !i || v - vals[i - 1] === vals[1] - vals[0]));
      check(`${name}: uses the mode's own clues`, p.clues.some((c) => MODE_TYPES[mode].includes(c.type)), JSON.stringify(p.stats.clueTypes));
      if (mode === 'seating') check(`${name}: no across clue at an odd table`, N % 2 === 0 || !p.clues.some((c) => c.type === 'across'));
      check(`${name}: clue text`, p.clues.every((c) => c.text && !/undefined|NaN|\{/.test(c.text) && /[.]$/.test(c.text)), JSON.stringify(p.clues.map((c) => c.text)));
      check(`${name}: story`, [...p.story.paragraphs, p.story.ending, p.title].every((t) => t && !/undefined|\{|\}/.test(t)), p.story.text + ' / ' + p.story.ending);
      check(`${name}: goal question first`, p.questions[0].category === 'name');
      // Every clue is true for the answer.
      const cats = p.categories;
      const toG = (id) => { const [c, i] = id.split(':'); return cats.findIndex((x) => x.id === c) * N + Number(i); };
      const sol = cats.map((c) => p.solution.map((row) => Number(row[c.id].split(':')[1])));
      const ctx = { N, sol };
      const logic = p.clues.map((c) => Object.fromEntries(Object.entries(c.logic).map(([k, v]) => [k, k === 'type' || k === 'o' || k === 'd' ? v : Array.isArray(v) ? v.map(toG) : toG(v)])));
      check(`${name}: every clue is true`, logic.every((c) => clueHolds(ctx, c)));
      const n = countSolutions(p);
      // The counter itself: with no clues there are many answers.
      if (tier === 'basic' && seed === 'one') check(`${name}: brute force sees many answers with no clues`, countSolutions({ ...p, clues: [] }) === 2);
      check(`${name}: exactly one solution (brute force)`, n === 1, `found ${n}`);
      const play = playHints(p);
      check(`${name}: hints play to solved`, play.solved, JSON.stringify(play.h || {}).slice(0, 300));
      console.log(`${name}: ${cats.length}x${N}, ${p.clues.length} clues, ${p.solvePath.length} steps, ${play.hints} hints, ${ms} ms`);
      if (seed === 'one' && ['easy', 'medium', 'hard'].includes(tier)) (samples[mode] ||= []).push({ tier, clues: p.clues.map((c) => c.text) });
    }
  }
}

// The solver's wrap-around reasoning, by hand: 5 seats, guests A..E. A is in
// Seat 1 and B sits next to A, so B is in Seat 2 or Seat 5 (round the end).
{
  const K = 2, N = 5;
  const model = { K, N, cast: { one: 'guest', many: 'guests' }, cats: [
    { name: 'Guest', labels: ['A', 'B', 'C', 'D', 'E'], pos: 'is {x}', neg: 'is not {x}', ordinal: null },
    { name: 'Seat', labels: ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4', 'Seat 5'], pos: 'sat in {x}', neg: 'did not sit in {x}',
      ordinal: { ring: true, nextTo: 'sat next to', across: 'sat directly across from', left2: 'sat two seats to the left of', notNext: 'did not sit next to' } },
  ] };
  const L = makeLanguage(model);
  const seat = (i) => N + i;
  const res = solveWithTrace(K, N, [{ type: 'is', a: 0, b: seat(0) }, { type: 'nextTo', o: 1, a: 0, b: 1 }], 2, L);
  const open = (g) => [0, 1, 2, 3, 4].filter((i) => res.cells[g * K * N + seat(i)] !== -1);
  assert.deepEqual(open(1), [1, 4], 'B next to A in Seat 1: Seat 2 or Seat 5');
  // left2: C two seats to the left of A (Seat 1) is Seat 3; D two to the left of C is Seat 5; E two to the left of D wraps to Seat 2.
  const r2 = solveWithTrace(K, N, [{ type: 'is', a: 0, b: seat(0) }, { type: 'left2', o: 1, a: 2, b: 0 }, { type: 'left2', o: 1, a: 3, b: 2 }, { type: 'left2', o: 1, a: 4, b: 3 }], 2, L);
  check('left2 wraps round the table', r2.solved && r2.cells[4 * K * N + seat(1)] === 1 && r2.cells[1 * K * N + seat(3)] === 1);
  check('left2 hint mentions the round table', r2.steps.some((s) => /table is round/.test(s.why)));
  // notNext at the seam: A in Seat 1, B not next to A, so not Seat 2 or Seat 5.
  const r3 = solveWithTrace(K, N, [{ type: 'is', a: 0, b: seat(0) }, { type: 'notNext', o: 1, a: 0, b: 1 }], 2, L);
  check('not next to rules out both neighbours, across the seam', r3.cells[1 * K * N + seat(1)] === -1 && r3.cells[1 * K * N + seat(4)] === -1 && r3.cells[1 * K * N + seat(2)] === 0);
  passed++;
}

// No mode: no lab fields, and unknown or empty modes play the standard game.
{
  for (const mode of [undefined, null, '', 'standard', 'nope']) {
    const p = generatePuzzle({ difficulty: 'easy', theme: 'mystery', seed: 'plain', mode });
    check(`mode ${JSON.stringify(mode)}: standard puzzle`, !('mode' in p) && !('mode' in p.options) && !('table' in p));
  }
}

for (const [mode, list] of Object.entries(samples)) {
  for (const s of list) console.log(`\n${mode} ${s.tier}:\n  ${s.clues.join('\n  ')}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
