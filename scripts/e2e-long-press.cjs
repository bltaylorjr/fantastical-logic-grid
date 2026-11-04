// Long-press on a grid cell opens the cell menu. A second finger landing before
// the first press finishes (then let go) must not leave the first press's timer
// behind to fire with no press (error report: "null is not an object (evaluating 'y.x')").
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const dir = process.argv[2] || path.join(__dirname, '..', 'dist', 'web');

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), dir, '8163'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8163/?play=now');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const menuOpen = () => page.evaluate(() => !document.querySelector('#cellmenu').hidden);
    const fire = (type, i, x = 10, y = 10) => page.evaluate(([type, i, x, y]) => {
      const td = document.querySelectorAll('#gridframe td.c')[i];
      const r = td.getBoundingClientRect();
      td.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: r.left + x, clientY: r.top + y }));
    }, [type, i, x, y]);

    // One finger held: the menu opens.
    await fire('pointerdown', 0);
    await page.waitForTimeout(700);
    assert(await menuOpen(), 'holding a cell opens its menu');
    await page.keyboard.press('Escape');
    await fire('pointerup', 0);

    // Two fingers: the second lands, then slides away (a scroll). Nothing fires later.
    await fire('pointerdown', 0);
    await fire('pointerdown', 1);
    await fire('pointermove', 1, 60, 60);
    await page.waitForTimeout(800);
    assert(!(await menuOpen()), 'a second finger that scrolls away leaves no menu behind');
    assert(!errors.length, `no page errors (${errors.join('; ')})`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
