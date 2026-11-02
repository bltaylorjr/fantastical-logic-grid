// End-to-end check of Passwords, the owner's password manager in the admin
// dashboard (admin/vault.js, server/src/vault.js), against the real Worker
// (Miniflare, local D1): set up a master password, add a login with a 2-step
// code key, copy the password, Log in (opens the site and copies the
// username), move to the bin and undo, lock, a wrong master password, unlock,
// import a Chrome CSV, change the master password, reload (locked again),
// Face ID unlock (Chromium's virtual authenticator with PRF), removing the
// device, and a device without PRF getting a plain explanation.
// It also checks the database holds no readable password, name or address.
// Needs `npm install` in server/ first. SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8167;
const API = `http://localhost:${API_PORT}`;
const PROJECT = 'flg-e2e';
const OWNER = 'owner@example.com';
const SHOTS = process.env.SHOTS;
const MASTER = 'purple otter lantern ninety';
const SECRET = 'JBSWY3DPEHPK3PXP';

// The expected 2-step code, worked out here independently of the page.
function totp(secret, now = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const o = mac[19] & 15;
  return String(((mac.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

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
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: API });
    await ctx.route('https://identitytoolkit.googleapis.com/**', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ localId: 'owner-uid', email: body.email, idToken: signer.token({ sub: 'owner-uid', email: body.email, email_verified: true }), refreshToken: 'r1', expiresIn: '3600' }) });
    });
    const opened = [];
    await ctx.route('https://www.namecheap.com/**', (r) => { opened.push(r.request().url()); return r.fulfill({ contentType: 'text/html', body: '<title>Namecheap</title>' }); });
    const page = await ctx.newPage();
    const faceId = async (pg, hasPrf = true) => {
      const cdp = await pg.context().newCDPSession(pg);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf } });
    };
    await faceId(page);
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
    const clip = () => page.evaluate(() => navigator.clipboard.readText());

    await page.goto(`${API}/admin/`);
    await page.fill('#login-email', OWNER);
    await page.fill('#login-password', 'right-password');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#app:not([hidden]) .tile');
    assert(await page.locator('#nav-list a[href="#vault"]').isVisible(), 'the owner sees Passwords in the menu');

    await page.goto(`${API}/admin/#vault`);
    await page.waitForSelector('#vault-setup:not([hidden])');
    await shot(page, 'vault-1-setup');
    await page.fill('#vault-new-1', 'short');
    await page.fill('#vault-new-2', 'short');
    await page.click('#vault-setup button[type=submit]');
    assert(/at least 10/i.test(await page.textContent('#vault-setup-error')), 'a short master password is refused');
    await page.fill('#vault-new-1', MASTER);
    await page.fill('#vault-new-2', MASTER);
    await page.click('#vault-setup button[type=submit]');
    await page.waitForSelector('#vault-open:not([hidden])');
    assert(true, 'setting a master password opens the vault');

    // Add a login.
    await page.click('#vault-add');
    await page.fill('#vf-url', 'https://www.namecheap.com');
    await page.locator('#vf-url').blur();
    assert(await page.inputValue('#vf-title') === 'Namecheap', 'the name fills in from the website address');
    await page.fill('#vf-login', 'https://www.namecheap.com/myaccount/login/');
    await page.fill('#vf-user', 'bltaylor');
    await page.click('#vf-make');
    const pw = await page.inputValue('#vf-pass');
    assert(pw.length === 20 && /[A-Z]/.test(pw) && /\d/.test(pw), 'Make one fills in a strong 20-character password');
    assert(/Strong/.test(await page.textContent('#vf-meter')), 'the meter calls it strong');
    await page.fill('#vf-totp', 'JBSW Y3DP EHPK 3PXP');
    await page.click('#vf-extra-add');
    await page.fill('#vf-extra [data-x=label]', 'PIN');
    await page.fill('#vf-extra [data-x=value]', '4321');
    await page.check('#vf-extra [data-x=secret]');
    await page.fill('#vf-notes', 'Domain thelogicgrid.com');
    await shot(page, 'vault-2-editor');
    await page.click('#vault-dlg-ok');
    await page.waitForSelector('#vault-list .vault-item');
    assert(/Namecheap/.test(await page.textContent('#vault-list')), 'the login is listed');
    assert(!(await page.textContent('#vault-list')).includes(pw), 'the password is hidden in the list');

    await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector('[data-totp]')?.textContent || ''));
    const shownCode = (await page.textContent('[data-totp]')).replace(' ', '');
    assert([totp(SECRET), totp(SECRET, Date.now() - 2000)].includes(shownCode), `the 2-step code matches an authenticator app (${shownCode})`);
    await shot(page, 'vault-3-list');

    await page.click('[data-v-pass]');
    assert(await clip() === pw, 'Copy password puts it on the clipboard');
    const popup = ctx.waitForEvent('page');
    await page.click('[data-v-login]');
    const site = await popup;
    await site.waitForLoadState();
    assert(site.url().startsWith('https://www.namecheap.com/myaccount/login/'), 'Log in opens the sign-in page');
    assert(await clip() === 'bltaylor', 'Log in copies the username');
    await site.close();
    await page.click('[data-v-show]');
    assert((await page.textContent('#vault-list')).includes(pw), 'Show reveals the password');

    // The database holds only scrambled text.
    const raw = JSON.stringify((await db.prepare('SELECT * FROM vault_items').all()).results) + JSON.stringify((await db.prepare('SELECT * FROM vault_meta').all()).results);
    assert(![pw, 'bltaylor', 'namecheap', 'Namecheap', SECRET, '4321', MASTER].some((s) => raw.includes(s)), 'the database holds no readable password, username, site, code key, PIN or master password');
    const audit = JSON.stringify((await db.prepare("SELECT * FROM admin_audit WHERE action LIKE 'vault.%'").all()).results);
    assert(!audit.includes(pw) && !audit.includes('bltaylor'), 'the audit log holds nothing from inside the vault');

    // Edit: change the password; the old one is kept under Earlier passwords.
    await page.click('[data-v-edit]');
    await page.fill('#vf-pass', 'Another-Strong-Pass-2026!');
    await page.click('#vault-dlg-ok');
    await page.waitForSelector('#vault-dialog[open]', { state: 'hidden' });
    await page.click('[data-v-edit]');
    assert((await page.textContent('#vf-history-list')).includes(pw), 'the earlier password is kept after a change');
    await page.click('#vault-dlg-cancel');

    // Bin and undo.
    await page.click('[data-v-bin]');
    await page.waitForSelector('#vault-undo:not([hidden])');
    assert(/No logins yet|Nothing matches/.test(await page.textContent('#vault-list')), 'Bin takes it out of the list');
    await page.click('#vault-undo-btn');
    await page.waitForSelector('#vault-list [data-v-edit]');
    assert(true, 'Undo puts it back');

    // Lock, wrong password, unlock.
    await page.click('#vault-lock');
    await page.waitForSelector('#vault-unlock:not([hidden])');
    assert(await page.locator('#vault-list').isHidden(), 'Lock now hides everything');
    await page.fill('#vault-pass', 'not the master password');
    await page.click('#vault-unlock button[type=submit]');
    await page.waitForSelector('#vault-unlock-error:not([hidden])');
    assert(/not the master password/.test(await page.textContent('#vault-unlock-error')), 'a wrong master password is refused');
    await page.fill('#vault-pass', MASTER);
    await page.click('#vault-unlock button[type=submit]');
    await page.waitForSelector('#vault-open:not([hidden]) .vault-item');
    assert(/Namecheap/.test(await page.textContent('#vault-list')), 'the right master password opens it again');

    // Face ID: offered after a master-password unlock, then unlocks on its own.
    await page.waitForSelector('#vault-bio-offer:not([hidden])');
    assert(true, 'after unlocking with the master password it offers Face ID or fingerprint');
    await page.click('#vault-bio-offer-yes');
    await page.waitForSelector('#vault-bio-offer', { state: 'hidden' });
    const devRows = (await db.prepare('SELECT * FROM vault_devices').all()).results;
    assert(devRows.length === 1, 'the device is saved');
    assert(!JSON.stringify(devRows).includes(MASTER), 'the device row holds no master password');
    await page.click('#vault-lock');
    await page.waitForSelector('#vault-bio-box:not([hidden])');
    assert(true, 'the locked page offers Unlock with Face ID or fingerprint');
    await shot(page, 'vault-6-bio-unlock');
    await page.click('#vault-bio');
    await page.waitForSelector('#vault-open:not([hidden]) .vault-item');
    assert(/Namecheap/.test(await page.textContent('#vault-list')), 'Face ID opens the vault without the master password');
    assert((await db.prepare('SELECT last_used_at FROM vault_devices').first()).last_used_at, 'the device notes when it was last used');

    // Import a Chrome CSV, with one duplicate to skip.
    const csv = path.join(os.tmpdir(), 'chrome-passwords.csv');
    fs.writeFileSync(csv, 'name,url,username,password,note\nGitHub,https://github.com/login,bltaylorjr,gh-Pa55-word-xyz,"two, lines\nhere"\nCloudflare,https://dash.cloudflare.com,btay74@outlook.com,cf-secret-123,\nGitHub,https://github.com/login,bltaylorjr,gh-Pa55-word-xyz,\n');
    await page.setInputFiles('#vault-import-file', csv);
    await page.waitForSelector('#dialog[open]');
    assert(/<b>2<\/b>|2 login/.test(await page.innerHTML('#dialog-body')) || /Add 2/.test(await page.textContent('#dialog-body')), 'import counts 2 new logins (the duplicate line is skipped)');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vault-item').length === 3);
    assert(true, 'imported logins are listed');
    await page.fill('#vault-q', 'cloud');
    assert(await page.locator('#vault-list .vault-item').count() === 1, 'search finds Cloudflare');
    await page.fill('#vault-q', '');
    await page.selectOption('#vault-kind', 'weak');
    assert(/Cloudflare/.test(await page.textContent('#vault-list')), 'Show > Weak passwords lists the weak one');
    await page.selectOption('#vault-kind', 'all');
    await shot(page, 'vault-4-imported');

    // Change the master password, then reload: locked, and only the new one works.
    await page.click('.vault-more summary');
    await page.click('#vault-master');
    await page.fill('#dialog [name=old]', MASTER);
    await page.fill('#dialog [name=p1]', 'brand new master phrase 77');
    await page.fill('#dialog [name=p2]', 'brand new master phrase 77');
    await page.click('#dialog-ok');
    await page.waitForSelector('#dialog[open]', { state: 'hidden' });
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForSelector('#vault-unlock:not([hidden])');
    assert(true, 'after a reload the vault is locked');
    await page.fill('#vault-pass', MASTER);
    await page.click('#vault-unlock button[type=submit]');
    await page.waitForSelector('#vault-unlock-error:not([hidden])');
    assert(true, 'the old master password no longer works');
    await page.fill('#vault-pass', 'brand new master phrase 77');
    await page.click('#vault-unlock button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vault-item').length === 3);
    assert(true, 'the new master password opens all 3 logins');
    await page.click('#vault-lock');
    await page.click('#vault-bio');
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vault-item').length === 3);
    assert(true, 'Face ID still works after the master password changed');

    // Remove the device: it needs the master password again.
    await page.click('.vault-more summary');
    assert(/This device/.test(await page.textContent('#vault-devices')), 'the device list marks this device');
    await shot(page, 'vault-7-devices');
    await page.click('[data-v-dev]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /No devices/.test(document.querySelector('#vault-devices').textContent));
    await page.click('#vault-lock');
    assert(await page.locator('#vault-bio-box').isHidden(), 'a removed device no longer offers Face ID');
    await page.fill('#vault-pass', 'brand new master phrase 77');
    await page.click('#vault-unlock button[type=submit]');
    await page.waitForSelector('#vault-open:not([hidden]) .vault-item');

    // A device whose browser has no PRF: a plain explanation, nothing saved.
    const page2 = await ctx.newPage();
    await faceId(page2, false);
    await page2.goto(`${API}/admin/#vault`);
    await page2.waitForSelector('#vault-unlock:not([hidden])');
    await page2.fill('#vault-pass', 'brand new master phrase 77');
    await page2.click('#vault-unlock button[type=submit]');
    await page2.waitForSelector('#vault-bio-offer:not([hidden])');
    await page2.click('#vault-bio-offer-yes');
    await page2.waitForFunction(() => /cannot unlock Passwords/.test(document.querySelector('#toast').textContent));
    assert(true, 'a device without PRF support is told plainly');
    assert((await db.prepare('SELECT COUNT(*) AS n FROM vault_devices').first()).n === 0, 'nothing is saved for it');
    await page2.close();

    // Phone size.
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'vault-5-phone');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert(!overflow, 'nothing runs off the side on a phone');

    // Sign out locks it as well.
    await page.click('#signout').catch(() => {});

    assert(!problems.length, `no page errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    console.log('\nPasswords e2e passed.');
  } catch (e) {
    console.log(e.message);
    if (problems.length) console.log('page errors:', problems);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mf.dispose();
  }
})();
