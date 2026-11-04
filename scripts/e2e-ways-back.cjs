// A way back from everywhere. In the installed app there is no browser back
// button, so:
// - every website page has a Back button (top and bottom) that returns to the
//   page before it on this site, or to the game;
// - the game shows Back on every screen but the game cards; the phone's back
//   gesture or button closes an open window first, then steps back towards
//   home, and the Android app's back button does the same (home, then the cards).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const site = path.join(__dirname, '..', 'dist', 'site');
const PORT = 8151;
const BASE = `http://localhost:${PORT}`;

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), site, String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true })); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const screen = () => page.evaluate(() => ['home', 'play', 'learn', 'np'].find((s) => !document.getElementById(`screen-${s}`).hidden));

    // ---- The game
    await page.goto(`${BASE}/fantastical/`);
    await page.waitForSelector('#tier-choices input');
    assert(await page.locator('#back-btn').isVisible(), 'the home screen has Back, to all the games');
    await page.click('#quick-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await page.locator('#back-btn').isVisible(), 'a puzzle shows Back');
    await page.click('#back-btn');
    await page.waitForSelector('#screen-home:not([hidden])');
    assert(new URL(page.url()).pathname === '/fantastical/', 'Back from a puzzle goes home, still in the game');

    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    await page.goBack();
    await page.waitForTimeout(300);
    assert(!(await page.locator('#dlg-settings[open]').count()) && (await screen()) === 'play', "the phone's back closes an open window first and stays on the puzzle");
    await page.goBack();
    await page.waitForSelector('#screen-home:not([hidden])');
    assert(new URL(page.url()).pathname === '/fantastical/', "the phone's back then goes from the puzzle to home, without leaving the game");

    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    const androidBack = () => page.evaluate(() => window.__flgScreenBack && window.__flgScreenBack());
    assert(await androidBack() === true, "the Android app's back button steps back from a puzzle");
    await page.waitForSelector('#screen-home:not([hidden])');
    // On the website every game has its own page, so the game cards are the
    // front page (the apps keep them as a screen: e2e-games.cjs).
    assert(await androidBack() === true, 'on the home screen it goes to all the games');
    await page.waitForURL(`${BASE}/`);
    await page.waitForSelector('a.play[href="fantastical/"]');
    assert(true, 'which on the website is The Logic Grid front page');
    await page.click('a.play[href="fantastical/"]');
    await page.waitForSelector('#screen-home:not([hidden]) #tier-choices input');

    // A reload keeps the browser's history entries; going home afterwards
    // must not step back into the earlier load (that would reload the page).
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    await page.evaluate(() => { window.__sameLoad = true; });
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.click('#back-btn');
    await page.waitForSelector('#screen-home:not([hidden])');
    await page.waitForTimeout(500);
    assert(await page.evaluate(() => window.__sameLoad === true), 'after a reload, Back goes home without reloading the page');

    // ---- Website pages (opened from the links at the foot of the home screen)
    await page.click('.site-links a[href="how-to-play/"]');
    await page.waitForURL(/how-to-play\/$/);
    for (const where of ['header .back', 'footer [data-back]']) assert(await page.locator(where).first().isVisible(), `a website page has Back (${where.split(' ')[0]})`);
    await page.click('header .back');
    await page.waitForURL(`${BASE}/fantastical/`);
    await page.waitForSelector('#tier-choices input');
    assert(true, 'Back on a website page returns to the game it came from');

    // A page reached from another page goes back to that page.
    await page.goto(`${BASE}/themes/`);
    await page.click('header nav a[href$="difficulty-levels/"]');
    await page.waitForURL(/difficulty-levels\/$/);
    await page.click('header .back');
    await page.waitForURL(/themes\/$/);
    assert(true, 'Back returns to the previous website page');

    // Opened straight from a link elsewhere: Back goes to the game.
    const fresh = await ctx.newPage();
    await fresh.goto(`${BASE}/printables/`);
    await fresh.click('header .back');
    await fresh.waitForURL(`${BASE}/fantastical/`);
    assert(true, 'a page opened on its own goes Back to the game');
    await fresh.close();

    // Every website page has Back.
    const pages = ['how-to-play/', 'daily/', 'printables/', 'themes/', 'difficulty-levels/', 'educators/', 'privacy/', 'terms/', 'picks/'];
    for (const p of pages) {
      const res = await page.goto(`${BASE}/${p}`);
      if (!res || !res.ok()) continue;
      assert(await page.locator('header a.back[data-back]').count() === 1, `${p} has a Back button`);
    }
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
