// Loop Line's definition for the shared game screen (modules/grid-kit/kit.js),
// a line game (kind 'edges', see grid-kit/lines.js). The marks are the edges
// between dots: flat ones first, row by row, then upright ones. Values: 1 a
// line, 2 crossed (no line), 0 not decided.
import { cleanStory } from '../grid-kit/story.js';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SIZES = [5, 6, 7, 8, 10, 12];

const cache = new Map();
export function geo(R, C) {
  const key = `${R}x${C}`;
  if (cache.has(key)) return cache.get(key);
  const W = C + 1, H = (R + 1) * C, E = H + R * W, D = (R + 1) * W;
  const hE = (r, c) => r * C + c, vE = (r, c) => H + r * W + c;
  const ends = [], edgeCells = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) { ends[hE(r, c)] = [r * W + c, r * W + c + 1]; edgeCells[hE(r, c)] = [r > 0 ? (r - 1) * C + c : -1, r < R ? r * C + c : -1]; }
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) { ends[vE(r, c)] = [r * W + c, (r + 1) * W + c]; edgeCells[vE(r, c)] = [c > 0 ? r * C + c - 1 : -1, c < C ? r * C + c : -1]; }
  const dotEdges = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) dotEdges.push([r > 0 ? vE(r - 1, c) : -1, c < C ? hE(r, c) : -1, r < R ? vE(r, c) : -1, c > 0 ? hE(r, c - 1) : -1]);
  const sides = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) sides.push([hE(r, c), vE(r, c + 1), hE(r + 1, c), vE(r, c)]);
  const g = { R, C, W, H, E, D, hE, vE, ends, edgeCells, dotEdges, sides };
  cache.set(key, g);
  return g;
}
const G = (p) => geo(p.size, p.cols);
const edgeRC = (g, e) => (e < g.H ? { h: true, r: Math.floor(e / g.C), c: e % g.C } : { h: false, r: Math.floor((e - g.H) / g.W), c: (e - g.H) % g.W });
const aNum = (n) => (n === 8 ? 'an 8' : `a ${n}`);

function edgeLabel(p, e) {
  const g = G(p), { h, r, c } = edgeRC(g, e);
  const name = h
    ? (r < g.R ? `Top side of row ${r + 1}, column ${c + 1}` : `Bottom side of row ${g.R}, column ${c + 1}`)
    : (c < g.C ? `Left side of row ${r + 1}, column ${c + 1}` : `Right side of row ${r + 1}, column ${g.C}`);
  const nums = g.edgeCells[e].filter((x) => x >= 0 && p.clues[x] >= 0).map((x) => aNum(p.clues[x]));
  return nums.length ? `${name}, beside ${nums.join(' and ')}` : name;
}

// Keyboard: a walk along the edges. An arrow along the selected edge goes on to
// the next edge that way; an arrow across it turns at the end you came to.
const walk = { at: -1, dot: -1 };
const anchorOf = (g, i) => (walk.at === i && g.ends[i].includes(walk.dot) ? walk.dot : g.ends[i][1]);

// Is this a single closed loop? Returns the line count, or 0.
function loopOk(g, sol) {
  const deg = new Int8Array(g.D);
  let lines = 0, first = -1;
  sol.forEach((v, e) => { if (v === 1) { lines++; first = e; for (const d of g.ends[e]) deg[d]++; } });
  if (lines < 4 || deg.some((d) => d !== 0 && d !== 2)) return 0;
  const seen = new Set([first]);
  let [prev, cur] = g.ends[first];
  const start = prev;
  for (let n = 0; n < lines && cur !== start; n++) {
    const e = g.dotEdges[cur].find((x) => x >= 0 && sol[x] === 1 && !seen.has(x));
    if (e === undefined) return 0;
    seen.add(e);
    const [a, b] = g.ends[e];
    prev = cur; cur = a === cur ? b : a;
  }
  return seen.size === lines ? lines : 0;
}

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '5×5 loops to learn on', sizes: [5] },
  { id: 'easy', name: 'Easy', note: 'Corners and loose ends', sizes: [5, 6] },
  { id: 'medium', name: 'Medium', note: 'Lines into 1s and 3s', sizes: [7, 6] },
  { id: 'hard', name: 'Hard', note: 'Fewer numbers to go on', sizes: [8, 7] },
  { id: 'expert', name: 'Expert', note: 'Bigger grids, deeper patterns', sizes: [10, 8] },
  { id: 'master', name: 'Master', note: 'Up to 12×12, follow lines through', sizes: [10, 12] },
];

export const def = {
  id: 'll',
  name: 'Loop Line',
  kind: 'edges',
  boardRole: 'application',
  itemRole: 'button',
  maxValue: 2,
  dragDraws: true,
  eyebrow: 'The Logic Grid · Line puzzles',
  lede: 'Draw one closed loop along the dotted lines so every number shows how many of its sides the loop uses. Every puzzle is proven to have one answer you can reach by logic alone, never repeats, and is tuned to how you play.',
  boardHelp: 'Arrow keys walk along the edges, Space draws a line, X crosses one out.',
  keysHelp: 'Arrow keys walk along the edges: an arrow along the selected edge goes on to the next one, an arrow across it turns at the end you came to (shown by a ring on the dot). Space, Enter or F draws or clears a line, X crosses an edge out. H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  penNames: ['Line', 'Cross'],
  penHelp: 'Tap an edge between two dots, or drag from dot to dot to draw several. Tap a line again to clear it.',
  autoCrossLabel: 'Cross out the spare edges of a finished number or dot',
  highlightLabel: 'Highlight the sides of the numbers beside the edge I am on',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 90e3, easy: 180e3, medium: 420e3, hard: 720e3, expert: 1200e3, master: 1800e3 },
  simpleTechniques: ['zero', 'full', 'fill', 'dotFull', 'deadEnd', 'goOn', 'closed'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} Loop Line`,
  coach: [
    'Tap the gap between two dots to draw a line there, or drag from dot to dot. Switch the pen to Cross to mark edges you know are empty.',
    'A number counts how many of its four sides the loop uses. Start with the 0s: none of their sides are used.',
    'The loop never branches or stops, so every dot has either two lines or none.',
    'Stuck? Hint shows a place you can work on now, and why.',
  ],
  badges: [
    { id: 'll-big', name: 'Long way round', note: 'Solve a 10×10 or bigger Loop Line', test: (s) => s.solved.some((r) => r.size >= 10) },
    { id: 'll-quick', name: 'Quick loop', note: 'Solve a 7×7 in under 5 minutes', test: (s) => s.solved.some((r) => r.size === 7 && r.ms < 300e3) },
  ],
  count: (p) => G(p).E,
  playable: () => true,
  nextValue: (p, i, v, pen) => (pen === 2 ? (v === 2 ? 0 : 2) : v === 1 ? 0 : 1),
  valueName: (p, v) => (v === 1 ? 'line' : v === 2 ? 'crossed out' : 'not decided'),
  revealValue: (p, i, v) => (p.solution[i] === 1 ? 1 : v === 2 ? 2 : 0),
  progress(p, value) {
    let need = 0, have = 0;
    p.solution.forEach((s, i) => { if (s === 1) { need++; if (value(i) === 1) have++; } });
    return need ? have / need : 0;
  },
  leftCount: (p, value) => p.solution.filter((s, i) => s === 1 && value(i) !== 1).length,
  leftWord: 'line',
  cellLabel: edgeLabel,
  peers(p, i) {
    const g = G(p);
    return [...new Set(g.edgeCells[i].filter((x) => x >= 0 && p.clues[x] >= 0).flatMap((x) => g.sides[x]))].filter((e) => e !== i);
  },
  move(p, i, dr, dc) {
    const g = G(p);
    const [a, b] = g.ends[i];
    const h = i < g.H;
    const along = h ? dc !== 0 : dr !== 0;
    const from = along ? ((h ? dc : dr) > 0 ? b : a) : anchorOf(g, i);
    const dir = dr < 0 ? 0 : dc > 0 ? 1 : dr > 0 ? 2 : 3;
    const next = g.dotEdges[from][dir];
    if (next < 0) return -1;
    const [na, nb] = g.ends[next];
    walk.at = next;
    walk.dot = na === from ? nb : na;
    return next;
  },
  autoMarks(p, vals, changed) {
    const g = G(p), out = [];
    const dots = new Set(), cells = new Set();
    for (const e of changed) { for (const d of g.ends[e]) dots.add(d); for (const c of g.edgeCells[e]) if (c >= 0) cells.add(c); }
    for (const d of dots) {
      const es = g.dotEdges[d].filter((e) => e >= 0);
      if (es.filter((e) => vals[e] === 1).length === 2) for (const e of es) if (!vals[e]) out.push([e, 2]);
    }
    for (const c of cells) {
      if (p.clues[c] < 0) continue;
      if (g.sides[c].filter((e) => vals[e] === 1).length === p.clues[c]) for (const e of g.sides[c]) if (!vals[e]) out.push([e, 2]);
    }
    return out;
  },
  hit(p, fx, fy) {
    const g = G(p), R = g.R, C = g.C;
    const x = fx * (C + 1) - 0.5, y = fy * (R + 1) - 0.5;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const dr = clamp(Math.round(y), 0, R), dc = clamp(Math.round(x), 0, C);
    const near = dr * g.W + dc;
    const node = Math.hypot(x - dc, y - dr) < 0.3 ? near : -1;
    const hr = clamp(Math.round(y), 0, R), hc = clamp(Math.floor(x), 0, C - 1);
    const dH = Math.abs(y - hr) + Math.max(0, hc - x, x - hc - 1);
    const vc = clamp(Math.round(x), 0, C), vr = clamp(Math.floor(y), 0, R - 1);
    const dV = Math.abs(x - vc) + Math.max(0, vr - y, y - vr - 1);
    const best = Math.min(dH, dV);
    const edge = best > 0.6 ? -1 : dH <= dV ? g.hE(hr, hc) : g.vE(vr, vc);
    return { edge, node, near };
  },
  path(p, a, b) {
    const g = G(p);
    const ra = Math.floor(a / g.W), ca = a % g.W, rb = Math.floor(b / g.W), cb = b % g.W;
    const out = [];
    if (ra === rb) { const s = Math.sign(cb - ca); for (let c = ca; c !== cb; c += s) out.push(g.hE(ra, Math.min(c, c + s))); return out; }
    if (ca === cb) { const s = Math.sign(rb - ra); for (let r = ra; r !== rb; r += s) out.push(g.vE(Math.min(r, r + s), ca)); return out; }
    return null;
  },
  buildBoard(el, p) {
    const g = G(p), R = g.R, C = g.C;
    const ux = 100 / (C + 1), uy = 100 / (R + 1);
    el.style.setProperty('--n', R + 1);
    el.style.setProperty('--c', C + 1);
    if (el.getAttribute('role')) el.setAttribute('role', 'application');
    let html = '';
    p.clues.forEach((n, i) => {
      if (n < 0) return;
      const r = Math.floor(i / C), c = i % C;
      html += `<span class="ll-clue" data-cell="${i}" style="left:${(c + 1) * ux}%;top:${(r + 1) * uy}%" aria-hidden="true">${n}</span>`;
    });
    for (let e = 0; e < g.E; e++) {
      const { h, r, c } = edgeRC(g, e);
      html += h
        ? `<div class="ln-e h" data-i="${e}" data-v="0" style="left:${(c + 0.5) * ux}%;top:${(r + 0.5) * uy}%;width:${ux}%;height:${uy * 0.36}%"></div>`
        : `<div class="ln-e v" data-i="${e}" data-v="0" style="left:${(c + 0.5) * ux}%;top:${(r + 0.5) * uy}%;width:${ux * 0.36}%;height:${uy}%"></div>`;
    }
    for (let d = 0; d < g.D; d++) html += `<i class="ll-dot" data-dot="${d}" style="left:${((d % g.W) + 0.5) * ux}%;top:${(Math.floor(d / g.W) + 0.5) * uy}%" aria-hidden="true"></i>`;
    el.innerHTML = html;
  },
  // A number with the right count of lines fades; too many turns red. A dot
  // with three lines turns red. The ring shows where the next turn starts.
  paint(board, { p, value, sel }) {
    const g = G(p);
    for (const el of board.querySelectorAll('.ll-clue')) {
      const i = Number(el.dataset.cell), n = p.clues[i];
      const lines = g.sides[i].filter((e) => value(e) === 1).length;
      el.classList.toggle('done', lines === n);
      el.classList.toggle('over', lines > n || g.sides[i].filter((e) => value(e) === 2).length > 4 - n);
    }
    const anchor = sel >= 0 && sel < g.E ? anchorOf(g, sel) : -1;
    for (const el of board.querySelectorAll('.ll-dot')) {
      const d = Number(el.dataset.dot);
      el.classList.toggle('over', g.dotEdges[d].filter((e) => e >= 0 && value(e) === 1).length > 2);
      el.classList.toggle('anchor', d === anchor);
    }
  },
  shareCells: (p) => p.clues.map((n) => (n >= 0 ? 2 : 1)),
  printCss: 'svg.ll { display: block; margin: 0 auto; } svg.ll text { font: 700 5.6px "Atkinson Hyperlegible", system-ui, sans-serif; fill: #000; }',
  printBoard(p, values, { answers }) {
    const g = G(p), R = g.R, C = g.C, mm = R <= 6 ? 16 : R <= 8 ? 13 : R <= 10 ? 11 : 9.5;
    let svg = `<svg class="ll" viewBox="0 0 ${(C + 1) * 10} ${(R + 1) * 10}" width="${(C + 1) * mm}mm" height="${(R + 1) * mm}mm" xmlns="http://www.w3.org/2000/svg">`;
    p.clues.forEach((n, i) => { if (n >= 0) svg += `<text x="${(i % C) * 10 + 10}" y="${Math.floor(i / C) * 10 + 12}" text-anchor="middle">${n}</text>`; });
    for (let e = 0; e < g.E; e++) {
      const [a, b] = g.ends[e];
      const x1 = (a % g.W) * 10 + 5, y1 = Math.floor(a / g.W) * 10 + 5, x2 = (b % g.W) * 10 + 5, y2 = Math.floor(b / g.W) * 10 + 5;
      if (values[e] === 1) svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>`;
      else if (values[e] === 2 && !answers) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; svg += `<path d="M${mx - 1.2} ${my - 1.2}L${mx + 1.2} ${my + 1.2}M${mx + 1.2} ${my - 1.2}L${mx - 1.2} ${my + 1.2}" stroke="#555" stroke-width=".5"/>`; }
    }
    for (let d = 0; d < g.D; d++) svg += `<circle cx="${(d % g.W) * 10 + 5}" cy="${Math.floor(d / g.W) * 10 + 5}" r="0.9" fill="#000"/>`;
    return `${svg}</svg>`;
  },
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const R = Number(p.size), C = Number(p.cols);
    if (!SIZES.includes(R) || C !== R) return null;
    const g = geo(R, C);
    if (!Array.isArray(p.solution) || p.solution.length !== g.E || !Array.isArray(p.clues) || p.clues.length !== R * C) return null;
    const sol = p.solution.map((v) => (Number(v) === 1 ? 1 : 2));
    if (!loopOk(g, sol)) return null;
    const clues = p.clues.map((n) => (Number.isInteger(n) && n >= 0 && n <= 3 ? n : -1));
    if (clues.some((n, i) => n >= 0 && g.sides[i].filter((e) => sol[e] === 1).length !== n)) return null;
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = LEVELS.some((l) => l.id === p.difficulty?.id) ? p.difficulty.id : 'medium';
    const edgeOk = (e) => Number.isInteger(e) && e >= 0 && e < g.E;
    return {
      kind: 'loop-line', game: 'll', id: str(p.id, 80), seed: str(p.seed, 80), size: R, cols: C, edges: g.E,
      clues, solution: sol, givens: sol.map(() => 0),
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 3000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        marks: Array.isArray(s?.marks) ? s.marks.filter((m) => Array.isArray(m) && edgeOk(m[0]) && (m[1] === 1 || m[1] === 2)).map((m) => [m[0], m[1]]).slice(0, 400) : [],
        cells: Array.isArray(s?.cells) ? s.cells.filter(edgeOk).slice(0, 400) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: cleanStory(p.story),
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Draw one loop along the lines between the dots. It is a single closed path: no branches, no loose ends, and it never crosses or touches itself.</p>
    <h3>Reading the numbers</h3>
    <ul>
      <li>A number tells how many of its four sides the loop uses: 0, 1, 2 or 3.</li>
      <li>Squares with no number can have any number of sides used.</li>
    </ul>
    <h3>Marking</h3>
    <ul>
      <li>Tap the gap between two dots to draw a line. Drag from dot to dot to draw several. Tap a line again to clear it.</li>
      <li>Choose the Cross pen to mark an edge you know is empty. Crosses are optional, but they help.</li>
      <li>A number fades when it has the right count of lines. With the option on, the spare edges of a finished number or dot are crossed out for you.</li>
    </ul>
    <h3>Where to start</h3>
    <ol>
      <li>Cross out all four sides of every 0.</li>
      <li>Every dot has two lines or none. If a line reaches a dot with only one way on, it goes that way. If a dot has two lines, cross out its other edges.</li>
      <li>A 3 in a corner of the grid uses both of its outside edges. A 1 in a corner uses neither.</li>
      <li>Never close a small loop early: there is only one loop, and it must pass every line.</li>
    </ol>
    <p>Every puzzle can be solved by logic alone, without guessing. Hint shows a place you can work on now, and why.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>A <b>0</b> sits next to a <b>3</b>. The 0 has no lines, so the side they share is empty.</p>
    <p>The 3 now has only three sides left, so the loop uses all three of them.</p>
    <p>At each end of those lines, follow the dots: a line can't stop, so it carries on along the only open edge.</p>
    <p>Keys: arrows walk along the edges, Space draws, X crosses, H hints, C checks.</p></div></div>`,
};
