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

export function createState(K, N, clues, describe, whatIfDepth = 4) {
  const KN = K * N;
  return { K, N, KN, cells: new Int8Array(KN * KN), clues, describe, trace: null, stopFirst: false, changes: 0, rounds: 0, whatIfDepth };
}

const cat = (S, g) => Math.floor(g / S.N);
const get = (S, x, y) => S.cells[x * S.KN + y];

function emit(S, d) {
  const fresh = [];
  for (const s of d.sets) {
    const cur = get(S, s[0], s[1]);
    if (cur === s[2]) continue;
    if (cur !== 0) throw new Contradiction(S.describe ? conflictText(S.describe, d, s) : 'conflict');
    fresh.push(s);
  }
  if (!fresh.length) return false;
  for (const [x, y, v] of fresh) {
    S.cells[x * S.KN + y] = v;
    S.cells[y * S.KN + x] = v;
  }
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
  for (let j = 0; j < S.N; j++) if (get(S, x, c * S.N + j) !== NO) out.push(c * S.N + j);
  return out;
}

// ---------- Level 0: direct ----------

function clueReadings(S) {
  const { N } = S;
  const D = S.describe;
  for (let k = 0; k < S.clues.length; k++) {
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
    if (sets.length && emit(S, { level: 0, tech: 'clue', clue: k, sets, why })) return true;
  }
  return false;
}

function onlyOne(S) {
  const { K, N } = S;
  const D = S.describe;
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++)
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const x = a * N + i, y = b * N + j;
          if (get(S, x, y) !== YES) continue;
          const sets = [];
          for (let t = 0; t < N; t++) {
            if (t !== j) sets.push([x, b * N + t, NO]);
            if (t !== i) sets.push([a * N + t, y, NO]);
          }
          const why = D && (() => `${cap(D.pair(x, y, YES))}, so ${D.name(x)} cannot go with any other ${D.catName(b)}, and no other ${D.catName(a)} can go with ${D.name(y)}.`);
          if (emit(S, { level: 0, tech: 'onlyOne', sets, why })) return true;
        }
  return false;
}

function lastLeft(S) {
  const { K, N } = S;
  const D = S.describe;
  for (let x = 0; x < K * N; x++) {
    const a = cat(S, x);
    for (let b = 0; b < K; b++) {
      if (b === a) continue;
      let count = 0, last = -1, hasYes = false;
      for (let j = 0; j < N; j++) {
        const v = get(S, x, b * N + j);
        if (v !== NO) { count++; last = b * N + j; }
        if (v === YES) hasYes = true;
      }
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
  for (let x = 0; x < K * N; x++) {
    const a = cat(S, x);
    for (let b = 0; b < K; b++) {
      if (b === a) continue;
      for (let j = 0; j < N; j++) {
        const y = b * N + j;
        if (get(S, x, y) !== YES) continue;
        for (let c = 0; c < K; c++) {
          if (c === a || c === b) continue;
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
  for (let a = 0; a < K; a++)
    for (let b = a + 1; b < K; b++)
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const x = a * N + i, z = b * N + j;
          if (get(S, x, z) !== 0) continue;
          for (let c = 0; c < K; c++) {
            if (c === a || c === b) continue;
            let shared = false;
            for (let t = 0; t < N && !shared; t++) {
              const y = c * N + t;
              if (get(S, x, y) !== NO && get(S, z, y) !== NO) shared = true;
            }
            if (shared) continue;
            const why = D && (() => `${cap(D.posList(x, poss(S, x, c)))}, and ${D.posList(z, poss(S, z, c))}. With no ${D.catName(c)} in common, ${D.pair(x, z, NO)}.`);
            if (emit(S, { level: 2, tech: 'noShared', sets: [[x, z, NO]], why })) return true;
            break;
          }
        }
  return false;
}

function clueReasoning(S) {
  const { N } = S;
  const D = S.describe;
  for (let k = 0; k < S.clues.length; k++) {
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
    const trial = { ...S, cells: S.cells.slice(), trace: null, stopFirst: false, changes: 0 };
    let reason = null;
    let depth = 0;
    try {
      trial.cells[x * S.KN + y] = YES;
      trial.cells[y * S.KN + x] = YES;
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
      const t = { ...S, cells: S.cells.slice(), trace: [], stopFirst: true, changes: 0 };
      t.cells[x * S.KN + y] = YES;
      t.cells[y * S.KN + x] = YES;
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
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) if (get(S, a * N + i, b * N + j) === 0) n++;
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
  for (const [x, y, v] of start) {
    S.cells[x * S.KN + y] = v;
    S.cells[y * S.KN + x] = v;
  }
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
