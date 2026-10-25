// End-to-end check of screen names, races and the scoreboard with two players
// on two pretend devices. Runs the real Worker in Miniflare with a local D1
// database and a small stand-in for Firebase Auth. Needs `npm install` in
// server/ first (npm run test:compete does that).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const PROJECT = 'flg-e2e';
const AUTH_PORT = 8141;
const API_PORT = 8142;
const APP_PORT = 8143;
const APP = `http://localhost:${APP_PORT}`;

// Just enough of Firebase Auth for signing up and renewing tokens.
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
        const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 28);
        const rt = crypto.randomUUID();
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
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: APP, TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  const config = `export const CLOUD = { firebaseApiKey: 'test-key', syncUrl: 'http://localhost:${API_PORT}', authUrl: 'http://localhost:${AUTH_PORT}/v1', tokenUrl: 'http://localhost:${AUTH_PORT}/v1', learnUrl: '' };\nexport const cloudEnabled = () => true;\nexport const CLOUD_URL = '';\n`;
  const browser = await chromium.launch();
  const errors = [];
  async function device(name, url = `${APP}/`) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true })); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { if (!/reading 'waiting'/.test(String(e))) errors.push(`${name}: ${e}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    await page.goto(url);
    await page.waitForSelector('#tier-choices input');
    return { ctx, page };
  }
  const signUp = (page, email) => page.evaluate(async (e) => (await import('./js/account.js')).signUp(e, 'correct horse battery'), email);
  const cardText = (page) => page.textContent('#compete-section');
  // Fills the grid with the answer through the real cell clicks (one click
  // rules out, two confirm). With `hints`, takes that many hints first.
  async function solve(page, { hints = 0 } = {}) {
    for (let i = 0; i < hints; i++) { await page.click('[data-act=hint]'); await page.waitForTimeout(300); }
    const plan = await page.evaluate(() => {
      const S = window.__flg.state;
      const out = [];
      for (const [k, td] of S.grid.cells) {
        td.dataset.k = k;
        const [a, b] = k.split('|');
        const match = S.puzzle.solution.some((row) => { const v = Object.values(row); return v.includes(a) && v.includes(b); });
        const cur = S.marks.get(k) || '';
        out.push({ k, clicks: match ? (cur === 'O' ? 0 : cur === 'X' ? 1 : 2) : (cur === 'X' ? 0 : cur === 'O' ? 2 : 1) });
      }
      return out;
    });
    for (const { k, clicks } of plan) for (let i = 0; i < clicks; i++) await page.click(`td[data-k="${k}"]`);
    await page.waitForSelector('#solved:not([hidden])');
  }
  const pickSmall = async (page) => {
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.check('input[name=size][value="3x3"]', { force: true });
  };

  try {
    // ---- A guest sees the offer and the scoreboard, but needs an account to race.
    const A = await device('A');
    assert(await A.page.isVisible('#compete-section'), 'home shows Play against others');
    assert(/never need an account to play on your own/.test(await cardText(A.page)), 'solo play needs no account');
    await A.page.click('[data-compete=board]');
    await A.page.waitForSelector('#dlg-board[open]');
    await A.page.waitForFunction(() => /No one is on the scoreboard/.test(document.querySelector('#board-body').textContent));
    assert(true, 'a guest can open the scoreboard');
    await A.page.keyboard.press('Escape');
    await A.page.click('[data-compete=signin]');
    assert(await A.page.isVisible('#dlg-account[open]'), '"Sign in to race" opens sign-in');
    await A.page.keyboard.press('Escape');

    // ---- A signs in and picks a screen name; rude names are refused.
    await signUp(A.page, 'ann@example.com');
    await A.page.waitForSelector('[data-compete=name]');
    await A.page.click('[data-compete=name]');
    await A.page.waitForSelector('#dlg-name[open]');
    await A.page.fill('#name-input', 'sh1t');
    await A.page.click('#name-form button[type=submit]');
    await A.page.waitForSelector('#name-form .error-box:not([hidden])');
    assert(/not allowed/.test(await A.page.textContent('#name-form .error-box')), 'a rude screen name is refused');
    assert(await A.page.getAttribute('#name-input', 'aria-invalid') === 'true', 'the name field is marked invalid');
    await A.page.fill('#name-input', 'Sky Fox');
    await A.page.click('#name-form button[type=submit]');
    await A.page.waitForSelector('#dlg-name[open]', { state: 'detached' });
    assert(/Playing as Sky Fox/.test(await A.page.textContent('#compete-me')), 'home shows the screen name');

    // ---- B wants the same name.
    const B = await device('B');
    await signUp(B.page, 'ben@example.com');
    await B.page.waitForSelector('[data-compete=name]');
    await B.page.click('[data-compete=name]');
    await B.page.fill('#name-input', 'sky_f0x');
    await B.page.click('#name-form button[type=submit]');
    await B.page.waitForSelector('#name-form .error-box:not([hidden])');
    assert(/already has that screen name/.test(await B.page.textContent('#name-form .error-box')), 'a look-alike of a taken name is refused');
    await B.page.fill('#name-input', 'Bold Badger');
    await B.page.click('#name-form button[type=submit]');
    await B.page.waitForSelector('#dlg-name[open]', { state: 'detached' });

    // ---- A starts a race.
    await pickSmall(A.page);
    await A.page.click('[data-compete=start]');
    await A.page.waitForSelector('#dlg-race[open] [data-view=start]:not([hidden])');
    assert(/Basic · .* · 3 × 3/.test(await A.page.textContent('#race-choice')), 'the race uses the New puzzle choices');
    await A.page.click('[data-view=start] button[type=submit]');
    await A.page.waitForSelector('[data-view=share]:not([hidden])', { timeout: 30000 });
    const code = await A.page.textContent('#race-code-big');
    assert(/^[A-Z2-9]{6}$/.test(code), `race code shown (${code})`);
    assert((await A.page.getAttribute('#race-link', 'href')) === `https://thelogicgrid.com/?race=${code}`, 'a share link is shown');
    await A.page.click('[data-view=share] [data-close]');
    assert(await A.page.isVisible('#race-bar'), 'the play screen shows the race bar');
    const title = await A.page.textContent('#p-title');

    // ---- B joins with the code from a link and gets the same puzzle.
    await B.page.goto(`${APP}/?race=${code}`);
    await B.page.waitForSelector('#dlg-race[open] [data-view=join]:not([hidden])');
    assert(await B.page.inputValue('#race-code') === code, 'a race link fills in the code');
    assert(!B.page.url().includes('race='), 'the link is tidied from the address bar');
    await B.page.click('[data-view=join] button[type=submit]');
    await B.page.waitForSelector('#screen-play:not([hidden])');
    assert(await B.page.textContent('#p-title') === title, `B plays the same puzzle ("${title}")`);
    const usedB = await B.page.evaluate(async () => (await import('./js/store.js')).getMeta('usedStories', []));
    const storyId = await B.page.evaluate(() => window.__flg.state.save.storyId);
    assert(usedB.includes(storyId), 'the race story is marked as used for B');

    // ---- B solves cleanly; A solves with two hints and comes second.
    await solve(B.page);
    await B.page.waitForFunction(() => /place 1|first place/i.test(document.querySelector('#compete-result').textContent), null, { timeout: 10000 });
    assert(true, 'B is told their place');
    await solve(A.page, { hints: 2 });
    await A.page.waitForFunction(() => /place 2/.test(document.querySelector('#compete-result').textContent), null, { timeout: 10000 });
    const rows = await A.page.$$eval('#compete-result tbody tr', (trs) => trs.map((t) => t.querySelector('th').textContent));
    assert(/Bold Badger/.test(rows[0]) && /Sky Fox/.test(rows[1]), `standings: hints add time (${rows.join(' / ')})`);
    await B.page.click('#race-result-refresh');
    await B.page.waitForFunction(() => /first place/.test(document.querySelector('#compete-result').textContent));
    assert(true, 'B sees they won after refreshing');
    await B.page.locator('#solved').screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'compete-race-result.png') });

    // ---- A solo puzzle earns points.
    await A.page.click('#home-btn');
    await pickSmall(A.page);
    await A.page.click('#gen-btn');
    await A.page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await A.page.isHidden('#race-bar'), 'no race bar on a solo puzzle');
    await solve(A.page);
    await A.page.waitForFunction(() => /\+\d+ points/.test(document.querySelector('#compete-result').textContent), null, { timeout: 10000 });
    assert(true, 'a solo solve adds points to the scoreboard');

    // ---- The scoreboard ranks both players.
    await A.page.click('#compete-result [data-compete=board]');
    await A.page.waitForSelector('#dlg-board[open] table.board');
    const board = await A.page.$$eval('#board-body tbody tr', (trs) => trs.map((t) => [...t.children].map((c) => c.textContent.trim())));
    assert(board.length === 2, `two players on the board (${JSON.stringify(board)})`);
    const badger = board.find((r) => /Bold Badger/.test(r[1]));
    assert(badger && badger[4] === '1', 'B has one race win');
    assert(/You \(Sky Fox\) are number/.test(await A.page.textContent('#board-me')), 'A sees their own place');
    assert(await A.page.$$eval('#board-body tr.me', (t) => t.length) === 1, 'A\'s row is highlighted');
    await A.page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'compete-board.png') });
    await A.page.click('#dlg-board [data-rules]');
    await A.page.waitForSelector('#dlg-rules[open]');
    assert(/Race time<\/b> = solve time \+ 1 minute per hint/.test(await A.page.innerHTML('#dlg-rules')), 'the scoreboard links to the scoring and race rules');
    await A.page.locator('#dlg-rules').screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'compete-rules.png') });
    await A.page.click('#dlg-rules [data-close]');
    assert(await A.page.isVisible('#dlg-board[open]'), 'closing the rules returns to the scoreboard');
    await A.page.check('input[name=board-period][value=all]', { force: true });
    await A.page.waitForFunction(() => document.querySelectorAll('#board-body tbody tr').length === 2);
    assert(true, 'the all-time board works');
    await A.page.keyboard.press('Escape');
    await A.page.click('#home-btn');

    // ---- Find a race: B starts an open race, A is matched with it.
    await B.page.click('#home-btn');
    await pickSmall(B.page);
    await B.page.click('[data-compete=start]');
    await B.page.click('[data-view=start] button[type=submit]');
    await B.page.waitForSelector('[data-view=share]:not([hidden])', { timeout: 30000 });
    const code2 = await B.page.textContent('#race-code-big');
    await B.page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'compete-share.png') });
    await B.page.click('[data-view=share] [data-close]');
    await A.page.click('[data-compete=find]');
    await A.page.waitForSelector('#screen-play:not([hidden])', { timeout: 10000 });
    assert(await A.page.evaluate(() => window.__flg.state.save.race.code) === code2, 'Find a race joins the open race');
    await A.page.click('#race-standings');
    await A.page.waitForFunction(() => document.querySelectorAll('#race-standings-body tbody tr').length === 2);
    assert(/Still solving/.test(await A.page.textContent('#race-standings-body')), 'standings show who is still solving');
    await A.page.keyboard.press('Escape');
    await A.page.click('#home-btn');
    await A.page.waitForSelector('#saved-list .pill');
    assert(/Race /.test(await A.page.textContent('#saved-list')), 'race puzzles are marked in Saved puzzles');
    await A.page.locator('.home-side').screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'compete-home.png') });
    await A.page.click('[data-compete=find]');
    await A.page.waitForFunction(() => /No open races/.test(document.querySelector('#compete-error').textContent));
    assert(true, 'no race is offered twice');

    // ---- Leaving the scoreboard removes the name and scores.
    await A.page.click('#compete-me [data-compete=name]');
    await A.page.click('#name-leave summary');
    await A.page.click('#name-leave-btn');
    await A.page.click('#confirm-yes');
    await A.page.waitForSelector('[data-compete=name].primary, #compete-actions [data-compete=name]');
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM scores s JOIN players p ON p.user_id = s.user_id WHERE p.screen_name = ?').bind('Sky Fox').first();
    assert(n === 0 && !(await db.prepare("SELECT 1 FROM players WHERE screen_name = 'Sky Fox'").first()), 'leaving removes the name and scores');

    // Accessibility basics.
    const labels = await A.page.$$eval('#dlg-name input, #dlg-race input', (els) => els.every((i) => i.labels && i.labels.length));
    assert(labels, 'every field in the race and name windows has a label');
    await B.page.click('#home-btn');
    const small = await B.page.$$eval('#compete-section button', (els) => els.filter((b) => b.offsetParent && b.offsetHeight < 44).map((b) => b.textContent));
    assert(small.length === 0, `buttons are at least 44 px tall ${small.join(', ')}`);
    assert(errors.length === 0, `no console errors ${errors.join(' | ')}`);
  } catch (e) {
    console.error('page errors:', errors);
    throw e;
  } finally {
    await browser.close();
    app.kill();
    auth.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
