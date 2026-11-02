// Cage Math, Sum Cross and Picture Grid in the private test app: start a
// puzzle, take a hint, undo, play it to the end with clicks and keys, check the
// solved card and play record, and find the game again in Saved puzzles.
// Run: node modules/build-test-app.mjs && node modules/grid-kit/e2e.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const GAMES = [
  { id: 'cm', dir: 'cage-math', name: 'Cage Math', level: 'easy' },
  { id: 'sc', dir: 'sum-cross', name: 'Sum Cross', level: 'easy' },
  { id: 'pg', dir: 'picture-grid', name: 'Picture Grid', level: 'easy' },
];

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', '..', 'scripts', 'serve.mjs'), path.join(__dirname, '..', '..', 'dist', 'module-test'), '8143'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const g of GAMES) {
      const P = g.id;
      const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
      page.on('pageerror', (e) => errors.push(`${P}: ${e}`));
      const logs = [];
      page.on('console', (m) => { if (/play record/.test(m.text())) logs.push(m.text()); });
      await page.goto(`http://localhost:8143/?game=${P}`);
      await page.waitForSelector(`#${P}-setup-view:not([hidden]) #${P}-levels .choice`);
      assert(await page.locator(`input[name=${P}-level]`).count() === 6, `${g.name}: six difficulty levels`);
      await page.check(`input[name=${P}-level][value=${g.level}]`, { force: true });
      await page.click(`#${P}-gen`);
      await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
      await page.click(`#${P}-coach-close`).catch(() => {});
      const st = () => page.evaluate(async (dir) => {
        const G = (await import(`./modules/${dir}/ui.js`)).state();
        return { v: [...G.v], s: G.p.solution, gv: G.p.givens, hints: G.hints, solved: G.solved, fp: G.p.fingerprint };
      }, g.dir);
      let s = await st();
      const playable = s.s.filter((d) => (P === 'sc' ? d > 0 : true)).length;
      assert(await page.locator(`#${P}-board [data-i]`).count() >= playable, `${g.name}: the board shows every cell`);
      assert((await page.textContent(`#${P}-rules`)).trim().length > 20, `${g.name}: the rules are shown`);

      // Hints: three levels, the last one says what goes where.
      for (let i = 0; i < 3; i++) await page.click(`#${P}-hint-btn`);
      assert((await page.textContent(`#${P}-hint`)).trim().length > 10, `${g.name}: a hint explains the next step`);
      s = await st();
      assert(s.hints >= 1, `${g.name}: hints are counted`);

      // Undo takes back a move.
      const first = s.s.findIndex((d, i) => (P === 'pg' ? d === 1 : d) && !s.gv[i] && !s.v[i]);
      await page.click(`#${P}-board [data-i="${first}"]`);
      if (P !== 'pg') await page.keyboard.press(String(s.s[first]));
      assert((await st()).v[first], `${g.name}: a move goes in`);
      await page.click(`#${P}-undo`);
      assert(!(await st()).v[first], `${g.name}: undo takes it back`);

      // Play to the end.
      s = await st();
      for (let i = 0; i < s.s.length; i++) {
        if (s.gv[i]) continue;
        if (P === 'pg') { if (s.s[i] === 1 && s.v[i] !== 1) await page.click(`#${P}-board [data-i="${i}"]`); }
        else if (s.s[i] && s.v[i] !== s.s[i]) { await page.click(`#${P}-board [data-i="${i}"]`); await page.keyboard.press(String(s.s[i])); }
      }
      await page.waitForSelector(`#${P}-solved:not([hidden])`, { timeout: 5000 });
      assert((await st()).solved, `${g.name}: the puzzle is solved`);
      assert((await page.textContent(`#${P}-solved-h`)).trim().length > 3, `${g.name}: the solved card has a title`);
      if (P === 'pg') assert(/It's|picture/i.test(await page.textContent(`#${P}-solved`)), 'Picture Grid: the solved card names the picture');
      await page.click(`#${P}-steps-btn`);
      await page.waitForSelector(`#${P}-steps-dlg[open]`);
      await page.click(`#${P}-step-next`);
      assert(/Step 1 of/.test(await page.textContent(`#${P}-step-n`)), `${g.name}: the solution replays step by step`);
      await page.keyboard.press('Escape');
      assert(logs.length >= 1, `${g.name}: the play record goes to the host for the learning service`);
      const plays = await page.evaluate(async (dir) => (await import(`./modules/${dir}/ui.js`)).learning().plays().length, g.dir);
      assert(plays === 1, `${g.name}: the solve leaves one play record`);

      // A second puzzle at the same level is a different one.
      await page.click(`#${P}-home`);
      await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
      assert(await page.locator(`#${P}-saved li`).count() >= 1, `${g.name}: Saved puzzles lists the game`);
      await page.click(`#${P}-gen`);
      await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
      assert((await st()).fp !== s.fp, `${g.name}: the next puzzle is new`);
      await page.close();
    }
    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
    console.log('Cage Math, Sum Cross and Picture Grid modules: all checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
