// End-to-end check of Auto-X (player report: automatic Xs could not be taken
// back). Automatic Xs belong to the O that placed them: clearing or changing
// the O removes them, Undo takes the O and its Xs back as one step, tapping an
// automatic X clears it, hand-placed Xs always stay, and it all survives a
// save and resume.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8141'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const marks = () => page.evaluate(() => Object.fromEntries(window.__flg.state.marks));
  const autos = async () => Object.values(await marks()).filter((v) => v === 'A').length;
  const cell = (k) => page.locator(`#gridframe td.c[data-k="${k}"]`);
  const press = async (k, key) => { await cell(k).focus(); await page.keyboard.press(key); };
  try {
    await page.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false, autoX: true, coach: false })));
    await page.goto('http://localhost:8141/');
    await page.waitForSelector('#tier-choices input');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });

    // Pick a cell k0 = (a0, b0), a row-mate (a0, b1) and a cell k1 = (a1, b1)
    // in the same sub-grid that shares neither its row nor its column.
    const { k0, mate, k1 } = await page.evaluate(() => {
      const S = window.__flg.state;
      const blk = S.puzzle.grid.blocks[0];
      const rc = S.ix.byId[blk.row], cc = S.ix.byId[blk.column];
      const key = (r, c) => S.ix.key(rc.items[r].id, cc.items[c].id);
      return { k0: key(0, 0), mate: key(0, 1), k1: key(1, 1) };
    });

    await press(mate, 'x');
    await press(k0, 'o');
    let m = await marks();
    const placed = Object.values(m).filter((v) => v === 'A').length;
    assert(m[k0] === 'O' && placed > 0, `an O with Auto-X on rules out its row and column (${placed} automatic Xs)`);
    assert(m[mate] === 'X', 'a hand-placed X in that row is kept as a hand-placed X');
    assert(await cell(Object.keys(m).find((k) => m[k] === 'A')).evaluate((td) => td.classList.contains('auto')), 'automatic Xs are drawn differently');

    await page.keyboard.press('Control+z');
    m = await marks();
    assert(!m[k0] && (await autos()) === 0 && m[mate] === 'X', 'one Undo takes back the O and all its automatic Xs, and keeps the hand X');
    await page.keyboard.press('Control+Shift+Z');
    assert((await marks())[k0] === 'O' && (await autos()) === placed, 'Redo puts the O and its automatic Xs back');

    // Tapping an automatic X clears it instead of turning it into an O.
    const anAuto = Object.entries(await marks()).find(([, v]) => v === 'A')[0];
    await cell(anAuto).click();
    m = await marks();
    assert(!m[anAuto] && (await autos()) === placed - 1, 'tapping an automatic X clears it');
    await page.keyboard.press('Control+z');
    assert((await marks())[anAuto] === 'A', 'Undo brings that automatic X back');
    await press(anAuto, 'Delete');
    assert(!(await marks())[anAuto], 'Delete clears an automatic X from the keyboard');
    await page.keyboard.press('Control+z');

    // Clearing the O removes its automatic Xs (keyboard and tap).
    await press(k0, 'Delete');
    m = await marks();
    assert(!m[k0] && (await autos()) === 0 && m[mate] === 'X', 'clearing the O removes its automatic Xs but keeps the hand X');
    await page.waitForFunction(() => /removed \d+ automatic X/.test(document.querySelector('#announcer').textContent));
    assert(true, 'screen readers hear that the automatic Xs were removed');
    await page.keyboard.press('Control+z');
    assert((await marks())[k0] === 'O' && (await autos()) === placed, 'Undo restores the O with its automatic Xs');
    await cell(k0).click(); // O -> empty
    assert(!(await marks())[k0] && (await autos()) === 0, 'tapping the O to clear it removes its automatic Xs');
    await page.keyboard.press('Control+z');

    // Changing the O to an X removes its automatic Xs too.
    await press(k0, 'x');
    m = await marks();
    assert(m[k0] === 'X' && (await autos()) === 0, 'changing the O to an X removes its automatic Xs');
    await page.keyboard.press('Control+z');

    // An automatic X that another O still rules out stays.
    const shared = await page.evaluate(({ k0, k1 }) => {
      const S = window.__flg.state;
      const [a0] = k0.split('|'), [, b1] = k1.split('|');
      return S.ix.key(a0, b1);
    }, { k0, k1 });
    const sharedIsMate = shared === mate;
    await press(k1, 'o');
    await press(k0, 'Delete');
    m = await marks();
    if (sharedIsMate) assert(m[mate] === 'X', 'the hand X shared by both Os stays');
    const k1Autos = Object.keys(m).filter((k) => m[k] === 'A');
    assert(m[k1] === 'O' && k1Autos.length > 0, 'the other O keeps its own automatic Xs');
    await page.keyboard.press('Control+z');
    assert((await marks())[k0] === 'O', 'Undo restores the first O');

    // Save and resume: the automatic Xs are remembered as automatic.
    await page.waitForTimeout(1200);
    const saved = await marks();
    await page.reload();
    await page.waitForSelector('.saved-item');
    await page.click('.saved-item [data-do=resume]');
    await page.waitForSelector('#screen-play:not([hidden])');
    m = await marks();
    assert(JSON.stringify(m) === JSON.stringify(saved), 'marks, including which Xs were automatic, come back on resume');
    await press(k0, 'Delete');
    m = await marks();
    assert(!m[k0] && m[k1] === 'O' && Object.values(m).filter((v) => v === 'A').length < Object.values(saved).filter((v) => v === 'A').length, 'after resume, clearing the O still removes its automatic Xs');
    await page.keyboard.press('Control+z');
    assert(JSON.stringify(await marks()) === JSON.stringify(saved), 'and Undo after resume puts them back');

    // With Auto-X off, an O places no automatic Xs, but clearing an O still
    // removes any it placed earlier.
    await page.evaluate(() => { window.__flg.settings().autoX = false; });
    await press(k1, 'Delete');
    m = await marks();
    assert(!m[k1] && m[k0] === 'O', 'with Auto-X off, clearing an O still tidies up its old automatic Xs');
    const before = await autos();
    await press(k1, 'o');
    assert((await autos()) === before, 'with Auto-X off, a new O places no automatic Xs');

    assert(await page.locator('#autox-help').count() === 1, 'Settings explains how automatic Xs are removed');
    assert(!errors.length, `no page errors (${errors.join(' | ')})`);
    console.log('Auto-X e2e passed');
  } catch (e) {
    console.error(e.message || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
