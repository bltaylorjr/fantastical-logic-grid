// Lab modes (web/js/lab.js, engine/src/modes.js) in headless Chromium: the
// normal page has no Lab choice; ?lab=1 shows it; a Timeline Case and a
// Seating Plan generate, take a hint, solve, and the Seating Plan shows its
// round table. Run after npm run build (and, for the preview check, after
// FLG_LAB=1 npm run build). Port: FLG_E2E_PORT or 8141.
//   node -r ./scripts/e2e-in-game.cjs scripts/e2e-lab.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = process.env.FLG_E2E_PORT || '8141';
const dir = process.env.FLG_E2E_DIR || path.join(__dirname, '..', 'dist', 'web');

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), dir, PORT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true })); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const built = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('name="flg-lab"');
  const solveByHand = () => page.evaluate(() => {
    const S = window.__flg.state;
    for (const [k, td] of S.grid.cells) {
      const [a, b] = k.split('|');
      if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
    }
  });
  const play = async (mode, tier) => {
    await page.check(`input[name=labmode][value=${mode}]`, { force: true });
    await page.check(`input[name=tier][value=${tier}]`, { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
    const p = await page.evaluate(() => { const q = window.__flg.state.puzzle; return { mode: q.mode, clues: q.clues.map((c) => c.text), types: q.clues.map((c) => c.type) }; });
    assert(p.mode === mode, `${mode}: a ${tier} ${mode} puzzle (${p.clues.length} clues: ${[...new Set(p.types)].join(', ')})`);
    await page.click('[data-act=hint]');
    await page.waitForSelector('#hintbox:not([hidden])', { timeout: 30000 });
    const hint = (await page.textContent('#hintbox')).replace(/\s+/g, ' ').trim();
    assert(/clue \d+|grid/i.test(hint), `${mode}: hint shown ("${hint.slice(0, 70)}...")`);
    await solveByHand();
    await page.waitForSelector('#solved:not([hidden])', { timeout: 20000 });
    const ending = await page.textContent('#ending');
    assert(ending.length > 20, `${mode}: solved, ending "${ending.slice(0, 80)}..."`);
    return page;
  };
  try {
    if (!built) {
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('#tier-choices input');
      assert(!(await page.locator('#lab-field, input[name=labmode]').count()), 'no Lab choice without ?lab=1');
    }
    await page.goto(`http://localhost:${PORT}/${built ? '' : '?lab=1'}`);
    await page.waitForSelector('input[name=labmode]');
    assert(await page.locator('input[name=labmode]').count() === 3, `Lab choice shown (${built ? 'FLG_LAB=1 build' : '?lab=1'})`);
    await play('timeline', 'medium');
    assert(!(await page.locator('#lab-table svg').count()), 'timeline: no table picture');
    await page.goto(`http://localhost:${PORT}/${built ? '' : '?lab=1'}`);
    await page.waitForSelector('input[name=labmode]');
    await play('seating', 'easy');
    assert(await page.locator('#lab-table svg circle').count() >= 6, 'seating: the round table is drawn on the solved panel');
    // dist/preview has no service worker (claude.ai serves it), so its
    // registration fails when served here; that is not a lab problem.
    const real = fs.existsSync(path.join(dir, 'sw.js')) ? errors : errors.filter((e) => !/fetching the script/.test(e));
    assert(!real.length, `no page errors ${real.join(' | ')}`);
  } catch (e) {
    console.error(e.message);
    if (errors.length) console.error(errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
