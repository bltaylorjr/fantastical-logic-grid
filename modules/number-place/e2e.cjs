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
    assert(await page.locator('.np-cell').count() === 36, 'Easy is a 6 x 6 grid');
    assert(await page.locator('#np-digits .np-digit').count() === 6, 'number pad has 1 to 6');
    if (shots) await page.screenshot({ path: `${shots}/np-easy-start.png` });

    let s = await npState(page);
    const empty = s.givens.findIndex((d) => !d);
    await page.locator(`.np-cell[data-i="${empty}"]`).click();
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
    assert(await page.locator(`.np-cell[data-i="${empty}"].wrong`).count() === 1, 'Check marks the wrong number');
    await page.locator(`.np-cell[data-i="${empty}"]`).click();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('n');
    assert(await page.getAttribute('#np-notes-btn', 'aria-pressed') === 'true', 'N turns notes on');
    await page.keyboard.press('1'); await page.keyboard.press('3');
    s = await npState(page);
    assert(s.n[empty] === 0b101 && s.v[empty] === 0, 'notes mode writes notes, not numbers');
    assert(await page.locator(`.np-cell[data-i="${empty}"] .np-notes i`).count() === 6, 'notes are drawn in the cell');
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
      await page.locator(`.np-cell[data-i="${i}"]`).click();
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
    assert(await page.locator('.np-cell').count() === 81, 'Hard is 9 x 9 with diagonals');
    s = await npState(page);
    const e2 = s.givens.findIndex((d) => !d);
    await page.locator(`.np-cell[data-i="${e2}"]`).click();
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
    assert(await phone.locator('.np-cell.even').count() > 0, 'odd/even shades the even cells');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(wide, 'no sideways scrolling on a phone');
    const boardBox = await phone.locator('#np-board').boundingBox();
    assert(boardBox.width >= 340, `board fills the phone width (${Math.round(boardBox.width)}px)`);
    if (shots) await phone.screenshot({ path: `${shots}/np-phone-dark.png`, fullPage: true });
    await phone.context().close();

    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
