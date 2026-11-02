// Picture Grid: shade cells so each row and column has the runs of shaded
// cells its numbers call for, in order, with at least one blank between runs.
// Solve it and a picture appears. Every puzzle is proven solvable one line at
// a time (the way a person solves it), so it has exactly one answer and needs
// no guessing; where a picture needs it, a few cells start shaded.
//
// Cell values: 1 shaded, 2 blank (a cross), 0 not decided yet.
//
//   generatePictureGrid({ difficulty, size, seed, avoid, toughness, usedPictures })
//   getPictureGridHint(puzzle, entries)
//   solvePictureGrid(puzzle, entries)
import { makeRng } from './rng.js';
import { cellName, cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES } from './kit-common.js';
import { PG_ART } from './picture-grid-art.js';

export const PG_TECHNIQUES = {
  overlap: { level: 1, name: 'Overlapping runs' },
  finish: { level: 1, name: 'Finished line' },
  edge: { level: 2, name: 'Pushing from the edge' },
  reach: { level: 3, name: 'Out of reach' },
  cross: { level: 4, name: 'Working both ways' },
};

export const PG_TIERS = {
  basic: { name: 'Basic', sizes: [5], givens: 0.2, mosaic: 0.55 },
  easy: { name: 'Easy', sizes: [10, 5], givens: 0.08, mosaic: 0.55 },
  medium: { name: 'Medium', sizes: [10], givens: 0.04, mosaic: 0.5 },
  hard: { name: 'Hard', sizes: [15, 10], givens: 0.03, mosaic: 0.5, minRounds: 3 },
  expert: { name: 'Expert', sizes: [15, 20], givens: 0.02, mosaic: 0.48, minRounds: 4 },
  master: { name: 'Master', sizes: [20, 25], givens: 0.01, mosaic: 0.47, minRounds: 5 },
};
export const PG_SIZES = [5, 10, 15, 20, 25];

export const cluesOf = (line) => {
  const out = [];
  let run = 0;
  for (const v of line) { if (v === 1) run++; else if (run) { out.push(run); run = 0; } }
  if (run) out.push(run);
  return out;
};

// ---------- one line ----------

// Which cells of a line are shaded in every arrangement of its runs that fits
// what is already known, and which are blank in every one. Returns null when
// nothing fits (a mistake somewhere).
export function solveLine(clues, state) {
  const n = state.length, k = clues.length;
  const canFill = (i) => i < n && state[i] !== 2, canEmpty = (i) => i >= n || state[i] !== 1;
  // blocked[i]: cells before i that cannot be shaded.
  const blocked = [0];
  for (let i = 0; i < n; i++) blocked.push(blocked[i] + (canFill(i) ? 0 : 1));
  const fillOk = (a, len) => a + len <= n && blocked[a + len] - blocked[a] === 0;
  const M = n + 1;
  const pre = Array.from({ length: M + 1 }, () => new Uint8Array(k + 1));
  pre[0][0] = 1;
  for (let i = 0; i < M; i++) for (let j = 0; j <= k; j++) {
    if (!pre[i][j]) continue;
    if (canEmpty(i)) pre[i + 1][j] = 1;
    if (j < k && fillOk(i, clues[j]) && canEmpty(i + clues[j])) pre[i + clues[j] + 1][j + 1] = 1;
  }
  if (!pre[M][k]) return null;
  const suf = Array.from({ length: M + 2 }, () => new Uint8Array(k + 1));
  suf[M][k] = 1;
  for (let i = M - 1; i >= 0; i--) for (let j = k; j >= 0; j--) {
    let ok = canEmpty(i) && suf[i + 1][j];
    if (!ok && j < k && fillOk(i, clues[j]) && canEmpty(i + clues[j]) && i + clues[j] + 1 <= M) ok = suf[i + clues[j] + 1][j + 1];
    suf[i][j] = ok ? 1 : 0;
  }
  const mayEmpty = new Uint8Array(n), mayFill = new Uint8Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= k; j++) if (pre[i][j] && canEmpty(i) && suf[i + 1][j]) { mayEmpty[i] = 1; break; }
  for (let j = 0; j < k; j++) {
    const L = clues[j];
    for (let s = 0; s + L <= n; s++) {
      if (pre[s][j] && fillOk(s, L) && canEmpty(s + L) && suf[s + L + 1][j + 1]) {
        for (let x = s; x < s + L; x++) mayFill[x] = 1;
        // The blank that follows a run can be blank too.
        if (s + L < n) mayEmpty[s + L] = 1;
      }
    }
  }
  const out = state.slice();
  for (let i = 0; i < n; i++) {
    if (state[i]) continue;
    if (mayFill[i] && !mayEmpty[i]) out[i] = 1;
    else if (!mayFill[i] && mayEmpty[i]) out[i] = 2;
  }
  return out;
}

const lineName = (isRow, idx) => `${isRow ? 'row' : 'column'} ${idx + 1}`;
const cluesText = (cl) => (cl.length ? cl.join(' ') : '0');

function explain(isRow, idx, clues, before, after, n) {
  const filled = [], blank = [];
  after.forEach((v, i) => { if (!before[i] && v) (v === 1 ? filled : blank).push(i + 1); });
  const where = (xs) => `${isRow ? 'column' : 'row'}${xs.length > 1 ? 's' : ''} ${xs.length > 6 ? `${xs.slice(0, 6).join(', ')} and ${xs.length - 6} more` : xs.join(', ')}`;
  const name = lineName(isRow, idx);
  const known = before.some(Boolean);
  const total = clues.reduce((a, b) => a + b, 0) + Math.max(0, clues.length - 1);
  let technique, why;
  if (!clues.length || after.filter((v) => v === 1).length === clues.reduce((a, b) => a + b, 0) && !filled.length) {
    technique = 'finish';
    why = clues.length ? `${cap(name)} (${cluesText(clues)}) already has all its shaded cells, so the rest of it is blank.` : `${cap(name)} has the clue 0: none of its cells are shaded.`;
  } else if (!known) {
    technique = total === n ? 'finish' : 'overlap';
    why = total === n
      ? `${cap(name)} (${cluesText(clues)}) fills the line exactly, with one blank between runs.`
      : `${cap(name)} (${cluesText(clues)}) has ${n} cells. However its runs slide, they always cover ${where(filled)}${blank.length ? `, and never reach ${where(blank)}` : ''}.`;
  } else if (filled.length && !blank.length && after.slice(0, 1).concat(after.slice(-1)).some((v) => v === 1)) {
    technique = 'edge';
    why = `In ${name} (${cluesText(clues)}), a shaded cell near the edge pins its run in place, so ${where(filled)} must be shaded too.`;
  } else if (!filled.length) {
    technique = 'reach';
    why = `In ${name} (${cluesText(clues)}), no run can reach ${where(blank)} with the cells already known, so they are blank.`;
  } else {
    technique = 'cross';
    why = `In ${name} (${cluesText(clues)}), every way the runs fit around the cells already known shades ${where(filled)}${blank.length ? ` and leaves ${where(blank)} blank` : ''}.`;
  }
  return { technique, why };
}

// ---------- the whole grid ----------

export function solvePictureGrid(p, entries = [], { stopAtChange = false, maxRounds = 200 } = {}) {
  const R = p.size, C = p.cols;
  const g = Array(R * C).fill(0);
  p.givens.forEach((v, i) => { if (v) g[i] = v; });
  entries.forEach((v, i) => { if (v && !g[i] && v === p.solution[i]) g[i] = v; });
  const steps = [];
  let rounds = 0, contradiction = false;
  const row = (r) => g.slice(r * C, r * C + C);
  const col = (c) => [...Array(R)].map((_, r) => g[r * C + c]);
  const dirty = new Set([...Array(R)].map((_, r) => `r${r}`).concat([...Array(C)].map((_, c) => `c${c}`)));
  while (dirty.size && rounds < maxRounds) {
    rounds++;
    const lines = [...dirty];
    dirty.clear();
    // Lines with the most to give first, the way a person scans.
    for (const key of lines) {
      const isRow = key[0] === 'r', idx = Number(key.slice(1));
      const clues = isRow ? p.rowClues[idx] : p.colClues[idx];
      const before = isRow ? row(idx) : col(idx);
      if (before.every(Boolean)) continue;
      const after = solveLine(clues, before);
      if (!after) { contradiction = true; break; }
      const changed = [];
      after.forEach((v, i) => { if (v !== before[i]) changed.push(i); });
      if (!changed.length) continue;
      const { technique, why } = explain(isRow, idx, clues, before, after, before.length);
      const marks = changed.map((i) => [isRow ? idx * C + i : i * C + idx, after[i]]);
      for (const [cell, v] of marks) {
        g[cell] = v;
        dirty.add(isRow ? `c${cell % C}` : `r${Math.floor(cell / C)}`);
      }
      steps.push({ technique, line: isRow ? `r${idx}` : `c${idx}`, marks, why, cells: marks.map(([c]) => c), round: rounds });
      if (stopAtChange) return { solved: false, steps, values: g, rounds, contradiction };
    }
    if (contradiction) break;
  }
  return { solved: !contradiction && g.every(Boolean), steps, values: g, rounds, contradiction };
}

// ---------- pictures ----------

const fromArt = (art) => art.flatMap((r) => [...r].map((ch) => (ch === '#' ? 1 : 2)));
const mirror = (cells, R, C) => cells.map((_, i) => cells[Math.floor(i / C) * C + (C - 1 - (i % C))]);

// A new pattern: a symmetric mosaic smoothed so it reads as shapes, not noise.
function mosaic(N, rng, density) {
  const kind = rng.pick(['mirror', 'quad', 'mirror', 'turn']);
  let g = [...Array(N * N)].map(() => (rng.next() < density ? 1 : 0));
  for (let pass = 0; pass < 2; pass++) {
    g = g.map((_, i) => {
      const r = Math.floor(i / N), c = i % N;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) n += g[rr * N + cc];
      }
      return n >= 5 ? 1 : n <= 3 ? 0 : g[i];
    });
  }
  const at = (r, c) => g[r * N + c];
  const out = g.map((_, i) => {
    const r = Math.floor(i / N), c = i % N, mc = Math.min(c, N - 1 - c), mr = Math.min(r, N - 1 - r);
    if (kind === 'mirror') return at(r, mc);
    if (kind === 'quad') return at(mr, mc);
    return r * N + c < (N * N) / 2 ? at(r, c) : at(N - 1 - r, N - 1 - c);
  });
  const names = { mirror: 'a mirrored mosaic', quad: 'a snowflake mosaic', turn: 'a pinwheel mosaic' };
  return { cells: out.map((v) => (v ? 1 : 2)), name: names[kind], kind };
}

const fpOf = (cells, R) => fingerprint('pg', `${R}|${cells.join('')}`);

function proveAndGive(cells, R, C, tier, rng) {
  const rowClues = [...Array(R)].map((_, r) => cluesOf(cells.slice(r * C, r * C + C)));
  const colClues = [...Array(C)].map((_, c) => cluesOf([...Array(R)].map((_, r) => cells[r * C + c])));
  const givens = Array(R * C).fill(0);
  const maxGivens = Math.ceil(R * C * tier.givens);
  const base = { size: R, cols: C, rowClues, colClues, givens, solution: cells };
  let res = solvePictureGrid(base);
  for (let n = 0; ; n++) {
    if (res.contradiction) return null;
    if (res.solved) {
      // The proof from a clean start (with the starting cells), for the solution replay.
      const full = solvePictureGrid({ ...base, givens });
      return { rowClues, colClues, givens: givens.slice(), res: full, nGivens: n };
    }
    if (n >= maxGivens) return null;
    // Where the logic stalls, start the picture with the shaded cell that
    // unlocks the most (tried on a handful of candidates).
    const open = cells.map((v, i) => (v === 1 && !res.values[i] ? i : -1)).filter((i) => i >= 0);
    if (!open.length) return null;
    let best = null;
    for (const c of rng.sample(open, Math.min(open.length, 10))) {
      const v = res.values.slice();
      v[c] = 1;
      const r2 = solvePictureGrid(base, v);
      const left = r2.values.filter((x) => !x).length;
      if (!best || left < best.left) best = { c, left, r2 };
    }
    givens[best.c] = 1;
    res = best.r2;
  }
}

const scoreOf = (res, nGivens, R) => Math.round(res.rounds * 4 + res.steps.filter((s) => s.technique === 'cross' || s.technique === 'reach').length * 2 + R - nGivens * 3);

export function generatePictureGrid({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, usedPictures = [] } = {}) {
  const tier = PG_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = PG_SIZES.includes(Number(size)) ? Number(size) : tier.sizes[0];
  const rng = makeRng(`${seed}:pg`);
  const seen = new Set(avoid), usedPics = new Set(usedPictures);
  const found = [];
  // Hand-drawn pictures first (each also mirrored), then new mosaics.
  const art = rng.shuffle(PG_ART.filter((a) => a.art.length === N && a.art.every((r) => r.length === N)))
    .flatMap((a) => [{ id: a.id, name: a.name, cells: fromArt(a.art) }, { id: `${a.id}-m`, name: a.name, cells: mirror(fromArt(a.art), N, N) }])
    .filter((a) => !usedPics.has(a.id));
  for (const a of art) {
    if (found.length >= 3) break;
    if (seen.has(fpOf(a.cells, N))) continue;
    const proof = proveAndGive(a.cells, N, N, tier, rng);
    if (proof) found.push({ ...a, ...proof, score: scoreOf(proof.res, proof.nGivens, N) });
  }
  const until = Date.now() + 4000;
  for (let attempt = 0; found.length < 3 && attempt < 300; attempt++) {
    if (Date.now() > until && found.length) break;
    const r2 = makeRng(`${seed}:m${attempt}`);
    const m = mosaic(N, r2, tier.mosaic);
    if (m.cells.every((v) => v === 2) || seen.has(fpOf(m.cells, N))) continue;
    const proof = proveAndGive(m.cells, N, N, tier, r2);
    if (!proof) continue;
    if (tier.minRounds && proof.res.rounds < tier.minRounds && attempt < 150) continue;
    found.push({ id: `mosaic-${seed}-${attempt}`, name: m.name, cells: m.cells, ...proof, score: scoreOf(proof.res, proof.nGivens, N) });
  }
  if (!found.length) throw new Error('Could not build a puzzle for those options. Try again.');
  // A hand-drawn picture is always preferred while the player has some left.
  const drawn = found.filter((f) => !f.id.startsWith('mosaic-'));
  const pick = drawn.length ? pickByToughness(drawn, clamp01(toughness)) : pickByToughness(found, clamp01(toughness));
  const { res } = pick;
  return {
    kind: 'picture-grid', game: 'pg',
    id: `pg-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N,
    rowClues: pick.rowClues, colClues: pick.colClues, givens: pick.givens, solution: pick.cells,
    picture: { id: pick.id, name: pick.name },
    solvePath: res.steps.map((s) => ({ technique: s.technique, techniqueName: PG_TECHNIQUES[s.technique].name, marks: s.marks, cells: s.cells, why: s.why })),
    hardestTechnique: Math.max(...res.steps.map((s) => PG_TECHNIQUES[s.technique].level)),
    techniques: [...new Set(res.steps.map((s) => s.technique))],
    rounds: res.rounds,
    toughness: pick.score,
    fingerprint: fpOf(pick.cells, N),
    story: { id: pick.id, title: 'A hidden picture', intro: `Somewhere in this ${N}×${N} grid is a picture. Shade the cells the numbers call for and it will appear.`, ending: `The last line falls into place, and there it is: ${pick.name}, drawn one cell at a time.` },
    rules: [
      'Shade cells so each row and column has the runs of shaded cells its numbers call for, in order.',
      'Each number is one run: "3 1" means a run of three shaded cells, then at least one blank, then a single shaded cell.',
      'Mark cells you know are blank with a cross. Crosses are optional, but they help.',
    ],
  };
}

export function checkPictureGrid(p, entries = []) {
  const wrong = [];
  entries.forEach((v, i) => { if (v && !p.givens[i] && ((v === 1) !== (p.solution[i] === 1))) wrong.push(i); });
  return { wrong, solved: p.solution.every((v, i) => (v === 1) === ((p.givens[i] || entries[i]) === 1)) };
}

export function getPictureGridHint(p, entries = []) {
  const C = p.cols;
  const { wrong, solved } = checkPictureGrid(p, entries);
  if (wrong.length) {
    const w = wrong[0];
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One cell is' : `${wrong.length} cells are`} marked wrong.`, `Check ${cellName(C, w)}.`, `${cap(cellName(C, w))} should be ${p.solution[w] === 1 ? 'shaded' : 'blank'}.`] };
  }
  if (solved) return { kind: 'done', levels: ['The picture is complete.'] };
  const res = solvePictureGrid(p, entries, { stopAtChange: true });
  const step = res.steps[0];
  if (!step) return { kind: 'stuck', levels: ['Look for a row or column whose numbers nearly fill it.'] };
  const [line, idx] = [step.line[0] === 'r' ? 'row' : 'column', Number(step.line.slice(1)) + 1];
  return {
    kind: 'step', technique: step.technique, techniqueName: PG_TECHNIQUES[step.technique].name,
    cell: step.marks[0][0], marks: step.marks, cells: step.cells,
    levels: [`Look at ${line} ${idx}.`, `${cap(line)} ${idx} has ${step.marks.length} cell${step.marks.length === 1 ? '' : 's'} you can decide now.`, step.why],
  };
}
