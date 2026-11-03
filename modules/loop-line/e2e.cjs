// Loop Line in the private test app: start a puzzle, take a hint, tap, drag
// and use the keys, undo, check that saved and opened puzzles are cleaned,
// print, then play it to the end by tapping edges and check the solved card,
// the solution replay, the play record and Saved puzzles.
// Run: node modules/build-test-app.mjs && node modules/loop-line/e2e.cjs   (PORT=8203 by default)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = process.env.PORT || '8203';
const P = 'll', DIR = 'loop-line';

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', '..', 'scripts', 'serve.mjs'), path.join(__dirname, '..', '..', 'dist', 'module-test'), PORT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
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
    const st = () => page.evaluate(async (dir) => {
      const G = (await import(`./modules/${dir}/ui.js`)).state();
      return { v: [...G.v], s: G.p.solution, hints: G.hints, solved: G.solved, fp: G.p.fingerprint, sel: G.sel, R: G.p.size, C: G.p.cols, undo: G.undo.length };
    }, DIR);
    let s = await st();
    const E = s.s.length;
    assert(await page.locator(`#${P}-board [data-i]`).count() === E, 'the board shows every edge');
    assert(await page.locator(`#${P}-board .ll-dot`).count() === (s.R + 1) * (s.C + 1), 'the board shows every dot');
    assert(/beside|side of row/.test(await page.getAttribute(`#${P}-board [data-i="0"]`, 'aria-label')), 'edges have screen-reader labels');
    assert((await page.textContent(`#${P}-rules`)).trim().length > 20, 'the rules are shown');

    // Hints: three levels.
    for (let i = 0; i < 3; i++) await page.click(`#${P}-hint-btn`);
    assert((await page.textContent(`#${P}-hint`)).trim().length > 10, 'a hint explains the next step');
    assert((await st()).hints >= 1, 'hints are counted');
    await page.click(`#${P}-hint-fill`);
    s = await st();
    assert(s.v.some((v) => v), 'Fill it in marks the hinted edges');
    await page.click(`#${P}-undo`);
    assert((await st()).v.every((v) => !v), 'undo takes the hint back');

    // Tap an edge: a line; undo; redo.
    const box = await page.locator(`#${P}-board`).boundingBox();
    const at = (x, y) => [box.x + ((x + 0.5) / (s.C + 1)) * box.width, box.y + ((y + 0.5) / (s.R + 1)) * box.height];
    await page.click(`#${P}-board [data-i="0"]`);
    assert((await st()).v[0] === 1, 'a tap draws a line');
    await page.click(`#${P}-undo`);
    assert((await st()).v[0] === 0, 'undo takes it back');
    await page.click(`#${P}-redo`);
    assert((await st()).v[0] === 1, 'redo puts it back');
    await page.click(`#${P}-board [data-i="0"]`);
    assert((await st()).v[0] === 0, 'a second tap clears it');

    // Drag from the top-left dot two dots to the right: two lines in one move.
    await page.click(`#${P}-pen-fill`);
    const [x0, y0] = at(0, 0), [x1, y1] = at(1, 0), [x2, y2] = at(2, 0);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up();
    s = await st();
    assert(s.v[0] === 1 && s.v[1] === 1, 'a drag from dot to dot draws every edge it passes');
    const u = s.undo;
    await page.click(`#${P}-undo`);
    s = await st();
    assert(s.v[0] === 0 && s.v[1] === 0 && s.undo === u - 1, 'one undo takes back the whole drag');

    // Cross pen.
    await page.click(`#${P}-pen-cross`);
    await page.click(`#${P}-board [data-i="0"]`);
    assert((await st()).v[0] === 2, 'the Cross pen crosses an edge out');
    await page.click(`#${P}-board [data-i="0"]`);
    await page.click(`#${P}-pen-fill`);

    // Keys: walk right along the top, Space draws, X crosses, Backspace erases, turn down.
    await page.click(`#${P}-board [data-i="0"]`);
    await page.click(`#${P}-board [data-i="0"]`);
    await page.keyboard.press('ArrowRight');
    assert((await st()).sel === 1, 'Right walks on along the top');
    await page.keyboard.press(' ');
    assert((await st()).v[1] === 1, 'Space draws a line');
    await page.keyboard.press('x');
    assert((await st()).v[1] === 2, 'X crosses it out');
    await page.keyboard.press('Backspace');
    assert((await st()).v[1] === 0, 'Backspace erases');
    await page.keyboard.press('ArrowDown');
    const H = (s.R + 1) * s.C, W = s.C + 1;
    assert((await st()).sel === H + 2, 'Down turns at the end of the edge');
    assert(await page.locator(`#${P}-board .ll-dot.anchor`).count() === 1, 'a ring shows where the next turn starts');
    assert(await page.evaluate(() => document.activeElement?.dataset?.i) === String(H + 2), 'focus follows the selected edge');
    await page.keyboard.press('ArrowLeft');
    assert((await st()).sel === 1 * s.C + 1, 'Left turns along the bottom of the cell');

    // Saved and opened puzzles are checked strictly.
    const clean = await page.evaluate(async (dir) => {
      const { def } = await import(`./modules/${dir}/game.js`);
      const G = (await import(`./modules/${dir}/ui.js`)).state();
      const ok = !!def.cleanPuzzle(JSON.parse(JSON.stringify(G.p)));
      const badClue = JSON.parse(JSON.stringify(G.p)); const i = badClue.clues.findIndex((n) => n >= 0); badClue.clues[i] = (badClue.clues[i] + 1) % 4;
      const twoLoops = JSON.parse(JSON.stringify(G.p)); twoLoops.solution = twoLoops.solution.map(() => 2);
      const evil = JSON.parse(JSON.stringify(G.p)); evil.story = { title: '<img src=x onerror=alert(1)>' }; evil.solvePath = [{ marks: [[99999, 1], [0, 7]], why: 'x'.repeat(5000) }];
      const e = def.cleanPuzzle(evil);
      return { ok, badClue: def.cleanPuzzle(badClue), twoLoops: def.cleanPuzzle(twoLoops), evilMarks: e.solvePath[0].marks.length, whyLen: e.solvePath[0].why.length };
    }, DIR);
    assert(clean.ok && clean.badClue === null && clean.twoLoops === null, 'cleanPuzzle keeps good puzzles and refuses wrong numbers or broken loops');
    assert(clean.evilMarks === 0 && clean.whyLen <= 400, 'cleanPuzzle trims untrusted steps');

    // Printing builds a page with the board and an answer key.
    const html = await page.evaluate(async (dir) => {
      const { printableHtml } = await import('./modules/grid-kit/print.js');
      const { def } = await import(`./modules/${dir}/game.js`);
      return printableHtml((await import(`./modules/${dir}/ui.js`)).state(), def, { answers: true, steps: true });
    }, DIR);
    assert((html.match(/<svg class="ll"/g) || []).length === 2 && /Answer key/.test(html) && /Step by step/.test(html), 'print has the puzzle, the answer key and the steps');

    // Themes: the board still draws in dark and high contrast.
    for (const t of ['dark', 'contrast', 'light']) await page.selectOption('#theme', t);
    const lineColor = await page.evaluate(() => getComputedStyle(document.querySelector('#ll-board [data-i]'), '::before').backgroundColor);
    assert(!!lineColor, 'edges have a color in every theme');

    // Play to the end by tapping every edge of the loop.
    s = await st();
    for (let i = 0; i < E; i++) {
      if (s.s[i] === 1 && s.v[i] !== 1) await page.click(`#${P}-board [data-i="${i}"]`);
      else if (s.s[i] === 2 && s.v[i] === 1) await page.click(`#${P}-board [data-i="${i}"]`);
      if (await page.locator(`#${P}-solved:not([hidden])`).count()) break;
    }
    await page.waitForSelector(`#${P}-solved:not([hidden])`, { timeout: 5000 });
    assert((await st()).solved, 'the puzzle is solved');
    assert((await page.textContent(`#${P}-solved-h`)).trim().length > 3, 'the solved card has a title');
    await page.click(`#${P}-steps-btn`);
    await page.waitForSelector(`#${P}-steps-dlg[open]`);
    await page.click(`#${P}-step-next`);
    assert(/Step 1 of/.test(await page.textContent(`#${P}-step-n`)), 'the solution replays step by step');
    assert(await page.locator(`#${P}-steps-board [data-v="1"], #${P}-steps-board [data-v="2"]`).count() > 0, 'the replay board shows the step');
    await page.keyboard.press('Escape');
    assert(logs.length >= 1, 'the play record goes to the host');
    assert(await page.evaluate(async (dir) => (await import(`./modules/${dir}/ui.js`)).learning().plays().length, DIR) === 1, 'the solve leaves one play record');

    await page.click(`#${P}-home`);
    await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
    assert(await page.locator(`#${P}-saved li`).count() >= 1, 'Saved puzzles lists the game');
    const fp = s.fp;
    await page.click(`#${P}-gen`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
    assert((await st()).fp !== fp, 'the next puzzle is new');
    // A puzzle in progress comes back exactly as it was left.
    await page.locator(`#${P}-board [data-i="0"]`).focus();
    await page.keyboard.press(' ');
    const before = (await st()).v;
    await page.click(`#${P}-new`);
    await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
    await page.click(`#${P}-continue`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`);
    assert(JSON.stringify((await st()).v) === JSON.stringify(before) && before.some((v) => v), 'Continue brings back the saved marks');
    await page.click(`#${P}-reveal`);
    await page.click(`#${P}-reveal-yes`);
    assert(/answer/i.test(await page.textContent(`#${P}-solved-h`)), 'Show the answer draws the loop');
    await page.close();
    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
    console.log('Loop Line module: all checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
