// The first-visit welcome and the Introduction video can always be closed:
// a close (X) button that stays in view, Escape, and a click on the dimmed page.
// Checked at a laptop-sized desktop app window, where the video used to push
// its Close button out of sight.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8158'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  const open = async (viewport = { width: 1264, height: 681 }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8158/');
    await page.waitForSelector('#dlg-welcome[open]');
    return page;
  };
  const anyOpen = (page) => page.evaluate(() => !!document.querySelector('dialog[open]'));
  const inView = (page, sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  }, sel);
  try {
    // 1. The welcome's X closes it and leaves the home screen usable.
    let page = await open();
    assert(await inView(page, '#dlg-welcome .dlg-x'), 'welcome shows a close (X) button');
    assert(await page.getAttribute('#dlg-welcome .dlg-x', 'aria-label') === 'Close', 'the X is labelled Close');
    await page.click('#dlg-welcome .dlg-x');
    assert(!(await anyOpen(page)), 'X closes the welcome');
    await page.click('#howto-btn');
    await page.waitForSelector('#screen-learn:not([hidden])');
    assert(true, 'the page behind works after closing');
    await page.context().close();

    // 2. Escape and a click on the dimmed page also close it.
    page = await open();
    await page.keyboard.press('Escape');
    assert(!(await anyOpen(page)), 'Escape closes the welcome');
    await page.context().close();
    page = await open();
    await page.mouse.click(10, 400);
    assert(!(await anyOpen(page)), 'a click outside closes the welcome');
    await page.context().close();
    page = await open();
    await page.click('#dlg-welcome p');
    assert(await page.evaluate(() => document.querySelector('#dlg-welcome').open), 'a click inside the welcome keeps it open');

    // 3. The Introduction fits a laptop window: X and Close are in view.
    await page.click('#welcome-watch');
    await page.waitForSelector('#dlg-video[open]');
    await page.waitForTimeout(400);
    assert(await inView(page, '#dlg-video .dlg-x'), 'video shows a close (X) button');
    assert(await inView(page, '#video-close'), 'video Close button is in view without scrolling');
    await page.click('#dlg-video summary');
    await page.evaluate(() => { document.querySelector('#dlg-video').scrollTop = 1e6; });
    await page.waitForTimeout(200);
    assert(await inView(page, '#dlg-video .dlg-x'), 'X stays in view with the transcript open');
    assert(await inView(page, '#video-close'), 'Close stays in view with the transcript open');
    await page.click('#dlg-video .dlg-x');
    assert(!(await anyOpen(page)), 'X closes the video');
    assert(await page.evaluate(() => document.querySelector('#intro-video').paused), 'the video stops when closed');
    await page.click('#intro-btn');
    await page.waitForSelector('#dlg-video[open]');
    await page.mouse.click(5, 5);
    assert(!(await anyOpen(page)), 'a click outside closes the video');
    await page.context().close();

    // 4. A small window (phone) still shows both ways out.
    page = await open({ width: 360, height: 480 });
    assert(await inView(page, '#dlg-welcome .dlg-x'), 'X in view on a small window');
    await page.click('#welcome-watch');
    await page.waitForSelector('#dlg-video[open]');
    await page.waitForTimeout(400);
    assert(await inView(page, '#dlg-video .dlg-x') && await inView(page, '#video-close'), 'video X and Close in view on a small window');
    await page.context().close();

    assert(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
