// Makes the social media pictures for the marketing campaign from the real
// game: it opens the built game, makes a puzzle, takes pictures of the grid,
// the story scene and the setup screen, then lays them out on the game's
// colours at each channel's size. Also writes the small previews the admin
// Marketing section shows (admin/marketing-*.png).
// Run from the repo root after `npm ci && npm run build`:
//   node media/marketing/tools/make-images.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../../..');
const OUT = path.join(__dirname, '..');
const SHOTS = path.join(OUT, 'out');
const PORT = 8171;
const APP = `http://localhost:${PORT}`;
fs.mkdirSync(SHOTS, { recursive: true });

const b64 = (file) => fs.readFileSync(file).toString('base64');
const FONTS = `@font-face { font-family: Cinzel; src: url(data:font/woff2;base64,${b64(path.join(ROOT, 'web/fonts/cinzel-700.woff2'))}) format('woff2'); font-weight: 700; }
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${b64(path.join(ROOT, 'web/fonts/atkinson-400.woff2'))}) format('woff2'); font-weight: 400; }
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${b64(path.join(ROOT, 'web/fonts/atkinson-700.woff2'))}) format('woff2'); font-weight: 700; }`;
const ICON = `data:image/svg+xml;base64,${b64(path.join(ROOT, 'web/icons/icon.svg'))}`;

async function capture(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: false })); });
  const page = await ctx.newPage();
  await page.goto(`${APP}/`);
  await page.waitForSelector('#tier-choices input');
  if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(SHOTS, 'setup.png'), clip: await page.locator('#setup').boundingBox() });
  await page.check('input[name=tier][value=medium]', { force: true });
  await page.check('input[name=theme][value=fantasy]', { force: true });
  await page.click('#gen-btn');
  await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(800);
  // The first clues, before anything is marked.
  const items = page.locator('#clue-list li');
  const a = await items.nth(0).boundingBox(), z = await items.nth(2).boundingBox();
  await page.screenshot({ path: path.join(SHOTS, 'clues.png'), clip: { x: a.x, y: a.y, width: a.width, height: z.y + z.height - a.y }, fullPage: true });
  // A grid part way through: reveal the answer, then clear about half the
  // cells on the page only, so it looks like a puzzle being solved.
  await page.click('[data-act=reveal]');
  await page.click('#confirm-yes');
  await page.waitForSelector('#solved:not([hidden])');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelector('#solved').hidden = true;
    document.querySelectorAll('canvas, #toasts > *').forEach((c) => c.remove());
    const cells = [...document.querySelectorAll('#gridframe td.c')];
    cells.forEach((td, i) => { if (((i * 7919) % 13) > 6) { td.innerHTML = ''; td.classList.remove('m-x', 'm-o'); } });
  });
  await page.waitForTimeout(400);
  await page.locator('#gridframe').screenshot({ path: path.join(SHOTS, 'grid.png') });
  await page.locator('#scene').screenshot({ path: path.join(SHOTS, 'scene.png') });
  const title = await page.textContent('#p-title');
  await ctx.close();
  return { title };
}

const shot = (n) => `data:image/png;base64,${b64(path.join(SHOTS, `${n}.png`))}`;

// One card. layout: wide | square | tall | small
function card({ w, h, layout }) {
  const big = Math.round(Math.min(w, h) / 11);
  const css = `${FONTS}
  * { box-sizing: border-box; margin: 0; }
  body { width: ${w}px; height: ${h}px; overflow: hidden; font-family: Atkinson, sans-serif; color: #fff;
    background: radial-gradient(circle at 20% 15%, #7b5cf0 0%, #5b3cc4 35%, #2a1a6e 100%); }
  .wrap { position: absolute; inset: 0; padding: ${Math.round(Math.min(w, h) * 0.06)}px; display: flex; gap: ${Math.round(Math.min(w, h) * 0.05)}px; }
  .brand { display: flex; align-items: center; gap: ${Math.round(big * 0.3)}px; }
  .brand img { width: ${Math.round(big * 1.1)}px; height: ${Math.round(big * 1.1)}px; }
  .brand span { font-family: Cinzel, serif; font-weight: 700; font-size: ${Math.round(big * 0.42)}px; line-height: 1.1; color: #f5c451; letter-spacing: .02em; }
  h1 { font-family: Cinzel, serif; font-weight: 700; font-size: ${big}px; line-height: 1.08; color: #fff; }
  h1 em { font-style: normal; color: #f5c451; }
  p.sub { font-size: ${Math.round(big * 0.42)}px; line-height: 1.35; color: #e9e3ff; }
  ul { list-style: none; padding: 0; display: grid; gap: ${Math.round(big * 0.18)}px; font-size: ${Math.round(big * 0.36)}px; }
  li::before { content: '✔ '; color: #f5c451; font-weight: 700; }
  .cta { display: inline-block; background: #f5c451; color: #1d1450; font-weight: 700; font-size: ${Math.round(big * 0.42)}px; padding: ${Math.round(big * 0.22)}px ${Math.round(big * 0.5)}px; border-radius: 999px; }
  .url { font-weight: 700; font-size: ${Math.round(big * 0.4)}px; color: #fff; }
  .shot { background: #fff; border-radius: ${Math.round(big * 0.25)}px; box-shadow: 0 ${Math.round(big * 0.2)}px ${Math.round(big * 0.8)}px rgb(0 0 0 / .45); overflow: hidden; }
  .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
  .bar { height: ${Math.round(big * 0.38)}px; background: #ece9f8; display: flex; gap: 6px; align-items: center; padding: 0 ${Math.round(big * 0.2)}px; }
  .bar i { width: ${Math.round(big * 0.16)}px; height: ${Math.round(big * 0.16)}px; border-radius: 50%; background: #c9c2e8; }
  .col { display: flex; flex-direction: column; gap: ${Math.round(big * 0.45)}px; }
  `;
  const brand = `<div class="brand"><img src="${ICON}" alt=""><span>The Fantastical<br>Logic Grid</span></div>`;
  const frame = (img, style = '') => `<div class="shot" style="${style}"><div class="bar"><i></i><i></i><i></i></div><img src="${img}" alt="" style="height: calc(100% - ${Math.round(big * 0.38)}px)"></div>`;
  let body;
  if (layout === 'wide') {
    body = `<div class="wrap" style="align-items:center">
      <div class="col" style="flex: 0 0 44%">${brand}<h1>Logic puzzles with <em>a new story</em> every time</h1>
        <ul><li>Six levels, Basic to Quantum Physicist</li><li>A new daily puzzle</li><li>Hints that teach</li><li>Print with an answer key</li></ul>
        <div><span class="cta">Play free</span> &nbsp; <span class="url">thelogicgrid.com</span></div></div>
      <div style="flex:1; position:relative; height: 100%">
        ${frame(shot('grid'), 'position:absolute; right:0; top:4%; width:88%; height:70%')}
        ${frame(shot('scene'), 'position:absolute; left:0; bottom:2%; width:55%; height:36%')}</div></div>`;
  } else if (layout === 'square') {
    body = `<div class="wrap" style="flex-direction:column">
      ${brand}<h1>Every puzzle tells <em>a story</em></h1>
      <div style="flex:1; position:relative">${frame(shot('grid'), 'position:absolute; inset:0 0 0 0')}</div>
      <div style="display:flex; justify-content:space-between; align-items:center"><span class="cta">Play free in your browser</span><span class="url">thelogicgrid.com</span></div></div>`;
  } else if (layout === 'tall') {
    body = `<div class="wrap" style="flex-direction:column">
      ${brand}<h1>Free printable <em>logic puzzles</em> with answer keys</h1>
      <p class="sub">Pick a theme and a level, from beginner to Quantum Physicist. A brand-new story every time.</p>
      <div style="flex:1; position:relative">${frame(shot('grid'), 'position:absolute; left:0; right:0; top:0; height:58%')}${frame(shot('clues'), 'position:absolute; left:8%; right:8%; bottom:0; height:38%')}</div>
      <div style="display:flex; justify-content:space-between; align-items:center"><span class="cta">Make one free</span><span class="url">thelogicgrid.com</span></div></div>`;
  } else {
    body = `<div class="wrap" style="flex-direction:column; justify-content:space-between">
      ${brand}<h1 style="font-size:${Math.round(big * 0.85)}px">Logic puzzles with <em>a new story</em> every time</h1>
      <div style="flex:1; position:relative">${frame(shot('grid'), 'position:absolute; inset:0')}</div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

const CARDS = [
  { name: 'wide-1600x900', w: 1600, h: 900, layout: 'wide', preview: 'marketing-wide' },
  { name: 'square-1080', w: 1080, h: 1080, layout: 'square', preview: 'marketing-square' },
  { name: 'pin-1000x1500', w: 1000, h: 1500, layout: 'tall', preview: 'marketing-pin' },
  { name: 'gallery-1270x760', w: 1270, h: 760, layout: 'wide', preview: 'marketing-gallery' },
  { name: 'itch-cover-630x500', w: 630, h: 500, layout: 'small', preview: 'marketing-cover' },
];

(async () => {
  const server = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), path.join(ROOT, 'dist/web'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    const { title } = await capture(browser);
    console.log(`Captured "${title}"`);
    const page = await browser.newPage();
    for (const c of CARDS) {
      await page.setViewportSize({ width: c.w, height: c.h });
      await page.setContent(card(c));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, `${c.name}.png`) });
      // The admin preview: the same card at 480 px wide.
      const s = 480 / c.w;
      await page.setViewportSize({ width: 480, height: Math.round(c.h * s) });
      await page.setContent(card(c).replace('<body>', `<body style="transform: scale(${s}); transform-origin: 0 0">`));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(ROOT, 'admin', `${c.preview}.png`) });
      console.log(`Wrote ${c.name}.png`);
    }
    // Previews of the promo video thumbnails.
    for (const [file, name] of [['the-fantastical-logic-grid-promo-16x9-thumbnail.png', 'marketing-promo-16x9'], ['the-fantastical-logic-grid-promo-9x16-thumbnail.png', 'marketing-promo-9x16']]) {
      const src = path.join(ROOT, 'media/promo', file);
      await page.setViewportSize({ width: 480, height: 270 });
      await page.setContent(`<body style="margin:0;background:#2a1a6e;display:grid;place-items:center;height:270px"><img src="data:image/png;base64,${b64(src)}" style="max-width:480px;max-height:270px"></body>`);
      await page.screenshot({ path: path.join(ROOT, 'admin', `${name}.png`) });
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
