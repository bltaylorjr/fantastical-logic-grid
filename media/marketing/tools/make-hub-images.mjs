// Makes the marketing pictures for The Logic Grid as a whole: every game on
// the site, drawn with the same card art and colours as the front page
// (scripts/hub.mjs), so a new game shows up here the next time this runs.
// Writes media/marketing/logic-grid-*.png (+ .jpg twins for Instagram) and
// the admin Marketing previews (admin/marketing-lg-*.png).
//
// Run from the repo root (needs no npm install, only Playwright's Chromium):
//   node media/marketing/tools/make-hub-images.mjs
// Fonts: dist/web/fonts after `npm run build`, or FONT_DIR pointing at a
// folder with AtkinsonHyperlegible-Regular.ttf, AtkinsonHyperlegible-Bold.ttf
// and Cinzel[wght].ttf (both are SIL Open Font License, from Google Fonts).
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { GAME_PAGES } from '../../../scripts/hub.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const OUT = join(HERE, '..');
const ADMIN = join(ROOT, 'admin');
mkdirSync(OUT, { recursive: true });

const b64 = (file) => readFileSync(file).toString('base64');
const HUB = readFileSync(join(ROOT, 'scripts/hub.mjs'), 'utf8');

// The front page's logo and each card's background, read from hub.mjs so
// they never drift from the site.
const LOGO = HUB.match(/const LOGO = '(<svg[\s\S]*?<\/svg>)';/)[1];
const GRADIENT = Object.fromEntries([...HUB.matchAll(/\.art\.([a-z]+) \{ background: ([^;]+); \}/g)].map((m) => [m[1], m[2]]));

function fontFaces() {
  const built = join(ROOT, 'dist/web/fonts');
  if (existsSync(join(built, 'cinzel-700.woff2'))) {
    return `@font-face { font-family: Cinzel; src: url(data:font/woff2;base64,${b64(join(built, 'cinzel-700.woff2'))}) format('woff2'); font-weight: 700; }
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${b64(join(built, 'atkinson-400.woff2'))}) format('woff2'); font-weight: 400; }
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${b64(join(built, 'atkinson-700.woff2'))}) format('woff2'); font-weight: 700; }`;
  }
  const dir = process.env.FONT_DIR;
  if (!dir) throw new Error('No fonts: run `npm run build` first, or set FONT_DIR (see the top of this file).');
  return `@font-face { font-family: Cinzel; src: url(data:font/ttf;base64,${b64(join(dir, 'Cinzel[wght].ttf'))}) format('truetype'); font-weight: 400 900; }
@font-face { font-family: Atkinson; src: url(data:font/ttf;base64,${b64(join(dir, 'AtkinsonHyperlegible-Regular.ttf'))}) format('truetype'); font-weight: 400; }
@font-face { font-family: Atkinson; src: url(data:font/ttf;base64,${b64(join(dir, 'AtkinsonHyperlegible-Bold.ttf'))}) format('truetype'); font-weight: 700; }`;
}
const FONTS = fontFaces();
const GAMES = GAME_PAGES.map((g) => ({ name: g.name, art: g.art, bg: GRADIENT[g.cls] }));
const COUNT = GAMES.length;
const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'].at(COUNT) || String(COUNT);
const Cap = (s) => s[0].toUpperCase() + s.slice(1);

// One picture. cols: tiles per row. names: show game names under tiles.
// Layouts: 'stack' (title above the tiles), 'side' (title left, tiles right),
// 'banner' (one strip of small tiles, for page headers that crop).
function card({ w, h, layout, cols, names = true, sub = true, safe = null, title = 8.6 }) {
  const u = Math.min(w, h) / 100; // 1% of the short side
  const pad = Math.round(u * 6);
  const css = `${FONTS}
  * { box-sizing: border-box; margin: 0; }
  body { width: ${w}px; height: ${h}px; overflow: hidden; font-family: Atkinson, sans-serif; color: #EEF0F8; background: #080B16;
    background-image: radial-gradient(${Math.round(w * 0.7)}px ${Math.round(h * 0.7)}px at 10% -10%, rgb(124 92 255 / .45), transparent 60%),
      radial-gradient(${Math.round(w * 0.6)}px ${Math.round(h * 0.75)}px at 100% 10%, rgb(34 184 207 / .30), transparent 60%),
      radial-gradient(${Math.round(w * 0.6)}px ${Math.round(h * 0.6)}px at 50% 120%, rgb(245 196 81 / .16), transparent 60%); }
  .wrap { position: absolute; inset: 0; padding: ${pad}px; display: flex; }
  .brand { display: flex; align-items: center; gap: ${Math.round(u * 2.4)}px; }
  .brand svg { width: ${Math.round(u * 12)}px; height: ${Math.round(u * 12)}px; flex: none; border-radius: ${Math.round(u * 2.4)}px; box-shadow: 0 ${Math.round(u)}px ${Math.round(u * 4)}px rgb(0 0 0 / .45); }
  h1 { font-family: Cinzel, serif; font-weight: 700; font-size: ${Math.round(u * title)}px; line-height: 1.02; color: #FFFFFF; letter-spacing: .01em; }
  .sub { font-size: ${Math.round(u * 3.9)}px; line-height: 1.3; color: #C9CFE4; }
  .sub b { color: #F5C451; }
  .url { font-weight: 700; font-size: ${Math.round(u * 3.6)}px; color: #F5C451; letter-spacing: .02em; }
  .tiles { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: ${Math.round(u * 1.8)}px ${Math.round(u * 1.6)}px; justify-content: center; }
  .tile { display: flex; flex-direction: column; gap: ${Math.round(u * 0.9)}px; min-width: 0; }
  .art { aspect-ratio: 16 / 9; border-radius: ${Math.round(u * 1.6)}px; display: grid; place-items: center; box-shadow: 0 ${Math.round(u * 0.6)}px ${Math.round(u * 2.4)}px rgb(0 0 0 / .45); border: 1px solid rgb(255 255 255 / .14); overflow: hidden; }
  .art svg { width: 70%; height: auto; }
  .art .mk { opacity: 1; }
  .name { font-weight: 700; font-size: ${Math.round(u * 2.3)}px; line-height: 1.15; text-align: center; color: #EEF0F8; text-wrap: balance; }
  `;
  const tile = (g) => `<div class="tile"><div class="art" style="background:${g.bg}">${g.art}</div>${names ? `<div class="name">${g.name}</div>` : ''}</div>`;
  // Centre a short last row by giving the grid a fixed tile width.
  const tiles = (style = '') => `<div class="tiles" style="${style}">${GAMES.map(tile).join('')}</div>`;
  const brand = `<div class="brand">${LOGO}<h1>The Logic Grid</h1></div>`;
  const subline = `<div class="sub"><b>${Cap(COUNT_WORD)} free puzzle games</b> in your browser: story logic grids, number, picture, line and word puzzles. New daily puzzles.</div>`;
  let body;
  if (layout === 'side') {
    body = `<div class="wrap" style="align-items:center; gap:${Math.round(u * 5)}px">
      <div style="flex:0 0 36%; display:flex; flex-direction:column; gap:${Math.round(u * 4)}px">${brand}${sub ? subline : ''}<div class="url">thelogicgrid.com</div></div>
      <div style="flex:1">${tiles()}</div></div>`;
  } else if (layout === 'banner') {
    const [l, r] = safe || [0, 0];
    body = `<div class="wrap" style="align-items:center; gap:${Math.round(u * 7)}px; padding-left:${Math.round(w * l)}px; padding-right:${Math.round(w * r)}px">
      <div style="flex:none; display:flex; flex-direction:column; gap:${Math.round(u * 5)}px">${brand}<div class="url">thelogicgrid.com</div></div>
      <div style="flex:1">${tiles()}</div></div>`;
  } else {
    const [l, r] = safe || [0, 0];
    const side = safe ? `; padding-left:${Math.round(w * l)}px; padding-right:${Math.round(w * r)}px; align-items:center` : '';
    body = `<div class="wrap" style="flex-direction:column; gap:${Math.round(u * 3.2)}px${side}">
      ${brand}${sub ? subline : ''}
      <div style="flex:1; display:flex; align-items:center">${tiles('width:100%')}</div>
      <div class="url" style="text-align:center">thelogicgrid.com</div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

export const CARDS = [
  { name: 'logic-grid-wide-1600x900', w: 1600, h: 900, layout: 'side', cols: 3, title: 6.4, preview: 'marketing-lg-wide' },
  { name: 'logic-grid-square-1080', w: 1080, h: 1080, layout: 'stack', cols: 4, title: 7.4, preview: 'marketing-lg-square' },
  { name: 'logic-grid-pin-1000x1500', w: 1000, h: 1500, layout: 'stack', cols: 3, preview: 'marketing-lg-pin' },
  { name: 'logic-grid-gallery-1270x760', w: 1270, h: 760, layout: 'side', cols: 4, title: 6.4, preview: 'marketing-lg-gallery' },
  { name: 'logic-grid-itch-cover-630x500', w: 630, h: 500, layout: 'stack', cols: 4, names: false, sub: false, preview: 'marketing-lg-cover' },
  // Facebook crops the sides on phones; X covers the bottom-left with the profile photo.
  { name: 'logic-grid-facebook-cover-1640x624', w: 1640, h: 624, layout: 'stack', cols: 6, names: false, sub: false, title: 9, safe: [0.14, 0.14], preview: 'marketing-lg-fbcover' },
  { name: 'logic-grid-x-header-1500x500', w: 1500, h: 500, layout: 'banner', cols: 6, names: false, title: 7.5, safe: [0.05, 0.05], preview: 'marketing-lg-xheader' },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const c of CARDS) {
    const html = card(c);
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `${c.name}.png`) });
    await page.screenshot({ path: join(OUT, `${c.name}.jpg`), type: 'jpeg', quality: 90 });
    const s = 480 / c.w;
    await page.setViewportSize({ width: 480, height: Math.round(c.h * s) });
    await page.setContent(html.replace('<body>', `<body style="transform: scale(${s}); transform-origin: 0 0">`));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(ADMIN, `${c.preview}.png`) });
    console.log(`Wrote ${c.name}.png (${COUNT} games)`);
  }
} finally {
  await browser.close();
}
