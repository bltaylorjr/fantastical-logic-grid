// End-to-end check of Passwords autofill and authenticator options, with the
// real browser extension (admin/extension) loaded into Chromium and the real
// Worker (Miniflare): Log in opens a fake three-step sign-in (username page,
// password page, six code boxes) and fills each step; a look-alike site gets
// nothing; a 2-step code is added from a QR screenshot; "Add to your phone"
// shows a QR; "ask first" asks for the master password before copying; the
// extension download is a valid zip. Needs `npm install` in server/ first.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8168;
const API = `http://localhost:${API_PORT}`;
const PROJECT = 'flg-e2e';
const OWNER = 'owner@example.com';
const MASTER = 'purple otter lantern ninety';
const SECRET = 'JBSWY3DPEHPK3PXP';
const SHOTS = process.env.SHOTS;

function totp(secret, now = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const o = mac[19] & 15;
  return String(((mac.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

// A sign-in in three steps, like Google or Microsoft.
const PAGES = {
  '/login': '<!doctype html><title>Sign in</title><form action="/password"><label>Email or username <input name="identifier" autocomplete="username"></label><button>Next</button></form>',
  '/password': '<!doctype html><title>Password</title><form action="/code"><label>Password <input type="password" name="pw"></label><button>Sign in</button></form>',
  '/code': '<!doctype html><title>2-step</title><p>Enter the code from your authenticator app</p><div id="otp">' + Array.from({ length: 6 }, (_, i) => `<input maxlength="1" inputmode="numeric" aria-label="Digit ${i + 1}">`).join('') + '</div>',
};
const EVIL = '<!doctype html><title>Sign in</title><form><input name="username"><input type="password" name="password"></form>';

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const signer = makeSigner(PROJECT);
  const mf = new Miniflare({
    port: API_PORT, modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'), compatibilityDate: '2026-08-01', d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ADMIN_TOKEN: 'break-glass-key-for-the-e2e-test', OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }

  const ext = path.join(ROOT, 'admin/extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const problems = [];
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: API });
    await ctx.route('https://identitytoolkit.googleapis.com/**', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ localId: 'owner-uid', email: body.email, idToken: signer.token({ sub: 'owner-uid', email: body.email, email_verified: true }), refreshToken: 'r1', expiresIn: '3600' }) });
    });
    await ctx.route('https://accounts.example-site.com/**', (r) => r.fulfill({ contentType: 'text/html', body: PAGES[new URL(r.request().url()).pathname] || '<title>Home</title>' }));
    await ctx.route('https://example-site.com.evil.net/**', (r) => r.fulfill({ contentType: 'text/html', body: EVIL }));

    let [worker] = ctx.serviceWorkers();
    worker ??= await ctx.waitForEvent('serviceworker');
    assert(worker.url().startsWith('chrome-extension://bljdjkfhfdhehcfofbncddolbjnbkpdc/'), 'the extension loads with its fixed id');

    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${API}/admin/#vault`);
    await page.fill('#login-email', OWNER);
    await page.fill('#login-password', 'x');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#vault-setup:not([hidden])');
    await page.fill('#vault-new-1', MASTER);
    await page.fill('#vault-new-2', MASTER);
    await page.click('#vault-setup button[type=submit]');
    await page.waitForSelector('#vault-open:not([hidden])');
    await page.click('.vault-more summary');
    await page.waitForFunction(() => /Autofill on/.test(document.querySelector('#vault-autofill-state')?.textContent || ''));
    assert(/browser extension \(version 1\.0\.0\)/.test(await page.textContent('#vault-autofill-state')), 'the page finds the extension and says autofill is on');

    // The extension download is a valid zip with every file.
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(async (e) => { throw new Error(`no download; toast: ${await page.textContent('#toast')}; ext: ${(await (await fetch(`${API}/admin/extension/manifest.json`)).status)}`); });
    await page.click('#vault-ext-get');
    const zipPath = path.join(profile, 'ext.zip');
    await (await dl).saveAs(zipPath);
    const list = require('child_process').execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip() or "ok");print("\\n".join(z.namelist()))', zipPath], { encoding: 'utf8' });
    assert(/^ok/.test(list) && ['manifest.json', 'background.js', 'fill.js', 'icon-128.png'].every((f) => list.includes(`logic-grid-passwords/${f}`)), 'Download the extension gives a valid zip with every file');

    // Add a login with a 2-step code from a QR screenshot.
    await page.click('#vault-add');
    await page.fill('#vf-url', 'https://example-site.com');
    await page.fill('#vf-login', 'https://accounts.example-site.com/login');
    await page.fill('#vf-pass', 'Very-Long-Site-Pass-42!');
    const box = {}; require('vm').runInNewContext(fs.readFileSync(path.join(ROOT, 'admin/vendor/qrcode.js'), 'utf8'), box);
    const qrcode = box.qrcode;
    const q = qrcode(0, 'M');
    q.addData(`otpauth://totp/Example%20Site:bobby@example.com?secret=${SECRET}&issuer=Example%20Site`);
    q.make();
    const gif = Buffer.from(q.createDataURL(8, 16).split(',')[1], 'base64');
    const shot = path.join(profile, 'qr.gif');
    fs.writeFileSync(shot, gif);
    await page.setInputFiles('#vf-totp-file', shot);
    await page.waitForFunction(() => /^otpauth:/.test(document.querySelector('#vf-totp').value));
    assert(true, 'a QR code screenshot fills in the 2-step setup key');
    assert(await page.inputValue('#vf-email') === 'bobby@example.com', 'and the account email from the QR code');
    await page.waitForFunction(() => /Code now: \d{6}/.test(document.querySelector('#vf-totp-now').textContent));
    const now = (await page.textContent('#vf-totp-now')).match(/\d{6}/)[0];
    assert([totp(SECRET), totp(SECRET, Date.now() - 2000)].includes(now), 'the editor shows the current code to confirm setup');
    await page.click('#vf-totp-phone');
    await page.waitForSelector('#dialog[open] svg.vault-qr');
    assert(true, 'Add to your phone too shows a QR code');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'autofill-1-phone-qr.png') });
    await page.click('#dialog-ok');
    await page.fill('#vf-user', 'bobby');
    await page.click('#vault-dlg-ok');
    await page.waitForSelector('#vault-list .vault-item');
    assert(/Example Site/.test(await page.textContent('#vault-list .vault-main > b')), 'the login is titled with the issuer name');

    // Log in: the extension opens the sign-in and fills every step.
    const tabP = ctx.waitForEvent('page');
    await page.click('[data-v-login]');
    const tab = await tabP;
    await tab.waitForURL(/\/login/);
    await tab.waitForFunction(() => document.querySelector('[name=identifier]')?.value === 'bobby', null, { timeout: 15000 });
    assert(true, 'Log in opens the sign-in page and fills the username');
    await tab.click('button');
    await tab.waitForURL(/\/password/);
    await tab.waitForFunction(() => document.querySelector('[type=password]')?.value === 'Very-Long-Site-Pass-42!', null, { timeout: 15000 });
    assert(true, 'the next page gets the password');
    await tab.click('button');
    await tab.waitForURL(/\/code/);
    await tab.waitForFunction(() => [...document.querySelectorAll('#otp input')].every((i) => /^\d$/.test(i.value)), null, { timeout: 15000 });
    const filled = await tab.$$eval('#otp input', (els) => els.map((e) => e.value).join(''));
    assert([totp(SECRET), totp(SECRET, Date.now() - 3000)].includes(filled), `the code page gets the current 2-step code in its six boxes (${filled})`);
    if (SHOTS) await tab.screenshot({ path: path.join(SHOTS, 'autofill-2-code.png') });

    // A look-alike site in the same tab gets nothing.
    await tab.goto('https://example-site.com.evil.net/login');
    await tab.waitForTimeout(2500);
    assert(await tab.inputValue('[name=password]') === '' && await tab.inputValue('[name=username]') === '', 'a look-alike site gets nothing');
    await tab.close();

    // Ask first: copying a password asks for the master password.
    await page.check('#vault-ask-copy');
    await page.click('[data-v-pass]');
    await page.waitForSelector('#dialog[open] [name=p]');
    await page.fill('#dialog [name=p]', 'wrong one');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /not the master password/.test(document.querySelector('#toast').textContent));
    assert(await page.evaluate(() => navigator.clipboard.readText()) !== 'Very-Long-Site-Pass-42!', 'a wrong master password copies nothing');
    await page.click('[data-v-pass]');
    await page.fill('#dialog [name=p]', MASTER);
    await page.click('#dialog-ok');
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    for (let i = 0; i < 40 && (await clip()) !== 'Very-Long-Site-Pass-42!'; i++) await page.waitForTimeout(150);
    assert(await clip() === 'Very-Long-Site-Pass-42!', 'the password was copied');
    assert(true, 'with "ask first" on, the master password lets it copy');
    await page.click('[data-v-pass]');
    await page.waitForTimeout(400);
    const still = await page.locator('#dialog[open]').count() ? await page.textContent('#dialog') : '';
    assert(!still, `one check covers the next minute${still ? `: ${still.trim().slice(0, 120)}` : ''}`);
    if (SHOTS) { await page.click('.vault-more summary').catch(() => {}); await page.screenshot({ path: path.join(SHOTS, 'autofill-3-settings.png'), fullPage: true }); }

    assert(!problems.length, `no page errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    console.log('\nPasswords autofill e2e passed.');
  } catch (e) {
    console.log(e.message);
    if (problems.length) console.log('page errors:', problems);
    process.exitCode = 1;
  } finally {
    await ctx.close();
    await mf.dispose();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
