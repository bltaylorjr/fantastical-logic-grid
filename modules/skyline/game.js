// Skyline's definition for the shared game screen (modules/grid-kit/kit.js):
// the inner grid of building heights, the edge numbers drawn around it, which
// cells see each other, and its words.
import { cleanStory } from '../grid-kit/story.js';
const bit = (d) => 1 << (d - 1);
const rowCells = (N, r) => [...Array(N)].map((_, c) => r * N + c);
const colCells = (N, c) => [...Array(N)].map((_, r) => r * N + c);
const SIDES = ['top', 'bottom', 'left', 'right'];
export const seen = (hs) => { let m = 0, n = 0; for (const h of hs) if (h > m) { m = h; n++; } return n; };
// The cells a side looks along, nearest first.
const view = (N, side, k) => (side === 'top' ? colCells(N, k) : side === 'bottom' ? colCells(N, k).reverse() : side === 'left' ? rowCells(N, k) : rowCells(N, k).reverse());

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '4×4 with every edge number', sizes: [4] },
  { id: 'easy', name: 'Easy', note: 'Every edge number, a few heights', sizes: [5, 4] },
  { id: 'medium', name: 'Medium', note: 'Count what can be seen', sizes: [5, 4] },
  { id: 'hard', name: 'Hard', note: 'Fewer edge numbers', sizes: [6, 5] },
  { id: 'expert', name: 'Expert', note: 'Pairs and long views', sizes: [6, 7] },
  { id: 'master', name: 'Master', note: 'Big skylines', sizes: [8, 7] },
];

// The board's own styles, scoped to this game: edge numbers around the grid.
const CSS = `
.gk-app .gk-sk { display: grid; aspect-ratio: 1; background: transparent; box-shadow: none; overflow: visible; border-radius: 0; grid-template-areas: ". top ." "left cells right" ". bottom ."; }
.gk-app .gk-sk .sk-top { grid-area: top; } .gk-app .gk-sk .sk-bottom { grid-area: bottom; } .gk-app .gk-sk .sk-left { grid-area: left; } .gk-app .gk-sk .sk-right { grid-area: right; }
.gk-app .gk-sk .sk-top, .gk-app .gk-sk .sk-bottom { display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.gk-app .gk-sk .sk-left, .gk-app .gk-sk .sk-right { display: grid; grid-template-rows: repeat(var(--n), 1fr); }
.gk-app .gk-sk .sk-cells { grid-area: cells; display: grid; grid-template-rows: repeat(var(--n), 1fr); background: var(--gk-bg); border: 2px solid var(--gk-thick); border-radius: 6px; overflow: hidden; box-shadow: var(--shadow, 0 20px 40px -28px rgb(0 0 0 / .5)); }
.gk-app .gk-sk .sk-clue { display: grid; place-items: center; color: var(--gk-text); font-weight: 700; font-variant-numeric: tabular-nums; font-size: clamp(12px, calc(min(92vw, 620px) / (var(--n) + 2) * .42), 28px); transition: opacity var(--gk-fast); }
.gk-app .gk-sk .sk-clue.done { opacity: .4; }
.gk-app .gk-sk .sk-clue.bad { color: var(--gk-error); text-decoration: underline wavy; text-underline-offset: 4px; }
.gk-app .gk-sk .gk-cell { font-size: clamp(16px, calc(min(92vw, 620px) / (var(--n) + 2) * .55), 38px); }
.gk-app .gk-sk .gk-notes { font-size: clamp(9px, calc(min(92vw, 620px) / (var(--n) + 2) * .2), 15px); }
.gk-app .gk-sk.paused .sk-cells .gk-row { filter: blur(14px); opacity: .4; }
.gk-app .gk-board.gk-mini.gk-sk .sk-clue { font-size: clamp(8px, calc(340px / (var(--n) + 2) * .42), 14px); }
.gk-app .gk-board.gk-mini.gk-sk .gk-cell { font-size: clamp(10px, calc(340px / (var(--n) + 2) * .5), 20px); }`;
function addStyle(el) {
  const doc = el.ownerDocument;
  if (doc.getElementById('sk-style')) return;
  const s = doc.createElement('style');
  s.id = 'sk-style';
  s.textContent = CSS;
  doc.head.append(s);
}
const sideWords = { top: 'from the top', bottom: 'from the bottom', left: 'from the left', right: 'from the right' };

export const def = {
  id: 'sk',
  name: 'Skyline',
  kind: 'digits',
  eyebrow: 'The Logic Grid · Number puzzles',
  lede: 'Build a city: every row and column holds one building of each height. The numbers around the edge say how many buildings you can see from there, because taller ones hide shorter ones. Every puzzle is new to you, proven to have one answer you can reach by logic alone, and tuned to how you play.',
  boardHelp: 'Arrow keys move, number keys fill in.',
  keysHelp: 'Arrow keys move. A number key fills a cell, Shift with a number writes a note. N switches notes on and off, A fills in notes, H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 60e3, easy: 150e3, medium: 240e3, hard: 480e3, expert: 900e3, master: 1500e3 },
  simpleTechniques: ['nakedSingle', 'hiddenSingle', 'edgeOne', 'edgeAll'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} Skyline`,
  coach: [
    'Each number is a building that many floors tall. Tap a cell, then a number. On a keyboard, use the arrow keys and type the number.',
    'An edge number counts the buildings you see looking in from there. A taller building hides every shorter one behind it.',
    'A 1 at the edge means the tallest building stands right next to it. A number as big as the grid means the buildings rise 1, 2, 3 in order.',
    'Stuck? Hint starts with a nudge. Ask again to see where to look, then why it works.',
  ],
  badges: [
    { id: 'sk-tall', name: 'Big city', note: 'Solve an 8×8 Skyline', test: (s) => s.solved.some((r) => r.size === 8) },
    { id: 'sk-quick', name: 'Quick lookout', note: 'Solve a 5×5 in under 3 minutes', test: (s) => s.solved.some((r) => r.size === 5 && r.ms < 180e3) },
  ],
  digits: (p) => [...Array(p.size)].map((_, i) => i + 1),
  countOf: (p) => p.size,
  playable: () => true,
  cellLabel: (p, i) => {
    const N = p.size, r = Math.floor(i / N), c = i % N, cl = p.clues;
    const part = (line, a, b) => {
      const xs = [[a, line === 'row' ? cl[a][r] : cl[a][c]], [b, line === 'row' ? cl[b][r] : cl[b][c]]].filter(([, v]) => v).map(([s, v]) => `${v} ${sideWords[s]}`);
      return xs.length ? `${line === 'row' ? `row ${r + 1}` : `column ${c + 1}`} shows ${xs.join(' and ')}` : '';
    };
    const views = [part('row', 'left', 'right'), part('col', 'top', 'bottom')].filter(Boolean);
    return `Row ${r + 1}, column ${c + 1}${views.length ? `. Edge numbers: ${views.join('; ')}` : ''}`;
  },
  peers(p, i) {
    const N = p.size;
    return [...new Set([...rowCells(N, Math.floor(i / N)), ...colCells(N, i % N)])].filter((x) => x !== i);
  },
  units(p, i) {
    const N = p.size;
    return [rowCells(N, Math.floor(i / N)), colCells(N, i % N)];
  },
  clashes(p, vals) {
    const N = p.size;
    const out = new Set();
    for (let k = 0; k < N; k++) {
      for (const line of [rowCells(N, k), colCells(N, k)]) {
        const sn = {};
        for (const c of line) if (vals[c]) (sn[vals[c]] ||= []).push(c);
        for (const cs of Object.values(sn)) if (cs.length > 1) cs.forEach((c) => out.add(c));
      }
    }
    // A full row or column that shows the wrong number from an edge.
    for (const side of SIDES) p.clues[side].forEach((v, k) => {
      const cells = view(N, side, k), hs = cells.map((c) => vals[c]);
      if (v && hs.every(Boolean) && seen(hs) !== v) cells.forEach((c) => out.add(c));
    });
    return out;
  },
  // Heights not yet in the row or column that also fit the edge numbers'
  // simplest limits: a 1 puts the tallest next to it, a full count puts them in
  // order, and the nearer a cell is to an edge showing k, the lower it must be.
  allowed(p, i, valueAt) {
    const N = p.size, r = Math.floor(i / N), c = i % N;
    let m = (1 << N) - 1;
    for (const x of [...rowCells(N, r), ...colCells(N, c)]) if (x !== i && valueAt(x)) m &= ~bit(valueAt(x));
    for (const side of SIDES) {
      const k = side === 'top' || side === 'bottom' ? c : r, v = p.clues[side][k];
      if (!v) continue;
      const pos = view(N, side, k).indexOf(i);
      if (v === 1 && pos === 0) m &= bit(N);
      else if (v === N) m &= bit(pos + 1);
      else m &= (1 << Math.min(N, N - v + 1 + pos)) - 1;
    }
    return m;
  },
  move(p, i, dr, dc) {
    const N = p.size;
    const r = Math.floor(i / N) + dr, c = (i % N) + dc;
    return r < 0 || c < 0 || r >= N || c >= N ? -1 : r * N + c;
  },
  buildBoard(el, p) {
    addStyle(el);
    const N = p.size;
    el.style.setProperty('--n', N);
    el.style.setProperty('--c', N);
    el.style.gridTemplateColumns = `1fr ${N}fr 1fr`;
    el.style.gridTemplateRows = `1fr ${N}fr 1fr`;
    const clues = (side) => `<div class="sk-${side}" aria-hidden="true">${p.clues[side].map((v, k) => `<span class="sk-clue" data-side="${side}" data-k="${k}">${v || ''}</span>`).join('')}</div>`;
    let html = SIDES.map(clues).join('') + '<div class="sk-cells">';
    for (let r = 0; r < N; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < N; c++) html += `<div class="gk-cell" data-i="${r * N + c}"><span class="v"></span><span class="gk-notes" style="--nc:${N > 4 ? 3 : 2}"></span></div>`;
      html += '</div>';
    }
    el.innerHTML = `${html}</div>`;
  },
  // An edge number fades once its row or column is full and shows it; it turns red if it does not.
  paint(board, { p, value }) {
    const N = p.size;
    for (const el of board.querySelectorAll('.sk-clue')) {
      const v = p.clues[el.dataset.side][Number(el.dataset.k)];
      if (!v) continue;
      const hs = view(N, el.dataset.side, Number(el.dataset.k)).map(value);
      const full = hs.every(Boolean);
      el.classList.toggle('done', full && seen(hs) === v);
      el.classList.toggle('bad', full && seen(hs) !== v);
    }
  },
  shareCells: (p) => p.givens.map((d) => (d ? 2 : 1)),
  printCss: `table.sk { border-collapse: collapse; } table.sk td { text-align: center; vertical-align: middle; font-weight: 700; padding: 0; }
    table.sk td.n { border: 0.4mm solid #000; } table.sk td.k { font-size: 13pt; color: #000; }
    table.sk.n4 td { width: 20mm; height: 20mm; font-size: 22pt; } table.sk.n5 td { width: 17mm; height: 17mm; font-size: 20pt; } table.sk.n6 td { width: 15mm; height: 15mm; font-size: 18pt; }
    table.sk.n7 td { width: 13mm; height: 13mm; font-size: 16pt; } table.sk.n8 td { width: 12mm; height: 12mm; font-size: 15pt; } table.sk td.k { font-size: 13pt; }`,
  printBoard(p, values) {
    const N = p.size, cl = p.clues;
    const k = (v) => `<td class="k">${v || ''}</td>`;
    let rows = `<tr>${k(0)}${cl.top.map(k).join('')}${k(0)}</tr>`;
    for (let r = 0; r < N; r++) {
      rows += `<tr>${k(cl.left[r])}`;
      for (let c = 0; c < N; c++) rows += `<td class="n">${Number(values[r * N + c]) || ''}</td>`;
      rows += `${k(cl.right[r])}</tr>`;
    }
    rows += `<tr>${k(0)}${cl.bottom.map(k).join('')}${k(0)}</tr>`;
    return `<table class="sk n${N}">${rows}</table>`;
  },
  // A puzzle from a saved game or a file, checked before it reaches the page.
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const N = Number(p.size);
    if (![4, 5, 6, 7, 8].includes(N) || !p.clues || typeof p.clues !== 'object' || !Array.isArray(p.solution) || p.solution.length !== N * N || !Array.isArray(p.givens) || p.givens.length !== N * N) return null;
    const sol = p.solution.map(Number);
    if (sol.some((d) => !Number.isInteger(d) || d < 1 || d > N)) return null;
    for (let k = 0; k < N; k++) {
      if (new Set(rowCells(N, k).map((c) => sol[c])).size !== N || new Set(colCells(N, k).map((c) => sol[c])).size !== N) return null;
    }
    const givens = p.givens.map(Number);
    if (givens.some((d, c) => d !== 0 && d !== sol[c])) return null;
    const clues = {};
    for (const side of SIDES) {
      const xs = p.clues[side];
      if (!Array.isArray(xs) || xs.length !== N) return null;
      clues[side] = xs.map(Number);
      if (clues[side].some((v, k) => !Number.isInteger(v) || (v !== 0 && v !== seen(view(N, side, k).map((c) => sol[c]))))) return null;
    }
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'].includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    return {
      kind: 'skyline', game: 'sk', id: str(p.id, 80), seed: str(p.seed, 80), size: N, cols: N, givens, clues, solution: sol,
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 2000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        place: Array.isArray(s?.place) && Number.isInteger(s.place[0]) && s.place[0] >= 0 && s.place[0] < N * N && Number.isInteger(s.place[1]) && s.place[1] >= 1 && s.place[1] <= N ? [s.place[0], s.place[1]] : null,
        cells: Array.isArray(s?.cells) ? s.cells.filter((c) => Number.isInteger(c) && c >= 0 && c < N * N).slice(0, 64) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: cleanStory(p.story),
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Each cell is a building, from 1 floor up to the size of the grid (1 to 4 on a 4×4). Each row and each column holds one building of every height.</p>
    <h3>Edge numbers</h3>
    <p>A number outside the grid says how many buildings you can see from there, looking along that row or column. A taller building hides every shorter one behind it.</p>
    <ul>
      <li>Looking along <b>2 1 4 3</b> from the left, you see the 2 and the 4: that is <b>2</b> buildings.</li>
      <li>From the right, you see the 3 and the 4: also 2.</li>
      <li>Some edges have no number. Those views can be anything.</li>
    </ul>
    <h3>Where to start</h3>
    <ol>
      <li>A <b>1</b> means the tallest building stands right next to that edge, hiding all the others.</li>
      <li>A number as big as the grid means every building shows, so they rise 1, 2, 3 and on in order.</li>
      <li>The more an edge sees, the lower the buildings near it must be: with 3 seen on a 5×5, the nearest cell is at most 3.</li>
      <li>Use notes, and look for a height that has only one place left in a row or column.</li>
    </ol>
    <h3>Hints that teach</h3>
    <p>Hint first gives a nudge, then shows where to look, then explains why, in plain words. Every puzzle can be solved by logic alone, without guessing.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>On a 4×4, a row has <b>1</b> on its left and <b>4</b> on its right.</p>
    <p>The 1 means the tallest building, the 4, stands in the first cell: it hides everything behind it.</p>
    <p>The 4 on the right means every building shows from that side, so from the right they rise 1, 2, 3, 4. The row is <b>4 3 2 1</b>.</p>
    <p>Keys: arrows move, 1 to 9 fill in, Shift with a number writes a note, H gives a hint, C checks.</p></div></div>`,
};
