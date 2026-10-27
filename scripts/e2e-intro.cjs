// End-to-end check of the Introduction video: it plays through, the natural
// voice engine waits until it is closed (its download and start-up made the
// narration stall), and a stuck player recovers on its own from where it stopped.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8158'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('https://huggingface.co/**', (r) => r.abort());
  await ctx.addInitScript(() => {
    window.__workers = [];
    const W = window.Worker;
    window.Worker = function (url, opts) { window.__workers.push(String(url)); return new W(url, opts); };
    window.Worker.prototype = W.prototype;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const voiceWorkers = () => page.evaluate(() => window.__workers.filter((u) => u.includes('kokoro-worker')).length);
  const v = (expr) => page.evaluate(`(() => { const v = document.querySelector('#intro-video'); return ${expr}; })()`);

  try {
    await page.goto('http://localhost:8158/');
    await page.waitForSelector('#dlg-welcome[open]');
    await page.evaluate(() => document.querySelector('#dlg-welcome').close());
    await page.click('#intro-btn');
    assert(await page.evaluate(() => document.querySelector('#dlg-video').open), 'Introduction opens');
    assert(await v('v.preload') === 'auto', 'the whole video buffers ahead');
    await v('v.play()');
    // Natural voices would start loading 8 s after a first launch.
    await page.waitForTimeout(11000);
    const t = await v('v.currentTime');
    assert(t > 8, `video plays on (${t.toFixed(1)} s)`);
    assert(await voiceWorkers() === 0, 'voice engine waits while the Introduction plays');

    // A stuck player (playing, but the clock stands still) recovers by itself.
    await v('v.playbackRate = 0');
    const stuckAt = await v('v.currentTime');
    await page.waitForFunction((at) => { const v = document.querySelector('#intro-video'); return !v.paused && v.currentTime > at + 1; }, stuckAt, { timeout: 25000 }).catch(() => {});
    const after = await v('v.currentTime');
    assert(!(await v('v.paused')) && after > stuckAt + 1, `stuck playback recovers (${stuckAt.toFixed(1)} s -> ${after.toFixed(1)} s)`);
    assert(after < stuckAt + 6, 'it carries on from where it stopped');

    await page.click('#video-close');
    await page.waitForTimeout(300);
    assert(await v('v.paused'), 'closing the Introduction stops it');
    await page.waitForFunction(() => window.__workers.some((u) => u.includes('kokoro-worker')), null, { timeout: 15000 });
    assert(true, 'voice engine starts once the Introduction is closed');
    assert(!errors.length, `no page errors ${errors.join('; ')}`);
    console.log('Introduction checks passed.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
