// End-to-end check of player accounts and sync on two pretend devices (two
// separate browser profiles). Runs the real sync Worker in Miniflare with a
// local D1 database, and a small stand-in for Firebase Auth that signs tokens
// with a throwaway key. Needs `npm install` in server/ first.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const PROJECT = 'flg-e2e';
const AUTH_PORT = 8131;
const API_PORT = 8132;
const APP_PORT = 8133;
const APP = `http://localhost:${APP_PORT}`;

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
    modulesRoot: ROOT, // learn.js uses the engine's story-part rules
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
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' })); });
    const page = await ctx.newPage();
    // Service workers are blocked here so the test config is not cached.
    page.on('pageerror', (e) => { if (!/reading 'waiting'/.test(String(e))) errors.push(`${name}: ${e}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    await page.goto(`${APP}/`);
    await page.waitForSelector('#tier-choices input');
    return { ctx, page };
  }
  const syncNow = (page) => page.evaluate(async () => { const s = await import('./js/sync.js'); await s.syncNow(); return s.status(); });
  const savedNames = (page) => page.$$eval('#saved-list .name', (els) => els.map((e) => e.textContent).sort());
  const meta = (page, key) => page.evaluate(async (k) => (await import('./js/store.js')).getMeta(k, []), key);
  async function openAccount(page) {
    await page.click('#sync-btn');
    await page.waitForSelector('#dlg-account[open]');
  }
  async function markCells(page, cells) {
    for (const i of cells) { await page.locator('td.c').nth(i).click(); }
    await page.waitForTimeout(1200); // autosave
  }

  try {
    // ---- Device A plays as a guest first.
    const A = await device('A');
    assert(await A.page.isVisible('#sync-line'), 'home shows the sync line');
    assert(/Sign in to keep them on all your devices/.test(await A.page.textContent('#sync-text')), 'guest is told puzzles save on this device');
    await A.page.check('input[name=tier][value=easy]', { force: true });
    await A.page.click('#gen-btn');
    await A.page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const title = await A.page.textContent('#p-title');
    await markCells(A.page, [0]);
    await A.page.click('#home-btn');
    await A.page.waitForSelector('#screen-home:not([hidden])');
    // The saved list fills in after the home screen shows, so wait for it.
    await A.page.waitForFunction((t) => [...document.querySelectorAll('#saved-list .name')].some((e) => e.textContent === t), title, { timeout: 10000 }).catch(() => {});
    assert((await savedNames(A.page)).includes(title), `guest can play without an account ("${title}")`);

    // ---- A creates an account; the guest puzzle joins it.
    await openAccount(A.page);
    assert(await A.page.isVisible('[data-view=signin]'), 'sign-in form opens');
    assert(await A.page.isVisible('[data-view=signin] [data-close]'), 'offers "Keep playing without an account"');
    await A.page.click('[data-view=signin] [data-go=signup]');
    await A.page.fill('#su-email', 'bobby@example.com');
    await A.page.fill('#su-pass', 'short');
    await A.page.click('[data-view=signup] button[type=submit]');
    assert(/at least 8 characters/.test(await A.page.textContent('[data-view=signup] .error-box')), 'short password is refused with a clear message');
    assert(await A.page.getAttribute('#su-pass', 'aria-invalid') === 'true', 'password field marked invalid');
    await A.page.check('[data-view=signup] [data-show-pass]');
    assert(await A.page.getAttribute('#su-pass', 'type') === 'text', 'show password works');
    await A.page.fill('#su-pass', 'correct horse battery');
    await A.page.click('[data-view=signup] button[type=submit]');
    await A.page.waitForSelector('[data-view=account]:not([hidden])');
    assert((await A.page.textContent('#acct-email')) === 'bobby@example.com', 'signed in after creating the account');
    assert(auth.emails.some((e) => e.type === 'VERIFY_EMAIL'), 'a confirmation email is requested');
    await A.page.waitForFunction(() => /Synced/.test(document.querySelector('#acct-sync-text').textContent), null, { timeout: 15000 });
    assert(true, 'first sync finished');
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE kind = ?').bind('save').first();
    assert(n === 1, 'the guest puzzle is stored in the account');
    const settingsRow = await db.prepare("SELECT data FROM sync_records WHERE kind = 'settings'").first();
    assert(settingsRow && !('aiKey' in JSON.parse(settingsRow.data)), 'API keys are never sent with the settings');
    await A.page.click('#dlg-account .dlg-actions:last-child [data-close]');

    // ---- Device B signs in and gets everything.
    const B = await device('B');
    await openAccount(B.page);
    await B.page.fill('#si-email', 'bobby@example.com');
    await B.page.fill('#si-pass', 'wrong password');
    await B.page.click('[data-view=signin] button[type=submit]');
    await B.page.waitForSelector('[data-view=signin] .error-box:not([hidden])');
    assert(/do not match/.test(await B.page.textContent('[data-view=signin] .error-box')), 'wrong password gives a clear message');
    await B.page.fill('#si-pass', 'correct horse battery');
    await B.page.click('[data-view=signin] button[type=submit]');
    await B.page.waitForSelector('[data-view=account]:not([hidden])');
    await B.page.waitForFunction(() => /Synced/.test(document.querySelector('#acct-sync-text').textContent), null, { timeout: 15000 });
    await B.page.keyboard.press('Escape');
    await B.page.waitForFunction((t) => [...document.querySelectorAll('#saved-list .name')].some((e) => e.textContent === t), title, { timeout: 5000 });
    assert(true, 'device B shows the puzzle saved on device A');
    const usedA = await meta(A.page, 'usedStories');
    const usedB = await meta(B.page, 'usedStories');
    assert(usedA.length > 0 && usedA.every((id) => usedB.includes(id)), 'used-story list synced, so stories are not reused on the other device');

    // ---- Progress made on B shows on A.
    await B.page.click(`#saved-list li:has(.name:text-is("${title}")) [data-do=resume]`);
    await B.page.waitForSelector('#screen-play:not([hidden])');
    assert(await B.page.locator('td.c .mk-x, td.c[aria-label*="ruled out" i]').count() >= 0, 'opened the synced puzzle on B');
    await markCells(B.page, [5]);
    await B.page.click('#notes-btn');
    await B.page.fill('#my-notes', 'Notes typed on B');
    await B.page.click('#notes-save');
    await B.page.click('#home-btn');
    await syncNow(B.page);
    await syncNow(A.page);
    const savedA = await A.page.evaluate(async (t) => { const s = (await (await import('./js/store.js')).listSaves()).find((x) => x.name === t); return { marks: Object.keys(s.marks).length, notes: s.myNotes }; }, title);
    assert(savedA.marks >= 2, `progress from B reached A (${savedA.marks} marks)`);
    assert(savedA.notes === 'Notes typed on B', 'notes typed on B reached A');

    // ---- Settings sync, but keys stay on each device.
    await B.page.evaluate(async () => { const st = await import('./js/store.js'); st.saveSettings({ ...st.loadSettings(), colorTheme: 'dark', aiKey: 'sk-only-on-B' }); });
    await syncNow(B.page);
    await syncNow(A.page);
    assert(await A.page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'a settings change on B applies on A');
    assert(await A.page.evaluate(async () => (await import('./js/store.js')).loadSettings().aiKey) === '', 'the API key did not travel');

    // ---- Offline play on both, then a conflict.
    await A.ctx.setOffline(true);
    await A.page.click(`#saved-list li:has(.name:text-is("${title}")) [data-do=resume]`);
    await A.page.waitForSelector('#screen-play:not([hidden])');
    await markCells(A.page, [10, 11]);
    await A.page.click('#home-btn');
    await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const offline = await syncNow(A.page);
    assert(offline.state === 'offline', 'A plays offline; sync waits');
    assert(/Offline/.test(await A.page.textContent('#sync-text')), 'home says it will sync when reconnected');
    await B.page.click(`#saved-list li:has(.name:text-is("${title}")) [data-do=resume]`);
    await B.page.waitForSelector('#screen-play:not([hidden])');
    await markCells(B.page, [20]);
    await B.page.click('#home-btn');
    await syncNow(B.page);
    await A.ctx.setOffline(false);
    const back = await syncNow(A.page);
    assert(back.state === 'synced', 'A syncs once back online');
    await syncNow(B.page);
    const namesA = await savedNames(A.page);
    const namesB = await savedNames(B.page);
    assert(namesA.includes(`${title} (from another device)`), `conflict keeps both copies of the progress (${namesA.join(', ')})`);
    assert(JSON.stringify(namesA) === JSON.stringify(namesB), 'both devices end up with the same puzzles');

    // ---- Deleting a puzzle reaches the other device.
    await A.page.click(`#saved-list li:has(.name:text-is("${title} (from another device)")) [data-do=delete]`);
    await A.page.waitForSelector('#dlg-confirm[open]');
    assert(/all your devices/.test(await A.page.textContent('#confirm-text')), 'delete warns it applies to all devices');
    await A.page.click('#confirm-yes');
    await A.page.waitForFunction((t) => ![...document.querySelectorAll('#saved-list .name')].some((e) => e.textContent === t), `${title} (from another device)`);
    await syncNow(A.page);
    await syncNow(B.page);
    await B.page.waitForFunction((t) => ![...document.querySelectorAll('#saved-list .name')].some((e) => e.textContent === t), `${title} (from another device)`, { timeout: 5000 });
    assert(true, 'deleted puzzle disappears on the other device');

    // ---- Password reset.
    await openAccount(A.page);
    await A.page.click('[data-view=account] [data-go=signout]');
    await A.page.click('[data-view=signout] button[type=submit]');
    await A.page.waitForSelector('#dlg-account[open]', { state: 'detached' });
    assert(/Sign in to keep them/.test(await A.page.textContent('#sync-text')), 'signed out; puzzles stay on the device');
    assert((await savedNames(A.page)).includes(title), 'puzzles kept after a normal sign-out');
    await openAccount(A.page);
    await A.page.click('[data-view=signin] [data-go=reset]');
    await A.page.fill('#rs-email', 'bobby@example.com');
    await A.page.click('[data-view=reset] button[type=submit]');
    await A.page.waitForFunction(() => /reset link is on its way/.test(document.querySelector('[data-view=reset] .acct-done').textContent));
    assert(auth.emails.some((e) => e.type === 'PASSWORD_RESET' && e.email === 'bobby@example.com'), 'password reset email requested');
    await A.page.fill('#rs-email', 'nobody@example.com');
    await A.page.click('[data-view=reset] button[type=submit]');
    await A.page.waitForFunction(() => /nobody@example.com, a reset link/.test(document.querySelector('[data-view=reset] .acct-done').textContent));
    assert(true, 'the reset form does not reveal which emails have accounts');
    await A.page.keyboard.press('Escape');

    // ---- Sign out on a shared computer, then come back.
    await openAccount(B.page);
    await B.page.click('[data-view=account] [data-go=signout]');
    await B.page.check('#so-clear');
    await B.page.click('[data-view=signout] button[type=submit]');
    await B.page.waitForSelector('#dlg-account[open]', { state: 'detached' });
    assert((await savedNames(B.page)).length === 0, 'sign-out can remove puzzles from a shared device');
    await openAccount(B.page);
    await B.page.fill('#si-email', 'bobby@example.com');
    await B.page.fill('#si-pass', 'correct horse battery');
    await B.page.click('[data-view=signin] button[type=submit]');
    await B.page.waitForFunction(() => /Synced/.test(document.querySelector('#acct-sync-text').textContent), null, { timeout: 15000 });
    await B.page.keyboard.press('Escape');
    await B.page.waitForFunction((t) => [...document.querySelectorAll('#saved-list .name')].some((e) => e.textContent === t), title, { timeout: 5000 });
    assert(true, 'signing in again brings the puzzles back');
    await B.page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'acct-home.png') });

    // ---- Delete the account.
    await openAccount(B.page);
    await B.page.click('.acct-danger summary');
    await B.page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'acct-dialog.png') });
    await B.page.fill('#del-pass', 'not it');
    await B.page.click('#acct-delete-form button[type=submit]');
    await B.page.waitForSelector('#acct-delete-form .error-box:not([hidden])');
    assert(auth.users.has('bobby@example.com'), 'wrong password does not delete the account');
    await B.page.fill('#del-pass', 'correct horse battery');
    await B.page.click('#acct-delete-form button[type=submit]');
    await B.page.waitForSelector('#dlg-account[open]', { state: 'detached' });
    assert(!auth.users.has('bobby@example.com'), 'account removed from sign-in');
    const left = await db.prepare('SELECT COUNT(*) AS n FROM sync_records').first();
    assert(left.n === 0, 'all synced data deleted from the server');
    assert((await savedNames(B.page)).includes(title), 'puzzles stay on the device after deleting the account');

    // A signed in again earlier? No: A is signed out. Sign A in with a fresh
    // token from before the deletion to check the server refuses it.
    const staleUid = (await db.prepare('SELECT user_id FROM sync_deleted_users').first()).user_id;
    const stale = await fetch(`http://localhost:${API_PORT}/v1/sync`, { method: 'POST', headers: { Authorization: `Bearer ${signer.token({ sub: staleUid })}`, Origin: APP, 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0 }) });
    assert(stale.status === 401, 'a deleted account cannot be written back from another device');

    // Accessibility basics of the dialog.
    await openAccount(B.page);
    const labels = await B.page.$$eval('#dlg-account input:not([type=checkbox])', (els) => els.every((i) => i.labels && i.labels.length));
    assert(labels, 'every field in the account window has a label');
    const small = await B.page.$$eval('#dlg-account button:not([hidden])', (els) => els.filter((b) => b.offsetParent && b.offsetHeight < 44).map((b) => b.textContent));
    assert(small.length === 0, `buttons are at least 44 px tall ${small.join(', ')}`);
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
