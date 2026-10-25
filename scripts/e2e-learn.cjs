// End-to-end check of learning from play: a solve is recorded, the rating and
// "too easy" tap tune the next puzzle, the story workshop checks and adds
// story parts, and Reset learning clears the history.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8125'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const solve = () => page.evaluate(() => {
    const S = window.__flg.state;
    for (const [k, td] of S.grid.cells) {
      const [a, b] = k.split('|');
      if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
    }
  });
  const learning = () => page.evaluate(async () => (await import('./js/learn.js')).getState());
  try {
    await page.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })));
    await page.goto('http://localhost:8125/');
    await page.waitForSelector('#tier-choices input');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.check('input[name=theme][value=mystery]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await solve();
    await page.waitForSelector('#solved:not([hidden])');
    assert(await page.isVisible('#feedback'), 'the solved panel asks how the puzzle was');
    let L = await learning();
    assert(L.plays.length === 1 && L.plays[0].outcome === 'solved' && L.plays[0].tier === 'basic', 'the solve is recorded on the device');
    assert(L.plays[0].mistakes === 0, `passing through X on the way to O is not a mistake (${L.plays[0].mistakes})`);
    await page.locator('#feedback .stars label').nth(4).click();
    await page.locator('#feedback .feel label', { hasText: 'Too easy' }).click();
    await page.waitForFunction(() => document.querySelector('#feedback-thanks').textContent.length > 0);
    L = await learning();
    assert(L.plays[0].rating === 5 && L.plays[0].feel === 'easy', 'rating and feel are saved');

    await page.click('#next-btn');
    await page.waitForSelector('#screen-home:not([hidden])');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const effort = await page.evaluate(() => window.__flg.state.puzzle.stats.effort);
    assert(effort > 0, `"too easy" makes the next Basic puzzle a little tougher (effort ${effort})`);
    const ids = (await learning()).plays.map((p) => p.storyId);
    const now = await page.evaluate(() => window.__flg.state.save.storyId);
    assert(!ids.includes(now), 'the tuned puzzle has a brand new story');

    // Story workshop
    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    assert((await page.textContent('#learn-summary')).includes('1 puzzle played'), 'Settings shows what the game has learned');
    await page.click('#learn-workshop');
    await page.waitForSelector('#dlg-workshop[open]');
    await page.selectOption('#ws-theme', 'mystery');
    await page.fill('#ws-text', 'Five friends met at the pier.');
    await page.click('#ws-add');
    assert((await page.textContent('#ws-errors')).length > 0, 'a part with a head count is refused with a reason');
    await page.fill('#ws-text', 'Moonlight filled the old observatory, where {n} {many} waited for the comet.');
    await page.click('#ws-add');
    await page.waitForFunction(() => document.querySelector('#ws-mine').textContent.includes('observatory'));
    assert(true, 'a valid opening is added to the mix');
    const tuned = await page.evaluate(async () => (await import('./js/learn.js')).tuning('basic'));
    assert(tuned.storyParts.mystery.openings.length === 1, 'the added part goes to the engine');
    const p = await page.evaluate(async (t) => (await import('./engine/index.js')).generatePuzzle({ ...t, difficulty: 'basic', theme: 'mystery', seed: 'ws' }), tuned);
    assert(p.story.id.startsWith('mystery|'), 'puzzles still generate with added parts');
    await page.click('#dlg-workshop .dlg-actions button');
    await page.click('#learn-reset');
    await page.click('#confirm-yes');
    await page.waitForFunction(() => document.querySelector('#learn-summary').textContent.includes('part'));
    L = await learning();
    assert(L.plays.length === 0 && L.parts.mystery.openings.length === 1, 'Reset learning clears play history and keeps added parts');
    assert(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
