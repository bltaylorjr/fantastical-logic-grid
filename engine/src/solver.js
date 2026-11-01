// Human-style deduction solver.
//
// The solver only makes deductions a person could make from the clues and the
// grid, ranked by technique level (see tiers.js). A puzzle is accepted only if
// this solver fills every cell, which proves the solution is unique and can be
// reached without guessing. The same solver produces the step-by-step solve
// path used for hints and difficulty grading.
//
// Items are numbered globally: item g belongs to category floor(g / N) and is
// item g % N in that category. Cell (x, y) is 1 (O, match), -1 (X, ruled out)
// or 0 (unknown), and is stored symmetrically.
//
// Speed: alongside the cells, every row (item x against category b) keeps two
// bitmasks, `open` (items not yet ruled out) and `yes` (items marked O). Each
// rule checks these first, so a row with nothing new to say costs one
// operation instead of a loop. The rules still run in the same order and make
// the same deductions with the same wording, so a seed always gives the same
// puzzle it gave before.

export const YES = 1;
export const NO = -1;

export class Contradiction extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export const TECHNIQUE_NAMES = {
  clue: 'Read a clue',
  onlyOne: 'One match per row',
  lastLeft: 'Only option left',
  crossGrid: 'Carry across grids',
  noShared: 'No shared option',
  ordering: 'Ordering',
  gap: 'Exact gap',
  conditional: 'If / then',
  whatIf: 'What if',
};

// Work lists. Each grid rule keeps a bitset of the places it still has to
// look at ("pending"). A place is cleared when the rule looks at it and is
// marked again whenever a mark it depends on changes. A place that is not
// pending would find nothing new, so skipping it changes nothing; places are
// still visited in the rule's original order. This is what makes what-if
// trials cheap: after one trial mark only a handful of places need a look.
//   lastLeft: row x*K+b          onlyOne, noShared: (a*K+b)*N+i for a < b
//   crossGrid: item x
const bitset = (n) => { const w = new Uint32Array((n + 31) >>> 5).fill(0xffffffff); return w; };
const mark = (P, i) => { P[i >>> 5] |= 1 << (i & 31); };

// The first pending place at or after `from`, cleared and returned; -1 if none.
function takeNext(P, from) {
  let w = from >>> 5;
  if (w >= P.length) return -1;
  let m = P[w] & (-1 << (from & 31));
  for (;;) {
    if (m) {
      const b = 31 - Math.clz32(m & -m);
      P[w] &= ~(1 << b);
      return (w << 5) + b;
    }
    if (++w >= P.length) return -1;
    m = P[w];
  }
}

export function createState(K, N, clues, describe, whatIfDepth = 4) {
  const KN = K * N;
  const open = new Uint16Array(KN * K).fill((1 << N) - 1);
  // done[k]: clue k's plain marks are all on the grid, so reading it again adds nothing.
  return { K, N, KN, cells: new Int8Array(KN * KN), open, yes: new Uint16Array(KN * K), done: new Uint8Array(clues.length),
    pLast: bitset(KN * K), pOnly: bitset(K * K * N), pCross: bitset(KN), pShared: bitset(K * K * N),
    pClue: bitset(clues.length), watch: watchList(K, N, clues),
    clues, describe, trace: null, stopFirst: false, changes: 0, rounds: 0, whatIfDepth };
}

// A copy for a what-if trial: its own cells, masks and work lists, same clues and settings.
function fork(S, trace, stopFirst) {
  return { ...S, cells: S.cells.slice(), open: S.open.slice(), yes: S.yes.slice(), done: S.done.slice(),
    pLast: S.pLast.slice(), pOnly: S.pOnly.slice(), pCross: S.pCross.slice(), pShared: S.pShared.slice(), pClue: S.pClue.slice(), trace, stopFirst, changes: 0 };
}

// Row (p against category q) just gained mark v: mark every place that reads
// it and could now find something new. An X can only give lastLeft, noShared
// and ordering clues something new; an O only onlyOne and if/then clues;
// crossGrid uses both.
function touch(S, p, q, v) {
  const { K, N } = S;
  const r = p * K + q;
  const cp = Math.floor(p / N), ip = p - cp * N;
  for (let i = S.watch.start[r], e = S.watch.start[r + 1]; i < e; i++) mark(S.pClue, S.watch.list[i]);
  // crossGrid at x reads x's rows and the rows of every O partner of x.
  mark(S.pCross, p);
  for (let a = 0; a < K; a++) if (a !== cp) for (let m = S.yes[p * K + a]; m; m &= m - 1) mark(S.pCross, a * N + lowBit(m));
  if (v === YES) {
    // onlyOne at (a, b, i) reads its own row and the row of its O partner y against a.
    if (cp < q) mark(S.pOnly, (cp * K + q) * N + ip);
    else for (let m = S.yes[r]; m; m &= m - 1) mark(S.pOnly, (q * K + cp) * N + lowBit(m));
    return;
  }
  mark(S.pLast, r);
  // noShared at (a, b, i) for x against z in b can only find something new
  // through category q, and only if x and z now share no option in q.
  const op = S.open[r];
  // p as x: any open z in a later category b (not q) left with nothing in common.
  for (let b = cp + 1; b < K; b++) {
    if (b === q) continue;
    const rb = p * K + b;
    for (let m = S.open[rb] & ~S.yes[rb]; m; m &= m - 1) {
      if (!(S.open[(b * N + lowBit(m)) * K + q] & op)) { mark(S.pShared, (cp * K + b) * N + ip); break; }
    }
  }
  // p as z: every x in an earlier category a (not q) still open with p.
  for (let a = 0; a < cp; a++) {
    if (a === q) continue;
    const base = (a * K + cp) * N, ra = p * K + a;
    for (let m = S.open[ra] & ~S.yes[ra]; m; m &= m - 1) {
      const i = lowBit(m);
      if (!(S.open[(a * N + i) * K + q] & op)) mark(S.pShared, base + i);
    }
  }
}

// Which ordering and if/then clues read each row, as one flat list per row
// (start[r] to start[r + 1] in `list`). Built for each solve, because the
// generator grows and trims its clue lists between solves.
function watchList(K, N, clues) {
  const R = K * N * K;
  const rowsOf = (c) => (c.type === 'less' || c.type === 'diff') ? [c.a * K + c.o, c.b * K + c.o]
    : c.type === 'ifthen' ? [c.p[0] * K + Math.floor(c.p[1] / N), c.q[0] * K + Math.floor(c.q[1] / N)] : null;
  const start = new Int32Array(R + 1);
  const pairs = [];
  clues.forEach((c, k) => {
    const rows = rowsOf(c);
    if (!rows) return;
    pairs.push(rows[0], k);
    if (rows[1] !== rows[0]) pairs.push(rows[1], k);
  });
  for (let i = 0; i < pairs.length; i += 2) start[pairs[i] + 1]++;
  for (let r = 0; r < R; r++) start[r + 1] += start[r];
  const list = new Int32Array(pairs.length / 2);
  const fill = start.slice(0, R);
  for (let i = 0; i < pairs.length; i += 2) list[fill[pairs[i]]++] = pairs[i + 1];
  return { start, list };
}

const cat = (S, g) => Math.floor(g / S.N);
const get = (S, x, y) => S.cells[x * S.KN + y];

// Write one mark (both halves of the cell) and keep the row masks in step.
function put(S, x, y, v) {
  const { N, K, KN } = S;
  S.cells[x * KN + y] = v;
  S.cells[y * KN + x] = v;
  const cx = Math.floor(x / N), cy = Math.floor(y / N);
  if (v === NO) {
    S.open[x * K + cy] &= ~(1 << (y - cy * N));
    S.open[y * K + cx] &= ~(1 << (x - cx * N));
  } else if (v === YES) {
    S.yes[x * K + cy] |= 1 << (y - cy * N);
    S.yes[y * K + cx] |= 1 << (x - cx * N);
  }
  touch(S, x, cy, v);
  touch(S, y, cx, v);
}

const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowBit = (m) => 31 - Math.clz32(m & -m);

function emit(S, d) {
  const fresh = [];
  for (const s of d.sets) {
    const cur = get(S, s[0], s[1]);
    if (cur === s[2]) continue;
    if (cur !== 0) throw new Contradiction(S.describe ? conflictText(S.describe, d, s) : 'conflict');
    fresh.push(s);
  }
  if (!fresh.length) return false;
  for (const [x, y, v] of fresh) put(S, x, y, v);
  S.changes++;
  if (S.trace) {
    S.trace.push({ level: d.level, technique: d.tech, clue: d.clue ?? -1, sets: fresh, why: d.why ? d.why() : '', chain: d.chain || null, depth: d.depth || 0 });
  }
  return S.stopFirst;
}

function conflictText(D, d, [x, y, v]) {
  const src = d.clue >= 0 ? `clue ${d.clue + 1}` : TECHNIQUE_SOURCE[d.tech] || 'the grid';
  return v === NO
    ? `${D.pair(x, y, YES)}, but ${src} rules that out`
    : `${src} would need ${D.pair(x, y, YES)}, which is already ruled out`;
}

const TECHNIQUE_SOURCE = {
  onlyOne: 'the one-match-per-row rule',
  lastLeft: 'the grid',
  crossGrid: 'another grid',
  noShared: 'another grid',
};

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Items of category c still possible for item x.
function poss(S, x, c) {
  const out = [];
  for (let m = S.open[x * S.K + c]; m; m &= m - 1) out.push(c * S.N + lowBit(m));
  return out;
}

// ---------- Level 0: direct ----------

function clueReadings(S) {
  const { N } = S;
  const D = S.describe;
  for (let k = 0; k < S.clues.length; k++) {
    if (S.done[k]) continue;
    const c = S.clues[k];
    const sets = [];
    let why = null;
    switch (c.type) {
      case 'is':
        sets.push([c.a, c.b, YES]);
        why = D && (() => `Clue ${k + 1} says ${D.pair(c.a, c.b, YES)}.`);
        break;
      case 'not':
        sets.push([c.a, c.b, NO]);
        why = D && (() => `Clue ${k + 1} says ${D.pair(c.a, c.b, NO)}.`);
        break;
      case 'neither':
        for (const x of c.xs) sets.push([x, c.b, NO]);
        why = D && (() => `Clue ${k + 1} says ${D.pair(c.xs[0], c.b, NO)}, and ${D.pair(c.xs[1], c.b, NO)}.`);
        break;
      case 'allDiff':
        for (let i = 0; i < c.items.length; i++)
          for (let j = i + 1; j < c.items.length; j++) sets.push([c.items[i], c.items[j], NO]);
        why = D && (() => `Clue ${k + 1} names ${c.items.length} different ${D.cast()}, so none of those items go together.`);
        break;
      case 'either': {
        const cb = cat(S, c.b1);
        for (let j = 0; j < N; j++) {
          const y = cb * N + j;
          if (y !== c.b1 && y !== c.b2) sets.push([c.a, y, NO]);
        }
        why = D && (() => `Clue ${k + 1} says ${D.posList(c.a, [c.b1, c.b2])}, so no other ${D.catName(cb)} is possible.`);
        break;
      }
      case 'pairs': {
        const cx = cat(S, c.x1), cy = cat(S, c.y1);
        for (const x of [c.x1, c.x2])
          for (let j = 0; j < N; j++) {
            const y = cy * N + j;
            if (y !== c.y1 && y !== c.y2) sets.push([x, y, NO]);
          }
        for (const y of [c.y1, c.y2])
          for (let j = 0; j < N; j++) {
            const x = cx * N + j;
            if (x !== c.x1 && x !== c.x2) sets.push([x, y, NO]);
          }
        why = D && (() => `Clue ${k + 1} says ${D.list([c.x1, c.x2])} go with ${D.list([c.y1, c.y2])} in some order, so nothing else in that grid can match them.`);
        break;
      }
      case 'less':
      case 'diff':
      case 'ifthen':
        if (c.type !== 'ifthen' && cat(S, c.a) !== cat(S, c.b)) {
          sets.push([c.a, c.b, NO]);
          why = D && (() => `Clue ${k + 1} compares ${D.subj(c.a)} with ${D.subj(c.b)}, so they are different ${D.cast()}: ${D.pair(c.a, c.b, NO)}.`);
        }
        break;
    }
    if (!sets.length) { S.done[k] = 1; continue; }
    const stop = emit(S, { level: 0, tech: 'clue', clue: k, sets, why });
    S.done[k] = 1;
    if (stop) return true;
  }
  return false;
}

function onlyOne(S) {
  const { K, N } = S;
  const D = S.describe;
  for (let p = takeNext(S.pOnly, 0); p >= 0; p = takeNext(S.pOnly, p + 1)) {
    const i = p % N, ab = (p - i) / N, a = Math.floor(ab / K), b = ab % K;
    if (a >= b || a >= K) continue;
        for (let ym = S.yes[(a * N + i) * K + b]; ym; ym &= ym - 1) {
          const j = lowBit(ym);
          const x = a * N + i, y = b * N + j;
          // Nothing new: the row and the column already have only this O open.
          if (!(S.open[x * K + b] & ~(1 << j)) && !(S.open[y * K + a] & ~(1 << i))) continue;
          const sets = [];
          for (let t = 0; t < N; t++) {
            if (t !== j) sets.push([x, b * N + t, NO]);
            if (t !== i) sets.push([a * N + t, y, NO]);
          }
          const why = D && (() => `${cap(D.pair(x, y, YES))}, so ${D.name(x)} cannot go with any other ${D.catName(b)}, and no other ${D.catName(a)} can go with ${D.name(y)}.`);
          if (emit(S, { level: 0, tech: 'onlyOne', sets, why })) { mark(S.pOnly, p); return true; }
        }
  }
  return false;
}

function lastLeft(S) {
  const { K, N } = S;
  const D = S.describe;
  for (let p = takeNext(S.pLast, 0); p >= 0; p = takeNext(S.pLast, p + 1)) {
    const x = Math.floor(p / K), b = p % K;
    if (x >= K * N || b === cat(S, x)) continue;
    {
      const m = S.open[x * K + b];
      if (m & (m - 1)) continue; // two or more still open
      const count = m ? 1 : 0, last = m ? b * N + lowBit(m) : -1, hasYes = S.yes[x * K + b] !== 0;
      if (count === 0) {
        throw new Contradiction(D ? `${D.name(x)} would have no ${D.catName(b)} left` : 'empty row');
      }
      if (count === 1 && !hasYes) {
        const why = D && (() => `${D.name(last)} is the only ${D.catName(b)} left for ${D.name(x)}.`);
        if (emit(S, { level: 0, tech: 'lastLeft', sets: [[x, last, YES]], why })) return true;
      }
    }
  }
  return false;
}

// ---------- Level 1: cross-grid ----------

function crossGrid(S) {
  const { K, N } = S;
  const D = S.describe;
  for (let x = takeNext(S.pCross, 0); x >= 0 && x < K * N; x = takeNext(S.pCross, x + 1)) {
    const a = cat(S, x);
    for (let b = 0; b < K; b++) {
      if (b === a) continue;
      for (let ym = S.yes[x * K + b]; ym; ym &= ym - 1) {
        const y = b * N + lowBit(ym);
        for (let c = 0; c < K; c++) {
          if (c === a || c === b) continue;
          // Marks y has in category c that x does not have yet.
          const full = (1 << N) - 1;
          const known = (full & ~S.open[y * K + c]) | S.yes[y * K + c];
          const unknownX = S.open[x * K + c] & ~S.yes[x * K + c];
          if (!(known & unknownX)) continue;
          const sets = [];
          for (let t = 0; t < N; t++) {
            const z = c * N + t;
            const v = get(S, y, z);
            if (v !== 0 && get(S, x, z) === 0) sets.push([x, z, v]);
          }
          if (!sets.length) continue;
          const why = D && (() => {
            const yes = sets.find((s) => s[2] === YES);
            if (yes) return `${cap(D.pair(x, y, YES))} and ${D.pair(y, yes[1], YES)}, so ${D.pair(x, yes[1], YES)}.`;
            return `${cap(D.pair(x, y, YES))}, so anything ruled out for one is ruled out for the other: ${D.negList(x, sets.map((s) => s[1]))}.`;
          });
          if (emit(S, { level: 1, tech: 'crossGrid', sets, why })) return true;
        }
      }
    }
  }
  return false;
}

// ---------- Level 2: advanced ----------

function noShared(S) {
  const { K, N } = S;
  const D = S.describe;
  for (let p = takeNext(S.pShared, 0); p >= 0; p = takeNext(S.pShared, p + 1)) {
    const i = p % N, ab = (p - i) / N, a = Math.floor(ab / K), b = ab % K;
    if (a >= b || a >= K) continue;
      {
        const r = (a * N + i) * K + b;
        for (let um = S.open[r] & ~S.yes[r]; um; um &= um - 1) {
          const x = a * N + i, z = b * N + lowBit(um);
          for (let c = 0; c < K; c++) {
            if (c === a || c === b) continue;
            if (S.open[x * K + c] & S.open[z * K + c]) continue;
            const why = D && (() => `${cap(D.posList(x, poss(S, x, c)))}, and ${D.posList(z, poss(S, z, c))}. With no ${D.catName(c)} in common, ${D.pair(x, z, NO)}.`);
            // Stopping after one step: come back for the rest of this row.
            if (emit(S, { level: 2, tech: 'noShared', sets: [[x, z, NO]], why })) { mark(S.pShared, p); return true; }
            break;
          }
        }
      }
  }
  return false;
}

function clueReasoning(S) {
  const { N } = S;
  const D = S.describe;
  for (let k = takeNext(S.pClue, 0); k >= 0 && k < S.clues.length; k = takeNext(S.pClue, k + 1)) {
    const c = S.clues[k];
    if (c.type === 'less' || c.type === 'diff') {
      const pa = poss(S, c.a, c.o), pb = poss(S, c.b, c.o);
      const va = pa.map((g) => g % N), vb = pb.map((g) => g % N);
      const sets = [];
      if (c.type === 'less') {
        const maxB = Math.max(...vb), minA = Math.min(...va);
        for (const g of pa) if (g % N >= maxB) sets.push([c.a, g, NO]);
        for (const g of pb) if (g % N <= minA) sets.push([c.b, g, NO]);
      } else {
        for (const g of pa) if (!vb.includes((g % N) + c.d)) sets.push([c.a, g, NO]);
        for (const g of pb) if (!va.includes((g % N) - c.d)) sets.push([c.b, g, NO]);
      }
      if (!sets.length) continue;
      const why = D && (() => {
        const ruledA = sets.filter((s) => s[0] === c.a).map((s) => s[1]);
        const ruledB = sets.filter((s) => s[0] === c.b).map((s) => s[1]);
        const parts = [];
        if (ruledA.length) parts.push(D.negList(c.a, ruledA));
        if (ruledB.length) parts.push(D.negList(c.b, ruledB));
        const o = D.ordinal(c.o);
        const rel = c.type === 'less'
          ? `${D.subj(c.a)} ${o.less} ${D.subj(c.b)}`
          : `${D.subj(c.a)} ${o.lessBy.replace('{d}', 'exactly ' + o.gaps[c.d])} ${D.subj(c.b)}`;
        return `Clue ${k + 1} says ${rel}. With the options still open, ${parts.join(', and ')}.`;
      });
      if (emit(S, { level: 2, tech: c.type === 'less' ? 'ordering' : 'gap', clue: k, sets, why })) return true;
    } else if (c.type === 'ifthen') {
      let d = null;
      if (get(S, c.p[0], c.p[1]) === YES) {
        d = { sets: [[c.q[0], c.q[1], YES]], why: D && (() => `Clue ${k + 1}: ${D.pair(c.p[0], c.p[1], YES)}, so ${D.pair(c.q[0], c.q[1], YES)}.`) };
      } else if (get(S, c.q[0], c.q[1]) === NO) {
        d = { sets: [[c.p[0], c.p[1], NO]], why: D && (() => `Clue ${k + 1}: if ${D.pair(c.p[0], c.p[1], YES)}, then ${D.pair(c.q[0], c.q[1], YES)}. But ${D.pair(c.q[0], c.q[1], NO)}, so ${D.pair(c.p[0], c.p[1], NO)}.`) };
      }
      if (d && emit(S, { level: 2, tech: 'conditional', clue: k, ...d })) return true;
    }
  }
  return false;
}

// ---------- Level 3: what-if ----------

function whatIf(S) {
  const { K, N } = S;
  const D = S.describe;
  // Try the most constrained rows first: they give the shortest chains.
  const cand = [];
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++)
      for (let i = 0; i < N; i++) {
        const x = a * N + i;
        const open = poss(S, x, b);
        if (open.length < 2) continue;
        for (const y of open) if (get(S, x, y) === 0) cand.push([open.length, x, y]);
      }
  cand.sort((p, q) => p[0] - q[0]);
  for (const [, x, y] of cand) {
    const trial = fork(S, null, false);
    let reason = null;
    let depth = 0;
    try {
      put(trial, x, y, YES);
      depth = propagate(trial, 2, S.whatIfDepth);
    } catch (e) {
      if (!(e instanceof Contradiction)) throw e;
      reason = e.reason;
      depth = trial.rounds;
    }
    if (reason === null) continue;
    let chain = null;
    if (S.trace) {
      // Re-run the trial with a trace, so the hint can show the chain.
      const t = fork(S, [], true);
      put(t, x, y, YES);
      let r = reason;
      try { traceLoop(t, 2); } catch (e) { if (!(e instanceof Contradiction)) throw e; r = e.reason; }
      chain = t.trace.map((s) => s.why);
      if (chain.length > 12) chain = [...chain.slice(0, 4), '...', ...chain.slice(-7)];
      reason = r;
    }
    const why = D && (() => `Suppose ${D.pair(x, y, YES)}. Following the clues from there, ${lower(reason)}. That is impossible, so ${D.pair(x, y, NO)}.`);
    if (emit(S, { level: 3, tech: 'whatIf', sets: [[x, y, NO]], why, chain, depth })) return true;
    return S.changes > 0;
  }
  return false;
}

const LEVELS = [
  [clueReadings, onlyOne, lastLeft],
  [crossGrid],
  [noShared, clueReasoning],
  [whatIf],
];

// Apply every deduction up to maxLevel until nothing changes (fast, no trace).
// maxRounds limits how many passes run; what-if trials use it so that only
// short chains of reasoning count (a long chain is guessing in disguise).
// Returns the number of passes that made progress.
export function propagate(S, maxLevel, maxRounds = Infinity) {
  S.stopFirst = false;
  S.rounds = 0;
  for (;;) {
    if (S.rounds >= maxRounds) return S.rounds;
    S.rounds++;
    let progressed = false;
    for (let lv = 0; lv <= maxLevel && !progressed; lv++) {
      const before = S.changes;
      for (const fn of LEVELS[lv]) fn(S);
      if (S.changes !== before) progressed = true;
    }
    if (!progressed) return --S.rounds;
  }
}

// One deduction at a time, always the easiest available, for the solve path.
function traceLoop(S, maxLevel) {
  S.stopFirst = true;
  outer: for (;;) {
    for (let lv = 0; lv <= maxLevel; lv++) {
      for (const fn of LEVELS[lv]) if (fn(S)) continue outer;
    }
    return;
  }
}

export function unknownCount(S) {
  const { K, N } = S;
  let n = 0;
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++)
      for (let i = 0; i < N; i++) {
        const r = (a * N + i) * K + b;
        n += popcount(S.open[r] & ~S.yes[r]);
      }
  return n;
}

// Fast check: can the clues alone fill the grid using techniques up to maxLevel?
export function isSolvable(K, N, clues, maxLevel, whatIfDepth) {
  const S = createState(K, N, clues, null, whatIfDepth);
  try {
    propagate(S, maxLevel);
  } catch (e) {
    if (e instanceof Contradiction) return false;
    throw e;
  }
  return unknownCount(S) === 0;
}

// Full solve with a recorded path. `start` optionally seeds the grid with known
// marks ([x, y, v] triples), which is how hints continue from a player's grid.
export function solveWithTrace(K, N, clues, maxLevel, describe, start = [], whatIfDepth) {
  const S = createState(K, N, clues, describe, whatIfDepth);
  for (const [x, y, v] of start) put(S, x, y, v);
  S.trace = [];
  let contradiction = null;
  try {
    traceLoop(S, maxLevel);
  } catch (e) {
    if (!(e instanceof Contradiction)) throw e;
    contradiction = e.reason;
  }
  return { steps: S.trace, solved: !contradiction && unknownCount(S) === 0, contradiction, cells: S.cells };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
