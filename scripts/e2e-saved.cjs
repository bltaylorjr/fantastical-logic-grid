// Saved Puzzles: puzzles in progress with a count of new ones (a puzzle made
// from the player's storyline arrives unopened), finished ones fold away
// under Completed puzzles, and opening a new one clears its New mark.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const dir = process.argv[2] || path.join(__dirname, '..', 'dist', 'web');

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), dir, '8152'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8152/?play=now');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    // Two more puzzles arrive: one made from the player's storyline (new), one already solved.
    await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const base = window.__flg.state.save;
      const now = Date.now();
      await store.putSave({ ...structuredClone(base), id: 'gift-1', name: 'The Silent Lantern', gift: true, openedAt: undefined, created: now, lastPlayed: now, percent: 0, marks: {} });
      await store.putSave({ ...structuredClone(base), id: 'done-1', name: 'A Finished Puzzle', solved: true, completedAt: now, percent: 100, openedAt: now - 1000 });
    });
    await page.click('#home-btn');
    await page.waitForSelector('#saved-toggle');
    assert((await page.textContent('#saved-h')).startsWith('Saved Puzzles'), 'the section is called Saved Puzzles');
    assert(await page.isHidden('#saved-list') && (await page.textContent('#saved-summary')) === '2 puzzles in progress · 1 completed', 'it starts as a small box with a short summary');
    await page.click('#saved-toggle');
    await page.waitForSelector('#saved-list .saved-item');
    assert(await page.getAttribute('#saved-toggle', 'aria-expanded') === 'true', 'Open shows the puzzle list');
    assert(await page.isVisible('#saved-new') && (await page.textContent('#saved-new')) === '1 new', 'it shows how many puzzles are new');
    const names = await page.$$eval('#saved-list .name', (els) => els.map((e) => e.textContent));
    assert(names[0] === 'The Silent Lantern' && names.length === 2, 'the new puzzle is first, with the one in progress');
    assert(/From your storyline/.test(await page.textContent('#saved-list li[data-id="gift-1"]')), 'the storyline puzzle is marked as such');
    assert(!names.includes('A Finished Puzzle'), 'finished puzzles leave the list');
    assert(await page.locator('#saved-list li[data-id="gift-1"] [data-do=export]').count() === 1, 'the storyline puzzle can be downloaded');
    assert(await page.locator('#saved-list [data-do=export]').count() === 2, 'puzzles in progress can be downloaded');
    assert(await page.locator('#saved-done-list [data-do=export]').count() === 0 && await page.locator('#saved-section [data-do=rename]').count() === 0, 'finished puzzles only open or delete');
    assert((await page.textContent('#saved-done summary')).includes('Completed puzzles (1)'), 'they are under Completed puzzles');
    await page.click('#saved-done summary');
    assert(await page.isVisible('#saved-done-list li[data-id="done-1"] [data-do=resume]'), 'a completed puzzle can still be opened');
    await page.click('#app-menu-btn, #menu-btn');
    assert(/Saved Puzzles \(1 new\)/.test(await page.textContent('#app-menu')), 'the Menu shows the count too');
    await page.keyboard.press('Escape');
    await page.click('#saved-list li[data-id="gift-1"] [data-do=resume]');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.click('#home-btn');
    await page.waitForSelector('#saved-list .saved-item');
    assert(await page.isHidden('#saved-new'), 'opening it clears the new count');
    assert(await page.isVisible('#saved-list'), 'the box stays open once opened');
    await page.click('#saved-toggle');
    assert(await page.isHidden('#saved-list'), 'Close folds it away again');
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
