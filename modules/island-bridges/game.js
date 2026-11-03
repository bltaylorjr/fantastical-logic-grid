// Island Bridges' definition for the shared game screen (modules/grid-kit/kit.js),
// a line game (kind 'edges', see grid-kit/lines.js). The marks are the links:
// pairs of islands that can see each other across open water, in reading
// order. Values: 1 or 2 bridges, 3 crossed (no bridge), 0 nothing yet.
import { cleanStory } from '../grid-kit/story.js';
const SIZES = [7, 9, 10, 11, 12, 13, 15];

export function ibLinks(R, C, islands) {
  const at = new Map(islands.map((s, i) => [s.r * C + s.c, i]));
  const links = [];
  islands.forEach((s, a) => {
    for (let c = s.c + 1; c < C; c++) { const b = at.get(s.r * C + c); if (b !== undefined) { links.push({ a, b, dir: 'h' }); break; } }
    for (let r = s.r + 1; r < R; r++) { const b = at.get(r * C + s.c); if (b !== undefined) { links.push({ a, b, dir: 'v' }); break; } }
  });
  return links;
}
const cache = new WeakMap();
function info(p) {
  let x = cache.get(p);
  if (x) return x;
  const inc = p.islands.map(() => []);
  p.links.forEach((l, e) => { inc[l.a].push(e); inc[l.b].push(e); });
  const at = new Map(p.islands.map((s, i) => [s.r * p.cols + s.c, i]));
  x = { inc, at };
  cache.set(p, x);
  return x;
}
const islText = (s) => `the ${s.n} at row ${s.r + 1}, column ${s.c + 1}`;
const other = (l, i) => (l.a === i ? l.b : l.a);
const count = (v) => (v === 1 || v === 2 ? v : 0);
const isWrong = (s, v) => (v === 3 ? s !== 3 : v === 1 || v === 2 ? s === 3 || v > s : false);
// The direction of a link seen from one of its islands: 0 up, 1 right, 2 down, 3 left.
const dirFrom = (l, i) => (l.dir === 'h' ? (l.a === i ? 1 : 3) : (l.a === i ? 2 : 0));
const linkFrom = (p, i, dir) => info(p).inc[i].find((e) => dirFrom(p.links[e], i) === dir) ?? -1;

// Keyboard: one island is chosen (ringed). An arrow picks its bridge that way;
// the same arrow again moves on to the island at the other end.
const walk = { at: -1, isl: -1 };
const anchorOf = (p, e) => (walk.at === e && (p.links[e].a === walk.isl || p.links[e].b === walk.isl) ? walk.isl : p.links[e].a);

function joined(p, sol) {
  const parent = p.islands.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
  p.links.forEach((l, e) => { if (sol[e] !== 3) { const a = find(l.a), b = find(l.b); if (a !== b) parent[a] = b; } });
  const r = find(0);
  return p.islands.every((_, i) => find(i) === r);
}
function crossing(p, sol) {
  const I = p.islands;
  for (let e = 0; e < p.links.length; e++) {
    const h = p.links[e];
    if (h.dir !== 'h' || sol[e] === 3) continue;
    for (let f = 0; f < p.links.length; f++) {
      const v = p.links[f];
      if (v.dir !== 'v' || sol[f] === 3) continue;
      const r = I[h.a].r, c = I[v.a].c;
      if (I[v.a].r < r && r < I[v.b].r && I[h.a].c < c && c < I[h.b].c) return true;
    }
  }
  return false;
}

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '7×7 maps to learn on', sizes: [7] },
  { id: 'easy', name: 'Easy', note: 'Islands that need every bridge', sizes: [7, 9] },
  { id: 'medium', name: 'Medium', note: 'Don\'t close off a group', sizes: [9, 10] },
  { id: 'hard', name: 'Hard', note: 'Bigger maps', sizes: [11, 12] },
  { id: 'expert', name: 'Expert', note: 'Groups that must reach out', sizes: [13, 12] },
  { id: 'master', name: 'Master', note: 'Up to 15×15, follow it through', sizes: [15, 13] },
];

export const def = {
  id: 'ib',
  name: 'Island Bridges',
  kind: 'edges',
  boardRole: 'application',
  itemRole: 'button',
  maxValue: 3,
  dragDraws: false,
  eyebrow: 'The Logic Grid · Line puzzles',
  lede: 'Join every island with straight bridges so each one has as many as its number, and all of them end up in one group. Every puzzle is proven to have one answer you can reach by logic alone, never repeats, and is tuned to how you play.',
  boardHelp: 'Arrow keys choose a bridge, Space adds one, X crosses it out.',
  keysHelp: 'One island is ringed. An arrow picks its bridge that way; the same arrow again moves on to the next island. Space, Enter or F adds a bridge (one, two, then none again), X crosses a gap out. H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  penNames: ['Bridge', 'Cross'],
  penHelp: 'Tap the water between two islands, or drag from one island to the other, to add a bridge. Tap again for a second bridge, and once more to clear.',
  autoCrossLabel: 'Cross out the spare gaps of a finished island',
  highlightLabel: 'Highlight the other bridges of the islands I am on',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 90e3, easy: 180e3, medium: 360e3, hard: 600e3, expert: 900e3, master: 1500e3 },
  simpleTechniques: ['cross', 'full', 'room', 'only'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} Island Bridges`,
  coach: [
    'Tap the water between two islands to build a bridge. Tap again for a double bridge, and once more to take it away.',
    'Each island needs exactly its number of bridges. Bridges go straight across or down and never cross.',
    'Start with islands that have few neighbours: a 4 with only two neighbours needs a double bridge to each.',
    'Stuck? Hint shows an island you can work on now, and why.',
  ],
  badges: [
    { id: 'ib-big', name: 'Bridge builder', note: 'Solve a 13×13 or bigger Island Bridges', test: (s) => s.solved.some((r) => r.size >= 13) },
    { id: 'ib-quick', name: 'Quick crossing', note: 'Solve a 9×9 in under 4 minutes', test: (s) => s.solved.some((r) => r.size === 9 && r.ms < 240e3) },
  ],
  count: (p) => p.links.length,
  playable: () => true,
  nextValue: (p, i, v, pen) => (pen === 2 ? (v === 3 ? 0 : 3) : v === 1 ? 2 : v === 2 ? 0 : 1),
  valueName: (p, v) => (v === 1 ? 'one bridge' : v === 2 ? 'two bridges' : v === 3 ? 'crossed out' : 'no bridge yet'),
  wrongValue: (p, i, v) => isWrong(p.solution[i], v),
  solvedBy: (p, vals) => p.solution.every((s, e) => (s === 3 ? !vals[e] || vals[e] === 3 : vals[e] === s)),
  revealValue: (p, i, v) => (p.solution[i] === 3 ? (v === 3 ? 3 : 0) : p.solution[i]),
  progress(p, value) {
    let need = 0, have = 0;
    p.solution.forEach((s, e) => { if (s !== 3) { need += s; have += Math.min(s, count(value(e))); } });
    return need ? have / need : 0;
  },
  leftCount(p, value) {
    let n = 0;
    p.solution.forEach((s, e) => { if (s !== 3) n += Math.max(0, s - count(value(e))); });
    return n;
  },
  leftWord: 'bridge',
  cellLabel(p, e) {
    const l = p.links[e], from = anchorOf(p, e), to = other(l, from);
    const words = ['above it', 'to its right', 'below it', 'to its left'][dirFrom(l, from)];
    return `From ${islText(p.islands[from])}, the gap to ${islText(p.islands[to])} ${words}`;
  },
  peers(p, e) {
    const { inc } = info(p), l = p.links[e];
    return [...new Set([...inc[l.a], ...inc[l.b]])].filter((x) => x !== e);
  },
  move(p, e, dr, dc) {
    const dir = dr < 0 ? 0 : dc > 0 ? 1 : dr > 0 ? 2 : 3;
    const from = anchorOf(p, e), l = p.links[e];
    if (dirFrom(l, from) === dir) {
      const to = other(l, from);
      const next = linkFrom(p, to, dir);
      walk.isl = to;
      walk.at = next >= 0 ? next : e;
      return walk.at;
    }
    const next = linkFrom(p, from, dir);
    if (next < 0) return -1;
    walk.isl = from;
    walk.at = next;
    return next;
  },
  autoMarks(p, vals, changed) {
    const { inc } = info(p), out = [];
    const isl = new Set(changed.flatMap((e) => [p.links[e].a, p.links[e].b]));
    for (const i of isl) {
      if (inc[i].reduce((s, e) => s + count(vals[e]), 0) !== p.islands[i].n) continue;
      for (const e of inc[i]) if (!vals[e]) out.push([e, 3]);
    }
    return out;
  },
  hit(p, fx, fy) {
    const R = p.size, C = p.cols;
    const x = fx * C - 0.5, y = fy * R - 0.5;
    const r = Math.round(y), c = Math.round(x);
    const isl = info(p).at.get(r * C + c);
    if (isl !== undefined && Math.hypot(x - c, y - r) < 0.45) return { edge: -1, node: isl, near: isl };
    let best = -1, bd = 0.5;
    p.links.forEach((l, e) => {
      const A = p.islands[l.a], B = p.islands[l.b];
      const d = l.dir === 'h' ? (x > A.c && x < B.c ? Math.abs(y - A.r) : 9) : (y > A.r && y < B.r ? Math.abs(x - A.c) : 9);
      if (d < bd) { bd = d; best = e; }
    });
    return { edge: best, node: -1, near: -1 };
  },
  path(p, a, b) {
    const e = info(p).inc[a].find((x) => other(p.links[x], a) === b);
    return e === undefined ? null : [e];
  },
  buildBoard(el, p) {
    const R = p.size, C = p.cols, ux = 100 / C, uy = 100 / R;
    el.style.setProperty('--n', R);
    el.style.setProperty('--c', C);
    let html = '';
    p.links.forEach((l, e) => {
      const A = p.islands[l.a], B = p.islands[l.b];
      html += l.dir === 'h'
        ? `<div class="ln-e h" data-i="${e}" data-v="0" style="left:${(A.c + 0.5) * ux}%;top:${(A.r + 0.5) * uy}%;width:${(B.c - A.c) * ux}%;height:${uy * 0.5}%"></div>`
        : `<div class="ln-e v" data-i="${e}" data-v="0" style="left:${(A.c + 0.5) * ux}%;top:${(A.r + 0.5) * uy}%;width:${ux * 0.5}%;height:${(B.r - A.r) * uy}%"></div>`;
    });
    p.islands.forEach((s, i) => { html += `<span class="ib-isl" data-isl="${i}" style="left:${(s.c + 0.5) * ux}%;top:${(s.r + 0.5) * uy}%" aria-hidden="true">${s.n}</span>`; });
    el.innerHTML = html;
  },
  // A finished island fills in; one with too many bridges turns red. The ring
  // shows the island the arrow keys work from.
  paint(board, { p, value, sel }) {
    const { inc } = info(p);
    const anchor = sel >= 0 && sel < p.links.length ? anchorOf(p, sel) : -1;
    for (const el of board.querySelectorAll('.ib-isl')) {
      const i = Number(el.dataset.isl);
      const have = inc[i].reduce((s, e) => s + count(value(e)), 0);
      el.classList.toggle('done', have === p.islands[i].n);
      el.classList.toggle('over', have > p.islands[i].n);
      el.classList.toggle('anchor', i === anchor);
    }
  },
  shareCells(p) {
    const out = Array(p.size * p.cols).fill(0);
    for (const s of p.islands) out[s.r * p.cols + s.c] = 2;
    return out;
  },
  printCss: 'svg.ib { display: block; margin: 0 auto; } svg.ib text { font: 700 4.6px "Atkinson Hyperlegible", system-ui, sans-serif; fill: #000; }',
  printBoard(p, values) {
    const R = p.size, C = p.cols, mm = R <= 7 ? 22 : R <= 10 ? 16 : R <= 13 ? 12.5 : 11;
    let svg = `<svg class="ib" viewBox="0 0 ${C * 10} ${R * 10}" width="${C * mm}mm" height="${R * mm}mm" xmlns="http://www.w3.org/2000/svg">`;
    p.links.forEach((l, e) => {
      const A = p.islands[l.a], B = p.islands[l.b], v = values[e];
      const x1 = A.c * 10 + 5, y1 = A.r * 10 + 5, x2 = B.c * 10 + 5, y2 = B.r * 10 + 5;
      const off = l.dir === 'h' ? [0, 1] : [1, 0];
      const line = (k) => `<line x1="${x1 + off[0] * k}" y1="${y1 + off[1] * k}" x2="${x2 + off[0] * k}" y2="${y2 + off[1] * k}" stroke="#000" stroke-width=".6"/>`;
      if (v === 1) svg += line(0);
      if (v === 2) svg += line(-1.1) + line(1.1);
    });
    for (const s of p.islands) svg += `<circle cx="${s.c * 10 + 5}" cy="${s.r * 10 + 5}" r="3.7" fill="#fff" stroke="#000" stroke-width=".6"/><text x="${s.c * 10 + 5}" y="${s.r * 10 + 6.6}" text-anchor="middle">${s.n}</text>`;
    return `${svg}</svg>`;
  },
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const R = Number(p.size), C = Number(p.cols);
    if (!SIZES.includes(R) || C !== R || !Array.isArray(p.islands) || p.islands.length < 2 || p.islands.length > R * C) return null;
    const islands = p.islands.map((s) => ({ r: Number(s?.r), c: Number(s?.c), n: Number(s?.n) }));
    let last = -1;
    for (const s of islands) {
      if (![s.r, s.c, s.n].every(Number.isInteger) || s.r < 0 || s.c < 0 || s.r >= R || s.c >= C || s.n < 1 || s.n > 8) return null;
      const k = s.r * C + s.c;
      if (k <= last) return null;
      last = k;
    }
    const links = ibLinks(R, C, islands);
    if (!Array.isArray(p.solution) || p.solution.length !== links.length) return null;
    const sol = p.solution.map((v) => (v === 1 || v === 2 ? v : 3));
    const q = { size: R, cols: C, islands, links };
    const have = islands.map(() => 0);
    links.forEach((l, e) => { if (sol[e] !== 3) { have[l.a] += sol[e]; have[l.b] += sol[e]; } });
    if (have.some((n, i) => n !== islands[i].n) || crossing(q, sol) || !joined(q, sol)) return null;
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = LEVELS.some((l) => l.id === p.difficulty?.id) ? p.difficulty.id : 'medium';
    const ok = (e) => Number.isInteger(e) && e >= 0 && e < links.length;
    return {
      kind: 'island-bridges', game: 'ib', id: str(p.id, 80), seed: str(p.seed, 80), size: R, cols: C,
      islands, links, solution: sol, givens: sol.map(() => 0),
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 3000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why, 800),
        marks: Array.isArray(s?.marks) ? s.marks.filter((m) => Array.isArray(m) && ok(m[0]) && [1, 2, 3].includes(m[1])).map((m) => [m[0], m[1]]).slice(0, 60) : [],
        cells: Array.isArray(s?.cells) ? s.cells.filter(ok).slice(0, 60) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: cleanStory(p.story),
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Build bridges between the islands so that each island has exactly as many bridges as its number, and every island is joined into one group.</p>
    <h3>The rules</h3>
    <ul>
      <li>Bridges run straight across or straight down, between two islands that can see each other.</li>
      <li>Two islands can share one bridge or two, never more.</li>
      <li>Bridges never cross each other and never pass over an island.</li>
      <li>When you are done, you can walk from any island to any other.</li>
    </ul>
    <h3>Building</h3>
    <ul>
      <li>Tap the water between two islands, or drag from one to the other: one bridge, then two, then none again.</li>
      <li>Choose the Cross pen to mark a gap that has no bridge. Crosses are optional, but they help.</li>
      <li>An island fills in when it has all its bridges, and turns red if it has too many.</li>
    </ul>
    <h3>Where to start</h3>
    <ol>
      <li>An island whose number is as big as its neighbours allow gets every bridge it can: a 4 with two neighbours has two bridges to each.</li>
      <li>If an island can't make its number without a neighbour, at least one bridge goes there: a 3 with two neighbours has at least one bridge to each.</li>
      <li>Don't close off a group: two 1s can't join each other, and two 2s can't share a double bridge, unless they are the only islands.</li>
    </ol>
    <p>Every puzzle can be solved by logic alone, without guessing. Hint shows an island you can work on now, and why.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>A <b>6</b> sits with neighbours only to its left, right and below.</p>
    <p>Each neighbour takes at most two bridges, so three neighbours give at most 6. The 6 needs all of them: two bridges each way.</p>
    <p>A <b>1</b> next to only another <b>1</b> and a <b>3</b> can't join the other 1, or the pair would be cut off. So its bridge goes to the 3.</p>
    <p>Keys: arrows choose a bridge, Space adds, X crosses, H hints, C checks.</p></div></div>`,
};
