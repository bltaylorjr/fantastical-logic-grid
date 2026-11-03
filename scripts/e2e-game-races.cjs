// End-to-end check of races in NINETIMESNINE, Cage Math, Sum Cross and Picture
// Grid (web/js/game-race.js) with two players on two pretend devices, on the
// games' own pages. Runs the real Worker in Miniflare with a local D1 database
// and a small stand-in for Firebase Auth, like scripts/e2e-compete.cjs. Needs
// `npm install` in server/ and a build (npm run test:compete does both).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const PROJECT = 'flg-e2e';
const AUTH_PORT = 8151, API_PORT = 8152, APP_PORT = 8153;
const APP = `http://localhost:${APP_PORT}`;

function startAuth(signer) {
  const refresh = new Map();
  const ok = (res, data) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)); };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const route = new URL(req.url, 'http://x').pathname;
      const body = (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
      if (route === '/v1/accounts:signUp') {
        const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 28), rt = crypto.randomUUID();
        refresh.set(rt, { uid, email: body.email });
        return ok(res, { localId: uid, email: body.email, idToken: signer.token({ sub: uid, email: body.email }), refreshToken: rt, expiresIn: '3600' });
      }
      if (route === '/v1/token') {
        const u = refresh.get(body.refresh_token);
        return ok(res, { id_token: signer.token({ sub: u.uid, email: u.email }), refresh_token: body.refresh_token, expires_in: '3600', user_id: u.uid });
      }
      return ok(res, {});
    });
  });
  server.listen(AUTH_PORT);
  return server;
}

(async () => {
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const signer = makeSigner(PROJECT);
  const auth = startAuth(signer);
  const mf = new Miniflare({
    port: API_PORT, modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'), compatibilityDate: '2026-08-01', d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: APP, TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'site'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const config = `export const CLOUD = { firebaseApiKey: 'test-key', syncUrl: 'http://localhost:${API_PORT}', authUrl: 'http://localhost:${AUTH_PORT}/v1', tokenUrl: 'http://localhost:${AUTH_PORT}/v1', learnUrl: '' };\nexport const cloudEnabled = () => true;\nexport const CLOUD_URL = '';\n`;
  const browser = await chromium.launch();
  const errors = [];
  const contexts = [];
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    contexts.push(ctx);
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true })); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|status of 404/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    return page;
  }
  const open = async (page, url, game) => { await page.goto(`${APP}/${url}`); await page.waitForSelector(`#${game}-race-card`, { timeout: 30000 }); };
  const signUp = (page, email) => page.evaluate(async (e) => (await import('/js/account.js')).signUp(e, 'correct horse battery'), email);
  const dlg = (page) => page.locator('dialog[open]');
  // Finishes the open race puzzle the way a player would end it: the module's
  // game is filled in with the answer (or revealed) and marked done.
  const finishPuzzle = (page, mod, { reveal = false, ms = 40_000, hints = 0 } = {}) => page.evaluate(async ([m, rv, t, h]) => {
    const g = (await import(m)).state();
    g.v = g.p.solution.map((d, i) => (g.p.givens[i] ? 0 : d));
    Object.assign(g, { solved: true, revealed: rv, ms: t, hints: h });
  }, [mod, reveal, ms, hints]);

  try {
    // ---- NINETIMESNINE: a signed-out player is asked to sign in.
    const A = await device('A');
    await open(A, 'ninetimesnine/', 'np');
    assert(/Sign in with a free account/.test(await A.textContent('#np-race-card')), 'NINETIMESNINE offers races, with sign-in');
    await signUp(A, 'ann@example.com');
    await A.reload(); await A.waitForSelector('#np-race-card');
    await A.waitForFunction(() => /Choose a screen name/.test(document.querySelector('#np-race-card').textContent));
    await A.click('#np-race-card [data-race=name]');
    await A.fill('#np-race-name', 'Ann Racer');
    await dlg(A).locator('.race-view:not([hidden]) button[type=submit]').click();
    await A.waitForFunction(() => /Racing as Ann Racer/.test(document.querySelector('#np-race-card').textContent));
    assert(true, 'a screen name can be chosen right in the game');

    // ---- A starts a race with the setup's choices.
    await A.click('input[name=np-level][value=basic]', { force: true });
    await A.click('#np-race-card [data-race=start]');
    assert(/Basic/.test(await dlg(A).textContent()), 'Start a race uses the setup choices');
    await dlg(A).locator('.race-view:not([hidden]) button[type=submit]').click();
    await A.waitForFunction(() => /^[A-Z2-9]{6}$/.test(document.querySelector('dialog[open] [data-r=code]')?.textContent || ''));
    const code = await dlg(A).locator('[data-r=code]').textContent();
    assert((await dlg(A).locator('[data-r=link]').textContent()).endsWith(`/ninetimesnine/?race=${code}`), 'the race link opens NINETIMESNINE');
    await dlg(A).locator('.race-view:not([hidden]) .dlg-actions .primary').click();
    await A.waitForSelector('#np-play-view .race-bar:not([hidden])');
    assert((await A.textContent('#np-play-view .race-bar')).includes(code), 'the race bar shows the code while playing');

    // ---- B opens the race link: signed out first, then signed in, joins.
    const B = await device('B');
    await open(B, `ninetimesnine/?race=${code}`, 'np');
    assert((await B.textContent('#np-race-card')).includes(`Sign in to join race ${code}`), 'a race link asks a signed-out player to sign in');
    assert(await B.isVisible('#np-race-card [data-race=signin]'), 'the card offers Sign in to race');
    await signUp(B, 'ben@example.com');
    await B.evaluate(async () => (await import('/js/compete.js')).setName('Ben Swift'));
    // Approve both names the way an admin does, so each sees the other's name.
    await db.prepare("INSERT OR REPLACE INTO name_reviews (user_id, name_key, reviewed_by, reviewed_at) SELECT user_id, name_key, 'test', 1 FROM players").run();
    // Signing in on the Account page brings the player back to the race (as the Sign in button does).
    await B.goto(`${APP}/account/?game=np&race=${code}&next=https://evil.example/`);
    await B.waitForURL(new RegExp(`/ninetimesnine/\\?race=${code}$|/ninetimesnine/$`), { timeout: 30000 });
    await B.waitForSelector('#np-play-view .race-bar:not([hidden])', { timeout: 30000 });
    assert(true, 'once signed in, the Account page sends the player back to the race, who joins it');
    const same = await Promise.all([A, B].map((p) => p.evaluate(async () => (await import('/modules/number-place/ui.js')).state().p.fingerprint)));
    assert(same[0] === same[1], 'both players have the very same puzzle');

    // ---- B solves first (faster), A solves with a hint: standings.
    await finishPuzzle(B, '/modules/number-place/ui.js', { ms: 30_000 });
    await B.waitForFunction(() => /Ben Swift/.test(document.querySelector('dialog[open]')?.textContent || ''), null, { timeout: 15000 });
    assert(/Solved/.test(await dlg(B).textContent()), 'a solve is sent and the standings open');
    await finishPuzzle(A, '/modules/number-place/ui.js', { ms: 20_000, hints: 1 });
    await A.waitForFunction(() => document.querySelectorAll('dialog[open] tbody tr').length === 2, null, { timeout: 15000 });
    const rows = await A.$$eval('dialog[open] tbody tr', (trs) => trs.map((t) => t.textContent.replace(/\s+/g, ' ').trim()));
    assert(/^1 Ben Swift/.test(rows[0]) && /^2 Ann Racer/.test(rows[1]), `the hint penalty decides the race (${rows.join(' / ')})`);
    assert(/points on the scoreboard/.test(await A.textContent('#np-race-card')), 'the finish shows the points earned');

    // ---- Cage Math: a race, joined with the code; a reveal counts as giving up.
    await open(A, 'cage-math/', 'cm');
    await A.click('#cm-race-card [data-race=start]');
    await dlg(A).locator('.race-view:not([hidden]) button[type=submit]').click();
    await A.waitForFunction(() => /^[A-Z2-9]{6}$/.test(document.querySelector('dialog[open] [data-r=code]')?.textContent || ''));
    const cmCode = await dlg(A).locator('[data-r=code]').textContent();
    await dlg(A).locator('.race-view:not([hidden]) .dlg-actions .primary').click();
    await open(B, 'cage-math/', 'cm');
    await B.click('#cm-race-card [data-race=join]');
    await B.fill('#cm-race-code', cmCode.toLowerCase());
    await dlg(B).locator('.race-view:not([hidden]) button[type=submit]').click();
    await B.waitForSelector('#cm-play-view .race-bar:not([hidden])');
    assert(true, 'Cage Math: a race is joined with its code');
    await finishPuzzle(B, '/modules/cage-math/ui.js', { reveal: true });
    await B.waitForFunction(() => /Revealed the answer/.test(document.querySelector('dialog[open]')?.textContent || ''), null, { timeout: 20000 });
    assert(true, 'Cage Math: revealing the answer counts as giving up');

    // ---- Picture Grid: Find a race finds an open race in this game only.
    await open(A, 'picture-grid/', 'pg');
    await A.click('#pg-race-card [data-race=start]');
    await dlg(A).locator('.race-view:not([hidden]) button[type=submit]').click();
    await A.waitForFunction(() => /^[A-Z2-9]{6}$/.test(document.querySelector('dialog[open] [data-r=code]')?.textContent || ''));
    const pgCode = await dlg(A).locator('[data-r=code]').textContent();
    await dlg(A).locator('.race-view:not([hidden]) .dlg-actions .primary').click();
    await open(B, 'picture-grid/', 'pg');
    await B.click('#pg-race-card [data-race=find]');
    await B.waitForSelector('#pg-play-view .race-bar:not([hidden])', { timeout: 30000 });
    assert((await B.textContent('#pg-play-view .race-bar')).includes(pgCode), 'Picture Grid: Find a race joins the open Picture Grid race');
    await finishPuzzle(B, '/modules/picture-grid/ui.js', { ms: 25_000 });
    await B.waitForFunction(() => /Solved/.test(document.querySelector('dialog[open]')?.textContent || ''), null, { timeout: 15000 });
    assert(true, 'Picture Grid: a solved picture is accepted');

    // ---- Sum Cross: a Cage Math race code opens on the Cage Math page.
    await open(B, 'sum-cross/', 'sc');
    await B.click('#sc-race-card [data-race=join]');
    await B.fill('#sc-race-code', cmCode);
    await dlg(B).locator('.race-view:not([hidden]) button[type=submit]').click();
    await B.waitForURL(/\/cage-math\//, { timeout: 15000 });
    assert(true, "a race code from another game opens that game's page");

    const r = await db.prepare('SELECT game, COUNT(*) AS n FROM races GROUP BY game ORDER BY game').all();
    assert(JSON.stringify(r.results) === JSON.stringify([{ game: 'cm', n: 1 }, { game: 'np', n: 1 }, { game: 'pg', n: 1 }]), 'each race is kept with its game');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close();
    app.kill(); auth.close(); await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
