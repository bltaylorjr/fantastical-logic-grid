// Candidate clue generation. Every candidate is built from the hidden solution,
// so it is always true; the generator then keeps only the clues it needs.
//
// ctx: { K, N, sol, ordinals, rng } where sol[c][e] is the item index that
// entity e has in category c (entity e is cast member e, so sol[0][e] = e).

const g = (ctx, c, e) => c * ctx.N + ctx.sol[c][e];

function distinct(rng, n, k) {
  return rng.sample([...Array(n).keys()], k);
}

const MAKERS = {
  is(ctx) {
    const { rng, K, N } = ctx;
    const e = rng.int(N);
    const [a, b] = distinct(rng, K, 2);
    return { type: 'is', a: g(ctx, a, e), b: g(ctx, b, e) };
  },
  not(ctx) {
    const { rng, K, N } = ctx;
    const [e1, e2] = distinct(rng, N, 2);
    const [a, b] = distinct(rng, K, 2);
    return { type: 'not', a: g(ctx, a, e1), b: g(ctx, b, e2) };
  },
  neither(ctx) {
    const { rng, K, N } = ctx;
    if (N < 3) return null;
    const [e1, e2, e3] = distinct(rng, N, 3);
    const [a, b] = distinct(rng, K, 2);
    return { type: 'neither', xs: [g(ctx, a, e1), g(ctx, a, e2)], b: g(ctx, b, e3) };
  },
  either(ctx) {
    const { rng, K, N } = ctx;
    const [e1, e2] = distinct(rng, N, 2);
    const [a, b] = distinct(rng, K, 2);
    const [b1, b2] = rng.shuffle([g(ctx, b, e1), g(ctx, b, e2)]);
    return { type: 'either', a: g(ctx, a, e1), b1, b2 };
  },
  pairs(ctx) {
    const { rng, K, N } = ctx;
    if (N < 3) return null;
    const [e1, e2] = distinct(rng, N, 2);
    let [a, b] = distinct(rng, K, 2);
    if (b === 0) [a, b] = [b, a]; // names read best on the "of X and Y" side
    const [y1, y2] = rng.shuffle([g(ctx, b, e1), g(ctx, b, e2)]);
    return { type: 'pairs', x1: g(ctx, a, e1), x2: g(ctx, a, e2), y1, y2 };
  },
  allDiff(ctx) {
    const { rng, K, N } = ctx;
    if (K < 3 || N < 3) return null;
    const ents = distinct(rng, N, 3);
    const cs = distinct(rng, K, 3).sort((p, q) => p - q);
    return { type: 'allDiff', items: cs.map((c, i) => g(ctx, c, ents[i])) };
  },
  less(ctx) {
    const { rng, K, N, ordinals } = ctx;
    if (!ordinals.length) return null;
    const o = rng.pick(ordinals);
    let [e1, e2] = distinct(rng, N, 2);
    if (ctx.sol[o][e1] > ctx.sol[o][e2]) [e1, e2] = [e2, e1];
    const others = [...Array(K).keys()].filter((c) => c !== o);
    return { type: 'less', o, a: g(ctx, rng.pick(others), e1), b: g(ctx, rng.pick(others), e2) };
  },
  diff(ctx) {
    const c = MAKERS.less(ctx);
    if (!c) return null;
    return { ...c, type: 'diff', d: gapOf(ctx, c) };
  },
  ifthen(ctx) {
    const { rng, K, N } = ctx;
    const truePair = () => {
      const e = rng.int(N);
      const [a, b] = distinct(rng, K, 2);
      return [g(ctx, a, e), g(ctx, b, e)];
    };
    const falsePair = () => {
      const [e1, e2] = distinct(rng, N, 2);
      const [a, b] = distinct(rng, K, 2);
      return [g(ctx, a, e1), g(ctx, b, e2)];
    };
    // Either both halves are true, or both are false (so the clue works by
    // "the second part is false, so the first part must be false too").
    const both = rng.next() < 0.5;
    const p = both ? truePair() : falsePair();
    const q = both ? truePair() : falsePair();
    if (new Set([...p, ...q]).size < 4) return null;
    return { type: 'ifthen', p, q };
  },
  // ----- Lab modes only (modes.js). The tiers never weight these types, so
  // standard puzzles never draw them. ctx.time is the Timeline Case's clock
  // category and ctx.ring the Seating Plan's seat category (seats wrap round).
  next(ctx) {
    // b was seen right after a (the next time on the clock).
    const o = ctx.time;
    if (o == null) return null;
    const { rng, N } = ctx;
    const v = rng.int(N - 1);
    return { type: 'next', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, v)), b: g(ctx, otherCat(ctx, o), entAt(ctx, o, v + 1)) };
  },
  between(ctx) {
    // m was seen after a but before b; a and b may be clock times themselves.
    const o = ctx.time;
    if (o == null || ctx.N < 3) return null;
    const { rng, N } = ctx;
    const [lo, mid, hi] = distinct(rng, N, 3).sort((p, q) => p - q);
    const m = g(ctx, otherCat(ctx, o), entAt(ctx, o, mid));
    if (rng.next() < 0.4) return { type: 'between', o, a: o * N + lo, m, b: o * N + hi };
    return { type: 'between', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, lo)), m, b: g(ctx, otherCat(ctx, o), entAt(ctx, o, hi)) };
  },
  first(ctx) {
    const o = ctx.time;
    if (o == null) return null;
    return { type: 'first', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, 0)) };
  },
  last(ctx) {
    const o = ctx.time;
    if (o == null) return null;
    return { type: 'last', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, ctx.N - 1)) };
  },
  nextTo(ctx) {
    const o = ctx.ring;
    if (o == null) return null;
    const { rng, N } = ctx;
    const v = rng.int(N);
    const w = (v + (rng.next() < 0.5 ? 1 : N - 1)) % N;
    return { type: 'nextTo', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, v)), b: g(ctx, otherCat(ctx, o), entAt(ctx, o, w)) };
  },
  across(ctx) {
    const o = ctx.ring;
    if (o == null || ctx.N % 2) return null;
    const { rng, N } = ctx;
    const v = rng.int(N);
    return { type: 'across', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, v)), b: g(ctx, otherCat(ctx, o), entAt(ctx, o, (v + N / 2) % N)) };
  },
  left2(ctx) {
    // a sits two seats to the left of b: two seats on from b, clockwise.
    const o = ctx.ring;
    if (o == null) return null;
    const { rng, N } = ctx;
    const vb = rng.int(N);
    return { type: 'left2', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, (vb + 2) % N)), b: g(ctx, otherCat(ctx, o), entAt(ctx, o, vb)) };
  },
  notNext(ctx) {
    const o = ctx.ring;
    if (o == null || ctx.N < 4) return null;
    const { rng, N } = ctx;
    const v = rng.int(N);
    const w = (v + 2 + rng.int(N - 3)) % N;
    return { type: 'notNext', o, a: g(ctx, otherCat(ctx, o), entAt(ctx, o, v)), b: g(ctx, otherCat(ctx, o), entAt(ctx, o, w)) };
  },
};

// Lab modes: the entity at value index v of category o, and a random category other than o.
const entAt = (ctx, o, v) => ctx.sol[o].indexOf(v);
function otherCat(ctx, o) {
  const c = ctx.rng.int(ctx.K - 1);
  return c >= o ? c + 1 : c;
}

// Lab modes: does the relation hold between value indexes va and vb (and vm
// for 'between')? Shared by clueHolds and the solver. N is the number of
// items (seats wrap round: seat N sits next to seat 1).
export const MODE_RELATIONS = {
  next: (va, vb) => vb === va + 1,
  nextTo: (va, vb, N) => { const d = (vb - va + N) % N; return d === 1 || d === N - 1; },
  across: (va, vb, N) => N % 2 === 0 && (vb - va + N) % N === N / 2,
  left2: (va, vb, N) => (va - vb + N) % N === 2,
  notNext: (va, vb, N) => { const d = (vb - va + N) % N; return d !== 0 && d !== 1 && d !== N - 1; },
};

function gapOf(ctx, c) {
  // value index of an item's entity in ordinal category o
  return valueIndex(ctx, c.b, c.o) - valueIndex(ctx, c.a, c.o);
}

function valueIndex(ctx, item, o) {
  const { N, sol } = ctx;
  const c = Math.floor(item / N), i = item % N;
  const e = sol[c].indexOf(i);
  return sol[o][e];
}

export function clueKey(c) {
  const norm = { ...c };
  if (norm.xs) norm.xs = [...norm.xs].sort();
  if (norm.items) norm.items = [...norm.items].sort();
  if (c.type === 'is' || c.type === 'not' || c.type === 'nextTo' || c.type === 'across' || c.type === 'notNext') [norm.a, norm.b] = [c.a, c.b].sort((p, q) => p - q);
  if (c.type === 'either') [norm.b1, norm.b2] = [c.b1, c.b2].sort((p, q) => p - q);
  if (c.type === 'pairs') {
    [norm.x1, norm.x2] = [c.x1, c.x2].sort((p, q) => p - q);
    [norm.y1, norm.y2] = [c.y1, c.y2].sort((p, q) => p - q);
  }
  return JSON.stringify(norm);
}

// Endless stream of distinct candidate clues, drawn by type weight.
export function candidateStream(ctx, weights) {
  const seen = new Set();
  return () => {
    for (let tries = 0; tries < 200; tries++) {
      const type = ctx.rng.weighted(weights);
      const c = MAKERS[type](ctx);
      if (!c) continue;
      const key = clueKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      return c;
    }
    return null;
  };
}

// Independent check that a clue is true for a solution (used by tests and as a guard).
export function clueHolds(ctx, c) {
  const { N, sol } = ctx;
  const ent = (item) => sol[Math.floor(item / N)].indexOf(item % N);
  const val = (item, o) => sol[o][ent(item)];
  const same = (x, y) => ent(x) === ent(y);
  switch (c.type) {
    case 'is': return same(c.a, c.b);
    case 'not': return !same(c.a, c.b);
    case 'neither': return c.xs.every((x) => !same(x, c.b));
    case 'either': return same(c.a, c.b1) !== same(c.a, c.b2);
    case 'pairs':
      return (same(c.x1, c.y1) && same(c.x2, c.y2)) || (same(c.x1, c.y2) && same(c.x2, c.y1));
    case 'allDiff': return new Set(c.items.map(ent)).size === c.items.length;
    case 'less': return val(c.a, c.o) < val(c.b, c.o);
    case 'diff': return val(c.b, c.o) - val(c.a, c.o) === c.d;
    case 'ifthen': return !same(c.p[0], c.p[1]) || same(c.q[0], c.q[1]);
    case 'between': return val(c.a, c.o) < val(c.m, c.o) && val(c.m, c.o) < val(c.b, c.o);
    case 'first': return val(c.a, c.o) === 0;
    case 'last': return val(c.a, c.o) === N - 1;
    default:
      if (MODE_RELATIONS[c.type]) return !same(c.a, c.b) && MODE_RELATIONS[c.type](val(c.a, c.o), val(c.b, c.o), N);
      return false;
  }
}
