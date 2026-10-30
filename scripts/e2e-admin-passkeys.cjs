// End-to-end check of Face ID and fingerprint sign-in on the admin dashboard
// against the real Worker (Miniflare, local D1). Chromium's virtual
// authenticator stands in for the phone's Face ID: set up a passkey after a
// password sign-in, stay signed in across a reload and a closed app, lock
// after 30 idle minutes, open again with the passkey, sign out, and remove
// the device. Needs `npm install` in server/ first.
// SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8165;
const API = `http://localhost:${API_PORT}`;
const PROJECT = 'flg-e2e';
const OWNER = 'owner@example.com';
const SHOTS = process.env.SHOTS;

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const signer = makeSigner(PROJECT);
  const mf = new Miniflare({
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ADMIN_TOKEN: 'break-glass-key-for-the-e2e-test', OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }

  const browser = await chromium.launch();
  const problems = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
  };
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
  // A phone with Face ID: Chromium's virtual platform authenticator.
  const faceId = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    return cdp;
  };
  const signedIn = (page) => page.waitForSelector('#app:not([hidden]) .tile');

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route('https://identitytoolkit.googleapis.com/**', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ localId: 'owner-uid', email: body.email, idToken: signer.token({ sub: 'owner-uid', email: body.email, email_verified: true }), refreshToken: 'r1', expiresIn: '3600' }) });
    });
    const page = await ctx.newPage();
    watch(page);
    await faceId(page);
    await page.goto(`${API}/admin/`);
    await page.waitForSelector('#passkey-signin-box:not([hidden])');
    assert(true, 'a phone with Face ID sees "Sign in with Face ID or fingerprint"');
    assert(await page.isChecked('#login-keep'), '"Keep me signed in on this device" is ticked by default');

    await page.fill('#login-email', OWNER);
    await page.fill('#login-password', 'right-password');
    await page.click('#login-form button[type=submit]');
    await signedIn(page);
    await page.waitForSelector('#passkey-offer:not([hidden])');
    assert(true, 'after a password sign-in the dashboard offers to set up Face ID');
    await shot(page, 'pk-1-offer');
    await page.click('#passkey-offer-yes');
    await page.waitForSelector('#passkey-offer', { state: 'hidden' });
    const rows = await db.prepare('SELECT email, device FROM admin_passkeys').all();
    assert(rows.results.length === 1 && rows.results[0].email === OWNER, 'the passkey is stored for the owner');

    await page.goto(`${API}/admin/#signin`);
    await page.waitForSelector('#pk-rows tr td .badge');
    assert(/This device/.test(await page.textContent('#pk-rows')), 'Face ID and fingerprint lists this device');
    assert(await page.locator('#pk-add').isHidden(), 'no second set-up button for a device that is already set up');
    await shot(page, 'pk-2-devices');

    // The phone closes the app while the admin uses others; opening it again keeps them in.
    // (Leaving the page stands in for the phone closing it: Chromium's virtual
    // authenticator lives with the tab.)
    await page.goto('about:blank');
    await page.goto(`${API}/admin/`);
    await signedIn(page);
    assert(true, 'closing and reopening the app keeps the admin signed in');

    // Away for 31 minutes: it locks, and Face ID opens it again.
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('flg-admin-session'));
      s.seen = Date.now() - 31 * 60_000;
      localStorage.setItem('flg-admin-session', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForSelector('#login:not([hidden]) #login-error:not([hidden])');
    assert(/Locked after 30 minutes/.test(await page.textContent('#login-error')) && /Face ID/.test(await page.textContent('#login-error')), 'after 30 idle minutes it locks and asks for Face ID');
    assert(await page.evaluate(() => !localStorage.getItem('flg-admin-session')), 'a locked dashboard keeps no sign-in on the phone');
    assert(await page.locator('#who').isHidden() && await page.locator('#app').isHidden(), 'nothing of the dashboard shows while locked');
    await shot(page, 'pk-3-locked');
    await page.click('#passkey-signin');
    await signedIn(page);
    assert((await page.textContent('#who-role')) === 'owner', 'Face ID opens the dashboard again');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('flg-admin-session')).mode) === 'passkey', 'the session is a passkey session');
    assert(await page.locator('#passkey-offer').isHidden(), 'no set-up offer after a Face ID sign-in');
    const sessions = (await db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').first()).n;

    // Sign out ends the session on the server too.
    await page.click('#sign-out');
    await page.waitForSelector('#login:not([hidden])');
    await page.waitForTimeout(300);
    assert((await db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').first()).n === sessions - 1, 'signing out ends the passkey session on the server');

    // Remove the device: that sign-in stops working.
    await page.click('#passkey-signin');
    await signedIn(page);
    await page.goto(`${API}/admin/#signin`);
    await page.waitForSelector('#pk-rows button[data-pk-remove]');
    await page.click('#pk-rows button[data-pk-remove]');
    await page.click('#dialog-ok');
    await page.waitForSelector('#login:not([hidden])');
    assert((await db.prepare('SELECT COUNT(*) AS n FROM admin_passkeys').first()).n === 0, 'removing this device removes its passkey and signs it out');

    assert(!problems.length, `no console errors or blocked scripts (${problems.join(' | ')})`);
    await ctx.close();
  } finally {
    await browser.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
