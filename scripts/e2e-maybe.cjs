// The red "?" reminder: on and off in an empty cell (corner tap, Q key, cell
// menu), never with an X or O, undoable, kept when the puzzle is reopened.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const dir = process.argv[2] || path.join(__dirname, '..', 'dist', 'web');

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), dir, '8149'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8149/?play=now');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const cell = page.locator('td.c').first();
    const tap = async (loc) => { await loc.scrollIntoViewIfNeeded(); await loc.click(); };
    const state = (loc) => loc.evaluate((td) => ({ q: !!td.querySelector('.q-mark'), x: td.classList.contains('m-x'), o: td.classList.contains('m-o'), label: td.getAttribute('aria-label') }));

    await tap(cell);
    let s = await state(cell);
    assert(s.x && !s.o && !s.q, 'one tap: X');
    await tap(cell);
    s = await state(cell);
    assert(s.o && !s.x && !s.q, 'two taps: O');
    await tap(cell);
    s = await state(cell);
    assert(s.q && !s.x && !s.o, 'three taps: a ? and nothing else');
    assert(/question mark/.test(s.label), 'screen readers hear the ?');
    assert(await page.locator('td.c .q-mark').count() === 1, 'no other cell changes');
    assert(await page.$eval('td.c .q-mark', (el) => getComputedStyle(el).color) !== 'rgb(0, 0, 0)', 'the ? is colored');
    await page.click('button[data-act=undo]');
    s = await state(cell);
    assert(s.o && !s.q, 'Undo takes the ? away and brings the O back');
    await page.click('button[data-act=redo]');
    await tap(cell);
    s = await state(cell);
    assert(!s.q && !s.x && !s.o, 'four taps: blank again');

    await tap(cell);
    await cell.focus();
    await page.keyboard.press('q');
    s = await state(cell);
    assert(s.x && !s.q, 'a ? never goes in a cell with an X or O');
    await page.keyboard.press('Delete');

    const second = page.locator('td.c').nth(1);
    await second.focus();
    await page.keyboard.press('q');
    assert((await state(second)).q, 'Q puts a ? in the focused cell');
    await page.keyboard.press('q');
    assert(!(await state(second)).q, 'Q again removes it');
    await second.click({ button: 'right' });
    await page.click('#cellmenu button[data-mark="?"]');
    assert((await state(second)).q, 'the cell menu offers the ?');

    await page.waitForTimeout(1200); // autosave
    await page.goto('http://localhost:8149/');
    await page.waitForSelector('#continue-btn:not([hidden])');
    if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert(await page.locator('td.c .q-mark').count() === 1, 'the ? reminder is kept when the puzzle is reopened');
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
