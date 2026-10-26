// End-to-end check of Learn to solve: offered to first-time players, every
// lesson played through on its grid (by mouse and keyboard), wrong marks,
// Show me, Undo, Hint and Check on the solo puzzle, the tips page, Silent
// mode, that nothing is saved or uses up a story, and that the page
// translates in another language. The game's server is stood in for: it
// "translates" by adding a marker.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
// A localhost address: test builds' content policy allows localhost (scripts/build.mjs).
const API = 'http://localhost:8157';

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8156'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', authUrl: '', tokenUrl: '', siteUrl: '', appVersion: 'test' };
export const cloudEnabled = () => false;
export const CLOUD_URL = CLOUD.learnUrl;` }));
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  await ctx.route(`${API}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, GET' } });
    const url = new URL(req.url());
    if (url.pathname === '/v1/translate') {
      const body = JSON.parse(req.postData());
      return r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ texts: body.texts.map((t) => `‹${body.to}› ${t}`) }) });
    }
    if (url.pathname === '/v1/config') return r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ announcements: [], disabledThemes: [], features: { translate: true } }) });
    return r.fulfill({ status: 204, headers: cors, body: '' });
  });
  await ctx.addInitScript(() => { try { delete self.Translator; } catch (e) { /* not there */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  const T = () => page.evaluate(() => { const t = window.__flg.tutorial; return t && { li: t.li, si: t.si, done: t.done, marks: Object.fromEntries(t.marks), wrong: [...t.wrong] }; });
  const keyOf = (a, b) => page.evaluate(({ a, b }) => {
    const t = window.__flg.tutorial; const id = (l) => t.ix.cats.flatMap((c) => c.items).find((i) => i.label === l).id;
    return t.ix.key(id(a), id(b));
  }, { a, b });
  async function mark(text) {
    const [v, a, b] = text.split(' ');
    const k = await keyOf(a, b);
    const cur = (await T()).marks[k] || '';
    const order = ['', 'X', 'O'];
    const clicks = (order.indexOf(v) - order.indexOf(cur) + 3) % 3;
    for (let i = 0; i < clicks; i++) await page.click(`#learn-grid td[data-k="${k}"]`);
  }
  const step = () => page.evaluate(() => { const t = window.__flg.tutorial; return t.lesson.steps[t.si]; });
  const nextDisabled = () => page.isDisabled('#step-next');

  try {
    await page.goto('http://localhost:8156/');
    await page.waitForSelector('#dlg-welcome[open]');
    assert(await page.isVisible('#welcome-learn'), 'first-time players are offered Learn to solve');
    assert(await page.evaluate(() => document.activeElement.id) === 'welcome-learn', 'Learn to solve has the focus in the welcome window');
    await page.click('#welcome-learn');
    await page.waitForSelector('#screen-learn:not([hidden]) #learn-lesson:not([hidden])');
    assert(await page.isHidden('#screen-home') && await page.isHidden('#screen-play'), 'the tutorial has its own screen');
    assert((await page.textContent('#lesson-h')) === 'Your first grid', 'lesson 1 opens');
    assert(await page.evaluate(() => document.activeElement.id) === 'lesson-h', 'focus moves to the lesson heading');
    assert(await page.locator('#learn-grid table[role=grid]').count() === 1, 'the lesson has a real grid');

    // Lesson 1, by hand: the intro steps, then a mistake, then the marks.
    let lessonsSeen = 0;
    let usedKeyboard = false, usedShowMe = false, usedUndo = false;
    while (true) {
      const s = await step();
      const t = await T();
      if (s.expect) {
        assert(await nextDisabled(), `${t.li + 1}.${t.si + 1} "${s.title}": Next waits for the marks`);
        if (!usedUndo && t.li === 0) {
          // A wrong mark is flagged and explained; Undo takes it back.
          const [, a, b] = s.expect[0].split(' ');
          const wrongV = s.expect[0][0] === 'O' ? 'X' : 'O';
          await mark(`${wrongV} ${a} ${b}`);
          assert((await T()).wrong.length === 1, 'a wrong mark is flagged');
          assert(/Not quite/.test(await page.textContent('#step-feedback')), 'and explained');
          await page.click('#learn-undo');
          assert((await T()).wrong.length === 0, 'Undo takes it back');
          usedUndo = true;
        }
        if (!usedKeyboard && s.expect[0].startsWith('O')) {
          const [, a, b] = s.expect[0].split(' ');
          const k = await keyOf(a, b);
          await page.focus(`#learn-grid td[data-k="${k}"]`);
          await page.keyboard.press('o');
          usedKeyboard = true;
          assert((await T()).marks[k] === 'O', 'the O key marks a square');
        }
        if (t.li === 2 && !usedShowMe) {
          await page.click('#step-show');
          usedShowMe = true;
          assert((await T()).done, 'Show me places the marks');
        } else {
          for (const m of s.expect) await mark(m);
        }
        assert((await T()).done && !(await nextDisabled()), `${t.li + 1}.${t.si + 1} "${s.title}": the step is finished`);
        assert(/Well done/.test(await page.textContent('#step-feedback')), 'the player is told the step is done');
      } else if (s.free) {
        assert(await page.isVisible('#learn-hint-btn') && await page.isVisible('#learn-check'), 'the solo puzzle has Hint and Check');
        await page.click('#learn-hint-btn');
        await page.waitForSelector('#learn-hint:not([hidden])');
        assert(/Hint 1 of 3/.test(await page.textContent('#learn-hint')), 'Hint starts with a nudge');
        await page.click('#learn-hint-more');
        await page.waitForFunction(() => /Hint 2 of 3/.test(document.querySelector('#learn-hint').textContent));
        assert(await page.locator('#learn-grid td.target').count() > 0, 'the next hint points at a square');
        await mark('O Ava Cat'); // wrong: Cleo brought the Cat
        assert((await T()).wrong.length === 0, 'mistakes are not flagged until Check in the solo puzzle');
        await page.click('#learn-check');
        assert((await T()).wrong.length === 1 && /1 mark is wrong/.test(await page.textContent('#step-feedback')), 'Check finds the wrong mark');
        await page.click('#learn-undo');
        const sol = await page.evaluate(() => { const t = window.__flg.tutorial; return t.puzzle.solution.map((r) => Object.values(r).map((id) => t.ix.label(id))); });
        for (const [a, b, c] of sol) { await mark(`O ${a} ${b}`); await mark(`O ${a} ${c}`); await mark(`O ${c} ${b}`); }
        assert((await T()).done && !(await nextDisabled()), 'the solo puzzle can be solved');
        assert(/Solved/.test(await page.textContent('#step-feedback')), 'and says so');
      }
      const last = t.si === (await page.evaluate(() => window.__flg.tutorial.lesson.steps.length)) - 1;
      if (last) {
        lessonsSeen++;
        if (t.li === 4) break;
        assert((await page.textContent('#step-next')) === 'Next lesson', `lesson ${t.li + 1} ends with Next lesson`);
      }
      await page.click('#step-next');
      if (last) await page.waitForFunction((li) => window.__flg.tutorial.li === li + 1, t.li);
    }
    assert(lessonsSeen === 5, 'all 5 lessons play through');
    assert((await page.textContent('#step-next')) === 'Play a Basic puzzle', 'the last lesson leads to a Basic puzzle');

    // Back on the overview every lesson is done; nothing was saved.
    await page.click('#learn-back');
    assert(await page.locator('#lesson-list li.done').count() === 5, 'the lesson list shows all 5 done');
    const kept = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      return { saves: (await store.listSaves()).length, used: (await store.getMeta('usedStories', [])).length };
    });
    assert(kept.saves === 0 && kept.used === 0, 'the tutorial saves nothing and uses up no story');

    // Back step rebuilds the board.
    await page.click('#lesson-list button[data-lesson="1"]');
    await page.click('#step-next'); await page.click('#step-show'); await page.click('#step-next');
    await page.click('#step-prev');
    assert((await T()).si === 1 && !(await T()).done && Object.keys((await T()).marks).length === 0, 'Back returns to the step as it started');

    // The tips page, from Help.
    await page.click('#help-btn');
    await page.waitForSelector('#dlg-help[open]');
    await page.click('#help-tips');
    await page.waitForSelector('#learn-tips:not([hidden])');
    assert(await page.locator('#tips-body section').count() === 5, 'Help opens the tips and tricks page');
    assert(await page.evaluate(() => document.activeElement.id) === 'tips-h', 'focus moves to the tips heading');

    // The play screen and the tutorial share the cell menu: a puzzle still works after.
    await page.click('#tips-back');
    await page.click('#learn-exit');
    await page.waitForSelector('#screen-home:not([hidden])');
    await page.click('#home-learn');
    await page.waitForSelector('#learn-overview:not([hidden])');
    assert(true, 'the home screen offers How to play');
    await page.click('#learn-exit');
    await page.click('#howto-btn');
    await page.waitForSelector('#learn-overview:not([hidden])');
    assert(true, 'How to play at the top opens the tutorial');
    await page.click('#learn-intro');
    await page.waitForSelector('#dlg-video[open]');
    assert(true, 'the tutorial links to the Introduction video');
    await page.click('#video-close');
    await page.click('#learn-exit');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    const k0 = await page.evaluate(() => [...window.__flg.state.grid.cells.keys()][0]);
    await page.click(`#gridframe td[data-k="${k0}"]`, { button: 'right' });
    await page.click('#cellmenu [data-mark=X]');
    assert(await page.evaluate((k) => window.__flg.state.marks.get(k), k0) === 'X', 'the puzzle cell menu still works after the tutorial');

    // From a puzzle, the video window offers the tutorial; the puzzle is saved first.
    await page.click('#intro-btn');
    await page.waitForSelector('#dlg-video[open]');
    assert((await page.textContent('#video-h')).startsWith('Introduction'), 'the video is now called the Introduction');
    await page.click('#video-learn');
    await page.waitForSelector('#learn-overview:not([hidden])');
    const saved = await page.evaluate(async () => (await (await import('./js/store.js')).listSaves()).length);
    assert(saved === 1 && !(await page.evaluate(() => window.__flg.state)), 'the open puzzle is saved and closed');

    // Silent mode: no sound, nothing hidden that the lesson needs.
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flg.settings')); s.silent = true; localStorage.setItem('flg.settings', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    assert(await page.evaluate(() => document.documentElement.classList.contains('silent')), 'Silent mode is on');
    await page.click('#home-learn');
    await page.click('#lesson-list button[data-lesson="0"]');
    for (let i = 0; i < 2; i++) await page.click('#step-next');
    await mark('O Ava Owl');
    assert((await T()).done && await page.isVisible('#learn-grid table') && await page.isVisible('#step-text'), 'lessons work in Silent mode');

    // Another language: the lesson text translates; item names in the grid stay usable.
    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    await page.selectOption('#language', 'es');
    await page.click('#dlg-settings button[value=close]');
    await page.waitForFunction(() => /‹es›/.test(document.querySelector('#step-h').textContent), null, { timeout: 8000 });
    assert(/‹es›/.test(await page.textContent('#step-text')), 'the lesson is translated into the chosen language');
    await page.click('#step-next');
    await page.waitForFunction(() => /‹es›/.test(document.querySelector('#step-h').textContent), null, { timeout: 8000 });
    assert(true, 'each new step is translated too');

    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
