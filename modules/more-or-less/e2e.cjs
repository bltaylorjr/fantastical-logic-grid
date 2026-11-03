// More or Less in the private test app: start a puzzle, check the signs are
// drawn and read out, take a hint and fill it in, undo, play to the end with
// the keyboard only, check the solved card, the step-by-step replay, the play
// record, Saved puzzles and that the next puzzle is new.
// Run: node modules/build-test-app.mjs && node modules/more-or-less/e2e.cjs
// (the test app must list the game; see modules/README.md). Port 8201.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = 8201, P = 'ml', DIR = 'more-or-less', NAME = 'More or Less';

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', '..', 'scripts', 'serve.mjs'), path.join(__dirname, '..', '..', 'dist', 'module-test'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const theme of ['light', 'dark', 'contrast']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
      page.on('pageerror', (e) => errors.push(`${theme}: ${e}`));
      const logs = [];
      page.on('console', (m) => { if (/play record/.test(m.text())) logs.push(m.text()); });
      await page.goto(`http://localhost:${PORT}/?game=${P}`);
      await page.selectOption('#theme', theme);
      await page.waitForSelector(`#${P}-setup-view:not([hidden]) #${P}-levels .choice`);
      assert(await page.locator(`input[name=${P}-level]`).count() === 6, `${NAME} (${theme}): six difficulty levels`);
      await page.check(`input[name=${P}-level][value=${theme === 'light' ? 'easy' : 'basic'}]`, { force: true });
      await page.click(`#${P}-gen`);
      await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
      await page.click(`#${P}-coach-close`).catch(() => {});
      const st = () => page.evaluate(async (dir) => {
        const G = (await import(`./modules/${dir}/ui.js`)).state();
        return { v: [...G.v], s: G.p.solution, gv: G.p.givens, n: G.p.size, signs: G.p.signs.length, hints: G.hints, solved: G.solved, fp: G.p.fingerprint };
      }, DIR);
      let s = await st();
      assert(await page.locator(`#${P}-board [data-i]`).count() === s.s.length, `${NAME}: the board shows every cell`);
      assert(await page.locator(`#${P}-board .ml-sign`).count() === s.signs && s.signs > 0, `${NAME}: every sign is drawn`);
      const labels = await page.$$eval(`#${P}-board [data-i]`, (els) => els.map((e) => e.getAttribute('aria-label')));
      assert(labels.some((l) => /(less|more) than the cell (to the (right|left)|above|below)/.test(l)), `${NAME}: cell labels say which way the signs point`);
      // The sign is readable: dark text on its own background, not hidden behind the next cell.
      const sign = await page.$eval(`#${P}-board .ml-sign`, (e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { w: r.width, onTop: top === e || e.contains(top) || top?.closest('.gk-cell') === e.parentElement }; });
      assert(sign.w > 8 && sign.onTop, `${NAME}: signs are big enough to read and sit on top of the cells`);
      assert((await page.textContent(`#${P}-rules`)).trim().length > 20, `${NAME}: the rules are shown`);

      // Hints: three levels, then Fill it in places the right number.
      for (let i = 0; i < 3; i++) { await page.click(`#${P}-hint-btn`); await page.waitForSelector(`#${P}-hint:not([hidden])`); }
      assert((await page.textContent(`#${P}-hint`)).trim().length > 10, `${NAME}: a hint explains the next step`);
      await page.click(`#${P}-hint-fill`);
      s = await st();
      assert(s.hints >= 1 && s.v.some((d, i) => d && d === s.s[i]), `${NAME}: Fill it in places a right number`);

      // Undo takes back a move.
      const first = s.s.findIndex((d, i) => !s.gv[i] && !s.v[i]);
      await page.click(`#${P}-board [data-i="${first}"]`);
      await page.keyboard.press(String(s.s[first]));
      assert((await st()).v[first] === s.s[first], `${NAME}: a move goes in`);
      await page.click(`#${P}-undo`);
      assert(!(await st()).v[first], `${NAME}: undo takes it back`);

      // A wrong number is caught by the next hint.
      await page.click(`#${P}-board [data-i="${first}"]`);
      await page.keyboard.press(String((s.s[first] % s.n) + 1));
      await page.click(`#${P}-hint-btn`);
      await page.waitForFunction((id) => /not fit/.test(document.querySelector(`#${id}-hint`)?.textContent || ''), P, { timeout: 5000 }).catch(() => {});
      assert(/not fit/.test(await page.textContent(`#${P}-hint`)), `${NAME}: a wrong number gets a mistake hint`);
      await page.click(`#${P}-hint-close`);
      await page.keyboard.press('Backspace');

      // Play to the end with the keyboard only: a snake of arrow keys from the top-left cell.
      s = await st();
      await page.click(`#${P}-board [data-i="0"]`);
      for (let r = 0; r < s.n; r++) {
        for (let k = 0; k < s.n; k++) {
          const c = r % 2 ? s.n - 1 - k : k, i = r * s.n + c;
          if (!s.gv[i] && s.v[i] !== s.s[i]) await page.keyboard.press(String(s.s[i]));
          if (k < s.n - 1) await page.keyboard.press(r % 2 ? 'ArrowLeft' : 'ArrowRight');
        }
        if (r < s.n - 1) await page.keyboard.press('ArrowDown');
      }
      await page.waitForSelector(`#${P}-solved:not([hidden])`, { timeout: 5000 });
      assert((await st()).solved, `${NAME}: the puzzle is solved by keyboard`);
      assert((await page.textContent(`#${P}-solved-h`)).trim().length > 3, `${NAME}: the solved card has a title`);
      await page.click(`#${P}-steps-btn`);
      await page.waitForSelector(`#${P}-steps-dlg[open]`);
      await page.click(`#${P}-step-next`);
      assert(/Step 1 of/.test(await page.textContent(`#${P}-step-n`)), `${NAME}: the solution replays step by step`);
      assert(await page.locator(`#${P}-steps-board .ml-sign`).count() === s.signs, `${NAME}: the replay board shows the signs`);
      await page.keyboard.press('Escape');
      assert(logs.length >= 1, `${NAME}: the play record goes to the host`);
      const plays = await page.evaluate(async (dir) => (await import(`./modules/${dir}/ui.js`)).learning().plays().length, DIR);
      assert(plays === 1, `${NAME}: the solve leaves one play record`);

      // Printing draws the signs too.
      const printed = await page.evaluate(async () => {
        const { printableHtml } = await import('./modules/grid-kit/print.js');
        const { def } = await import('./modules/more-or-less/game.js');
        const G = (await import('./modules/more-or-less/ui.js')).state();
        return printableHtml(G, def, { answers: true });
      });
      assert(/table class="ml n\d"/.test(printed) && /&lt;|&gt;/.test(printed), `${NAME}: the printed page has the grid and its signs`);

      await page.click(`#${P}-home`);
      await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
      assert(await page.locator(`#${P}-saved li`).count() >= 1, `${NAME}: Saved puzzles lists the game`);
      await page.click(`#${P}-gen`);
      await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
      assert((await st()).fp !== s.fp, `${NAME}: the next puzzle is new`);
      await page.close();
    }
    assert(errors.length === 0, `no page errors ${errors.join(' | ')}`);
    console.log(`${NAME}: all checks passed`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();

