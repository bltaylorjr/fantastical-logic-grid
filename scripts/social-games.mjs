// Daily puzzles of NINETIMESNINE, Cage Math, Sum Cross and Picture Grid for
// social media, step 1 of 2 (run each morning by
// .github/workflows/daily-puzzle-social.yml, after The Fantastical Logic
// Grid's own step 1, scripts/social-puzzle.mjs; step 2 is
// scripts/marketing-post.py with MODE=daily-puzzle, which posts every game).
//
// For each game whose daily puzzle is switched on in admin:
// 1. Makes today's daily puzzle exactly as the game does (scripts/game-daily.mjs),
//    with the admin's switches from the Worker's GET /v1/config.
// 2. Checks it before anything is posted (checkDaily): no broken text, the
//    answer obeys every rule (checked independently of the engine), and the
//    engine's solver proves one answer reachable without guessing. Then the
//    live site: the game's page opens, and the answer key page
//    (<game>/daily/<date>/) is up and shows this very puzzle (its fingerprint).
// 3. Makes the picture (1080 x 1350: the puzzle ready to solve) and the
//    captions, and writes OUT_DIR/<date>-<game>.jpg and <date>-<game>.json
//    ({ ok, problems, caption, images, ... }, the same shape as the Logic
//    Grid's). With any problem, ok is false: step 2 emails the owner and posts
//    nothing for that game (the other games still post).
//
//   node scripts/social-games.mjs                         today (UTC day, like the games)
//   DAY=2026-11-03 node scripts/social-games.mjs          another day
//   GAMES=np,cm DAY=2026-11-03 SKIP_LIVE=1 node scripts/social-games.mjs   offline test
//
// Env: SITE (https://thelogicgrid.com), FLG_CLOUD_URL (the Worker, for the
// admin's switches), OUT_DIR (out/social), FONT_DIR (node_modules/@fontsource).
// Free: Node, Playwright's Chromium and the public site.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { DAILY_GAMES, dailyOn, dailyPuzzle, checkDaily, loadConfig, titleOf, answerPath, playPath, longDate } from './game-daily.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE || 'https://thelogicgrid.com').replace(/\/+$/, '');
const HOST = SITE.replace(/^https?:\/\//, '');
const DAY = process.env.DAY || new Date().toISOString().slice(0, 10);
const OUT = resolve(process.env.OUT_DIR || join(root, 'out', 'social'));
const FONT_DIR = resolve(process.env.FONT_DIR || join(root, 'node_modules', '@fontsource'));
const API = process.env.FLG_CLOUD_URL || 'https://flg-api.btay74.workers.dev';
const ONLY = (process.env.GAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
const W = 1080, H = 1350;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const answerUrl = (g) => `${SITE}/${answerPath(g, DAY)}`;
const playUrl = (g) => `${SITE}/${playPath(g)}`;
const graphemes = (t) => [...new Intl.Segmenter().segment(t)].length;
const linkLength = (t) => [...t.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
const xLength = (t) => [...t.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].reduce((n, c) => n + (c.codePointAt(0) > 0xffff ? 2 : 1), 0);
const first = (list, fits) => list.find(fits) || null;

// ---------- captions ----------
function words(g, p) {
  const title = titleOf(g, p);
  return {
    title,
    head: `🧩 Daily ${g.name} for ${longDate(DAY)}`,
    meta: `${title === g.name ? '' : `"${title}" · `}${g.level(p)} · ${g.size(p)}`,
    goal: g.goal,
    intro: g.id === 'pg' ? '' : p.story?.intro || '',
  };
}

export function caption(g, p) {
  const w = words(g, p);
  return [w.head, w.meta, '', ...(w.intro ? [w.intro, ''] : []), w.goal, '',
    'Solve it on the picture, or play the same puzzle free in the game: it is the one everyone gets today.',
    '🔥 Solve the daily puzzle each day to build your streak.',
    '', `▶️ Play today's puzzle free: ${playUrl(g)}`, '', `✅ Answer key (spoilers): ${answerUrl(g)}`, '', g.hashtags].join('\n');
}
const instagramCaption = (g, p) => caption(g, p).replace(`\n\n${g.hashtags}`, `\n(Links are also in our bio.)\n\n${g.hashtags}`);

function alt(g, p) {
  const w = words(g, p);
  return [`Daily ${g.name} puzzle for ${longDate(DAY)}${w.title === g.name ? '' : `, "${w.title}"`}, ${g.level(p)}, ${g.size(p)}.`, w.goal,
    `The ${g.size(p)} grid is shown ready to solve; play it in the game at ${HOST}/${g.page} for a version that works with a screen reader.`].join(' ').slice(0, 1500);
}

function bluesky(g, p) {
  const w = words(g, p), play = `${HOST}/${g.page}`, key = `${HOST}/${answerPath(g, DAY)}`;
  const head = `🧩 Daily ${g.name}: ${w.meta}`;
  const tail = [`▶️ Play free: ${play}`, `✅ Answer key: ${key}`, `#${g.tags[0]} #${g.tags[1]}`];
  const text = first(['Same puzzle as in the game today: solve it there to build your streak.', 'Solve it in the game to build your streak.', '']
    .map((m) => [head, ...(m ? [m] : []), '', ...tail].join('\n')), (t) => graphemes(t) <= 300);
  return text && { text, links: [[play, playUrl(g)], [key, answerUrl(g)]], tags: g.tags, alts: [alt(g, p)] };
}
function mastodon(g, p) {
  const w = words(g, p);
  const tail = ['', `▶️ Play today's puzzle free: ${playUrl(g)}`, `✅ Answer key (spoilers): ${answerUrl(g)}`, '', `#${g.tags[0]} #PuzzleOfTheDay #Puzzles`];
  const text = first([['', w.goal, '', 'Same puzzle as in the game today: solve it there to build your daily streak.'], ['', w.goal], []]
    .map((m) => [w.head, w.meta, ...m, ...tail].join('\n')), (t) => linkLength(t) <= 500);
  return text && { text, alts: [alt(g, p)] };
}
function xPost(g, p) {
  const w = words(g, p);
  const tail = ['', `▶️ Play free: ${playUrl(g)}`, `✅ Answer key: ${answerUrl(g)}`];
  return first([[...tail, '', `#${g.tags[0]} #PuzzleOfTheDay`], tail].map((t) => [`🧩 Daily ${g.name}: ${w.meta}`, ...t].join('\n')), (t) => xLength(t) <= 280);
}
function threads(g, p) {
  const w = words(g, p);
  const tail = ['', `▶️ Play today's puzzle free: ${playUrl(g)}`, `✅ Answer key (spoilers): ${answerUrl(g)}`, '', `#${g.tags[0]}`];
  return first([['', w.goal, '', 'Same puzzle as in the game today: solve it there to build your daily streak.'], ['', w.goal], []]
    .map((m) => [w.head, w.meta, ...m, ...tail].join('\n')), (t) => [...t].length <= 500);
}
function pin(g, p) {
  const w = words(g, p);
  return {
    title: `Daily ${g.name}: ${w.title === g.name ? `${g.level(p)} ${g.size(p)}` : w.title}`.slice(0, 100),
    description: [`${g.level(p)} · ${g.size(p)} · ${longDate(DAY)}.`, w.goal, 'Play it free in the game, or check your answer:', `Answer key: ${answerUrl(g)}`, `#${g.tags[0]} #printablepuzzle #brainteaser`].join(' ').slice(0, 800),
    link: playUrl(g), board: 'Daily Logic Puzzles',
  };
}

// ---------- the picture ----------
function font(file) {
  const f = join(FONT_DIR, file);
  return existsSync(f) ? pathToFileURL(f).href : null;
}
export function pictureHtml(g, p) {
  const w = words(g, p);
  const faces = [
    ['Atk', 400, font('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2')],
    ['Atk', 700, font('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2')],
    ['Cinzel', 700, font('cinzel/files/cinzel-latin-700-normal.woff2')],
  ].filter(([, , u]) => u).map(([f, wt, u]) => `@font-face{font-family:${f};font-weight:${wt};src:url(${u})}`).join('');
  const icon = join(root, 'web', 'icons', 'icon.svg');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${faces}
*{box-sizing:border-box}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{display:flex;flex-direction:column;padding:52px 60px 40px;color:#EEF0F8;font-family:Atk,'Atkinson Hyperlegible',Arial,sans-serif;
 background:radial-gradient(circle at 12% 8%,#7C5CFF 0,transparent 42%),radial-gradient(circle at 92% 96%,#22B8CF 0,transparent 40%),#121729}
header{display:flex;align-items:center;gap:22px}
header img{width:80px;height:80px}
.eyebrow{margin:0;font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:#F5C451;font-weight:700}
.date{margin:4px 0 0;font-size:24px;color:#C9CEE0}
h1{font:700 54px/1.1 Cinzel,Georgia,serif;margin:24px 0 8px}
.meta{margin:0 0 10px;font-size:27px;color:#F5C451;font-weight:700}
.goal{margin:0;font-size:28px;line-height:1.35}
.card{flex:1;min-height:0;margin-top:22px;background:#FBFAF6;border-radius:22px;padding:24px;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#000}
#board{transform-origin:center center;font-family:Atk,'Atkinson Hyperlegible',Arial,sans-serif}
#board table{border-collapse:collapse}
${g.css}
footer{margin-top:20px;padding-top:16px;border-top:2px solid rgb(245 196 81/.5);display:flex;justify-content:space-between;align-items:baseline;font-size:26px}
footer b{color:#F5C451}
</style></head><body>
<header>${existsSync(icon) ? `<img src="${pathToFileURL(icon).href}" alt="">` : ''}<div><p class="eyebrow">The Logic Grid · Daily ${esc(g.name)}</p><p class="date">${esc(longDate(DAY))}</p></div></header>
<h1>${esc(w.title)}</h1>
<p class="meta">${esc(g.level(p))} · ${esc(g.size(p))}</p>
<p class="goal">${esc(w.goal)}</p>
<div class="card" id="card"><div id="board">${g.board(p, p.givens, false)}</div></div>
<footer><span>Same puzzle in the game · build your streak</span><b>${esc(HOST)}</b></footer>
</body></html>`;
}

async function render(browser, g, p, file) {
  const htmlFile = file.replace(/\.jpg$/, '.html');
  writeFileSync(htmlFile, pictureHtml(g, p));
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  try {
    await page.goto(pathToFileURL(htmlFile).href);
    await page.evaluate(() => document.fonts.ready);
    const scale = await page.evaluate(() => {
      const card = document.getElementById('card'), b = document.getElementById('board');
      const k = Math.min((card.clientWidth - 48) / b.offsetWidth, (card.clientHeight - 48) / b.offsetHeight, 1.8);
      b.style.transform = `scale(${k})`;
      return Number(k.toFixed(2));
    });
    // The smallest printed cells (a 20×20 picture) need at least this to stay readable.
    if (scale < 0.75) return [`${g.name}: the grid is too big to read on one picture (scale ${scale}).`];
    const overflow = await page.evaluate(() => document.body.scrollHeight > window.innerHeight + 1);
    if (overflow) return [`${g.name}: the words do not fit on the picture.`];
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    return [];
  } finally {
    await page.close();
  }
}

async function live(g, p) {
  const problems = [];
  const get = async (url) => {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      return { status: r.status, text: r.ok ? await r.text() : '' };
    } catch (e) { return { status: 0, text: '' }; }
  };
  const gamePage = await get(`${SITE}/${g.page}`);
  if (gamePage.status !== 200) problems.push(`${g.name}: the game's page (${SITE}/${g.page}) answered ${gamePage.status || 'nothing'}.`);
  const key = await get(answerUrl(g));
  if (key.status !== 200) problems.push(`${g.name}: the answer key page (${answerUrl(g)}) answered ${key.status || 'nothing'}: the site may not have been rebuilt yet.`);
  else if (!key.text.includes(`content="${p.fingerprint}"`)) problems.push(`${g.name}: the answer key page shows a different puzzle from today's daily puzzle, so the admin switches may have changed since the site was rebuilt.`);
  return problems;
}

// ---------- run ----------
async function main() {
  mkdirSync(OUT, { recursive: true });
  const config = await loadConfig(API);
  if (!config) console.log(`::warning::Could not read the admin switches from ${API}/v1/config; using the defaults. The answer key page check still makes sure the puzzle matches the site.`);
  const games = DAILY_GAMES.filter((g) => !ONLY.length || ONLY.includes(g.id));
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const summary = [];
  try {
    for (const g of games) {
      const result = { day: DAY, game: g.id, gameName: g.name, ok: false, problems: [], answerUrl: answerUrl(g), playUrl: playUrl(g) };
      const save = () => writeFileSync(join(OUT, `${DAY}-${g.id}.json`), JSON.stringify(result, null, 2));
      if (!dailyOn(g, config)) {
        Object.assign(result, { skipped: true, problems: [`${g.name}'s daily puzzle is switched off in admin, so it is not posted.`] });
        save();
        summary.push(`${g.name}: off in admin, skipped`);
        continue;
      }
      try {
        const p = dailyPuzzle(g, DAY, config);
        result.title = titleOf(g, p);
        result.problems.push(...checkDaily(g, p, DAY));
        if (!result.problems.length && !process.env.SKIP_LIVE) result.problems.push(...(await live(g, p)));
        if (!result.problems.length) {
          const file = join(OUT, `${DAY}-${g.id}.jpg`);
          result.problems.push(...(await render(browser, g, p, file)));
          if (!result.problems.length) {
            Object.assign(result, {
              ok: true, image: file, images: [file], caption: caption(g, p), instagramCaption: instagramCaption(g, p),
              bluesky: bluesky(g, p), mastodon: mastodon(g, p), x: xPost(g, p), threads: threads(g, p), pin: pin(g, p),
            });
          }
        }
      } catch (e) {
        result.problems.push(`${g.name}: ${e.message}`);
      }
      save();
      if (result.ok) console.log(`::notice::${DAY} ${g.name} "${result.title}" passed every check. Ready to post.`);
      else for (const m of result.problems) console.log(`::warning::${m}`);
      summary.push(`${g.name}: ${result.ok ? 'ready' : 'not ready'}`);
    }
  } finally {
    await browser.close();
  }
  console.log(summary.join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
