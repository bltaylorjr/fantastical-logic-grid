// End-to-end check in headless Chromium: generate, play, hint, check, undo,
// save + resume, list view, print layout, reveal and solve.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8123'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto('http://localhost:8123/');
    await page.waitForSelector('#tier-choices input');
    // First launch offers the narrated how-to-play video.
    await page.waitForSelector('#dlg-welcome[open]');
    await page.click('#welcome-watch');
    await page.waitForSelector('#dlg-video[open]');
    const vid = await page.evaluate(async () => { const v = document.querySelector('#intro-video'); if (v.readyState < 1) await new Promise((r) => { v.onloadedmetadata = r; setTimeout(r, 5000); }); const t = v.textTracks[0]; return { d: v.duration, track: t && t.kind, mode: t && t.mode }; });
    assert(vid.d > 200 && vid.track === 'captions' && vid.mode === 'showing', `intro video loads with captions on (${Math.round(vid.d)} s)`);
    await page.click('#video-close');
    await page.click('#help-btn');
    assert(await page.locator('#help-video').isVisible(), 'video is in Help');
    await page.click('#help-close');
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    assert(!(await page.locator('#dlg-welcome[open]').count()), 'welcome is offered only once');
    assert(await page.locator('input[name=tier]').count() === 6, 'six difficulty tiers');
    assert(await page.locator('input[name=theme]').count() >= 11, 'themes listed');
    await page.screenshot({ path: process.env.SHOTS + '/1-setup.png', fullPage: true });

    await page.check('input[name=tier][value=easy]', { force: true });
    await page.check('input[name=theme][value=mystery]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const title = await page.textContent('#p-title');
    assert(title.length > 3, `generated "${title}"`);
    const cells = await page.locator('td.c').count();
    assert(cells === 3 * 16, `grid has ${cells} cells`);
    await page.screenshot({ path: process.env.SHOTS + '/2-play.png', fullPage: true });

    // multimedia: scene, portraits, witness bubble
    assert(await page.locator('#scene svg .layer').count() === 5, 'scene has 5 unlockable layers');
    assert(await page.locator('.cast-btn').count() === 4, 'a portrait for each character');
    await page.locator('.cast-btn').first().click();
    assert(/clue \d+/.test(await page.textContent('#bubble')), 'portrait tells its clue');
    assert(await page.locator('#clue-list li.spot').count() >= 1, 'the told clue is highlighted in the list');
    // silent mode hides media
    await page.evaluate(() => { document.documentElement.classList.add('silent'); });
    assert(!(await page.isVisible('#scene')) && !(await page.isVisible('#cast')), 'silent mode hides scene and cast');
    await page.evaluate(() => { document.documentElement.classList.remove('silent'); });

    // keyboard marking
    await page.locator('td.c').first().focus();
    await page.keyboard.press('x');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('o');
    let marks = await page.evaluate(() => window.__flg.state.marks.size);
    assert(marks === 2, 'two marks placed by keyboard');
    await page.keyboard.press('Control+z');
    marks = await page.evaluate(() => window.__flg.state.marks.size);
    assert(marks === 1, 'undo removes one');
    await page.keyboard.press('Control+Shift+Z');
    assert(await page.evaluate(() => window.__flg.state.marks.size) === 2, 'redo restores');
    // click cycles
    await page.locator('td.c').nth(5).click();
    assert(await page.evaluate(() => window.__flg.state.marks.size) === 3, 'click marks X');

    // check
    await page.click('[data-act=check]');
    const st = await page.textContent('#status');
    assert(/conflict|No errors/.test(st), `check says: ${st}`);

    // hint x3
    await page.click('[data-act=hint]');
    await page.waitForSelector('#hintbox:not([hidden])');
    await page.click('#hint-more');
    await page.click('#hint-more');
    assert(await page.locator('#hint-apply').count() === 1, 'hint reaches the reasoning level');
    await page.click('#hint-apply');
    assert(await page.evaluate(() => window.__flg.state.save.hintsUsed) === 3, 'hint uses counted');

    // list view
    await page.check('input[name=view][value=list]', { force: true });
    assert(await page.locator('#listview select').count() === 12, 'list view has a select per row');
    await page.check('input[name=view][value=grid]', { force: true });

    // the player's own notes: typing never triggers the single-key shortcuts
    const hintsBefore = await page.evaluate(() => window.__flg.state.save.hintsUsed);
    assert(!(await page.isVisible('#my-notes')), 'notes stay closed until asked for');
    await page.click('#notes-btn');
    await page.waitForSelector('#dlg-notes[open]');
    assert(await page.evaluate(() => document.activeElement.id) === 'my-notes', 'the My notes button opens the notes, ready to type');
    await page.keyboard.type('Chef is not in the cellar. Check hat colors?');
    assert(await page.evaluate(() => window.__flg.state.save.hintsUsed) === hintsBefore && await page.inputValue('#my-notes') === 'Chef is not in the cellar. Check hat colors?', 'notes take typing without firing H or C');
    const undoBefore = await page.evaluate(() => window.__flg.state.save.undo.length);
    await page.keyboard.press('Control+z');
    assert(await page.evaluate(() => window.__flg.state.save.undo.length) === undoBefore, 'Ctrl+Z in notes does not undo grid marks');
    await page.fill('#my-notes', 'Chef is not in the cellar.\nCheck hat colors?');
    await page.click('#notes-save');
    await page.waitForFunction(() => /Notes saved/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
    assert(!(await page.locator('#dlg-notes[open]').count()), 'Save saves the notes and closes them');
    assert(await page.evaluate(() => window.__flg.state.save.myNotes) === 'Chef is not in the cellar.\nCheck hat colors?', 'notes are kept with the puzzle');
    assert(await page.isVisible('#notes-dot') && (await page.textContent('#notes-btn')).includes('has notes'), 'the button shows the puzzle has notes');
    await page.locator('td.c').first().focus();
    await page.keyboard.press('n');
    await page.waitForSelector('#dlg-notes[open]');
    await page.click('#notes-close');
    assert(!(await page.locator('#dlg-notes[open]').count()), 'N opens the notes and Close closes them');

    // print layout
    await page.click('[data-act=print]');
    assert(await page.isVisible('#p-mynotes'), 'print offers to include my notes');
    await page.check('#p-mynotes');
    await page.check('#p-key');
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.click('#print-go');
    await page.waitForFunction(() => window.__printed);
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: process.env.SHOTS + '/3-print.png', fullPage: true });
    const pages = await page.locator('#print-root .pp').count();
    assert(pages >= 2, `print has ${pages} pages incl. answer key`);
    assert((await page.textContent('#print-root .pnotes')) === 'Chef is not in the cellar.\nCheck hat colors?', 'print includes my notes');
    await page.emulateMedia({ media: 'screen' });

    // save + resume
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => window.__flg.state.marks.size);
    await page.reload();
    await page.waitForSelector('.saved-item');
    assert(await page.locator('.saved-item').count() === 1, 'saved list shows the puzzle');
    assert((await page.textContent('.saved-item .info')).includes('Has notes'), 'saved list marks puzzles with notes');
    assert(await page.locator('#continue-btn').isVisible() && (await page.textContent('#continue-name')).length > 3, 'title banner offers Continue for the unfinished puzzle');
    await page.screenshot({ path: process.env.SHOTS + '/4-saved.png', fullPage: true });
    await page.click('.saved-item [data-do=resume]');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert(await page.evaluate(() => window.__flg.state.marks.size) === before, 'marks restored on resume');
    assert(await page.evaluate(() => window.__flg.state.save.undo.length) > 0, 'undo history restored');
    await page.click('#notes-btn');
    assert(await page.inputValue('#my-notes') === 'Chef is not in the cellar.\nCheck hat colors?', 'notes restored on resume');
    await page.keyboard.press('Escape');

    // reveal => solved
    await page.click('[data-act=reveal]');
    await page.click('#confirm-yes');
    await page.waitForSelector('#solved:not([hidden])');
    assert((await page.textContent('#solved-h')).includes('revealed'), 'reveal shows the ending');

    // solve a fresh puzzle by hand from the solution
    await page.click('#next-btn');
    await page.waitForSelector('#screen-home:not([hidden])');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.evaluate(() => {
      const S = window.__flg.state;
      for (const [k, td] of S.grid.cells) {
        const [a, b] = k.split('|');
        if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
      }
    });
    await page.waitForSelector('#solved:not([hidden])');
    assert((await page.textContent('#solved-h')).includes('Case closed'), 'solving by hand shows "Case closed!"');
    await page.screenshot({ path: process.env.SHOTS + '/5-solved.png', fullPage: true });
    assert(await page.locator('#resolution .hero svg').count() === 1, 'resolution scene shows the culprit');
    assert(await page.locator('#scene .layer.on').count() === 5, 'whole scene revealed when solved');

    // mobile layout: no sideways page scroll
    await page.setViewportSize({ width: 360, height: 800 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(sw <= 360, `no horizontal page scroll at 360px (scrollWidth ${sw})`);
    await page.screenshot({ path: process.env.SHOTS + '/6-mobile.png', fullPage: true });

    // dark + high contrast
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({ path: process.env.SHOTS + '/7-dark.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'contrast'; });
    await page.screenshot({ path: process.env.SHOTS + '/8-contrast.png' });

    // MENSA in the worker
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.click('#home-btn');
    await page.waitForSelector('#tier-choices .suggest');
    assert(true, `difficulty suggestion shown: ${await page.textContent('#tier-choices .suggest')}`);
    await page.check('input[name=tier][value=mensa]', { force: true });
    const t0 = Date.now();
    await page.click('#gen-btn');
    assert(await page.isDisabled('#gen-btn'), 'generate button disabled while writing');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
    console.log(`    MENSA generated in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.screenshot({ path: process.env.SHOTS + '/9-mensa.png', fullPage: true });

    const used = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('fantastical-logic-grid'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('usedStories'); g.onsuccess = () => res(g.result); }; }));
    assert(used.length === 3 && new Set(used).size === 3, `used stories recorded: ${used.join(', ')}`);
    assert(!errors.length, `no console errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
