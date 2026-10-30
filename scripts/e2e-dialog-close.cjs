// Every dialog has a close (X) button in its top corner. It stays in view while
// a long dialog such as Settings scrolls, closes like Escape, puts focus back
// where it was, answers No on a question, and is a 44 px target with a label.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };

const PORT = 8137;
const SHOTS = process.env.SHOTS;

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [label, options] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', devices['Pixel 7']]]) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', ...options });
      await ctx.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' })));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('#tier-choices input');

      const missing = await page.$$eval('dialog', (ds) => ds.filter((d) => !d.querySelector(':scope > button.dlg-x[aria-label="Close"]')).map((d) => d.id));
      assert(!missing.length, `${label}: every dialog has a labelled close button${missing.length ? ` (missing: ${missing})` : ''}`);

      // Settings: open from the menu, scroll to the bottom, the X is still on screen.
      await page.click('#menu-btn');
      await page.click('[data-cmd=settings]');
      await page.waitForSelector('#dlg-settings[open]');
      await page.waitForTimeout(400);
      const x = page.locator('#dlg-settings > .dlg-x');
      const box = await x.evaluate((b) => ({ width: b.offsetWidth, height: b.offsetHeight }));
      assert(box.width >= 44 && box.height >= 44, `${label}: the close button is at least 44 px`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-${label}.png`) });
      await page.$eval('#dlg-settings', (d) => { d.scrollTop = d.scrollHeight; });
      await page.waitForTimeout(100);
      const dlg = await page.locator('#dlg-settings').boundingBox();
      const after = await x.boundingBox();
      assert(after && after.y >= dlg.y - 1 && after.y + after.height <= dlg.y + dlg.height + 1, `${label}: the close button stays in view when Settings is scrolled`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-scrolled-${label}.png`) });
      await x.click();
      assert(!(await page.locator('#dlg-settings[open]').count()), `${label}: X closes Settings`);
      assert(await page.evaluate(() => document.activeElement?.id === 'menu-btn'), `${label}: focus goes back to the Menu button`);

      // Help: X closes it.
      await page.click('#help-btn');
      await page.waitForSelector('#dlg-help[open]');
      await page.click('#dlg-help > .dlg-x');
      assert(!(await page.locator('#dlg-help[open]').count()), `${label}: X closes Help`);
      assert(await page.evaluate(() => document.activeElement?.id === 'help-btn'), `${label}: focus goes back to the Help button`);

      // Escape still closes a dialog.
      await page.click('#help-btn');
      await page.waitForSelector('#dlg-help[open]');
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#dlg-help[open]').count()), `${label}: Escape still closes a dialog`);
      await ctx.close();
    }
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
