// Puzzle styles (web/js/lab.js, engine/src/modes.js) in headless Chromium:
// the normal setup screen has the Puzzle style choice with Classic picked, and
// Classic sends no mode; picking Timeline Case or Seating Plan hides the Size,
// Topic and Clue types choices and is remembered; each generates in the chosen
// theme, takes a hint, shows story moments while solving, solves, and the
// Seating Plan shows its round table. Solves count toward the stats and
// badges, but stay out of the shared learning data, the Classic level
// suggestion and the scoreboard, and go to the style's own record, which the
// solved panel's next-level suggestion uses. Races are always Classic. With
// ?beats=0 no story moments; an old ?lab=1 link still works. Run after npm run
// build. Port: FLG_E2E_PORT or 8141.
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
  await require('./wait-port.cjs')(PORT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true })); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const solveByHand = () => page.evaluate(() => {
    const S = window.__flg.state;
    for (const [k, td] of S.grid.cells) {
      const [a, b] = k.split('|');
      if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
    }
  });
  const meta = (key) => page.evaluate(async (k) => (await import('./js/store.js')).getMeta(k, null), key);
  const play = async (mode, tier, theme, { beats = true } = {}) => {
    await page.check(`input[name=puzzle-mode][value=${mode}]`, { force: true });
    await page.check(`input[name=tier][value=${tier}]`, { force: true });
    await page.check(`input[name=theme][value=${theme}]`, { force: true });
    assert(await page.evaluate(() => document.querySelector('#size-choices').closest('fieldset').hidden && document.querySelector('#topic-field').hidden), `${mode}: Size and Topic hidden while ${mode} is picked`);
    assert(await page.evaluate(() => document.querySelector('#clue-type-choices').closest('fieldset').hidden && !document.querySelector('#mode-help').hidden), `${mode}: Clue types hidden, and the style's help shown`);
    const preview = await page.textContent('#preview');
    assert(/set in the .* theme/.test(preview) && !/\bLab\b/.test(preview), `${mode}: preview "${preview}"`);
    const before = { solves: JSON.stringify(await meta('solves')), history: JSON.stringify(await meta('history')), learning: JSON.stringify(await meta('learning')), badges: JSON.stringify(await meta('badges')) };
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
    const p = await page.evaluate(() => { const q = window.__flg.state.puzzle; return { mode: q.mode, theme: q.theme.id, cast: q.cast.one, title: q.title, clues: q.clues.map((c) => c.text), types: q.clues.map((c) => c.type) }; });
    const pills = await page.locator('#p-meta .pill').allTextContents();
    assert(pills.includes(mode === 'timeline' ? 'Timeline Case' : 'Seating Plan'), `${mode}: the puzzle's details name its style (${pills.join(', ')})`);
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
    const had = (JSON.parse(before.solves) || []).length;
    for (let i = 0; i < 50 && ((await meta('solves')) || []).length <= had; i++) await page.waitForTimeout(200);
    const after = { solves: JSON.stringify(await meta('solves')), history: JSON.stringify(await meta('history')), learning: JSON.stringify(await meta('learning')), badges: JSON.stringify(await meta('badges')) };
    assert((JSON.parse(after.solves) || []).length === (JSON.parse(before.solves) || []).length + 1, `${mode}: the solve counts toward the stats`);
    assert(Object.keys(JSON.parse(after.badges) || {}).length >= 1, `${mode}: and toward badges (${Object.keys(JSON.parse(after.badges) || {}).join(', ')})`);
    assert(after.history === before.history && after.learning === before.learning, `${mode}: no Classic level history or shared learning recorded`);
    assert(!(await page.evaluate(() => window.__flg.state.save.scorePending)), `${mode}: no scoreboard points`);
    assert(await page.locator('#challenge-btn').isHidden(), `${mode}: no challenge or race from it`);
    assert(!/\bLab\b/.test(await page.textContent('#solved')), `${mode}: the solved panel never says Lab`);
    const rec = await meta('labLearning');
    assert(rec && Array.isArray(rec[mode]) && rec[mode].some((x) => x.outcome === 'solved' && x.tier === tier), `${mode}: solve kept in the mode's own record (${rec[mode].length})`);
    return page;
  };
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('#tier-choices input');
    assert(await page.locator('#mode-field input[name=puzzle-mode]').count() === 3 && await page.isVisible('#mode-field'), 'the setup screen has the Puzzle style choice');
    assert(/Puzzle style/.test(await page.textContent('#mode-field legend')) && !/\bLab\b/.test(await page.textContent('#setup')), 'it is called Puzzle style, with no Lab wording');
    assert(await page.isChecked('input[name=puzzle-mode][value=classic]') && await page.isVisible('#size-choices') && await page.locator('#mode-help').isHidden(), 'Classic is picked to start, with Size shown');
    assert(!('mode' in (await page.evaluate(() => window.__flg.gatherOptions()))), 'Classic sends no mode, so live puzzles are unchanged');
    // Keyboard: the choice is a plain radio group.
    await page.focus('input[name=puzzle-mode][value=classic]');
    await page.keyboard.press('ArrowRight');
    assert(await page.isChecked('input[name=puzzle-mode][value=timeline]'), 'the arrow keys move through the styles');
    await page.keyboard.press('ArrowLeft');
    await play('timeline', 'medium', 'sports');
    assert(!(await page.locator('#mode-table svg').count()), 'timeline: no table picture');
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('input[name=puzzle-mode]');
    assert(await page.isChecked('input[name=puzzle-mode][value=timeline]'), 'the picked style is remembered');
    const race = await page.evaluate(() => window.__flg.raceOptions());
    assert(!race.mode && race.categories, 'a race is always a Classic puzzle');
    await play('seating', 'easy', 'scifi');
    assert(await page.locator('#mode-table svg circle').count() >= 6, 'seating: the round table is drawn on the solved panel');
    // The story moments' own switch (director.js): ?beats=0 turns them off on this device. Old ?lab=1 links still open normally.
    await page.goto(`http://localhost:${PORT}/?beats=0&lab=1`);
    await page.waitForSelector('input[name=puzzle-mode]');
    await play('timeline', 'basic', 'holiday', { beats: false });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('input[name=puzzle-mode]');
    await page.check('input[name=puzzle-mode][value=classic]', { force: true });
    assert(await page.isVisible('#size-choices') && !('mode' in (await page.evaluate(() => window.__flg.gatherOptions()))), 'back to Classic: Size shows again and no mode is sent');
    // dist/preview has no service worker (claude.ai serves it), so its
    // registration fails when served here; that is not a puzzle style problem.
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
