// Cage Math's definition for the shared game screen (modules/grid-kit/kit.js):
// how its board looks, which cells see each other, and its words.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bit = (d) => 1 << (d - 1);
const OPS = new Set(['=', '+', '−', '×', '÷']);
export const label = (cg) => (cg.op === '=' ? String(cg.target) : `${cg.target}${cg.op}`);

const cache = new WeakMap();
function info(p) {
  let x = cache.get(p);
  if (x) return x;
  const N = p.size, owner = Array(N * N).fill(-1);
  p.cages.forEach((cg, k) => cg.cells.forEach((c) => { owner[c] = k; }));
  x = { N, owner, anchor: p.cages.map((cg) => Math.min(...cg.cells)) };
  cache.set(p, x);
  return x;
}
const rowCells = (N, r) => [...Array(N)].map((_, c) => r * N + c);
const colCells = (N, c) => [...Array(N)].map((_, r) => r * N + c);

function ok(op, target, vals) {
  if (op === '=') return vals[0] === target;
  if (op === '+') return vals.reduce((a, b) => a + b, 0) === target;
  if (op === '×') return vals.reduce((a, b) => a * b, 1) === target;
  if (vals.length !== 2) return false;
  const [a, b] = vals;
  if (op === '−') return Math.abs(a - b) === target;
  return Math.max(a, b) === target * Math.min(a, b);
}

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '4×4, adding only', sizes: [4] },
  { id: 'easy', name: 'Easy', note: 'Small cages, three signs', sizes: [4, 5] },
  { id: 'medium', name: 'Medium', note: 'All four signs', sizes: [5, 6] },
  { id: 'hard', name: 'Hard', note: 'Cages that claim a line', sizes: [6, 7] },
  { id: 'expert', name: 'Expert', note: 'Pairs and hidden pairs', sizes: [7, 8] },
  { id: 'master', name: 'Master', note: 'Big grids, long chains of logic', sizes: [8, 9] },
];

export const def = {
  id: 'cm',
  name: 'Cage Math',
  kind: 'digits',
  eyebrow: 'The Logic Grid · Number puzzles',
  lede: 'Fill the grid so every row and column holds each number once, and the numbers in every cage make its target. Every puzzle is new to you, proven to have one answer you can reach by logic alone, and tuned to how you play.',
  boardHelp: 'Arrow keys move, number keys fill in.',
  keysHelp: 'Arrow keys move. A number key fills a cell, Shift with a number writes a note. N switches notes on and off, A fills in notes, H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 90e3, easy: 180e3, medium: 360e3, hard: 720e3, expert: 1200e3, master: 1800e3 },
  simpleTechniques: ['nakedSingle', 'hiddenSingle'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} Cage Math`,
  coach: [
    'Tap a cell, then a number. On a keyboard, use the arrow keys and type the number.',
    'Start with the small cages: a one-cell cage is already filled in, and "3−" in two cells or "6×" in two cells has only a few ways to be made.',
    'Not sure yet? Switch on Notes (or hold Shift) to pencil in what a cell could be.',
    'Stuck? Hint starts with a nudge. Ask again to see where to look, then why it works.',
  ],
  badges: [
    { id: 'cm-big', name: 'Full house', note: 'Solve a 9×9 Cage Math', test: (s) => s.solved.some((r) => r.size === 9) },
    { id: 'cm-quick', name: 'Quick sums', note: 'Solve a 6×6 in under 5 minutes', test: (s) => s.solved.some((r) => r.size === 6 && r.ms < 300e3) },
  ],
  digits: (p) => [...Array(p.size)].map((_, i) => i + 1),
  countOf: (p) => p.size,
  playable: () => true,
  cellLabel: (p, i) => {
    const { N, owner } = info(p);
    return `Row ${Math.floor(i / N) + 1}, column ${(i % N) + 1}, in the ${label(p.cages[owner[i]])} cage`;
  },
  peers(p, i) {
    const { N, owner } = info(p);
    const r = Math.floor(i / N), c = i % N;
    return [...new Set([...rowCells(N, r), ...colCells(N, c), ...p.cages[owner[i]].cells])].filter((x) => x !== i);
  },
  units(p, i) {
    const { N, owner } = info(p);
    return [rowCells(N, Math.floor(i / N)), colCells(N, i % N), p.cages[owner[i]].cells];
  },
  clashes(p, vals) {
    const { N } = info(p);
    const out = new Set();
    for (let k = 0; k < N; k++) {
      for (const line of [rowCells(N, k), colCells(N, k)]) {
        const seen = {};
        for (const c of line) if (vals[c]) (seen[vals[c]] ||= []).push(c);
        for (const cs of Object.values(seen)) if (cs.length > 1) cs.forEach((c) => out.add(c));
      }
    }
    for (const cg of p.cages) {
      const vs = cg.cells.map((c) => vals[c]);
      if (vs.every(Boolean) && !ok(cg.op, cg.target, vs)) cg.cells.forEach((c) => out.add(c));
    }
    return out;
  },
  allowed(p, i, valueAt) {
    const { N } = info(p);
    let m = (1 << N) - 1;
    for (const x of [...rowCells(N, Math.floor(i / N)), ...colCells(N, i % N)]) if (x !== i && valueAt(x)) m &= ~bit(valueAt(x));
    // Only numbers that can still make the cage with what is already in it.
    const { owner } = info(p);
    const cg = p.cages[owner[i]];
    if (cg.op === '×' || cg.op === '÷') for (let d = 1; d <= N; d++) if (cg.op === '×' ? cg.target % d : !(cg.target * d <= N || d % cg.target === 0)) m &= ~bit(d);
    if (cg.op === '+') { const known = cg.cells.filter((c) => c !== i && valueAt(c)).reduce((s, c) => s + valueAt(c), 0); for (let d = 1; d <= N; d++) if (known + d > cg.target) m &= ~bit(d); }
    if (cg.op === '−') for (let d = 1; d <= N; d++) if (d + cg.target > N && d - cg.target < 1) m &= ~bit(d);
    return m;
  },
  move(p, i, dr, dc) {
    const N = p.size;
    const r = Math.floor(i / N) + dr, c = (i % N) + dc;
    return r < 0 || c < 0 || r >= N || c >= N ? -1 : r * N + c;
  },
  buildBoard(el, p) {
    const { N, owner, anchor } = info(p);
    el.style.setProperty('--n', N);
    el.style.setProperty('--c', N);
    let html = '';
    for (let r = 0; r < N; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < N; c++) {
        const i = r * N + c, k = owner[i];
        const b = [r === 0 || owner[i - N] !== k ? 'bt' : '', c === 0 || owner[i - 1] !== k ? 'bl' : '', r === N - 1 || owner[i + N] !== k ? 'bb' : '', c === N - 1 || owner[i + 1] !== k ? 'br' : ''].join(' ');
        html += `<div class="gk-cell ${b}" data-i="${i}">${anchor[k] === i ? `<span class="gk-cage">${esc(label(p.cages[k]))}</span>` : ''}<span class="v"></span><span class="gk-notes" style="--nc:${N > 4 ? 3 : 2}"></span></div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  },
  shareCells: (p) => { const { anchor } = info(p); return p.solution.map((_, i) => (anchor.includes(i) ? 2 : 1)); },
  printCss: `table.cm { border: 0.9mm solid #000; } table.cm td { position: relative; border: 0.2mm solid #999; text-align: center; vertical-align: middle; font-weight: 700; }
    table.cm td.bt { border-top: 0.8mm solid #000; } table.cm td.bl { border-left: 0.8mm solid #000; } table.cm td.bb { border-bottom: 0.8mm solid #000; } table.cm td.br { border-right: 0.8mm solid #000; }
    table.cm td b { position: absolute; left: 1mm; top: 0.6mm; font-size: 8pt; } table.cm.n4 td { width: 26mm; height: 26mm; font-size: 22pt; } table.cm.n5 td { width: 22mm; height: 22mm; font-size: 20pt; } table.cm.n6 td { width: 19mm; height: 19mm; font-size: 18pt; }
    table.cm.n7 td { width: 17mm; height: 17mm; font-size: 16pt; } table.cm.n8 td { width: 15mm; height: 15mm; font-size: 15pt; } table.cm.n9 td { width: 14mm; height: 14mm; font-size: 14pt; }`,
  printBoard(p, values) {
    const { N, owner, anchor } = info(p);
    let rows = '';
    for (let r = 0; r < N; r++) {
      rows += '<tr>';
      for (let c = 0; c < N; c++) {
        const i = r * N + c, k = owner[i];
        const b = [r === 0 || owner[i - N] !== k ? 'bt' : '', c === 0 || owner[i - 1] !== k ? 'bl' : '', r === N - 1 || owner[i + N] !== k ? 'bb' : '', c === N - 1 || owner[i + 1] !== k ? 'br' : ''].join(' ');
        rows += `<td class="${b}">${anchor[k] === i ? `<b>${esc(label(p.cages[k]))}</b>` : ''}${Number(values[i]) || ''}</td>`;
      }
      rows += '</tr>';
    }
    return `<table class="cm n${N}">${rows}</table>`;
  },
  // A puzzle from a saved game or a file, checked before it reaches the page.
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const N = Number(p.size);
    if (![4, 5, 6, 7, 8, 9].includes(N) || !Array.isArray(p.cages) || !Array.isArray(p.solution) || p.solution.length !== N * N) return null;
    const sol = p.solution.map(Number);
    if (sol.some((d) => !Number.isInteger(d) || d < 1 || d > N)) return null;
    for (let k = 0; k < N; k++) {
      if (new Set(rowCells(N, k).map((c) => sol[c])).size !== N || new Set(colCells(N, k).map((c) => sol[c])).size !== N) return null;
    }
    const seen = new Set();
    const cages = [];
    for (const cg of p.cages) {
      if (!cg || !Array.isArray(cg.cells) || !cg.cells.length || cg.cells.length > 6 || !OPS.has(cg.op)) return null;
      const cells = cg.cells.map(Number);
      if (cells.some((c) => !Number.isInteger(c) || c < 0 || c >= N * N || seen.has(c))) return null;
      cells.forEach((c) => seen.add(c));
      const target = Number(cg.target);
      if (!Number.isInteger(target) || target < 0 || !ok(cg.op, target, cells.map((c) => sol[c]))) return null;
      cages.push({ cells, op: cg.op, target });
    }
    if (seen.size !== N * N) return null;
    const givens = sol.map(() => 0);
    for (const cg of cages) if (cg.op === '=') givens[cg.cells[0]] = cg.target;
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'].includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    return {
      kind: 'cage-math', game: 'cm', id: str(p.id, 80), seed: str(p.seed, 80), size: N, cols: N, cages, givens, solution: sol,
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 2000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        place: Array.isArray(s?.place) && Number.isInteger(s.place[0]) && s.place[0] >= 0 && s.place[0] < N * N && Number.isInteger(s.place[1]) ? [s.place[0], s.place[1]] : null,
        cells: Array.isArray(s?.cells) ? s.cells.filter((c) => Number.isInteger(c) && c >= 0 && c < N * N).slice(0, 81) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: p.story ? { id: str(p.story.id, 80), title: str(p.story.title, 80), intro: str(p.story.intro), ending: str(p.story.ending) } : null,
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Fill every cell with a number from 1 up to the size of the grid (1 to 4 on a 4×4, 1 to 9 on a 9×9). Each row and each column holds every number exactly once.</p>
    <h3>Cages</h3>
    <p>Thick lines split the grid into cages. The small label in a cage's corner is its target and sign. The numbers in the cage must make the target:</p>
    <ul>
      <li><b>+</b> adds them all: "7+" over two cells could be 3 and 4, or 2 and 5.</li>
      <li><b>−</b> is the difference of two cells: "2−" could be 1 and 3, or 4 and 2.</li>
      <li><b>×</b> multiplies them all: "12×" over two cells could be 3 and 4, or 2 and 6.</li>
      <li><b>÷</b> divides the bigger of two cells by the smaller: "3÷" could be 1 and 3, or 2 and 6.</li>
      <li>A cage with just a number and one cell is already filled in for you.</li>
    </ul>
    <p>A number may appear twice in one cage, as long as the two are not in the same row or column.</p>
    <h3>Where to start</h3>
    <ol>
      <li>Fill in the obvious cages first. "1−" can't tell you much, but "8×" in two cells of a 4×4 can only be 2 and 4.</li>
      <li>Use notes to list what each cell could be, then cross numbers off as the row and column fill up.</li>
      <li>Look for a number that has only one place left in a row or column.</li>
      <li>On harder grids, a cage that must hold a number in one row claims it: no other cell in that row can have it.</li>
    </ol>
    <h3>Hints that teach</h3>
    <p>Hint first gives a nudge, then shows where to look, then explains why, in plain words. Every puzzle can be solved by logic alone, without guessing.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>On a 4×4, a two-cell cage says <b>12×</b>. The only pairs from 1 to 4 that multiply to 12 are 3 and 4, so those two cells are 3 and 4 in some order.</p>
    <p>If the row already has a 4 elsewhere, the cage cell in that row must be the 3.</p>
    <p>Keys: arrows move, 1 to 9 fill in, Shift with a number writes a note, H hints, C checks.</p></div></div>`,
};
