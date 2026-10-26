// The copy for game sites (dist/portal) plays inside another site's frame,
// while the normal web build still refuses to be framed.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const dist = path.join(__dirname, '..', 'dist');
  const portal = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(dist, 'portal'), '8171'], { stdio: 'ignore' });
  const web = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(dist, 'web'), '8172'], { stdio: 'ignore' });
  // A stand-in game site on another origin that frames the game.
  const host = http.createServer((req, res) => {
    const port = req.url.includes('web') ? 8172 : 8171;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Game site</title><iframe id="game" src="http://127.0.0.1:${port}/" width="1100" height="850"></iframe>`);
  }).listen(8173);
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8173/portal');
    const frame = await (await page.waitForSelector('#game')).contentFrame();
    await frame.waitForSelector('#tier-choices input');
    assert(await frame.evaluate(() => !document.documentElement.hidden), 'the game shows inside the game site frame');
    assert(page.url().startsWith('http://localhost:8173'), 'the game site page stays where it is');
    await frame.waitForSelector('#dlg-welcome[open]');
    await frame.click('#welcome-skip');
    await frame.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await frame.locator('td.c').count() === 48, 'a quick puzzle plays in the frame');
    assert(await frame.evaluate(async () => !(await navigator.serviceWorker?.getRegistrations?.() || []).length), 'no service worker is registered');
    assert(await frame.locator('[data-cmd=site]').count() === 1 && await frame.evaluate(() => !document.querySelector('[data-cmd=site]').hidden && document.querySelector('[data-cmd=install]').hidden), 'the menu links to the website instead of Install');

    const page2 = await browser.newPage();
    await page2.goto('http://localhost:8173/web');
    await page2.waitForTimeout(1500);
    // It hides itself (browsers may also block it from taking over the top page).
    const webFrame = page2.url().startsWith('http://localhost:8173') ? await (await page2.$('#game')).contentFrame() : null;
    assert(!webFrame || await webFrame.evaluate(() => document.documentElement.hidden), 'the normal web build still refuses to play inside other sites\' frames');
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    portal.kill(); web.kill(); host.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
