// Shared pieces for the Latin-square number games (More or Less, Skyline):
// every row and column holds 1..N once. A random answer grid, the solver's
// working state with the row-and-column techniques every such game uses
// (only number left, only place left, matching pair, hidden pair, matching
// three), a brute-force answer counter for the tests, the clue-removal loop the
// generators use, the hint shape the grid kit expects, and short story lines.
import { makeRng } from './rng.js';
import { bit, bitCount, bitsOf, onlyBit, cellName, cap, listOr } from './kit-common.js';

export const unitName = (u, N) => (u < N ? `row ${u + 1}` : `column ${u - N + 1}`);
export const lineUnits = (N) => {
  const units = [];
  for (let r = 0; r < N; r++) units.push([...Array(N)].map((_, c) => r * N + c));
  for (let c = 0; c < N; c++) units.push([...Array(N)].map((_, r) => r * N + c));
  return units;
};
export const highBit = (m) => (m ? 32 - Math.clz32(m) : 0);
export const lowBit = (m) => (m ? 32 - Math.clz32(m & -m) : 0);

// A random N×N Latin square, row by row (each row a random arrangement that
// fits the columns so far), falling back to a shuffled cyclic square.
export function latinSquare(N, rng) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const g = [], colUsed = Array(N).fill(0);
    let ok = true;
    for (let r = 0; r < N && ok; r++) {
      const row = Array(N).fill(0), used = new Set();
      let budget = 4000;
      const go = (c) => {
        if (c === N) return true;
        if (--budget < 0) return false;
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
  const rows = rng.shuffle([...Array(N).keys()]), cols = rng.shuffle([...Array(N).keys()]), syms = rng.shuffle([...Array(N)].map((_, i) => i + 1));
  return [...Array(N * N)].map((_, i) => syms[(rows[Math.floor(i / N)] + cols[i % N]) % N]);
}

// ---------- the solver's working state ----------

export function latinState(N) {
  const NN = N * N, full = (1 << N) - 1;
  const S = { N, NN, full, units: lineUnits(N), cand: Array(NN).fill(full), val: Array(NN).fill(0), contradiction: false };
  S.place = (c, d) => {
    S.val[c] = d; S.cand[c] = bit(d);
    const r = Math.floor(c / N), co = c % N;
    for (const x of S.units[r]) if (x !== c) S.cand[x] &= ~bit(d);
    for (const x of S.units[N + co]) if (x !== c) S.cand[x] &= ~bit(d);
  };
  S.remove = (list) => { for (const [c, d] of list) S.cand[c] &= ~bit(d); };
  S.elimsFrom = (cells, mask) => {
    const out = [];
    for (const c of cells) if (!S.val[c]) for (const d of bitsOf(S.cand[c] & mask)) out.push([c, d]);
    return out;
  };
  return S;
}

// Removals grouped by cell, in words: "row 2, column 3 cannot be 4 or 5".
export function elimText(N, elim) {
  const by = new Map();
  for (const [c, d] of elim) { if (!by.has(c)) by.set(c, []); by.get(c).push(d); }
  return [...by].map(([c, ds]) => `${cellName(N, c)} cannot be ${listOr(ds.sort((a, b) => a - b))}`).join('; ');
}

// The row-and-column techniques. `because` adds the game's own reason to "only number left".
export const latinFinders = {
  nakedSingle(S, because = 'every other number is already in its row or column') {
    const { N } = S;
    for (let c = 0; c < S.NN; c++) {
      if (S.val[c]) continue;
      if (!S.cand[c]) { S.contradiction = true; return null; }
      const d = onlyBit(S.cand[c]);
      if (d) return { technique: 'nakedSingle', place: [c, d], cells: [c], why: `${cap(cellName(N, c))} can only be ${d}: ${because}.` };
    }
    return null;
  },
  hiddenSingle(S) {
    const { N, cand, val } = S;
    for (let u = 0; u < 2 * N; u++) {
      const cells = S.units[u];
      // Numbers seen in exactly one cell of the line.
      let once = 0, more = 0, done = 0;
      for (const c of cells) { const m = cand[c]; more |= once & m; once |= m; if (val[c]) done |= m; }
      if (once !== S.full) { S.contradiction = true; return null; }
      const lone = once & ~more & ~done;
      if (!lone) continue;
      const d = lowBit(lone);
      const c = cells.find((x) => cand[x] & bit(d));
      return { technique: 'hiddenSingle', place: [c, d], cells: [c], why: `In ${unitName(u, N)}, ${d} can only go in ${u < N ? `column ${(c % N) + 1}` : `row ${Math.floor(c / N) + 1}`}.` };
    }
    return null;
  },
  nakedPair(S) {
    const { N } = S;
    for (let u = 0; u < 2 * N; u++) {
      const open = S.units[u].filter((c) => !S.val[c]);
      for (let i = 0; i < open.length; i++) {
        if (bitCount(S.cand[open[i]]) !== 2) continue;
        for (let j = i + 1; j < open.length; j++) {
          if (S.cand[open[j]] !== S.cand[open[i]]) continue;
          const elim = S.elimsFrom(open.filter((c) => c !== open[i] && c !== open[j]), S.cand[open[i]]);
          if (elim.length) {
            const [a, b] = bitsOf(S.cand[open[i]]);
            return { technique: 'nakedPair', remove: elim, cells: [open[i], open[j]], why: `In ${unitName(u, N)}, ${cellName(N, open[i])} and ${cellName(N, open[j])} can only be ${a} or ${b}. Between them they take both, so the rest of ${unitName(u, N)} cannot be ${a} or ${b}.` };
          }
        }
      }
    }
    return null;
  },
  hiddenPair(S) {
    const { N } = S;
    for (let u = 0; u < 2 * N; u++) {
      const open = S.units[u].filter((c) => !S.val[c]);
      for (let a = 1; a <= N; a++) {
        const sa = open.filter((c) => S.cand[c] & bit(a));
        if (sa.length !== 2) continue;
        for (let b = a + 1; b <= N; b++) {
          const sb = open.filter((c) => S.cand[c] & bit(b));
          if (sb.length !== 2 || sb[0] !== sa[0] || sb[1] !== sa[1]) continue;
          const elim = S.elimsFrom(sa, S.full & ~(bit(a) | bit(b)));
          if (elim.length) return { technique: 'hiddenPair', remove: elim, cells: sa.slice(), why: `In ${unitName(u, N)}, ${a} and ${b} can only go in ${cellName(N, sa[0])} and ${cellName(N, sa[1])}, so those two cells hold nothing else.` };
        }
      }
    }
    return null;
  },
  nakedTriple(S) {
    const { N } = S;
    for (let u = 0; u < 2 * N; u++) {
      const open = S.units[u].filter((c) => !S.val[c] && bitCount(S.cand[c]) <= 3);
      for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) for (let k = j + 1; k < open.length; k++) {
        const m = S.cand[open[i]] | S.cand[open[j]] | S.cand[open[k]];
        if (bitCount(m) !== 3) continue;
        const three = [open[i], open[j], open[k]];
        const elim = S.elimsFrom(S.units[u].filter((c) => !three.includes(c)), m);
        if (elim.length) return { technique: 'nakedTriple', remove: elim, cells: three, why: `In ${unitName(u, N)}, ${cellName(N, three[0])}, ${cellName(N, three[1])} and ${cellName(N, three[2])} can only hold ${bitsOf(m).join(', ')} between them, so no other cell in ${unitName(u, N)} can.` };
      }
    }
    return null;
  },
};

// Runs finders (cheapest first) until the grid is full or nothing more follows.
// finders: [{ level, find: (S) => step | null }].
export function runSolver(S, finders, techniques, { maxTech = 5, stopAtPlace = false } = {}) {
  const use = finders.filter((f) => f.level <= maxTech);
  const steps = [];
  let guard = 0;
  let open = S.val.filter((v) => !v).length;
  while (guard++ < 6000) {
    if (!open) break;
    let s = null;
    for (const f of use) {
      s = f.find(S);
      if (S.contradiction) { s = null; break; }
      if (s) break;
    }
    if (!s) break;
    steps.push(s);
    if (s.place) { S.place(s.place[0], s.place[1]); open--; }
    if (s.remove) S.remove(s.remove);
    if (stopAtPlace && s.place) break;
  }
  const solved = !S.contradiction && S.val.every(Boolean);
  const hardest = steps.reduce((m, s) => Math.max(m, techniques[s.technique].level), 1);
  return { solved, steps, values: S.val, hardest, contradiction: S.contradiction };
}

const WEIGHT = { 1: 0, 2: 0.5, 3: 3, 4: 6, 5: 10 };
export const toughnessOf = (steps, techniques, N) => Math.round(steps.reduce((t, s) => t + WEIGHT[techniques[s.technique].level], 0) + N);

// ---------- a brute-force answer counter (independent of the logic solver) ----------

// Fills cells in row order. allowed(c, grid) gives the extra numbers the game's
// own rules allow at c given the cells before it; lineOk(c, grid) checks a
// line once c is filled. Stops at `limit` answers.
export function countLatin(N, givens, { allowed = null, lineOk = null, limit = 2 } = {}) {
  const NN = N * N, full = (1 << N) - 1;
  const grid = Array(NN).fill(0), rowUsed = Array(N).fill(0), colUsed = Array(N).fill(0);
  for (let c = 0; c < NN; c++) {
    const d = givens[c];
    if (!d) continue;
    const r = Math.floor(c / N), k = c % N;
    if (rowUsed[r] & bit(d) || colUsed[k] & bit(d)) return 0;
    rowUsed[r] |= bit(d); colUsed[k] |= bit(d);
  }
  let count = 0;
  const go = (c) => {
    if (count >= limit) return;
    if (c === NN) { count++; return; }
    const r = Math.floor(c / N), k = c % N;
    let m = givens[c] ? bit(givens[c]) : full & ~(rowUsed[r] | colUsed[k]);
    if (allowed) m &= allowed(c, grid);
    for (; m; m &= m - 1) {
      const d = lowBit(m);
      grid[c] = d;
      if (lineOk && !lineOk(c, grid)) continue;
      if (!givens[c]) { rowUsed[r] |= bit(d); colUsed[k] |= bit(d); }
      go(c + 1);
      if (!givens[c]) { rowUsed[r] &= ~bit(d); colUsed[k] &= ~bit(d); }
      if (count >= limit) break;
    }
    grid[c] = 0;
  };
  go(0);
  return count;
}

// ---------- building a puzzle ----------

// Drops clues one at a time in the given order, keeping each drop only if the
// puzzle can still be solved by logic: the result needs every clue it keeps.
export function pruneClues(order, keep, solvable) {
  for (const k of order) {
    keep[k] = false;
    if (!solvable(keep)) keep[k] = true;
  }
  return keep;
}

// ---------- checking and hints ----------

export function checkLatin(p, entries = []) {
  const wrong = [];
  entries.forEach((d, c) => { if (d && !p.givens[c] && d !== p.solution[c]) wrong.push(c); });
  return { wrong, solved: p.solution.every((d, c) => (p.givens[c] || entries[c]) === d) };
}

// The kit's hint: mistakes first, then a nudge, where to look, and why.
export function latinHint(p, entries, { solve, techniques, nudge, stuck }) {
  const N = p.size;
  const { wrong, solved } = checkLatin(p, entries);
  if (wrong.length) {
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One number does' : `${wrong.length} numbers do`} not fit.`, `Check ${cellName(N, wrong[0])}.`, `${cap(cellName(N, wrong[0]))} is not ${entries[wrong[0]]}.`] };
  }
  if (solved) return { kind: 'done', levels: ['Every cell is filled in correctly.'] };
  const res = solve(p, entries, { maxTech: 5, stopAtPlace: true });
  const at = res.steps.findIndex((s) => s.place);
  if (at < 0) return { kind: 'stuck', levels: [stuck] };
  const step = res.steps[at], lead = res.steps.slice(0, at);
  const [c, d] = step.place;
  return {
    kind: 'step', technique: step.technique, techniqueName: techniques[step.technique].name,
    cell: c, digit: d, value: d, cells: [c],
    levels: [lead.length ? `First: ${lead[lead.length - 1].why}` : nudge(step), `Look at ${cellName(N, c)}.`, step.why],
  };
}

export const pathOf = (steps, techniques) => steps.map((s) => ({ technique: s.technique, techniqueName: techniques[s.technique].name, place: s.place || null, remove: s.remove || null, cells: s.cells || [], why: s.why }));

// ---------- story lines ----------

const STORY = {
  ml: {
    places: ['Copper', 'Harbor', 'Orchard', 'Lantern', 'Granary', 'Saltmarsh', 'Juniper', 'Old Mill', 'Weaver\'s', 'Market', 'Hilltop', 'Clockwork', 'Riverside', 'Thistle', 'Signal', 'Foundry', 'Meadow', 'Quarry', 'Willow', 'Cobble'],
    things: ['Scales', 'Weighhouse', 'Balance', 'Counting House', 'Assay Office', 'Toll Gate', 'Ledger', 'Steelyard'],
    intros: [
      'At the {place} {thing}, every sign points from the bigger number to the smaller one. The rest you must work out.',
      'The keeper of the {place} {thing} left only a few numbers and a trail of signs: this one less, that one more.',
      'Nothing at the {place} {thing} is weighed twice in a row or column. The signs say which side is heavier.',
      'The {place} {thing} keeps its record in signs. Follow them and every number finds its place.',
    ],
    endings: [
      'Every sign agrees. The {place} {thing} balances at last.',
      'The last number settles, and the {place} {thing} is even.',
      'Not one sign is broken. The {place} {thing} closes its books.',
    ],
  },
  sk: {
    places: ['Harbor', 'Lantern', 'Copper', 'Riverside', 'Granite', 'Clocktower', 'Marina', 'Signal', 'Juniper', 'Glasshouse', 'Ironworks', 'Starlight', 'Canal', 'Orchard', 'Pinewood', 'Saltmarsh', 'Ember', 'Bramble', 'Seaside', 'Quill'],
    things: ['Skyline', 'Rooftops', 'Towers', 'Heights', 'Quarter', 'Avenue', 'Square', 'Waterfront'],
    intros: [
      'From the edge of {place} {thing}, the lookouts count the towers they can see. Taller towers hide the shorter ones behind them.',
      'The plans for {place} {thing} were lost. All that is left is what the lookouts saw from each side.',
      'Every street in {place} {thing} has one tower of each height. The numbers around the edge tell you how many show.',
      'The mapmaker stood at every edge of {place} {thing} and counted the towers in view.',
    ],
    endings: [
      'Every view matches. {place} {thing} stands as it was planned.',
      'The last tower goes up, and {place} {thing} is complete.',
      'From every side, the lookouts count just what they saw. {place} {thing} is rebuilt.',
    ],
  },
};

export function latinStory(game, seed, used = []) {
  const s = STORY[game];
  if (!s) return null;
  const seen = new Set(used);
  let pick = null;
  for (let i = 0; i < 40 && !pick; i++) {
    const r = makeRng(`${seed}:story:${i}`);
    const place = r.pick(s.places), thing = r.pick(s.things);
    const id = `${game}-${place}-${thing}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(id) && i < 39) continue;
    const fill = (t) => t.replaceAll('{place}', place).replaceAll('{thing}', thing);
    pick = { id, title: `The ${place} ${thing}`, intro: fill(r.pick(s.intros)), ending: fill(r.pick(s.endings)) };
  }
  return pick;
}
