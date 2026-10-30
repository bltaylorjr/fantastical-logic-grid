// End-to-end check of app keys (web/js/license.js, web/js/license-download.js,
// server/src/licenses.js). Runs the real Worker in Miniflare with a throwaway
// signing key, and the game as the Android app (a pretend native bridge):
// the key window on first launch, a wrong key, a good key, offline play after
// that, a second phone refused, a cancelled key locking the app again, and the
// website's download asking for a key with 2 downloads per key. Needs
// `npm install` in server/ and `npm run build` first.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { webcrypto } = require('crypto');

let failed = 0;
const assert = (c, m) => { if (!c) { failed++; console.log(`FAIL: ${m}`); } else console.log(`ok  ${m}`); };
const ROOT = path.join(__dirname, '..');
const API_PORT = 8172;
const APP_PORT = 8173;
const APP = `http://localhost:${APP_PORT}`;
const API = `http://localhost:${API_PORT}`;
const TOKEN = 'break-glass-token-for-license-e2e';

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const mf = new Miniflare({
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: APP, ADMIN_TOKEN: TOKEN, LICENSE_SIGNING_KEY: JSON.stringify(priv) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const admin = async (p, body) => (await fetch(`${API}/admin/v1/${p}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '${API}', learnUrl: '${API}', authUrl: '', tokenUrl: '', siteUrl: 'https://thelogicgrid.com', appVersion: 'test', licenseKey: ${JSON.stringify(pub)} };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = '${API}';\n`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(name, { android = true, viewport = { width: 420, height: 860 } } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.route('https://api.github.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v9.9.9', assets: [
      { name: 'The Fantastical Logic Grid_9.9.9_x64-setup.exe', size: 20 * 1048576, browser_download_url: `${APP}/fake-setup.exe` },
      { name: 'The-Fantastical-Logic-Grid-9.9.9.apk', size: 21 * 1048576, browser_download_url: `${APP}/fake.apk` },
    ] }) }));
    await ctx.addInitScript((isApp) => {
      if (isApp) window.FLGNative = { platform: 'android' };
      if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', sound: false, music: false }));
    }, android);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(`${APP}/`);
    await page.waitForSelector('#tier-choices input');
    return { ctx, page };
  }
  const gateOpen = (page) => page.evaluate(() => document.querySelector('#dlg-license').open);

  try {
    // ---- The website never asks.
    let { ctx, page } = await open('web', { android: false, viewport: { width: 1280, height: 900 } });
    await page.waitForTimeout(800);
    assert(!(await gateOpen(page)), 'the website opens without a key');
    await ctx.close();

    // ---- The Android app asks on first launch.
    const [key] = (await admin('licenses', { label: 'e2e' })).keys;
    const phone = await open('phone');
    page = phone.page;
    await page.waitForSelector('#dlg-license[open]');
    assert(true, 'the app shows the key window on first launch');
    await page.keyboard.press('Escape');
    assert(await gateOpen(page), 'Escape does not close the key window');
    await page.fill('#license-key', 'FLG-22222-22222-22222-22222');
    await page.click('#license-go');
    await page.waitForSelector('#license-error:not([hidden])');
    assert(/not found/.test(await page.textContent('#license-error')), 'a wrong key is refused with a plain message');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'license-gate.png') });
    await page.fill('#license-key', key.toLowerCase());
    await page.click('#license-go');
    await page.waitForFunction(() => !document.querySelector('#dlg-license').open);
    assert(true, 'a good key (typed in lower case) unlocks the app');
    const rows = (await admin('licenses')).keys;
    assert(rows.find((k) => k.key === key).devices === 1, 'the admin sees one install on the key');

    // Offline after that: no key window.
    // The game's server cannot be reached (the page itself comes from the test server).
    const down = (r) => r.abort('internetdisconnected');
    await phone.ctx.route(`${API}/**`, down);
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    await page.waitForTimeout(800);
    assert(!(await gateOpen(page)), 'the app works offline once the key is checked');
    await phone.ctx.unroute(`${API}/**`, down);
    await page.click('#help-btn');
    assert((await page.textContent('#help-license-key')).endsWith(key.slice(-5)), 'Help shows which key this install uses');
    await page.keyboard.press('Escape');

    // A second phone: this key is for one install.
    const other = await open('other phone');
    await other.page.waitForSelector('#dlg-license[open]');
    await other.page.fill('#license-key', key);
    await other.page.click('#license-go');
    await other.page.waitForSelector('#license-error:not([hidden])');
    assert(/one device|second install/.test(await other.page.textContent('#license-error')), 'a second install of the same key is refused');
    const row = rows.find((k) => k.key === key);
    await admin(`licenses/${row.id}/devices`, { maxDevices: 2 });
    await other.page.click('#license-go');
    await other.page.waitForFunction(() => !document.querySelector('#dlg-license').open);
    assert(true, 'once the admin allows a 2nd install, the second phone opens');
    await other.ctx.close();

    // Cancelled: the next daily check locks the app again.
    await admin(`licenses/${row.id}/revoke`, {});
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flg.licensePass')); s.checkedAt = 0; localStorage.setItem('flg.licensePass', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('#dlg-license[open]', { timeout: 10000 });
    assert(/cancelled/.test(await page.textContent('#license-error')), 'a cancelled key asks for a key again');
    await phone.ctx.close();

    // ---- The website's downloads ask for a key, 2 downloads each.
    const [dl] = (await admin('licenses', { label: 'download' })).keys;
    ({ ctx, page } = await open('web', { android: false, viewport: { width: 1280, height: 900 } }));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('flg.remoteConfig') || '{}').features?.licenseDownload === true);
    const gets = [];
    await ctx.route(`${APP}/fake*`, (r) => { gets.push(r.request().url()); r.fulfill({ body: 'x', headers: { 'Content-Disposition': 'attachment; filename="fake"' } }); });
    await page.click('#menu-btn');
    await page.click('[data-cmd=install]');
    await page.waitForSelector('#dlg-install[open]');
    await page.waitForSelector('#install-key:not([hidden])');
    await page.waitForFunction(() => /fake-setup\.exe$/.test(document.querySelector('#install-desktop-btn').href));
    assert(await page.isVisible('#install-apk'), 'the Android app is offered for download too');
    const ids = await page.$$eval('#dlg-install .install-opt', (els) => els.filter((e) => !e.hidden).map((e) => e.id));
    assert(ids[0] === 'install-key', 'the app key comes before the downloads');
    await page.click('#install-desktop-btn');
    await page.waitForSelector('#install-key-error:not([hidden])');
    assert(/Type your app key/.test(await page.textContent('#install-key-error')), 'a download without a key asks for one');
    await page.fill('#install-key-input', dl);
    const t1 = page.waitForEvent('download').catch(() => null);
    await page.click('#install-desktop-btn');
    await t1;
    await page.waitForTimeout(500);
    const t2 = page.waitForEvent('download').catch(() => null);
    await page.click('#install-apk-btn');
    await t2;
    await page.waitForTimeout(500);
    assert(gets.length === 2, `two downloads start with a good key (${gets.length})`);
    await page.click('#install-desktop-btn');
    await page.waitForSelector('#install-key-error:not([hidden])');
    assert(/2 downloads/.test(await page.textContent('#install-key-error')), 'a third download needs a new key');
    const after = (await admin('licenses')).keys.find((k) => k.key === dl);
    assert(after.downloads === 2, 'the admin sees both downloads on the key');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'license-download.png') });
    await ctx.close();

    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
  if (failed) { console.log(`${failed} failed`); process.exit(1); }
})();
