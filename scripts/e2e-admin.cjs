// End-to-end check of the admin dashboard against the real Worker (Miniflare,
// local D1, the admin/ files as Worker assets): sign in with a (mock) Firebase
// account, read the overview, switch a theme off, publish an announcement,
// reset a screen name, read the audit log, use the break-glass key, and see
// the announcement and the switched-off theme in the game itself.
// Needs `npm install` in server/ first and a built game (npm run build).
// SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8162;
const APP_PORT = 8163;
const APP = `http://localhost:${APP_PORT}`;
const API = `http://localhost:${API_PORT}`;
const PROJECT = 'flg-e2e';
const TOKEN = 'break-glass-key-for-the-e2e-test';
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: APP, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  // A little history to show.
  const now = Date.now();
  for (let i = 0; i < 40; i++) {
    const d = new Date(now - (i % 12) * 86400000).toISOString().slice(0, 10);
    await db.prepare('INSERT INTO plays (day, platform, tier, theme, outcome, rating, minutes, hints) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(d, ['web', 'desktop'][i % 2], ['easy', 'medium', 'hard'][i % 3], ['mystery', 'fantasy', 'scifi', 'pets'][i % 4], i % 5 ? 'solved' : 'abandoned', 3 + (i % 3), 4 + i % 7, i % 3).run();
  }
  await db.prepare("INSERT INTO usage (day, name, count) VALUES (?1, 'tts', 140)").bind(new Date(now).toISOString().slice(0, 10)).run();
  await db.prepare("INSERT INTO parts (key, theme, kind, value, source, submitted) VALUES ('mystery|places|mill', 'mystery', 'places', '\"the old water mill\"', 'mine', '2026-10-25')").run();
  await db.prepare('INSERT INTO sync_users (user_id, rev, created_at) VALUES (?1, 0, ?2)').bind('player-1', now - 86400000).run();
  await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind('player-1', 'Sneaky Name', 'sneakyname', now).run();
  await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES ('player-1', 's1', 'solo', 'easy', 48, 300000, 0, 0, 25, ?1)").bind(now).run();
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  const browser = await chromium.launch();
  const problems = [];
  const watch = (page) => {
    // Refused requests (the wrong password above) are expected; script errors
    // and Content-Security-Policy blocks are not.
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
  };
  // Firebase's sign-in REST API, answered with a token the Worker trusts.
  const mockFirebase = async (ctx) => {
    await ctx.route('https://identitytoolkit.googleapis.com/**', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (r.request().url().includes('signInWithPassword')) {
        if (body.password !== 'right-password') return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ localId: 'owner-uid', email: body.email, idToken: signer.token({ sub: 'owner-uid', email: body.email, email_verified: true }), refreshToken: 'r1', expiresIn: '3600' }) });
      }
      return r.fulfill({ contentType: 'application/json', body: '{}' });
    });
  };
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await mockFirebase(ctx);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${API}/admin/`);
    await page.fill('#login-email', OWNER);
    await page.fill('#login-password', 'wrong');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#login-error:not([hidden])');
    assert(/do not match/.test(await page.textContent('#login-error')), 'a wrong password is refused with a clear message');
    await page.fill('#login-password', 'right-password');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#app:not([hidden]) .tile');
    assert((await page.textContent('#who-role')) === 'owner', 'the owner signs in with their game account');
    assert(await page.locator('#nav-list a[href="#admins"]').isVisible(), 'the owner sees the Admins section');
    const overview = await page.textContent('#ov-body');
    assert(/Games finished/.test(overview) && /mystery/.test(overview), 'the overview shows games and themes');
    assert(/140/.test(overview) && /300/.test(overview), 'the overview shows voices used against the cap');
    assert(await page.locator('#ov-body svg[role=img]').count() >= 5, 'the overview has charts with text descriptions');
    await shot(page, '1-overview');

    await page.click('a[href="#stories"]');
    await page.waitForSelector('#parts-list button[data-status=approved]');
    await page.click('#parts-list button[data-status=approved]');
    await page.waitForFunction(() => /Nothing here/.test(document.querySelector('#parts-list').textContent));
    assert((await db.prepare("SELECT status FROM parts WHERE key = 'mystery|places|mill'").first()).status === 'approved', 'a story part is approved');

    await page.click('a[href="#settings"]');
    await page.waitForSelector('input[name=theme-off]');
    const theme = await page.getAttribute('input[name=theme-off]:nth-of-type(1)', 'value');
    await page.locator('input[name=theme-off]').first().check();
    await page.click('button[data-save=disabled_themes]');
    await page.waitForFunction(() => /Changed by/.test(document.querySelector('#settings-body').textContent));
    const saved = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'disabled_themes'").first()).value);
    assert(saved.length === 1 && saved[0] === theme, `theme "${theme}" is switched off`);
    await shot(page, '2-settings');

    await page.click('a[href="#announcements"]');
    await page.fill('#ann-text', 'Double points this weekend!');
    await page.click('#ann-form button[type=submit]');
    await page.waitForSelector('#ann-list .badge.ok');
    assert(/Double points/.test(await page.textContent('#ann-list')), 'an announcement is published');

    await page.click('a[href="#names"]');
    await page.waitForSelector('#names-rows button[data-act=reset]');
    await page.click('#names-rows button[data-act=reset]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /Nothing here/.test(document.querySelector('#names-rows').textContent));
    const renamed = (await db.prepare("SELECT screen_name FROM players WHERE user_id = 'player-1'").first()).screen_name;
    assert(/^Player [A-Z2-9]{4}$/.test(renamed), `a screen name is reset (${renamed})`);

    await page.click('a[href="#players"]');
    await page.click('#players-form button[type=submit]');
    await page.waitForSelector('#players-rows button[data-uid]');
    await page.click('#players-rows button[data-uid]');
    await page.waitForSelector('#player-card');
    assert(/Latest scores/.test(await page.textContent('#player-card')), 'a player opens with their scores');
    await shot(page, '3-player');

    await page.click('a[href="#audit"]');
    await page.waitForSelector('#audit-rows tr td');
    const log = await page.textContent('#audit-rows');
    assert(/settings\.change/.test(log) && /players\.rename/.test(log) && /parts\.review/.test(log), 'the audit log shows what was done');
    await shot(page, '4-audit');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('a[href="#overview"]');
    await page.waitForSelector('#ov-body .tile');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert(wide, 'the dashboard fits a phone screen without sideways scrolling');
    await shot(page, '5-phone');
    await page.click('#sign-out');
    assert(await page.locator('#login').isVisible(), 'signing out returns to the sign-in form');
    await ctx.close();

    const glass = await browser.newContext();
    const g = await glass.newPage();
    watch(g);
    await g.goto(`${API}/admin/`);
    await g.click('.break-glass summary');
    await g.fill('#token-input', TOKEN);
    await g.click('#token-form button[type=submit]');
    await g.waitForSelector('#app:not([hidden])');
    assert((await g.textContent('#who-email')) === 'break-glass token', 'the break-glass key opens the dashboard');
    await glass.close();

    // The game picks up the announcement and the switched-off theme.
    const game = await browser.newContext({ serviceWorkers: 'block' });
    const cfg = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', appVersion: '9.9.9' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = '${API}';\n`;
    await game.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: cfg }));
    await game.route('**/v1/learn/**', (r) => r.fulfill({ status: 204, body: '' }));
    await game.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true })));
    const p = await game.newPage();
    await p.goto(`${APP}/`);
    await p.waitForSelector('#announcements:not([hidden]) .announcement');
    assert(/Double points/.test(await p.textContent('#announcements')), 'the game shows the announcement');
    await p.waitForFunction((t) => !document.querySelector(`input[name=theme][value="${t}"]`), theme);
    assert(await p.locator('input[name=theme][value=random]').count() === 1, 'the switched-off theme is gone from the picker');
    await shot(p, '6-game');
    await p.click('#announcements button[data-close]');
    assert(await p.locator('#announcements').isHidden(), 'a player can close the announcement');
    await p.reload();
    await p.waitForSelector('#tier-choices input');
    await p.waitForTimeout(800);
    assert(await p.locator('#announcements').isHidden(), 'a closed announcement stays closed');
    await game.close();

    assert(!problems.length, `no console errors or blocked scripts (${problems.join(' | ')})`);
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
