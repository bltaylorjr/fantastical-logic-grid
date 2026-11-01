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
  if (c.type === 'is' || c.type === 'not') [norm.a, norm.b] = [c.a, c.b].sort((p, q) => p - q);
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
    default: return false;
  }
}
