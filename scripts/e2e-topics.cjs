// Topics: the picker follows the theme, resets to Any on a theme change,
// and the chosen topic shapes the puzzle.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8132'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto('http://localhost:8132/');
    await page.waitForSelector('#tier-choices input');
    if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');
    await page.check('input[name=theme][value=random]', { force: true });
    assert(await page.locator('#topic-field').isHidden(), 'no topics for Surprise me');
    await page.check('input[name=theme][value=holiday]', { force: true });
    assert(await page.locator('#topic-field').isVisible(), 'topics appear for Holiday');
    assert(await page.locator('input[name=topic][value=any]').isChecked(), 'Any is picked first');
    assert(/Costumes, candy/.test(await page.textContent('#topic-choices')), 'each topic shows its description');
    await page.check('input[name=topic][value=halloween]', { force: true });
    await page.check('input[name=theme][value=mystery]', { force: true });
    assert(await page.locator('input[name=topic][value=any]').isChecked(), 'changing theme resets the topic to Any');
    await page.check('input[name=theme][value=holiday]', { force: true });
    await page.check('input[name=topic][value=halloween]', { force: true });
    await page.check('input[name=tier][value=easy]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(/Halloween/.test(await page.textContent('#p-meta')), 'the puzzle is a Halloween story');
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    assert(await page.locator('input[name=topic][value=halloween]').isChecked(), 'the topic choice is remembered');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})();
