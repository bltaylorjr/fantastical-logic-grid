// End-to-end check of fingerprint or face sign-in and idle sign-out. Chrome's
// virtual authenticator stands in for the fingerprint reader (it says the
// owner was verified), and the idle time is set to a few seconds in the
// stored admin config. Runs the real sync Worker in Miniflare and a stand-in
// for Firebase Auth, like e2e-accounts.cjs. Needs `npm install` in server/.
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
const IDLE_MINUTES = 0.15; // 9 seconds; the warning shows halfway

// ------------------------------------------------ stand-in for Firebase Auth
function startAuth(signer) {
  const users = new Map(); // email -> { uid, password }
  const refresh = new Map(); // refresh token -> uid
  const emails = [];
  const session = (u) => {
    const rt = crypto.randomUUID();
    refresh.set(rt, u.uid);
    return { localId: u.uid, email: u.email, idToken: signer.token({ sub: u.uid, email: u.email }), refreshToken: rt, expiresIn: '3600' };
  };
  const err = (res, message) => { res.writeHead(400, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ error: { code: 400, message } })); };
  const uidOf = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).sub;
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const route = new URL(req.url, 'http://x').pathname;
      const body = (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
      const ok = (data) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)); };
      const find = (uid) => [...users.values()].find((u) => u.uid === uid);
      if (route === '/v1/accounts:signUp') {
        if (users.has(body.email)) return err(res, 'EMAIL_EXISTS');
        if (body.password.length < 6) return err(res, 'WEAK_PASSWORD : Password should be at least 6 characters');
        const u = { uid: crypto.randomUUID().replace(/-/g, '').slice(0, 28), email: body.email, password: body.password };
        users.set(body.email, u);
        return ok(session(u));
      }
      if (route === '/v1/accounts:signInWithPassword') {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return err(res, 'INVALID_LOGIN_CREDENTIALS');
        return ok(session(u));
      }
      if (route === '/v1/accounts:sendOobCode') { emails.push({ type: body.requestType, email: body.email || (find(uidOf(body.idToken)) || {}).email }); return ok({}); }
      if (route === '/v1/accounts:lookup') return ok({ users: [{ emailVerified: false }] });
      if (route === '/v1/accounts:delete') { const u = find(uidOf(body.idToken)); if (u) users.delete(u.email); return ok({}); }
      if (route === '/v1/token') {
        const uid = refresh.get(body.refresh_token);
        const u = uid && find(uid);
        if (!u) return err(res, 'USER_NOT_FOUND');
        return ok({ id_token: signer.token({ sub: u.uid, email: u.email }), refresh_token: body.refresh_token, expires_in: '3600', user_id: u.uid });
      }
      err(res, 'NOT_FOUND');
    });
  });
  server.listen(AUTH_PORT);
  return { server, users, emails };
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
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  await ctx.route('https://api.pwnedpasswords.com/range/**', (r) => r.fulfill({ contentType: 'text/plain', body: '0000000000000000000000000000000000B:0\r\n' }));
  await ctx.addInitScript((mins) => {
    if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' }));
    localStorage.setItem('flg.remoteConfig', JSON.stringify({ announcements: [], disabledThemes: [], features: {}, defaults: {}, game: { idleMinutes: mins }, news: [], fetchedAt: Date.now() }));
  }, IDLE_MINUTES);
  await ctx.addInitScript(() => { try { localStorage.setItem('flg.savedOpen', 'true'); } catch (e) { /* none */ } }); // Saved Puzzles box open (its sync button is inside)
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/reading 'waiting'/.test(String(e))) errors.push(String(e)); });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // The pretend fingerprint reader.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  const signedInAs = () => page.evaluate(async () => (await import('./js/account.js')).current()?.email || null);
  const marks = (title) => page.evaluate(async (t) => { const s = (await (await import('./js/store.js')).listSaves()).find((v) => v.name === t); return s ? Object.keys(s.marks || {}).length : -1; }, title);

  try {
    await page.goto(`${APP}/`);
    await page.waitForSelector('#tier-choices input');

    // ---- Create an account with a password.
    await page.click('#sync-btn');
    await page.waitForSelector('#dlg-account[open]');
    assert(await page.isHidden('#si-bio-box'), 'no fingerprint button before the device knows the account');
    await page.click('[data-view=signin] [data-go=signup]');
    await page.fill('#su-email', 'player@example.com');
    await page.fill('#su-pass', 'correct horse battery');
    await page.click('[data-view=signup] button[type=submit]');
    await page.waitForSelector('[data-view=account]:not([hidden])');
    await page.waitForSelector('#acct-bio:not([hidden])');
    assert(true, 'the account window offers fingerprint or face sign-in');
    assert(/signed out after .* without any activity/.test(await page.textContent('#acct-idle')), 'the account window says players are signed out when idle');

    // ---- Turn it on: the device makes a passkey.
    await page.check('#acct-bio-on');
    await page.waitForFunction(() => /is on for this device/.test(document.querySelector('#acct-bio-msg').textContent));
    const bio = await page.evaluate(() => JSON.parse(localStorage.getItem('flg.bio')));
    assert(bio && bio.id && bio.key && bio.email === 'player@example.com', 'a passkey for this account is saved on the device');
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    assert(credentials.length === 1, 'the device holds one passkey');
    await page.click('#dlg-account .dlg-actions:last-child [data-close]');
    await page.waitForSelector('#dlg-name[open]');
    await page.fill('#name-input', 'Idle Tester');
    await page.click('#name-form button[type=submit]');
    await page.waitForSelector('#dlg-name[open]', { state: 'detached' });

    // ---- Play a puzzle, then stop touching anything.
    await page.check('input[name=tier][value=easy]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const title = await page.textContent('#p-title');
    await page.locator('td.c').nth(0).click();
    await page.locator('td.c').nth(5).click();
    await page.waitForSelector('#dlg-idle[open]', { timeout: 20000 });
    assert(/signed out in/.test(await page.textContent('#idle-p')), 'a "Still playing?" warning shows before the sign-out');
    await page.click('#idle-stay');
    await page.waitForSelector('#dlg-idle[open]', { state: 'detached' });
    assert(await signedInAs() === 'player@example.com', 'Keep playing keeps the player signed in');

    await page.waitForSelector('#dlg-account[open] [data-view=signin]:not([hidden])', { timeout: 30000 });
    assert(await signedInAs() === null, 'the player is signed out after the idle time');
    assert(await page.isVisible('#screen-home'), 'the game goes back to the home screen');
    assert(/without any activity/.test(await page.textContent('#si-idle')), 'the sign-in window says why');
    assert(await marks(title) === 2, 'the puzzle\'s marks were saved before the sign-out');
    const synced = await db.prepare("SELECT data FROM sync_records WHERE kind = 'save'").all();
    assert(synced.results.some((r) => Object.keys(JSON.parse(r.data).marks || {}).length === 2), 'the progress reached the account before the sign-out');
    assert(await page.isVisible('#si-bio'), 'the sign-in window offers the fingerprint or face button');
    assert(await page.inputValue('#si-email') === 'player@example.com', 'the email is filled in for a password sign-in');
    assert(await page.evaluate(() => !!localStorage.getItem('flg.authLocked') && !localStorage.getItem('flg.auth')), 'the session is locked, not open');

    // ---- A failed device check keeps the player signed out.
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.click('#si-bio');
    await page.waitForSelector('#si-bio-error:not([hidden])');
    assert(await signedInAs() === null, 'without a verified fingerprint or face the player stays signed out');
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });

    // ---- Fingerprint or face: back in, on the same puzzle.
    await page.click('#si-bio');
    await page.waitForSelector('#dlg-account[open]', { state: 'detached' });
    assert(await signedInAs() === 'player@example.com', 'the fingerprint or face check signs the player back in');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert(await page.textContent('#p-title') === title, 'the puzzle they were on opens again');
    assert(await page.evaluate(() => window.__flg.state.marks.size) === 2, 'with its marks, where they left off');

    // ---- Opening the game after the idle time has passed signs out at once.
    await page.evaluate(() => localStorage.setItem('flg.lastActive', String(Date.now() - 3600_000)));
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    await page.waitForFunction(async () => !(await import('./js/account.js')).current(), null, { timeout: 15000 });
    assert(true, 'coming back after a long time away needs a new sign-in');
    await page.evaluate(async () => (await import('./js/account-ui.js')).openAccount());
    await page.click('#si-bio');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 15000 });
    assert(await page.textContent('#p-title') === title, 'after signing in, the last unfinished puzzle opens again');

    // ---- Signing out by hand drops the locked session; the password works.
    await page.click('#home-btn');
    await page.evaluate(async () => (await import('./js/account-ui.js')).openAccount());
    await page.click('[data-view=account] [data-go=signout]');
    await page.click('[data-view=signout] button[type=submit]');
    await page.waitForSelector('#dlg-account[open]', { state: 'detached' });
    assert(await page.evaluate(() => !localStorage.getItem('flg.authLocked')), 'signing out by hand leaves no session on the device');
    await page.click('#sync-btn');
    assert(await page.isHidden('#si-bio-box'), 'after signing out by hand, the password is needed');
    await page.fill('#si-email', 'player@example.com');
    await page.fill('#si-pass', 'correct horse battery');
    await page.click('[data-view=signin] button[type=submit]');
    await page.waitForFunction(async () => !!(await import('./js/account.js')).current());
    assert(true, 'the password still signs in');
    assert(errors.length === 0, `no console errors ${errors.join(' | ')}`);
  } catch (e) {
    console.error('page errors:', errors);
    throw e;
  } finally {
    await browser.close();
    app.kill();
    auth.server.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
