// The Logic Grid's first screen: a card for each game. A first visit opens on
// the cards; each ready game's card opens its own screen; games still to come
// show as coming soon; the app reopens where the player last was.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
// The full package shows only on a tester's device (web/js/package-preview.js).
const PREVIEW = /CODE_HASH = '([0-9a-f]{64})'/.exec(require('fs').readFileSync(path.join(__dirname, '..', 'web', 'js', 'package-preview.js'), 'utf8'))[1];

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8182'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript((h) => localStorage.setItem('flg.preview', h), PREVIEW);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shown = (id) => page.locator(`#${id}`).isVisible();
  try {
    await page.goto('http://localhost:8182/');
    await page.waitForSelector('#screen-games:not([hidden]) #game-cards button');
    assert(await page.title() === 'The Logic Grid' && /The Logic Grid/.test(await page.locator('#home-btn').textContent()), 'the app is called The Logic Grid');
    assert(await shown('screen-games') && !(await shown('screen-home')), 'a first visit opens on the game cards');
    assert(!(await page.locator('#dlg-welcome[open]').count()), 'the welcome waits until The Fantastical Logic Grid is opened');
    const cards = await page.$$eval('#game-cards .game-card', (els) => els.map((e) => ({ id: e.dataset.game, name: e.querySelector('.game-name').textContent, button: e.tagName === 'BUTTON' })));
    assert(cards[0].id === 'logic-grid' && /^The Fantastical Logic Grid/.test(cards[0].name) && cards[0].button, 'The Fantastical Logic Grid has a card');
    assert(cards[1].id === 'ninetimesnine' && /^NINETIMESNINE/.test(cards[1].name) && cards[1].button, 'NINETIMESNINE has a card');
    assert(cards.slice(2).length >= 1 && cards.slice(2).every((c) => !c.button), 'games still to come show as coming soon, not as buttons');

    // The Fantastical Logic Grid, with its welcome the first time.
    await page.click('#game-cards [data-game=logic-grid]');
    await page.waitForSelector('#screen-home:not([hidden]) #tier-choices input');
    await page.waitForSelector('#dlg-welcome[open]');
    assert(/The Fantastical Logic Grid/.test(await page.locator('#hero-h').textContent()), 'the logic grid game keeps its name');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-welcome').open);
    await page.reload();
    await page.waitForSelector('#screen-home:not([hidden]) #tier-choices input');
    assert(!(await shown('screen-games')), 'the app reopens in the game the player was last in');

    // The name in the bar goes back to all the games.
    await page.click('#home-btn');
    await page.waitForSelector('#screen-games:not([hidden])');
    assert(await page.locator('.topstrip').isHidden(), "the logic grid's How to play and Introduction stay on its own screens");

    // NINETIMESNINE opens its own screen; All games comes back.
    await page.click('#game-cards [data-game=ninetimesnine]');
    await page.waitForSelector('#screen-np:not([hidden])');
    assert(/NINETIMESNINE/.test(await page.title()), 'NINETIMESNINE opens on its own screen');
    await page.reload();
    await page.waitForSelector('#screen-np:not([hidden])');
    assert(true, 'and the app reopens there');
    await page.click('#np-back');
    await page.waitForSelector('#screen-games:not([hidden])');
    await page.reload();
    await page.waitForSelector('#screen-games:not([hidden]) #game-cards button');
    assert(!(await shown('screen-home')), 'after All games, the app reopens on the cards');

    // A link into a puzzle still goes straight in, even on a first visit.
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p2 = await fresh.newPage();
    await p2.goto('http://localhost:8182/?learn');
    await p2.waitForSelector('#screen-learn:not([hidden])');
    assert(await p2.locator('#screen-games').isHidden() && await p2.locator('#screen-home').isHidden(), 'a How to play link opens How to play, not the cards');
    await fresh.close();

    // Each NINETIMESNINE game has its own link under the card.
    await page.goto('http://localhost:8182/');
    await page.click('#home-btn').catch(() => {});
    await page.waitForSelector('#screen-games:not([hidden]) .game-modes button');
    assert(await page.locator('.game-modes button').count() === 5, 'the NINETIMESNINE card links to each of its five games');
    await page.click('.game-modes [data-mode=tide]');
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-styles .choice', { timeout: 15000 });
    assert(await page.isChecked('input[name=np-style][value=tide]'), 'a game link opens NINETIMESNINE with that game picked');
    await page.click('#np-back');
    await page.waitForSelector('#screen-games:not([hidden])');

    // Each game has a video, and The Logic Grid has its own intro.
    assert(await page.locator('.game-watch').count() === 5 && await page.locator('#games-intro-btn').isVisible(), 'every game card has a video, and so does The Logic Grid');
    await page.click('.game-watch[data-video=cage-math]');
    await page.waitForSelector('#dlg-game-video[open]');
    const vid = await page.evaluate(() => ({ src: document.querySelector('#game-video source').getAttribute('src'), track: document.querySelector('#game-video track').getAttribute('src'), h: document.querySelector('#game-video-h').textContent }));
    assert(vid.src === 'media/games/cage-math.mp4' && vid.track === 'media/games/cage-math.vtt' && /Cage Math/.test(vid.h), 'a coming-soon card plays the video explaining its idea');
    const files = await page.evaluate(async () => Promise.all(['the-logic-grid', 'fantastical-logic-grid', 'ninetimesnine', 'cage-math', 'sum-cross', 'picture-grid'].flatMap((n) => ['mp4', 'vtt', 'jpg'].map((x) => fetch(`media/games/${n}.${x}`, { method: 'HEAD' }).then((r) => r.ok)))));
    assert(files.every(Boolean), 'every video, its captions and its poster are there');
    await page.click('#game-video-close');
    await page.waitForFunction(() => !document.querySelector('#dlg-game-video').open && document.querySelector('#game-video').paused);
    assert(true, 'closing the video stops it');

    // Everyone else sees The Fantastical Logic Grid alone.
    const pub = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const pp = await pub.newPage();
    pp.on('pageerror', (e) => errors.push(String(e)));
    await pp.goto('http://localhost:8182/?preview=not-the-code');
    await pp.waitForSelector('#screen-home:not([hidden]) #tier-choices input');
    assert(await pp.locator('#screen-games').isHidden() && await pp.title() === 'The Fantastical Logic Grid', 'a public visitor opens on The Fantastical Logic Grid');
    assert((await pp.locator('#home-btn').textContent()).trim() === 'The Fantastical Logic Grid' && await pp.locator('#back-btn').isHidden(), 'the bar says The Fantastical Logic Grid, with no way to the cards');
    if (await pp.locator('#dlg-welcome[open]').count()) { await pp.keyboard.press('Escape'); await pp.waitForFunction(() => !document.querySelector('#dlg-welcome').open); }
    await pp.click('#menu-btn');
    assert(await pp.locator('[data-cmd=numberplace]').isHidden() && await pp.locator('[data-cmd=games]').isHidden(), 'the menu has no NINETIMESNINE or All games');
    await pp.keyboard.press('Escape');
    assert(!/preview=/.test(pp.url()) && !(await pp.evaluate(() => localStorage.getItem('flg.preview'))), 'a wrong code unlocks nothing and leaves the address');
    await pp.goto('http://localhost:8182/?preview=off');
    await pp.waitForSelector('#screen-home:not([hidden])');
    await pub.close();
    // A tester's device leaves the preview with ?preview=off.
    await page.goto('http://localhost:8182/?preview=off');
    await page.waitForSelector('#tier-choices input');
    assert(await page.evaluate(() => !localStorage.getItem('flg.preview')) && await page.locator('#screen-games').isHidden(), '?preview=off switches the full package off');
    await page.evaluate((h) => localStorage.setItem('flg.preview', h), PREVIEW);
    await page.goto('http://localhost:8182/');
    await page.click('#home-btn').catch(() => {});
    await page.waitForSelector('#screen-games:not([hidden]) #game-cards button');

    // Phones: the cards stack in one column.
    await page.setViewportSize({ width: 390, height: 844 });
    const xs = await page.$$eval('#game-cards > li', (els) => els.map((e) => e.getBoundingClientRect().left));
    assert(new Set(xs.map(Math.round)).size === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'on a phone the cards stack and nothing spills sideways');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'games-phone.png'), fullPage: true });

    assert(!errors.length, `no page errors (${errors.join(' | ')})`);
    console.log('The Logic Grid game cards: all checks passed');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
