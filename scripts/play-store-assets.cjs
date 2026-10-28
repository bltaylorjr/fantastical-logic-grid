// Google Play listing pictures in media/play-store: the 1024 x 500 feature
// graphic, the 512 x 512 icon, and 1080 x 1920 phone screenshots taken from
// the real game. Run after npm run build: node scripts/play-store-assets.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'media', 'play-store');
(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), '8182'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'web', 'icons', 'icon-512.png'), path.join(OUT, 'icon-512.png'));

    const banner = await browser.newPage({ viewport: { width: 1024, height: 500 } });
    await banner.goto(`file://${path.join(OUT, 'feature-graphic.html')}`);
    await banner.evaluate(() => document.fonts.ready);
    await banner.screenshot({ path: path.join(OUT, 'feature-graphic.png'), type: 'png' });
    await banner.close();

    // 360 x 640 at 3x is 1080 x 1920, the size Play shows best on phones.
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme });
      await ctx.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, languageOffered: true, voiceProvider: 'device', sound: false, music: false })));
      const page = await ctx.newPage();
      const shot = async (name) => {
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
        await page.screenshot({ path: path.join(OUT, `phone-${scheme}-${name}.png`), type: 'png' });
      };
      await page.goto('http://localhost:8182/');
      await page.waitForSelector('#tier-choices input');
      await shot('home');
      await page.check('input[name=tier][value=easy]', { force: true });
      await page.check('input[name=theme][value=mystery]', { force: true });
      await page.click('#gen-btn');
      await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
      await shot('story');
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
      // Below the sticky header, so the grid's heading shows.
      await page.evaluate(() => { document.querySelector('#grid-region').scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); });
      await shot('grid');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
