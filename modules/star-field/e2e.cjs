// Star Field in the private test app: start a puzzle, take a hint and fill it
// in, undo, see touching stars turn red, play it to the end with clicks and
// keys, check the solved card, the replay and the play record, and look at it
// in the light, dark and high-contrast themes.
// Run: node modules/build-test-app.mjs && node modules/star-field/e2e.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = Number(process.env.SF_PORT || 8202);
const SHOTS = process.env.SF_SHOTS || '';
const P = 'sf';

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', '..', 'scripts', 'serve.mjs'), path.join(__dirname, '..', '..', 'dist', 'module-test'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    const logs = [];
    page.on('console', (m) => { if (/play record/.test(m.text())) logs.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/?game=${P}`);
    await page.waitForSelector(`#${P}-setup-view:not([hidden]) #${P}-levels .choice`);
    assert(await page.locator(`input[name=${P}-level]`).count() === 6, 'six difficulty levels');
    await page.check(`input[name=${P}-level][value=easy]`, { force: true });
    await page.click(`#${P}-gen`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
    await page.click(`#${P}-coach-close`).catch(() => {});
    const st = () => page.evaluate(async () => {
      const G = (await import('./modules/star-field/ui.js')).state();
      return { v: [...G.v], s: G.p.solution, n: G.p.size, k: G.p.stars, sel: G.sel, hints: G.hints, solved: G.solved, fp: G.p.fingerprint, undo: G.undo.length };
    });
    let s = await st();
    assert(await page.locator(`#${P}-board [data-i]`).count() === s.n * s.n, 'the board shows every cell');
    assert(await page.locator(`#${P}-board .sf-n`).count() === s.n, 'every region is numbered');
    assert(await page.locator(`#${P}-board .gk-cell.bt`).count() > s.n, 'region borders are drawn');
    assert(/star/i.test(await page.textContent(`#${P}-rules`)), 'the rules are shown');
    assert(/Row 1, column 1, region 1, empty/.test(await page.getAttribute(`#${P}-board [data-i="0"]`, 'aria-label')), 'cells have screen-reader labels');

    // Hints: three levels, then Fill it in.
    for (let i = 0; i < 3; i++) await page.click(`#${P}-hint-btn`);
    assert((await page.textContent(`#${P}-hint`)).trim().length > 20, 'a hint explains the next step');
    await page.click(`#${P}-hint-fill`);
    s = await st();
    assert(s.hints === 1 && s.v.some(Boolean), 'Fill it in marks the hinted cells');
    assert(s.v.every((v, i) => !v || (v === 1) === (s.s[i] === 1)), 'the hinted marks are right');

    // Two touching stars turn red; undo takes them back.
    // (Corner to corner, so the kit's finished-line dots do not get in the way.)
    const starIn = (i) => s.v.some((v, j) => v === 1 && (Math.floor(j / s.n) === Math.floor(i / s.n) || j % s.n === i % s.n));
    const free = [...Array(s.n * (s.n - 1)).keys()].find((i) => !s.v[i] && i % s.n < s.n - 1 && !s.v[i + s.n + 1] && !starIn(i) && !starIn(i + s.n + 1));
    await page.click(`#${P}-board [data-i="${free}"]`);
    await page.click(`#${P}-board [data-i="${free + s.n + 1}"]`);
    assert(await page.locator(`#${P}-board .sf-clash`).count() >= 2, 'stars touching at a corner are shown in red');
    await page.click(`#${P}-undo`);
    await page.click(`#${P}-undo`);
    s = await st();
    assert(!s.v[free] && !s.v[free + s.n + 1], 'undo takes the stars back');
    assert(await page.locator(`#${P}-board .sf-clash`).count() === 0, 'nothing is red after undo');

    // A dot with the cross pen.
    await page.click(`#${P}-pen-cross`);
    const blank = s.s.findIndex((v, i) => v === 2 && !s.v[i]);
    await page.click(`#${P}-board [data-i="${blank}"]`);
    assert((await st()).v[blank] === 2, 'the cross pen places a dot');
    await page.click(`#${P}-pen-fill`);

    // Play to the end: half the stars by keys, half by clicks.
    s = await st();
    const stars = s.s.map((v, i) => (v === 1 && s.v[i] !== 1 ? i : -1)).filter((i) => i >= 0);
    let sel = s.sel;
    for (const [j, i] of stars.entries()) {
      if (j % 2 === 0) {
        await page.focus(`#${P}-board [data-i="${sel}"]`);
        const dr = Math.floor(i / s.n) - Math.floor(sel / s.n), dc = (i % s.n) - (sel % s.n);
        for (let m = 0; m < Math.abs(dr); m++) await page.keyboard.press(dr > 0 ? 'ArrowDown' : 'ArrowUp');
        for (let m = 0; m < Math.abs(dc); m++) await page.keyboard.press(dc > 0 ? 'ArrowRight' : 'ArrowLeft');
        assert((await st()).sel === i, `arrow keys reach row ${Math.floor(i / s.n) + 1}, column ${(i % s.n) + 1}`);
        await page.keyboard.press(' ');
      } else {
        await page.click(`#${P}-board [data-i="${i}"]`);
      }
      sel = i;
    }
    await page.waitForSelector(`#${P}-solved:not([hidden])`, { timeout: 5000 });
    assert((await st()).solved, 'the puzzle is solved');
    assert(/star/i.test(await page.textContent(`#${P}-solved-h`)), 'the solved card has a title');
    await page.click(`#${P}-steps-btn`);
    await page.waitForSelector(`#${P}-steps-dlg[open]`);
    await page.click(`#${P}-step-next`);
    assert(/Step 1 of/.test(await page.textContent(`#${P}-step-n`)), 'the solution replays step by step');
    await page.click(`#${P}-step-end`);
    assert(await page.locator(`#${P}-steps-board .gk-cell.on`).count() === s.n * s.k, 'the replay ends with every star');
    await page.keyboard.press('Escape');
    assert(logs.length >= 1, 'the play record goes to the host');
    const plays = await page.evaluate(async () => (await import('./modules/star-field/ui.js')).learning().plays().length);
    assert(plays === 1, 'the solve leaves one play record');

    // Printing builds a page with the board and an answer key.
    const printed = await page.evaluate(async () => {
      const { printableHtml } = await import('./modules/grid-kit/print.js');
      const { def } = await import('./modules/star-field/game.js');
      const G = (await import('./modules/star-field/ui.js')).state();
      return printableHtml(G, def, { answers: true });
    });
    assert(/table class="sf"/.test(printed) && /★/.test(printed), 'the printed page has the grid and the answer');

    // A second puzzle at the same level is a different one.
    await page.click(`#${P}-home`);
    await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
    assert(await page.locator(`#${P}-saved li`).count() >= 1, 'Saved puzzles lists the game');
    await page.click(`#${P}-gen`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
    assert((await st()).fp !== s.fp, 'the next puzzle is new');

    // Themes: the board draws in each, with tints only outside high contrast.
    s = await st();
    await page.click(`#${P}-board [data-i="${s.s.indexOf(1)}"]`);
    await page.click(`#${P}-pen-cross`);
    await page.click(`#${P}-board [data-i="${s.s.indexOf(2)}"]`);
    for (const theme of ['light', 'dark', 'contrast']) {
      await page.selectOption('#theme', theme);
      await page.waitForTimeout(400);
      const bgs = await page.evaluate(() => [...document.querySelectorAll('#sf-board .gk-cell:not(.sel):not(.peer)')].map((c) => getComputedStyle(c).backgroundColor));
      const kinds = new Set(bgs).size;
      if (theme === 'contrast') assert(kinds === 1, `high contrast: borders only, no tints ${[...new Set(bgs)]}`);
      else assert(kinds >= 3, `${theme}: regions have distinct tints`);
      if (SHOTS) await page.locator('.gk-layout').screenshot({ path: path.join(SHOTS, `sf-${theme}.png`) });
    }
    await page.selectOption('#theme', 'system');

    // Two-star puzzles build and show in the browser too.
    await page.click(`#${P}-new`);
    await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
    await page.check(`input[name=${P}-level][value=expert]`, { force: true });
    await page.click(`#${P}-gen`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 60000 });
    s = await st();
    assert(s.n === 10 && s.k === 2, 'Expert is a 10×10 with two stars each');
    if (SHOTS) await page.locator('.gk-layout').screenshot({ path: path.join(SHOTS, 'sf-expert.png') });
    await page.close();
    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
    console.log('Star Field module: all checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
