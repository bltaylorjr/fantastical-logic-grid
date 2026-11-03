// The daily puzzles of NINETIMESNINE, Cage Math, Sum Cross and Picture Grid,
// made outside the browser exactly as each game makes them, for:
//   - the answer key pages, <game>/daily/<date>/ (scripts/build.mjs), and
//   - the daily puzzle posts (scripts/social-games.mjs, run each morning by
//     .github/workflows/daily-puzzle-social.yml).
// The Fantastical Logic Grid's daily puzzle has its own pages (scripts/seo.mjs)
// and post (scripts/social-puzzle.mjs).
//
// Each game's daily puzzle comes from a fixed seed for the date, the game's
// own daily options and the admin's switches for that game (GET /v1/config:
// daily on or off, stories on or off, highest level), so it is the same puzzle
// every player gets in the game that day. Dates are UTC days, like the games.
//
// checkDaily() proves a puzzle before it is posted: no broken text, the answer
// obeys every rule of the game (checked here, independently of the engine), the
// givens match the answer, and the engine's step-by-step solver, run again from
// scratch, solves it without guessing to that same answer, so it has exactly
// one answer. NINETIMESNINE and Cage Math are also counted by a full search.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPS as NP } from '../engine/src/np-ops.js';
import { OPS as CM } from '../engine/src/cm-ops.js';
import { OPS as SC } from '../engine/src/sc-ops.js';
import { OPS as PG } from '../engine/src/pg-ops.js';
import { makeShape, countSolutions, solveLogically } from '../engine/src/number-place.js';
import { solveCageMath, countCageMath } from '../engine/src/cage-math.js';
import { solveSumCross } from '../engine/src/sum-cross.js';
import { solvePictureGrid } from '../engine/src/picture-grid.js';
import { KIT_LEVELS } from '../engine/src/kit-common.js';
import { def as cmDef } from '../modules/cage-math/game.js';
import { def as scDef } from '../modules/sum-cross/game.js';
import { def as pgDef } from '../modules/picture-grid/game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const todayUtc = () => new Date().toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

// NINETIMESNINE's daily level by weekday (modules/number-place/ui.js, DAILY_BY_WEEKDAY).
const NP_DAILY = ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'];
const NP_LEVEL_NAMES = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };

// NINETIMESNINE's printed board (the same as modules/number-place/print.js).
const NP_CSS = `table.np { border-collapse: collapse; border: 0.9mm solid #000; } table.np td { border: 0.25mm solid #666; text-align: center; vertical-align: middle; font-weight: 700; }
  table.np.n9 td { width: 15mm; height: 15mm; font-size: 17pt; } table.np.n6 td { width: 20mm; height: 20mm; font-size: 21pt; } table.np.n4 td { width: 26mm; height: 26mm; font-size: 25pt; }
  table.np td.bt { border-top: 0.9mm solid #000; } table.np td.bl { border-left: 0.9mm solid #000; } table.np td.even { background: #d9d9d9; } table.np td.p { color: #5B3CC4; }`;
function npBoard(p, values) {
  const N = p.size, [br, bc] = p.box;
  let rows = '';
  for (let r = 0; r < N; r++) {
    rows += '<tr>';
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      rows += `<td class="${[r % br === 0 ? 'bt' : '', c % bc === 0 ? 'bl' : '', p.evenCells.includes(i) ? 'even' : '', p.givens[i] ? 'g' : 'p'].join(' ').trim()}">${Number(values[i]) || ''}</td>`;
    }
    rows += '</tr>';
  }
  return `<table class="np n${N}">${rows}</table>`;
}

// ---------- independent rule checks (not the engine's code) ----------
const isSet = (vals, n) => vals.length === n && new Set(vals).size === n && vals.every((v) => Number.isInteger(v) && v >= 1 && v <= n);
function latinProblems(sol, N) {
  for (let r = 0; r < N; r++) if (!isSet(sol.slice(r * N, r * N + N), N)) return [`row ${r + 1} does not hold every number once`];
  for (let c = 0; c < N; c++) if (!isSet([...Array(N)].map((_, r) => sol[r * N + c]), N)) return [`column ${c + 1} does not hold every number once`];
  return [];
}
function npRules(p) {
  const N = p.size, [br, bc] = p.box, s = p.solution, out = latinProblems(s, N);
  for (let b = 0; b < N; b++) {
    const r0 = Math.floor(b / (N / bc)) * br, c0 = (b % (N / bc)) * bc, vals = [];
    for (let r = 0; r < br; r++) for (let c = 0; c < bc; c++) vals.push(s[(r0 + r) * N + c0 + c]);
    if (!isSet(vals, N)) out.push(`box ${b + 1} does not hold every number once`);
  }
  if (p.variants.includes('diagonal')) {
    if (!isSet([...Array(N)].map((_, i) => s[i * N + i]), N) || !isSet([...Array(N)].map((_, i) => s[i * N + N - 1 - i]), N)) out.push('a diagonal repeats a number');
  }
  if (p.evenCells.some((i) => s[i] % 2)) out.push('a shaded cell is odd');
  return out;
}
function cmRules(p) {
  const N = p.size, s = p.solution, out = latinProblems(s, N), seen = new Set();
  for (const cg of p.cages) {
    const v = cg.cells.map((i) => s[i]);
    cg.cells.forEach((i) => seen.add(i));
    const ok = cg.op === '=' ? v.length === 1 && v[0] === cg.target
      : cg.op === '+' ? v.reduce((a, b) => a + b, 0) === cg.target
        : cg.op === '×' ? v.reduce((a, b) => a * b, 1) === cg.target
          : v.length === 2 && (cg.op === '−' ? Math.abs(v[0] - v[1]) === cg.target : Math.max(...v) === cg.target * Math.min(...v));
    if (!ok) out.push(`the cage at row ${Math.floor(cg.cells[0] / N) + 1}, column ${(cg.cells[0] % N) + 1} does not make ${cg.target}${cg.op === '=' ? '' : cg.op}`);
  }
  if (seen.size !== N * N) out.push('some cells are in no cage');
  return out;
}
function scRules(p) {
  const R = p.size, C = p.cols, s = p.solution, out = [];
  const clue = new Map(p.clues.map(([i, across, down]) => [i, { across, down }]));
  const run = (start, step, ok) => { const v = []; for (let i = start; ok(i) && s[i]; i += step) v.push(s[i]); return v; };
  let runs = 0;
  for (const [i, k] of clue) {
    const r = Math.floor(i / C), c = i % C;
    for (const [total, step, ok, dir] of [[k.across, 1, (j) => Math.floor(j / C) === r && j < R * C, 'across'], [k.down, C, (j) => j < R * C, 'down']]) {
      if (!total) continue;
      runs++;
      const v = run(i + step, step, ok);
      if (!v.length || v.some((d) => d < 1 || d > 9) || new Set(v).size !== v.length || v.reduce((a, b) => a + b, 0) !== total) out.push(`the run ${dir} from row ${r + 1}, column ${c + 1} does not add up to ${total} with no number twice`);
    }
  }
  // Every white cell is in a run each way that has a clue.
  for (let i = 0; i < R * C; i++) {
    if (!s[i]) continue;
    const left = (j) => (j % C === 0 ? -1 : j - 1);
    let a = i; while (left(a) >= 0 && s[left(a)]) a = left(a);
    let d = i; while (d - C >= 0 && s[d - C]) d -= C;
    if (!clue.get(left(a))?.across || !clue.get(d - C)?.down) { out.push(`row ${Math.floor(i / C) + 1}, column ${(i % C) + 1} is not in a clued run each way`); break; }
  }
  if (!runs) out.push('the puzzle has no clues');
  return out;
}
function pgRules(p) {
  const R = p.size, C = p.cols, s = p.solution, out = [];
  const runsOf = (cells) => { const r = []; let n = 0; for (const v of cells) { if (v === 1) n++; else if (n) { r.push(n); n = 0; } } if (n) r.push(n); return r; };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  for (let r = 0; r < R; r++) if (!same(runsOf(s.slice(r * C, r * C + C)), p.rowClues[r])) out.push(`row ${r + 1} does not match its clue`);
  for (let c = 0; c < C; c++) if (!same(runsOf([...Array(R)].map((_, r) => s[r * C + c])), p.colClues[c])) out.push(`column ${c + 1} does not match its clue`);
  return out;
}
const sameAnswer = (a, b, pick = (x) => x) => a.length === b.length && a.every((x, i) => pick(x) === pick(b[i]));

// ---------- the games ----------
// options(date, cfg): the game's own daily options (with the admin's highest
// level for the grid-kit games), as its page passes them to the engine.
const kitOptions = (d, id) => (date, cfg) => {
  const max = KIT_LEVELS.indexOf(cfg.maxLevel);
  const lv = d.levels.filter((l) => max < 0 || KIT_LEVELS.indexOf(l.id) <= max);
  let level = d.daily[weekday(date)];
  if (!lv.some((l) => l.id === level)) level = lv[lv.length - 1].id;
  const L = d.levels.find((l) => l.id === level);
  return { story: cfg.stories !== false, difficulty: level, size: L.dailySize || L.sizes[0], seed: `daily-${id}-${date}`, daily: date, usedStories: [], usedPictures: [], avoid: [] };
};

export const DAILY_GAMES = [
  {
    id: 'np', name: 'NINETIMESNINE', page: 'ninetimesnine/', ops: NP, configKey: 'numberPlace',
    goal: 'Fill every empty cell so each row, column and box holds every number once.',
    hashtags: '#ninetimesnine #numberpuzzle #puzzleoftheday #brainteaser #TheLogicGrid',
    tags: ['numberpuzzle', 'puzzleoftheday'],
    options: (date, cfg) => ({ seed: `daily-${date}`, theme: null, story: cfg.stories !== false, difficulty: NP_DAILY[weekday(date)], variants: [], daily: date, usedStories: [] }),
    size: (p) => `${p.size}×${p.size}`,
    level: (p) => p.difficulty?.name || NP_LEVEL_NAMES[p.difficulty?.id] || '',
    css: NP_CSS,
    board: (p, values) => npBoard(p, values),
    rules: npRules,
    unique(p) {
      const shape = makeShape(p.size, p.variants);
      const even = p.evenCells.length ? p.evenCells.reduce((m, i) => { m[i] = 1; return m; }, Array(p.size * p.size).fill(0)) : null;
      const out = [];
      const solved = solveLogically(shape, p.givens.slice(), { evenMask: even });
      if (!solved.solved || !sameAnswer(solved.values, p.solution)) out.push('the step-by-step solver could not reach the answer without guessing');
      if (countSolutions(shape, p.givens.slice(), 2, even).count !== 1) out.push('a full search does not find exactly one answer');
      return out;
    },
  },
  {
    id: 'cm', name: 'Cage Math', page: 'cage-math/', ops: CM, def: cmDef, configKey: 'cm',
    goal: 'Fill the grid so every row and column holds each number once, and the numbers in each cage make its target.',
    hashtags: '#cagemath #mathpuzzle #puzzleoftheday #brainteaser #TheLogicGrid',
    tags: ['mathpuzzle', 'puzzleoftheday'],
    options: kitOptions(cmDef, 'cm'),
    size: (p) => cmDef.sizeLabel(p.size), level: (p) => p.difficulty.name,
    css: cmDef.printCss, board: (p, values) => cmDef.printBoard(p, values, {}), rules: cmRules,
    unique(p) {
      const out = [];
      const s = solveCageMath(p);
      if (!s.solved || !sameAnswer(s.values, p.solution)) out.push('the step-by-step solver could not reach the answer without guessing');
      if (countCageMath(p, 2) !== 1) out.push('a full search does not find exactly one answer');
      return out;
    },
  },
  {
    id: 'sc', name: 'Sum Cross', page: 'sum-cross/', ops: SC, def: scDef, configKey: 'sc',
    goal: 'Fill the white cells with 1 to 9 so every run adds up to its clue, with no number twice in a run.',
    hashtags: '#sumcross #numbercrossword #puzzleoftheday #brainteaser #TheLogicGrid',
    tags: ['numberpuzzle', 'puzzleoftheday'],
    options: kitOptions(scDef, 'sc'),
    size: (p) => scDef.sizeLabel(p.size), level: (p) => p.difficulty.name,
    css: scDef.printCss, board: (p, values) => scDef.printBoard(p, values, {}), rules: scRules,
    unique(p) {
      const s = solveSumCross(p);
      return s.solved && sameAnswer(s.values, p.solution) ? [] : ['the step-by-step solver could not reach the answer without guessing'];
    },
  },
  {
    id: 'pg', name: 'Picture Grid', page: 'picture-grid/', ops: PG, def: pgDef, configKey: 'pg',
    goal: 'Shade the cells each row and column calls for, and a hidden picture appears.',
    hashtags: '#picturegrid #nonogram #puzzleoftheday #brainteaser #TheLogicGrid',
    tags: ['nonogram', 'puzzleoftheday'],
    options: kitOptions(pgDef, 'pg'),
    size: (p) => pgDef.sizeLabel(p.size), level: (p) => p.difficulty.name,
    css: pgDef.printCss, board: (p, values, answers) => pgDef.printBoard(p, values, { answers }), rules: pgRules,
    unique(p) {
      const s = solvePictureGrid(p);
      return s.solved && sameAnswer(s.values, p.solution, (v) => (v === 1 ? 1 : 0)) ? [] : ['the line-by-line solver could not reach the picture without guessing'];
    },
  },
];
export const gameById = (id) => DAILY_GAMES.find((g) => g.id === id);

// The admin's switches for one game, from GET /v1/config (server/src/settings.js).
export const gameConfig = (g, config) => (g.configKey === 'numberPlace' ? config?.numberPlace : config?.kitGames?.[g.configKey]) || {};
export async function loadConfig(api) {
  if (!api) return null;
  try {
    const r = await fetch(`${api.replace(/\/+$/, '')}/v1/config`, { signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
// A game whose daily puzzle (or the game itself) is switched off in admin has no daily puzzle to share.
export const dailyOn = (g, config) => { const c = gameConfig(g, config); return c.enabled !== false && c.daily !== false; };

export function dailyPuzzle(g, date, config) {
  return g.ops.generate(g.options(date, gameConfig(g, config)));
}
// The puzzle's name: its story title, or the game's name with no story.
export const titleOf = (g, p) => (g.id === 'pg' ? `${g.name}` : p.story?.title || g.name);

export function checkDaily(g, p, date) {
  const problems = [];
  const text = JSON.stringify({ story: p.story, rules: p.rules, difficulty: p.difficulty });
  if (/undefined|NaN|\[object /.test(text)) problems.push(`${g.name}: the puzzle has broken text.`);
  if (!Array.isArray(p.solution) || !p.solution.length || !Array.isArray(p.givens)) return [...problems, `${g.name}: the puzzle is incomplete.`];
  if (p.givens.some((v, i) => v && v !== p.solution[i])) problems.push(`${g.name}: a given number does not match the answer.`);
  for (const m of g.rules(p)) problems.push(`${g.name}: in the answer, ${m}.`);
  if (!problems.length) for (const m of g.unique(p)) problems.push(`${g.name}: ${m}.`);
  if (!p.fingerprint) problems.push(`${g.name}: the puzzle has no fingerprint to check the answer key page against.`);
  return problems.map((m) => `${m} (${date})`);
}

// ---------- the answer key pages ----------
export const answerPath = (g, date) => `${g.page}daily/${date}/`;
export const playPath = (g) => `${g.page}?play=daily`;
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'";
const DAILY_ARCHIVE_DAYS = 30;

function answerPage(g, p, date, base, { earlier = [] } = {}) {
  const title = titleOf(g, p), path = answerPath(g, date);
  const up = '../../../';
  const desc = `${title}: the answer key to the daily ${g.name} puzzle for ${longDate(date)} (${g.level(p)}, ${g.size(p)}). Play the same puzzle free at The Logic Grid.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<meta name="flg-fingerprint" content="${esc(p.fingerprint)}">
<title>${esc(`${title} · Daily ${g.name} answer key · ${longDate(date)}`)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${base}/${path}">
<link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
<style>
:root { color-scheme: light dark; --bg: #fff; --page: #E9EDF7; --text: #121626; --muted: #4A5168; --accent: #5B3CC4; }
@media (prefers-color-scheme: dark) { :root { --bg: #121729; --page: #080B16; --text: #EEF0F8; --muted: #AEB5CB; --accent: #F5C451; } }
body { margin: 0; background: var(--page); color: var(--text); font: 17px/1.55 "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 18px 48px; }
.eyebrow { margin: 0; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; font-size: 14px; color: var(--accent); }
h1 { margin: 6px 0 4px; font-size: 30px; line-height: 1.2; } h2 { font-size: 21px; margin: 26px 0 8px; }
.meta { color: var(--muted); margin: 0 0 14px; }
.card { background: #fff; color: #000; border-radius: 14px; padding: 16px; overflow-x: auto; display: flex; justify-content: center; }
.card table { border-collapse: collapse; margin: 0 auto; }
${g.css}
details { margin-top: 18px; } summary { cursor: pointer; font-weight: 700; padding: 10px 0; color: var(--accent); }
a { color: var(--accent); } .btn { display: inline-block; background: var(--accent); color: var(--bg); padding: 10px 18px; border-radius: 999px; text-decoration: none; font-weight: 700; }
ul.archive { padding-left: 1.2em; } footer { margin-top: 36px; color: var(--muted); font-size: 14px; }
</style>
</head>
<body>
<main>
<p class="eyebrow"><a href="${up}">The Logic Grid</a> · Daily ${esc(g.name)}</p>
<h1>${esc(title)}</h1>
<p class="meta">${esc(longDate(date))} · ${esc(g.level(p))} · ${esc(g.size(p))}</p>
${p.story?.intro ? `<p>${esc(p.story.intro)}</p>` : ''}
<p>${esc(g.goal)}</p>
<p><a class="btn" href="${up}${playPath(g)}" rel="nofollow">Play today's puzzle free</a></p>
<h2>The puzzle</h2>
<div class="card">${g.board(p, p.givens, false)}</div>
<details>
<summary>Show the answer key (spoilers)</summary>
<div class="card">${g.board(p, p.solution, true)}</div>
${p.picture?.name ? `<p>The hidden picture: <b>${esc(p.picture.name)}</b>.</p>` : ''}
${p.story?.ending && g.id !== 'pg' ? `<p>${esc(p.story.ending)}</p>` : ''}
</details>
${earlier.length ? `<h2>Earlier daily ${esc(g.name)} puzzles</h2><ul class="archive">${earlier.map(([d, t]) => `<li><a href="${up}${answerPath(g, d)}">${esc(longDate(d))}: ${esc(t)}</a></li>`).join('')}</ul>` : ''}
<footer>© ${date.slice(0, 4)} Bobby Taylor. The Logic Grid™ · <a href="${up}${g.page}">${esc(g.name)}</a></footer>
</main>
</body>
</html>
`;
}

// Writes <game>/daily/<date>/ for today and the 30 days before it, and
// <game>/daily/ (today's page), for every game whose daily puzzle is on.
export async function writeDailyPages({ site, base, today = todayUtc(), config }) {
  let pages = 0;
  for (const g of DAILY_GAMES) {
    if (!dailyOn(g, config)) continue;
    const days = [...Array(DAILY_ARCHIVE_DAYS + 1)].map((_, i) => addDays(today, -i));
    // Picture Grid's archive names the level and size, not the picture (a spoiler).
    const made = days.map((d) => { const p = dailyPuzzle(g, d, config); return { d, p, title: g.id === 'pg' ? `${g.level(p)}, ${g.size(p)}` : titleOf(g, p) }; });
    for (const { d, p } of made) {
      const dir = join(site, answerPath(g, d));
      mkdirSync(dir, { recursive: true });
      const earlier = made.filter((x) => x.d < d).slice(0, 10).map((x) => [x.d, x.title]);
      writeFileSync(join(dir, 'index.html'), answerPage(g, p, d, base, { earlier }));
      pages++;
    }
    // daily/ itself: today's page, one level up.
    const todayHtml = answerPage(g, made[0].p, today, base, { earlier: made.slice(1, 11).map((x) => [x.d, x.title]) }).replaceAll('href="../../../', 'href="../../');
    mkdirSync(join(site, g.page, 'daily'), { recursive: true });
    writeFileSync(join(site, g.page, 'daily', 'index.html'), todayHtml);
  }
  return pages;
}
