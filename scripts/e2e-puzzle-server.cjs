// Server mode (docs/PUZZLE-SERVER.md), end to end: a site built with
//   FLG_PUZZLE_SERVER=1 FLG_CLOUD_URL=http://localhost:8141 npm run build
// gets everything its games compute from the real puzzle server
// (puzzle-server/), through the Worker's own route code (server/src/puzzles.js)
// standing in for the Cloudflare Worker: Logic Grid puzzles and hints, and
// NINETIMESNINE puzzles, hints, the rival's moves, the Tidewater tide and the
// Puzzle Wizard's one-answer check. No generator or solver is ever downloaded.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'dist', 'web');
const KEY = 'e2e-puzzle-key-'.padEnd(48, 'z');
const [SITE_PORT, WORKER_PORT, PUZZLE_PORT] = [8140, 8141, 8142];

(async () => {
  if (fs.existsSync(path.join(SITE, 'engine', 'generator.js'))) throw new Error('dist/web still has the generator: build with FLG_PUZZLE_SERVER=1 FLG_CLOUD_URL=http://localhost:8141 first');
  const { handlePuzzles } = await import(path.join(ROOT, 'server', 'src', 'puzzles.js'));
  const procs = [
    spawn('node', [path.join(__dirname, 'serve.mjs'), SITE, String(SITE_PORT)], { stdio: 'ignore' }),
    spawn('node', [path.join(ROOT, 'puzzle-server', 'server.mjs')], { env: { ...process.env, FLG_PUZZLE_KEY: KEY, PORT: String(PUZZLE_PORT), THREADS: '2', RELEASE: 'e2e' }, stdio: 'ignore' }),
  ];
  const calls = {};
  const env = {
    ALLOWED_ORIGINS: `http://localhost:${SITE_PORT}`,
    PUZZLE_KEY: KEY,
    // The Workers VPC binding: here it simply goes to the local puzzle server.
    PUZZLES: { fetch: (url, init) => fetch(String(url).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${PUZZLE_PORT}`), init) },
  };
  const worker = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = `http://localhost:${WORKER_PORT}${req.url}`;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const m = new URL(url).pathname.match(/^\/v1\/puzzles\/([a-z0-9-]+\/[a-z0-9-]+)$/);
    if (m && req.method === 'POST') calls[m[1]] = (calls[m[1]] || 0) + 1;
    let out;
    if (req.method === 'OPTIONS') {
      out = new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
    } else {
      out = (await handlePuzzles(request, env, new URL(url))) || new Response('{"error":"not_found"}', { status: 404, headers: { 'Access-Control-Allow-Origin': req.headers.origin || '*' } });
    }
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  }).listen(WORKER_PORT);
  await new Promise((r) => setTimeout(r, 1500));

  const browser = await chromium.launch();
  const errors = [];
  const fetched = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => fetched.push(r.url()));
    await page.goto(`http://localhost:${SITE_PORT}/`);
    await page.waitForSelector('#dlg-welcome[open]');
    await page.click('#welcome-skip');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
    assert(await page.locator('td.c').count() === 3 * 16, 'a quick puzzle from the puzzle server is on the grid');
    assert(calls['flg/generate'] >= 1, 'the page asked the puzzle server for it');
    const waitFor = async (op, before = 0) => { for (let i = 0; i < 150 && (calls[op] || 0) <= before; i++) await page.waitForTimeout(100); return (calls[op] || 0) > before; };
    await page.keyboard.press('h');
    assert(await waitFor('flg/hint'), 'hints come from the puzzle server');

    // NINETIMESNINE.
    const G = () => page.evaluate(async () => (await import('./modules/number-place/ui.js')).state());
    // The page's security policy allows no eval, so each wait checks one field.
    const until = async (key, value, ms = 20000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await page.waitForTimeout(100)) if (await page.evaluate(async ([k, v]) => { const g = (await import('./modules/number-place/ui.js')).state(); return !!g && g[k] === v; }, [key, value])) return true;
      throw new Error(`FAIL: timed out waiting for ${key} = ${value}`);
    };
    const start = async (style) => {
      if (!(await page.locator('#np-setup-view').isVisible())) await page.click('#np-new');
      await page.check(`input[name=np-style][value=${style}]`, { force: true });
      await page.check('input[name=np-level][value=easy]', { force: true });
      await page.click('#np-gen');
      await page.waitForSelector('#np-play-view:not([hidden])', { timeout: 60000 });
      await until('style', style);
      if (await page.locator('#np-coach').isVisible()) await page.click('#np-coach-close');
    };
    await page.click('#menu-btn');
    await page.click('[data-cmd=numberplace]');
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-levels .choice', { timeout: 20000 });
    await start('classic');
    assert(calls['np/generate'] >= 1, 'a NINETIMESNINE puzzle from the puzzle server is on the board');
    await page.click('#np-hint-btn');
    await page.waitForSelector('#np-hint:not([hidden])');
    assert(await waitFor('np/hint'), 'NINETIMESNINE hints come from the puzzle server');
    await start('rival');
    // Place a right number on your turn; the turn then passes to the rival,
    // whose move comes from the puzzle server. Tips that pop up late can
    // cover the board, so close them and try again if the turn did not pass.
    let moved = false;
    for (let tries = 0; tries < 3 && !moved; tries++) {
      await until('turn', 'you');
      if (await page.locator('#np-coach').isVisible()) await page.click('#np-coach-close');
      const g = await G();
      const empty = g.p.solution.findIndex((d, i) => !g.p.givens[i] && !g.v[i]);
      await page.locator(`#np-board .np-cell[data-i="${empty}"]`).click();
      await page.keyboard.press(String(g.p.solution[empty]));
      moved = await waitFor('np/move');
    }
    assert(moved, 'the rival\'s moves come from the puzzle server');
    await start('tide');
    assert(calls['np/tide'] >= 1 && calls['np/ebb'] >= 1, 'the Tidewater tide comes from the puzzle server');
    const check = await page.evaluate(async () => (await import('./js/wizard-build.js')).checkGivens({ size: 4, diagonal: false, givens: Array(16).fill(0) }));
    assert(/more than one answer/.test(check.words) && check.suggestion && calls['np/check'] >= 1, 'the Puzzle Wizard\'s one-answer check comes from the puzzle server');

    const leaked = fetched.filter((u) => /\/engine\/(generator|solver|hints|clues|topics|storylines|themes|index|story|classroom-build|number-place|number-place-styles|number-place-wizard|flg-ops|np-ops)\.js|engine-worker\.js/.test(u));
    assert(leaked.length === 0, `no generator or solver file was requested${leaked.length ? `: ${leaked.join(', ')}` : ''}`);

    // Offline, a new puzzle gives the player plain words, not a crash.
    await ctx.setOffline(true);
    const word = await page.evaluate(async () => {
      const m = await import('./js/engine-client.js');
      try { await m.generate({ difficulty: 'easy', seed: 'offline' }); return 'no error'; } catch (e) { return e.message; }
    });
    assert(/internet connection/i.test(word), 'offline: "needs an internet connection"');
    await ctx.setOffline(false);
    assert(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log('Server mode end-to-end test passed.');
  } finally {
    await browser.close();
    worker.close();
    for (const p of procs) p.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
