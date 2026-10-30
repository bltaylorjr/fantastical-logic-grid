// Logic Grid Basic (web/calm/): set up, play, save, come back, solve, print
// markup, settings, and text contrast of its color tokens in every look.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

// WCAG contrast of two #RRGGBB colors.
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8137'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto('http://localhost:8137/calm/');

    // 1. Setup: the basic choices only.
    assert(await page.locator('#tiers input').count() >= 5, 'difficulty choices are listed');
    assert(await page.locator('#themes input[value=random]').count() === 1, 'Surprise me is a theme choice');
    assert(await page.locator('#themes input[value=stories]').count() === 0, 'Player Stories are not offered');
    assert(await page.locator('#themes input').count() >= 20, 'every added theme is offered');
    assert(await page.locator('.mode-switch a[href="../"]').count() === 1, 'the Interactive switch links to the full game');
    await page.check('#tiers input[value=basic]', { force: true });
    assert(await page.locator('#sizes input').count() >= 1, 'sizes follow the difficulty');
    await page.check('#sizes input[value="3x3"]', { force: true });
    await page.check('#themes input[value=pets]', { force: true });
    assert(await page.locator('#topic-set').isVisible() && await page.locator('#topics input').count() >= 2, 'a theme shows its topics');
    for (const extra of ['#screen-compete', '.scoreboard', '#talking-face', 'audio']) assert(await page.locator(extra).count() === 0, `no ${extra} on the page`);

    // 2. Play.
    await page.click('#start');
    await page.waitForSelector('#play:not([hidden])', { timeout: 30000 });
    assert(await page.locator('td.c').count() === 3 * 9, 'a 3 x 3 grid');
    const p = await page.evaluate(() => ({ theme: window.__calm.state.puzzle.theme.id, tier: window.__calm.state.puzzle.difficulty.id, clues: window.__calm.state.puzzle.clues.length }));
    assert(p.theme === 'pets' && p.tier === 'basic', 'the puzzle uses the chosen theme and difficulty');
    assert(await page.locator('#clue-list li').count() === p.clues, 'every clue is listed');
    const first = page.locator('td.c').first();
    await first.click();
    assert(await first.evaluate((td) => td.classList.contains('m-x')), 'one tap marks X');
    await first.click();
    assert(await first.evaluate((td) => td.classList.contains('m-o')), 'second tap marks O');
    const autos = await page.locator('td.c.auto').count();
    assert(autos === 4, 'an O fills the other Xs in its row and column');
    await page.click('[data-act=undo]');
    assert(await first.evaluate((td) => td.classList.contains('m-x')) && await page.locator('td.c.auto').count() === 0, 'undo takes back the O and its Xs');
    await page.click('[data-act=redo]');
    await page.check('#clue-list input >> nth=0');

    // 3. Hint.
    await page.click('[data-act=hint]');
    await page.waitForSelector('#hintbox:not([hidden])');
    assert((await page.textContent('#hintbox')).length > 10, 'a hint is shown');
    await page.click('#hint-close');

    // 4. Saved and listed; it comes back after a reload.
    await page.waitForTimeout(1200);
    const title = await page.textContent('#p-title');
    await page.reload();
    await page.waitForSelector('#continue:not([hidden])');
    assert((await page.textContent('#saved')).includes(title), 'the puzzle is listed under Your puzzles');
    await page.click('#continue-btn');
    await page.waitForSelector('#play:not([hidden])');
    assert(await page.locator('td.c.m-o').count() === 1 && await page.locator('#clue-list input:checked').count() === 1, 'marks and ticked clues come back');
    assert(await page.locator('[data-act=undo]').isEnabled(), 'undo history comes back');

    // 5. Solve from the answer.
    await page.evaluate(() => {
      const S = window.__calm.state;
      const keys = [...S.grid.cells.keys()];
      for (const k of keys) {
        const [a, b] = k.split('|');
        const match = S.puzzle.solution.some((row) => { const v = Object.values(row); return v.includes(a) && v.includes(b); });
        if (match && S.marks.get(k) !== 'O') S.grid.cells.get(k).click();
        if (match && S.marks.get(k) !== 'O') S.grid.cells.get(k).click();
      }
    });
    // Clicks cycle; finish any O left as X.
    await page.evaluate(() => {
      const S = window.__calm.state;
      for (const [k, v] of [...S.marks]) {
        const [a, b] = k.split('|');
        const match = S.puzzle.solution.some((row) => { const r = Object.values(row); return r.includes(a) && r.includes(b); });
        if (match && v !== 'O') S.grid.cells.get(k).click();
        if (!match && v === 'O') { S.grid.cells.get(k).click(); S.grid.cells.get(k).click(); }
      }
    });
    await page.waitForSelector('#solved:not([hidden])', { timeout: 5000 });
    assert((await page.textContent('#answers')).length > 0, 'solving shows the ending and the answers');

    // 6. Print markup (the print dialog itself is the browser's).
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.click('[data-act=print]');
    await page.check('#print-key');
    await page.click('#print-go');
    await page.waitForFunction(() => window.__printed === true);
    assert(await page.locator('#print-root .pp').count() >= 2, 'print has the puzzle and an answer key page');

    // 7. Start over clears marks.
    await page.click('[data-act=restart]');
    await page.click('#confirm-yes');
    await page.waitForFunction(() => window.__calm.state.marks.size === 0, null, { timeout: 5000 }).catch(() => {});
    assert(await page.locator('td.c.m-o, td.c.m-x').count() === 0 && await page.locator('#solved').isHidden(), 'start over clears the grid');

    // 8. Settings: dark look and larger text stick; every dialog has an X.
    await page.click('[data-act=home]');
    await page.click('#settings-btn');
    assert(await page.locator('#dlg-settings > .dlg-x').count() === 1, 'settings has a close X');
    await page.check('input[name=look][value=dark]', { force: true });
    await page.check('input[name=text][value="1.3"]', { force: true });
    await page.click('#dlg-settings > .dlg-x');
    await page.reload();
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'the color choice is kept');
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize) === '20.8px', 'the text size is kept');

    // 9. Contrast of text tokens in each look (AA: 4.5 for text, 3 for marks and lines).
    for (const look of ['light', 'dark', 'contrast']) {
      await page.evaluate((l) => { document.documentElement.dataset.theme = l; }, look);
      const t = await page.evaluate(() => Object.fromEntries(['--page', '--bg', '--text', '--muted', '--accent', '--on-accent', '--x', '--border', '--error', '--hint'].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])));
      for (const [fg, bg, min] of [['--text', '--bg', 4.5], ['--text', '--page', 4.5], ['--muted', '--bg', 4.5], ['--muted', '--page', 4.5], ['--on-accent', '--accent', 4.5], ['--accent', '--bg', 4.5], ['--x', '--bg', 3], ['--border', '--bg', 3], ['--error', '--bg', 3], ['--hint', '--bg', 3]]) {
        const c = contrast(t[fg], t[bg]);
        assert(c >= min, `${look}: ${fg} on ${bg} is ${c.toFixed(2)}:1 (needs ${min})`);
      }
    }

    // 10. A new story every time: the used list is shared with the full game.
    const used = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('fantastical-logic-grid'); r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').get('usedStories'); q.onsuccess = () => res(q.result || []); }; }));
    assert(used.length >= 1, 'the story went on the shared used-story list');

    assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
