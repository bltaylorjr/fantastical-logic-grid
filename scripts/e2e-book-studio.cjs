// End-to-end check of Book Studio (admin/book-studio/) against the real Worker
// (Miniflare, local D1, the admin/ files as Worker assets), under its real
// content security policy: the sign-in gate, a publisher who has access, a
// viewer who does not, the sample book, Apply specs, and a submission packet
// download that is written to the audit log.
// Needs `npm install` in server/ and `node book-studio/build.mjs` first.
// SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const PORT = 8172;
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'flg-e2e-studio';
const TOKEN = 'break-glass-key-for-the-studio-test';
const OWNER = 'owner@example.com';
const SHOTS = process.env.SHOTS;

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const signer = makeSigner(PROJECT);
  const mf = new Miniflare({
    port: PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: BASE, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('pub@example.com', 'publisher', 'test', 0), ('view@example.com', 'viewer', 'test', 0)").run();
  const session = (email, uid) => JSON.stringify({ mode: 'firebase', email, idToken: signer.token({ sub: uid, email, email_verified: true }), refreshToken: 'x', exp: Date.now() + 3_000_000, seen: Date.now() });

  const browser = await chromium.launch();
  const problems = [];
  const open = async (stored) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    // The book fonts come from Google Fonts; the test runs offline.
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    if (stored) await ctx.addInitScript((s) => { sessionStorage.setItem('flg-admin-session', s); }, stored);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) problems.push(`console: ${m.text()}`); });
    await page.goto(`${BASE}/admin/book-studio/`);
    return page;
  };
  try {
    // Nobody signed in: the gate points to Grid Admin.
    let page = await open(null);
    await page.waitForSelector('#gate:not([hidden])');
    assert(await page.isHidden('#app'), 'signed out: the studio stays hidden behind the sign-in gate');
    assert((await page.getAttribute('#gateSignIn', 'href')) === '/admin/#book-studio', 'the gate links to Grid Admin sign-in');
    await page.context().close();

    // A viewer without publishing access is refused.
    page = await open(session('view@example.com', 'view-uid'));
    await page.waitForSelector('#gate:not([hidden])');
    assert((await page.textContent('#gateTitle')) === 'No publishing access', 'a viewer without the switch sees "No publishing access"');
    await page.context().close();

    // A publisher gets the studio with the sample book, and can export.
    page = await open(session('pub@example.com', 'pub-uid'));
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#pages .page').length >= 8, null, { timeout: 30000 });
    assert(true, `publisher: the studio opens with the sample book (${await page.$$eval('#pages .page', (a) => a.length)} pages)`);
    assert(await page.isHidden('#backToAdmin'), 'publisher: no link back into the dashboard');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio.png') });
    await page.click('[data-tab=cover]');
    await page.waitForFunction(() => document.querySelector('#cvSpecs')?.textContent.includes('Full cover'), null, { timeout: 15000 });
    assert(true, 'the cover designer loads its vendored library under the page policy');
    await page.click('#applyPub');
    await page.waitForSelector('#view-publish:not([hidden]) #checkSummary .card', { timeout: 30000 });
    const pages = await page.$$eval('#pages .page', (a) => a.length);
    assert(pages >= 24, `Apply specs (KDP) brings the book to the 24-page minimum (${pages} pages)`);
    await page.selectOption('#dpi', '200');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#expPacket')]);
    assert(/submission-packet\.zip$/.test(dl.suggestedFilename()), `the submission packet downloads (${dl.suggestedFilename()})`);
    const { results } = await db.prepare("SELECT actor, status FROM admin_audit WHERE action = 'publishing.export'").all();
    assert(results.some((r) => r.actor === 'pub@example.com' && r.status === 200), 'the export is written to the audit log');
    await page.context().close();

    assert(problems.length === 0, `no script errors or blocked resources${problems.length ? `:\n${problems.join('\n')}` : ''}`);
    console.log('Book Studio e2e passed');
  } finally {
    await browser.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
