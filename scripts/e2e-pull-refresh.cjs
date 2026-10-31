// Pull down to refresh on a phone, in the game and the admin dashboard: it
// starts only from the very top of the page, never on the puzzle grid, saves
// progress first, and the admin is asked before unsaved typing is lost.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const GAME = 8135;
const ADMIN = 8136;

(async () => {
  assert(fs.readFileSync(path.join(ROOT, 'web/js/pull-refresh.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'admin/pull-refresh.js'), 'utf8'), 'the game and the admin dashboard use the same pull-to-refresh code');
  const servers = [
    spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(GAME)], { stdio: 'ignore' }),
    spawn('node', [path.join(__dirname, 'serve.mjs'), ROOT, String(ADMIN)], { stdio: 'ignore' }),
  ];
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' })); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    // A finger drag from (x, y) down by `by` pixels.
    async function pull(x, y, by) {
      await touch('touchStart', x, y);
      for (let i = 1; i <= 8; i++) { await touch('touchMove', x, y + (by * i) / 8); await page.waitForTimeout(16); }
      await touch('touchEnd', x, y + by);
    }
    // Marks the page, so a reload shows as the mark disappearing.
    const tag = () => page.evaluate(() => { window.__notReloaded = true; });
    const reloaded = async () => { await page.waitForTimeout(1200); return page.evaluate(() => !window.__notReloaded).catch(() => true); };
    const centre = (sel) => page.locator(sel).first().boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2]);

    // ---- The game's home screen.
    await page.goto(`http://localhost:${GAME}/`);
    await page.waitForSelector('#tier-choices input');
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY) === 'contain', "the browser's own pull-to-refresh is replaced");
    await tag();
    let [x, y] = await centre('.hero-title');
    await pull(x, y, 60);
    assert(!(await reloaded()), 'a short pull does nothing');
    // The spinner is noted in sessionStorage, which outlives the reload.
    await page.evaluate(() => { const el = document.querySelector('.ptr'); new MutationObserver(() => { if (el.classList.contains('spin')) sessionStorage.setItem('ptr-spun', '1'); }).observe(el, { attributes: true }); });
    await pull(x, y, 260);
    assert(await reloaded(), 'pulling down from the top of the page refreshes it');
    assert(await page.evaluate(() => sessionStorage.getItem('ptr-spun') === '1'), 'the refresh spinner shows');
    await page.waitForSelector('#tier-choices input');

    // ---- Scrolled down: no refresh.
    await page.evaluate(() => window.scrollTo(0, 400));
    await tag();
    await pull(200, 300, 260);
    assert(!(await reloaded()), 'no refresh when the page is not at the top');
    await page.evaluate(() => window.scrollTo(0, 0));

    // ---- A dialog open: no refresh.
    await page.click('#help-btn');
    await page.waitForSelector('#dlg-help[open]');
    [x, y] = await centre('#help-h');
    await pull(x, y, 260);
    assert(!(await reloaded()), 'no refresh while a window is open');
    await page.keyboard.press('Escape');

    // ---- Playing: the grid never starts a pull, and a refresh saves first.
    await page.check('input[name=tier][value=easy]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const id = await page.evaluate(() => window.__flg.state.save.id);
    // A tall screen, so the grid shows while the page is at its very top.
    await page.setViewportSize({ width: 412, height: 2400 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await tag();
    const cell = await page.evaluate(() => { const r = document.querySelector('td.c').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    assert(cell[1] < 2300, 'the grid is on screen at the top of the page');
    await pull(cell[0], cell[1], 260);
    assert(!(await reloaded()), 'dragging on the grid never refreshes');
    await page.setViewportSize({ width: 412, height: 839 });
    await page.evaluate(() => window.scrollTo(0, 0));
    // Mark a cell, then pull at once (before the 0.8 s autosave).
    await page.evaluate(() => { const td = document.querySelector('td.c'); td.click(); });
    const key = await page.evaluate(() => [...window.__flg.state.marks].find(([, v]) => v)?.[0]);
    [x, y] = await centre('.appbar .brand');
    await pull(x, y, 260);
    assert(await reloaded(), 'pulling from the top refreshes the puzzle screen');
    await page.waitForSelector('#tier-choices input');
    const saved = await page.evaluate(async (sid) => (await (await import('./js/store.js')).getSave(sid)), id);
    assert(saved && key && saved.marks && saved.marks[key], 'the mark made just before the refresh was saved');

    // ---- The admin dashboard.
    await page.goto(`http://localhost:${ADMIN}/admin/`);
    await page.waitForSelector('#login', { state: 'attached' });
    await page.waitForTimeout(500);
    await tag();
    await pull(200, 120, 260);
    assert(await reloaded(), 'the admin dashboard refreshes on a pull from the top');
    await page.waitForSelector('#login', { state: 'attached' });
    await page.evaluate(() => {
      // Pretend an admin has typed into a box on the dashboard.
      const t = document.createElement('textarea'); t.id = 'pr-test'; document.querySelector('#main').append(t); t.value = 'half-written announcement';
      window.__notReloaded = true;
    });
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
    await pull(200, 120, 260);
    assert(/not saved yet/.test(asked), 'the admin is asked before unsaved typing is lost');
    assert(!(await reloaded()), 'choosing Cancel keeps the page');
    await ctx.close();

    assert(!errors.filter((e) => !/client-config|Failed to fetch|JSON/.test(e)).length, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    servers.forEach((s) => s.kill());
  }
})();
