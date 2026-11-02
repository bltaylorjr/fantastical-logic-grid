// Sum Cross's definition for the shared game screen (modules/grid-kit/kit.js).
const bit = (d) => 1 << (d - 1);
const bitCount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

// Every set of distinct numbers 1..9 by count and total.
const COMBOS = (() => {
  const t = {};
  for (let m = 1; m < 512; m++) {
    let s = 0;
    for (let d = 1; d <= 9; d++) if (m & bit(d)) s += d;
    ((t[bitCount(m)] ||= {})[s] ||= []).push(m);
  }
  return t;
})();

const cache = new WeakMap();
// Runs (with their clue cell and total), and which runs each cell is in.
function info(p) {
  let x = cache.get(p);
  if (x) return x;
  const R = p.size, C = p.cols, white = p.solution.map((d) => d > 0);
  const clue = new Map(p.clues.map(([cell, a, d]) => [cell, { across: a, down: d }]));
  const runs = [];
  for (let i = 0; i < R * C; i++) {
    if (white[i]) continue;
    for (const [dir, step] of [['across', 1], ['down', C]]) {
      const cells = [];
      for (let x2 = i + step; x2 < R * C && white[x2] && (step === C || x2 % C !== 0); x2 += step) cells.push(x2);
      if (cells.length) runs.push({ dir, clue: i, cells, sum: clue.get(i)?.[dir] ?? 0 });
    }
  }
  const runsAt = Array.from({ length: R * C }, () => []);
  runs.forEach((run, k) => run.cells.forEach((c) => runsAt[c].push(k)));
  x = { R, C, white, clue, runs, runsAt };
  cache.set(p, x);
  return x;
}

const LEVELS = [
  { id: 'basic', name: 'Basic', note: 'A small grid to learn on', sizes: [5] },
  { id: 'easy', name: 'Easy', note: 'Runs with one way to be made', sizes: [6, 7] },
  { id: 'medium', name: 'Medium', note: 'Fitting runs together', sizes: [7, 8] },
  { id: 'hard', name: 'Hard', note: 'Combinations that cross', sizes: [8, 9] },
  { id: 'expert', name: 'Expert', note: 'Pairs inside runs', sizes: [9, 10] },
  { id: 'master', name: 'Master', note: 'Big grids, few starting numbers', sizes: [10, 12] },
];

export const def = {
  id: 'sc',
  name: 'Sum Cross',
  kind: 'digits',
  eyebrow: 'The Logic Grid · Number puzzles',
  lede: 'A crossword of numbers: every run across and down adds up to its clue, with no number twice in a run. Every puzzle is new to you, proven to have one answer you can reach by logic alone, and tuned to how you play.',
  boardHelp: 'Arrow keys move between white cells, number keys fill in.',
  keysHelp: 'Arrow keys move between white cells. 1 to 9 fills a cell, Shift with a number writes a note. N switches notes on and off, A fills in notes, H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'],
  par: { basic: 90e3, easy: 240e3, medium: 480e3, hard: 840e3, expert: 1320e3, master: 2100e3 },
  simpleTechniques: ['nakedSingle', 'hiddenSingle'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.story?.title || `${p.difficulty.name} Sum Cross`,
  coach: [
    'Tap a white cell, then a number. On a keyboard, use the arrow keys and type the number.',
    'A clue square holds two totals: the upper right one is for the run going across, the lower left one for the run going down.',
    'Start with the runs that can only be made one way: 3 in two cells is always 1 + 2, and 17 in two cells is always 8 + 9.',
    'Stuck? Hint starts with a nudge. Ask again to see where to look, then why it works.',
  ],
  badges: [
    { id: 'sc-big', name: 'Long haul', note: 'Solve a 12×12 Sum Cross', test: (s) => s.solved.some((r) => r.size >= 12) },
    { id: 'sc-quick', name: 'Quick totals', note: 'Solve a Medium in under 6 minutes', test: (s) => s.solved.some((r) => r.d === 'medium' && r.ms < 360e3) },
  ],
  digits: () => [1, 2, 3, 4, 5, 6, 7, 8, 9],
  playable: (p, i) => p.solution[i] > 0,
  cellLabel(p, i) {
    const { C, runs, runsAt } = info(p);
    const sums = runsAt[i].map((k) => `${runs[k].dir} ${runs[k].sum}`).join(', ');
    return `Row ${Math.floor(i / C) + 1}, column ${(i % C) + 1} (${sums})`;
  },
  peers(p, i) { const { runs, runsAt } = info(p); return [...new Set(runsAt[i].flatMap((k) => runs[k].cells))].filter((x) => x !== i); },
  units(p, i) { const { runs, runsAt } = info(p); return runsAt[i].map((k) => runs[k].cells); },
  clashes(p, vals) {
    const { runs } = info(p);
    const out = new Set();
    for (const run of runs) {
      const seen = {};
      for (const c of run.cells) if (vals[c]) (seen[vals[c]] ||= []).push(c);
      for (const cs of Object.values(seen)) if (cs.length > 1) cs.forEach((c) => out.add(c));
      const vs = run.cells.map((c) => vals[c]);
      const total = vs.reduce((a, b) => a + (b || 0), 0);
      if ((vs.every(Boolean) && total !== run.sum) || total > run.sum) run.cells.forEach((c) => { if (vals[c]) out.add(c); });
    }
    return out;
  },
  // Notes: numbers no run of this cell already has, that some way of making both runs allows.
  allowed(p, i, valueAt) {
    const { runs, runsAt } = info(p);
    let m = 511;
    for (const k of runsAt[i]) {
      const run = runs[k];
      let placed = 0;
      for (const c of run.cells) if (c !== i && valueAt(c)) placed |= bit(valueAt(c));
      const ok = (COMBOS[run.cells.length]?.[run.sum] || []).filter((x) => (x & placed) === placed).reduce((a, x) => a | x, 0);
      m &= ok & ~placed;
    }
    return m;
  },
  move(p, i, dr, dc) {
    const { R, C, white } = info(p);
    let r = Math.floor(i / C), c = i % C;
    for (;;) {
      r += dr; c += dc;
      if (r < 0 || c < 0 || r >= R || c >= C) return -1;
      if (white[r * C + c]) return r * C + c;
    }
  },
  buildBoard(el, p) {
    const { R, C, white, clue } = info(p);
    el.style.setProperty('--n', R);
    el.style.setProperty('--c', C);
    let html = '';
    for (let r = 0; r < R; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (white[i]) html += `<div class="gk-cell" data-i="${i}"><span class="v"></span><span class="gk-notes" style="--nc:3"></span></div>`;
        else {
          const k = clue.get(i);
          html += k ? `<div class="gk-block clue" data-clue="${i}">${k.across ? `<span class="a" data-run="across">${k.across}</span>` : ''}${k.down ? `<span class="d" data-run="down">${k.down}</span>` : ''}</div>` : '<div class="gk-block"></div>';
        }
      }
      html += '</div>';
    }
    el.innerHTML = html;
  },
  // Clues whose run is complete and adds up show as done.
  paint(board, { p, value }) {
    const { runs } = info(p);
    for (const run of runs) {
      const vs = run.cells.map(value);
      const done = vs.every(Boolean) && vs.reduce((a, b) => a + b, 0) === run.sum && new Set(vs).size === vs.length;
      board.querySelector(`[data-clue="${run.clue}"] [data-run="${run.dir}"]`)?.classList.toggle('done', done);
    }
  },
  shareCells: (p) => p.solution.map((d, i) => (d ? (p.givens[i] ? 2 : 1) : p.clues.some(([c]) => c === i) ? 2 : 0)),
  printCss: `table.sc { border: 0.6mm solid #000; } table.sc td { border: 0.3mm solid #000; text-align: center; vertical-align: middle; font-weight: 700; position: relative; padding: 0; }
    table.sc td.b { background: #333; } table.sc td.k { background: linear-gradient(to top right, #d9d9d9 calc(50% - .2mm), #000 50%, #d9d9d9 calc(50% + .2mm)); color: #000; }
    table.sc td.k i { position: absolute; font-style: normal; font-size: 8pt; } table.sc td.k i.a { right: 1mm; top: 0.5mm; } table.sc td.k i.d { left: 1mm; bottom: 0.5mm; }
    table.sc.n5 td, table.sc.n6 td { width: 20mm; height: 20mm; font-size: 18pt; } table.sc.n7 td, table.sc.n8 td { width: 16mm; height: 16mm; font-size: 15pt; } table.sc.n9 td, table.sc.n10 td { width: 13.5mm; height: 13.5mm; font-size: 13pt; } table.sc.n12 td { width: 11.5mm; height: 11.5mm; font-size: 11pt; }`,
  printBoard(p, values) {
    const { R, C, white, clue } = info(p);
    let rows = '';
    for (let r = 0; r < R; r++) {
      rows += '<tr>';
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (white[i]) rows += `<td>${Number(values[i]) || ''}</td>`;
        else { const k = clue.get(i); rows += k ? `<td class="k">${k.across ? `<i class="a">${k.across}</i>` : ''}${k.down ? `<i class="d">${k.down}</i>` : ''}</td>` : '<td class="b"></td>'; }
      }
      rows += '</tr>';
    }
    return `<table class="sc n${R}">${rows}</table>`;
  },
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const R = Number(p.size), C = Number(p.cols);
    if (![5, 6, 7, 8, 9, 10, 12].includes(R) || C !== R || !Array.isArray(p.solution) || p.solution.length !== R * C || !Array.isArray(p.clues)) return null;
    const sol = p.solution.map(Number);
    if (sol.some((d) => !Number.isInteger(d) || d < 0 || d > 9)) return null;
    const clues = p.clues.map((x) => (Array.isArray(x) ? x.slice(0, 3).map(Number) : [-1])).filter(([c, a, d]) => Number.isInteger(c) && c >= 0 && c < R * C && !sol[c] && a >= 0 && a <= 45 && d >= 0 && d <= 45);
    const givens = Array.isArray(p.givens) && p.givens.length === R * C ? p.givens.map((d, i) => (Number(d) === sol[i] && sol[i] ? sol[i] : 0)) : sol.map(() => 0);
    const test = { size: R, cols: C, solution: sol, clues, givens };
    // Every run must add up, with no number twice.
    for (const run of info(test).runs) {
      const vs = run.cells.map((c) => sol[c]);
      if (new Set(vs).size !== vs.length || vs.reduce((a, b) => a + b, 0) !== run.sum) return null;
    }
    const str = (s, n = 400) => String(s ?? '').slice(0, n);
    const lvl = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'].includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    return {
      ...test, kind: 'sum-cross', game: 'sc', id: str(p.id, 80), seed: str(p.seed, 80),
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 3000).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        place: Array.isArray(s?.place) && Number.isInteger(s.place[0]) && s.place[0] >= 0 && s.place[0] < R * C && Number.isInteger(s.place[1]) ? [s.place[0], s.place[1]] : null,
        cells: Array.isArray(s?.cells) ? s.cells.filter((c) => Number.isInteger(c) && c >= 0 && c < R * C).slice(0, 20) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story: p.story ? { id: str(p.story.id, 80), title: str(p.story.title, 80), intro: str(p.story.intro), ending: str(p.story.ending) } : null,
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Fill every white cell with a number from 1 to 9. A run is a line of white cells going across or down, between dark squares.</p>
    <ul>
      <li>Each run adds up to its clue.</li>
      <li>No number appears twice in the same run.</li>
    </ul>
    <h3>Reading the clues</h3>
    <p>A clue square is split by a diagonal. The number in the <b>upper right</b> is the total of the run going <b>across</b> to its right. The number in the <b>lower left</b> is the total of the run going <b>down</b> below it.</p>
    <h3>Where to start</h3>
    <ol>
      <li>Some totals can only be made one way. In two cells: 3 is 1 + 2, 4 is 1 + 3, 16 is 7 + 9 and 17 is 8 + 9. In three cells: 6 is 1 + 2 + 3 and 24 is 7 + 8 + 9.</li>
      <li>Where an across run and a down run cross, the cell needs a number both runs allow.</li>
      <li>Fill notes lists, for every cell, the numbers its two runs still allow.</li>
      <li>A clue turns faint when its run is complete and adds up.</li>
    </ol>
    <h3>Hints that teach</h3>
    <p>Hint first gives a nudge, then shows where to look, then explains why. Every puzzle can be solved by logic alone. On bigger grids a few numbers may start filled in, only where the logic needs them.</p>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>An across run of two cells has the clue <b>4</b>. With no repeats, 4 in two cells can only be 1 + 3.</p>
    <p>The first of those cells also starts a down run of two with the clue <b>3</b>, which is always 1 + 2. The only number in both lists is 1, so that cell is 1, and the other cell of the 4 is 3.</p>
    <p>Keys: arrows move, 1 to 9 fill in, Shift with a number writes a note, H hints, C checks.</p></div></div>`,
};
