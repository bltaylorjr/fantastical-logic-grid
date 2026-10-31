// Game styles in the private test app: Classic is the default, and Rival Grid,
// Chain Reaction, Tidewater and Glyph Quest each play by their own rules.
// Run: npm run build && node modules/build-test-app.mjs && node modules/number-place/e2e-styles.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const shots = process.env.NP_SHOTS;

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', '..', 'scripts', 'serve.mjs'), path.join(__dirname, '..', '..', 'dist', 'module-test'), '8142'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:8142/');
  await page.waitForSelector('#np-setup-view:not([hidden]) #np-styles .choice');
  const G = () => page.evaluate(async () => {
    const g = (await import('./modules/number-place/ui.js')).state();
    return g && JSON.parse(JSON.stringify({ ...g, wrongShown: null, checked: null }));
  });
  // Waits until a test on the game state passes (waitForFunction can't await the module import).
  const until = async (test, ms = 15000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await page.waitForTimeout(100)) {
      if (await page.evaluate(async (src) => { const g = (await import('./modules/number-place/ui.js')).state(); return !!g && new Function('g', `return ${src}`)(g); }, test)) return;
    }
    throw new Error(`FAIL: timed out waiting for ${test}`);
  };
  const start = async (style, level = 'easy', size = null) => {
    if (!(await page.locator('#np-setup-view').isVisible())) await page.click('#np-new');
    await page.check(`input[name=np-style][value=${style}]`, { force: true });
    await page.check(`input[name=np-level][value=${level}]`, { force: true });
    if (size) await page.check(`input[name=np-size][value="${size}"]`, { force: true });
    await page.click('#np-gen');
    await page.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
    await until(`g.style === '${style}'`);
    // Close the first-time tips so they don't cover anything.
    if (await page.locator('#np-coach').isVisible()) await page.click('#np-coach-close');
  };
  const cell = (i) => page.locator(`#np-board .np-cell[data-i="${i}"]`);
  const put = async (i, d) => { await cell(i).click(); await page.keyboard.press(String(d)); };
  const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };

  try {
    // ---- the picker ----
    assert(await page.locator('input[name=np-style]').count() === 5, 'five game styles to choose from');
    assert(await page.isChecked('input[name=np-style][value=classic]'), 'Classic is chosen by default');
    assert(/traditional/i.test(await page.textContent('#np-styles')), 'Classic is described as the traditional game');
    await page.check('input[name=np-style][value=glyph]', { force: true });
    assert(await page.locator('#np-map li').count() === 6, 'Glyph Quest shows its six-realm map');
    assert(/Start .*Glyph Quest/.test(await page.textContent('#np-gen')), 'the start button names the style');
    await shot('styles-setup');

    // ---- how to play ----
    await page.click('#np-howto-btn');
    assert(await page.locator('#np-howto-dlg[open]').count() === 1, 'How to play opens from the setup screen');
    assert(await page.locator('#np-howto-tabs [role=tab]').count() === 5, 'it covers all five games');
    assert(await page.getAttribute('#np-howto-tabs [data-id=glyph]', 'aria-selected') === 'true', 'it opens at the chosen game');
    await page.click('#np-howto-tabs [data-id=classic]');
    assert(/Goal:/.test(await page.textContent('#np-howto-body')) && await page.locator('#np-howto-body .np-ex .np-ex-cell').count() === 16, 'each game has its goal, rules and an example grid');
    for (const id of ['classic', 'rival', 'chain', 'tide', 'glyph']) {
      await page.click(`#np-howto-tabs [data-id=${id}]`);
      let n = 1;
      while (await page.isEnabled('#np-howto-next')) { await page.click('#np-howto-next'); n++; }
      assert(n >= 5 && new RegExp(`Step ${n} of ${n}`).test(await page.textContent('#np-howto-body')), `the ${id} example steps through ${n} steps`);
    }
    await page.focus('#np-howto-tabs [data-id=glyph]');
    await page.keyboard.press('ArrowLeft');
    assert(await page.getAttribute('#np-howto-tabs [data-id=tide]', 'aria-selected') === 'true', 'arrow keys move between the games');
    await shot('howto');
    await page.keyboard.press('Escape');

    // ---- Classic is unchanged ----
    await start('classic');
    assert(await page.locator('#np-hud').isHidden(), 'Classic has no style scoreboard');
    assert((await page.textContent('#np-kicker')).startsWith('NINETIMESNINE ·'), 'Classic is called NINETIMESNINE');
    assert(await page.locator('#np-undo').isVisible() && await page.locator('#np-hint-btn').isVisible(), 'Classic keeps undo and hints');

    // ---- Rival Grid ----
    await start('rival');
    let g = await G();
    assert((await page.textContent('#np-kicker')).startsWith('NINETIMESNINE-Rival Grid'), 'the game is called NINETIMESNINE-Rival Grid');
    assert(/You/.test(await page.textContent('#np-hud')) && /rival/i.test(await page.textContent('#np-hud')), 'Rival Grid shows the scoreboard');
    assert(await page.locator('#np-undo').isHidden(), 'Rival Grid has no undo');
    let empty = g.p.givens.findIndex((d) => !d);
    const wrong = (g.p.solution[empty] % g.p.size) + 1;
    await put(empty, wrong);
    g = await G();
    assert(g.v[empty] === 0 && g.turn === 'rival' && g.mistakes === 1, 'a wrong number is taken back and the turn passes');
    await until("g.turn === 'you'");
    g = await G();
    empty = g.p.solution.findIndex((d, i) => !g.p.givens[i] && !g.v[i]);
    await put(empty, g.p.solution[empty]);
    g = await G();
    assert(g.owner[empty] === 1 && g.turn === 'rival', 'a right number claims the cell and ends the turn');
    assert(await cell(empty).evaluate((el) => el.classList.contains('mine')), 'your cells are colored as yours');
    await shot('style-rival');
    // Play it out: always place a right number on your turn.
    for (let guard = 0; guard < 80; guard++) {
      await until("g.solved || g.turn === 'you'");
      g = await G();
      if (g.solved) break;
      const i = g.p.solution.findIndex((d, k) => !g.p.givens[k] && !g.v[k]);
      await put(i, g.p.solution[i]);
    }
    g = await G();
    assert(g.solved, 'a Rival Grid game plays to the end');
    assert(g.owner.filter((o) => o === 1).length + g.owner.filter((o) => o === 2).length === g.p.givens.filter((d) => !d).length, 'every open cell went to you or the rival');
    assert(/You win|draw|rival wins/i.test(await page.textContent('#np-solved-h')), 'the end says who won');
    assert(/claimed/.test(await page.textContent('#np-solved-text')), 'the end gives the score');

    // ---- Chain Reaction ----
    await start('chain');
    g = await G();
    assert(await page.locator('#np-undo').isHidden(), 'Chain Reaction has no undo');
    const N = g.p.size, row0 = [...Array(N).keys()];
    const open = row0.map((c) => c).filter((i) => !g.p.givens[i]);
    await put(open[0], g.p.solution[open[0]]);
    await put(open[1], g.p.solution[open[1]]);
    g = await G();
    assert(g.chain.len === 2 && g.chain.score >= 3, `two numbers in one row make a chain of 2 (score ${g.chain.score})`);
    assert(await page.locator('#np-board .np-cell.zone').count() > 0, 'cells that would link are outlined');
    await shot('style-chain');
    await page.click('.np-rules-box summary');
    await page.click('#np-howto-play');
    assert(await page.getAttribute('#np-howto-tabs [data-id=chain]', 'aria-selected') === 'true', 'How to play from a game opens at that game');
    await page.keyboard.press('Escape');
    const third = g.p.solution.findIndex((d, i) => !g.p.givens[i] && !g.v[i]);
    await put(third, (g.p.solution[third] % N) + 1);
    g = await G();
    assert(g.chain.len === 0 && g.chain.best === 2, 'a wrong number breaks the chain and keeps the best');

    // ---- Tidewater ----
    await start('tide', 'medium', 9);
    g = await G();
    const hidden = g.water.filter((i) => g.p.givens[i]);
    assert(g.water.length > 10, `pools of water cover the grid (${g.water.length} cells)`);
    assert(hidden.length > 0, `some clues start hidden (${hidden.length})`);
    if (hidden.length) assert((await cell(hidden[0]).textContent()) === '', 'a hidden clue shows nothing');
    await shot('style-tide');
    // Fill a dry empty cell next to the water with its right number: the water around it drains.
    const nb = (i) => { const r = Math.floor(i / 9), c = i % 9, o = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if ((dr || dc) && rr >= 0 && rr < 9 && cc >= 0 && cc < 9) o.push(rr * 9 + cc); } return o; };
    const shore = g.p.solution.findIndex((d, i) => !g.p.givens[i] && !g.water.includes(i) && nb(i).some((n) => g.water.includes(n)));
    const before = g.water.length;
    await put(shore, g.p.solution[shore]);
    g = await G();
    assert(g.water.length < before && nb(shore).every((n) => !g.water.includes(n)), 'a right number drains the cells around it');
    // Finish it: every cell that is not a visible clue gets its number.
    for (let guard = 0; guard < 120; guard++) {
      g = await G();
      if (g.solved) break;
      const i = g.p.solution.findIndex((d, k) => !(g.p.givens[k] && !g.water.includes(k)) && g.v[k] !== d);
      if (i < 0) break;
      await put(i, g.p.solution[i]);
    }
    g = await G();
    assert(g.solved, 'a Tidewater puzzle can be finished');

    // ---- Glyph Quest ----
    await start('glyph');
    g = await G();
    assert((await page.textContent('#np-digits .np-digit[data-d="1"] .d')) === 'I', 'the first realm uses Roman numeral glyphs');
    assert(await page.locator('#np-powers [data-power]').count() === 3, 'three powers: Lantern, Compass and Key');
    assert(await page.locator('#np-hint-btn').isHidden(), 'free hints give way to powers');
    const gi = g.p.givens.findIndex((d) => !d);
    await cell(gi).click();
    await page.click('#np-powers [data-power=key]');
    g = await G();
    assert(g.v[gi] === g.p.solution[gi] && g.powers.key === 0, 'the Key opens the selected cell');
    assert(/^[IVX]+$/.test((await cell(gi).textContent()).trim()), 'the cell shows a glyph, not a digit');
    // Finish the first row to earn a Lantern.
    for (let c = 0; c < g.p.size; c++) if (!g.p.givens[c] && g.v[c] !== g.p.solution[c]) await put(c, g.p.solution[c]);
    g = await G();
    assert(g.powers.lantern >= 2, 'finishing a row earns a Lantern');
    await page.check('#np-glyphnum');
    assert(await page.locator('#np-board .np-gnum').count() > 0, 'the numbers can be shown under the glyphs');
    await shot('style-glyph');

    // ---- saved games keep their style ----
    await page.reload();
    await page.waitForSelector('#np-setup-view:not([hidden])');
    assert(/Glyph Quest/.test(await page.textContent('#np-saved')), 'the saved list names the style');
    await page.click('#np-continue');
    await page.waitForSelector('#np-play-view:not([hidden])');
    g = await G();
    assert(g.style === 'glyph' && g.powers.lantern >= 2, 'a resumed game keeps its style and powers');

    // ---- records ----
    const recs = await page.evaluate(async () => (await import('./modules/number-place/ui.js')).learning().plays().map((r) => ({ style: r.style, sr: r.sr })));
    assert(recs.some((r) => r.style === 'rival' && r.sr && 'won' in r.sr), 'a Rival Grid record keeps the score');
    assert(recs.some((r) => r.style === 'tide' && r.sr && 'ebbs' in r.sr), 'a Tidewater record keeps its ebbs');
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (e) {
    console.error(e);
    if (errors.length) console.error(errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
