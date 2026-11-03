// Island Bridges: numbered islands on a grid. Join them with straight bridges
// across or down, one or two between any pair. Bridges never cross each other
// or pass over an island, each island has as many bridges as its number, and
// every island ends up joined into one group. Every puzzle is proven by a
// solver that works the way a person does, so it has exactly one answer
// reachable by logic alone, and its difficulty is the hardest technique it needs.
//
// A puzzle's links are the pairs of islands that can see each other across
// open water (p.links, in reading order). Link values: 1 or 2 bridges,
// 3 no bridge (a cross), 0 not decided yet.
//
//   generateIslandBridges({ difficulty, size, seed, avoid, toughness, practice, usedStories, story, theme })
//   getIslandBridgesHint(puzzle, entries)   a nudge, then where, then why
//   solveIslandBridges(puzzle, entries)     the logical solver (used by the tests)
//   countIslandBridges(puzzle, limit)       brute-force count of answers (tests)
import { makeRng } from './rng.js';
import { cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES } from './kit-common.js';
import { kitThemeStory } from './kit-story.js';

export const IB_TECHNIQUES = {
  cross: { level: 1, name: 'Bridges can\'t cross' },
  full: { level: 1, name: 'Island is complete' },
  room: { level: 1, name: 'Not enough room' },
  only: { level: 1, name: 'Every bridge it can get' },
  must: { level: 2, name: 'Not enough without it' },
  isolate: { level: 3, name: 'Don\'t close off a group' },
  reach: { level: 4, name: 'Must reach the rest' },
  whatIf: { level: 5, name: 'Follow it through' },
};

export const IB_TIERS = {
  basic: { name: 'Basic', sizes: [7], minTech: 1, maxTech: 2, density: 0.2, loops: 0.15, doubles: 0.45 },
  easy: { name: 'Easy', sizes: [7, 9], minTech: 2, maxTech: 2, density: 0.21, loops: 0.2, doubles: 0.4 },
  medium: { name: 'Medium', sizes: [9, 10], minTech: 3, maxTech: 3, density: 0.2, loops: 0.25, doubles: 0.4 },
  hard: { name: 'Hard', sizes: [11, 12], minTech: 3, maxTech: 3, density: 0.2, loops: 0.3, doubles: 0.35 },
  expert: { name: 'Expert', sizes: [13, 12], minTech: 3, maxTech: 4, density: 0.19, loops: 0.3, doubles: 0.35 },
  master: { name: 'Master', sizes: [15, 13], minTech: 4, maxTech: 5, density: 0.19, loops: 0.35, doubles: 0.35 },
};
export const IB_SIZES = [7, 9, 10, 11, 12, 13, 15];

// ---------- the map ----------

// Pairs of islands that can see each other across open water, and which pairs cross.
export function ibLinks(R, C, islands) {
  const at = new Map(islands.map((s, i) => [s.r * C + s.c, i]));
  const links = [];
  islands.forEach((s, a) => {
    for (let c = s.c + 1; c < C; c++) { const b = at.get(s.r * C + c); if (b !== undefined) { links.push({ a, b, dir: 'h' }); break; } }
    for (let r = s.r + 1; r < R; r++) { const b = at.get(r * C + s.c); if (b !== undefined) { links.push({ a, b, dir: 'v' }); break; } }
  });
  return links;
}
function shape(p) {
  if (p._ib) return p._ib;
  const isl = p.islands, links = p.links;
  const inc = isl.map(() => []);
  links.forEach((l, e) => { inc[l.a].push(e); inc[l.b].push(e); });
  const crosses = links.map(() => []);
  links.forEach((h, e) => {
    if (h.dir !== 'h') return;
    const r = isl[h.a].r, c1 = isl[h.a].c, c2 = isl[h.b].c;
    links.forEach((v, f) => {
      if (v.dir !== 'v') return;
      const c = isl[v.a].c, r1 = isl[v.a].r, r2 = isl[v.b].r;
      if (r1 < r && r < r2 && c1 < c && c < c2) { crosses[e].push(f); crosses[f].push(e); }
    });
  });
  const x = { isl, links, inc, crosses };
  Object.defineProperty(p, '_ib', { value: x, enumerable: false });
  return x;
}

// ---------- names in plain words ----------

const islText = (s) => `the ${s.n} at row ${s.r + 1}, column ${s.c + 1}`;
const linkText = (x, e) => {
  const l = x.links[e];
  return `the bridge between ${islText(x.isl[l.a])} and the ${x.isl[l.b].n} ${l.dir === 'h' ? 'to its right' : 'below it'}`;
};
const bridges = (n) => `${n} bridge${n === 1 ? '' : 's'}`;
const other = (l, i) => (l.a === i ? l.b : l.a);

// ---------- the rules ----------

function comps(x, lo) {
  const parent = x.isl.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  x.links.forEach((l, e) => { if (lo[e] > 0) { const a = find(l.a), b = find(l.b); if (a !== b) parent[a] = b; } });
  return find;
}
const sum = (arr, es) => es.reduce((s, e) => s + arr[e], 0);

function step(technique, marks, focus, why, extra = {}) {
  return { technique, marks, cells: marks.map(([e]) => e), focus, why, ...extra };
}
// Marks for the links whose lowest count went up, or that can now have no bridge.
function marksFor(lo, hi, before) {
  return before.filter(([e, l0, h0]) => lo[e] > l0 || (hi[e] === 0 && h0 > 0)).map(([e]) => [e, hi[e] === 0 ? 3 : lo[e]]);
}

const RULES = [
  { id: 'cross', level: 1, fn(x, lo, hi) {
    for (let e = 0; e < x.links.length; e++) {
      if (!lo[e]) continue;
      const hit = x.crosses[e].filter((f) => hi[f] > 0);
      if (!hit.length) continue;
      return { technique: 'cross', set: hit.map((f) => [f, 0, 0]), focus: `Look at ${linkText(x, e)}.`, why: `${cap(linkText(x, e))} is already there, and bridges can't cross, so nothing can go across it.` };
    }
    return null;
  } },
  { id: 'full', level: 1, fn(x, lo, hi) {
    for (let i = 0; i < x.isl.length; i++) {
      const s = x.isl[i], es = x.inc[i];
      if (sum(lo, es) !== s.n || !es.some((e) => hi[e] > lo[e])) continue;
      return { technique: 'full', set: es.filter((e) => hi[e] > lo[e]).map((e) => [e, lo[e], lo[e]]), focus: `Look at ${islText(s)}.`, why: `${cap(islText(s))} already has its ${bridges(s.n)}, so it takes no more.` };
    }
    return null;
  } },
  { id: 'only', level: 1, fn(x, lo, hi) {
    for (let i = 0; i < x.isl.length; i++) {
      const s = x.isl[i], es = x.inc[i];
      if (sum(hi, es) !== s.n || !es.some((e) => lo[e] < hi[e])) continue;
      const n = es.filter((e) => hi[e] > 0).length;
      return { technique: 'only', set: es.filter((e) => lo[e] < hi[e]).map((e) => [e, hi[e], hi[e]]), focus: `Look at ${islText(s)}.`, why: `${cap(islText(s))} needs ${bridges(s.n)}, and that is all its ${n === 1 ? 'one neighbour' : `${n} neighbours`} can take, so it gets every bridge it can.` };
    }
    return null;
  } },
  { id: 'room', level: 1, fn(x, lo, hi) {
    for (let e = 0; e < x.links.length; e++) {
      if (hi[e] <= lo[e]) continue;
      const l = x.links[e];
      for (const i of [l.a, l.b]) {
        const s = x.isl[i];
        const capE = s.n - sum(lo, x.inc[i]) + lo[e];
        if (hi[e] > capE) {
          return { technique: 'room', set: [[e, lo[e], capE]], focus: `Look at ${islText(s)}.`, why: `${cap(islText(s))} has room for only ${bridges(capE - lo[e])} more, so ${linkText(x, e)} can have at most ${capE}.` };
        }
      }
    }
    return null;
  } },
  { id: 'must', level: 2, fn(x, lo, hi) {
    for (let i = 0; i < x.isl.length; i++) {
      const s = x.isl[i], es = x.inc[i];
      const total = sum(hi, es);
      for (const e of es) {
        const need = s.n - (total - hi[e]);
        if (need > lo[e]) {
          const o = x.isl[other(x.links[e], i)];
          return { technique: 'must', set: [[e, need, hi[e]]], focus: `Look at ${islText(s)}.`, why: `${cap(islText(s))} needs ${bridges(s.n)}. Its other neighbours can take at most ${total - hi[e]}, so at least ${bridges(need)} must go to ${islText(o)}.` };
        }
      }
    }
    return null;
  } },
  { id: 'isolate', level: 3, fn(x, lo, hi) {
    const find = comps(x, lo);
    const N = x.isl.length;
    for (let e = 0; e < x.links.length; e++) {
      if (hi[e] <= lo[e]) continue;
      const l = x.links[e];
      const ra = find(l.a), rb = find(l.b);
      const group = [];
      for (let i = 0; i < N; i++) { const r = find(i); if (r === ra || r === rb) group.push(i); }
      if (group.length === N) continue;
      const done = group.every((i) => sum(lo, x.inc[i]) + (i === l.a || i === l.b ? 1 : 0) === x.isl[i].n);
      if (!done) continue;
      const a = x.isl[l.a], b = x.isl[l.b];
      const what = group.length === 2
        ? `one more bridge between ${islText(a)} and the ${b.n} would finish both islands`
        : `one more bridge on ${linkText(x, e)} would finish every island in that group`;
      return { technique: 'isolate', set: [[e, lo[e], lo[e]]], focus: `Look at ${islText(a)} and ${islText(b)}.`, why: `Every island must join one group, but ${what} and cut them off from the rest. So ${linkText(x, e)} has no more than ${lo[e] ? bridges(lo[e]) : 'none'}.` };
    }
    return null;
  } },
  { id: 'reach', level: 4, fn(x, lo, hi) {
    const find = comps(x, lo);
    const N = x.isl.length;
    const roots = new Map();
    for (let i = 0; i < N; i++) { const r = find(i); if (!roots.has(r)) roots.set(r, []); roots.get(r).push(i); }
    if (roots.size < 2) return null;
    for (const [r, group] of roots) {
      const outs = new Set();
      for (const i of group) for (const e of x.inc[i]) { const l = x.links[e]; if (hi[e] > 0 && find(other(l, i)) !== r) outs.add(e); }
      if (outs.size !== 1) continue;
      const e = [...outs][0];
      if (lo[e]) continue;
      const s = x.isl[group[0]];
      const who = group.length === 1 ? islText(s) : `The group with ${islText(s)}`;
      return { technique: 'reach', set: [[e, 1, hi[e]]], focus: `Look at ${group.length === 1 ? islText(s) : `the group with ${islText(s)}`}.`, why: `${cap(who)} has only one way left to reach the other islands: ${linkText(x, e)}. Every island must join one group, so it needs at least one bridge.` };
    }
    return null;
  } },
  { id: 'whatIf', level: 5, fn(x, lo, hi) {
    for (let e = 0; e < x.links.length; e++) {
      if (hi[e] <= lo[e]) continue;
      // Try the fewest bridges it could have, then the most.
      for (const [tl, th, words, fix] of [[lo[e], lo[e], lo[e] ? `had only ${bridges(lo[e])}` : 'had no bridge', [lo[e] + 1, hi[e]]], [hi[e], hi[e], `had ${bridges(hi[e])}`, [lo[e], hi[e] - 1]]]) {
        const l2 = lo.slice(), h2 = hi.slice();
        l2[e] = tl; h2[e] = th;
        const broke = propagate(x, l2, h2, 4, 60);
        if (!broke) continue;
        const [nl, nh] = fix;
        const result = nh === 0 ? 'it has no bridge' : nl === nh ? `it has ${bridges(nl)}` : nl > lo[e] ? `it has at least ${bridges(nl)}` : `it has at most ${bridges(nh)}`;
        return { technique: 'whatIf', set: [[e, nl, nh]], focus: `Look at ${linkText(x, e)}.`, why: `Suppose ${linkText(x, e)} ${words}. Following the rules from there, ${broke}. So ${result}.` };
      }
    }
    return null;
  } },
];

function broken(x, lo, hi) {
  for (let e = 0; e < x.links.length; e++) {
    if (lo[e] > hi[e]) return 'a bridge would need to be two things at once';
    if (lo[e]) for (const f of x.crosses[e]) if (lo[f]) return 'two bridges would cross';
  }
  for (let i = 0; i < x.isl.length; i++) {
    const s = x.isl[i];
    if (sum(lo, x.inc[i]) > s.n) return `${islText(s)} would get too many bridges`;
    if (sum(hi, x.inc[i]) < s.n) return `${islText(s)} could not get enough bridges`;
  }
  const find = comps(x, lo);
  const N = x.isl.length;
  const groups = new Map();
  for (let i = 0; i < N; i++) { const r = find(i); groups.set(r, (groups.get(r) || 0) + 1); }
  if (groups.size > 1) {
    for (const [r] of groups) {
      let out = false;
      for (let i = 0; i < N && !out; i++) if (find(i) === r) for (const e of x.inc[i]) if (hi[e] > 0 && find(other(x.links[e], i)) !== r) { out = true; break; }
      if (!out) return 'some islands would be cut off from the rest';
    }
  }
  return '';
}

function applySet(lo, hi, set) {
  for (const [e, l, h] of set) { lo[e] = Math.max(lo[e], l); hi[e] = Math.min(hi[e], h); }
}

function propagate(x, lo, hi, maxLevel, maxSteps) {
  for (let n = 0; n < maxSteps; n++) {
    const why = broken(x, lo, hi);
    if (why) return why;
    let s = null;
    for (const r of RULES) { if (r.level > maxLevel) break; s = r.fn(x, lo, hi); if (s) break; }
    if (!s) return '';
    applySet(lo, hi, s.set);
  }
  return broken(x, lo, hi);
}

function startState(p, entries) {
  const x = shape(p);
  const lo = new Int8Array(x.links.length), hi = new Int8Array(x.links.length);
  x.links.forEach((l, e) => { hi[e] = Math.min(2, x.isl[l.a].n, x.isl[l.b].n); });
  if (p.solution) entries.forEach((v, e) => {
    if (e >= x.links.length || !v) return;
    const s = p.solution[e];
    if (v === 3 && s === 3) hi[e] = 0;
    else if ((v === 1 || v === 2) && s !== 3 && v <= s) lo[e] = Math.max(lo[e], v);
  });
  return { x, lo, hi };
}

// ---------- the whole map ----------

export function solveIslandBridges(p, entries = [], { maxLevel = 9, maxSteps = 5000, untilMark = false } = {}) {
  const { x, lo, hi } = startState(p, entries);
  const steps = [];
  let hardest = 0;
  while (steps.length < maxSteps) {
    let s = null;
    for (const r of RULES) { if (r.level > maxLevel) continue; s = r.fn(x, lo, hi); if (s) break; }
    if (!s) break;
    const before = s.set.map(([e]) => [e, lo[e], hi[e]]);
    applySet(lo, hi, s.set);
    const out = step(s.technique, marksFor(lo, hi, before), s.focus, s.why, { links: s.set.map(([e]) => e) });
    steps.push(out);
    hardest = Math.max(hardest, IB_TECHNIQUES[s.technique].level);
    if (untilMark && out.marks.length) break;
  }
  const contradiction = !!broken(x, lo, hi);
  const solved = !contradiction && x.links.every((_, e) => lo[e] === hi[e]);
  return { solved, steps, values: x.links.map((_, e) => (hi[e] === 0 ? 3 : lo[e])), lo: [...lo], hi: [...hi], hardest, contradiction };
}

// Brute force: how many ways to bridge the map (up to limit). Independent of the solver.
export function countIslandBridges(p, limit = 2) {
  const x = shape(p);
  const L = x.links.length, N = x.isl.length;
  const val = new Int8Array(L), have = new Int8Array(N), left = x.inc.map((es) => es.length);
  let found = 0;
  const joined = () => {
    const parent = x.isl.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
    x.links.forEach((l, e) => { if (val[e]) { const a = find(l.a), b = find(l.b); if (a !== b) parent[a] = b; } });
    const r = find(0);
    return x.isl.every((_, i) => find(i) === r);
  };
  function go(e) {
    if (found >= limit) return;
    if (e === L) { if (x.isl.every((s, i) => have[i] === s.n) && joined()) found++; return; }
    const { a, b } = x.links[e];
    left[a]--; left[b]--;
    for (let k = 0; k <= 2; k++) {
      if (have[a] + k > x.isl[a].n || have[b] + k > x.isl[b].n) break;
      if (k && x.crosses[e].some((f) => f < e && val[f])) break;
      // An island whose links are all decided must be exactly full.
      if ((!left[a] && have[a] + k !== x.isl[a].n) || (!left[b] && have[b] + k !== x.isl[b].n)) continue;
      val[e] = k; have[a] += k; have[b] += k;
      go(e + 1);
      val[e] = 0; have[a] -= k; have[b] -= k;
    }
    left[a]++; left[b]++;
  }
  go(0);
  return found;
}

// ---------- making a map ----------

const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

function makeMap(R, C, tier, rng) {
  const occ = new Int8Array(R * C); // 0 water, 1 island, 2 bridge
  const islands = [];
  const sol = new Map(); // "a,b" -> bridges
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const isIsland = (r, c) => r >= 0 && c >= 0 && r < R && c < C && occ[r * C + c] === 1;
  const add = (r, c) => { occ[r * C + c] = 1; islands.push({ r, c }); return islands.length - 1; };
  add(rng.int(R), rng.int(C));
  const target = Math.max(4, Math.round(R * C * tier.density));
  for (let tries = 0; islands.length < target && tries < target * 80; tries++) {
    const a = rng.next() < 0.5 ? islands.length - 1 - rng.int(Math.min(3, islands.length)) : rng.int(islands.length);
    const [dr, dc] = rng.pick(DIRS);
    const s = islands[a];
    const ok = [];
    for (let d = 1; ; d++) {
      const r = s.r + dr * d, c = s.c + dc * d;
      if (r < 0 || c < 0 || r >= R || c >= C || occ[r * C + c]) break;
      if (d >= 2 && !isIsland(r - 1, c) && !isIsland(r + 1, c) && !isIsland(r, c - 1) && !isIsland(r, c + 1)) ok.push(d);
    }
    if (!ok.length) continue;
    const d = ok[Math.min(ok.length - 1, Math.floor(rng.next() * rng.next() * ok.length * 1.6))];
    for (let k = 1; k < d; k++) occ[(s.r + dr * k) * C + s.c + dc * k] = 2;
    const b = add(s.r + dr * d, s.c + dc * d);
    sol.set(key(a, b), rng.next() < tier.doubles ? 2 : 1);
  }
  // Extra bridges between islands that can still see each other, for loops.
  const order = islands.map((s, i) => i).sort((i, j) => (islands[i].r - islands[j].r) || (islands[i].c - islands[j].c));
  const isl = order.map((i) => islands[i]);
  const newIdx = new Map(order.map((old, k) => [old, k]));
  const solN = new Map();
  for (const [k, n] of sol) { const [a, b] = k.split(',').map(Number); solN.set(key(newIdx.get(a), newIdx.get(b)), n); }
  for (const l of ibLinks(R, C, isl)) {
    if (solN.has(key(l.a, l.b))) continue;
    const A = isl[l.a], B = isl[l.b];
    const cells = [];
    if (l.dir === 'h') for (let c = A.c + 1; c < B.c; c++) cells.push(A.r * C + c);
    else for (let r = A.r + 1; r < B.r; r++) cells.push(r * C + A.c);
    if (cells.some((i) => occ[i])) continue;
    if (rng.next() >= tier.loops) continue;
    for (const i of cells) occ[i] = 2;
    solN.set(key(l.a, l.b), rng.next() < tier.doubles ? 2 : 1);
  }
  const links = ibLinks(R, C, isl);
  const solution = links.map((l) => solN.get(key(l.a, l.b)) || 3);
  const n = isl.map(() => 0);
  links.forEach((l, e) => { if (solution[e] !== 3) { n[l.a] += solution[e]; n[l.b] += solution[e]; } });
  return { islands: isl.map((s, i) => ({ r: s.r, c: s.c, n: n[i] })), links, solution };
}

// ---------- stories ----------

const STORY = {
  places: ['Gull', 'Coral', 'Driftwood', 'Lantern', 'Pebble', 'Kelp', 'Tidewater', 'Puffin', 'Saltspray', 'Heron', 'Seaglass', 'Mangrove', 'Otter', 'Anchor', 'Sandpiper', 'Lagoon', 'Shell', 'Cormorant', 'Breaker', 'Marram'],
  things: ['Isles', 'Keys', 'Atoll', 'Archipelago', 'Reefs', 'Shoals', 'Skerries', 'Islets'],
  intros: [
    'The {place} {thing} want to be one town again. Each island has counted exactly how many bridges it can hold.',
    'A storm washed out every bridge in the {place} {thing}. The numbers on the islands are the old plan.',
    'Ferries to the {place} {thing} have stopped running. Build the bridges so everyone can walk to everyone.',
    'The engineers of the {place} {thing} left one rule: bridges go straight, never cross, and every island gets its number.',
  ],
  endings: [
    'The last plank goes down. You can walk from any island of the {place} {thing} to any other.',
    'Every island has its bridges, and the {place} {thing} are joined at last.',
    'The {place} {thing} light their lanterns along every bridge tonight.',
  ],
};
function story(seed, used = []) {
  const seen = new Set(used);
  for (let i = 0; i < 40; i++) {
    const r = makeRng(`${seed}:story:${i}`);
    const place = r.pick(STORY.places), thing = r.pick(STORY.things);
    const id = `ib-${place}-${thing}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(id) && i < 39) continue;
    const fill = (t) => t.replaceAll('{place}', place).replaceAll('{thing}', thing);
    return { id, title: `The ${place} ${thing}`, intro: fill(r.pick(STORY.intros)), ending: fill(r.pick(STORY.endings)) };
  }
  return null;
}

// ---------- making a puzzle ----------

const fpOf = (R, C, islands) => fingerprint('ib', `${R}x${C}|${islands.map((s) => `${s.r}.${s.c}.${s.n}`).join(',')}`);
const scoreOf = (res, nIsl) => Math.round(res.steps.reduce((s, x) => s + IB_TECHNIQUES[x.technique].level ** 2, 0) + nIsl);

export function generateIslandBridges({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, practice = null, usedStories = [], story: wantStory = true, theme = null } = {}) {
  const tier = IB_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = tier.sizes.includes(Number(size)) ? Number(size) : tier.sizes[0];
  if (practice && (!IB_TECHNIQUES[practice] || IB_TECHNIQUES[practice].level > tier.maxTech)) practice = null;
  const seen = new Set(avoid);
  const found = [];
  let backup = null;
  const started = Date.now(), budget = N >= 13 ? 4000 : 1500;
  for (let k = 0; k < 3000 && found.length < 4; k++) {
    if (Date.now() - started > budget && (found.length || (backup && Date.now() - started > budget * 2))) break;
    const rng = makeRng(`${seed}:ib:${k}`);
    const m = makeMap(N, N, tier, rng);
    if (m.islands.length < 3) continue;
    const p0 = { size: N, cols: N, islands: m.islands, links: m.links, solution: m.solution };
    const res = solveIslandBridges(p0, [], { maxLevel: tier.maxTech });
    if (!res.solved) continue;
    const fp = fpOf(N, N, m.islands);
    if (seen.has(fp)) continue;
    const c = { ...m, res, fp, score: scoreOf(res, m.islands.length) };
    if (res.hardest < tier.minTech) { if (!backup || res.hardest > backup.res.hardest || (res.hardest === backup.res.hardest && c.score > backup.score)) backup = c; continue; }
    if (practice && !res.steps.some((s) => s.technique === practice) && k < 300) { if (!backup) backup = c; continue; }
    found.push(c);
  }
  if (!found.length && backup) found.push(backup);
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  const pick = pickByToughness(found, clamp01(toughness));
  const { res } = pick;
  const p = {
    kind: 'island-bridges', game: 'ib',
    id: `ib-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N,
    islands: pick.islands, links: pick.links, solution: pick.solution, givens: pick.links.map(() => 0),
    solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: IB_TECHNIQUES[s.technique].name, marks: s.marks, cells: s.cells, why: s.why })),
    hardestTechnique: res.hardest,
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    toughness: pick.score,
    fingerprint: pick.fp,
    rules: [
      'Join the islands with straight bridges, across or down. Two islands can share one bridge or two.',
      'Bridges never cross each other and never pass over an island.',
      'Each island has exactly as many bridges as its number.',
      'In the end every island is joined into one group, so you can walk from any island to any other.',
    ],
  };
  if (wantStory) p.story = kitThemeStory('ib', seed, { theme, used: usedStories, classic: () => story(seed, usedStories) });
  return p;
}

// ---------- checking and hints ----------

const isWrong = (s, v) => (v === 3 ? s !== 3 : v === 1 || v === 2 ? s === 3 || v > s : false);
export function checkIslandBridges(p, entries = []) {
  const wrong = [];
  entries.forEach((v, e) => { if (e < p.solution.length && isWrong(p.solution[e], v)) wrong.push(e); });
  return { wrong, solved: p.solution.every((s, e) => (s === 3 ? !entries[e] || entries[e] === 3 : entries[e] === s)) };
}

export function getIslandBridgesHint(p, entries = []) {
  const x = shape(p);
  const { wrong, solved } = checkIslandBridges(p, entries);
  if (wrong.length) {
    const w = wrong[0], s = p.solution[w], v = entries[w];
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One bridge is' : `${wrong.length} bridges are`} marked wrong.`, `Check ${linkText(x, w)}.`, `${cap(linkText(x, w))} ${s === 3 ? 'has no bridge' : v === 3 ? `has ${bridges(s)}` : `has only ${bridges(s)}`}.`] };
  }
  if (solved) return { kind: 'done', levels: ['Every island has its bridges.'] };
  const res = solveIslandBridges(p, entries, { untilMark: true });
  const last = res.steps[res.steps.length - 1];
  if (!last || !last.marks.length) return { kind: 'stuck', levels: ['Look for an island whose number matches what its neighbours can take.'] };
  // Steps that only narrowed things down near these islands come first, in the same words.
  const near = new Set(last.marks.flatMap(([e]) => [x.links[e].a, x.links[e].b]));
  const before = res.steps.slice(0, -1).filter((s) => s.links.some((e) => near.has(x.links[e].a) || near.has(x.links[e].b))).slice(-2).map((s) => s.why);
  const adds = last.marks.filter(([, v]) => v !== 3).length, none = last.marks.length - adds;
  const what = [adds ? `${adds === 1 ? 'one place' : `${adds} places`} that need${adds === 1 ? 's' : ''} a bridge` : '', none ? `${none === 1 ? 'one place' : `${none} places`} with no bridge` : ''].filter(Boolean).join(' and ');
  return {
    kind: 'step', technique: last.technique, techniqueName: IB_TECHNIQUES[last.technique].name,
    cell: last.marks[0][0], marks: last.marks, cells: last.cells,
    levels: [last.focus, `There ${adds + none === 1 ? 'is' : 'are'} ${what} there.`, [...before, last.why].join(' ')],
  };
}
