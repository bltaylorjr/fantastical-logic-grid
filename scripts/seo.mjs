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
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gridTable, answerKey } from './worksheet.mjs';
import { writeGamePage, writeHubPages, contactLink } from './hub.mjs';
import { educatorsBody, EDUCATORS_CSS, educatorFeedbackBody, FEEDBACK_CSS } from './educators-page.mjs';

// Search pages are plain HTML: only the site's own files may load, inline
// <style> is allowed, and no inline script ever runs (JSON-LD is data, not code).
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'";

// The game's page. The site's front page (index.html) is The Logic Grid's
// list of games (scripts/hub.mjs); The Fantastical Logic Grid plays at
// fantastical/ and NINETIMESNINE at ninetimesnine/.
export const GAME = 'fantastical/';

export const INDEXNOW_KEY = process.env.FLG_INDEXNOW_KEY || 'fae88a004ad87116c0e93df007b2de7e';
// The game's social pages (web/js/social.js): the links set in the admin
// dashboard (Settings and switches > Social links), read at build time.
const socialPages = await import(new URL('../web/js/social.js', import.meta.url).href);
// The first daily puzzle. Every later day is checked against all earlier days,
// so a daily story is never used twice.
const DAILY_START = '2026-10-25';
const DAILY_ARCHIVE_DAYS = 30;
// The first puzzle of the week (a Monday): a bigger Expert puzzle, emailed to
// the weekly list (server/src/puzzle-mail.js). Weekly and special edition
// stories come from the same chain as the daily ones, so none is ever reused.
const WEEKLY_START = '2026-11-02';
const WEEKLY_TIER = 'expert';
const WEEKLY_ARCHIVE = 8;
// Days ahead the admin dashboard's daily planner can preview.
const DAILY_AHEAD_DAYS = 14;
// How many puzzles the Hand-picked collection shows.
const PICKS_MAX = 12;
// One difficulty per weekday (Sunday first). Expert and Quantum Physicist take seconds
// to make, and the daily chain is rebuilt from the start on every build.
const DAILY_TIERS = ['hard', 'easy', 'medium', 'basic', 'easy', 'medium', 'hard'];
// Printable worksheets for teachers and parents: a new set every week (weeks
// start on Monday), one puzzle per level, at a size that fits on paper.
const PRINT_START = '2026-10-26';
const PRINT_LEVELS = [
  { tier: 'basic', categories: 3, items: 3, ages: 'ages 7 and up' },
  { tier: 'easy', categories: 3, items: 4, ages: 'ages 9 and up' },
  { tier: 'medium', categories: 4, items: 4, ages: 'ages 11 and up' },
  { tier: 'hard', categories: 4, items: 5, ages: 'ages 13 and up' },
];

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
// Special edition puzzles planned in the admin dashboard (server/src/editions.js).
// Like the daily plan: the Worker first, then the copy the live site
// published, and with FLG_DAILY_PLAN_REQUIRED=1 no rebuild without one of them,
// because a missing edition would change the stories of later days.
async function readSpecials(base) {
  const get = async (u) => {
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${u} answered ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.specials)) throw new Error(`${u} has no special editions`);
    return body.specials;
  };
  const sources = [process.env.FLG_CLOUD_URL && `${process.env.FLG_CLOUD_URL.replace(/\/+$/, '')}/v1/specials`, `${base}/specials/list.json`].filter(Boolean);
  let missing = 0;
  for (const u of sources) {
    try {
      const rows = await get(u);
      if (!rows) { missing++; continue; }
      // Only the known fields, checked, so nothing else from the network is kept or written.
      const str = (v, max) => String(v ?? '').slice(0, max);
      const num = (v) => (Number.isInteger(v) && v >= 3 && v <= 8 ? v : null);
      return rows.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^se-[\w-]{1,40}$/.test(r.id) && r.title)
        .map((r) => ({ id: r.id, date: r.date, title: str(r.title, 80), note: str(r.note, 400), theme: r.theme ? str(r.theme, 40) : null, difficulty: r.difficulty ? str(r.difficulty, 20) : null, categories: num(r.categories), items: num(r.items) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    } catch (e) { console.warn(`Special editions: ${e.message}`); }
  }
  // Both answered "not found": no editions yet (before the first one is planned).
  if (missing === sources.length) return [];
  if (process.env.FLG_DAILY_PLAN_REQUIRED === '1') throw new Error('The special edition list could not be read, so the site was not rebuilt (past puzzles must not change).');
  return [];
}

// Ratings and the best-rated daily puzzles (server/src/quality.js), for the
// Hand-picked page and the line at the foot of every page. If the Worker
// cannot be reached, the copy the live site published last time is used.
async function readQuality(base) {
  const sources = [process.env.FLG_CLOUD_URL && `${process.env.FLG_CLOUD_URL.replace(/\/+$/, '')}/v1/quality`, `${base}/daily/picks.json`].filter(Boolean);
  for (const u of sources) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`${u} answered ${res.status}`);
      const body = await res.json();
      const q = body.quality || body;
      if (!Array.isArray(q.daily)) throw new Error(`${u} has no ratings`);
      return { rating: q.rating || null, daily: q.daily, handPicked: Array.isArray(q.handPicked) ? q.handPicked : [] };
    } catch (e) { console.warn(`Ratings: ${e.message}`); }
  }
  return { rating: null, daily: [], handPicked: [] };
}
// The game's social pages for the footer and the Organization's sameAs, from
// the Worker's public config. If it cannot be reached, the launch defaults.
async function readSocial() {
  const cloud = (process.env.FLG_CLOUD_URL || '').replace(/\/+$/, '');
  if (cloud) {
    try {
      const res = await fetch(`${cloud}/v1/config`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const body = await res.json();
      if (Array.isArray(body.social)) return socialPages.socialLinks(Object.fromEntries(body.social.map((s) => [s.id, s.url])));
    } catch (e) { console.warn(`Social links: ${e.message}`); }
  }
  return socialPages.socialLinks(socialPages.DEFAULT_LINKS);
}
// Puzzles the live site already published, so past days never change when
// the engine gains new topics, story parts or levels: a day (or week, or
// special edition) that is already out is kept exactly as published. Missing
// ones (a first build, or the site unreachable) are built from their seed.
async function readPublished(base, paths) {
  const out = new Map();
  const list = [...paths];
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(list.slice(i, i + 20).map(async (path) => {
      try {
        const res = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return;
        const body = await res.json();
        if (body && body.puzzle && body.puzzle.story && Array.isArray(body.puzzle.clues)) out.set(path, body.puzzle);
      } catch (e) { /* built from its seed instead */ }
    }));
  }
  return out;
}
const longDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// Google flags any VideoObject without these fields, even a bare {"@id"} pointer to one on
// another page, so fail the build instead of shipping one.
function checkVideos(data, where) {
  const check = (v) => {
    const missing = ['name', 'description', 'thumbnailUrl', 'uploadDate'].filter((k) => !v?.[k]);
    if (!v?.contentUrl && !v?.embedUrl) missing.push('contentUrl or embedUrl');
    if (missing.length) throw new Error(`VideoObject on /${where} is missing ${missing.join(', ')}`);
  };
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    if ([].concat(o['@type'] || []).includes('VideoObject')) check(o);
    for (const k of ['trailer', 'video']) if (o[k]) check(o[k]);
    Object.values(o).forEach(visit);
  };
  visit(data);
  return data;
}

export async function buildSeo({ root, site }) {
  // The game's Worker. Every page counts visits from campaign links with the
  // game's own campaign.js (js/page-visit.js), so every page may send those
  // counts to it; the Educators form also sends its requests there.
  const cloud = (process.env.FLG_CLOUD_URL || '').replace(/\/+$/, '');
  const cloudOrigin = (() => { try { return cloud ? new URL(cloud).origin : ''; } catch { return ''; } })();
  const SITE_CSP = cloudOrigin ? PAGE_CSP.replace("default-src 'self';", `default-src 'self'; connect-src 'self' ${cloudOrigin};`) : PAGE_CSP;
  const base = (process.env.FLG_SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, '');
  const url = (path) => `${base}/${path}`;
  // The same engine the site ships. In server mode (docs/PUZZLE-SERVER.md)
  // the site has no generator, so the pages are made from the source engine.
  const engineDir = existsSync(join(site, 'engine', 'index.js')) ? join(site, 'engine') : join(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'src');
  const engine = await import(pathToFileURL(join(engineDir, 'index.js')).href);
  const { THEMES, TIERS, CLUE_TYPES, getTopics, storylineCount, generatePuzzle } = engine;
  const { houseDailyOptions } = await import(pathToFileURL(join(engineDir, 'house-tuning.js')).href);
  const today = process.env.FLG_TODAY || day(new Date());
  const appHtml = readFileSync(join(site, 'index.html'), 'utf8');
  // Pages that come from code change when the code does; the date of the last
  // commit is the honest "last changed" date for them.
  let updated = today;
  try { updated = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: root, encoding: 'utf8' }).trim() || today; } catch {}
  const name = 'The Fantastical Logic Grid';
  const pages = []; // { path, lastmod, priority }
  const quality = await readQuality(base);
  const socialList = await readSocial();

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
  // Copyright and text-and-data-mining reservation (W3C TDMRep), shown on every page.
  const year = Number(today.slice(0, 4));
  const owner = 'Bobby Taylor';
  const copyright = `© 2026${year > 2026 ? `–${year}` : ''} ${owner}. All rights reserved.`;
  const trademark = `${name}™ is a trademark of ${owner}.`;
  const tdmMeta = `<meta name="tdm-reservation" content="1">\n<meta name="tdm-policy" content="${url('terms/')}">`;
  const NAV = [['how-to-play/', 'How to play'], ['daily/', 'Daily puzzle'], ['printables/', 'Printables'], ['themes/', 'Themes'], ['difficulty-levels/', 'Difficulty levels'], ['educators/', 'For educators']];
  // Search results show about 60 characters of a title and 160 of a
  // description: a title that would be cut loses the site name (it is still in
  // og:site_name), and a description is shortened at a sentence or word.
  const fitTitle = (t) => (t.length > 65 && t.endsWith(` | ${name}`) ? t.slice(0, -name.length - 3) : t);
  const fitDescription = (d) => {
    if (d.length <= 160) return d;
    const cut = d.slice(0, 160);
    const end = cut.lastIndexOf('. ');
    return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`;
  };
  // App pages (privacy, terms) belong to The Logic Grid as a whole, not one
  // game: their header and footer lead back to the front page and every game.
  const APP_NAV = [['fantastical/', 'The Fantastical Logic Grid'], ['ninetimesnine/', 'NINETIMESNINE'], ['privacy/', 'Privacy'], ['terms/', 'Terms of use']];
  const page = ({ path, title: fullTitle, description: fullDescription, body, crumbs = [], schema = [], lastmod = updated, priority = 0.6, type, listed = true, csp = SITE_CSP, style = '', script = '', app = false }) => {
    const title = fitTitle(fullTitle);
    const description = fitDescription(fullDescription);
    const file = path.endsWith('.html') ? path : `${path}index.html`;
    const up = '../'.repeat(file.split('/').length - 1);
    const trail = [['', 'Home'], ...crumbs];
    const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail.map(([p, n], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: url(p) })) };
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${listed ? 'index, follow, max-image-preview:large' : 'noindex'}">
<meta name="theme-color" content="#5B3CC4">
${tdmMeta}
${social({ title, description, path, type })}
${verification}
<link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${up}icons/icon-192.png">
<link rel="preload" href="${up}fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${up}fonts/cinzel-700.woff2" as="font" type="font/woff2" crossorigin>
<style>${css.replaceAll('url(fonts/', `url(${up}fonts/`)}${style}</style>
<script type="module" src="${up}js/page-visit.js"></script>
<script type="module" src="${up}js/site-report.js"></script>
<script type="module" src="${up}js/site-nav.js"></script>
${script ? `<script type="module" src="${script}"></script>` : ''}
${[breadcrumb, ...schema].map((s) => `<script type="application/ld+json">${json(checkVideos(s, path))}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${app ? `<header class="top">
  <a class="back" href="${up}" data-back><span aria-hidden="true">‹</span> Back</a>
  <a class="brand" href="${up}">The Logic Grid</a>
  <nav aria-label="Site">
    <ul>${APP_NAV.map(([p, n]) => `<li><a href="${up}${p}"${p === path ? ' aria-current="page"' : ''}>${n}</a></li>`).join('')}</ul>
  </nav>
  <a class="btn" href="${up}">All games</a>
</header>` : `<header class="top">
  <a class="back" href="${up}${GAME}" data-back><span aria-hidden="true">‹</span> Back</a>
  <a class="brand" href="${up}${GAME}">${name}</a>
  <nav aria-label="Site">
    <ul>${NAV.map(([p, n]) => `<li><a href="${up}${p}"${p === path ? ' aria-current="page"' : ''}>${n}</a></li>`).join('')}</ul>
  </nav>
  <a class="btn" href="${up}${GAME}?play=now" rel="nofollow" data-design-text="infoPlay">Play free</a>
</header>`}
${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${trail.map(([p, n], i) => i === trail.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${up}${p}">${esc(n)}</a></li>`).join('')}</ol></nav>` : ''}
<main id="main">
${body(up)}
</main>
<footer class="foot">
  ${app ? `<p><a class="btn quiet" href="${up}" data-back><span aria-hidden="true">‹</span> Back</a> <a class="btn quiet" href="${up}">The Logic Grid home</a></p>
  <p>The Logic Grid: <a href="${up}fantastical/">The Fantastical Logic Grid</a> and <a href="${up}ninetimesnine/">NINETIMESNINE</a>, free in your browser. Questions? ${contactLink()}</p>` : `<p><a class="btn quiet" href="${up}${GAME}" data-back><span aria-hidden="true">‹</span> Back</a> <a class="btn quiet" href="${up}${GAME}">Back to the game</a> <a class="btn quiet" href="${up}">The Logic Grid home</a></p>
  <p><a href="${up}${GAME}">Play ${name}</a> · free in your browser, offline-ready, and on Windows.</p>`}
  <p>Every puzzle has exactly one answer, checked by our solver${quality.rating ? `, and players rate them ${quality.rating.average} out of 5 stars` : ''}. <a href="${up}picks/">Hand-picked puzzles</a></p>
  <p>${NAV.map(([p, n]) => `<a href="${up}${p}">${n}</a>`).join(' · ')} · <a href="${up}privacy/">Privacy</a></p>
  ${socialList.length ? `<div class="foot-social"><p>Follow the game</p>${socialPages.socialHtml(socialList)}</div>` : ''}
  <p><button class="btn quiet report-btn" type="button" data-report-problem hidden>Report a Problem</button></p>
  <p class="muted">${copyright} ${trademark} <a href="${up}terms/">Terms of use</a></p>
</footer>
</body>
</html>
`;
    mkdirSync(dirname(join(site, file)), { recursive: true });
    writeFileSync(join(site, file), html);
    if (listed) pages.push({ path, lastmod, priority });
  };
  // Generic play buttons open a quick puzzle straight away (?play=now in web/js/app.js);
  // a theme page's button opens the game to choose that theme.
  const playBtn = (up, text = 'Play a new puzzle now', quick = true) => `<p><a class="btn big" href="${up}${GAME}${quick ? '?play=now' : ''}"${quick ? ' rel="nofollow"' : ''}>${text}</a></p>`;

  // The how-to-play video. Google does not follow an @id to another page, so every page
  // that mentions it (the game's trailer and the how-to-play page) carries the full object.
  const minutes = (appHtml.match(/An (\d+)-minute narrated video/) || [])[1];
  const video = {
    '@type': 'VideoObject', '@id': url('how-to-play/#video'), name: `Introduction to ${name}`,
    description: 'A narrated, captioned walkthrough of a full puzzle, from picking a theme to closing the case.',
    thumbnailUrl: [url('og-image.jpg')], uploadDate: '2026-10-25T00:00:00-04:00',
    contentUrl: url('media/intro.mp4'), embedUrl: url('how-to-play/'), inLanguage: 'en',
    ...(minutes ? { duration: `PT${minutes}M` } : {}),
  };

  // ---------- the game page (index.html) ----------
  const GAME_TITLE = `Free logic grid puzzles with stories | ${name}`;
  const appDescription = 'Free story logic grid puzzles. Pick a difficulty, theme and size, then solve, save, resume and print. Every puzzle is a brand new story with exactly one answer.';
  const game = {
    '@context': 'https://schema.org', '@type': ['VideoGame', 'WebApplication'], name, url: url(GAME),
    description: appDescription, image: url('og-image.jpg'), inLanguage: 'en',
    genre: ['Puzzle', 'Logic puzzle', 'Mystery'], gamePlatform: ['Web browser', 'Windows'],
    applicationCategory: 'GameApplication', operatingSystem: 'Any (web browser), Windows 10 and 11', browserRequirements: 'Requires JavaScript',
    playMode: ['SinglePlayer', 'MultiPlayer'], isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    accessibilityFeature: ['highContrastDisplay', 'largePrint', 'captions', 'transcript', 'fullKeyboardControl', 'screenReaderSupport'],
    trailer: video,
    copyrightHolder: { '@type': 'Person', name: owner }, copyrightYear: 2026,
  };
  const publisher = { '@type': 'Organization', name, url: url(''), logo: { '@type': 'ImageObject', url: url('icons/icon-512.png') }, sameAs: socialList.map((s) => s.url),
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', url: url('privacy/'), availableLanguage: 'en' } };
  game.publisher = publisher;
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name, url: url(''), description: appDescription, inLanguage: 'en', publisher };
  const head = `<meta name="description" content="${esc(appDescription)}">
<meta name="robots" content="index, follow, max-image-preview:large">
${tdmMeta}
${social({ title: name, description: appDescription, path: GAME })}
${verification}
<script type="application/ld+json">${json(checkVideos(game, GAME))}</script>
<meta name="flg-daily" content="../daily/">
<meta name="flg-np-page" content="ninetimesnine/">`;
  // Shown when scripts are off, and read by crawlers that do not run them.
  const noscript = `<noscript><div class="card" style="margin:1rem"><p><strong>${name}</strong> is a free logic grid puzzle game where every puzzle is a brand new story. Turn on JavaScript to play.</p><p>${NAV.map(([p, n]) => `<a href="${p}">${n}</a>`).join(' · ')}</p></div></noscript>`;
  // Crawlable links to the search pages at the foot of the home screen (website only).
  const siteLinks = `<nav class="site-links" aria-label="More about the game"><ul>${NAV.map(([p, n]) => `<li><a href="${p}">${n}</a></li>`).join('')}</ul></nav>`;
  const game_html = appHtml
    .replace('<title>The Fantastical Logic Grid</title>', `<title>${esc(GAME_TITLE)}</title>`)
    .replace(/<meta name="description"[^>]*>/, head)
    .replace(/(<main id="screen-home"[\s\S]*?)(<\/main>)/, (_, home, end) => `${home}${siteLinks}\n${end}`)
    .replace(/<body>/, `<body>\n${noscript}`);
  // The game moves to fantastical/; index.html becomes The Logic Grid's front page.
  writeGamePage(site, game_html);
  pages.push({ path: GAME, lastmod: updated, priority: 1 });
  writeHubPages({ site, url, verification, tdmMeta, copyright, socialList, pages, updated, csp: SITE_CSP, cloud, socialHtml: socialPages.socialHtml });

  // ---------- how to play ----------
  const transcript = (appHtml.match(/<details class="transcript">[\s\S]*?<\/summary>([\s\S]*?)<\/details>/) || [])[1] || '';
  const faq = [
    ['What is a logic grid puzzle?', 'A logic grid puzzle gives you a few categories, such as people, places and times, and a list of clues. You use the grid to mark which items go together until every match is known. There is no guessing: the clues lead to exactly one answer.'],
    ['Is The Fantastical Logic Grid free?', 'Yes. It is free to play in any modern web browser, with no account and no ads. A free Windows app is also available, and a free account is optional for syncing saves between devices.'],
    ['How do I mark the grid?', 'Tap or click a square once for an X, which means ruled out. Tap again for an O, which means confirmed. Tap a third time to clear it. Each row and column in a section has exactly one O.'],
    ['Are the stories ever repeated?', 'No. Every puzzle has a brand new story, built from the theme, topic and size you pick, and the game never gives you the same story twice.'],
    ['Can I save, resume or print a puzzle?', 'Yes. Your progress saves automatically, so you can come back any time from Saved puzzles. You can print any puzzle, blank or with your marks, with the answer key on its own page.'],
    ['Does it work offline?', 'Yes. After your first visit the game works without an internet connection, and you can install it from your browser like an app.'],
    ['How hard are the puzzles?', `There are ${Object.keys(TIERS).length} difficulty levels, from Basic for beginners to Theoretical Physicist for the best of the best. Each level adds categories, items and harder kinds of clues.`],
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
      { '@context': 'https://schema.org', ...video, transcript: transcript.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim() },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
    body: (up) => `<h1>How to play logic grid puzzles</h1>
<p class="lede">Each puzzle in ${name} is a logic grid wrapped in a story. The story sets up a mystery, the clues give you the facts, and the grid is where you work out the answer. Every puzzle has exactly one answer you can reach without guessing.</p>
${playBtn(up)}
<p>Never solved one before? <a href="${up}${GAME}?learn">How to play, step by step</a> teaches you in the game on real grids: X and O, every kind of clue, carrying facts across the grid and what-if thinking, with tips and tricks.</p>
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
    title: `Logic puzzle difficulty levels, from Basic to Theoretical Physicist | ${name}`,
    description: `${tiers.length} difficulty levels of logic grid puzzles: ${tiers.map((t) => t.name).join(', ')}. See the grid sizes and the kinds of clues each level uses.`,
    crumbs: [['difficulty-levels/', 'Difficulty levels']],
    schema: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Logic puzzle difficulty levels', numberOfItems: tiers.length, itemListElement: tiers.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, description: t.summary })) }],
    body: (up) => `<h1>Difficulty levels</h1>
<p class="lede">Start easy and work up. Each level adds categories, items and harder kinds of clues, and every puzzle can still be solved by deduction alone.</p>
<div class="table-wrap"><table>
<caption>The ${tiers.length} levels</caption>
<thead><tr><th scope="col">Level</th><th scope="col">Grid size</th><th scope="col">Kinds of clues</th></tr></thead>
<tbody>${tiers.map((t) => `<tr><th scope="row">${PRINT_LEVELS.some((l) => l.tier === t.id) ? `<a href="${up}printables/${t.id}/" title="Free printable ${esc(t.name.toLowerCase())} worksheet">${esc(t.name)}</a>` : esc(t.name)}</th><td>${esc(t.summary.split(',').slice(0, 2).join(','))}</td><td>${Object.keys(t.weights).map((k) => esc(CLUE_TYPES[k] || k)).join(', ')}</td></tr>`).join('')}</tbody>
</table></div>
<h2>The kinds of clues</h2>
<dl>${Object.entries(CLUE_TYPES).map(([k, n]) => `<dt>${esc(n)}</dt><dd>${esc({ is: 'Two things go together.', not: 'Two things do not go together.', neither: 'Something matches neither of two choices.', either: 'Something matches one of two choices.', pairs: 'Of two people, one matches each of two things.', allDiff: 'A group of things are all different people.', less: 'One value is more or less than another.', diff: 'Two values are an exact amount apart.', ifthen: 'If one match is true, another is too.' }[k] || '')}</dd>`).join('')}</dl>
${playBtn(up)}`,
  });

  // ---------- themes ----------
  page({
    path: 'themes/', priority: 0.8,
    title: `Logic puzzle themes: mystery, fantasy, sci-fi and more | ${name}`,
    description: `${THEMES.length} story themes for logic grid puzzles, including ${THEMES.slice(0, 5).map((t) => t.name).join(", ")} and more. Each has its own topics, characters and categories.`,
    crumbs: [['themes/', 'Themes']],
    schema: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Logic puzzle themes', numberOfItems: THEMES.length, itemListElement: THEMES.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: `${t.name} logic puzzles`, url: url(`themes/${t.id}/`) })) }],
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
${playBtn(up, `Play a ${t.name.toLowerCase()} puzzle`, false)}
<h2>Topics</h2>
<ul class="cards">${topics.map((p) => `<li><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></li>`).join('')}</ul>
<h2>What you match</h2>
<p>Each puzzle matches the ${esc(t.cast.many)} with things like ${t.categories.slice(0, 4).map((c) => esc(c.name.toLowerCase())).join(', ')}.${count ? ` The ${esc(t.name)} theme alone can tell more than ${(Math.floor(count / 1000) * 1000).toLocaleString('en-US')} different stories.` : ''}</p>
<h2>More themes</h2>
<ul class="inline-links">${THEMES.filter((o) => o.id !== t.id).map((o) => `<li><a href="${up}themes/${o.id}/">${esc(o.name)} puzzles</a></li>`).join('')}</ul>
<p><a href="${up}themes/">All themes</a> · <a href="${up}daily/">Today's daily puzzle</a> · <a href="${up}difficulty-levels/">Difficulty levels</a> · <a href="${up}how-to-play/">How to play</a></p>`,
    });
  }

  // ---------- daily puzzles ----------
  // Every day from the first one is rebuilt in order, so a story is never used
  // twice. Changes planned in the admin dashboard (a theme, difficulty or size,
  // or a new story) come from the Worker; past days are locked there.
  const plan = await readDailyPlan(base);
  const used = new Set();
  const dailyStories = []; // [date, story id], in date order, for the printables below
  const daily = new Map();
  const allPast = new Map(); // every daily puzzle up to today, for the Hand-picked collection
  const upcoming = [];
  // Weekly and special edition puzzles join the chain on their day, before
  // that day's daily puzzle, so every story stays new.
  const specials = await readSpecials(base);
  const weekly = new Map(); // Monday -> puzzle
  const specialPuzzles = new Map(); // edition id -> { edition, puzzle }
  const extraStories = []; // [date, story id] of weekly and special puzzles, for the printables below
  // Already published: past and today's daily puzzles, past weeks' puzzles
  // and special editions whose day has come.
  const pastDays = [];
  for (let d = DAILY_START; d <= today; d = addDays(d, 1)) pastDays.push(d);
  const published = process.env.FLG_NO_PUBLISHED === '1' ? new Map() : await readPublished(base, [
    ...pastDays.map((d) => `daily/puzzles/${d}.json`),
    ...pastDays.filter((d) => d >= WEEKLY_START && new Date(`${d}T00:00:00Z`).getUTCDay() === 1).map((d) => `weekly/puzzles/${d}.json`),
    ...specials.filter((e) => e.date <= today).map((e) => `specials/${e.id}.json`),
  ]);
  if (published.size) console.log(`Kept ${published.size} already published puzzles as they are.`);
  const kept = (path) => {
    const p = published.get(path);
    if (p) used.add(p.story.id);
    return p;
  };
  const fresh = (opts, seed) => {
    let p;
    for (let n = 0; n < 20; n++) {
      p = generatePuzzle({ ...opts, seed: `${seed}${n ? `-${n}` : ''}` });
      if (!used.has(p.story.id)) break;
    }
    used.add(p.story.id);
    return p;
  };
  for (let d = DAILY_START, i = 0; d <= addDays(today, DAILY_AHEAD_DAYS); d = addDays(d, 1), i++) {
    if (d >= WEEKLY_START && new Date(`${d}T00:00:00Z`).getUTCDay() === 1) {
      const p = kept(`weekly/puzzles/${d}.json`) || fresh({ difficulty: WEEKLY_TIER, theme: THEMES[(i + 3) % THEMES.length].id }, `weekly-${d}`);
      weekly.set(d, p);
      extraStories.push([d, p.story.id]);
    }
    for (const e of specials.filter((x) => x.date === d)) {
      const theme = THEMES.some((t) => t.id === e.theme) ? e.theme : THEMES[(i + 5) % THEMES.length].id;
      const difficulty = TIERS[e.difficulty] ? e.difficulty : 'hard';
      const size = e.categories && e.items ? { categories: e.categories, items: e.items } : {};
      const p = kept(`specials/${e.id}.json`) || fresh({ difficulty, theme, ...size }, `special-${e.id}`);
      specialPuzzles.set(e.id, { edition: e, puzzle: p });
      extraStories.push([d, p.story.id]);
    }
    const o = plan.get(d) || {};
    const theme = THEMES.some((t) => t.id === o.theme) ? o.theme : THEMES[i % THEMES.length].id;
    const difficulty = TIERS[o.difficulty] ? o.difficulty : DAILY_TIERS[new Date(`${d}T00:00:00Z`).getUTCDay()];
    const size = o.categories && o.items ? { categories: o.categories, items: o.items } : {};
    // The weekly improvement run's nudges, from their start date on; days
    // planned by hand in the admin dashboard are built exactly as planned.
    const house = plan.has(d) ? {} : houseDailyOptions(d, difficulty);
    const seed = `daily-${d}${o.reroll ? `-r${o.reroll}` : ''}`;
    const p = (d <= today && kept(`daily/puzzles/${d}.json`)) || fresh({ difficulty, theme, ...size, ...house }, seed);
    dailyStories.push([d, p.story.id]);
    if (d <= today) allPast.set(d, p);
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

  // The puzzle of the week (weekly/latest.json and weekly/puzzles/<Monday>.json)
  // and the special editions whose day has come (specials/index.json and
  // specials/<id>.json), for the game and the puzzle emails.
  const thisMonday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const weeks = [...weekly.keys()].filter((w) => w <= thisMonday).sort().reverse().slice(0, WEEKLY_ARCHIVE);
  mkdirSync(join(site, 'weekly', 'puzzles'), { recursive: true });
  for (const w of weeks) writeFileSync(join(site, 'weekly', 'puzzles', `${w}.json`), JSON.stringify({ week: w, puzzle: weekly.get(w) }));
  // Before the first week, an empty one, so the game's request is not an error.
  writeFileSync(join(site, 'weekly', 'latest.json'), JSON.stringify(weeks.length ? { week: weeks[0], ...dailySummary(weekly.get(weeks[0]), weeks[0], false), weeks } : { week: null, weeks: [] }));
  const specialSummary = ({ edition: e, puzzle: p }) => ({ id: e.id, date: e.date, editionTitle: e.title, note: e.note, ...dailySummary(p, e.date, true) });
  const outNow = [...specialPuzzles.values()].filter((x) => x.edition.date <= today).reverse();
  mkdirSync(join(site, 'specials'), { recursive: true });
  for (const x of outNow) writeFileSync(join(site, 'specials', `${x.edition.id}.json`), JSON.stringify({ id: x.edition.id, date: x.edition.date, title: x.edition.title, note: x.edition.note, puzzle: x.puzzle }));
  writeFileSync(join(site, 'specials', 'index.json'), JSON.stringify({ specials: outNow.slice(0, 20).map(specialSummary) }));
  // For the dashboard: the coming editions, without clues or answers.
  writeFileSync(join(site, 'specials', 'upcoming.json'), JSON.stringify({ built: new Date().toISOString(), specials: [...specialPuzzles.values()].filter((x) => x.edition.date > today).map(specialSummary) }));
  // Every edition, so a later build can rebuild the chain the same way.
  writeFileSync(join(site, 'specials', 'list.json'), JSON.stringify({ specials }));
  const puzzleBody = (p, d, up) => `<p class="meta">${esc(longDate(d))} · ${esc(p.theme.name)}${p.topic ? ` (${esc(p.topic.name)})` : ''} · ${esc(p.difficulty.name)} · ${p.categories.length} categories × ${p.categories[0].items.length} items</p>
<h2>The story</h2>
${p.story.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('\n')}
<h2>Categories</h2>
<ul>${p.categories.map((c) => `<li><strong>${esc(c.name)}:</strong> ${c.items.map((i) => esc(i.label)).join(', ')}</li>`).join('')}</ul>
<h2>Clues</h2>
<ol class="clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
<h2>Questions</h2>
<ol>${p.questions.map((q) => `<li>${esc(q.text)}</li>`).join('')}</ol>
<p>Work it out on paper, or <a href="${up}${GAME}">play an interactive puzzle in the app</a> with a grid, hints and saves.</p>
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
  // Every day has its own page from the day it starts (today's too), so a link
  // to a day's answer key, like the one in the daily Facebook and Instagram post
  // (scripts/social-puzzle.mjs), works at once and keeps working.
  for (const d of [today, ...past]) {
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

  // ---------- terms of use ----------
  page({
    path: 'terms/', priority: 0.2, app: true,
    title: `Terms of use | ${name}`,
    description: `What you may and may not do with ${name}: play and print for personal or classroom use; no copying, scraping or AI training.`,
    crumbs: [['terms/', 'Terms of use']],
    body: (up) => `<h1>Terms of use</h1>
<p class="lede">${name} is free to play. The game and everything in it belong to its owner. These terms say what you may do with it. By playing or using this website you agree to them.</p>
<p class="muted">Last updated 28 October 2026.</p>
<h2>Who owns it</h2>
<p>${copyright} The game, its puzzle and story engine, storylines, topics, characters, text, pictures, music, sounds, videos, website and app code, and the name and logo "${name}" are protected by copyright and other laws. ${trademark} The code is visible on GitHub, but it is not open source: see the <a href="${up}LICENSE.txt">license</a>. A few free, open-source parts keep their own licenses (listed in <a href="${up}THIRD-PARTY-NOTICES.txt">third-party notices</a>).</p>
<h2>What you may do</h2>
<ul>
<li>Play the game in your browser, the Windows app or an installed copy, as much as you like, for free.</li>
<li>Print puzzles, including the answer key, for yourself, your family, or a classroom, club or library group you lead, as long as you do not charge for them and you keep the game's name on the page.</li>
<li>Share your results with the game's Share button, link to any page, and quote a short part of a page with a link back.</li>
<li>Write about, review, stream or make videos of yourself playing.</li>
</ul>
<h2>What you may not do</h2>
<p>Unless you have written permission, you may not:</p>
<ul>
<li>Copy, republish, sell or give away the game's puzzles, storylines, characters, pictures, audio, video or code, in print or online, including in books, apps, websites or worksheets for sale.</li>
<li>Host your own copy of the game or website, or make a changed version of it.</li>
<li>Use bots, scrapers or other automated tools to collect puzzles, stories or other content, or to send many requests to the game's servers.</li>
<li>Use any part of the game or website to train, fine-tune or test an AI or machine-learning model, or to build a dataset. Text and data mining is expressly reserved (this is the opt-out under Article 4 of the EU Directive 2019/790, also signaled in our <a href="${up}robots.txt">robots.txt</a> and <a href="${up}.well-known/tdmrep.json">tdmrep.json</a>).</li>
<li>Get around the game's security, limits or sign-in, or take apart the apps except where the law allows it.</li>
<li>Use the name "${name}", its logo or a name that could be confused with it for another game, app or service.</li>
</ul>
<h2>Accounts, screen names and races</h2>
<p>Accounts are optional. Be kind: screen names, ideas and reports must not be rude, hateful or pretend to be someone else. We may remove a screen name, a score or an account that breaks these terms or cheats in races.</p>
<h2 id="tips">Tips and supporter thank-yous</h2>
<p>The whole game is free. If the "Support the game" link is shown, you can choose to leave a tip or a membership payment through an outside payment service (such as Ko-fi or Lemon Squeezy), which handles your card or PayPal details; we never see them.</p>
<ul>
<li>A tip is a voluntary gift to help keep a free game running. It does not buy the game, a puzzle or anything you could not already use.</li>
<li>As a thank-you, a tip may add a Supporter badge next to your screen name on the scoreboard, and a membership may also open supporter extra themes. These are added to your account straight away and last as long as the payment page says (a membership: while it is active).</li>
<li>Changed your mind, or paid by mistake? ${contactLink('Contact us')} within 30 days of the payment and we will refund it in full, no questions asked. This is quicker for you than asking your bank.</li>
<li>If a payment is refunded or disputed with your bank or card company (a chargeback), the badge and extras from it stop. After a chargeback, new payments add no badge or extras until it is settled. We keep a record of the payment and of the thank-yous it gave, and may share it with the payment service to answer the dispute.</li>
<li>You must be allowed to use the card or account you pay with. Payments made with someone else's card without their permission are refunded and the badge removed.</li>
</ul>
<h2>No guarantees</h2>
<p>The game is provided as it is, without any warranty. We do our best to keep it working and your saves safe, but we are not responsible for lost progress or for any loss from using it, as far as the law allows.</p>
<h2>Changes and contact</h2>
<p>We may update these terms; the date above shows the latest version. To ask for permission, report a copy of the game, or ask a question, ${contactLink('contact us')}.</p>
${playBtn(up)}`,
  });
  // ---------- Hand-picked: the best daily puzzles, and how every puzzle is checked ----------
  // Days an admin picked come first, then the best-rated daily puzzles
  // (never today's). The game lists the same ones from daily/picks.json.
  const storyDate = new Map(dailyStories.map(([d, id]) => [id, d]));
  const picked = new Map();
  for (const d of quality.handPicked) if (d < today && allPast.has(d) && !picked.has(d)) picked.set(d, { hand: true });
  for (const r of quality.daily) {
    const d = storyDate.get(r.story);
    if (d && d < today && !picked.has(d)) picked.set(d, { average: r.average, rated: r.rated });
  }
  const picks = [...picked].slice(0, PICKS_MAX).map(([d, why]) => ({ ...dailySummary(allPast.get(d), d, plan.has(d)), ...why }));
  for (const x of picks) writeFileSync(join(site, 'daily', 'puzzles', `${x.date}.json`), JSON.stringify({ date: x.date, puzzle: allPast.get(x.date) }));
  writeFileSync(join(site, 'daily', 'picks.json'), JSON.stringify({ built: today, quality, picks }));
  const pickWhy = (x) => (x.hand ? 'Picked by the team' : `Rated ${x.average} out of 5 by ${x.rated} players`);
  page({
    path: 'picks/', priority: 0.7, lastmod: today,
    title: `Hand-picked logic grid puzzles | ${name}`,
    description: 'The best daily logic grid puzzles, picked by the team and rated highest by players. Every puzzle has exactly one answer, checked by a solver that reasons like a person.',
    crumbs: [['picks/', 'Hand-picked puzzles']],
    body: (up) => `<h1>Hand-picked puzzles</h1>
<p class="lede">The daily puzzles players liked best, and ones the team picked. Each opens in the game with the grid, hints and saves.</p>
${picks.length ? `<ul class="picks">${picks.map((x) => `<li><a href="${up}${GAME}?play=daily&amp;day=${x.date}" rel="nofollow"><strong>${esc(x.title)}</strong></a><br><span class="meta">${esc(longDate(x.date))} · ${esc(x.difficultyName)} · ${esc(x.themeName)} · ${x.categories} × ${x.items} · ${esc(pickWhy(x))}</span>${daily.has(x.date) ? ` · <a href="${up}daily/${x.date}/">clues and answer key</a>` : ''}</li>`).join('')}</ul>`
    : `<p>The first picks appear here once players have rated a few daily puzzles. Until then, try <a href="${up}daily/">today's daily puzzle</a>.</p>`}
<h2>How every puzzle is checked</h2>
<ul>
<li><strong>Exactly one answer.</strong> Before a puzzle is shown, a solver works it out using only the steps a person can make from the clues. A puzzle is used only if the solver fills in every cell, which proves there is one answer and that it can be reached without guessing.</li>
<li><strong>No extra clues.</strong> Clues that are not needed are taken out, so each one matters.</li>
<li><strong>The right difficulty.</strong> The solver records the hardest step each puzzle needs, and the puzzle is kept only if that matches the level you chose, from Basic to Theoretical Physicist. The hints use the same steps, so they explain the next deduction instead of giving the answer away.</li>
<li><strong>Players have the last word.</strong> After solving, players can rate a puzzle from 1 to 5 stars.${quality.rating ? ` Over the last ${quality.rating.days} days, ${quality.rating.rated.toLocaleString('en-US')} ratings average <strong>${quality.rating.average} out of 5</strong>.` : ''} Low ratings for a theme or level are reviewed every week.</li>
</ul>
${playBtn(up)}`,
  });

  // ---------- For educators: free printable puzzle packages (website only) ----------
  // The form talks to the game's Worker (server/src/educators.js). Without a
  // cloud address (tests) this page may reach localhost.
  {
    const { classroomOptions, EDUCATOR_SURVEY, FEEDBACK_KINDS, FEEDBACK_TEXT } = await import(pathToFileURL(join(engineDir, 'classroom.js')).href);
    const csp = PAGE_CSP.replace("default-src 'self';", `default-src 'self'; connect-src 'self' ${cloudOrigin || 'http://localhost:* http://127.0.0.1:*'};`);
    mkdirSync(join(site, 'educators'), { recursive: true });
    cpSync(join(root, 'seo', 'educators.js'), join(site, 'educators', 'form.js'));
    // The how-to video (video/educators.cjs + video/build.py), when it has been made.
    const media = join(root, 'seo', 'media');
    let video = null;
    if (existsSync(join(media, 'educators.mp4'))) {
      for (const f of ['educators.mp4', 'educators.en.vtt', 'educators-poster.jpg']) if (existsSync(join(media, f))) cpSync(join(media, f), join(site, 'educators', f));
      const meta = existsSync(join(media, 'educators.json')) ? JSON.parse(readFileSync(join(media, 'educators.json'), 'utf8')) : {};
      video = { minutes: meta.minutes || 3, transcript: meta.transcript || [], seconds: meta.seconds || 180 };
    }
    const videoSchema = video ? [{ '@context': 'https://schema.org', '@type': 'VideoObject', name: 'How to request a free puzzle package for your class', description: 'From filling in the request form and confirming your school email to the printable PDFs arriving by email.',
      thumbnailUrl: url('educators/educators-poster.jpg'), uploadDate: updated, contentUrl: url('educators/educators.mp4'), embedUrl: url('educators/'), duration: `PT${Math.floor(video.seconds / 60)}M${Math.round(video.seconds % 60)}S`, inLanguage: 'en' }] : [];
    page({
      path: 'educators/', priority: 0.8, csp, style: EDUCATORS_CSS, script: 'form.js',
      title: `Free printable logic puzzle packages for teachers | ${name}`,
      description: 'Teachers can request free printable logic grid puzzle packages for their grade: choose difficulty, themes or your own theme, and how many puzzles. PDFs with answer keys, by email.',
      crumbs: [['educators/', 'For educators']],
      schema: videoSchema,
      body: (up) => educatorsBody(up, { options: classroomOptions(), api: cloud, video }),
    });
    // The private ideas, problems and feedback section, opened by the link in
    // the package email. Not listed in search.
    mkdirSync(join(site, 'educators', 'feedback'), { recursive: true });
    cpSync(join(root, 'seo', 'educator-feedback.js'), join(site, 'educators', 'feedback', 'feedback.js'));
    page({
      path: 'educators/feedback/', listed: false, csp, style: EDUCATORS_CSS + FEEDBACK_CSS, script: 'feedback.js',
      title: `Ideas, problems and feedback for educators | ${name}`,
      description: 'A private section for educators who received a puzzle package: send ideas, problems and feedback, and answer a short survey.',
      crumbs: [['educators/', 'For educators'], ['educators/feedback/', 'Ideas and feedback']],
      body: (up) => educatorFeedbackBody(up, { survey: EDUCATOR_SURVEY, kinds: FEEDBACK_KINDS, textMax: FEEDBACK_TEXT[1], api: cloud }),
    });
  }

  // ---------- Link in bio (links/): for Instagram and TikTok, whose captions
  // cannot hold a clickable link. Fixed buttons, then the newest posts from
  // the Worker (seo/links.js), each with its own tracked link. Not listed in search.
  {
    const csp = PAGE_CSP.replace("default-src 'self';", `default-src 'self'; connect-src 'self' ${cloudOrigin || 'http://localhost:* http://127.0.0.1:*'};`);
    mkdirSync(join(site, 'links'), { recursive: true });
    cpSync(join(root, 'seo', 'links.js'), join(site, 'links', 'links.js'));
    page({
      path: 'links/', listed: false, csp, script: 'links.js',
      style: '.links{list-style:none;padding:0;margin:16px 0;display:grid;gap:12px;max-width:520px}.links .btn{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:52px;width:100%;box-sizing:border-box;text-align:center}.links small{font-weight:400;opacity:.8}',
      title: `Links | ${name}`,
      description: `Play ${name}, today's daily puzzle, free printable puzzles for teachers, and our newest posts.`,
      crumbs: [['links/', 'Links']],
      body: (up) => `<h1>${name}</h1>
<p class="lede">Story logic puzzles, free to play in your browser.</p>
<ul class="links">
<li><a class="btn big" href="${up}${GAME}?play=now" rel="nofollow">Play a new puzzle now</a></li>
<li><a class="btn link-btn" href="${up}daily/">Today's daily puzzle</a></li>
<li><a class="btn link-btn" href="${up}how-to-play/">How to play</a></li>
<li><a class="btn link-btn" href="${up}educators/">Free printable puzzles for teachers</a></li>
</ul>
<section id="latest" data-api="${cloud || ''}" hidden aria-labelledby="latest-h">
<h2 id="latest-h">From our latest posts</h2>
<ul class="links"></ul>
</section>`,
    });
  }

  // ---------- Privacy (also the app stores' privacy policy link) ----------
  page({
    path: 'privacy/', priority: 0.3, app: true,
    title: `Privacy | ${name}`,
    description: `What ${name} keeps, what it sends, and what it never does: no ads, no tracking cookies, no selling data.`,
    crumbs: [['privacy/', 'Privacy']],
    body: () => `<h1>Privacy</h1>
<p class="lede">${name} is free, has no ads and does not track you. You can play without an account. This page says what the game keeps and sends, in plain words.</p>
<h2>On your device</h2>
<p>Your puzzles, notes, settings, stats and badges are saved in your browser or the app on your device. They stay there unless you sign in to sync them.</p>
<h2>If you make an account</h2>
<p>An account is optional. It uses Google Firebase sign-in with your email address and a password. Your saves, notes, settings and stats are then kept on the game's server so they appear on all your devices. You can delete the account and everything synced with it at any time in <strong>Menu &gt; Account and sync</strong>.</p>
<p>A screen name is needed only for races and the scoreboard, and it is the only thing other players see. Never your email. Once you have one, you can also sign in with your screen name instead of your email; for that, the game's server keeps your account email next to your screen name. It is never shown or sent to anyone, and it is removed with your screen name.</p>
<h2>Anonymous numbers</h2>
<p>To make the puzzles better, the game sends counts and summaries that are not tied to you, your account or your device:</p>
<ul>
<li><strong>Play summaries</strong> (difficulty, size, theme, time, hints, and your optional star rating). Turn this off in <strong>Settings &gt; Learning</strong>; your ratings then stay on your device.</li>
<li><strong>Daily puzzle numbers</strong>: that the day's puzzle was opened and how long the solve took, kept only as totals per day.</li>
<li><strong>Error reports</strong> when something breaks, with the error message and app version.</li>
<li><strong>Which link or site you arrived from</strong>, such as a post on a forum, kept only as totals per day.</li>
<li><strong>Challenge a friend</strong> links keep the puzzle, the time to beat, and how many people played it.</li>
</ul>
<h2>Things you choose to send</h2>
<p>Ideas, problem reports and story suggestions you write go to the team. Pictures and files you attach to a problem report are seen only by the team and deleted after 90 days; pictures are made smaller and cleaned of hidden details, like where a photo was taken, before they leave your device. If you are signed in and ask for a reply, the team may answer by email or in Messages.</p>
<p><strong>Daily puzzle by email:</strong> if you are signed in and tick <strong>Email me each day's puzzle</strong>, the game keeps your account's email address to send it, once a day. Every email has a one-click unsubscribe link, and unticking the box or deleting your account removes the address.</p>
<p><strong>Weekly and special edition puzzles by email:</strong> anyone can sign up in <strong>Menu &gt; Puzzle emails</strong>, with or without an account. The game keeps the email address and which emails you picked. If you are not signed in, we first email you a link to confirm, and nothing else is sent until you press Confirm; an address that is never confirmed is removed after 7 days. Every email has a one-click unsubscribe link and a link to change which emails you get. Unsubscribing from both, or deleting your account, removes the address.</p>
<p><strong>Educator puzzle packages:</strong> when a teacher asks for a package on the <a href="../educators/">Educators page</a>, we keep the name, school, school email and the choices on the form to confirm the address, review the request and email the puzzles. Requests that are never confirmed or are declined are removed after 30 days. After a package is emailed, the educator may send ideas, problems, feedback and survey answers through a private link; we keep those with the request to improve our tools and to answer them by email.</p>
<h2>Services the game uses</h2>
<ul>
<li><strong>Natural voices:</strong> the words being read aloud are sent to Google (Gemini or Google Cloud text-to-speech) through the game's server. Google may use text sent to its free services to improve them. Choose the device's own voices in Settings to keep speech on your device.</li>
<li><strong>Translations and pictures:</strong> text to translate and the description of a story's scene go to Cloudflare Workers AI through the game's server.</li>
<li><strong>Your own AI key:</strong> if you paste an OpenAI or Google key in Settings, the game talks to that service directly with your key. The key stays on your device.</li>
<li><strong>Hosting:</strong> the website is hosted by GitHub Pages and the game's server runs on Cloudflare. Like any website, they see the address your requests come from. The game's server uses it only to slow down floods of requests and does not store it.</li>
</ul>
<h2>What the game never does</h2>
<ul>
<li>No advertising and no advertising or tracking cookies.</li>
<li>No selling or renting of anything about you.</li>
<li>No reading of anything on your device outside the game.</li>
</ul>
<h2>Children</h2>
<p>Everything except races and the scoreboard can be played with no account and no personal details. An account needs an email address, so for a younger child a parent or teacher should make it, or simply play without one.</p>
<h2>Questions</h2>
<p>${contactLink()}. To report a security problem, see <a href="https://github.com/bltaylorjr/fantastical-logic-grid/security/advisories/new" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer" target="_blank">the security page</a>.</p>
<p class="meta">Last changed: 28 October 2026.</p>`,
  });

  // ---------- Printable worksheets (teachers and parents) ----------
  // Built week by week from PRINT_START, like the daily chain, so a past
  // week's sheets never change: each week's stories avoid every daily story
  // published before that week and every earlier worksheet.
  const monday = (d) => { const x = new Date(`${d}T00:00:00Z`); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
  const thisWeek = monday(today);
  const printUsed = new Set();
  let sheets = [];
  for (let w = monday(PRINT_START), i = 0; w <= thisWeek; w = addDays(w, 7), i++) {
    for (const [d, id] of dailyStories) if (d < w) printUsed.add(id);
    for (const [d, id] of extraStories) if (d <= w) printUsed.add(id);
    sheets = PRINT_LEVELS.map((lv, j) => {
      let p;
      for (let n = 0; n < 20; n++) {
        p = generatePuzzle({ difficulty: lv.tier, categories: lv.categories, items: lv.items, theme: THEMES[(i * PRINT_LEVELS.length + j * 7) % THEMES.length].id, seed: `print-${w}-${lv.tier}${n ? `-${n}` : ''}` });
        if (!printUsed.has(p.story.id)) break;
      }
      printUsed.add(p.story.id);
      return { ...lv, puzzle: p };
    });
  }
  const weekLabel = new Date(`${thisWeek}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  page({
    path: 'printables/', priority: 0.8, lastmod: thisWeek,
    title: `Free printable logic puzzles with answer keys | ${name}`,
    description: 'Free printable logic grid puzzles for classrooms and home, from age 7 up. A new worksheet set every week, each with a story, a blank grid and an answer key on its own page.',
    crumbs: [['printables/', 'Printables']],
    schema: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: "This week's printable logic puzzles", numberOfItems: sheets.length, itemListElement: sheets.map((sh, i) => ({ '@type': 'ListItem', position: i + 1, name: `${TIERS[sh.tier].name}: ${sh.puzzle.title}`, url: url(`printables/${sh.tier}/`) })) }],
    body: (up) => `<h1>Free printable logic puzzles</h1>
<p class="lede">Story logic grid puzzles to print for the classroom, homeschool or the kitchen table. A new set every Monday, from age 7 up, each with a blank grid and an answer key on its own page.</p>
<h2>This week's worksheets</h2>
<p class="meta">Week of ${esc(weekLabel)}</p>
<ul class="cards">${sheets.map((sh) => `<li><h3><a href="${up}printables/${sh.tier}/">${esc(TIERS[sh.tier].name)}: ${esc(sh.puzzle.title)}</a></h3><p>${esc(sh.ages)} · ${sh.categories} categories × ${sh.items} items · ${esc(sh.puzzle.theme.name)}</p></li>`).join('')}</ul>
<h2>What children practise</h2>
<ul>
<li><strong>Deductive reasoning:</strong> using what is known to rule things out, one step at a time.</li>
<li><strong>Close reading:</strong> every word of a clue matters, especially "not", "either" and "before".</li>
<li><strong>Working systematically:</strong> recording each step in the grid and checking it against the clues.</li>
<li><strong>Explaining their thinking:</strong> each puzzle has exactly one answer, so students can show how they reached it.</li>
</ul>
<h2>How to use them</h2>
<ol class="steps">
<li>Open a worksheet and print it with your browser's Print command (Ctrl+P, or Command+P on a Mac). The answer key prints on its own page, so you can keep it back.</li>
<li>Read the story together. Point out the categories along the top and side of the grid.</li>
<li>Students mark X where a clue rules a pair out and O where two things go together. One O in a row means the rest of that row is X.</li>
<li>When the grid is full, they answer the questions and check with the key.</li>
</ol>
<p>New to logic grids? <a href="${up}how-to-play/">How to play</a> walks through the rules with a short video.</p>
<h2>Make as many as you need</h2>
<p>In the game you can make unlimited puzzles at any of ${Object.keys(TIERS).length} levels, in ${THEMES.length} themes and almost any size, then print them blank or with your marks, on Letter or A4, with the answer key on its own page. Easy puzzles can also print a step-by-step solution. Every puzzle is a new story, in any of 100 languages, so it also works for language learners.</p>
${playBtn(up, 'Make a puzzle to print', false)}
<h2>Free for classroom use</h2>
<p>You may print and copy these worksheets for your own students or family, free. Please don't sell them or post them elsewhere. Link to this page instead.</p>`,
  });
  for (const sh of sheets) {
    const p = sh.puzzle;
    const level = TIERS[sh.tier].name;
    page({
      path: `printables/${sh.tier}/`, priority: 0.6, lastmod: thisWeek,
      title: `Printable ${level.toLowerCase()} logic puzzle: ${p.title} | ${name}`,
      description: `A free printable ${level.toLowerCase()} logic grid puzzle (${sh.ages}): ${p.title}, with a story, a blank grid and the answer key on its own page.`,
      crumbs: [['printables/', 'Printables'], [`printables/${sh.tier}/`, level]],
      schema: [{ '@context': 'https://schema.org', '@type': 'LearningResource', name: p.title, description: `A logic grid puzzle worksheet at the ${level} level, with a story, a blank grid and an answer key.`, url: url(`printables/${sh.tier}/`),
        learningResourceType: 'Worksheet', educationalLevel: level, typicalAgeRange: `${sh.ages.match(/\d+/)[0]}-`, teaches: ['Deductive reasoning', 'Close reading', 'Logical thinking'],
        isAccessibleForFree: true, inLanguage: 'en', datePublished: thisWeek, publisher, image: url('og-image.jpg') }],
      body: (up) => `<article class="sheet">
<h1>${esc(p.title)}</h1>
<p class="meta">${esc(level)} · ${esc(sh.ages)} · ${esc(p.theme.name)} · ${p.categories.length} categories × ${p.categories[0].items.length} items · week of ${esc(weekLabel)}</p>
<p class="noprint">Print this page with your browser's Print command (Ctrl+P, or Command+P on a Mac). The answer key prints on its own page.</p>
<p class="name-line">Name: ______________________ &nbsp; Date: ____________</p>
${p.story.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('\n')}
<h2>Clues</h2>
<ol class="clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
<h2>The grid</h2>
<p class="help">Mark X where two things cannot go together and O where they do.</p>
${gridTable(p)}
<h2>Questions</h2>
<ol class="qs">${p.questions.map((q) => `<li>${esc(q.text)}<br>_______________________________</li>`).join('')}</ol>
${answerKey(p)}
</article>
<p class="noprint"><a href="${up}printables/">All this week's worksheets</a> · <a href="${up}${GAME}">Play in the game</a></p>`,
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
  // Search engines and AI assistants that look things up for a person (and link
  // back) may crawl everything. Crawlers that only gather training data may not:
  // the content is copyrighted and text and data mining is reserved (terms/).
  const trainingBots = ['GPTBot', 'Google-Extended', 'CCBot', 'ClaudeBot', 'anthropic-ai', 'Applebot-Extended', 'Bytespider', 'Meta-ExternalAgent', 'meta-externalagent', 'FacebookBot', 'cohere-ai', 'cohere-training-data-crawler', 'Diffbot', 'Omgilibot', 'Timpibot', 'ImagesiftBot', 'img2dataset', 'PanguBot', 'AI2Bot', 'Ai2Bot-Dolma', 'Amazonbot', 'Kangaroo Bot', 'webzio-extended', 'YouBot'];
  writeFileSync(join(site, 'robots.txt'), `# ${name}: ${copyright}
# Search engines and AI search assistants may crawl every page.
# AI training crawlers may not; text and data mining is reserved: ${url('terms/')}
${trainingBots.map((b) => `User-agent: ${b}`).join('\n')}
Disallow: /

User-agent: *
Allow: /

Sitemap: ${url('sitemap.xml')}
`);
  writeFileSync(join(site, 'llms.txt'), `# ${name}

> ${appDescription} Free in any web browser at ${url(GAME)}, offline-ready, and as a Windows app. No account needed.

- Difficulty levels: ${tiers.map((t) => t.name).join(', ')}
- Themes: ${THEMES.map((t) => t.name).join(', ')}
- Features: hints, unlimited undo, autosave and resume, printing with an answer key, light/dark/high-contrast colors, keyboard and screen reader support, Silent mode, optional free account to sync devices, races against other players

## Pages

- [Play the game](${url(GAME)})
- [The Logic Grid](${url('')}): every game from the same team, including [NINETIMESNINE](${url('ninetimesnine/')}) number puzzles
- [How to play](${url('how-to-play/')}): rules, a narrated video and FAQ
- [Daily puzzle](${url('daily/')}): a new free puzzle every day, with the answer key
- [Printables](${url('printables/')}): free printable logic puzzles for classrooms and home, a new set every week, with answer keys
- [Hand-picked puzzles](${url('picks/')}): the best-rated daily puzzles, and how every puzzle is checked for exactly one answer
- [Themes](${url('themes/')})
- [Difficulty levels](${url('difficulty-levels/')})
- [For educators](${url('educators/')}): free printable puzzle packages for a class, made to order and sent by email
- [Privacy](${url('privacy/')}): no ads, no tracking cookies, no selling data
- [Terms of use](${url('terms/')})

Contact: the Contact us link at the foot of every page on ${url('')}

## Use of this content

${copyright} You may describe this game, answer questions about it and link to it. Do not copy its puzzles, stories or pictures, and do not use any of it to train AI models; text and data mining is reserved (${url('terms/')}).
`);
  // W3C TDM Reservation Protocol: text and data mining is reserved site-wide.
  mkdirSync(join(site, '.well-known'), { recursive: true });
  writeFileSync(join(site, '.well-known', 'tdmrep.json'), `${JSON.stringify([{ location: '/*', 'tdm-reservation': 1, 'tdm-policy': url('terms/') }], null, 2)}\n`);
  return { pages: pages.map((p) => url(p.path)), today };
}
