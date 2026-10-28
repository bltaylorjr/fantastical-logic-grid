// Picture clues (experimental): hidden unless ?pictures=1; solving the
// picture unlocks the locked clue and the result survives a reload.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const dir = process.argv[2] || path.join(__dirname, '..', 'dist', 'web');

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), dir, '8147'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));

    // Off by default: players see nothing new.
    await page.goto('http://localhost:8147/?play=now');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(!(await page.locator('.pic-clue').count()), 'no picture clue unless switched on');

    // Switched on for this device.
    await page.goto('http://localhost:8147/?play=now&pictures=1');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.waitForSelector('#clue-list li.pic-locked');
    const n = await page.getAttribute('#clue-list li.pic-locked', 'data-n');
    assert(!(await page.locator(`#clue-list li[data-n="${n}"] .txt`).isVisible()), `clue ${n} starts locked`);
    await page.click('.pic-open');
    await page.waitForSelector('.pic-cell');
    await page.screenshot({ path: process.env.SHOT || '/tmp/pic-before.png', fullPage: false });

    // Fill the picture's squares (from the engine, as a player would by logic).
    const rows = await page.evaluate(async () => {
      const { pictureClue } = await import('./engine/index.js');
      return pictureClue(window.__flg.state.save.puzzle).picture.rows;
    });
    const W = rows[0].length;
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < W; x++) {
      if (rows[y][x] === '#') await page.click(`.pic-cell[data-i="${y * W + x}"]`);
    }
    await page.waitForSelector('#clue-list li[data-n="' + n + '"]:not(.pic-locked)');
    assert(await page.locator(`#clue-list li[data-n="${n}"] .txt`).isVisible(), 'solving the picture unlocks the clue');
    assert(/unlocked/.test(await page.textContent('.pic-status')), 'the player is told the clue is unlocked');
    await page.screenshot({ path: (process.env.SHOT || '/tmp/pic-before.png').replace('before', 'after'), fullPage: false });

    // Reopening the puzzle keeps the clue unlocked.
    await page.click('#home-btn');
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.waitForSelector('.pic-open');
    assert(!(await page.locator('#clue-list li.pic-locked').count()), 'the clue stays unlocked after reopening');

    // Switched off again.
    await page.goto('http://localhost:8147/?pictures=0');
    if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert(!(await page.locator('.pic-clue').count()), '?pictures=0 switches it off');
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
