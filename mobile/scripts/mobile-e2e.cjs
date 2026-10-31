// Phone check in headless Chromium: serves dist/web the way the Android app
// does (native bridge loaded first, no service worker), stands in for the
// Android side, and checks the bridge features plus the phone layout.
// Run from mobile/: node scripts/mobile-e2e.cjs   (after npm --prefix .. run build)
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const web = path.join(__dirname, '..', '..', 'dist', 'web');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'shared', 'native-bridge.js'));
const shots = process.env.SHOTS || '';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.vtt': 'text/vtt' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/__native/bridge.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bridge); }
  const file = path.join(web, p);
  if (p === '/sw.js' || p.includes('..') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (p === '/index.html') body = body.toString().replace('<head>', '<head>\n<script src="/__native/bridge.js"></script>');
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  res.end(body);
});

// Stands in for MainActivity: records each call from the page.
const fakeAndroid = () => {
  // Android's WebView has no Web Speech synthesis.
  Object.defineProperty(window, 'speechSynthesis', { value: undefined, writable: true, configurable: true });
  delete window.SpeechSynthesisUtterance;
  window.__calls = [];
  window.FLGAndroid = { post: (type, json) => window.__calls.push({ type, data: JSON.parse(json) }) };
};

(async () => {
  await new Promise((r) => server.listen(8124, r));
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [name, device] of [['phone', devices['Pixel 7']], ['small', { ...devices['Galaxy S9+'], viewport: { width: 360, height: 740 } }]]) {
      const ctx = await browser.newContext({ ...device });
      await ctx.addInitScript(fakeAndroid);
      // A tester's device, with the full Logic Grid package on (web/js/package-preview.js).
      await ctx.addInitScript((h) => { try { localStorage.setItem('flg.preview', h); } catch (e) { /* none */ } }, /CODE_HASH = '([0-9a-f]{64})'/.exec(require('fs').readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'package-preview.js'), 'utf8'))[1]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
      const calls = (type) => page.evaluate((t) => window.__calls.filter((c) => c.type === t), type);
      const noSideScroll = async (where) => {
        const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        assert(w[0] <= w[1], `${name}: no sideways scrolling on ${where} (${w[0]} <= ${w[1]})`);
      };

      await page.goto('http://localhost:8124/');
      await page.waitForSelector('#tier-choices input');
      assert(await page.evaluate(() => window.FLGNative && window.FLGNative.platform === 'android'), `${name}: bridge loads before the game`);
      if (await page.locator('#dlg-welcome[open]').count()) {
        // Back button closes the welcome dialog like Escape.
        assert(await page.evaluate(() => window.__flgBack()) === true, `${name}: back closes the open dialog`);
        assert(!(await page.locator('#dlg-welcome[open]').count()), `${name}: welcome dialog closed`);
      }
      // Back from The Fantastical Logic Grid goes to The Logic Grid's game cards, then leaves the app.
      assert(await page.evaluate(() => window.__flgBack()) === true, `${name}: back on the home screen goes to the game cards`);
      await page.waitForSelector('#screen-games:not([hidden])');
      assert(await page.evaluate(() => window.__flgBack()) === false, `${name}: back on the game cards leaves the app`);
      await page.click('#game-cards [data-game=logic-grid]');
      await page.waitForSelector('#tier-choices input');
      await noSideScroll('the new puzzle screen');
      if (shots) await page.screenshot({ path: `${shots}/${name}-1-setup.png`, fullPage: true });

      // System bars follow the theme.
      const bars = await calls('bars');
      assert(bars.length >= 1 && /^#[0-9a-f]{6}$/.test(bars[bars.length - 1].data.color), `${name}: system bar colour sent (${bars.length && bars[bars.length - 1].data.color})`);

      await page.check('input[name=tier][value=easy]', { force: true });
      await page.locator('#gen-btn').tap();
      await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
      await noSideScroll('the play screen');
      // The screen's entrance animation briefly scales it to 99.5%, so measure once it has settled.
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {}))));
      // The grid fits the screen's width (Bobby, 2026-10-31: no sideways scrolling);
      // its squares stay 44 px unless they had to shrink to fit.
      const cell = await page.locator('td.c').first().boundingBox();
      const g = await page.evaluate(() => { const f = document.querySelector('#gridframe'); return { over: f.scrollWidth - f.clientWidth, fit: !!f.querySelector('table.lg.fit') }; });
      assert(g.over <= 0, `${name}: the grid fits the screen's width (${Math.round(cell.width)} px squares)`);
      if (!g.fit) assert(cell.width >= 44 && cell.height >= 44, `${name}: grid cells are at least 44 px (${Math.round(cell.width)} x ${Math.round(cell.height)})`);
      await page.locator('td.c').nth(5).tap();
      assert(await page.evaluate(() => window.__flg.state.marks.size) === 1, `${name}: tapping a cell marks it`);
      if (shots) await page.screenshot({ path: `${shots}/${name}-2-play.png`, fullPage: true });

      // Keep the screen on while playing.
      await page.waitForFunction(() => window.__calls.some((c) => c.type === 'keepAwake' && c.data.on));
      assert(true, `${name}: screen kept on while playing`);

      // Printing goes to the system print service.
      await page.locator('[data-act=print]').first().tap();
      await page.locator('#print-go').tap();
      await page.waitForFunction(() => window.__calls.some((c) => c.type === 'print'));
      assert((await page.locator('#print-root .pp').count()) >= 1, `${name}: print pages built and handed to Android`);

      // Device voice through Android text-to-speech.
      const spoke = await page.evaluate(() => new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance('Hello detective.');
        u.onend = () => resolve(true);
        speechSynthesis.speak(u);
        const call = window.__calls.filter((c) => c.type === 'speak').pop();
        window.__flgSpeech(call.data.id, 'start');
        window.__flgSpeech(call.data.id, 'end');
        setTimeout(() => resolve(false), 1000);
      }));
      assert(spoke, `${name}: speech goes to Android and reports when it ends`);
      await page.evaluate(() => window.__flgVoices([{ name: 'en-us-x-tpf-local', lang: 'en-US', network: false, default: true }]));
      assert(await page.evaluate(() => speechSynthesis.getVoices().length) === 1, `${name}: Android voices listed`);

      // Dark theme recolours the bars.
      await page.waitForTimeout(1500);
      await page.reload();
      await page.waitForSelector('.saved-item');
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.waitForFunction(() => { const b = window.__calls.filter((c) => c.type === 'bars').pop(); return b && b.data.dark; });
      assert(true, `${name}: dark theme gives dark system bars`);
      await noSideScroll('the saved puzzles list');
      if (shots) await page.screenshot({ path: `${shots}/${name}-3-saved-dark.png`, fullPage: true });

      // Saving to a file goes to the system "Save to" picker.
      await page.locator('.saved-item [data-do=export]').first().tap();
      await page.waitForFunction(() => window.__calls.some((c) => c.type === 'save'));
      const save = (await calls('save'))[0].data;
      const json = JSON.parse(Buffer.from(save.data, 'base64').toString());
      assert(save.name.endsWith('.flg.json') && json.format === 'fantastical-logic-grid', `${name}: puzzle file handed to Android (${save.name})`);
      await ctx.close();
    }
    assert(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
