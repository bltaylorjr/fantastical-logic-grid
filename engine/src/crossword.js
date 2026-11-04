// Crossword: American-style crossword puzzles, made fresh for each player with
// the same engine abilities as every Logic Grid game: a seed always gives the
// same puzzle, levels from Basic to Master, puzzles tuned to the player
// (toughness), a story theme with story moments, hints that teach, a
// step-by-step solve, and no repeats in free play (avoid).
//
//   generateCrossword({ difficulty, size, seed, avoid, toughness, usedStories, story, theme })
//   getCrosswordHint(puzzle, entries)   a nudge (the clue), then where, then a letter
//   checkCrossword(puzzle)              every rule, checked again on the finished puzzle
//
// Accuracy. Every answer and every clue comes from the dictionary in
// crossword-words.js (WordNet's own definitions, same-meaning words and
// phrases, never made up), and checkCrossword proves each one before a
// puzzle is returned: each answer is a real dictionary answer, each clue is
// one of that answer's own dictionary clues, and no clue gives its answer away.
//
// The rules, held to or tighter than the New York Times' published standards:
//   * rotational (180°) symmetry of the black squares
//   * every answer at least 3 letters; every white square in an Across and a Down answer
//   * all-over interlock: every white square joins up with every other
//   * no answer twice, and no two answers sharing a word or word root
//   * black squares at most a sixth of the grid (NYT's guide), and no 2×2 block of black
//   * word count at or under the NYT limits (78 themed 15×15, 140 for 21×21), scaled for other sizes
//   * fill from common words: every answer above the level's word-score floor, no offensive words
//   * themed puzzles: theme answers placed symmetrically, every one fitting the theme exactly
import { makeRng } from './rng.js';
import { cap, clamp01, fingerprint, pickByToughness, KIT_LEVEL_NAMES } from './kit-common.js';
import { kitThemeStory } from './kit-story.js';
import { WORDS } from './crossword-words.js';
import { THEME_SETS, themeNote } from './crossword-themes.js';

// size: the grid sizes a level offers. floor: lowest word score the fill may use
// (it may relax a little, never below hardFloor). clue: which clue levels to
// prefer (0 easy, 1 medium, 2 hard), like Monday to Saturday.
// Sizes: Mini (5×5), Midi (7×7), 9×9, 11×11 and 13×13. Clues go from easy
// definitions at Basic to the tricky senses and fill-in-the-blanks at Master.
export const CW_TIERS = {
  basic: { name: 'Basic', sizes: [5], floor: 36, hardFloor: 26, clue: [0, 0, 1], theme: false },
  easy: { name: 'Easy', sizes: [5, 7], floor: 32, hardFloor: 22, clue: [0, 0, 1], theme: false },
  medium: { name: 'Medium', sizes: [7, 9], floor: 28, hardFloor: 18, clue: [0, 1, 1], theme: true },
  hard: { name: 'Hard', sizes: [9, 11], floor: 24, hardFloor: 16, clue: [1, 1, 2], theme: true },
  expert: { name: 'Expert', sizes: [11, 13], floor: 22, hardFloor: 14, clue: [1, 2, 2], theme: true },
  master: { name: 'Master', sizes: [13], floor: 18, hardFloor: 12, clue: [2, 2, 1], theme: true },
};
// Fill below the level's word-score floor is allowed only now and then, so a
// grid can close up: at most this share of its answers.
export const LOW_SHARE = 0.12;
export const CW_SIZES = [5, 7, 9, 11, 13];

// The NYT's limits and ours (we keep a little under them).
export function limitsFor(N) {
  const nytWords = { 15: 78, 21: 140 }[N];
  const maxWords = N >= 21 ? 140 : N >= 15 ? 78 : N >= 13 ? 64 : N >= 11 ? 48 : N >= 9 ? 34 : N >= 7 ? 22 : 12;
  return {
    maxWords, nytWords,
    maxBlocks: Math.floor((N * N) / 6),
    minBlocks: { 5: 2, 7: 6, 9: 10, 11: 16, 13: 22, 15: 30, 21: 62 }[N] ?? Math.round(N * N * 0.12),
    // Longest non-theme answer the grid may have (long open runs are hard to fill well).
    maxRun: N <= 7 ? N : N <= 9 ? 7 : N <= 11 ? 8 : 9,
  };
}

export const CW_TECHNIQUES = {
  easy: { level: 1, name: 'Start with an easy clue' },
  crossing: { level: 2, name: 'Use the crossing letters' },
  theme: { level: 3, name: 'Crack the theme' },
  tough: { level: 4, name: 'A tricky clue' },
};

// ---------- the dictionary ----------

let LEX = null;
function lex() {
  if (LEX) return LEX;
  const byLen = new Map(), info = new Map();
  const rows = WORDS.split('\n').map((line) => line.split('\t')).filter((r) => r[0]);
  // Best words first within each length, so the filler meets them first.
  rows.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [ans, score, phrase, proper, clues] of rows) {
    const L = ans.length;
    let b = byLen.get(L);
    if (!b) byLen.set(L, (b = { words: [], score: [], proper: [] }));
    b.words.push(ans);
    b.score.push(Number(score));
    b.proper.push(proper === '1');
    info.set(ans, { score: Number(score), phrase, proper: proper === '1', raw: clues });
  }
  // A bit set per (position, letter): which words of this length have that letter there.
  for (const [L, b] of byLen) {
    const n = b.words.length, W = (n + 31) >>> 5;
    b.W = W;
    b.bits = Array.from({ length: L * 26 }, () => new Uint32Array(W));
    b.words.forEach((w, k) => {
      for (let p = 0; p < L; p++) b.bits[p * 26 + w.charCodeAt(p) - 65][k >>> 5] |= 1 << (k & 31);
    });
    b.score = Uint8Array.from(b.score);
  }
  LEX = { byLen, info };
  return LEX;
}

// Every clue the dictionary has for an answer: { text, level, kind }.
export function cluesFor(ans) {
  const e = lex().info.get(ans);
  if (!e) return [];
  if (!e.clues) {
    e.clues = e.raw.split('|').filter(Boolean).map((c) => {
      const k = c.lastIndexOf('~');
      return { text: c.slice(0, k), level: Number(c[k + 1]), kind: { d: 'definition', s: 'same meaning', k: 'kind of', f: 'fill in the blank' }[c[k + 2]] || 'clue' };
    });
  }
  return e.clues;
}
export const isAnswer = (ans) => lex().info.has(ans);
export const answerInfo = (ans) => lex().info.get(ans) || null;

const popcount = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

// ---------- word roots: no two answers may share one ----------

const tokensOf = (ans) => {
  const e = lex().info.get(ans);
  return e && e.phrase ? e.phrase.toUpperCase().split(/[^A-Z]+/).filter((t) => t.length >= 3) : [ans];
};
function sameRoot(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 4 && l.includes(s)) return true;
  let p = 0;
  while (p < s.length && a[p] === b[p]) p++;
  return p >= 5 || (p >= 4 && s.length <= 5);
}
function clashes(ans, usedTokens) {
  for (const t of tokensOf(ans)) for (const u of usedTokens) if (sameRoot(t, u)) return true;
  return false;
}

// ---------- the grid ----------

// A grid is an array of N*N cells: '#' black, '' open, or a fixed letter.
function slotsOf(N, g) {
  const across = [], down = [];
  for (let r = 0; r < N; r++) {
    let c = 0;
    while (c < N) {
      if (g[r * N + c] === '#') { c++; continue; }
      const cells = [];
      while (c < N && g[r * N + c] !== '#') cells.push(r * N + c++);
      across.push({ dir: 'A', cells });
    }
  }
  for (let c = 0; c < N; c++) {
    let r = 0;
    while (r < N) {
      if (g[r * N + c] === '#') { r++; continue; }
      const cells = [];
      while (r < N && g[r * N + c] !== '#') cells.push(r++ * N + c);
      down.push({ dir: 'D', cells });
    }
  }
  return { across, down };
}

function connected(N, g) {
  const open = [];
  for (let i = 0; i < N * N; i++) if (g[i] !== '#') open.push(i);
  if (!open.length) return false;
  const seen = new Uint8Array(N * N), q = [open[0]];
  seen[open[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], r = Math.floor(i / N), c = i % N;
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const j = rr * N + cc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && !seen[j] && g[j] !== '#') { seen[j] = 1; q.push(j); }
    }
  }
  return q.length === open.length;
}

const mirror = (N, i) => N * N - 1 - i;

// No open run of 1 or 2 squares in the row and column through cell i.
function shortRunAround(N, g, i) {
  const r = Math.floor(i / N), c = i % N;
  const runs = [];
  const runAt = (cells) => { let n = 0; for (const x of cells) { if (g[x] === '#') { if (n) runs.push(n); n = 0; } else n++; } if (n) runs.push(n); };
  runAt([...Array(N)].map((_, k) => r * N + k));
  runAt([...Array(N)].map((_, k) => k * N + c));
  return runs.some((n) => n < 3);
}
function twoByTwo(N, g, i) {
  const r = Math.floor(i / N), c = i % N;
  for (const [dr, dc] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const r0 = r + dr, c0 = c + dc;
    if (r0 < 0 || c0 < 0 || r0 + 1 >= N || c0 + 1 >= N) continue;
    if ([r0 * N + c0, r0 * N + c0 + 1, (r0 + 1) * N + c0, (r0 + 1) * N + c0 + 1].every((x) => g[x] === '#')) return true;
  }
  return false;
}

// Black out cell i and its mirror, if the grid still keeps every rule. Near
// an edge, the black square runs out to the edge ("a bar"), as real grids do,
// so no 1- or 2-letter run is left between it and the edge.
function tryBlock(N, g, i, bar = true) {
  const r = Math.floor(i / N), c = i % N;
  const set = new Set([i]);
  if (bar) {
    if (r < 3) for (let k = 0; k < r; k++) set.add(k * N + c);
    if (r > N - 4) for (let k = r + 1; k < N; k++) set.add(k * N + c);
    if (c < 3) for (let k = 0; k < c; k++) set.add(r * N + k);
    if (c > N - 4) for (let k = c + 1; k < N; k++) set.add(r * N + k);
  }
  for (const x of [...set]) set.add(mirror(N, x));
  const cells = [...set];
  if (cells.some((x) => g[x] !== '' && g[x] !== '#')) return false;
  const was = cells.map((x) => g[x]);
  cells.forEach((x) => { g[x] = '#'; });
  const ok = cells.every((x) => !shortRunAround(N, g, x) && !twoByTwo(N, g, x));
  if (!ok) cells.forEach((x, k) => { g[x] = was[k]; });
  return ok;
}

// A symmetric pattern of black squares around the theme answers.
export function makeTemplate(N, theme, rng, lim) {
  const g = Array(N * N).fill('');
  for (const t of theme) {
    t.cells.forEach((x, k) => { g[x] = t.answer[k]; });
    const r = Math.floor(t.cells[0] / N), c0 = t.cells[0] % N, c1 = c0 + t.answer.length - 1;
    for (const x of [c0 > 0 ? r * N + c0 - 1 : -1, c1 < N - 1 ? r * N + c1 + 1 : -1]) {
      if (x < 0) continue;
      // The black square at each end; near the top or bottom edge it runs
      // out to the edge, so no 1- or 2-letter run is left above or below it.
      const cells = [x];
      const rr = Math.floor(x / N), cc = x % N;
      if (rr < 3) for (let k = 0; k < rr; k++) cells.push(k * N + cc);
      if (rr > N - 4) for (let k = rr + 1; k < N; k++) cells.push(k * N + cc);
      for (const y of cells) {
        if (g[y] !== '' && g[y] !== '#') return null;
        g[y] = '#'; g[mirror(N, y)] = '#';
      }
    }
  }
  for (let i = 0; i < N * N; i++) if (g[i] === '#' && (shortRunAround(N, g, i))) return null;
  const openRuns = () => {
    const { across, down } = slotsOf(N, g);
    return [...across, ...down].filter((s) => s.cells.length > lim.maxRun && !s.cells.every((x) => g[x] !== ''));
  };
  // Break up runs that are too long. A run that cannot be split right now
  // may become splittable after others are, so it waits its turn.
  const stuck = new Set();
  for (let guard = 0; guard < 600; guard++) {
    const long = openRuns();
    if (!long.length) break;
    const free = long.filter((r) => !stuck.has(`${r.dir}${r.cells[0]}`));
    // Nothing left to split: a run a little long is fine, one much longer is not.
    if (!free.length) { if (long.every((r) => r.cells.length <= lim.maxRun + 2)) break; return null; }
    const s = rng.pick(free);
    const L = s.cells.length;
    // Split it in the middle part, or failing that trim an end.
    const spots = [...rng.shuffle(s.cells.slice(3, L - 3)), ...rng.shuffle([s.cells[0], s.cells[L - 1]])];
    let done = false;
    for (const x of spots) {
      const save = g.slice();
      if (!tryBlock(N, g, x)) continue;
      if (connected(N, g)) { done = true; break; }
      save.forEach((v, i) => { g[i] = v; });
    }
    if (done) stuck.clear(); else stuck.add(`${s.dir}${s.cells[0]}`);
  }
  // Then add a few more, for a lively look and a fillable grid, up to the level's count.
  const blocks = () => g.filter((v) => v === '#').length;
  // Toward the top of the range: shorter answers fill with better words.
  const want = lim.minBlocks + Math.round((lim.maxBlocks - lim.minBlocks) * (0.6 + rng.next() * 0.4));
  for (let guard = 0; guard < 200 && blocks() < want; guard++) {
    const save = g.slice();
    if (tryBlock(N, g, rng.int(N * N)) && (!connected(N, g) || blocks() > lim.maxBlocks)) save.forEach((v, i) => { g[i] = v; });
  }
  if (blocks() > lim.maxBlocks || !connected(N, g)) return null;
  const { across, down } = slotsOf(N, g);
  if (across.length + down.length > lim.maxWords) return null;
  if ([...across, ...down].some((s) => s.cells.length < 3)) return null;
  return g;
}

// ---------- filling the grid ----------
//
// Each slot keeps the set of dictionary words that still fit (a bit set), and
// each square keeps the letters still possible there. Placing a word narrows
// the crossing slots, which narrows their squares, and so on (arc
// consistency), so dead ends show up at once instead of many steps later. The
// slot with the fewest words left goes next; better words are tried first,
// with some seeded randomness so every seed gives a different grid.

const FULL = (1 << 26) - 1;
const lettersOf = (m) => { const out = []; while (m) { const low = m & -m; out.push(31 - Math.clz32(low)); m ^= low; } return out; };
const countBits = (bits) => { let n = 0; for (let k = 0; k < bits.length; k++) if (bits[k]) n += popcount(bits[k]); return n; };

// The words allowed in a puzzle (score floor, names or not), as a small index
// of their own: fewer words means faster bit sets. Kept between tries.
const POOLS = new Map();
function poolFor(L, floor, allowProper) {
  const key = `${L}:${floor}:${allowProper ? 1 : 0}`;
  let pool = POOLS.get(key);
  if (pool) return pool;
  const b = lex().byLen.get(L);
  if (!b) return null;
  const words = [], score = [];
  for (let k = 0; k < b.words.length; k++) if (b.score[k] >= floor && (allowProper || !b.proper[k] || b.score[k] >= 60)) { words.push(b.words[k]); score.push(b.score[k]); }
  const n = words.length, W = (n + 31) >>> 5;
  const bits = Array.from({ length: L * 26 }, () => new Uint32Array(W));
  words.forEach((w, k) => { for (let p = 0; p < L; p++) bits[p * 26 + w.charCodeAt(p) - 65][k >>> 5] |= 1 << (k & 31); });
  const all = new Uint32Array(W);
  for (let k = 0; k < n; k++) all[k >>> 5] |= 1 << (k & 31);
  pool = { words, score, bits, W, all };
  if (POOLS.size > 80) POOLS.clear();
  POOLS.set(key, pool);
  return pool;
}

function fill(N, g, rng, { floor, prefer = floor, allowProper, budget, used0 = [] }) {
  const { across, down } = slotsOf(N, g);
  const slots = [...across, ...down];
  const S = slots.length;
  // Which slots pass through each square, and at which position.
  const at = Array.from({ length: N * N }, () => []);
  slots.forEach((s, k) => s.cells.forEach((x, p) => at[x].push(k)));
  const bOf = slots.map((s) => poolFor(s.cells.length, floor, allowProper));
  if (bOf.some((b) => !b || !b.words.length)) return null;
  const dom = slots.map((s, k) => bOf[k].all.slice());
  const mask = new Int32Array(N * N);
  for (let i = 0; i < N * N; i++) mask[i] = g[i] === '#' ? 0 : g[i] ? 1 << (g[i].charCodeAt(0) - 65) : FULL;
  // What each slot last saw at each of its squares, so unchanged squares are skipped.
  const seen = slots.map((s) => new Int32Array(s.cells.length).fill(-1));
  const words = Array(S).fill(null);
  const usedWords = new Set(used0);
  const usedTokens = used0.flatMap((w) => tokensOf(w));
  const tmp = new Uint32Array(Math.max(...bOf.map((b) => b.W)));
  // Undo trail: copies of what changed, taken the first time it changes at each step.
  const trail = [];
  let stamp = 1;
  const domStamp = new Int32Array(S), seenStamp = new Int32Array(S);
  const keepDom = (k) => { if (domStamp[k] !== stamp) { trail.push(0, k, dom[k].slice(), domStamp[k]); domStamp[k] = stamp; } };
  const keepSeen = (k) => { if (seenStamp[k] !== stamp) { trail.push(1, k, seen[k].slice(), seenStamp[k]); seenStamp[k] = stamp; } };
  const keepMask = (x) => { trail.push(2, x, mask[x], 0); };
  function undoTo(len) {
    while (trail.length > len) {
      const old = trail.pop(), v = trail.pop(), k = trail.pop(), kind = trail.pop();
      if (kind === 0) { dom[k] = v; domStamp[k] = old; } else if (kind === 1) { seen[k] = v; seenStamp[k] = old; } else mask[k] = v;
    }
  }

  function revise(k, changed) {
    const s = slots[k], b = bOf[k], W = b.W, L = s.cells.length;
    let sk = seen[k], touched = false;
    for (let p = 0; p < L; p++) {
      const m = mask[s.cells[p]];
      if (m === sk[p]) continue;
      if (!touched) { keepSeen(k); keepDom(k); sk = seen[k]; touched = true; }
      sk[p] = m;
      if (m === FULL) continue;
      const d = dom[k];
      const ls = lettersOf(m);
      if (ls.length === 1) {
        const bits = b.bits[p * 26 + ls[0]];
        for (let w = 0; w < W; w++) d[w] &= bits[w];
      } else if (ls.length <= 4) {
        // A few letters left: keep only words with one of them here. (With
        // more letters left this check costs more than it saves.)
        tmp.fill(0, 0, W);
        for (const l of ls) { const bits = b.bits[p * 26 + l]; for (let w = 0; w < W; w++) tmp[w] |= bits[w]; }
        for (let w = 0; w < W; w++) d[w] &= tmp[w];
      } else if (ls.length >= 23) {
        // Only a few letters ruled out: take those words away.
        for (const l of lettersOf(FULL & ~m)) { const bits = b.bits[p * 26 + l]; for (let w = 0; w < W; w++) d[w] &= ~bits[w]; }
      }
    }
    if (!touched) return true;
    const d = dom[k];
    let any = 0;
    for (let w = 0; w < W; w++) any |= d[w];
    if (!any) return false;
    // The letters each square can still take from this slot's words.
    for (let p = 0; p < L; p++) {
      const x = s.cells[p], m = mask[x];
      if (!(m & (m - 1))) continue; // one letter already
      let sup = 0;
      for (const l of lettersOf(m)) {
        const bits = b.bits[p * 26 + l];
        for (let w = 0; w < W; w++) if (d[w] & bits[w]) { sup |= 1 << l; break; }
      }
      if (sup !== m) {
        if (!sup) return false;
        keepMask(x);
        mask[x] = sup;
        sk[p] = sup;
        changed.push(x);
      }
    }
    return true;
  }
  const inQ = new Uint8Array(S);
  function propagate(queue) {
    inQ.fill(0);
    queue.forEach((k) => { inQ[k] = 1; });
    while (queue.length) {
      const k = queue.pop();
      inQ[k] = 0;
      const changed = [];
      if (!revise(k, changed)) return false;
      for (const x of changed) for (const o of at[x]) if (o !== k && !inQ[o]) { inQ[o] = 1; queue.push(o); }
    }
    return true;
  }
  if (!propagate([...Array(S).keys()])) return null;

  let nodes = 0;
  function search() {
    if (++nodes > budget) return false;
    let best = -1, bestN = Infinity;
    for (let k = 0; k < S; k++) {
      if (words[k]) continue;
      const n = countBits(dom[k]);
      if (n < bestN) { bestN = n; best = k; if (n <= 1) break; }
    }
    if (best < 0) return true;
    const b = bOf[best], s = slots[best];
    const d = dom[best];
    const cands = [];
    for (let w = 0; w < d.length && cands.length < 60; w++) {
      let m = d[w];
      while (m && cands.length < 60) { const low = m & -m; cands.push((w << 5) + 31 - Math.clz32(low)); m ^= low; }
    }
    // Look one step ahead: a word whose letters leave the crossing slots the
    // most words that still fit is tried first ("least constraining").
    const cross = s.cells.map((x, p) => {
      const o = at[x].find((q) => q !== best);
      return o == null || words[o] ? null : { o, q: slots[o].cells.indexOf(x) };
    });
    const support = new Map();
    const room = (p, letter) => {
      const c = cross[p];
      if (!c) return 1 << 12;
      const key = p * 26 + letter;
      let n = support.get(key);
      if (n == null) {
        const d2 = dom[c.o], bits = bOf[c.o].bits[c.q * 26 + letter];
        n = 0;
        for (let w = 0; w < d2.length; w++) { const v = d2[w] & bits[w]; if (v) n += popcount(v); }
        support.set(key, n);
      }
      return n;
    };
    const ranked = [];
    for (const k of cands) {
      const w = b.words[k];
      let sum = 0, ok = true;
      for (let p = 0; p < w.length; p++) { const n = room(p, w.charCodeAt(p) - 65); if (!n) { ok = false; break; } sum += Math.log2(n + 1); }
      // Words under the level's own floor only when they open up the grid a lot.
      if (ok) ranked.push([k, sum * 2.2 / w.length * 4 + b.score[k] * 0.25 - (b.score[k] < prefer ? 14 : 0) + rng.next() * 12]);
    }
    ranked.sort((x, y) => y[1] - x[1]);
    ranked.length = Math.min(ranked.length, 12);
    for (const [k] of ranked) {
      const w = b.words[k];
      if (usedWords.has(w) || clashes(w, usedTokens)) continue;
      const mark = trail.length;
      stamp++;
      keepDom(best);
      dom[best].fill(0);
      dom[best][k >>> 5] = 1 << (k & 31);
      const queue = [];
      s.cells.forEach((x, p) => {
        const m = 1 << (w.charCodeAt(p) - 65);
        if (mask[x] !== m) { keepMask(x); mask[x] = m; }
        for (const o of at[x]) if (o !== best && !queue.includes(o)) queue.push(o);
      });
      words[best] = w; usedWords.add(w);
      const toks = tokensOf(w);
      usedTokens.push(...toks);
      if (propagate(queue) && search()) return true;
      words[best] = null; usedWords.delete(w);
      usedTokens.length -= toks.length;
      undoTo(mark);
      stamp++;
      if (nodes > budget) return false;
    }
    return false;
  }
  if (!search()) return null;
  const grid = g.map((v, i) => (v === '#' ? '#' : String.fromCharCode(65 + lettersOf(mask[i])[0])));
  return { grid, slots, words };
}

// ---------- themes ----------

const PHRASES = new Map();
// Dictionary phrases that fit a theme set's kind, with the theme word in each.
function themeCandidates(set, kind) {
  const key = `${set.id}:${kind}`;
  if (PHRASES.has(key)) return PHRASES.get(key);
  const out = [];
  const members = set.words.map((w) => w.toUpperCase());
  for (const [ans, e] of lex().info) {
    if (!e.phrase || e.proper || e.score < 36 || ans.length < 5) continue;
    const toks = e.phrase.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    if (toks.length < 2) continue;
    if (kind === 'starts' || kind === 'ends') {
      const t = kind === 'starts' ? toks[0] : toks[toks.length - 1];
      if (members.includes(t)) out.push({ answer: ans, member: t, at: kind === 'starts' ? 0 : ans.length - t.length, score: e.score });
      continue;
    }
    // hidden: the word runs across the break between two words of the phrase.
    const breaks = [];
    let pos = 0;
    for (let k = 0; k < toks.length - 1; k++) { pos += toks[k].length; breaks.push(pos); }
    for (const m of members) {
      if (m.length < 4) continue;
      let from = ans.indexOf(m);
      while (from >= 0) {
        if (breaks.some((b) => b > from && b < from + m.length) && !toks.some((t) => t === m || t.includes(m))) {
          out.push({ answer: ans, member: m, at: from, score: e.score });
          break;
        }
        from = ans.indexOf(m, from + 1);
      }
    }
  }
  PHRASES.set(key, out);
  return out;
}

// Where an across answer of length L can start in a row of N squares: the
// space left on each side is none, or a black square and at least 3 letters.
export function startsFor(N, L) {
  const out = [];
  for (let a = 0; a <= N - L; a++) {
    const b = N - L - a;
    if ((a === 0 || a >= 4) && (b === 0 || b >= 4)) out.push(a);
  }
  return out;
}
const centerOk = (N, L) => L % 2 === N % 2 && startsFor(N, L).includes((N - L) / 2);

// Where theme answers go: rows in pairs (row r and its mirror), plus one
// across the middle row when the count is odd. Returns a list of placements.
export function placeTheme(N, picks, rng) {
  const mid = (N - 1) / 2;
  const out = [];
  const pairs = picks.filter((p) => p.pair), center = picks.find((p) => !p.pair);
  const rowsFor = N >= 21 ? [[3, 4], [7]] : N >= 15 ? [[2, 3, 4]] : N >= 13 ? [[2, 3]] : N >= 11 ? [[2, 3]] : [[2]];
  let used = new Set([center ? mid : -9]);
  for (let k = 0; k < pairs.length / 2; k++) {
    const a = pairs[2 * k], b = pairs[2 * k + 1];
    const choices = (rowsFor[k] || rowsFor[rowsFor.length - 1]).filter((r) => ![...used].some((u) => Math.abs(u - r) < 3 || Math.abs(N - 1 - u - r) < 3) && r !== mid);
    if (!choices.length) return null;
    const r = rng.pick(choices);
    used.add(r); used.add(N - 1 - r);
    const L = a.answer.length;
    const starts = startsFor(N, L);
    if (!starts.length) return null;
    const c = rng.pick(starts);
    out.push({ ...a, cells: [...Array(L)].map((_, i) => r * N + c + i) });
    out.push({ ...b, cells: [...Array(L)].map((_, i) => (N - 1 - r) * N + (N - c - L) + i) });
  }
  if (center) {
    const L = center.answer.length, c = (N - L) / 2;
    out.push({ ...center, cells: [...Array(L)].map((_, i) => mid * N + c + i) });
  }
  return out;
}

// Choose the theme: a set from the story theme, a kind, and answers with
// lengths that fit symmetrically. Stronger themes have longer answers, more of
// them, and a different theme word in each.
export function chooseTheme(N, rng, storyTheme) {
  const sets = THEME_SETS.filter((s) => !storyTheme || s.themes.includes(storyTheme));
  const pool = sets.length ? sets : THEME_SETS;
  const tries = [];
  for (const set of rng.shuffle(pool)) for (const kind of rng.shuffle(set.kinds)) tries.push([set, kind]);
  for (const t of THEME_SETS) for (const kind of t.kinds) tries.push([t, kind]);
  for (const [set, kind] of tries) {
    const cands = themeCandidates(set, kind).filter((c) => c.answer.length <= N && c.answer.length >= (N >= 11 ? 7 : 5) && startsFor(N, c.answer.length).length);
    if (cands.length < 3) continue;
    const byLen = new Map();
    for (const c of rng.shuffle(cands)) {
      if (!byLen.has(c.answer.length)) byLen.set(c.answer.length, []);
      byLen.get(c.answer.length).push(c);
    }
    // Pairs need two answers of one length with different theme words.
    const pairLens = [...byLen.keys()].filter((L) => new Set(byLen.get(L).map((c) => c.member)).size >= 2).sort((a, b) => b - a);
    // A third answer across the middle only on grids big enough to fill around three theme rows.
    const centers = N % 2 && N >= 21 ? [...byLen.keys()].filter((L) => centerOk(N, L)) : [];
    const wantPairs = N >= 21 ? 2 : 1;
    const picks = [];
    const usedMembers = new Set(), usedAns = [];
    const take = (c) => { picks.push(c); usedMembers.add(c.member); usedAns.push(c.answer); };
    const fresh = (c) => !usedMembers.has(c.member) && !usedAns.some((a) => tokensOf(a).some((t) => tokensOf(c.answer).some((u) => sameRoot(t, u))));
    // Any length that fits, picked at random (longest first made every puzzle alike).
    for (const L of rng.shuffle(pairLens)) {
      if (picks.length >= 2 * wantPairs) break;
      const list = byLen.get(L).filter(fresh);
      const a = list[0];
      const b = a && list.find((c) => c.member !== a.member && c !== a && fresh(c) && !tokensOf(c.answer).some((t) => tokensOf(a.answer).some((u) => sameRoot(t, u))));
      if (a && b) { take({ ...a, pair: true }); take({ ...b, pair: true }); }
    }
    if (picks.length < 2) continue;
    const cLen = centers.filter((L) => byLen.get(L).some(fresh)).sort((a, b) => b - a)[0];
    if (cLen) take(byLen.get(cLen).find(fresh));

    return { set, kind, picks };
  }
  return null;
}

// ---------- clues ----------

function pickClue(ans, prefs, rng, avoidWords, toughness) {
  // A clue must never give its own answer away.
  const all = cluesFor(ans).filter((c) => !clueGivesAway(c.text, ans));
  // Nor use another answer of this grid ("dupe"), when there is a choice.
  const ok = all.filter((c) => !c.text.toUpperCase().split(/[^A-Z]+/).some((t) => t.length >= 3 && avoidWords.has(t)));
  const list = ok.length ? ok : all;
  const want = prefs[Math.min(prefs.length - 1, Math.floor(clamp01(toughness) * prefs.length))];
  // Short clues read best; the level's own clue difficulty comes first.
  const scored = list.map((c) => ({ c, s: Math.abs(c.level - want) * 10 + Math.min(c.text.length, 90) / 7 + (c.text.split(' ').length > 8 ? 6 : 0) + rng.next() * 3 }));
  scored.sort((a, b) => a.s - b.s);
  return scored[0]?.c || null;
}

// ---------- the story ----------

function storyOf(seed, theme, used, themeInfo) {
  const s = kitThemeStory('cw', seed, { theme, used, classic: () => ({ id: `cw-classic-${String(seed).slice(0, 12)}`, title: 'The Crossword', intro: 'Every square is waiting for its letter.', ending: 'The last word drops into place.' }) });
  if (s && themeInfo) {
    s.intro = `${s.intro} ${themeInfo.storyLine}`;
  }
  return s;
}

// ---------- making a puzzle ----------

const LETTER = (ch) => ch.charCodeAt(0) - 64;

export function generateCrossword({ difficulty = 'medium', size, seed = Math.random().toString(36).slice(2), avoid = [], toughness = 0.5, usedStories = [], story = true, theme = null } = {}) {
  const tier = CW_TIERS[difficulty];
  if (!tier) throw new Error(`Unknown difficulty "${difficulty}".`);
  const N = tier.sizes.includes(Number(size)) ? Number(size) : tier.sizes[0];
  const lim = limitsFor(N);
  const seen = new Set(avoid);
  const t01 = clamp01(toughness);
  const found = [];
  const want = N >= 15 ? 1 : 2;
  // The story theme decides the crossword's theme set ("Surprise me" picks one from the seed).
  const themeRng = makeRng(`${seed}:cw:story-theme`);
  const storyTheme = theme && theme !== 'surprise' ? theme : themeRng.pick(['farm', 'parks', 'nautical', 'cooking', 'music', 'astronomy', 'sports', 'fantasy', 'mystery', 'travel', 'science', 'seasons', 'pets', 'biology', 'math']);
  const budget = N >= 21 ? 1500 : N >= 15 ? 900 : N >= 11 ? 500 : 400;
  const attempts = N >= 13 ? 260 : 300;
  for (let attempt = 0; attempt < attempts && found.length < want; attempt++) {
    const rng = makeRng(`${seed}:cw:${attempt}`);
    let picks = [], themeInfo = null;
    if (tier.theme && N >= 9) {
      const th = chooseTheme(N, rng, storyTheme);
      const placed = th && placeTheme(N, th.picks, rng);
      if (placed) {
        picks = placed;
        themeInfo = { set: th.set, kind: th.kind };
      } else if (attempt < 12) continue; // no theme fits this grid: after a while, a themeless one
    }
    const g = makeTemplate(N, picks, rng, lim);
    if (!g) continue;
    // Relax the word-score floor a little on later tries, never below the level's hard floor.
    const floor = Math.max(tier.hardFloor, tier.floor - Math.floor(attempt / 2) * 4);
    const res = fill(N, g, rng, { floor, prefer: tier.floor, allowProper: difficulty !== 'basic', budget });
    if (!res) continue;
    // Only a few answers may come from below the level's own floor.
    const low = res.words.filter((w) => (answerInfo(w)?.score || 0) < tier.floor).length;
    if (low > Math.max(2, Math.round(res.words.length * LOW_SHARE))) continue;
    const fp = fingerprint('cw', res.grid.join(''));
    if (seen.has(fp)) continue;
    const avg = res.words.reduce((s, w) => s + (answerInfo(w)?.score || 0), 0) / res.words.length;
    found.push({ ...res, picks, themeInfo, fp, avg, floor, rng });
  }
  if (!found.length) throw new Error('Could not build a crossword for those options. Try again.');
  // Higher-scoring fill is gentler: toughness picks along that line.
  const pick = pickByToughness(found.map((f) => ({ ...f, score: -f.avg })), t01);
  return buildPuzzle({ N, tier, difficulty, seed, pick, t01, lim, story, theme, storyTheme, usedStories });
}

function buildPuzzle({ N, tier, difficulty, seed, pick, t01, lim, story, theme, storyTheme, usedStories }) {
  const { grid, slots, words, picks, themeInfo } = pick;
  const rng = makeRng(`${seed}:cw:clues`);
  // Number the grid the usual way: left to right, top to bottom.
  const numbers = Array(N * N).fill(0);
  let n = 0;
  for (let i = 0; i < N * N; i++) {
    if (grid[i] === '#') continue;
    const r = Math.floor(i / N), c = i % N;
    const startsA = (c === 0 || grid[i - 1] === '#') && c + 1 < N && grid[i + 1] !== '#';
    const startsD = (r === 0 || grid[i - N] === '#') && r + 1 < N && grid[i + N] !== '#';
    if (startsA || startsD) numbers[i] = ++n;
  }
  const answerTokens = new Set(words.flatMap((w) => tokensOf(w)).concat(words));
  const themeAt = new Map(picks.map((p) => [p.cells[0] + (p.cells.length > 1 && p.cells[1] - p.cells[0] === 1 ? 'A' : 'D'), p]));
  const circles = [];
  const entries = slots.map((s, k) => {
    const ans = words[k];
    const own = new Set([...tokensOf(ans), ans]);
    const avoidWords = new Set([...answerTokens].filter((t) => !own.has(t)));
    const c = pickClue(ans, tier.clue, rng, avoidWords, t01);
    const th = themeAt.get(s.cells[0] + s.dir);
    if (th && themeInfo?.kind === 'hidden') for (let q = 0; q < th.member.length; q++) circles.push(s.cells[th.at + q]);
    return {
      dir: s.dir, n: numbers[s.cells[0]], cells: s.cells, answer: ans,
      clue: (th ? '*' : '') + c.text, clueLevel: c.level, clueKind: c.kind,
      theme: th ? { member: th.member, at: th.at } : null,
    };
  });
  const across = entries.filter((e) => e.dir === 'A').sort((a, b) => a.n - b.n);
  const down = entries.filter((e) => e.dir === 'D').sort((a, b) => a.n - b.n);
  // A solving order a person might take: easy clues first, then answers with the most crossing help.
  const solvePath = [];
  const done = new Set();
  const order = entries.slice();
  while (order.length) {
    order.sort((a, b) => {
      const help = (e) => e.cells.filter((x) => done.has(x)).length / e.cells.length;
      return (a.clueLevel - help(a) * 2.5) - (b.clueLevel - help(b) * 2.5);
    });
    const e = order.shift();
    const helped = e.cells.filter((x) => done.has(x)).length;
    const technique = e.theme ? 'theme' : e.clueLevel >= 2 ? 'tough' : helped ? 'crossing' : 'easy';
    solvePath.push({
      technique, techniqueName: CW_TECHNIQUES[technique].name,
      marks: e.cells.map((x, q) => [x, LETTER(e.answer[q])]), cells: e.cells,
      why: `${e.n}-${e.dir === 'A' ? 'Across' : 'Down'}: "${e.clue.replace(/^\*/, '')}" is ${e.answer}${helped ? `, with ${helped} of its ${e.cells.length} letters already in from crossing answers` : ''}.${e.theme ? ` It is a theme answer: ${e.theme.member}.` : ''}`,
    });
    e.cells.forEach((x) => done.add(x));
  }
  let themeOut = null;
  if (themeInfo) {
    const set = themeInfo.set;
    const titleWords = set.many.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\b(Of|From|The)\b/g, (w) => w.toLowerCase());
    themeOut = {
      set: set.id, kind: themeInfo.kind,
      title: themeInfo.kind === 'hidden' ? `Hidden ${titleWords}` : themeInfo.kind === 'starts' ? `${titleWords} Up Front` : `${titleWords} at the End`,
      note: themeNote(set, themeInfo.kind),
      members: entries.filter((e) => e.theme).map((e) => e.theme.member),
      storyLine: themeInfo.kind === 'hidden' ? `Somewhere in this grid, ${set.many} are hiding.` : `The starred answers hold the key: ${set.many}.`,
    };
  }
  const p = {
    kind: 'crossword', game: 'cw',
    id: `cw-${N}-${difficulty}-${seed}`, seed,
    difficulty: { id: difficulty, name: KIT_LEVEL_NAMES[difficulty] },
    size: N, cols: N,
    blocks: grid.map((v) => (v === '#' ? 1 : 0)),
    solution: grid.map((v) => (v === '#' ? 0 : LETTER(v))),
    givens: Array(N * N).fill(0),
    numbers, circles: [...new Set(circles)].sort((a, b) => a - b),
    across: across.map(({ dir, ...e }) => e), down: down.map(({ dir, ...e }) => e),
    theme: themeOut,
    solvePath,
    techniques: [...new Set(solvePath.map((s) => s.technique))],
    toughness: Math.round(100 - pick.avg),
    fingerprint: pick.fp,
    rules: [
      'Fill every white square with a letter so each Across and Down answer matches its clue.',
      'Answers of more than one word are written with no spaces. Every answer and clue comes from a real dictionary.',
      ...(themeOut ? [`Theme: ${themeOut.note}`] : []),
    ],
  };
  p.report = checkCrossword(p);
  if (!p.report.ok) throw new Error(`Crossword failed its own check: ${p.report.failed.join('; ')}`);
  if (story) {
    const s = storyOf(seed, theme && theme !== 'surprise' ? theme : storyTheme, usedStories, themeOut);
    if (s) {
      // Story moments as theme answers are found: one per theme answer, saying only what the note already says.
      if (themeOut) s.themeBeats = themeOut.members.map((m, k) => `${k === themeOut.members.length - 1 ? 'The last one' : `Theme answer ${k + 1} of ${themeOut.members.length}`}: ${m.toLowerCase()}!`);
      p.story = s;
    }
  }
  return p;
}

// ---------- the rules check ----------

export function checkCrossword(p) {
  const N = p.size, sol = p.solution, blk = p.blocks;
  const failed = [], passed = [];
  const rule = (ok, text) => (ok ? passed : failed).push(text);
  const g = blk.map((b, i) => (b ? '#' : String.fromCharCode(64 + sol[i])));
  rule(blk.every((b, i) => b === blk[mirror(N, i)]), 'Black squares have rotational symmetry');
  const { across, down } = slotsOf(N, g);
  const all = [...across, ...down];
  rule(all.every((s) => s.cells.length >= 3), 'Every answer has at least 3 letters');
  const inA = new Uint8Array(N * N), inD = new Uint8Array(N * N);
  across.forEach((s) => s.cells.forEach((x) => { inA[x] = 1; }));
  down.forEach((s) => s.cells.forEach((x) => { inD[x] = 1; }));
  rule(g.every((v, i) => v === '#' || (inA[i] && inD[i])), 'Every white square is in an Across and a Down answer');
  rule(connected(N, g), 'All-over interlock: every white square connects');
  const blocks = blk.filter(Boolean).length, lim = limitsFor(N);
  rule(blocks <= lim.maxBlocks, `Black squares: ${blocks} (at most ${lim.maxBlocks})`);
  rule(!blk.some((b, i) => b && twoByTwo(N, g, i)), 'No 2×2 block of black squares');
  rule(all.length <= lim.maxWords, `Word count: ${all.length} (at most ${lim.maxWords}${lim.nytWords ? `; NYT limit ${lim.nytWords}` : ''})`);
  const entries = [...p.across, ...p.down];
  rule(entries.length === all.length, 'Every answer has a clue');
  const answers = entries.map((e) => e.answer);
  rule(new Set(answers).size === answers.length, 'No answer appears twice');
  let rootOk = true;
  for (let a = 0; a < answers.length && rootOk; a++) for (let b = a + 1; b < answers.length; b++) {
    if (tokensOf(answers[a]).some((t) => tokensOf(answers[b]).some((u) => sameRoot(t, u)))) { rootOk = false; break; }
  }
  rule(rootOk, 'No two answers share a word or word root');
  // Accuracy: the grid spells each answer, each answer is in the dictionary, each clue is one of its own.
  rule(entries.every((e) => e.cells.map((x) => g[x]).join('') === e.answer), 'The grid spells every answer');
  rule(entries.every((e) => isAnswer(e.answer)), 'Every answer is a real dictionary answer');
  rule(entries.every((e) => cluesFor(e.answer).some((c) => c.text === e.clue.replace(/^\*/, ''))), "Every clue is one of its answer's own dictionary clues");
  rule(entries.every((e) => !clueGivesAway(e.clue, e.answer)), 'No clue gives its answer away');
  if (p.theme) {
    const th = entries.filter((e) => e.theme);
    const set = THEME_SETS.find((s) => s.id === p.theme.set);
    const members = new Set((set?.words || []).map((w) => w.toUpperCase()));
    rule(th.length >= 2 && th.every((e) => members.has(e.theme.member) && e.answer.slice(e.theme.at, e.theme.at + e.theme.member.length) === e.theme.member), 'Every theme answer fits the theme exactly');
    rule(new Set(th.map((e) => e.theme.member)).size === th.length, 'Every theme answer uses a different theme word');
    const cellsOf = new Set(th.flatMap((e) => e.cells));
    rule(th.every((e) => e.cells.every((x) => cellsOf.has(mirror(N, x)))), 'Theme answers are placed symmetrically');
  }
  return { ok: !failed.length, failed, passed, words: all.length, blocks, avgLength: +(entries.reduce((s, e) => s + e.answer.length, 0) / entries.length).toFixed(2), avgScore: Math.round(entries.reduce((s, e) => s + (answerInfo(e.answer)?.score || 0), 0) / entries.length) };
}

function clueGivesAway(clue, ans) {
  const toks = clue.replace(/^\*/, '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  return toks.some((t) => tokensOf(ans).some((a) => t.length >= 3 && sameRoot(t, a)));
}

// ---------- checking and hints ----------

export function checkCrosswordEntries(p, entries = []) {
  const wrong = [];
  entries.forEach((v, i) => { if (v && !p.blocks[i] && v !== p.solution[i]) wrong.push(i); });
  return { wrong, solved: p.solution.every((v, i) => p.blocks[i] || entries[i] === v) };
}

const dirName = (e, p) => (p.across.includes(e) ? 'Across' : 'Down');
const L2 = (v) => String.fromCharCode(64 + v);

export function getCrosswordHint(p, entries = []) {
  const N = p.size;
  const { wrong, solved } = checkCrosswordEntries(p, entries);
  const where = (i) => `row ${Math.floor(i / N) + 1}, column ${(i % N) + 1}`;
  if (wrong.length) {
    const w = wrong[0];
    return { kind: 'mistake', cells: wrong, levels: [`${wrong.length === 1 ? 'One letter is' : `${wrong.length} letters are`} wrong.`, `Check ${where(w)}.`, `The letter at ${where(w)} should be ${L2(p.solution[w])}.`] };
  }
  if (solved) return { kind: 'done', levels: ['Every answer is in.'] };
  // The answer that is easiest now: most crossing letters in, then the easier clue.
  const all = [...p.across, ...p.down].filter((e) => e.cells.some((x) => entries[x] !== p.solution[x]));
  const helpOf = (e) => e.cells.filter((x) => entries[x] === p.solution[x]).length / e.cells.length;
  all.sort((a, b) => (b.theme ? 0 : 0) + (helpOf(b) * 3 - b.clueLevel) - (helpOf(a) * 3 - a.clueLevel));
  const e = all[0];
  const missing = e.cells.filter((x) => entries[x] !== p.solution[x]);
  const cell = missing[0];
  const dir = dirName(e, p);
  const have = e.cells.length - missing.length;
  const technique = e.theme ? 'theme' : have ? 'crossing' : e.clueLevel >= 2 ? 'tough' : 'easy';
  return {
    kind: 'step', technique, techniqueName: CW_TECHNIQUES[technique].name,
    cell, digit: p.solution[cell], marks: [[cell, p.solution[cell]]], cells: e.cells,
    levels: [
      `Try ${e.n}-${dir}: "${e.clue.replace(/^\*/, '')}" (${e.cells.length} letters${have ? `, ${have} already in` : ''}).${e.theme && p.theme ? ` It is a theme answer: ${p.theme.note}` : ''}`,
      `It starts at ${where(e.cells[0])}${have ? '. Use the letters you have from the crossing answers' : ''}.`,
      `The letter at ${where(cell)} is ${L2(p.solution[cell])}.`,
    ],
  };
}
