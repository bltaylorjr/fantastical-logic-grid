// End-to-end check of the narrator's "Try again" near the end of a puzzle
// (player reports: "Try again" three times on the last correct moves). Tapping
// cycles a cell empty, X, O, so the X on the way to a correct O is not called
// out; an X that stays wrong still is, after a moment.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8159'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const cell = (k) => page.locator(`#gridframe td.c[data-k="${k}"]`);
  const press = async (k, key) => { await cell(k).focus(); await page.keyboard.press(key); };
  try {
    await page.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: true, readAloud: true, volume: 0, autoX: false, coach: false })));
    await page.goto('http://localhost:8159/');
    await page.waitForSelector('#tier-choices input');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    // Every status line from now on.
    await page.evaluate(() => {
      window.__said = [];
      new MutationObserver(() => window.__said.push(document.querySelector('#status').textContent)).observe(document.querySelector('#status'), { childList: true, characterData: true, subtree: true });
    });
    const said = () => page.evaluate(() => window.__said.filter((t) => t === 'Try again.').length);

    // Fill the grid with the right marks, leaving the last three Os.
    const { xs, os } = await page.evaluate(() => {
      const S = window.__flg.state;
      const match = (k) => { const [a, b] = k.split('|'); return S.puzzle.solution.some((row) => { const v = Object.values(row); return v.includes(a) && v.includes(b); }); };
      const keys = [...S.grid.cells.keys()];
      return { xs: keys.filter((k) => !match(k)), os: keys.filter(match) };
    });
    for (const k of xs) await press(k, 'x');
    for (const k of os.slice(0, -3)) await press(k, 'o');
    const last = os.slice(-3);

    // Tap, tap: X then O on two of the last three cells.
    for (const k of last.slice(0, 2)) { await cell(k).click(); await cell(k).click(); }
    await page.waitForTimeout(2200);
    assert((await said()) === 0, 'no "Try again" when tapping through X to the right O on the last cells');

    // An X that stays on a cell that should be an O is still called out.
    await cell(last[2]).click();
    await page.waitForTimeout(2200);
    assert((await said()) === 1, 'a wrong X that stays near the end still gets "Try again"');
    await cell(last[2]).click();
    await page.waitForFunction(() => window.__flg.state.save.solved, null, { timeout: 5000 });
    assert(true, 'the puzzle is solved');
    assert(!errors.length, `no page errors (${errors.join('; ')})`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
