// More or Less's definition for the shared game screen (modules/grid-kit/kit.js):
// how its board looks (numbers, and the signs between neighbouring cells),
// which cells see each other, and its words.
import { cleanStory } from '../grid-kit/story.js';
const bit = (d) => 1 << (d - 1);
const rowCells = (N, r) => [...Array(N)].map((_, c) => r * N + c);
const colCells = (N, c) => [...Array(N)].map((_, r) => r * N + c);
const other = (N, s) => (s.d === 'r' ? s.c + 1 : s.c + N);

// For each cell, its signs: rel[i] = [{ to, dir, less }] (less: i is the smaller one).
const cache = new WeakMap();
function info(p) {
  let x = cache.get(p);
  if (x) return x;
  const N = p.size, rel = [...Array(N * N)].map(() => []), right = Array(N * N).fill(null), down = Array(N * N).fill(null);
  for (const s of p.signs) {
    const o = other(N, s);
    rel[s.c].push({ to: o, dir: s.d === 'r' ? 'right' : 'below', less: s.lt });
    rel[o].push({ to: s.c, dir: s.d === 'r' ? 'left' : 'above', less: !s.lt });
    (s.d === 'r' ? right : down)[s.c] = s.lt;
  }
  x = { N, rel, right, down };
  cache.set(p, x);
  return x;
}

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '4×4 with plenty of signs', sizes: [4] },
  { id: 'easy', name: 'Easy', note: 'Signs and a few numbers', sizes: [5, 4] },
  { id: 'medium', name: 'Medium', note: 'Chains of signs', sizes: [6, 5] },
  { id: 'hard', name: 'Hard', note: 'Pairs and chains', sizes: [7, 6] },
  { id: 'expert', name: 'Expert', note: 'Matching threes', sizes: [8, 7] },
  { id: 'master', name: 'Master', note: 'Big grids, long chains of logic', sizes: [9, 8] },
];

// The board's own styles, scoped to this game (the kit draws plain cells).
const CSS = `
.gk-app .gk-ml .gk-cell { overflow: visible; }
.gk-app .gk-ml .ml-sign { position: absolute; z-index: 2; display: grid; place-items: center; width: 1.25em; height: 1.25em; border-radius: 50%; background: var(--gk-bg); color: var(--gk-text); font-weight: 700; line-height: 1; pointer-events: none;
  font-size: clamp(11px, calc(min(92vw, 620px) / var(--n) * .3), 22px); box-shadow: 0 0 0 1px var(--gk-line); }
.gk-app .gk-ml .ml-sign.r { right: 0; top: 50%; transform: translate(50%, -50%); }
.gk-app .gk-ml .ml-sign.d { bottom: 0; left: 50%; transform: translate(-50%, 50%) rotate(90deg); }
.gk-app .gk-ml .ml-l .gk-notes { left: 20%; } .gk-app .gk-ml .ml-r .gk-notes { right: 20%; }
.gk-app .gk-ml .ml-t .gk-notes { top: 20%; } .gk-app .gk-ml .ml-b .gk-notes { bottom: 20%; }
.gk-app .gk-board.gk-mini.gk-ml .ml-sign { font-size: clamp(8px, calc(340px / var(--n) * .3), 14px); }
:root[data-theme="contrast"] .gk-app .gk-ml .ml-sign { box-shadow: 0 0 0 1px #fff; }`;
function addStyle(el) {
  const doc = el.ownerDocument;
  if (doc.getElementById('ml-style')) return;
  const s = doc.createElement('style');
  s.id = 'ml-style';
  s.textContent = CSS;
  doc.head.append(s);
}

export const def = {
  id: 'ml',
  name: 'More or Less',
  kind: 'digits',
  eyebrow: 'The Logic Grid · Number puzzles',
  lede: 'Fill the grid so every row and column holds each number once. The signs between cells say which number is less. Every puzzle is new to you, proven to have one answer you can reach by logic alone, and tuned to how you play.',
  boardHelp: 'Arrow keys move, number keys fill in.',
  keysHelp: 'Arrow keys move. A number key fills a cell, Shift with a number writes a note. N switches notes on and off, A fills in notes, H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 60e3, easy: 150e3, medium: 300e3, hard: 600e3, expert: 1080e3, master: 1680e3 },
  simpleTechniques: ['nakedSingle', 'hiddenSingle'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} More or Less`,
  coach: [
    'Tap a cell, then a number. On a keyboard, use the arrow keys and type the number.',
    'A sign points to the smaller number. A cell on the small side of a sign can never be the biggest number, and a cell on the big side can never be 1.',
    'Follow chains of signs: in a < b < c, the first cell is at least 2 less than the last.',
    'Stuck? Hint starts with a nudge. Ask again to see where to look, then why it works.',
  ],
  badges: [
    { id: 'ml-big', name: 'Long chains', note: 'Solve a 9×9 More or Less', test: (s) => s.solved.some((r) => r.size === 9) },
    { id: 'ml-quick', name: 'Quick compare', note: 'Solve a 6×6 in under 5 minutes', test: (s) => s.solved.some((r) => r.size === 6 && r.ms < 300e3) },
  ],
  digits: (p) => [...Array(p.size)].map((_, i) => i + 1),
  countOf: (p) => p.size,
  playable: () => true,
  cellLabel: (p, i) => {
    const { N, rel } = info(p);
    const signs = rel[i].map((x) => `${x.less ? 'less' : 'more'} than the cell ${x.dir === 'right' || x.dir === 'left' ? `to the ${x.dir}` : x.dir}`);
    return `Row ${Math.floor(i / N) + 1}, column ${(i % N) + 1}${signs.length ? `, ${signs.join(', ')}` : ''}`;
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
        const seen = {};
        for (const c of line) if (vals[c]) (seen[vals[c]] ||= []).push(c);
        for (const cs of Object.values(seen)) if (cs.length > 1) cs.forEach((c) => out.add(c));
      }
    }
    for (const s of p.signs) {
      const a = vals[s.c], b = vals[other(N, s)];
      if (a && b && (s.lt ? a >= b : a <= b)) { out.add(s.c); out.add(other(N, s)); }
    }
    return out;
  },
  // Numbers not yet in the row or column that also fit the signs around the cell.
  allowed(p, i, valueAt) {
    const { N, rel } = info(p);
    let m = (1 << N) - 1;
    for (const x of [...rowCells(N, Math.floor(i / N)), ...colCells(N, i % N)]) if (x !== i && valueAt(x)) m &= ~bit(valueAt(x));
    for (const r of rel[i]) {
      const v = valueAt(r.to);
      for (let d = 1; d <= N; d++) {
        const bad = v ? (r.less ? d >= v : d <= v) : (r.less ? d === N : d === 1);
        if (bad) m &= ~bit(d);
      }
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
    const { N, right, down } = info(p);
    el.style.setProperty('--n', N);
    el.style.setProperty('--c', N);
    let html = '';
    for (let r = 0; r < N; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        const signs = (right[i] == null ? '' : `<span class="ml-sign r" aria-hidden="true">${right[i] ? '&lt;' : '&gt;'}</span>`)
          + (down[i] == null ? '' : `<span class="ml-sign d" aria-hidden="true">${down[i] ? '&lt;' : '&gt;'}</span>`);
        // Notes keep clear of the signs on each side of the cell.
        const near = [c > 0 && right[i - 1] != null ? 'ml-l' : '', right[i] != null ? 'ml-r' : '', r > 0 && down[i - N] != null ? 'ml-t' : '', down[i] != null ? 'ml-b' : ''].filter(Boolean).join(' ');
        html += `<div class="gk-cell${near ? ` ${near}` : ''}" data-i="${i}"><span class="v"></span><span class="gk-notes" style="--nc:${N > 4 ? 3 : 2}"></span>${signs}</div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  },
  shareCells: (p) => p.givens.map((d) => (d ? 2 : 1)),
  // Printed as a table with a narrow column (or row) for the signs between cells.
  printCss: `table.ml { border-collapse: collapse; } table.ml td.n { border: 0.4mm solid #000; text-align: center; vertical-align: middle; font-weight: 700; }
    table.ml td.s { text-align: center; vertical-align: middle; font-weight: 700; padding: 0; } table.ml td.s.v span { display: inline-block; transform: rotate(90deg); }
    table.ml.n4 td.n { width: 22mm; height: 22mm; font-size: 22pt; } table.ml.n5 td.n { width: 19mm; height: 19mm; font-size: 20pt; } table.ml.n6 td.n { width: 16mm; height: 16mm; font-size: 18pt; }
    table.ml.n7 td.n { width: 14mm; height: 14mm; font-size: 16pt; } table.ml.n8 td.n { width: 12.5mm; height: 12.5mm; font-size: 15pt; } table.ml.n9 td.n { width: 11mm; height: 11mm; font-size: 14pt; }
    table.ml td.s { width: 6mm; height: 6mm; font-size: 13pt; }`,
  printBoard(p, values) {
    const { N, right, down } = info(p);
    let rows = '';
    for (let r = 0; r < N; r++) {
      rows += '<tr>';
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        rows += `<td class="n">${Number(values[i]) || ''}</td>`;
        if (c < N - 1) rows += `<td class="s">${right[i] == null ? '' : right[i] ? '&lt;' : '&gt;'}</td>`;
      }
      rows += '</tr>';
      if (r < N - 1) {
        rows += '<tr>';
        for (let c = 0; c < N; c++) {
          const i = r * N + c;
          rows += `<td class="s v">${down[i] == null ? '' : `<span>${down[i] ? '&lt;' : '&gt;'}</span>`}</td>`;
          if (c < N - 1) rows += '<td class="s"></td>';
        }
        rows += '</tr>';
      }
    }
    return `<table class="ml n${N}">${rows}</table>`;
  },
  // A puzzle from a saved game or a file, checked before it reaches the page.
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const N = Number(p.size);
    if (![4, 5, 6, 7, 8, 9].includes(N) || !Array.isArray(p.signs) || !Array.isArray(p.solution) || p.solution.length !== N * N || !Array.isArray(p.givens) || p.givens.length !== N * N) return null;
    const sol = p.solution.map(Number);
    if (sol.some((d) => !Number.isInteger(d) || d < 1 || d > N)) return null;
    for (let k = 0; k < N; k++) {
      if (new Set(rowCells(N, k).map((c) => sol[c])).size !== N || new Set(colCells(N, k).map((c) => sol[c])).size !== N) return null;
    }
    const givens = p.givens.map(Number);
    if (givens.some((d, c) => d !== 0 && d !== sol[c])) return null;
    if (p.signs.length > 2 * N * (N - 1)) return null;
    const seen = new Set(), signs = [];
    for (const s of p.signs) {
      const c = Number(s?.c), d = s?.d;
      if (!Number.isInteger(c) || c < 0 || c >= N * N || (d !== 'r' && d !== 'd') || typeof s.lt !== 'boolean') return null;
      if ((d === 'r' && c % N === N - 1) || (d === 'd' && c + N >= N * N) || seen.has(`${c}${d}`)) return null;
      if (s.lt !== (sol[c] < sol[d === 'r' ? c + 1 : c + N])) return null;
      seen.add(`${c}${d}`);
      signs.push({ c, d, lt: s.lt });
    }
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'].includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    return {
      kind: 'more-or-less', game: 'ml', id: str(p.id, 80), seed: str(p.seed, 80), size: N, cols: N, givens, signs, solution: sol,
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 2000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        place: Array.isArray(s?.place) && Number.isInteger(s.place[0]) && s.place[0] >= 0 && s.place[0] < N * N && Number.isInteger(s.place[1]) && s.place[1] >= 1 && s.place[1] <= N ? [s.place[0], s.place[1]] : null,
        cells: Array.isArray(s?.cells) ? s.cells.filter((c) => Number.isInteger(c) && c >= 0 && c < N * N).slice(0, 81) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: cleanStory(p.story),
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Fill every cell with a number from 1 up to the size of the grid (1 to 4 on a 4×4, 1 to 9 on a 9×9). Each row and each column holds every number exactly once.</p>
    <h3>Signs</h3>
    <p>Some neighbouring cells have a sign between them. The sign points to the smaller number, the way it does in maths:</p>
    <ul>
      <li><b>&lt;</b> between two cells in a row: the left one is less.</li>
      <li><b>&gt;</b>: the left one is more.</li>
      <li>Between cells in a column the sign is turned on its side, and the point still shows the smaller one.</li>
    </ul>
    <p>Two cells with no sign between them can be either way round. A few numbers may be filled in for you.</p>
    <h3>Where to start</h3>
    <ol>
      <li>A cell on the small side of a sign can never be the biggest number. A cell on the big side can never be 1.</li>
      <li>Follow chains. In a &lt; b &lt; c, the first cell can be at most 2 less than the biggest number.</li>
      <li>Use notes to list what each cell could be, then cross numbers off as the row and column fill up.</li>
      <li>Look for a number that has only one place left in a row or column.</li>
    </ol>
    <h3>Hints that teach</h3>
    <p>Hint first gives a nudge, then shows where to look, then explains why, in plain words. Every puzzle can be solved by logic alone, without guessing.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>On a 4×4, a row reads <b>□ &lt; □ &lt; □ □</b>. The first three cells climb, so the first is at most 2 and the third is at least 3.</p>
    <p>If the row already has its 4 in the last cell, the third cell must be 3, so the second is 2 and the first is 1.</p>
    <p>Keys: arrows move, 1 to 9 fill in, Shift with a number writes a note, H hints, C checks.</p></div></div>`,
};
