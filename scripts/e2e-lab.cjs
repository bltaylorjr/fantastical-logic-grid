// Lab modes (web/js/lab.js, engine/src/modes.js) in headless Chromium: the
// normal page has no Lab choice; ?lab=1 shows it, and picking a mode hides
// the Size and Topic choices; a Timeline Case and a Seating Plan generate in
// the chosen theme, take a hint, show story moments while solving, solve,
// and the Seating Plan shows its round table. Solves stay out of the stats,
// badges and live learning, and go to the mode's own record, which the
// solved panel's next-level suggestion uses. With ?beats=0 no story moments. Run after npm run build (and, for the preview check, after
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
  const meta = (key) => page.evaluate(async (k) => (await import('./js/store.js')).getMeta(k, null), key);
  const play = async (mode, tier, theme, { beats = true } = {}) => {
    await page.check(`input[name=labmode][value=${mode}]`, { force: true });
    await page.check(`input[name=tier][value=${tier}]`, { force: true });
    await page.check(`input[name=theme][value=${theme}]`, { force: true });
    assert(await page.evaluate(() => document.querySelector('#size-choices').closest('fieldset').hidden && document.querySelector('#topic-field').hidden), `${mode}: Size and Topic hidden while a Lab mode is picked`);
    const preview = await page.textContent('#preview');
    assert(/set in the .* theme/.test(preview), `${mode}: preview "${preview}"`);
    const before = { solves: JSON.stringify(await meta('solves')), history: JSON.stringify(await meta('history')), learning: JSON.stringify(await meta('learning')), badges: JSON.stringify(await meta('badges')) };
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
    const p = await page.evaluate(() => { const q = window.__flg.state.puzzle; return { mode: q.mode, theme: q.theme.id, cast: q.cast.one, title: q.title, clues: q.clues.map((c) => c.text), types: q.clues.map((c) => c.type) }; });
    assert(p.mode === mode, `${mode}: a ${tier} ${mode} puzzle (${p.clues.length} clues: ${[...new Set(p.types)].join(', ')})`);
    assert(p.theme === theme, `${mode}: set in the chosen theme (${p.theme}, "${p.title}", cast: ${p.cast}s)`);
    await page.click('[data-act=hint]');
    await page.waitForSelector('#hintbox:not([hidden])', { timeout: 30000 });
    const hint = (await page.textContent('#hintbox')).replace(/\s+/g, ' ').trim();
    assert(/clue \d+|grid/i.test(hint), `${mode}: hint shown ("${hint.slice(0, 70)}...")`);
    await solveByHand();
    await page.waitForSelector('#solved:not([hidden])', { timeout: 20000 });
    const ending = await page.textContent('#ending');
    assert(ending.length > 20, `${mode}: solved, ending "${ending.slice(0, 80)}..."`);
    const beat = await page.evaluate(() => { const b = document.querySelector('#story-beat'); return b && !b.hidden ? b.textContent.trim() : ''; });
    if (beats) assert(beat.length > 10, `${mode}: a story moment was shown ("${beat}")`);
    else assert(!beat, `${mode}: no story moments with ?beats=0`);
    await page.waitForFunction(() => /(Timeline Case|Seating Plan)/.test(document.querySelector('#next-tip').textContent), null, { timeout: 10000 });
    assert(true, `${mode}: next level from the mode's own record ("${await page.textContent('#next-tip')}")`);
    const after = { solves: JSON.stringify(await meta('solves')), history: JSON.stringify(await meta('history')), learning: JSON.stringify(await meta('learning')), badges: JSON.stringify(await meta('badges')) };
    assert(JSON.stringify(after) === JSON.stringify(before), `${mode}: no stats, badges or live learning recorded`);
    const rec = await meta('labLearning');
    assert(rec && Array.isArray(rec[mode]) && rec[mode].some((x) => x.outcome === 'solved' && x.tier === tier), `${mode}: solve kept in the mode's own record (${rec[mode].length})`);
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
    await play('timeline', 'medium', 'sports');
    assert(!(await page.locator('#lab-table svg').count()), 'timeline: no table picture');
    await page.goto(`http://localhost:${PORT}/${built ? '' : '?lab=1'}`);
    await page.waitForSelector('input[name=labmode]');
    await play('seating', 'easy', 'scifi');
    assert(await page.locator('#lab-table svg circle').count() >= 6, 'seating: the round table is drawn on the solved panel');
    // The story moments' own switch (director.js): ?beats=0 turns them off on this device.
    await page.goto(`http://localhost:${PORT}/?beats=0${built ? '' : '&lab=1'}`);
    await page.waitForSelector('input[name=labmode]');
    await play('timeline', 'basic', 'holiday', { beats: false });
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
