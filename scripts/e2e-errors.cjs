// End-to-end check of anonymous error reports: an error in the game reaches
// the real Worker (Miniflare, local D1) cleaned of personal details, and
// nothing is sent once the admin dashboard switches reports off. Needs `npm install` in
// server/ first (npm run test:errors does that).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8152;
const APP_PORT = 8153;
const APP = `http://localhost:${APP_PORT}`;

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const mf = new Miniflare({
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: APP },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  const api = `http://localhost:${API_PORT}`;
  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${api}', appVersion: '9.9.9' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = '${api}';\n`;
  const browser = await chromium.launch();
  const rows = async () => (await db.prepare('SELECT * FROM app_errors').all()).results;
  async function device(settings, { reportsOff = false } = {}) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    // The dashboard's "Automatic error reports" switch, as /v1/config sends it.
    if (reportsOff) await ctx.route('**/v1/config', (r) => r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': APP }, body: JSON.stringify({ announcements: [], disabledThemes: [], features: { errorReports: false } }) }));
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.route('**/v1/learn/**', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript((s) => localStorage.setItem('flg.settings', JSON.stringify(s)), { introOffered: true, voiceProvider: 'device', silent: true, ...settings });
    const page = await ctx.newPage();
    await page.goto(`${APP}/`);
    await page.waitForSelector('#tier-choices input');
    return { ctx, page };
  }
  try {
    const a = await device({});
    assert(await a.page.locator('input[name="reportErrors"]').count() === 0, 'error reports are switched in the admin dashboard, not in Settings');
    await a.page.evaluate(() => { setTimeout(() => { throw new Error('Broke while drawing for sam@example.com at https://thelogicgrid.com/?save=1234567'); }); });
    await a.page.evaluate(() => { Promise.reject(new Error('A promise nobody caught')); });
    for (let i = 0; i < 40 && (await rows()).length < 2; i++) await a.page.waitForTimeout(150);
    const got = await rows();
    assert(got.length === 2, `both errors reached the Worker (${got.length})`);
    const thrown = got.find((r) => r.kind === 'error');
    assert(thrown && thrown.version === '9.9.9' && thrown.platform === 'web', 'report carries the app version and platform');
    assert(!/sam@example|thelogicgrid\.com|1234567/.test(JSON.stringify(got)), 'no email, address or long numbers are stored');
    assert(got.some((r) => r.kind === 'rejection'), 'uncaught promise errors are reported too');
    await a.ctx.close();

    const b = await device({}, { reportsOff: true });
    await b.page.waitForFunction(() => JSON.parse(localStorage.getItem('flg.remoteConfig') || '{}').features?.errorReports === false);
    await b.page.evaluate(() => { setTimeout(() => { throw new Error('Should stay on this device'); }); });
    await b.page.waitForTimeout(3000);
    assert((await rows()).length === 2, 'nothing is sent when the dashboard switches reports off');
    await b.ctx.close();
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
