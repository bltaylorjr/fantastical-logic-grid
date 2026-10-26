// "Play now": a first visit can be playing a small Easy puzzle within seconds,
// from the welcome, the home button, or a link ending ?play=now.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8131'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    return page;
  };
  const cells = (page) => page.locator('td.c').count();
  try {
    // 1. The welcome's main way in plays a quick puzzle.
    let page = await open();
    await page.goto('http://localhost:8131/');
    await page.waitForSelector('#dlg-welcome[open]');
    assert(/quick puzzle/i.test(await page.textContent('#welcome-skip')), 'welcome offers a quick puzzle');
    await page.click('#welcome-skip');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await cells(page) === 3 * 16, 'quick puzzle is a 3 x 4 grid');
    const save = await page.evaluate(() => ({ d: window.__flg.state.save.puzzle.difficulty.id, quick: window.__flg.state.save.quick }));
    assert(save.d === 'easy' && save.quick === true, 'quick puzzle is Easy and marked quick');
    await page.context().close();

    // 2. On the home screen it is the main button until there is a puzzle to continue.
    page = await open();
    await page.goto('http://localhost:8131/');
    await page.waitForSelector('#dlg-welcome[open]');
    await page.keyboard.press('Escape');
    assert(await page.locator('#quick-btn.primary').isVisible(), 'quick puzzle is the main button on a first visit');
    // The New puzzle form asks only difficulty, theme and size up front; the
    // rest waits under More options, and Settings tucks away the play switches.
    assert(await page.locator('#more-options:not([open]) input[name=playstyle]').count() === 2 && !(await page.locator('input[name=playstyle]').first().isVisible()), 'play style waits under More options');
    await page.click('#menu-btn'); await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    assert(await page.locator('#dlg-settings input[name=sound]').isVisible() && !(await page.locator('#dlg-settings input[name=singleKeys]').isVisible()), 'Settings shows sound first and tucks the play switches away');
    await page.click('#more-settings summary');
    assert(await page.locator('#dlg-settings input[name=singleKeys]').isVisible(), 'More play settings opens them');
    await page.keyboard.press('Escape');
    await page.click('#quick-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.locator('td.c').first().click();
    await page.click('#home-btn');
    await page.waitForSelector('#continue-btn:not([hidden])');
    assert(!(await page.locator('#quick-btn.primary').count()), 'Continue takes over as the main button');
    await page.context().close();

    // 3. A ?play=now link skips the welcome and cleans the address.
    page = await open();
    await page.goto('http://localhost:8131/?play=now&utm_source=reddit');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(!(await page.locator('#dlg-welcome[open]').count()), 'no welcome over the puzzle');
    assert(!/play=now/.test(page.url()), 'play=now is taken out of the address');
    assert(await cells(page) === 3 * 16, 'link opens a quick puzzle');
    await page.context().close();

    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
