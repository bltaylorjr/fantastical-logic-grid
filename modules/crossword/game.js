// The Crossword's definition for the shared game screen (modules/grid-kit/kit.js,
// kind 'letters'). Cells hold 1 to 26 (A to Z); black squares are not cells
// at all. Typing follows the current answer, Across or Down; the clue for the
// square you are on shows above the grid, and both clue lists sit beside it.
import { cleanStory } from '../grid-kit/story.js';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SIZES = [5, 7, 9, 11, 13];
const LEVEL_IDS = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
const L = (v) => String.fromCharCode(64 + v);

const LEVELS = [
  { id: 'basic', name: 'Basic', note: 'A 5×5 mini, easy clues', sizes: [5] },
  { id: 'easy', name: 'Easy', note: 'Minis and 7×7 midis', sizes: [5, 7] },
  { id: 'medium', name: 'Medium', note: 'Your first themes', sizes: [7, 9] },
  { id: 'hard', name: 'Hard', note: 'Themed 9×9 and 11×11', sizes: [9, 11] },
  { id: 'expert', name: 'Expert', note: 'Bigger grids, trickier clues', sizes: [11, 13] },
  { id: 'master', name: 'Master', note: 'The toughest clues', sizes: [13] },
];

// Which answers go through each square: { A: entry, D: entry }.
const cache = new WeakMap();
function info(p) {
  let x = cache.get(p);
  if (x) return x;
  const at = Array.from({ length: p.size * p.cols }, () => ({}));
  const list = [...p.across.map((e) => ({ ...e, dir: 'A' })), ...p.down.map((e) => ({ ...e, dir: 'D' }))];
  for (const e of list) for (const c of e.cells) at[c][e.dir] = e;
  const circles = new Set(p.circles || []);
  x = { at, list, circles, done: new Set() };
  cache.set(p, x);
  return x;
}
const entryAt = (p, i, dir) => { const a = info(p).at[i] || {}; return a[dir] || a[dir === 'A' ? 'D' : 'A'] || null; };
const dirName = (d) => (d === 'A' ? 'Across' : 'Down');

const CSS = `
.gk-app .gk-cw { gap: 0; }
.gk-app .gk-cw .gk-row { gap: 0; }
.gk-app .gk-cw .gk-cell, .gk-app .gk-cw .cw-blk { position: relative; border: 1px solid var(--gk-border); border-radius: 0; margin: 0; }
.gk-app .gk-cw .cw-blk { background: var(--gk-text); aspect-ratio: 1; }
.gk-app .gk-cw .gk-cell .v { font-size: calc(min(92vw, 620px) / var(--n) * .52); font-weight: 700; text-transform: uppercase; }
.gk-app .gk-cw .cw-num { position: absolute; left: 2px; top: 1px; font-size: clamp(7px, calc(min(92vw, 620px) / var(--n) * .24), 12px); line-height: 1; font-weight: 700; color: var(--gk-muted); pointer-events: none; }
.gk-app .gk-cw .gk-cell.cw-circle::before { content: ""; position: absolute; inset: 7%; border: 1.5px solid var(--gk-muted); border-radius: 50%; pointer-events: none; }
.gk-app .gk-cw .gk-cell.peer { background: color-mix(in srgb, var(--gk-accent) 16%, var(--gk-bg)); }
.gk-app .gk-cw .gk-cell.sel { background: color-mix(in srgb, var(--gk-accent) 38%, var(--gk-bg)); box-shadow: inset 0 0 0 3px var(--gk-focus); }
.gk-app .gk-cw .gk-cell .gk-notes { display: none; }
.gk-app .gk-cw.won .gk-cell .v { color: var(--gk-hint); }
.gk-app .cw-bar { margin: 0 0 8px; padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--gk-accent) 14%, var(--gk-bg)); font-size: 1.05rem; min-height: 2.6em; }
.gk-app .cw-bar b { margin-right: .4em; }
.gk-app .gk-clues { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 12px; }
.gk-app .gk-clues h3 { margin: 0 0 4px; font-size: 1rem; }
.gk-app .gk-clues ol { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow: auto; }
.gk-app .gk-clues li button { all: unset; display: flex; gap: 6px; width: 100%; box-sizing: border-box; padding: 4px 6px; border-radius: 6px; cursor: pointer; line-height: 1.35; }
.gk-app .gk-clues li button:focus-visible { outline: 3px solid var(--gk-focus); }
.gk-app .gk-clues li button b { min-width: 1.8em; }
.gk-app .gk-clues li.on button { background: color-mix(in srgb, var(--gk-accent) 24%, var(--gk-bg)); }
.gk-app .gk-clues li.cross button { background: color-mix(in srgb, var(--gk-accent) 9%, var(--gk-bg)); }
.gk-app .gk-clues li.done button { color: var(--gk-muted); }
.gk-app .cw-note { grid-column: 1 / -1; margin: 0; padding: 8px 10px; border-left: 4px solid var(--gk-accent); background: var(--gk-soft); border-radius: 6px; }
.gk-app .gk-keys { display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px; }
.gk-app .gk-keyrow { display: flex; gap: 4px; justify-content: center; }
.gk-app .gk-key { flex: 1 1 0; max-width: 44px; min-height: 48px; border-radius: 8px; border: 1px solid var(--gk-border); background: var(--gk-bg); color: var(--gk-text); font: inherit; font-weight: 700; font-size: 1.05rem; cursor: pointer; }
.gk-app .gk-key.wide { max-width: 64px; flex-grow: 1.5; }
.gk-app .gk-key:active { transform: scale(.95); }
@media (max-width: 720px) {
  .gk-app .gk-clues { grid-template-columns: 1fr; } .gk-app .gk-clues ol { max-height: 30vh; }
  /* Phones: the keys stay at the bottom of the screen while you play. */
  .gk-app .gk-keys { position: sticky; bottom: 0; z-index: 5; padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); background: var(--gk-bg); border-top: 1px solid var(--gk-border); margin: 0 -8px 12px; }
  .gk-app .gk-key { min-height: 44px; font-size: 1rem; }
}
:root[data-theme="contrast"] .gk-app .gk-cw .cw-blk { background: #fff; }
:root[data-theme="contrast"] .gk-app .gk-cw .gk-cell { background: #000; color: #fff; }
`;
function addStyle(el) {
  const doc = el.ownerDocument;
  if (!doc || doc.getElementById('cw-style')) return;
  const s = doc.createElement('style');
  s.id = 'cw-style';
  s.textContent = CSS;
  doc.head.append(s);
}

function clueLists(p) {
  const row = (e, d) => `<li data-n="${e.n}" data-d="${d}"><button type="button" data-cell="${e.cells[0]}" data-dir="${d}"><b>${e.n}</b><span>${esc(e.clue)}</span></button></li>`;
  return `${p.theme ? `<p class="cw-note"><b>${esc(p.theme.title)}.</b> ${esc(p.theme.note)}</p>` : ''}
    <section aria-label="Across clues"><h3>Across</h3><ol>${p.across.map((e) => row(e, 'A')).join('')}</ol></section>
    <section aria-label="Down clues"><h3>Down</h3><ol>${p.down.map((e) => row(e, 'D')).join('')}</ol></section>`;
}

function printGrid(p, values, answers) {
  const N = p.size;
  const s = N <= 5 ? 16 : N <= 7 ? 13 : N <= 9 ? 11 : N <= 11 ? 9.5 : 8.2;
  let rows = '';
  for (let r = 0; r < N; r++) {
    rows += '<tr>';
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (p.blocks[i]) { rows += '<td class="b"></td>'; continue; }
      const v = Number(values[i]);
      rows += `<td class="${(p.circles || []).includes(i) ? 'o' : ''}">${p.numbers[i] ? `<b>${p.numbers[i]}</b>` : ''}${v ? `<i>${L(v)}</i>` : ''}</td>`;
    }
    rows += '</tr>';
  }
  return `<table class="cw" style="--s:${s}mm">${rows}</table>`;
}

export const def = {
  id: 'cw',
  name: 'Crossword',
  kind: 'letters',
  maxValue: 26,
  eyebrow: 'The Logic Grid · Word puzzles',
  lede: 'Fill the grid with words that match the clues, Across and Down. Every puzzle is built fresh for you, every answer and clue comes from a real dictionary, and the grids follow the rules of the big newspaper crosswords: symmetric, fully interlocking, every square in two answers.',
  boardHelp: 'Type letters. Arrow keys move, Space turns Across into Down, Tab goes to the next answer.',
  keysHelp: 'Type a letter to fill the square; typing moves along the answer. Arrow keys move (an arrow across the answer turns first). Space or Enter turns Across into Down. Tab goes to the next answer, Shift+Tab back. Backspace erases and goes back. ? gives a hint, ! checks, Esc pauses, Ctrl+Z undoes.',
  levels: LEVELS,
  daily: ['expert', 'basic', 'easy', 'medium', 'medium', 'hard', 'hard'],
  par: { basic: 90e3, easy: 240e3, medium: 480e3, hard: 900e3, expert: 1500e3, master: 2100e3 },
  simpleTechniques: ['easy', 'crossing'],
  sizeLabel: (n) => `${n}×${n}`,
  titleOf: (p) => p.theme?.title || p.story?.title || `${p.difficulty.name} Crossword`,
  solvedTitle: (p) => (p.theme ? `Solved! ${p.theme.title}: ${p.theme.members.map((m) => m.toLowerCase()).join(', ')}.` : 'Every word is in!'),
  leftWord: 'square',
  coach: [
    'Tap a square and type. Typing follows the answer you are on; tap the square again (or press Space) to switch between Across and Down.',
    'Start with the clues you are sure of. Every letter you write is part of a crossing answer, so each one helps two clues.',
    'Starred clues are the theme. The note above the clues says what they share.',
    'Stuck? Hint points to the easiest clue right now, then where it goes, then gives one letter.',
  ],
  badges: [
    { id: 'cw-big', name: 'Big grid', note: 'Solve a 13×13 crossword', test: (s) => s.solved.some((r) => r.size >= 13) },
    { id: 'cw-clean', name: 'Clean sheet', note: 'Solve a Medium or harder crossword with no hints or mistakes', test: (s) => s.solved.some((r) => ['medium', 'hard', 'expert', 'master'].includes(r.d) && !r.hints && !r.mistakes) },
  ],
  digits: () => [...Array(26)].map((_, k) => k + 1),
  clashes: () => new Set(),
  playable: (p, i) => !p.blocks[i],
  cellLabel: (p, i, dir = 'A') => {
    const e = entryAt(p, i, dir);
    if (!e) return `Row ${Math.floor(i / p.size) + 1}, column ${(i % p.size) + 1}`;
    return `${e.n} ${dirName(e.dir)}, square ${e.cells.indexOf(i) + 1} of ${e.cells.length}: ${e.clue}`;
  },
  peers: (p, i, dir = 'A') => entryAt(p, i, dir)?.cells.filter((x) => x !== i) || [],
  units: (p, i) => Object.values(info(p).at[i] || {}).map((e) => e.cells),
  move(p, i, dr, dc) {
    const N = p.size;
    let r = Math.floor(i / N) + dr, c = (i % N) + dc;
    while (r >= 0 && c >= 0 && r < N && c < N) {
      if (!p.blocks[r * N + c]) return r * N + c;
      r += dr; c += dc;
    }
    return -1;
  },
  // Typing: the next square of the answer, then on to the next answer's first empty square.
  advance(p, i, dir, step, valueAt) {
    const e = entryAt(p, i, dir);
    if (!e) return -1;
    const k = e.cells.indexOf(i) + step;
    if (k >= 0 && k < e.cells.length) {
      if (step > 0) {
        // Skip ahead to the next empty square of this answer, if there is one.
        const empty = e.cells.slice(k).find((x) => !valueAt(x));
        return empty ?? e.cells[k];
      }
      return e.cells[k];
    }
    if (step < 0) return -1;
    const [next] = def.nextWord(p, i, e.dir, 1, valueAt);
    return next;
  },
  turn(p, i, dir) { const other = dir === 'A' ? 'D' : 'A'; return info(p).at[i]?.[other] ? other : dir; },
  dirFor(p, i, dir) { return info(p).at[i]?.[dir] ? dir : dir === 'A' ? 'D' : 'A'; },
  canGo: (p, i, dir) => !!info(p).at[i]?.[dir],
  nextWord(p, i, dir, step, valueAt) {
    const { list } = info(p);
    const cur = entryAt(p, i, dir);
    let k = list.findIndex((e) => e.dir === cur?.dir && e.n === cur?.n);
    for (let t = 0; t < list.length; t++) {
      k = (k + step + list.length) % list.length;
      const e = list[k];
      const empty = e.cells.find((x) => !valueAt(x));
      if (empty != null || t === list.length - 1) return [empty ?? e.cells[0], e.dir];
    }
    return [i, dir];
  },
  buildBoard(el, p) {
    addStyle(el);
    const N = p.size;
    const circles = new Set(p.circles || []);
    el.style.setProperty('--n', N);
    el.style.setProperty('--c', N);
    let html = '';
    for (let r = 0; r < N; r++) {
      html += '<div class="gk-row">';
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (p.blocks[i]) { html += '<div class="cw-blk" aria-hidden="true"></div>'; continue; }
        html += `<div class="gk-cell${circles.has(i) ? ' cw-circle' : ''}" data-i="${i}">${p.numbers[i] ? `<span class="cw-num" aria-hidden="true">${p.numbers[i]}</span>` : ''}<span class="v"></span><span class="gk-notes"></span></div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
    // The clue bar above the grid, and the clue lists beside it.
    const wrap = el.closest('.gk-board-wrap');
    if (wrap && !wrap.querySelector('.cw-bar')) wrap.insertAdjacentHTML('afterbegin', '<p class="cw-bar" aria-live="polite"></p>');
    const app = el.closest('.gk-app');
    const box = app?.querySelector('#cw-clues');
    if (box && el.id === 'cw-board') {
      box.innerHTML = clueLists(p);
      box.onclick = (e) => {
        const b = e.target.closest('[data-cell]');
        if (b && box.selectClue) box.selectClue(Number(b.dataset.cell), b.dataset.dir);
      };
    }
  },
  paint(board, { p, value, sel, dir, select }) {
    if (board.id !== 'cw-board') return;
    const app = board.closest('.gk-app');
    const e = entryAt(p, sel, dir || 'A');
    const bar = app?.querySelector('.cw-bar');
    if (bar) bar.innerHTML = e ? `<b>${e.n} ${dirName(e.dir)}</b>${esc(e.clue)}` : '';
    const box = app?.querySelector('#cw-clues');
    if (!box) return;
    box.selectClue = (i, d) => select(i, d);
    const cross = e ? entryAt(p, sel, e.dir === 'A' ? 'D' : 'A') : null;
    for (const li of box.querySelectorAll('li[data-n]')) {
      const n = Number(li.dataset.n), d = li.dataset.d;
      const ent = (d === 'A' ? p.across : p.down).find((x) => x.n === n);
      li.classList.toggle('on', !!e && e.n === n && e.dir === d);
      li.classList.toggle('cross', !!cross && cross !== e && cross.n === n && cross.dir === d);
      li.classList.toggle('done', !!ent && ent.cells.every((x) => value(x)));
    }
    const on = box.querySelector('li.on');
    if (on) { const ol = on.parentElement; if (on.offsetTop < ol.scrollTop || on.offsetTop > ol.scrollTop + ol.clientHeight - on.offsetHeight) ol.scrollTop = on.offsetTop - ol.clientHeight / 3; }
    // A story moment when a theme answer is found (right), once each.
    const beats = p.story?.themeBeats || [];
    const x = info(p);
    const themed = [...p.across, ...p.down].filter((t) => t.theme);
    themed.forEach((t, k) => {
      const key = `${t.n}${p.across.includes(t) ? 'A' : 'D'}`;
      if (x.done.has(key) || !t.cells.every((c) => value(c) === p.solution[c])) return;
      x.done.add(key);
      const m = app.querySelector('#cw-moment'), mt = app.querySelector('#cw-moment-text');
      if (m && mt && beats[k]) { mt.textContent = beats[k]; m.hidden = false; }
    });
  },
  shareCells: (p) => p.blocks.map((b) => (b ? 2 : 1)),
  printCss: `table.cw { border-collapse: collapse; border: 0.7mm solid #000; margin: 0 auto 4mm; }
    table.cw td { position: relative; width: var(--s); height: var(--s); min-width: var(--s); border: 0.25mm solid #000; padding: 0; text-align: center; vertical-align: middle; }
    table.cw td.b { background: #000; }
    table.cw td.o::before { content: ""; position: absolute; inset: 6%; border: 0.25mm solid #555; border-radius: 50%; }
    table.cw td b { position: absolute; left: 0.5mm; top: 0.3mm; font-size: 6pt; line-height: 1; }
    table.cw td i { font-style: normal; font-weight: 700; font-size: calc(var(--s) * 0.55); }
    .cwc { columns: 2; column-gap: 6mm; font-size: 9pt; } .cwc h3 { font-size: 10pt; margin: 0 0 1mm; break-after: avoid; } .cwc ol { list-style: none; padding: 0; margin: 0 0 3mm; } .cwc li { margin: 0 0 0.8mm; break-inside: avoid; } .cwc li b { display: inline-block; min-width: 6mm; }
    .cwnote { font-size: 9.5pt; margin: 0 0 3mm; }`,
  printBoard(p, values, { answers }) {
    const grid = printGrid(p, values, answers);
    if (answers) return grid;
    const list = (es) => es.map((e) => `<li><b>${e.n}</b>${esc(e.clue)}</li>`).join('');
    return `${p.theme ? `<p class="cwnote"><b>${esc(p.theme.title)}.</b> ${esc(p.theme.note)}</p>` : ''}${grid}<div class="cwc"><h3>Across</h3><ol>${list(p.across)}</ol><h3>Down</h3><ol>${list(p.down)}</ol></div>`;
  },
  // A puzzle from a saved game or a file, checked before it reaches the page.
  cleanPuzzle(p) {
    if (!p || typeof p !== 'object') return null;
    const N = Number(p.size);
    if (!SIZES.includes(N) || Number(p.cols) !== N) return null;
    const cells = N * N;
    const arr = (a, ok) => (Array.isArray(a) && a.length === cells && a.every(ok) ? a.map(Number) : null);
    const blocks = arr(p.blocks, (v) => v === 0 || v === 1);
    const solution = arr(p.solution, (v) => Number.isInteger(v) && v >= 0 && v <= 26);
    const numbers = arr(p.numbers, (v) => Number.isInteger(v) && v >= 0 && v < 400);
    if (!blocks || !solution || !numbers || solution.some((v, i) => !blocks[i] !== v > 0)) return null;
    const str = (s, n = 300) => String(s ?? '').slice(0, n);
    const cellOk = (c) => Number.isInteger(c) && c >= 0 && c < cells && !blocks[c];
    const entry = (e) => {
      if (!e || !Array.isArray(e.cells) || !e.cells.length || !e.cells.every(cellOk)) return null;
      const answer = str(e.answer, 30).toUpperCase().replace(/[^A-Z]/g, '');
      if (answer.length !== e.cells.length || e.cells.some((c, k) => solution[c] !== answer.charCodeAt(k) - 64)) return null;
      return { n: Number(e.n) || 0, cells: e.cells.slice(), answer, clue: str(e.clue), clueLevel: Number(e.clueLevel) || 0, clueKind: str(e.clueKind, 30), theme: e.theme && typeof e.theme === 'object' ? { member: str(e.theme.member, 30).toUpperCase(), at: Number(e.theme.at) || 0 } : null };
    };
    const across = (Array.isArray(p.across) ? p.across : []).map(entry), down = (Array.isArray(p.down) ? p.down : []).map(entry);
    if (!across.length || !down.length || across.includes(null) || down.includes(null)) return null;
    const lvl = LEVEL_IDS.includes(p.difficulty?.id) ? p.difficulty.id : 'medium';
    const story = cleanStory(p.story);
    if (story && Array.isArray(p.story?.themeBeats)) story.themeBeats = p.story.themeBeats.slice(0, 8).map((b) => str(b, 200));
    return {
      kind: 'crossword', game: 'cw', id: str(p.id, 80), seed: str(p.seed, 80), size: N, cols: N, blocks, solution, numbers,
      givens: Array(cells).fill(0), circles: (Array.isArray(p.circles) ? p.circles : []).filter(cellOk).slice(0, cells),
      across, down,
      theme: p.theme && typeof p.theme === 'object' ? { set: str(p.theme.set, 30), kind: str(p.theme.kind, 20), title: str(p.theme.title, 80), note: str(p.theme.note), members: (Array.isArray(p.theme.members) ? p.theme.members : []).slice(0, 8).map((m) => str(m, 30)) } : null,
      difficulty: { id: lvl, name: LEVELS.find((l) => l.id === lvl).name },
      solvePath: (Array.isArray(p.solvePath) ? p.solvePath : []).slice(0, 400).map((s) => ({
        technique: str(s?.technique, 40), techniqueName: str(s?.techniqueName, 60), why: str(s?.why),
        marks: Array.isArray(s?.marks) ? s.marks.filter((m) => Array.isArray(m) && cellOk(m[0]) && Number.isInteger(m[1]) && m[1] >= 1 && m[1] <= 26).map((m) => [m[0], m[1]]).slice(0, 30) : [],
        cells: Array.isArray(s?.cells) ? s.cells.filter(cellOk).slice(0, 30) : [],
      })),
      toughness: Number(p.toughness) || 0, fingerprint: str(p.fingerprint, 80),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 8).map((r) => str(r)),
      story,
    };
  },
  howto: `
    <div class="gk-howto-cols"><div>
    <h3>The goal</h3>
    <p>Write a letter in every white square so each answer matches its clue. Across answers read left to right, Down answers top to bottom, and every letter belongs to one of each.</p>
    <h3>Typing</h3>
    <ul>
      <li>Tap a square and type. The answer you are on is highlighted, and its clue shows above the grid.</li>
      <li>Tap the same square again, or press Space, to switch between Across and Down.</li>
      <li>Tap any clue in the lists to jump to its answer. Tab goes to the next answer.</li>
      <li>Backspace erases and goes back. Check marks wrong letters in red.</li>
    </ul>
    <h3>Themes</h3>
    <p>From Medium up, starred clues share a theme, explained in the note above the clues. Circled squares spell a hidden word.</p>
    <h3>Where to start</h3>
    <ol>
      <li>Fill-in-the-blank clues (like "___ cream") are often the easiest way in.</li>
      <li>Short answers have fewer possibilities; one or two crossing letters usually settle them.</li>
      <li>A clue's tense and number match its answer: a plural clue means a plural answer.</li>
    </ol>
    </div>
    <div class="gk-howto-ex"><p><b>A worked example</b></p>
    <p>1 Across: "Frozen dessert" (8 letters), and 1 Down starts with I.</p>
    <p>An 8-letter frozen dessert starting with I: ICE CREAM, written ICECREAM. Its letters now give the first letter of every Down answer that crosses it.</p>
    <p>Keys: type letters, arrows move, Space turns, Tab next answer, ? hint, ! check.</p></div></div>`,
};
