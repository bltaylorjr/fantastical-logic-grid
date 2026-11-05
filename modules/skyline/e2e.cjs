// Skyline in the private test app: start a puzzle, check the edge numbers
// are drawn and read out, take a hint and fill it in, undo, play to the end with
// the keyboard only, check the solved card, the step-by-step replay, the play
// record, Saved puzzles and that the next puzzle is new.
// Run: node modules/build-test-app.mjs && node modules/skyline/e2e.cjs
// (the test app must list the game; see modules/README.md). Port 8201.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const story = require('../grid-kit/e2e-story.cjs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = Number(process.env.PORT) || 8201, P = 'sk', DIR = 'skyline', NAME = 'Skyline';

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
      await page.waitForSelector(`#${P}-setup-view:not([hidden]) #${P}-levels .choice`);
      // Story themes and moments: Mystery with moments (and two past give-ups,
      // so the solved card offers a gentler level), then moments off, then Farm Life.
      const opt = { light: { theme: 'mystery', moments: true, next: 'basic' }, dark: { theme: 'surprise', moments: false }, contrast: { theme: 'farm', moments: true } }[theme];
      const seeded = opt.next ? await story.seed(page, P, 'easy', { outcome: 'revealed' }) : 0;
      await page.selectOption('#theme', theme);
      assert(await page.locator(`input[name=${P}-level]`).count() === 6, `${NAME} (${theme}): six difficulty levels`);
      await page.check(`input[name=${P}-level][value=${theme === 'light' ? 'easy' : 'basic'}]`, { force: true });
      await story.pick(page, P, opt.theme, opt.moments);
      await page.click(`#${P}-gen`);
      await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
      await page.click(`#${P}-coach-close`).catch(() => {});
      await story.watch(page, P);
      const st = () => page.evaluate(async (dir) => {
        const G = (await import(`./modules/${dir}/ui.js`)).state();
        return { v: [...G.v], s: G.p.solution, gv: G.p.givens, n: G.p.size, clues: ['top', 'bottom', 'left', 'right'].reduce((n, k) => n + G.p.clues[k].filter(Boolean).length, 0), hints: G.hints, solved: G.solved, fp: G.p.fingerprint };
      }, DIR);
      let s = await st();
      assert(await page.locator(`#${P}-board [data-i]`).count() === s.s.length, `${NAME}: the board shows every cell`);
      const shown = await page.$$eval(`#${P}-board .sk-clue`, (els) => els.filter((e) => e.textContent.trim()).length);
      assert(await page.locator(`#${P}-board .sk-clue`).count() === 4 * s.n && shown === s.clues && s.clues > 0, `${NAME}: every edge number is drawn around the grid`);
      const labels = await page.$$eval(`#${P}-board [data-i]`, (els) => els.map((e) => e.getAttribute('aria-label')));
      assert(labels.some((l) => /shows \d from the (top|bottom|left|right)/.test(l)), `${NAME}: cell labels read out the edge numbers`);
      const box = await page.evaluate((id) => { const b = document.querySelector(`#${id}-board`).getBoundingClientRect(); const g = document.querySelector(`#${id}-board .sk-cells`).getBoundingClientRect(); const k = document.querySelector(`#${id}-board .sk-top .sk-clue`).getBoundingClientRect(); return { inside: g.left > b.left && g.top > b.top && g.right < b.right && g.bottom < b.bottom, above: k.bottom <= g.top + 1 }; }, P);
      assert(box.inside && box.above, `${NAME}: the edge numbers sit outside the grid`);
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
      await story.solved(page, P, DIR, { theme: opt.theme === 'surprise' ? null : opt.theme, moments: opt.moments, next: opt.next }, assert);
      await page.click(`#${P}-steps-btn`);
      await page.waitForSelector(`#${P}-steps-dlg[open]`);
      await page.click(`#${P}-step-next`);
      assert(/Step 1 of/.test(await page.textContent(`#${P}-step-n`)), `${NAME}: the solution replays step by step`);
      assert(await page.locator(`#${P}-steps-board .sk-clue`).count() === 4 * s.n, `${NAME}: the replay board shows the edge numbers`);
      assert(await page.locator(`#${P}-board .sk-clue.done`).count() === s.clues, `${NAME}: every edge number fades once its view is right`);
      await page.keyboard.press('Escape');
      assert(logs.length >= 1, `${NAME}: the play record goes to the host`);
      const plays = await page.evaluate(async (dir) => (await import(`./modules/${dir}/ui.js`)).learning().plays().length, DIR);
      assert(plays === 1 + seeded, `${NAME}: the solve leaves one play record`);

      // Printing draws the edge numbers too.
      const printed = await page.evaluate(async () => {
        const { printableHtml } = await import('./modules/grid-kit/print.js');
        const { def } = await import('./modules/skyline/game.js');
        const G = (await import('./modules/skyline/ui.js')).state();
        return printableHtml(G, def, { answers: true });
      });
      assert(/table class="sk n\d"/.test(printed) && /<td class="k">\d<\/td>/.test(printed), `${NAME}: the printed page has the grid and its edge numbers`);

      await page.click(`#${P}-home`);
      await page.waitForSelector(`#${P}-setup-view:not([hidden])`);
      assert(await page.locator(`#${P}-saved li`).count() >= 1, `${NAME}: Saved puzzles lists the game`);
      await page.click(`#${P}-gen`);
      await page.waitForSelector(`#${P}-play-view:not([hidden])`, { timeout: 30000 });
      assert((await st()).fp !== s.fp, `${NAME}: the next puzzle is new`);
      if (opt.next) await story.race(page, P, DIR, assert);
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

