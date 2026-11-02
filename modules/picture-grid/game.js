// Picture Grid's definition for the shared game screen (modules/grid-kit/kit.js).
// Cells are 1 (shaded), 2 (crossed: known blank) or 0 (not decided).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const cluesOf = (line) => {
  const out = [];
  let run = 0;
  for (const v of line) { if (v === 1) run++; else if (run) { out.push(run); run = 0; } }
  if (run) out.push(run);
  return out;
};
const lineCells = (p, key) => {
  const C = p.cols, R = p.size, idx = Number(key.slice(1));
  return key[0] === 'r' ? [...Array(C)].map((_, c) => idx * C + c) : [...Array(R)].map((_, r) => r * C + idx);
};
const cluesFor = (p, key) => (key[0] === 'r' ? p.rowClues : p.colClues)[Number(key.slice(1))];
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const LEVELS = [
  { id: 'basic', name: 'Basic', note: '5×5 pictures to learn on', sizes: [5] },
  { id: 'easy', name: 'Easy', note: 'Clear overlaps', sizes: [10, 5] },
  { id: 'medium', name: 'Medium', note: '10×10 pictures', sizes: [10] },
  { id: 'hard', name: 'Hard', note: 'Lines that work together', sizes: [15, 10] },
  { id: 'expert', name: 'Expert', note: 'Bigger pictures, longer logic', sizes: [15, 20] },
  { id: 'master', name: 'Master', note: 'Up to 25×25', sizes: [20, 25] },
];

export const def = {
  id: 'pg',
  name: 'Picture Grid',
  kind: 'shade',
  gallery: true,
  eyebrow: 'The Logic Grid · Picture puzzles',
  lede: 'Shade the cells each row and column calls for, and a hidden picture appears. Every puzzle is proven to have one answer you can reach one line at a time, never repeats, and is tuned to how you play. Every picture you uncover joins your gallery.',
  boardHelp: 'Arrow keys move, Space shades, X crosses out.',
  keysHelp: 'Arrow keys move. Space, Enter or F shades a cell, X marks it blank, pressing it again clears it. Drag along a row or column to mark several. H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 60e3, easy: 240e3, medium: 360e3, hard: 900e3, expert: 1500e3, master: 2400e3 },
  simpleTechniques: ['overlap', 'finish'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => `Mystery picture, ${p.size}×${p.cols}`,
  solvedTitle: (p) => `It's ${p.picture?.name || 'a picture'}!`,
  coach: [
    'The numbers by each row and column are the runs of shaded cells in that line, in order. "3 1" means three shaded, a gap, then one.',
    'Tap a cell to shade it. Switch the pen to Cross to mark cells you know are blank. Drag to mark a whole stretch.',
    'Start with the big numbers: a run of 8 in a line of 10 must cover the middle 6 cells, however it slides.',
    'Stuck? Hint shows a line you can work on now, and why.',
  ],
  badges: [
    { id: 'pg-gallery10', name: 'Collector', note: 'Uncover 10 pictures', test: (s) => s.solved.length >= 10 },
    { id: 'pg-big', name: 'Big picture', note: 'Solve a 20×20 or bigger', test: (s) => s.solved.some((r) => r.size >= 20) },
  ],
  playable: () => true,
  cellLabel: (p, i) => `Row ${Math.floor(i / p.cols) + 1}, column ${(i % p.cols) + 1}`,
  peers: (p, i) => [...lineCells(p, `r${Math.floor(i / p.cols)}`), ...lineCells(p, `c${i % p.cols}`)].filter((x) => x !== i),
  lineCells,
  lineDone: (p, key, vals) => same(cluesOf(vals), cluesFor(p, key)),
  move(p, i, dr, dc) {
    const r = Math.floor(i / p.cols) + dr, c = (i % p.cols) + dc;
    return r < 0 || c < 0 || r >= p.size || c >= p.cols ? -1 : r * p.cols + c;
  },
  buildBoard(el, p) {
    const R = p.size, C = p.cols;
    const maxRow = Math.max(1, ...p.rowClues.map((x) => x.length)), maxCol = Math.max(1, ...p.colClues.map((x) => x.length));
    el.style.setProperty('--n', R);
    el.style.setProperty('--c', C);
    el.style.setProperty('--rw', maxRow);
    el.style.setProperty('--ch', maxCol);
    let html = '<div class="pg-corner" aria-hidden="true"></div><div class="pg-cols">';
    p.colClues.forEach((cl, c) => { html += `<div class="pg-clue col${c % 5 === 4 && c < C - 1 ? ' b5' : ''}" data-line="c${c}" aria-label="Column ${c + 1}: ${cl.length ? cl.join(' ') : '0'}">${(cl.length ? cl : [0]).map((n) => `<b>${n}</b>`).join('')}</div>`; });
    html += '</div><div class="pg-rows">';
    p.rowClues.forEach((cl, r) => { html += `<div class="pg-clue row${r % 5 === 4 && r < R - 1 ? ' b5' : ''}" data-line="r${r}" aria-label="Row ${r + 1}: ${cl.length ? cl.join(' ') : '0'}">${(cl.length ? cl : [0]).map((n) => `<b>${n}</b>`).join('')}</div>`; });
    html += '</div><div class="pg-cells">';
    for (let r = 0; r < R; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < C; c++) html += `<div class="gk-cell${c % 5 === 4 && c < C - 1 ? ' b5r' : ''}${r % 5 === 4 && r < R - 1 ? ' b5b' : ''}" data-i="${r * C + c}"></div>`;
      html += '</div>';
    }
    el.innerHTML = `${html}</div>`;
  },
  // A row or column whose shading matches its numbers dims its clue.
  paint(board, { p, value }) {
    for (const el of board.querySelectorAll('[data-line]')) {
      const key = el.dataset.line;
      el.classList.toggle('done', same(cluesOf(lineCells(p, key).map((i) => (value(i) === 1 ? 1 : 0))), cluesFor(p, key)));
    }
  },
  shareCells: (p) => p.solution.map((v) => (v === 1 ? 2 : 1)),
  printCss: `table.pg { border: 0.6mm solid #000; } table.pg td { border: 0.2mm solid #888; width: var(--s); height: var(--s); padding: 0; }
    table.pg td.on { background: #000; } table.pg th { font-size: 8pt; font-weight: 700; padding: 0 0.8mm; color: #000; }
    table.pg th.c { vertical-align: bottom; line-height: 1.15; } table.pg th.r { text-align: right; white-space: nowrap; letter-spacing: .4mm; }
    table.pg td.b5r { border-right: 0.5mm solid #000; } table.pg tr.b5b td { border-bottom: 0.5mm solid #000; }`,
  printBoard(p, values, { answers }) {
    const R = p.size, C = p.cols, s = R <= 5 ? 16 : R <= 10 ? 11 : R <= 15 ? 8 : R <= 20 ? 6.5 : 5.4;
    let html = `<table class="pg" style="--s:${s}mm"><tr><th></th>${p.colClues.map((cl) => `<th class="c">${(cl.length ? cl : [0]).join('<br>')}</th>`).join('')}</tr>`;
    for (let r = 0; r < R; r++) {
      html += `<tr class="${r % 5 === 4 && r < R - 1 ? 'b5b' : ''}"><th class="r">${(p.rowClues[r].length ? p.rowClues[r] : [0]).join(' ')}</th>`;
      for (let c = 0; c < C; c++) html += `<td class="${values[r * C + c] === 1 ? 'on' : ''}${c % 5 === 4 && c < C - 1 ? ' b5r' : ''}"></td>`;
      html += '</tr>';
    }
    return `${html}</table>${answers && p.picture ? `<p class="intro" style="text-align:center">${esc(p.story?.ending || '')}</p>` : ''}`;
  },
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const R = Number(p.size), C = Number(p.cols);
    if (![5, 10, 15, 20, 25].includes(R) || C !== R || !Array.isArray(p.solution) || p.solution.length !== R * C) return null;
    const sol = p.solution.map((v) => (Number(v) === 1 ? 1 : 2));
    const rowClues = [...Array(R)].map((_, r) => cluesOf(sol.slice(r * C, r * C + C)));
    const colClues = [...Array(C)].map((_, c) => cluesOf([...Array(R)].map((_, r) => sol[r * C + c])));
    const givens = Array.isArray(p.givens) && p.givens.length === R * C ? p.givens.map((v, i) => (Number(v) === 1 && sol[i] === 1 ? 1 : 0)) : sol.map(() => 0);
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'].includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    const cellOk = (c) => Number.isInteger(c) && c >= 0 && c < R * C;
    return {
      kind: 'picture-grid', game: 'pg', id: str(p.id, 80), seed: str(p.seed, 80), size: R, cols: C, rowClues, colClues, givens, solution: sol,
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      picture: { id: str(p.picture?.id, 80), name: str(p.picture?.name, 80) || 'a picture' },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 3000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        marks: Array.isArray(s?.marks) ? s.marks.filter((m) => Array.isArray(m) && cellOk(m[0]) && (m[1] === 1 || m[1] === 2)).map((m) => [m[0], m[1]]).slice(0, 25) : [],
        cells: Array.isArray(s?.cells) ? s.cells.filter(cellOk).slice(0, 25) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: p.story ? { id: str(p.story.id, 80), title: str(p.story.title, 80), intro: str(p.story.intro), ending: str(p.story.ending) } : null,
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Shade cells so every row and column matches its numbers. When they all match, a picture appears and joins your gallery.</p>
    <h3>Reading the numbers</h3>
    <ul>
      <li>Each number is a run of shaded cells in that line, in order from left to right (or top to bottom).</li>
      <li>"3 1" means a run of three, then at least one blank cell, then one more shaded cell.</li>
      <li>"0" means nothing in that line is shaded.</li>
    </ul>
    <h3>Marking</h3>
    <ul>
      <li>Tap a cell to shade it. Choose the Cross pen to mark a cell you know is blank.</li>
      <li>Drag along a row or column to mark several cells at once. Tap a marked cell again to clear it.</li>
      <li>A line's numbers turn faint when it matches. With the option on, the rest of a finished line is crossed out for you.</li>
    </ul>
    <h3>Where to start</h3>
    <ol>
      <li>Big numbers first. A run of 8 in a line of 10 can slide two cells either way, so the middle 6 cells are always covered.</li>
      <li>Add the numbers and gaps: "4 5" in a line of 10 needs 4 + 1 + 5 = 10 cells, so the whole line is decided.</li>
      <li>Use what one line tells you in the lines that cross it.</li>
    </ol>
    <p>Every puzzle can be solved one line at a time, without guessing. Hint shows a line you can work on now, and why.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>A row of 5 cells has the number <b>4</b>. The run starts in cell 1 or cell 2, so cells 2, 3 and 4 are shaded either way.</p>
    <p>A column through cell 1 has the number <b>0</b>, so cell 1 is blank, and the run must be cells 2 to 5.</p>
    <p>Keys: arrows move, Space shades, X crosses, H hints, C checks.</p></div></div>`,
};
