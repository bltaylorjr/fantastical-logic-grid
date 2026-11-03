// Island Bridges in the private test app: start a puzzle, take a hint, tap,
// drag and use the keys, undo, check that saved and opened puzzles are
// cleaned, print, then play it to the end by tapping and check the solved
// card, the solution replay, the play record and Saved puzzles.
// Run: node modules/build-test-app.mjs && node modules/island-bridges/e2e.cjs   (PORT=8203 by default)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const story = require('../grid-kit/e2e-story.cjs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = process.env.PORT || '8203';
const P = 'ib', DIR = 'island-bridges';

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
    // Two past give-ups at Easy, so the solved card offers a gentler level; a story theme with moments.
    const seeded = await story.seed(page, P, 'easy', { outcome: 'revealed' });
    await page.check(`input[name=${P}-level][value=easy]`, { force: true });
    await story.pick(page, P, 'nautical', true);
    await page.click(`#${P}-gen`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
    await page.click(`#${P}-coach-close`).catch(() => {});
    await story.watch(page, P);
    const st = () => page.evaluate(async (dir) => {
      const G = (await import(`./modules/${dir}/ui.js`)).state();
      return { v: [...G.v], s: G.p.solution, hints: G.hints, solved: G.solved, fp: G.p.fingerprint, sel: G.sel, links: G.p.links, islands: G.p.islands, R: G.p.size, C: G.p.cols };
    }, DIR);
    let s = await st();
    const L = s.s.length;
    assert(await page.locator(`#${P}-board [data-i]`).count() === L, 'the board shows every gap between islands');
    assert(await page.locator(`#${P}-board .ib-isl`).count() === s.islands.length, 'the board shows every island');
    assert(/^From the \d at row/.test(await page.getAttribute(`#${P}-board [data-i="0"]`, 'aria-label')), 'gaps have screen-reader labels');

    // A point on the board where a tap reaches link e (not on an island or a crossing).
    const box = await page.locator(`#${P}-board`).boundingBox();
    const pointFor = (e) => page.evaluate(async ([dir, e]) => {
      const { def } = await import(`./modules/${dir}/game.js`);
      const p = (await import(`./modules/${dir}/ui.js`)).state().p;
      const l = p.links[e], A = p.islands[l.a], B = p.islands[l.b];
      for (const t of [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]) {
        const x = A.c + (B.c - A.c) * t, y = A.r + (B.r - A.r) * t;
        const fx = (x + 0.5) / p.cols, fy = (y + 0.5) / p.size;
        if (def.hit(p, fx, fy).edge === e) return [fx, fy];
      }
      return null;
    }, [DIR, e]);
    const tap = async (e) => { const [fx, fy] = await pointFor(e); await page.mouse.click(box.x + fx * box.width, box.y + fy * box.height); };

    // Hints.
    for (let i = 0; i < 3; i++) await page.click(`#${P}-hint-btn`);
    assert((await page.textContent(`#${P}-hint`)).trim().length > 10, 'a hint explains the next step');
    assert((await st()).hints >= 1, 'hints are counted');
    await page.click(`#${P}-hint-fill`);
    assert((await st()).v.some((v) => v), 'Fill it in builds the hinted bridges');
    await page.click(`#${P}-undo`);
    assert((await st()).v.every((v) => !v), 'undo takes the hint back');

    // Taps cycle 1, 2, none.
    await tap(0);
    assert((await st()).v[0] === 1, 'a tap builds one bridge');
    await tap(0);
    assert((await st()).v[0] === 2, 'a second tap makes it double');
    await tap(0);
    assert((await st()).v[0] === 0, 'a third tap clears it');
    await tap(0);
    await page.click(`#${P}-undo`);
    assert((await st()).v[0] === 0, 'undo takes it back');

    // Drag from one island to its neighbour.
    const l = s.links[0], A = s.islands[l.a], B = s.islands[l.b];
    const xy = (isl) => [box.x + ((isl.c + 0.5) / s.C) * box.width, box.y + ((isl.r + 0.5) / s.R) * box.height];
    await page.mouse.move(...xy(A)); await page.mouse.down(); await page.mouse.move(...xy(B), { steps: 8 }); await page.mouse.up();
    assert((await st()).v[0] === 1, 'a drag from island to island builds a bridge');
    await page.click(`#${P}-undo`);

    // Cross pen.
    await page.click(`#${P}-pen-cross`);
    await tap(0);
    assert((await st()).v[0] === 3, 'the Cross pen crosses a gap out');
    await tap(0);
    await page.click(`#${P}-pen-fill`);

    // Keys: pick the island's bridges with arrows, Space adds, X crosses.
    await tap(0); await page.click(`#${P}-undo`);
    await page.locator(`#${P}-board [data-i="0"]`).focus();
    const dirOf = (k, from) => (k.dir === 'h' ? (k.a === from ? 'ArrowRight' : 'ArrowLeft') : (k.a === from ? 'ArrowDown' : 'ArrowUp'));
    s = await st();
    const first = s.sel;
    await page.keyboard.press(' ');
    assert((await st()).v[first] === 1, 'Space adds a bridge');
    await page.keyboard.press(' ');
    assert((await st()).v[first] === 2, 'Space again makes it double');
    await page.keyboard.press('x');
    assert((await st()).v[first] === 3, 'X crosses it out');
    await page.keyboard.press('Backspace');
    assert((await st()).v[first] === 0, 'Backspace erases');
    // The same arrow as the selected bridge moves on to the island at its other end.
    const k0 = s.links[first];
    await page.keyboard.press(dirOf(k0, k0.a));
    s = await st();
    const ring = await page.evaluate(() => Number(document.querySelector('#ib-board .ib-isl.anchor')?.dataset.isl));
    assert(ring === k0.b, 'the same arrow again moves the ring to the next island');
    assert(s.links[s.sel].a === k0.b || s.links[s.sel].b === k0.b, 'the selected bridge belongs to the ringed island');
    assert(await page.evaluate(() => document.activeElement?.closest?.('#ib-board') !== null), 'focus stays on the board');

    // Saved and opened puzzles are checked strictly.
    const clean = await page.evaluate(async (dir) => {
      const { def } = await import(`./modules/${dir}/game.js`);
      const G = (await import(`./modules/${dir}/ui.js`)).state();
      const ok = !!def.cleanPuzzle(JSON.parse(JSON.stringify(G.p)));
      const wrongN = JSON.parse(JSON.stringify(G.p)); wrongN.islands[0].n = wrongN.islands[0].n === 8 ? 7 : wrongN.islands[0].n + 1;
      const none = JSON.parse(JSON.stringify(G.p)); none.solution = none.solution.map(() => 3);
      const outside = JSON.parse(JSON.stringify(G.p)); outside.islands[0].r = 99;
      return { ok, wrongN: def.cleanPuzzle(wrongN), none: def.cleanPuzzle(none), outside: def.cleanPuzzle(outside) };
    }, DIR);
    assert(clean.ok && clean.wrongN === null && clean.none === null && clean.outside === null, 'cleanPuzzle keeps good puzzles and refuses broken ones');

    const html = await page.evaluate(async (dir) => {
      const { printableHtml } = await import('./modules/grid-kit/print.js');
      const { def } = await import(`./modules/${dir}/game.js`);
      return printableHtml((await import(`./modules/${dir}/ui.js`)).state(), def, { answers: true, steps: true });
    }, DIR);
    assert((html.match(/<svg class="ib"/g) || []).length === 2 && /Answer key/.test(html), 'print has the puzzle and the answer key');
    for (const t of ['dark', 'contrast', 'light']) await page.selectOption('#theme', t);

    // Play to the end by tapping.
    s = await st();
    for (let e = 0; e < L; e++) {
      if (await page.locator(`#${P}-solved:not([hidden])`).count()) break;
      const cur = (await st()).v[e];
      const want = s.s[e] === 3 ? 0 : s.s[e];
      let v = cur === 3 ? 0 : cur;
      if (want === 0 && cur !== 3 && cur !== 0) { while (v !== 0) { await tap(e); v = (await st()).v[e]; } continue; }
      for (let n = 0; n < 3 && v !== want; n++) { await tap(e); v = (await st()).v[e]; if (v === 3) v = 0; }
    }
    await page.waitForSelector(`#${P}-solved:not([hidden])`, { timeout: 5000 });
    assert((await st()).solved, 'the puzzle is solved');
    await story.solved(page, P, DIR, { theme: 'nautical', moments: true, next: 'basic' }, assert);
    await page.click(`#${P}-steps-btn`);
    await page.waitForSelector(`#${P}-steps-dlg[open]`);
    await page.click(`#${P}-step-end`);
    assert(await page.locator(`#${P}-steps-board [data-v="1"], #${P}-steps-board [data-v="2"]`).count() > 0, 'the solution replays to the end');
    await page.keyboard.press('Escape');
    assert(logs.length >= 1, 'the play record goes to the host');

    await page.click(`#${P}-home`);
    await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
    assert(await page.locator(`#${P}-saved li`).count() >= 1, 'Saved puzzles lists the game');
    await page.click(`#${P}-gen`);
    await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
    assert((await st()).fp !== s.fp, 'the next puzzle is new');
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
    assert(/answer/i.test(await page.textContent(`#${P}-solved-h`)), 'Show the answer builds every bridge');
    await story.race(page, P, DIR, assert);
    await page.close();
    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
    console.log('Island Bridges module: all checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
