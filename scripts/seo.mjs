// Search pages for the website build (dist/site): crawlable pages that work
// without JavaScript, a daily puzzle page, sitemap.xml, robots.txt, llms.txt,
// the IndexNow key file and search tags on the game page. build.mjs runs this
// after it writes dist/site; nothing here reaches the desktop app or dist/web.
// Settings (all optional, GitHub repository variables in CI):
//   FLG_SITE_URL                 the site address (default https://thelogicgrid.com)
//   FLG_GOOGLE_SITE_VERIFICATION Google Search Console "HTML tag" content value
//   FLG_BING_SITE_VERIFICATION   Bing Webmaster Tools "meta tag" content value
//   FLG_INDEXNOW_KEY             IndexNow key (public by design; a default is set)
//   FLG_TODAY                    YYYY-MM-DD, to build another day's puzzle (tests)
//   FLG_CLOUD_URL                the game's Worker; its /v1/daily/plan holds the
//                                daily puzzle changes made in the admin dashboard
//   FLG_DAILY_PLAN_REQUIRED      1 to stop the build when no plan can be read
//                                (the publish workflow), so past days never change
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const INDEXNOW_KEY = process.env.FLG_INDEXNOW_KEY || 'fae88a004ad87116c0e93df007b2de7e';
// The first daily puzzle. Every later day is checked against all earlier days,
// so a daily story is never used twice.
const DAILY_START = '2026-10-25';
const DAILY_ARCHIVE_DAYS = 30;
// Days ahead the admin dashboard's daily planner can preview.
const DAILY_AHEAD_DAYS = 14;
// One difficulty per weekday (Sunday first). Expert and MENSA take seconds
// to make, and the daily chain is rebuilt from the start on every build.
const DAILY_TIERS = ['hard', 'easy', 'medium', 'basic', 'easy', 'medium', 'hard'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return day(d); };
const dailySummary = (p, d, planned) => ({
  date: d, title: p.title, theme: p.theme.id, themeName: p.theme.name, difficulty: p.difficulty.id, difficultyName: p.difficulty.name,
  categories: p.categories.length, items: p.categories[0].items.length, opening: p.story.paragraphs[0], storyId: p.story.id, planned: !!planned,
});

// The daily plan: changes made in the admin dashboard, by date. The Worker is
// asked first; if it can't be reached, the copy the live site published last
// time is used, so past daily puzzles stay exactly as they were.
async function readDailyPlan(base) {
  const get = async (u) => {
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`${u} answered ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.plan)) throw new Error(`${u} has no plan`);
    return body.plan;
  };
  const sources = [process.env.FLG_CLOUD_URL && `${process.env.FLG_CLOUD_URL.replace(/\/+$/, '')}/v1/daily/plan`, `${base}/daily/plan.json`].filter(Boolean);
  for (const u of sources) {
    try {
      const rows = await get(u);
      return new Map(rows.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).map((r) => [r.date, r]));
    } catch (e) { console.warn(`Daily plan: ${e.message}`); }
  }
  if (process.env.FLG_DAILY_PLAN_REQUIRED === '1') throw new Error('The daily puzzle plan could not be read, so the site was not rebuilt (past daily puzzles must not change).');
  return new Map();
}
const longDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export async function buildSeo({ root, site }) {
  const base = (process.env.FLG_SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, '');
  const url = (path) => `${base}/${path}`;
  // The same engine the site ships.
  const engine = await import(pathToFileURL(join(site, 'engine', 'index.js')).href);
  const { THEMES, TIERS, CLUE_TYPES, getTopics, storylineCount, generatePuzzle } = engine;
  const today = process.env.FLG_TODAY || day(new Date());
  const appHtml = readFileSync(join(site, 'index.html'), 'utf8');
  // Pages that come from code change when the code does; the date of the last
  // commit is the honest "last changed" date for them.
  let updated = today;
  try { updated = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: root, encoding: 'utf8' }).trim() || today; } catch {}
  const name = 'The Fantastical Logic Grid';
  const pages = []; // { path, lastmod, priority }

  // ---------- shared layout ----------
  const verification = [
    process.env.FLG_GOOGLE_SITE_VERIFICATION && `<meta name="google-site-verification" content="${esc(process.env.FLG_GOOGLE_SITE_VERIFICATION)}">`,
    process.env.FLG_BING_SITE_VERIFICATION && `<meta name="msvalidate.01" content="${esc(process.env.FLG_BING_SITE_VERIFICATION)}">`,
  ].filter(Boolean).join('\n');
  const social = ({ title, description, path, type = 'website' }) => `<link rel="canonical" href="${url(path)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${name}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url(path)}">
<meta property="og:image" content="${url('og-image.jpg')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${name}: story logic grid puzzles">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${url('og-image.jpg')}">`;

  // Inlined so the page paints without waiting for a stylesheet.
  const css = readFileSync(join(root, 'seo', 'site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n');
  const NAV = [['how-to-play/', 'How to play'], ['daily/', 'Daily puzzle'], ['themes/', 'Themes'], ['difficulty-levels/', 'Difficulty levels']];
  const page = ({ path, title, description, body, crumbs = [], schema = [], lastmod = updated, priority = 0.6, type, listed = true }) => {
    const file = path.endsWith('.html') ? path : `${path}index.html`;
    const up = '../'.repeat(file.split('/').length - 1);
    const trail = [['', 'Home'], ...crumbs];
    const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail.map(([p, n], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: url(p) })) };
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${listed ? 'index, follow, max-image-preview:large' : 'noindex'}">
<meta name="theme-color" content="#5B3CC4">
${social({ title, description, path, type })}
${verification}
<link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${up}icons/icon-192.png">
<link rel="preload" href="${up}fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${up}fonts/cinzel-700.woff2" as="font" type="font/woff2" crossorigin>
<style>${css.replaceAll('url(fonts/', `url(${up}fonts/`)}</style>
${[breadcrumb, ...schema].map((s) => `<script type="application/ld+json">${json(s)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="${up}">${name}</a>
  <nav aria-label="Site">
    <ul>${NAV.map(([p, n]) => `<li><a href="${up}${p}"${p === path ? ' aria-current="page"' : ''}>${n}</a></li>`).join('')}</ul>
  </nav>
  <a class="btn" href="${up}">Play free</a>
</header>
${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${trail.map(([p, n], i) => i === trail.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${up}${p}">${esc(n)}</a></li>`).join('')}</ol></nav>` : ''}
<main id="main">
${body(up)}
</main>
<footer class="foot">
  <p><a href="${up}">Play ${name}</a> · free in your browser, offline-ready, and on Windows.</p>
  <p>${NAV.map(([p, n]) => `<a href="${up}${p}">${n}</a>`).join(' · ')}</p>
</footer>
</body>
</html>
`;
    mkdirSync(dirname(join(site, file)), { recursive: true });
    writeFileSync(join(site, file), html);
    if (listed) pages.push({ path, lastmod, priority });
  };
  const playBtn = (up, text = 'Play a new puzzle now') => `<p><a class="btn big" href="${up}">${text}</a></p>`;

  // ---------- the game page (index.html) ----------
  const appDescription = 'Free story logic grid puzzles. Pick a difficulty, theme and size, then solve, save, resume and print. Every puzzle is a brand new story with exactly one answer.';
  const game = {
    '@context': 'https://schema.org', '@type': ['VideoGame', 'WebApplication'], name, url: url(''),
    description: appDescription, image: url('og-image.jpg'), inLanguage: 'en',
    genre: ['Puzzle', 'Logic puzzle', 'Mystery'], gamePlatform: ['Web browser', 'Windows'],
    applicationCategory: 'GameApplication', operatingSystem: 'Any (web browser), Windows 10 and 11', browserRequirements: 'Requires JavaScript',
    playMode: ['SinglePlayer', 'MultiPlayer'], isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    accessibilityFeature: ['highContrastDisplay', 'largePrint', 'captions', 'transcript', 'fullKeyboardControl', 'screenReaderSupport'],
    trailer: { '@id': url('how-to-play/#video') },
  };
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name, url: url(''), description: appDescription };
  const head = `<meta name="description" content="${esc(appDescription)}">
<meta name="robots" content="index, follow, max-image-preview:large">
${social({ title: `${name}: free story logic grid puzzles`, description: appDescription, path: '' })}
${verification}
<script type="application/ld+json">${json(website)}</script>
<script type="application/ld+json">${json(game)}</script>
<meta name="flg-daily" content="daily/">`;
  // Shown when scripts are off, and read by crawlers that do not run them.
  const noscript = `<noscript><div class="card" style="margin:1rem"><p><strong>${name}</strong> is a free logic grid puzzle game where every puzzle is a brand new story. Turn on JavaScript to play.</p><p>${NAV.map(([p, n]) => `<a href="${p}">${n}</a>`).join(' · ')}</p></div></noscript>`;
  const game_html = appHtml
    .replace(/<meta name="description"[^>]*>/, head)
    .replace(/<body>/, `<body>\n${noscript}`);
  writeFileSync(join(site, 'index.html'), game_html);
  pages.push({ path: '', lastmod: updated, priority: 1 });

  // ---------- how to play ----------
  const transcript = (appHtml.match(/<details class="transcript">[\s\S]*?<\/summary>([\s\S]*?)<\/details>/) || [])[1] || '';
  const minutes = (appHtml.match(/An (\d+)-minute narrated video/) || [])[1];
  const faq = [
    ['What is a logic grid puzzle?', 'A logic grid puzzle gives you a few categories, such as people, places and times, and a list of clues. You use the grid to mark which items go together until every match is known. There is no guessing: the clues lead to exactly one answer.'],
    ['Is The Fantastical Logic Grid free?', 'Yes. It is free to play in any modern web browser, with no account and no ads. A free Windows app is also available, and a free account is optional for syncing saves between devices.'],
    ['How do I mark the grid?', 'Tap or click a square once for an X, which means ruled out. Tap again for an O, which means confirmed. Tap a third time to clear it. Each row and column in a section has exactly one O.'],
    ['Are the stories ever repeated?', 'No. Every puzzle has a brand new story, built from the theme, topic and size you pick, and the game never gives you the same story twice.'],
    ['Can I save, resume or print a puzzle?', 'Yes. Your progress saves automatically, so you can come back any time from Saved puzzles. You can print any puzzle, blank or with your marks, with the answer key on its own page.'],
    ['Does it work offline?', 'Yes. After your first visit the game works without an internet connection, and you can install it from your browser like an app.'],
    ['How hard are the puzzles?', `There are ${Object.keys(TIERS).length} difficulty levels, from Basic for beginners to MENSA for true masterminds. Each level adds categories, items and harder kinds of clues.`],
    ['Is it accessible?', 'The game works fully by keyboard and with a screen reader, has a List view instead of the grid, light, dark and high-contrast colors, captions on the video, and a Silent mode with no pictures, sound or animation.'],
  ];
  page({
    path: 'how-to-play/', priority: 0.9,
    title: `How to play logic grid puzzles | ${name}`,
    description: 'Learn how to solve logic grid puzzles step by step: read the story, follow the clues and mark X and O in the grid. Includes a narrated video with captions.',
    crumbs: [['how-to-play/', 'How to play']],
    schema: [
      { '@context': 'https://schema.org', '@type': 'HowTo', name: 'How to solve a logic grid puzzle', description: 'Solve a story logic grid puzzle by deduction, with no guessing.', step: [
        ['Pick a puzzle', 'Choose a difficulty, a theme and a size, then press Generate puzzle.'],
        ['Read the story', 'The story tells you who is involved and ends with the question you need to answer.'],
        ['Mark what the clues rule out', 'Tap a square once for X when two things cannot go together.'],
        ['Confirm matches', 'Tap again for O when two things must go together, then rule out the rest of that row and column.'],
        ['Answer the questions', 'When the grid is full, answer the story questions and press Check answers.'],
      ].map(([n, t], i) => ({ '@type': 'HowToStep', position: i + 1, name: n, text: t })) },
      { '@context': 'https://schema.org', '@type': 'VideoObject', '@id': url('how-to-play/#video'), name: `Introduction to ${name}`, description: 'A narrated, captioned walkthrough of a full puzzle, from picking a theme to closing the case.', thumbnailUrl: [url('og-image.jpg')], uploadDate: '2026-10-25', contentUrl: url('media/intro.mp4'), embedUrl: url('how-to-play/'), inLanguage: 'en', ...(minutes ? { duration: `PT${minutes}M` } : {}), transcript: transcript.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim() },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
    body: (up) => `<h1>How to play logic grid puzzles</h1>
<p class="lede">Each puzzle in ${name} is a logic grid wrapped in a story. The story sets up a mystery, the clues give you the facts, and the grid is where you work out the answer. Every puzzle has exactly one answer you can reach without guessing.</p>
${playBtn(up)}
<p>Never solved one before? <a href="${up}?learn">How to play, step by step</a> teaches you in the game on real grids: X and O, every kind of clue, carrying facts across the grid and what-if thinking, with tips and tricks.</p>
<h2>The rules in five steps</h2>
<ol class="steps">
  <li><strong>Pick a puzzle.</strong> Choose a <a href="${up}difficulty-levels/">difficulty</a>, a <a href="${up}themes/">theme</a> and a size. More categories and items make a bigger, harder grid.</li>
  <li><strong>Read the story.</strong> It tells you who is involved and ends with the question you need to answer.</li>
  <li><strong>Mark an X</strong> where a clue rules a pair out. Tap a square once for X.</li>
  <li><strong>Mark an O</strong> where two things must go together. Tap again for O. Each row and column in a section has exactly one O, so the rest of that line becomes X.</li>
  <li><strong>Answer the questions</strong> under the clues and press Check answers to close the case.</li>
</ol>
<p>Stuck? Press <strong>Hint</strong>: the first hint points you to a clue, then the exact square, then the full reasoning. Undo and Redo take back any move, and <strong>Check</strong> shows whether any mark is wrong.</p>
<h2>Watch the introduction: a full case, solved</h2>
<video id="video" controls preload="metadata" playsinline poster="${up}og-image.jpg" width="1280" height="720">
  <source src="${up}media/intro.mp4" type="video/mp4">
  <track kind="captions" srclang="en" label="English" src="${up}media/intro.en.vtt" default>
</video>
<p class="muted">${minutes ? `${minutes} minutes, ` : ''}narrated, with captions. Use the CC button to turn them off.</p>
<details class="transcript"><summary>Read the transcript</summary>${transcript}</details>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${esc(a)}</p>`).join('\n')}
${playBtn(up, 'Start a new case')}`,
  });

  // ---------- difficulty levels ----------
  const tiers = Object.values(TIERS).sort((a, b) => a.order - b.order);
  page({
    path: 'difficulty-levels/', priority: 0.7,
    title: `Logic puzzle difficulty levels, from Basic to MENSA | ${name}`,
    description: `${tiers.length} difficulty levels of logic grid puzzles: ${tiers.map((t) => t.name).join(', ')}. See the grid sizes and the kinds of clues each level uses.`,
    crumbs: [['difficulty-levels/', 'Difficulty levels']],
    body: (up) => `<h1>Difficulty levels</h1>
<p class="lede">Start easy and work up. Each level adds categories, items and harder kinds of clues, and every puzzle can still be solved by deduction alone.</p>
<div class="table-wrap"><table>
<caption>The ${tiers.length} levels</caption>
<thead><tr><th scope="col">Level</th><th scope="col">Grid size</th><th scope="col">Kinds of clues</th></tr></thead>
<tbody>${tiers.map((t) => `<tr><th scope="row">${esc(t.name)}</th><td>${esc(t.summary.split(',').slice(0, 2).join(','))}</td><td>${Object.keys(t.weights).map((k) => esc(CLUE_TYPES[k] || k)).join(', ')}</td></tr>`).join('')}</tbody>
</table></div>
<h2>The kinds of clues</h2>
<dl>${Object.entries(CLUE_TYPES).map(([k, n]) => `<dt>${esc(n)}</dt><dd>${esc({ is: 'Two things go together.', not: 'Two things do not go together.', neither: 'Something matches neither of two choices.', either: 'Something matches one of two choices.', pairs: 'Of two people, one matches each of two things.', allDiff: 'A group of things are all different people.', less: 'One value is more or less than another.', diff: 'Two values are an exact amount apart.', ifthen: 'If one match is true, another is too.' }[k] || '')}</dd>`).join('')}</dl>
${playBtn(up)}`,
  });

  // ---------- themes ----------
  page({
    path: 'themes/', priority: 0.8,
    title: `Logic puzzle themes: mystery, fantasy, sci-fi and more | ${name}`,
    description: `${THEMES.length} story themes for logic grid puzzles: ${THEMES.map((t) => t.name).join(', ')}. Each has its own topics, characters and categories.`,
    crumbs: [['themes/', 'Themes']],
    body: (up) => `<h1>Puzzle themes</h1>
<p class="lede">Pick a theme and the game writes a brand new story for it. Most themes also have topics, like which holiday or which kind of mystery.</p>
<ul class="cards">${THEMES.map((t) => `<li><h2><a href="${up}themes/${t.id}/">${esc(t.name)} logic puzzles</a></h2><p>${esc(t.description)}</p><p class="muted">${getTopics(t.id).length} topics</p></li>`).join('')}</ul>
${playBtn(up)}`,
  });
  for (const t of THEMES) {
    const topics = getTopics(t.id);
    const count = storylineCount(t.id);
    page({
      path: `themes/${t.id}/`, priority: 0.6,
      title: `${t.name} logic grid puzzles, free | ${name}`,
      description: `Free ${t.name.toLowerCase()} logic grid puzzles with a new story every time. ${t.description} Topics include ${topics.slice(0, 3).map((p) => p.name).join(', ')}.`,
      crumbs: [['themes/', 'Themes'], [`themes/${t.id}/`, t.name]],
      body: (up) => `<h1>${esc(t.name)} logic grid puzzles</h1>
<p class="lede">${esc(t.description)} The ${esc(t.cast.many)} and their details change in every puzzle, and the story is never repeated.</p>
${playBtn(up, `Play a ${t.name.toLowerCase()} puzzle`)}
<h2>Topics</h2>
<ul class="cards">${topics.map((p) => `<li><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></li>`).join('')}</ul>
<h2>What you match</h2>
<p>Each puzzle matches the ${esc(t.cast.many)} with things like ${t.categories.slice(0, 4).map((c) => esc(c.name.toLowerCase())).join(', ')}.${count ? ` The ${esc(t.name)} theme alone can tell more than ${(Math.floor(count / 1000) * 1000).toLocaleString('en-US')} different stories.` : ''}</p>
<p><a href="${up}themes/">All themes</a> · <a href="${up}how-to-play/">How to play</a></p>`,
    });
  }

  // ---------- daily puzzles ----------
  // Every day from the first one is rebuilt in order, so a story is never used
  // twice. Changes planned in the admin dashboard (a theme, difficulty or size,
  // or a new story) come from the Worker; past days are locked there.
  const plan = await readDailyPlan(base);
  const used = new Set();
  const daily = new Map();
  const upcoming = [];
  for (let d = DAILY_START, i = 0; d <= addDays(today, DAILY_AHEAD_DAYS); d = addDays(d, 1), i++) {
    const o = plan.get(d) || {};
    const theme = THEMES.some((t) => t.id === o.theme) ? o.theme : THEMES[i % THEMES.length].id;
    const difficulty = TIERS[o.difficulty] ? o.difficulty : DAILY_TIERS[new Date(`${d}T00:00:00Z`).getUTCDay()];
    const size = o.categories && o.items ? { categories: o.categories, items: o.items } : {};
    const seed = `daily-${d}${o.reroll ? `-r${o.reroll}` : ''}`;
    let p;
    for (let n = 0; n < 20; n++) {
      p = generatePuzzle({ difficulty, theme, ...size, seed: `${seed}${n ? `-${n}` : ''}` });
      if (!used.has(p.story.id)) break;
    }
    used.add(p.story.id);
    if (d > today) upcoming.push(dailySummary(p, d, plan.has(d)));
    else if (d > addDays(today, -DAILY_ARCHIVE_DAYS - 1)) daily.set(d, p);
  }
  // The game's Daily puzzle reads these: latest.json names today's puzzle and
  // puzzles/<date>.json holds each one in full (the pages show the answers anyway).
  mkdirSync(join(site, 'daily', 'puzzles'), { recursive: true });
  for (const [d, p] of daily) writeFileSync(join(site, 'daily', 'puzzles', `${d}.json`), JSON.stringify({ date: d, puzzle: p }));
  writeFileSync(join(site, 'daily', 'latest.json'), JSON.stringify({ date: today, ...dailySummary(daily.get(today), today, plan.has(today)), days: [...daily.keys()].sort().reverse() }));
  // For the dashboard's planner: the next days, without clues or answers.
  writeFileSync(join(site, 'daily', 'upcoming.json'), JSON.stringify({ built: new Date().toISOString(), today, days: upcoming }));
  // Every change ever made, so a later build can rebuild past days the same way.
  writeFileSync(join(site, 'daily', 'plan.json'), JSON.stringify({ plan: [...plan.values()] }));
  const puzzleBody = (p, d, up) => `<p class="meta">${esc(longDate(d))} · ${esc(p.theme.name)}${p.topic ? ` (${esc(p.topic.name)})` : ''} · ${esc(p.difficulty.name)} · ${p.categories.length} categories × ${p.categories[0].items.length} items</p>
<h2>The story</h2>
${p.story.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('\n')}
<h2>Categories</h2>
<ul>${p.categories.map((c) => `<li><strong>${esc(c.name)}:</strong> ${c.items.map((i) => esc(i.label)).join(', ')}</li>`).join('')}</ul>
<h2>Clues</h2>
<ol class="clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
<h2>Questions</h2>
<ol>${p.questions.map((q) => `<li>${esc(q.text)}</li>`).join('')}</ol>
<p>Work it out on paper, or <a href="${up}">play an interactive puzzle in the app</a> with a grid, hints and saves.</p>
<details class="answers"><summary>Show the answer key (spoilers)</summary>
<div class="table-wrap"><table><caption>Answer key</caption><thead><tr>${p.answerKey.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${p.answerKey.rows.map((r) => `<tr>${r.map((v, i) => i ? `<td>${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>
<ol>${p.answerKey.questions.map((q) => `<li>${esc(q.question)} <strong>${esc(q.answer)}</strong></li>`).join('')}</ol>
<p>${esc(p.story.ending)}</p>
</details>`;
  const dailyArticle = (p, d, path) => ({ '@context': 'https://schema.org', '@type': 'Article', headline: `${p.title}: daily logic puzzle for ${longDate(d)}`, datePublished: d, dateModified: d, url: url(path), image: url('og-image.jpg'), author: { '@type': 'Organization', name }, publisher: { '@type': 'Organization', name, logo: { '@type': 'ImageObject', url: url('icons/icon-512.png') } }, isAccessibleForFree: true });
  const past = [...daily.keys()].filter((d) => d < today).sort().reverse();
  const recent = (up) => past.length ? `<h2>Earlier daily puzzles</h2>\n<ul class="archive">${past.map((d) => `<li><a href="${up}daily/${d}/">${esc(longDate(d))}: ${esc(daily.get(d).title)}</a></li>`).join('')}</ul>` : '';
  const todays = daily.get(today);
  page({
    path: 'daily/', priority: 0.9, lastmod: today, type: 'article',
    title: `Daily logic puzzle: ${todays.title} | ${name}`,
    description: `Today's free logic grid puzzle: ${todays.title}, a ${todays.difficulty.name.toLowerCase()} ${todays.theme.name.toLowerCase()} story. A new puzzle every day, with the answer key.`,
    crumbs: [['daily/', 'Daily puzzle']],
    schema: [dailyArticle(todays, today, 'daily/')],
    body: (up) => `<h1>Daily logic puzzle: ${esc(todays.title)}</h1>
<p class="lede">A new logic grid puzzle with a new story every day. Read the story and the clues, work out the grid, then check the answer key.</p>
${puzzleBody(todays, today, up)}
${recent(up)}`,
  });
  for (const d of past) {
    const p = daily.get(d);
    page({
      path: `daily/${d}/`, priority: 0.4, lastmod: d, type: 'article',
      title: `${p.title}: logic puzzle for ${longDate(d)} | ${name}`,
      description: `The daily logic grid puzzle for ${longDate(d)}: ${p.title}, a ${p.difficulty.name.toLowerCase()} ${p.theme.name.toLowerCase()} story, with clues and the answer key.`,
      crumbs: [['daily/', 'Daily puzzle'], [`daily/${d}/`, longDate(d)]],
      schema: [dailyArticle(p, d, `daily/${d}/`)],
      body: (up) => `<h1>${esc(p.title)}</h1>
${puzzleBody(p, d, up)}
<p><a href="${up}daily/">Today's puzzle</a></p>`,
    });
  }

  // ---------- 404, files, sitemap, robots, llms.txt, IndexNow ----------
  page({ path: '404.html', listed: false, title: `Page not found | ${name}`, description: 'This page does not exist.', body: (up) => `<h1>That page is not here</h1><p class="lede">The page may have moved. Try one of these.</p>${playBtn(up, 'Play a puzzle')}` });
  // 404.html is served at any depth, so its links must start at the site root.
  const root404 = new URL(base).pathname.replace(/\/?$/, '/');
  writeFileSync(join(site, '404.html'), readFileSync(join(site, '404.html'), 'utf8').replace(/(href|src)="(?!https?:|#)([^"]*)"/g, (m, a, h) => `${a}="${root404}${h}"`));
  cpSync(join(root, 'seo', 'og-image.jpg'), join(site, 'og-image.jpg'));
  writeFileSync(join(site, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);

  writeFileSync(join(site, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${url(p.path)}</loc><lastmod>${p.lastmod}</lastmod><priority>${p.priority.toFixed(1)}</priority></url>`).join('\n')}
</urlset>
`);
  writeFileSync(join(site, 'robots.txt'), `# ${name}: every page may be crawled, by search engines and AI assistants alike.
User-agent: *
Allow: /

Sitemap: ${url('sitemap.xml')}
`);
  writeFileSync(join(site, 'llms.txt'), `# ${name}

> ${appDescription} Free in any web browser at ${url('')}, offline-ready, and as a Windows app. No account needed.

- Difficulty levels: ${tiers.map((t) => t.name).join(', ')}
- Themes: ${THEMES.map((t) => t.name).join(', ')}
- Features: hints, unlimited undo, autosave and resume, printing with an answer key, light/dark/high-contrast colors, keyboard and screen reader support, Silent mode, optional free account to sync devices, races against other players

## Pages

- [Play the game](${url('')})
- [How to play](${url('how-to-play/')}): rules, a narrated video and FAQ
- [Daily puzzle](${url('daily/')}): a new free puzzle every day, with the answer key
- [Themes](${url('themes/')})
- [Difficulty levels](${url('difficulty-levels/')})
`);
  return { pages: pages.map((p) => url(p.path)), today };
}
