// Store screenshots for the web app manifest (Microsoft Store via PWABuilder,
// and the browser's richer install prompt): web/icons/screens/*.jpg, taken
// from the real game, plus 1920 x 1080 PNGs for store listings in media/store.
// Run after npm run build: node scripts/store-screenshots.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const OUT = path.join(__dirname, '..', 'web', 'icons', 'screens');
// Full-size PNGs for store listings (Microsoft Store, itch.io): media/store/.
const STORE = path.join(__dirname, '..', 'media', 'store');
(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8181'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    require('fs').mkdirSync(STORE, { recursive: true });
    for (const [form, w, h] of [['wide', 1280, 800], ['narrow', 540, 1170], ['store', 1920, 1080]]) {
      const shot = (name) => (form === 'store' ? { path: path.join(STORE, `${name}.png`), type: 'png' } : { path: path.join(OUT, `${form}-${name}.jpg`), type: 'jpeg', quality: 80 });
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: 'light' });
      await ctx.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, languageOffered: true, voiceProvider: 'device', sound: false, music: false })));
      const page = await ctx.newPage();
      await page.goto('http://localhost:8181/');
      await page.waitForSelector('#tier-choices input');
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
      await page.screenshot(shot('home'));
      await page.check('input[name=tier][value=easy]', { force: true });
      await page.check('input[name=theme][value=mystery]', { force: true });
      await page.click('#gen-btn');
      await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
      // A few marks, as a player would have them part way through.
      await page.evaluate(() => {
        const S = window.__flg.state;
        let n = 0;
        for (const [k, td] of S.grid.cells) {
          const [a, b] = k.split('|');
          const match = S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b));
          if (n++ % 3 === 0) { td.click(); if (match) td.click(); }
        }
      });
      await page.locator('#grid-region').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
      await page.screenshot(shot('play'));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
