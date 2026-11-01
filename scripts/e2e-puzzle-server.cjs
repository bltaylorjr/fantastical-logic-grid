// Server mode (docs/PUZZLE-SERVER.md), end to end: a site built with
//   FLG_PUZZLE_SERVER=1 FLG_CLOUD_URL=http://localhost:8141 npm run build
// gets its puzzles and hints from the real puzzle server (puzzle-server/),
// through the Worker's own route code (server/src/puzzles.js) standing in
// for the Cloudflare Worker, and never downloads the generator.
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
  const calls = { generate: 0, hint: 0 };
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
    const m = new URL(url).pathname.match(/^\/v1\/puzzles\/(generate|hint)$/);
    if (m && req.method === 'POST') calls[m[1]]++;
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
    assert(calls.generate >= 1, `the page asked the puzzle server for it (${calls.generate} request)`);
    const before = calls.hint;
    await page.keyboard.press('h');
    for (let i = 0; i < 50 && calls.hint === before; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(800);
    assert(calls.hint > before, 'hints come from the puzzle server');
    const leaked = fetched.filter((u) => /\/engine\/(generator|solver|hints|clues|topics|storylines|themes|index)\.js|\/worker\.js/.test(u));
    assert(leaked.length === 0, `no generator file was requested${leaked.length ? `: ${leaked.join(', ')}` : ''}`);

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
