// The front page's first-visit welcome (scripts/hub.mjs, web/js/hub.js), against
// the website build (dist/site): it offers the tour of The Logic Grid once, plays
// it with captions on, closes with X, Escape or a click outside (the video
// stops), Play today's puzzle opens the daily puzzle (the main button for
// visitors from another site), and it never shows to a player who already knows the site.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = 8164;
const BASE = `http://localhost:${PORT}`;

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'site'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  const open = async (viewport = { width: 1280, height: 800 }, settings = null, referer = undefined) => {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    if (settings) await ctx.addInitScript((s) => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', s); }, JSON.stringify(settings));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/`, { referer });
    await page.waitForSelector('.games .card');
    await page.waitForTimeout(300);
    return page;
  };
  const isOpen = (page) => page.evaluate(() => document.querySelector('#hub-welcome').open);
  const paused = (page) => page.waitForFunction(() => document.querySelector('#hub-welcome video').paused, null, { timeout: 3000 }).then(() => true, () => false);
  try {
    let page = await open();
    assert(await isOpen(page), 'a first visit gets the welcome');
    assert(await page.evaluate(() => document.activeElement.id) === 'hub-welcome-tour', 'Take the tour has the focus');
    await page.click('#hub-welcome-tour');
    await page.waitForTimeout(1500);
    const v = await page.evaluate(() => { const e = document.querySelector('#hub-welcome video'); const t = e.textTracks[0]; return { src: e.currentSrc, playing: !e.paused, mode: t && t.mode }; });
    assert(/the-logic-grid\.mp4$/.test(v.src) && v.mode === 'showing', 'the tour plays in the welcome with captions on');
    assert(await page.locator('#hub-welcome-tour').isHidden(), 'Take the tour steps aside while it plays');
    await page.keyboard.press('Escape');
    assert(!(await isOpen(page)) && await paused(page), 'Escape closes it and the video stops');
    await page.reload();
    await page.waitForSelector('.games .card');
    await page.waitForTimeout(500);
    assert(!(await isOpen(page)), 'the welcome is offered only once');
    await page.context().close();

    page = await open();
    await page.click('#hub-welcome-x');
    assert(!(await isOpen(page)), 'X closes it');
    await page.click('.card[data-game="flg"] a.play');
    await page.waitForURL(/\/fantastical\//);
    assert(true, 'the page behind works after closing');
    await page.context().close();

    page = await open();
    await page.click('#hub-welcome-play');
    await page.waitForURL(/\/fantastical\//);
    assert(true, 'Play today\'s puzzle opens the daily puzzle');
    await page.context().close();

    page = await open(undefined, null, 'https://www.google.com/');
    assert(await page.evaluate(() => document.activeElement.id) === 'hub-welcome-play', 'a visitor from a search gets Play today\'s puzzle first');
    assert(await page.evaluate(() => document.getElementById('hub-welcome-play').className === 'hw-go'), 'as the main button');
    await page.context().close();

    page = await open({ width: 360, height: 640 });
    assert(await isOpen(page), 'the welcome shows on a phone');
    const fits = await page.evaluate(() => { const r = document.querySelector('#hub-welcome').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
    assert(fits, 'and fits the screen');
    await page.mouse.click(5, 5);
    assert(!(await isOpen(page)), 'a click outside closes it');
    await page.context().close();

    page = await open(undefined, { introOffered: true });
    assert(!(await isOpen(page)), 'a player who already saw the game\'s welcome is not asked');
    await page.context().close();

    assert(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log('The Logic Grid front page welcome: all checks passed');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
