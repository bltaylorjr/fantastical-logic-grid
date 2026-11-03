// Star Field's definition for the shared game screen (modules/grid-kit/kit.js).
// Cells are 1 (a star), 2 (a dot: known empty) or 0 (not decided). The kit's
// shade pen places stars and its cross pen places dots.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SIZES = [5, 6, 7, 8, 9, 10, 11];
const LEVEL_IDS = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '5×5, one star each', sizes: [5] },
  { id: 'easy', name: 'Easy', note: '6×6, one star each', sizes: [6] },
  { id: 'medium', name: 'Medium', note: 'Try a star and see', sizes: [7, 8] },
  { id: 'hard', name: 'Hard', note: 'Regions that share lines', sizes: [8, 9] },
  { id: 'expert', name: 'Expert', note: '10×10, two stars each', sizes: [10] },
  { id: 'master', name: 'Master', note: 'Two stars, long chains', sizes: [10, 11] },
];

// Soft region tints: twelve hues mixed into the page background, so they stay
// gentle in light and dark themes. High contrast shows the borders only.
const HUES = [0, 30, 55, 95, 140, 170, 195, 215, 240, 265, 290, 325];
const hueGap = (a, b) => { const d = Math.abs(HUES[a] - HUES[b]) % 360; return Math.min(d, 360 - d); };

const cache = new WeakMap();
function info(p) {
  let x = cache.get(p);
  if (x) return x;
  const N = p.size, reg = p.regions;
  const anchor = [...Array(N)].map((_, k) => reg.indexOf(k));
  const near = [...Array(N)].map(() => new Set());
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    if (c < N - 1 && reg[i + 1] !== reg[i]) { near[reg[i]].add(reg[i + 1]); near[reg[i + 1]].add(reg[i]); }
    if (r < N - 1 && reg[i + N] !== reg[i]) { near[reg[i]].add(reg[i + N]); near[reg[i + N]].add(reg[i]); }
  }
  // Neighbouring regions get hues far apart.
  const hue = Array(N).fill(-1), used = new Set();
  for (let k = 0; k < N; k++) {
    let best = -1, bestGap = -1;
    for (let h = 0; h < HUES.length; h++) {
      if (used.has(h)) continue;
      const gaps = [...near[k]].filter((j) => hue[j] >= 0).map((j) => hueGap(h, hue[j]));
      const gap = gaps.length ? Math.min(...gaps) : 180;
      if (gap > bestGap) { best = h; bestGap = gap; }
    }
    hue[k] = best;
    used.add(best);
  }
  x = { N, reg, anchor, hue };
  cache.set(p, x);
  return x;
}
const lineCells = (p, key) => {
  const N = p.size, idx = Number(key.slice(1));
  return key[0] === 'r' ? [...Array(N)].map((_, c) => idx * N + c) : [...Array(N)].map((_, r) => r * N + idx);
};
const borders = (N, reg, i) => {
  const r = Math.floor(i / N), c = i % N, k = reg[i];
  return [r === 0 || reg[i - N] !== k ? 'bt' : '', c === 0 || reg[i - 1] !== k ? 'bl' : '', r === N - 1 || reg[i + N] !== k ? 'bb' : '', c === N - 1 || reg[i + 1] !== k ? 'br' : ''].filter(Boolean).join(' ');
};

const STAR = '<svg class="sf-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.2l2.95 6.2 6.8.85-5 4.7 1.3 6.75L12 17.4l-6.05 3.3 1.3-6.75-5-4.7 6.8-.85z"/></svg>';

const CSS = `
.gk-app .gk-sf .gk-cell { background: color-mix(in srgb, var(--t, transparent) 24%, var(--gk-bg)); color: var(--gk-accent); font-size: 1px; touch-action: none; }
.gk-app .gk-sf .gk-cell.peer { background: color-mix(in srgb, var(--gk-accent) 12%, color-mix(in srgb, var(--t, transparent) 24%, var(--gk-bg))); }
.gk-app .gk-sf .gk-cell.sel { background: color-mix(in srgb, var(--gk-accent) 18%, color-mix(in srgb, var(--t, transparent) 24%, var(--gk-bg))); box-shadow: inset 0 0 0 3px var(--gk-focus); }
.gk-app .gk-sf .gk-cell.wrong { background: var(--gk-error-soft); }
.gk-app .gk-sf .sf-star { display: none; width: 68%; height: 68%; fill: currentColor; pointer-events: none; }
.gk-app .gk-sf .gk-cell.on .sf-star { display: block; animation: gk-pop var(--gk-mid) cubic-bezier(.34, 1.56, .64, 1); }
.gk-app .gk-sf .gk-cell.x::after { content: ""; width: 16%; aspect-ratio: 1; border-radius: 50%; background: var(--gk-muted); }
.gk-app .gk-sf .gk-cell.wrong .sf-star, .gk-app .gk-sf .gk-cell.sf-clash .sf-star { color: var(--gk-error); }
.gk-app .gk-sf .gk-cell.wrong.x::after { background: var(--gk-error); }
.gk-app .gk-sf .gk-cell.sf-clash { box-shadow: inset 0 0 0 2px var(--gk-error); }
.gk-app .gk-sf .sf-n { position: absolute; left: 3px; top: 1px; font-size: clamp(8px, calc(min(92vw, 620px) / var(--n) * .2), 13px); font-weight: 700; color: var(--gk-muted); line-height: 1.1; pointer-events: none; }
.gk-app .gk-board.gk-mini.gk-sf .gk-cell { font-size: 1px; }
.gk-app .gk-board.gk-mini.gk-sf .sf-n { font-size: clamp(7px, calc(340px / var(--n) * .2), 10px); }
.gk-app .gk-sf.won .gk-cell.on .sf-star { color: var(--gk-hint); }
.gk-app.gk-silent .gk-sf .sf-star { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .gk-app .gk-sf .sf-star { animation: none !important; } }
:root[data-theme="contrast"] .gk-app .gk-sf .gk-cell { background: #000; color: #fff; }
:root[data-theme="contrast"] .gk-app .gk-sf .gk-cell.peer { background: #111; }
:root[data-theme="contrast"] .gk-app .gk-sf .gk-cell.sel { background: #333; }
:root[data-theme="contrast"] .gk-app .gk-sf .gk-cell.x::after { background: #fff; }
:root[data-theme="contrast"] .gk-app .gk-sf .sf-n { color: #fff; }
`;
// The kit's stylesheet has no Star Field section, so the board brings its own.
function addStyle(el) {
  const doc = el.ownerDocument;
  if (!doc || doc.getElementById('sf-style')) return;
  const s = doc.createElement('style');
  s.id = 'sf-style';
  s.textContent = CSS;
  doc.head.append(s);
}

// Which stars break a rule: two touching, or too many in a row, column or region.
function clashes(p, value) {
  const N = p.size, K = p.stars, out = new Set();
  const star = (i) => value(i) === 1;
  for (let i = 0; i < N * N; i++) {
    if (!star(i)) continue;
    const r = Math.floor(i / N), c = i % N;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && cc >= 0 && rr < N && cc < N && star(rr * N + cc)) out.add(i);
    }
  }
  const groups = [];
  for (let k = 0; k < N; k++) groups.push(lineCells(p, `r${k}`), lineCells(p, `c${k}`), []);
  p.regions.forEach((k, i) => groups[3 * k + 2].push(i));
  for (const g of groups) { const s = g.filter(star); if (s.length > K) s.forEach((i) => out.add(i)); }
  return out;
}

const connected = (N, cells) => {
  const set = new Set(cells), seen = new Set([cells[0]]), q = [cells[0]];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], r = Math.floor(i / N), c = i % N;
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const y = rr * N + cc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && set.has(y) && !seen.has(y)) { seen.add(y); q.push(y); }
    }
  }
  return seen.size === cells.length;
};

export const def = {
  id: 'sf',
  name: 'Star Field',
  kind: 'shade',
  penNames: ['Star', 'Dot'],
  markWords: { on: 'star', x: 'no star', none: 'empty' },
  leftWord: 'star',
  eyebrow: 'The Logic Grid · Star puzzles',
  lede: 'Place stars so every row, column and outlined region has the same number, and no two stars touch, not even at a corner. Every puzzle is proven to have one answer you can reach without guessing, never repeats, and is tuned to how you play.',
  boardHelp: 'Arrow keys move, Space places a star, X marks a cell empty.',
  keysHelp: 'Arrow keys move. Space, Enter or F places a star, X or . marks a cell empty with a dot, pressing it again clears it. Drag along a row or column to mark several. H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 90e3, easy: 180e3, medium: 420e3, hard: 720e3, expert: 1200e3, master: 1800e3 },
  simpleTechniques: ['neighbour', 'finished', 'onlyPlace'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} Star Field`,
  solvedTitle: () => 'Every star is in place!',
  coach: [
    'Every row, column and outlined region gets the same number of stars: one on smaller grids, two on the biggest. Stars never touch, not even at a corner.',
    'The Star pen places a star. Switch to Dot to mark a cell you know is empty with a dot. Drag to mark a whole stretch.',
    'Start with the smallest regions. A region squeezed into one row puts its star in that row, so the rest of that row is empty.',
    'Stuck? Hint shows where to look, then why, in plain words.',
  ],
  badges: [
    { id: 'sf-twin', name: 'Double stars', note: 'Solve a two-star puzzle', test: (s) => s.solved.some((r) => r.size >= 10) },
    { id: 'sf-clear', name: 'Clear skies', note: 'Solve a Medium or harder puzzle with no hints or mistakes', test: (s) => s.solved.some((r) => ['medium', 'hard', 'expert', 'master'].includes(r.d) && !r.hints && !r.mistakes) },
  ],
  playable: () => true,
  cellLabel: (p, i) => `Row ${Math.floor(i / p.size) + 1}, column ${(i % p.size) + 1}, region ${p.regions[i] + 1}`,
  peers: (p, i) => [...lineCells(p, `r${Math.floor(i / p.size)}`), ...lineCells(p, `c${i % p.size}`)].filter((x) => x !== i),
  lineCells,
  lineDone: (p, key, vals) => vals.filter((v) => v === 1).length === p.stars,
  move(p, i, dr, dc) {
    const N = p.size, r = Math.floor(i / N) + dr, c = (i % N) + dc;
    return r < 0 || c < 0 || r >= N || c >= N ? -1 : r * N + c;
  },
  buildBoard(el, p) {
    addStyle(el);
    const { N, reg, anchor, hue } = info(p);
    el.style.setProperty('--n', N);
    el.style.setProperty('--c', N);
    let html = '';
    for (let r = 0; r < N; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < N; c++) {
        const i = r * N + c, k = reg[i];
        html += `<div class="gk-cell ${borders(N, reg, i)}" data-i="${i}" style="--t:hsl(${HUES[hue[k]]} 75% 55%)">${anchor[k] === i ? `<span class="sf-n" aria-hidden="true">${k + 1}</span>` : ''}${STAR}</div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  },
  // Stars that touch, or one too many in a line or region, show in red at once.
  paint(board, { p, value }) {
    const bad = clashes(p, value);
    for (const el of board.querySelectorAll('[data-i]')) el.classList.toggle('sf-clash', bad.has(Number(el.dataset.i)));
  },
  shareCells: (p) => p.solution.map(() => 1),
  printCss: `table.sf { border: 0.9mm solid #000; table-layout: fixed; } table.sf td { position: relative; border: 0.2mm solid #999; text-align: center; vertical-align: middle; padding: 0; width: var(--s); min-width: var(--s); height: var(--s); font-size: calc(var(--s) * 0.62); line-height: 1; overflow: hidden; }
    table.sf td.bt { border-top: 0.8mm solid #000; } table.sf td.bl { border-left: 0.8mm solid #000; } table.sf td.bb { border-bottom: 0.8mm solid #000; } table.sf td.br { border-right: 0.8mm solid #000; }
    table.sf td b { position: absolute; left: 0.8mm; top: 0.4mm; font-size: 7pt; line-height: 1; }`,
  printBoard(p, values, { answers }) {
    const { N, reg, anchor } = info(p);
    const s = N <= 6 ? 20 : N <= 8 ? 16 : 13;
    let rows = '';
    for (let r = 0; r < N; r++) {
      rows += '<tr>';
      for (let c = 0; c < N; c++) {
        const i = r * N + c, v = Number(values[i]);
        rows += `<td class="${borders(N, reg, i)}">${anchor[reg[i]] === i ? `<b>${reg[i] + 1}</b>` : ''}${v === 1 ? '★' : v === 2 && !answers ? '·' : ''}</td>`;
      }
      rows += '</tr>';
    }
    return `<table class="sf" style="--s:${s}mm">${rows}</table>`;
  },
  // A puzzle from a saved game or a file, checked before it reaches the page.
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const N = Number(p.size), K = Number(p.stars);
    if (!SIZES.includes(N) || Number(p.cols) !== N || ![1, 2].includes(K) || (K === 2 && N < 8)) return null;
    if (!Array.isArray(p.regions) || p.regions.length !== N * N || !Array.isArray(p.solution) || p.solution.length !== N * N) return null;
    const regions = p.regions.map(Number);
    if (regions.some((k) => !Number.isInteger(k) || k < 0 || k >= N)) return null;
    const cellsOf = [...Array(N)].map(() => []);
    regions.forEach((k, i) => cellsOf[k].push(i));
    if (cellsOf.some((cs) => !cs.length || !connected(N, cs))) return null;
    if (p.solution.some((v) => v !== 1 && v !== 2)) return null;
    const sol = p.solution.map(Number);
    // The answer must keep every rule.
    const count = (cells) => cells.filter((i) => sol[i] === 1).length;
    for (let k = 0; k < N; k++) {
      if (count(lineCells({ size: N }, `r${k}`)) !== K || count(lineCells({ size: N }, `c${k}`)) !== K || count(cellsOf[k]) !== K) return null;
    }
    if (clashes({ size: N, stars: K, regions }, (i) => sol[i]).size) return null;
    const givens = Array.isArray(p.givens) && p.givens.length === N * N ? p.givens.map((v, i) => (Number(v) === 1 && sol[i] === 1 ? 1 : 0)) : sol.map(() => 0);
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = LEVEL_IDS.includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    const cellOk = (c) => Number.isInteger(c) && c >= 0 && c < N * N;
    return {
      kind: 'star-field', game: 'sf', id: str(p.id, 80), seed: str(p.seed, 80), size: N, cols: N, stars: K, regions, givens, solution: sol,
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 3000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        marks: Array.isArray(s?.marks) ? s.marks.filter((m) => Array.isArray(m) && cellOk(m[0]) && (m[1] === 1 || m[1] === 2)).map((m) => [m[0], m[1]]).slice(0, N * N) : [],
        cells: Array.isArray(s?.cells) ? s.cells.filter(cellOk).slice(0, N * N) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: p.story ? { id: str(p.story.id, 80), title: str(p.story.title, 80), intro: str(p.story.intro), ending: str(p.story.ending) } : null,
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Place stars in the grid. Every row, every column and every outlined region gets the same number of stars: one on the smaller grids, two on the 10×10 and 11×11 grids.</p>
    <p>Stars never touch each other, not even at a corner.</p>
    <h3>Marking</h3>
    <ul>
      <li>The Star pen places a star. Choose the Dot pen to mark a cell you know is empty with a dot.</li>
      <li>Drag along a row or column to mark several cells at once. Tap a marked cell again to clear it.</li>
      <li>Stars that touch, or one star too many in a line or region, turn red.</li>
      <li>With the option on, the rest of a row or column is dotted for you once it has all its stars.</li>
    </ul>
    <h3>Where to start</h3>
    <ol>
      <li>Every cell around a star is empty. Dot them as soon as you place one.</li>
      <li>A row, column or region with all its stars is finished: dot the rest of it.</li>
      <li>Look at small regions. One that fits in a single row puts its star in that row, so the rest of the row is empty.</li>
      <li>If a star in a cell would leave some region with no open cell, that cell is empty.</li>
      <li>On harder grids, two regions that fit inside the same two rows take both of those rows' stars.</li>
    </ol>
    <p>Every puzzle can be solved without guessing. Hint shows where to look, then why.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>A 5×5 grid, one star each. Region 2 is just two cells side by side: row 1, columns 2 and 3.</p>
    <p>Its star is in one of those two cells, so it is in row 1. Row 1 has only one star, so columns 1, 4 and 5 of row 1 are empty.</p>
    <p>Row 2, columns 2 and 3 touch both of region 2's cells. Wherever its star goes, it touches them, so they are empty too.</p>
    <p>Keys: arrows move, Space places a star, X places a dot, H hints, C checks.</p></div></div>`,
};
