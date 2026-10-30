// Picture clues: on for everyone, explained the first time, solving the
// picture unlocks the locked clue, progress lives in the save, the Settings
// switch turns it off and on, and printouts carry the picture puzzle.
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

    // On by default, with the explanation open the first time.
    await page.goto('http://localhost:8147/?play=now');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.waitForSelector('#clue-list li.pic-locked');
    const n = await page.getAttribute('#clue-list li.pic-locked', 'data-n');
    assert(!(await page.locator(`#clue-list li[data-n="${n}"] .txt`).isVisible()), `clue ${n} starts locked`);
    assert(await page.locator('.pic-body').isVisible(), 'the first locked clue opens with its explanation');
    assert(/New: picture clues/.test(await page.textContent('.pic-help')), 'the explanation says what picture clues are');
    await page.screenshot({ path: process.env.SHOT || '/tmp/pic-before.png', fullPage: false });

    // A printout shows the picture puzzle and the clue upside down; the key shows the picture.
    const printed = await page.evaluate(async () => {
      const { buildPrint } = await import('./js/print.js');
      const { pictureClue } = await import('./engine/index.js');
      const p = window.__flg.state.save.puzzle;
      const pc = pictureClue(p);
      const html = buildPrint(p, { paper: 'letter', answerKey: true, picture: { ...pc, solved: false } });
      return { box: (html.match(/pic-print-box/g) || []).length, flip: html.includes('pic-print-flip'), filled: html.includes('class="f"') };
    });
    assert(printed.box === 2 && printed.flip && printed.filled, 'printouts carry the picture puzzle, the upside-down clue and the answer');

    // Fill the picture's squares (from the engine, as a player would by logic).
    const rows = await page.evaluate(async () => {
      const { pictureClue } = await import('./engine/index.js');
      return pictureClue(window.__flg.state.save.puzzle).picture.rows;
    });
    const W = rows[0].length;
    // Half way, then check the progress is kept in the save.
    const filled = [];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < W; x++) if (rows[y][x] === '#') filled.push(y * W + x);
    for (const i of filled.slice(0, 3)) await page.click(`.pic-cell[data-i="${i}"]`);
    const kept = await page.evaluate(() => window.__flg.state.save.picture);
    assert(kept && kept.c.split('').filter((v) => v === 'F').length === 3 && !kept.s, 'picture progress is kept in the save');

    // The Settings switch turns it off (the clue shows) and on again (progress kept).
    await page.evaluate(() => window.__flg.openSettings?.());
    const viaMenu = !(await page.locator('#dlg-settings[open]').count());
    if (viaMenu) { await page.click('#menu-btn').catch(() => {}); await page.click('[data-cmd=settings]').catch(() => {}); }
    await page.waitForSelector('#dlg-settings[open]');
    await page.click('#more-settings summary');
    await page.uncheck('input[name=pictureClues]');
    assert(!(await page.locator('.pic-clue').count()) && await page.locator(`#clue-list li[data-n="${n}"] .txt`).isVisible(), 'turning picture clues off shows every clue');
    await page.check('input[name=pictureClues]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#clue-list li.pic-locked');
    assert(await page.locator('.pic-body').isHidden(), 'the explanation only opens automatically the first time');
    await page.click('.pic-open');
    const again = await page.locator('.pic-cell.f').count();
    assert(again === 3, `progress is still there after switching back on (${again} filled)`);

    for (const i of filled.slice(3)) await page.click(`.pic-cell[data-i="${i}"]`);
    await page.waitForSelector(`#clue-list li[data-n="${n}"]:not(.pic-locked)`);
    assert(await page.locator(`#clue-list li[data-n="${n}"] .txt`).isVisible(), 'solving the picture unlocks the clue');
    assert(/unlocked/.test(await page.textContent('.pic-status')), 'the player is told the clue is unlocked');
    await page.screenshot({ path: (process.env.SHOT || '/tmp/pic-before.png').replace('before', 'after'), fullPage: false });

    // Reopening the puzzle keeps the clue unlocked.
    await page.click('#home-btn');
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.waitForSelector('.pic-open');
    assert(!(await page.locator('#clue-list li.pic-locked').count()), 'the clue stays unlocked after reopening');

    // ?pictures=0 switches it off for testing.
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
