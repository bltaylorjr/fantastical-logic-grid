// App Store screenshots in media/app-store, taken from the real game with the
// iPhone app's look (data-native=ios, so no Install menu or Support link):
//   iphone-*.png  1320 x 2868 (6.9" iPhone, the size App Store Connect asks for first)
//   ipad-*.png    2064 x 2752 (13" iPad)
// Run after npm run build: node scripts/app-store-assets.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'media', 'app-store');
const DEVICES = [
  { name: 'iphone', viewport: { width: 440, height: 956 }, scale: 3 },
  { name: 'ipad', viewport: { width: 1032, height: 1376 }, scale: 2 },
];
(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), '8183'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    fs.mkdirSync(OUT, { recursive: true });
    for (const d of DEVICES) {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.scale, isMobile: true, hasTouch: true, colorScheme: scheme });
        await ctx.addInitScript(() => {
          localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, languageOffered: true, voiceProvider: 'device', sound: false, music: false }));
          window.FLGNative = { platform: 'ios' };
          document.documentElement.dataset.native = 'ios';
        });
        const page = await ctx.newPage();
        const shot = async (what) => {
          await page.waitForTimeout(500);
          await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
          await page.screenshot({ path: path.join(OUT, `${d.name}-${scheme}-${what}.png`), type: 'png' });
        };
        await page.goto('http://localhost:8183/');
        await page.waitForSelector('#tier-choices input');
        await shot('home');
        await page.check('input[name=tier][value=easy]', { force: true });
        await page.check('input[name=theme][value=mystery]', { force: true });
        await page.click('#gen-btn');
        await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
        await shot('story');
        await page.evaluate(() => {
          const S = window.__flg.state;
          let n = 0;
          for (const [k, td] of S.grid.cells) {
            const [a, b] = k.split('|');
            const match = S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b));
            if (n++ % 3 === 0) { td.click(); if (match) td.click(); }
          }
        });
        await page.evaluate(() => { document.querySelector('#grid-region').scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); });
        await shot('grid');
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
