// Daily puzzle for Facebook and Instagram, step 1 of 2 (run each morning by
// .github/workflows/daily-puzzle-social.yml; step 2 is
// scripts/marketing-post.py with MODE=daily-puzzle, which posts it).
//
// 1. Reads today's daily puzzle from the live site (daily/puzzles/<date>.json,
//    the same puzzle everyone gets in the game that day).
// 2. Checks it for errors before anything is posted:
//    - the puzzle is complete (title, story, categories, clues, answer key),
//      with no broken text such as "undefined" or "NaN";
//    - every clue names grid items exactly as the grid spells them;
//    - an independent brute-force search (not the engine's own solver) finds
//      exactly one answer, and it is the answer key the site shows;
//    - the story questions' answers match that answer key;
//    - the answer key page (daily/<date>/) and the game are live, and the
//      page shows this puzzle's title and answer key;
//    - each picture fits on one Instagram portrait image (1080 x 1350) with
//      readable text.
// 3. Makes two pictures (slide 1: story question, categories and clues; slide 2:
//    the blank grid to solve on) and the caption (with the answer key link) and
//    writes them to OUT_DIR: <date>.jpg, <date>-grid.jpg and <date>.json
//    ({ ok, problems, caption, images, ... }).
//    With any problem, ok is false and step 2 emails the owner and posts nothing.
//
//   node scripts/social-puzzle.mjs                       today (UTC day, like the game)
//   DAY=2026-11-02 node scripts/social-puzzle.mjs        another day
//   PUZZLE_FILE=p.json SKIP_LIVE=1 node scripts/social-puzzle.mjs   offline test
//
// Env: SITE (https://thelogicgrid.com), OUT_DIR (out/social), FONT_DIR
// (node_modules/@fontsource, optional: falls back to system fonts).
// Free: Node, Playwright's Chromium and the public site.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { checkAnswers } from '../engine/src/index.js';
import { gridTable } from './worksheet.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE || 'https://thelogicgrid.com').replace(/\/+$/, '');
const DAY = process.env.DAY || new Date().toISOString().slice(0, 10);
const OUT = resolve(process.env.OUT_DIR || join(root, 'out', 'social'));
const FONT_DIR = resolve(process.env.FONT_DIR || join(root, 'node_modules', '@fontsource'));
const API = (process.env.FLG_CLOUD_URL || 'https://flg-api.btay74.workers.dev').replace(/\/+$/, '');
const W = 1080, H = 1350, MIN_SCALE = 0.6;
// Yesterday's numbers go in the caption only when this many players solved it,
// so the post never shows thin or made-up looking figures.
const MIN_SOLVERS = 10;
const HASHTAGS = '#logicpuzzle #puzzleoftheday #brainteaser #logicgrid #TheLogicGrid';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const answerUrl = (d) => `${SITE}/daily/${d}/`;
export const playUrl = (d) => `${SITE}/fantastical/?play=daily&day=${d}`;

// ---------- independent brute-force search (same method as engine/test/run-tests.js) ----------
// Returns { count (0, 1, 2 = more than one, -1 = ran out of time), first: the first answer found }.
export function solveAll(p, limit = 2, budgetMs = 60000) {
  const K = p.categories.length, N = p.categories[0].items.length;
  const ci = Object.fromEntries(p.categories.map((c, i) => [c.id, i]));
  const parse = (id) => { const [c, i] = id.split(':'); return [ci[c], Number(i)]; };
  const perm = [[...Array(N).keys()]];
  const ent = (id) => { const [c, i] = parse(id); return perm[c].indexOf(i); };
  const clues = p.clues.map((c) => {
    const L = c.logic;
    const ids = Object.entries(L).filter(([k]) => !['type', 'o', 'd'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    const cats = new Set(ids.map((id) => parse(id)[0]));
    if ('o' in L) cats.add(L.o);
    const val = (id) => perm[L.o][ent(id)];
    const same = (x, y) => ent(x) === ent(y);
    let test;
    switch (L.type) {
      case 'is': test = () => same(L.a, L.b); break;
      case 'not': test = () => !same(L.a, L.b); break;
      case 'neither': test = () => L.xs.every((x) => !same(x, L.b)); break;
      case 'either': test = () => same(L.a, L.b1) || same(L.a, L.b2); break;
      case 'pairs': test = () => (same(L.x1, L.y1) && same(L.x2, L.y2)) || (same(L.x1, L.y2) && same(L.x2, L.y1)); break;
      case 'allDiff': test = () => new Set(L.items.map(ent)).size === L.items.length; break;
      case 'less': test = () => val(L.a) < val(L.b); break;
      case 'diff': test = () => val(L.b) - val(L.a) === L.d; break;
      case 'ifthen': test = () => !same(L.p[0], L.p[1]) || same(L.q[0], L.q[1]); break;
      default: throw new Error(`unknown clue type ${L.type}`);
    }
    return { maxCat: Math.max(...cats), test };
  });
  const perms = [];
  const permute = (arr, k = 0) => {
    if (k === arr.length) { perms.push(arr.slice()); return; }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  permute([...Array(N).keys()]);
  const byCat = Array.from({ length: K }, (_, c) => clues.filter((cl) => cl.maxCat === c));
  let count = 0, first = null, timedOut = false;
  const t0 = Date.now();
  const dfs = (c) => {
    if (count >= limit || timedOut) return;
    if (c === K) { count++; if (!first) first = perm.map((x) => x.slice()); return; }
    if (Date.now() - t0 > budgetMs) { timedOut = true; return; }
    for (const pm of perms) {
      perm[c] = pm;
      if (byCat[c].every((cl) => cl.test())) dfs(c + 1);
      if (count >= limit || timedOut) break;
    }
    perm.length = c;
  };
  dfs(1);
  return { count: timedOut ? -1 : count, first };
}

// ---------- the puzzle checks ----------
export function checkPuzzle(record, day) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  const p = record && record.puzzle;
  if (!p) return ['The daily puzzle file has no puzzle in it.'];
  if (record.date !== day) fail(`The puzzle file is for ${record.date}, not ${day}.`);
  if (!p.title) fail('The puzzle has no title.');
  if (!p.story || !Array.isArray(p.story.paragraphs) || !p.story.paragraphs.length) fail('The puzzle has no story.');
  if (!Array.isArray(p.categories) || p.categories.length < 2) return [...problems, 'The puzzle has fewer than 2 categories.'];
  const K = p.categories.length, N = p.categories[0].items.length;
  if (p.categories.some((c) => !c.name || c.items.length !== N || c.items.some((i) => !String(i.label || '').trim()))) fail('A category is missing its name or an item, or the categories have different sizes.');
  if (!Array.isArray(p.clues) || !p.clues.length) fail('The puzzle has no clues.');
  if (!p.answerKey || p.answerKey.rows?.length !== N || p.answerKey.columns?.length !== K) fail('The answer key is missing or the wrong size.');
  if (problems.length) return problems;

  // Broken words anywhere a player would read.
  const words = [p.title, ...p.story.paragraphs, p.story.ending || '', ...p.clues.map((c) => c.text), ...p.questions.map((q) => q.text),
    ...p.categories.flatMap((c) => [c.name, ...c.items.map((i) => i.label)]), ...p.answerKey.rows.flat().map(String)];
  const broken = words.filter((t) => /\bundefined\b|\bNaN\b|\bnull\b|\[object |\$\{|\{\{/.test(String(t)));
  if (broken.length) fail(`Broken text in the puzzle: "${String(broken[0]).slice(0, 80)}"`);

  // Clues name the grid items exactly.
  const labelOf = Object.fromEntries(p.categories.flatMap((c) => c.items.map((i) => [i.id, i.label])));
  for (const c of p.clues) {
    const ids = Object.entries(c.logic || {}).filter(([k]) => !['type', 'o', 'd'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    const missing = ids.filter((id) => !labelOf[id] || !c.text.includes(labelOf[id]));
    if (missing.length) fail(`Clue ${c.number} does not name ${missing.map((id) => labelOf[id] || id).join(', ')} the way the grid does.`);
  }

  // Exactly one answer, and it is the answer key.
  let solved;
  try { solved = solveAll(p); } catch (e) { fail(`The clues could not be checked: ${e.message}`); }
  if (solved) {
    if (solved.count === -1) fail('The answer check ran out of time, so the puzzle was not proven to have one answer.');
    else if (solved.count === 0) fail('The clues have no answer.');
    else if (solved.count > 1) fail('The clues have more than one answer.');
    else {
      const cols = p.categories.map((c) => c.name);
      if (p.answerKey.columns.join('|') !== cols.join('|')) fail('The answer key columns do not match the categories.');
      for (let e = 0; e < N; e++) {
        const want = p.categories.map((c, k) => c.items[solved.first[k][e]].label);
        const row = p.answerKey.rows.find((r) => r[0] === want[0]);
        if (!row || row.map(String).join('|') !== want.join('|')) { fail(`The answer key row for ${want[0]} does not match the only answer the clues allow.`); break; }
      }
    }
  }
  try {
    const results = checkAnswers(p, Object.fromEntries(p.questions.map((q) => [q.number, q.answer])));
    if (!results.every((r) => r.correct)) fail('A story question\'s answer does not check.');
  } catch (e) { fail(`The story questions could not be checked: ${e.message}`); }
  const keyQ = p.answerKey.questions || [];
  if (keyQ.length !== p.questions.length || keyQ.some((q) => !String(q.answer || '').trim())) fail('The answer key is missing a story question\'s answer.');
  return problems;
}

// ---------- the live pages ----------
async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'flg-daily-social' }, redirect: 'follow' });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

export async function checkLive(p, day) {
  const problems = [];
  const page = await get(answerUrl(day)).catch((e) => ({ status: 0, text: '', error: e.message }));
  if (page.status !== 200) problems.push(`The answer key page ${answerUrl(day)} answered ${page.status || 'nothing'}.`);
  else {
    if (!page.text.includes(esc(p.title))) problems.push('The answer key page does not show today\'s puzzle title.');
    if (!/Show the answer key/.test(page.text)) problems.push('The answer key page has no answer key.');
    const missing = p.answerKey.rows.flat().map(String).filter((v) => !page.text.includes(esc(v)));
    if (missing.length) problems.push(`The answer key page is missing ${missing.slice(0, 3).join(', ')}.`);
  }
  const game = await get(`${SITE}/fantastical/`).catch(() => ({ status: 0 }));
  if (game.status !== 200) problems.push(`The game (${SITE}/fantastical/) answered ${game.status || 'nothing'}.`);
  return problems;
}

// ---------- yesterday's numbers (the game's public daily results) ----------
// Best effort: missing numbers just leave the line out, never stop the post.
export async function yesterdayStats(day) {
  const y = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  try {
    const res = await fetch(`${API}/v1/daily/${y}/stats`, { headers: { 'User-Agent': 'flg-daily-social' } });
    if (!res.ok) return null;
    const s = await res.json();
    return Number(s.solved) >= MIN_SOLVERS ? s : null;
  } catch { return null; }
}

export function statsLine(s) {
  if (!s || Number(s.solved) < MIN_SOLVERS) return '';
  const mins = s.medianMs ? Math.max(1, Math.round(s.medianMs / 60000)) : 0;
  return `📊 Yesterday ${Number(s.solved).toLocaleString('en-US')} players solved the daily puzzle${mins ? `, with a typical time of about ${mins} minute${mins === 1 ? '' : 's'}` : ''}. Can you beat that today?`;
}

// ---------- the caption ----------
export function caption(p, day, stats = null) {
  const K = p.categories.length, N = p.categories[0].items.length;
  const goal = p.story.paragraphs.at(-1);
  return [
    `🧩 Daily logic puzzle for ${longDate(day)}`,
    `"${p.title}" · ${p.difficulty.name} · ${p.theme.name} · ${K} categories × ${N} items`,
    '',
    goal,
    '',
    'Every clue is on the first slide; swipe for a blank grid to solve on. It is the same puzzle everyone gets in the game today.',
    '🔥 Solve it in the game each day to build your daily streak.',
    '🏁 See how your time compares with everyone who played today, then race other players on the scoreboard.',
    ...(statsLine(stats) ? [statsLine(stats)] : []),
    '',
    `▶️ Play today's puzzle free: ${playUrl(day)}`,
    '',
    `✅ Answer key (spoilers): ${answerUrl(day)}`,
    '',
    HASHTAGS,
  ].join('\n');
}

// Bluesky: posts hold 300 characters, so the links show as short addresses
// (scripts/marketing-post.py turns each into a link to the full address) and
// the full clues go in the pictures' alt text, so screen readers get the puzzle.
export const BLUESKY_LIMIT = 300;
export function bluesky(p, day) {
  const play = 'thelogicgrid.com/fantastical', key = `thelogicgrid.com/daily/${day}/`;
  const head = `🧩 Daily logic puzzle: "${p.title}" (${p.difficulty.name} · ${p.theme.name})`;
  const tail = [`▶️ Play free: ${play}`, `✅ Answer key: ${key}`, '#logicpuzzle #puzzleoftheday'];
  const middles = ['Clues on slide 1, blank grid on slide 2. Same puzzle as in the game today: solve it there to build your streak.', 'Clues on slide 1, grid on slide 2. Solve it in the game to build your streak.', ''];
  const len = (t) => [...new Intl.Segmenter().segment(t)].length;
  const text = middles.map((m) => [head, ...(m ? [m] : []), '', ...tail].join('\n')).find((t) => len(t) <= BLUESKY_LIMIT);
  if (!text) return null;
  const alt1 = [`Daily logic puzzle "${p.title}", ${p.difficulty.name}, ${p.theme.name}.`, p.story.paragraphs.at(-1),
    `Categories: ${p.categories.map((c) => `${c.name}: ${c.items.map((i) => i.label).join(', ')}`).join('. ')}.`,
    `Clues: ${p.clues.map((c) => `${c.number}. ${c.text}`).join(' ')}`,
    p.questions.length ? `Questions: ${p.questions.map((q, i) => `${i + 1}. ${q.text}`).join(' ')}` : ''].filter(Boolean).join(' ').slice(0, 2000);
  const alt2 = `Blank logic grid for "${p.title}" to mark while solving, with the categories ${p.categories.map((c) => c.name).join(', ')}.`;
  return { text, links: [[play, playUrl(day)], [key, answerUrl(day)]], tags: ['logicpuzzle', 'puzzleoftheday'], alts: [alt1, alt2] };
}

// Mastodon: posts hold 500 characters, and each link counts as 23 whatever its
// length, so the full addresses fit. The pictures reuse Bluesky's alt text
// (Mastodon allows 1,500 characters of it).
export const MASTODON_LIMIT = 500;
export const mastodonLength = (t) => [...t.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
export function mastodon(p, day) {
  const head = [`🧩 Daily logic puzzle for ${longDate(day)}`, `"${p.title}" · ${p.difficulty.name} · ${p.theme.name}`];
  const tail = ['', `▶️ Play today's puzzle free: ${playUrl(day)}`, `✅ Answer key (spoilers): ${answerUrl(day)}`, '', '#LogicPuzzle #PuzzleOfTheDay #Puzzles'];
  const goal = p.story.paragraphs.at(-1);
  const middles = [
    ['', goal, '', 'Clues on slide 1, blank grid on slide 2. Same puzzle as in the game today: solve it there to build your daily streak.'],
    ['', 'Clues on slide 1, blank grid on slide 2. Same puzzle as in the game today: solve it there to build your daily streak.'],
    ['', 'Clues on slide 1, grid on slide 2. Solve it in the game to build your streak.'],
    [],
  ];
  const text = middles.map((m) => [...head, ...m, ...tail].join('\n')).find((t) => mastodonLength(t) <= MASTODON_LIMIT);
  const bs = bluesky(p, day);
  if (!text || !bs) return null;
  return { text, alts: bs.alts.map((a) => a.slice(0, 1500)) };
}

// Instagram does not make links in captions clickable, so it also points to the bio link.
export const instagramCaption = (p, day, stats = null) => caption(p, day, stats).replace(`\n\n${HASHTAGS}`, `\n(Links are also in our bio.)\n\n${HASHTAGS}`);

// ---------- the picture ----------
function font(file) {
  const f = join(FONT_DIR, file);
  return existsSync(f) ? pathToFileURL(f).href : null;
}

export function pictureHtml(p, day) {
  const K = p.categories.length, N = p.categories[0].items.length;
  const faces = [
    ['Atk', 400, font('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2')],
    ['Atk', 700, font('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2')],
    ['Cinzel', 700, font('cinzel/files/cinzel-latin-700-normal.woff2')],
  ].filter(([, , u]) => u).map(([f, w, u]) => `@font-face{font-family:${f};font-weight:${w};src:url(${u})}`).join('');
  const icon = join(root, 'web', 'icons', 'icon.svg');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${faces}
:root{--s:1}
*{box-sizing:border-box}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{display:flex;flex-direction:column;padding:56px 64px 44px;color:#EEF0F8;font-family:Atk,'Atkinson Hyperlegible',Arial,sans-serif;
 background:radial-gradient(circle at 12% 8%,#7C5CFF 0,transparent 42%),radial-gradient(circle at 92% 96%,#22B8CF 0,transparent 40%),#121729}
header{display:flex;align-items:center;gap:22px}
header img{width:84px;height:84px}
.eyebrow{margin:0;font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:#F5C451;font-weight:700}
.date{margin:4px 0 0;font-size:24px;color:#C9CEE0}
main{flex:1;min-height:0;overflow:hidden;margin-top:26px}
h1{font:700 calc(58px*var(--s))/1.1 Cinzel,Georgia,serif;margin:0 0 calc(10px*var(--s))}
.meta{margin:0 0 calc(18px*var(--s));font-size:calc(26px*var(--s));color:#F5C451;font-weight:700}
.goal{margin:0 0 calc(20px*var(--s));font-size:calc(30px*var(--s));line-height:1.35}
.box{background:rgb(255 255 255/.07);border:1px solid rgb(255 255 255/.14);border-radius:18px;padding:calc(16px*var(--s)) calc(22px*var(--s));margin-bottom:calc(18px*var(--s))}
.cats{margin:0;padding:0;list-style:none;font-size:calc(25px*var(--s));line-height:1.4}
.cats b{color:#9FE3EE}
h2{margin:0 0 calc(8px*var(--s));font-size:calc(24px*var(--s));letter-spacing:.1em;text-transform:uppercase;color:#C9CEE0}
ol{margin:0;padding-left:1.6em;font-size:calc(29px*var(--s));line-height:1.36}
ol li{margin-bottom:calc(8px*var(--s))}
ol li::marker{color:#F5C451;font-weight:700}
.qs{font-size:calc(26px*var(--s))}
footer{margin-top:20px;padding-top:18px;border-top:2px solid rgb(245 196 81/.5);display:flex;justify-content:space-between;align-items:baseline;font-size:27px}
footer b{color:#F5C451}
</style></head><body>
<header>${existsSync(icon) ? `<img src="${pathToFileURL(icon).href}" alt="">` : ''}<div><p class="eyebrow">The Logic Grid · Daily puzzle</p><p class="date">${esc(longDate(day))}</p></div></header>
<main id="main"><div id="content">
<h1>${esc(p.title)}</h1>
<p class="meta">${esc(p.difficulty.name)} · ${esc(p.theme.name)} · ${K} categories × ${N} items</p>
<p class="goal">${esc(p.story.paragraphs.at(-1))}</p>
<div class="box"><ul class="cats">${p.categories.map((c) => `<li><b>${esc(c.name)}:</b> ${c.items.map((i) => esc(i.label)).join(', ')}</li>`).join('')}</ul></div>
<h2>Clues</h2>
<ol>${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
${p.questions.length ? `<h2 style="margin-top:calc(16px*var(--s))">Can you answer</h2><ol class="qs">${p.questions.map((q) => `<li>${esc(q.text)}</li>`).join('')}</ol>` : ''}
</div></main>
<footer><span>Same puzzle in the game · build your streak</span><b>thelogicgrid.com</b></footer>
</body></html>`;
}

// Slide 2: the blank staircase grid (the same one the printables use), on a
// light card so it can be screenshotted and marked up.
export function gridHtml(p, day) {
  const page = pictureHtml(p, day);
  const head = page.slice(0, page.indexOf('</style>'));
  return `${head}
.card{flex:1;min-height:0;margin-top:22px;background:#FBFAF6;border-radius:22px;padding:28px;display:flex;align-items:center;justify-content:center;overflow:hidden}
#grid{transform-origin:center center}
.lgrid{border-collapse:collapse;color:#1d1b29;font-family:Atk,'Atkinson Hyperlegible',Arial,sans-serif;font-size:22px}
.lgrid td,.lgrid th{border:1px solid #9a97a8}
.lgrid td{width:44px;height:44px;background:#fff}
.lgrid td.l{border-left:3px solid #1d1b29}
.lgrid tr.t td,.lgrid tr.t th.item{border-top:3px solid #1d1b29}
.lgrid th.item{font-weight:400;padding:4px 10px;text-align:right;white-space:nowrap;background:#F1EFF7}
.lgrid thead th.item{vertical-align:bottom;padding:10px 4px;text-align:left}
.lgrid thead th.item span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}
.lgrid th.cat{background:#2B2350;color:#fff;font-weight:700;padding:6px 8px;letter-spacing:.04em}
.lgrid th.cat.side{width:44px}
.lgrid th.cat.side span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}
.lgrid td.corner{border:none;background:transparent}
.hint{margin:16px 0 0;font-size:26px;color:#DDE1EE}
</style></head><body>
<header>${page.match(/<header>([\s\S]*?)<\/header>/)[1].replace('Daily puzzle', 'Daily puzzle · your grid')}</header>
<p class="hint"><b style="color:#F5C451">${esc(p.title)}</b> · mark ✕ for no and ● for yes. Every clue is on the first slide.</p>
<div class="card" id="card"><div id="grid">${gridTable(p)}</div></div>
<footer><span>Answer key link in the caption</span><b>thelogicgrid.com</b></footer>
</body></html>`;
}

// Renders the picture, shrinking the text until it fits. Returns { problems, scale }.
export async function renderPicture(p, day, file) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const htmlFile = file.replace(/\.jpg$/, '.html');
  writeFileSync(htmlFile, pictureHtml(p, day));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(pathToFileURL(htmlFile).href);
    await page.evaluate(() => document.fonts.ready);
    const scale = await page.evaluate((min) => {
      const main = document.getElementById('main'), content = document.getElementById('content');
      for (let s = 1; s >= min - 1e-9; s -= 0.02) {
        document.documentElement.style.setProperty('--s', s.toFixed(2));
        if (content.scrollHeight <= main.clientHeight) return Number(s.toFixed(2));
      }
      return 0;
    }, MIN_SCALE);
    if (!scale) return { problems: ['The puzzle has too much text to read on one picture.'], scale: 0 };
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    // Slide 2: the grid, scaled to fill the card.
    const gridFile = file.replace(/\.jpg$/, '-grid.jpg');
    writeFileSync(gridFile.replace(/\.jpg$/, '.html'), gridHtml(p, day));
    await page.goto(pathToFileURL(gridFile.replace(/\.jpg$/, '.html')).href);
    await page.evaluate(() => document.fonts.ready);
    const gridScale = await page.evaluate(() => {
      const card = document.getElementById('card'), g = document.getElementById('grid');
      const pad = 56, k = Math.min((card.clientWidth - pad) / g.offsetWidth, (card.clientHeight - pad) / g.offsetHeight, 1.6);
      g.style.transform = `scale(${k})`;
      return Number(k.toFixed(2));
    });
    // A grid shrunk below half size has cells too small to mark.
    if (gridScale < 0.5) return { problems: ['The grid is too big to mark up on one picture.'], scale };
    await page.screenshot({ path: gridFile, type: 'jpeg', quality: 88 });
    return { problems: [], scale, gridScale, files: [file, gridFile] };
  } finally {
    await browser.close();
  }
}

// ---------- run ----------
async function main() {
  mkdirSync(OUT, { recursive: true });
  const result = { day: DAY, ok: false, problems: [], answerUrl: answerUrl(DAY), playUrl: playUrl(DAY) };
  const save = () => writeFileSync(join(OUT, `${DAY}.json`), JSON.stringify(result, null, 2));
  try {
    let record;
    if (process.env.PUZZLE_FILE) record = JSON.parse(readFileSync(process.env.PUZZLE_FILE, 'utf8'));
    else {
      const res = await get(`${SITE}/daily/puzzles/${DAY}.json`);
      if (res.status !== 200) throw new Error(`Today's puzzle (${SITE}/daily/puzzles/${DAY}.json) answered ${res.status}: the site may not have been rebuilt yet.`);
      record = JSON.parse(res.text);
    }
    const p = record.puzzle;
    result.title = p?.title;
    result.problems.push(...checkPuzzle(record, DAY));
    if (!result.problems.length && !process.env.SKIP_LIVE) result.problems.push(...(await checkLive(p, DAY)));
    if (!result.problems.length) {
      const file = join(OUT, `${DAY}.jpg`);
      const r = await renderPicture(p, DAY, file);
      result.problems.push(...r.problems);
      if (!r.problems.length) Object.assign(result, { image: file, images: r.files, scale: r.scale, gridScale: r.gridScale });
    }
    if (!result.problems.length) {
      const stats = process.env.SKIP_LIVE ? null : await yesterdayStats(DAY);
      Object.assign(result, { ok: true, stats, caption: caption(p, DAY, stats), instagramCaption: instagramCaption(p, DAY, stats), bluesky: bluesky(p, DAY), mastodon: mastodon(p, DAY) });
    }
  } catch (e) {
    result.problems.push(e.message);
  }
  save();
  if (result.ok) console.log(`::notice::${DAY} "${result.title}" passed every check (text scale ${result.scale}). Ready to post.`);
  else for (const m of result.problems) console.log(`::warning::${m}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
