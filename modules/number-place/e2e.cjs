// Number Place module in the private test app: start, play with keys, notes,
// undo and hints, solve it, and resume a saved game.
// Run: npm run build && node modules/build-test-app.mjs && node modules/number-place/e2e.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const shots = process.env.NP_SHOTS;

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', '..', 'scripts', 'serve.mjs'), path.join(__dirname, '..', '..', 'dist', 'module-test'), '8141'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  const open = async (viewport = { width: 1280, height: 900 }, colorScheme = 'light') => {
    const ctx = await browser.newContext({ viewport, colorScheme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8141/');
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-levels .choice');
    return page;
  };
  const npState = (page) => page.evaluate(async () => {
    const m = await import('./modules/number-place/ui.js');
    const G = m.state();
    return G && { v: G.v, n: G.n, givens: G.p.givens, solution: G.p.solution, size: G.p.size, sel: G.sel, solved: G.solved, hints: G.hints, undo: G.undo.length };
  });
  try {
    const page = await open();
    assert(await page.locator('#np-setup-view').isVisible(), 'the module shows its setup view');
    assert(await page.locator('input[name=np-level]').count() === 6, 'six difficulty levels');
    await page.check('input[name=np-level][value=easy]', { force: true });
    await page.click('#np-gen');
    await page.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
    assert(await page.locator('#np-board .np-cell').count() === 36, 'Easy is a 6 x 6 grid');
    assert(await page.locator('#np-digits .np-digit').count() === 6, 'number pad has 1 to 6');
    if (shots) await page.screenshot({ path: `${shots}/np-easy-start.png` });

    let s = await npState(page);
    const empty = s.givens.findIndex((d) => !d);
    await page.locator(`#np-board .np-cell[data-i="${empty}"]`).click();
    const right = s.solution[empty], wrong = (right % 6) + 1;
    await page.keyboard.press(String(wrong));
    s = await npState(page);
    assert(s.v[empty] === wrong, 'a number key fills the selected cell');
    await page.keyboard.press('Control+z');
    s = await npState(page);
    assert(s.v[empty] === 0, 'Ctrl+Z undoes it');
    await page.keyboard.press('Control+y');
    s = await npState(page);
    assert(s.v[empty] === wrong, 'Ctrl+Y redoes it');
    await page.click('#np-check');
    assert(await page.locator(`#np-board .np-cell[data-i="${empty}"].wrong`).count() === 1, 'Check marks the wrong number');
    await page.locator(`#np-board .np-cell[data-i="${empty}"]`).click();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('n');
    assert(await page.getAttribute('#np-notes-btn', 'aria-pressed') === 'true', 'N turns notes on');
    await page.keyboard.press('1'); await page.keyboard.press('3');
    s = await npState(page);
    assert(s.n[empty] === 0b101 && s.v[empty] === 0, 'notes mode writes notes, not numbers');
    assert(await page.locator(`#np-board .np-cell[data-i="${empty}"] .np-notes i`).count() === 6, 'notes are drawn in the cell');
    await page.keyboard.press('n');
    await page.click('#np-auto');
    s = await npState(page);
    assert(s.givens.every((d, i) => d || s.n[i]), 'Fill notes gives every empty cell notes');
    assert(s.givens.every((d, i) => d || (s.n[i] & (1 << (s.solution[i] - 1)))), 'the filled notes always include the answer');
    const label = await page.getAttribute(`.np-cell[data-i="${empty}"]`, 'aria-label');
    assert(/^Row \d, column \d, empty, notes/.test(label), `cells describe themselves to screen readers (${label})`);
    await page.keyboard.press('ArrowRight');
    s = await npState(page);
    assert(s.sel === (empty % 6 === 5 ? empty - 5 : empty + 1), 'arrow keys move the selection');

    // Hints: three levels, then Fill it in.
    await page.click('#np-hint-btn');
    await page.waitForSelector('#np-hint:not([hidden])');
    assert(await page.locator('#np-hint li').count() === 1, 'a hint starts with a nudge');
    await page.click('#np-hint-more');
    await page.click('#np-hint-more');
    assert(await page.locator('#np-hint li').count() === 3, 'Tell me more goes to where, then why');
    if (shots) await page.screenshot({ path: `${shots}/np-easy-hint.png` });
    await page.click('#np-hint-fill');
    s = await npState(page);
    assert(s.hints === 1, 'hint is counted');

    // Solve the rest with the keyboard.
    for (let i = 0; i < s.size ** 2; i++) {
      if (s.givens[i] || s.v[i] === s.solution[i]) continue;
      await page.locator(`#np-board .np-cell[data-i="${i}"]`).click();
      await page.keyboard.press(String(s.solution[i]));
    }
    await page.waitForSelector('#np-solved:not([hidden])');
    assert(/Easy solved in \d+:\d\d with 1 hint/.test(await page.textContent('#np-solved-text')), 'solved panel shows time and hints');

    // Setup shows the saved stats; a 9 x 9 game resumes after a reload.
    await page.click('#np-home');
    assert(/Easy/.test(await page.textContent('#np-stats')), 'setup lists your times');
    await page.check('input[name=np-level][value=hard]', { force: true });
    await page.check('input[name=np-variant][value=diagonal]', { force: true });
    await page.click('#np-gen');
    await page.waitForSelector('#np-play-view:not([hidden]) .np-board.diag', { timeout: 30000 });
    assert(await page.locator('#np-board .np-cell').count() === 81, 'Hard is 9 x 9 with diagonals');
    s = await npState(page);
    const e2 = s.givens.findIndex((d) => !d);
    await page.locator(`#np-board .np-cell[data-i="${e2}"]`).click();
    await page.keyboard.press(String(s.solution[e2]));
    if (shots) await page.screenshot({ path: `${shots}/np-hard-diag.png` });
    await page.reload();
    await page.waitForSelector('#np-continue:not([hidden])');
    await page.click('#np-continue');
    await page.waitForSelector('#np-play-view:not([hidden])');
    s = await npState(page);
    assert(s.v[e2] === s.solution[e2], 'Continue resumes the saved game');
    await page.context().close();

    // Phone, dark mode, odd/even.
    const phone = await open({ width: 390, height: 844 }, 'dark');
    await phone.check('input[name=np-level][value=medium]', { force: true });
    await phone.check('input[name=np-variant][value=parity]', { force: true });
    await phone.click('#np-gen');
    await phone.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
    assert(await phone.locator('#np-board .np-cell.even').count() > 0, 'odd/even shades the even cells');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(wide, 'no sideways scrolling on a phone');
    const boardBox = await phone.locator('#np-board').boundingBox();
    assert(boardBox.width >= 340, `board fills the phone width (${Math.round(boardBox.width)}px)`);
    if (shots) await phone.screenshot({ path: `${shots}/np-phone-dark.png`, fullPage: true });
    await phone.context().close();

    // Learning, stories, saved list, files, reveal and the solution replay.
    const pg = await open();
    const logs = [];
    pg.on('console', (m) => { if (/play record/.test(m.text())) logs.push(m.text()); });
    await pg.check('input[name=np-level][value=basic]', { force: true });
    const fps = [];
    for (let round = 0; round < 3; round++) {
      await pg.click('#np-gen');
      await pg.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
      if (round === 0) {
        assert(await pg.locator('#np-coach:not([hidden])').count() === 1, 'coach tips show on the first puzzle');
        assert((await pg.textContent('#np-story')).length > 30, 'the puzzle opens with its story');
        await pg.click('#np-coach-close');
      }
      const st = await pg.evaluate(async () => { const m = await import('./modules/number-place/ui.js'); const G = m.state(); return { fp: G.p.fingerprint, givens: G.p.givens, solution: G.p.solution }; });
      fps.push(st.fp);
      for (let i = 0; i < 16; i++) {
        if (st.givens[i]) continue;
        await pg.locator(`#np-board .np-cell[data-i="${i}"]`).click();
        await pg.keyboard.press(String(st.solution[i]));
      }
      await pg.waitForSelector('#np-solved:not([hidden])');
      if (round === 0) {
        assert((await pg.textContent('#np-ending')).length > 20, 'solving shows the story ending');
        assert(/First grid/.test(await pg.textContent('#np-new-badges')), 'a new badge is announced');
        await pg.click('[data-feel=easy]');
        assert(/tougher/.test(await pg.textContent('#np-feel-done')), 'rating it too easy promises a tougher one');
        await pg.click('#np-share');
        await pg.waitForSelector('#np-share-pic img');
        assert(true, 'Share shows a spoiler-free result picture');
        await pg.click('#np-steps-btn');
        await pg.waitForSelector('#np-steps-dlg[open]');
        await pg.click('#np-step-next');
        assert(/Step 1 of/.test(await pg.textContent('#np-step-n')), 'the solution replays step by step');
        await pg.click('#np-step-end');
        assert(await pg.locator('#np-steps-board .np-cell .v').count() === 16, 'the replay ends on the full answer');
        await pg.keyboard.press('Escape');
      }
      await pg.click('#np-home');
    }
    assert(new Set(fps).size === 3, 'three puzzles in a row, all different');
    const seen = await pg.evaluate(async () => { const m = await import('./modules/number-place/ui.js'); return m.learning().plays().length; });
    assert(seen === 3, 'each solve leaves a play record');
    assert(logs.length >= 4, 'records (and the rating) go to the host for the learning service');
    const t = await pg.evaluate(async () => (await import('./modules/number-place/ui.js')).learning().toughness('basic'));
    assert(t > 0.5, `quick clean solves and "too easy" raise the toughness (${t.toFixed(2)})`);
    assert(await pg.locator('#np-saved li').count() === 3, 'saved puzzles lists all three');
    assert(/3 of 18 badges|[1-9]\d? of 18 badges/.test(await pg.textContent('#np-badges')), 'badges are listed');

    // Rename, delete and undo.
    await pg.locator('#np-saved li').first().locator('[data-act=rename]').click();
    await pg.keyboard.press('Control+a');
    await pg.keyboard.type('My favourite');
    await pg.keyboard.press('Enter');
    assert(/My favourite/.test(await pg.textContent('#np-saved')), 'a saved puzzle can be renamed');
    await pg.locator('#np-saved li').first().locator('[data-act=delete]').click();
    assert(await pg.locator('#np-saved li').count() === 2, 'delete removes it');
    await pg.click('#np-undo-delete');
    assert(await pg.locator('#np-saved li').count() === 3, 'Undo brings it back');

    // Reveal: confirm first, then it doesn't count as solved.
    await pg.check('input[name=np-level][value=easy]', { force: true });
    await pg.click('#np-gen');
    await pg.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
    await pg.click('#np-reveal');
    assert(await pg.locator('#np-reveal-confirm:not([hidden])').count() === 1, 'Show the answer asks first');
    await pg.click('#np-reveal-yes');
    await pg.waitForSelector('#np-solved:not([hidden])');
    assert(/The answer/.test(await pg.textContent('#np-solved-h')), 'the answer is shown');
    const outcome = await pg.evaluate(async () => (await import('./modules/number-place/ui.js')).learning().plays().at(-1).outcome);
    assert(outcome === 'revealed', 'a revealed puzzle is recorded as revealed, not solved');

    // Print options and a puzzle file round trip.
    await pg.click('#np-home');
    const g = await pg.evaluate(() => Object.values(JSON.parse(localStorage.getItem('np-test.games')))[0]);
    await pg.setInputFiles('#np-file', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'number-place', version: 1, game: g })) });
    await pg.waitForSelector('#np-play-view:not([hidden])');
    assert(await pg.locator('#np-board .np-cell').count() === g.p.size ** 2, 'a saved puzzle file opens');
    await pg.click('#np-home');
    await pg.setInputFiles('#np-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"number-place","game":{"p":{"size":4,"givens":[1],"solution":[1]}}}') });
    await pg.waitForFunction(() => /not a Number Place puzzle/.test(document.querySelector('#np-status').textContent));
    assert(true, 'a broken file is refused with a clear message');
    // A shared file can hold anything: markup in its numbers or story never reaches the page as HTML.
    const evil = JSON.parse(JSON.stringify(g));
    const firstEmpty = evil.p.givens.findIndex((d) => !d);
    evil.v[firstEmpty] = '<img src=x onerror="window.__pwned=1">';
    evil.undo = [[['__proto__', 1, 0, 2, 0]]];
    evil.p.box = ['<b>', '<i>'];
    if (evil.p.story) evil.p.story.title = '<img src=x onerror="window.__pwned=1">';
    await pg.locator('#np-status').evaluate((el) => { el.textContent = ''; });
    await pg.setInputFiles('#np-file', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'number-place', version: 1, game: evil })) });
    await pg.waitForSelector('#np-play-view:not([hidden])');
    await pg.waitForTimeout(300);
    assert(!(await pg.evaluate(() => window.__pwned)) && !(await pg.locator('#np-board img, #np-title img, #np-story img').count()), 'markup in a puzzle file is never run or shown as HTML');
    await pg.click('#np-home');
    const bad2 = JSON.parse(JSON.stringify(g));
    bad2.p.solution[0] = '<img src=x onerror="window.__pwned=1">';
    await pg.setInputFiles('#np-file', { name: 'bad2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'number-place', version: 1, game: bad2 })) });
    await pg.waitForFunction(() => /not a Number Place puzzle/.test(document.querySelector('#np-status').textContent));
    assert(!(await pg.evaluate(() => window.__pwned)), 'a file whose answer is not all numbers is refused');

    // Silent mode: no story or coach.
    await pg.click('#np-more summary');
    await pg.check('#np-silent');
    await pg.click('#np-gen');
    await pg.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
    assert(await pg.locator('#np-story').isHidden(), 'silent mode hides the story');
    await pg.click('#np-print');
    await pg.waitForSelector('#np-print-dlg[open]');
    assert(await pg.locator('#np-print-dlg input[name=np-paper]').count() === 2, 'print offers Letter and A4');
    await pg.keyboard.press('Escape');
    if (shots) await pg.click('#np-new');
    if (shots) await pg.screenshot({ path: `${shots}/np-setup-after.png`, fullPage: true });
    await pg.context().close();

    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
