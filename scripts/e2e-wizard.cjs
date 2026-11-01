// The Puzzle Wizard (web/wizard/, web/js/wizard-page.js), against the website build (dist/site):
// - the front page's Puzzle Wizard button asks which puzzle to make, then opens that game's wizard,
// - each game gets its own questions; the entry is saved on the device as it is typed, and comes back after a reload,
// - the live storyline follows what is typed,
// - the check page lists what is missing, says when the puzzle will have exactly one answer, and builds it:
//   a real PDF to download, saved to Saved puzzles,
// - a NINETIMESNINE grid typed by the author is checked for one answer, with a number to add when it has more,
// - the game's menu opens the wizard.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const site = path.join(__dirname, '..', 'dist', 'site');
const PORT = 8158;
const BASE = `http://localhost:${PORT}`;
const ignorable = (t) => /fonts\/|Failed to decode downloaded font|OTS parsing|media\/wizard\//.test(t);

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), site, String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })); } catch (e) { /* none */ } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text() + (m.location().url || ''))) errors.push(m.text()); });

    // ---- The front page: the first click asks which puzzle.
    await p.goto(`${BASE}/`);
    await p.click('#wizard-open');
    await p.waitForSelector('#wizard-pick[open]');
    assert(/Submit Puzzle Ideas/.test(await p.textContent('#wizard-open')), 'the front page button is called Submit Puzzle Ideas');
    assert(await p.locator('#wizard-pick a.wiz-game').count() === 2, 'the Submit Puzzle Ideas button asks which puzzle to make');
    await p.keyboard.press('Escape');
    assert(!/Share an idea/.test(await p.textContent('body')), 'the front page no longer offers Share an idea');
    await p.click('.app-item[data-wizard]');
    await p.waitForSelector('#wizard-pick[open]');
    assert(true, 'Submit Puzzle Ideas in the shared section opens the same choice');
    await p.click('#wizard-pick a[href$="fantastical"]');
    await p.waitForSelector('#w-form .w-step');
    assert(/The Fantastical Logic Grid/.test(await p.textContent('#w-h1')), 'choosing a puzzle opens its own wizard');

    // ---- The Fantastical Logic Grid, step by step.
    await p.fill('#w-title', 'The Midnight Gala');
    await p.fill('#w-story', 'The lights went out at the gala and the tiara vanished from its velvet case.');
    assert(/The Midnight Gala/.test(await p.inputValue('#w-preview')), 'the live storyline shows what is typed');
    assert(await p.locator('#w-preview[readonly]').count() === 1, 'the live storyline is read only');
    await p.click('#w-next');
    await p.fill('#w-cast-one', 'guest');
    for (const [i, n] of ['Ada', 'Ben', 'Cora', 'Dev'].entries()) await p.fill(`#w-names-${i}`, n);
    await p.click('#w-next');
    await p.fill('#w-categories-0-name', 'Room');
    await p.fill('#w-categories-0-items', 'Library, Kitchen, Garden');
    await p.fill('#w-categories-1-name', 'Arrival');
    await p.fill('#w-categories-1-items', '7:00 PM, 7:15 PM, 7:30 PM, 7:45 PM');
    await p.selectOption('#w-categories-1-order', 'earlier');
    await p.click('#w-next');
    await p.waitForTimeout(500);
    await p.reload();
    await p.waitForSelector('#w-form .w-step');
    assert(await p.isVisible('#w-restored') && /Step 4/.test(await p.textContent('#w-stepname')), 'the draft is saved on the device and comes back after a reload');
    await p.click('[data-act=answer-fill]');
    for (let i = 0; i < 2; i++) await p.click('#w-next');
    await p.check('[data-k=consent]');
    await p.click('#w-next');
    await p.waitForURL(/wizard\/check\//);

    // ---- The check page: the list of three items is caught.
    await p.waitForSelector('#c-issues li.bad');
    assert(/List exactly 4 items/.test(await p.textContent('#c-issues')), 'the check page lists what needs fixing');
    assert(await p.isDisabled('#c-build'), 'the puzzle cannot be built until it is fixed');
    await p.click('#c-issues a');
    await p.fill('#w-categories-0-items', 'Library, Kitchen, Garden, Attic');
    await p.click('[data-act=answer-fill]');
    await p.waitForSelector('#c-status.good', { timeout: 30000 });
    assert(/exactly one answer/.test(await p.textContent('#c-status')), 'once fixed, the wizard says the puzzle has exactly one answer');
    await p.click('#c-build');
    await p.waitForSelector('#c-result:not([hidden])', { timeout: 30000 });
    assert(/Saved puzzles/.test(await p.textContent('#c-saved-msg')), 'the built puzzle is saved to Saved puzzles');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#c-pdf')]);
    const pdf = fs.readFileSync(await dl.path());
    assert(pdf.slice(0, 5).toString() === '%PDF-' && /the-midnight-gala\.pdf/.test(dl.suggestedFilename()), 'the PDF downloads as a real PDF file');
    const saves = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('fantastical-logic-grid'); r.onsuccess = () => { const q = r.result.transaction('saves').objectStore('saves').getAll(); q.onsuccess = () => res(q.result.map((s) => ({ name: s.name, wizard: s.wizard, clues: s.puzzle.clues.length }))); }; }));
    assert(saves.some((s) => s.name === 'The Midnight Gala' && s.wizard && s.clues > 0), 'the game finds it in Saved puzzles');
    await p.click('#c-edit');
    assert(await p.isVisible('#w-form') && await p.isChecked('#c-suggest'), 'Make changes goes back to the editor with suggestions shown');

    // ---- The game: Saved puzzles has it, and the menu opens the wizard.
    await p.goto(`${BASE}/fantastical/?open=saved`);
    await p.waitForSelector('#tier-choices input');
    await p.waitForFunction(() => /The Midnight Gala/.test(document.querySelector('#saved-section')?.textContent || ''), null, { timeout: 10000 });
    assert(true, 'the wizard puzzle is listed in the game\'s Saved puzzles');
    await p.click('#menu-btn');
    assert(await p.locator('#app-menu [data-cmd=feedback]').isHidden() && /Submit Puzzle Ideas/.test(await p.textContent('#app-menu [data-cmd=wizard]')), 'the menu has Submit Puzzle Ideas instead of Share an idea');
    await p.click('[data-cmd=wizard]');
    await p.waitForURL(/wizard\/\?game=fantastical/);
    assert(true, 'the game menu opens the Puzzle Wizard');

    // ---- NINETIMESNINE: the author's own numbers, checked for one answer.
    await p.goto(`${BASE}/wizard/?game=ninetimesnine`);
    await p.waitForSelector('#w-form .w-step');
    await p.fill('#w-title', 'The Clock Shop');
    await p.fill('#w-opening', 'The clockmaker locked every drawer.');
    await p.fill('#w-ending', 'The last drawer opens.');
    await p.click('#w-next');
    await p.check('input[data-k=size][value="4"]');
    await p.click('#w-next');
    await p.fill('[data-cell="0"]', '1');
    await p.fill('[data-cell="1"]', '1');
    await p.waitForTimeout(200);
    assert(/1 is in row 1 twice/.test(await p.textContent('#w-form')), 'a number twice in a row is caught as it is typed');
    await p.fill('[data-cell="1"]', '');
    for (const [c, d] of [[5, 3], [10, 2], [15, 4]]) await p.fill(`[data-cell="${c}"]`, String(d));
    await p.waitForSelector('[data-use-suggestion]');
    assert(/more than one answer/.test(await p.textContent('[data-onecheck]')), 'too few numbers: the wizard says there is more than one answer');
    await p.click('[data-use-suggestion]');
    await p.waitForFunction(() => /Exactly one answer/.test(document.querySelector('[data-onecheck]').textContent));
    assert(true, 'adding the suggested number leaves exactly one answer');
    await p.click('#w-next'); await p.click('#w-next');
    await p.check('[data-k=consent]');
    await p.click('#w-next');
    await p.waitForSelector('#c-status.good');
    await p.click('#c-build');
    await p.waitForSelector('#c-result:not([hidden])');
    const games = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('flg.np.games') || '{}')).map((g) => g.name));
    assert(games.includes('The Clock Shop'), 'the NINETIMESNINE puzzle is saved to its Saved puzzles');

    // ---- The how-to guide is on every wizard page.
    await p.goto(`${BASE}/wizard/?game=ninetimesnine`);
    await p.waitForSelector('#w-form .w-step');
    await p.click('#w-watch');
    await p.waitForSelector('#w-video[open]');
    assert(/Starting numbers/.test(await p.textContent('#w-guide-list')), 'Watch how it works shows the video and a guide to every entry');

    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
