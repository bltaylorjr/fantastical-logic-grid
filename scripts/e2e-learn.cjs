// End-to-end check of learning from play: a solve is recorded, the rating and
// "too easy" tap tune the next puzzle, Settings keeps only the player's own
// learning switch, and added story parts still reach new stories.
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
    assert(/Rate this puzzle \(optional\)/.test(await page.textContent('#feedback .stars legend')), 'the rating is clearly labelled as optional');
    assert(/5 stars is excellent/.test(await page.textContent('#rate-help')), 'the scale is explained (5 is excellent)');
    assert(await page.locator('#feedback .stars input[value="5"]').getAttribute('aria-describedby') === null && (await page.getAttribute('#feedback .stars', 'aria-describedby')) === 'rate-help', 'the stars point to the scale for screen readers');
    assert(L.plays[0].pid && /^[A-Za-z0-9]{12}$/.test(L.plays[0].pid) && L.plays[0].mode === 'free' && L.plays[0].topic, 'the summary has a one-off key, mode and topic for the ratings report');
    await page.click('#rating-clear');
    L = await learning();
    assert(L.plays[0].rating === null && L.plays[0].feel === 'easy' && !(await page.isChecked('#feedback .stars input[value="5"]')), 'Clear my rating takes the stars back');
    await page.locator('#feedback .stars label').nth(4).click();
    await page.waitForFunction(async () => (await (await import('./js/learn.js')).getState()).plays[0].rating === 5);

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

    // Learning in Settings is only the player's own switch; the Story
    // workshop and the rest moved to the admin dashboard.
    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    const learnInputs = await page.$$eval('#dlg-settings fieldset.learning input', (els) => els.map((e) => e.name));
    assert(learnInputs.join() === 'learn', 'Learning in Settings has only "Learn from how I play"');
    assert(!(await page.locator('#learn-workshop, #dlg-workshop').count()), 'the Story workshop is no longer in the game');
    // With "Learn from how I play" off the stars still show, and the rating stays on the device.
    await page.uncheck('#dlg-settings input[name=learn]');
    await page.keyboard.press('Escape');
    await solve();
    await page.waitForSelector('#solved:not([hidden])');
    assert(await page.isVisible('#feedback .stars'), 'the stars show with learning off too');
    await page.evaluate(() => document.documentElement.classList.add('silent'));
    assert(await page.isVisible('#feedback .stars') && await page.isVisible('#next-btn'), 'Silent mode keeps the stars, and nothing waits on them');
    await page.evaluate(() => document.documentElement.classList.remove('silent'));
    await page.locator('#feedback .stars label').nth(1).click();
    await page.waitForFunction(() => /stays on your device/.test(document.querySelector('#feedback-thanks').textContent));
    const local = (await learning()).plays.find((x) => x.storyId === now);
    assert(local && local.rating === 2 && local.sent === 3, 'a rating with learning off is kept on the device and never shared');
    // Story parts (from the dashboard's workshop, through shared tuning) still reach new stories.
    await page.evaluate(async () => (await import('./js/learn.js')).addPart('mystery', 'openings', 'Moonlight filled the old observatory, where {n} {many} waited for the comet.', 'mine'));
    const tuned = await page.evaluate(async () => (await import('./js/learn.js')).tuning('basic'));
    assert(tuned.storyParts.mystery.openings.length === 1, 'an added story part goes to the engine');
    const p = await page.evaluate(async (t) => (await import('./engine/index.js')).generatePuzzle({ ...t, difficulty: 'basic', theme: 'mystery', seed: 'ws' }), tuned);
    assert(/^mystery[|\/]/.test(p.story.id), `puzzles still generate with added parts (${p.story.id})`);
    assert(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
