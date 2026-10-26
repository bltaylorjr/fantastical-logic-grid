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
const SITE_PORT = 8164;
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: APP, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks), SITE_URL: `http://localhost:${SITE_PORT}` },
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
  const gsc = { site: 'https://thelogicgrid.com/', start: '2026-09-27', end: '2026-10-24', totals: { clicks: 40, impressions: 900, ctr: 4.4, position: 7.3 },
    byDay: [{ date: '2026-10-23', clicks: 15, impressions: 400 }, { date: '2026-10-24', clicks: 25, impressions: 500 }],
    queries: [{ key: 'logic grid puzzles', clicks: 30, impressions: 600, ctr: 5, position: 4.2 }], pages: [{ key: 'https://thelogicgrid.com/rules.html', clicks: 8, impressions: 90, ctr: 8.9, position: 5 }],
    sitemaps: [{ path: 'https://thelogicgrid.com/sitemap.xml', lastSubmitted: '2026-10-25T18:00:00Z', lastDownloaded: null, pending: false, errors: 0, warnings: 0, submitted: 12, indexed: 9 }],
    home: { verdict: 'PASS', coverage: 'Submitted and indexed', lastCrawl: '2026-10-24T10:00:00Z' }, errors: [] };
  await db.prepare("INSERT INTO search_snapshots (source, fetched_at, data, tried_at) VALUES ('google', ?1, ?2, ?1)").bind(now, JSON.stringify(gsc)).run();
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  // The website build, for the daily puzzle planner's preview.
  const siteServer = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'site'), String(SITE_PORT)], { stdio: 'ignore' });
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
    // Installable on phones: manifest, icons and the service worker.
    const man = await page.evaluate(async () => { const r = await fetch(document.querySelector('link[rel=manifest]').href); return { type: r.headers.get('content-type'), body: await r.json() }; });
    assert(/manifest\+json/.test(man.type) && man.body.start_url === '/admin/' && man.body.display === 'standalone', 'the dashboard has an app manifest');
    for (const icon of [...man.body.icons.map((i) => i.src), '/admin/apple-touch-icon.png']) {
      const st = await page.evaluate(async (u) => (await fetch(u)).status, icon);
      assert(st === 200, `app icon ${icon} is served`);
    }
    const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return reg.scope; });
    assert(/\/admin\/$/.test(sw), 'the service worker is installed for /admin/');
    assert(await page.locator('#phone-help summary').isVisible(), 'the sign-in page explains how to put it on a phone');
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
    await page.click('#nav-list a[href="#settings"]');
    await page.waitForSelector('[data-view="settings"]:not([hidden])');
    await page.click('#home');
    await page.waitForSelector('[data-view="overview"]:not([hidden])');
    assert(await page.locator('[data-view="settings"]').isHidden(), 'the Home button goes back to the overview');
    await page.click('#home');
    assert(await page.locator('[data-view="overview"]').isVisible() && page.url().endsWith('#overview'), 'Home on the overview stays on the overview');
    await shot(page, '1-overview');

    await page.click('a[href="#stories"]');
    await page.waitForSelector('#parts-list button[data-status=approved]');
    await page.click('#parts-list button[data-status=approved]');
    await page.waitForFunction(() => /Nothing here/.test(document.querySelector('#parts-list').textContent));
    assert((await db.prepare("SELECT status FROM parts WHERE key = 'mystery|places|mill'").first()).status === 'approved', 'a story part is approved');
    // The Story workshop moved here from the game.
    await page.selectOption('#ws-story', 'mystery');
    await page.selectOption('#ws-kind', 'openings');
    await page.fill('#ws-text', 'Five friends met at the pier.');
    await page.click('#ws-form button[type=submit]');
    await page.waitForSelector('#ws-error:not([hidden])');
    assert(true, 'the workshop refuses a part with a head count, with a reason');
    await page.fill('#ws-text', 'Moonlight filled the old observatory, where {n} {many} waited for the comet.');
    await page.click('#ws-form button[type=submit]');
    let added = null;
    for (let i = 0; i < 50 && !added; i++) { added = await db.prepare("SELECT status, source FROM parts WHERE theme = 'mystery' AND kind = 'openings'").first(); if (!added) await new Promise((r) => setTimeout(r, 100)); }
    assert(added && added.status === 'approved' && added.source === 'admin', 'a story part written in the workshop goes straight to every player');

    await page.click('a[href="#settings"]');
    await page.waitForSelector('input[name=theme-off]');
    const theme = await page.getAttribute('input[name=theme-off]:nth-of-type(1)', 'value');
    await page.locator('input[name=theme-off]').first().check();
    await page.click('button[data-save=disabled_themes]');
    await page.waitForFunction(() => /Changed by/.test(document.querySelector('#settings-body').textContent));
    const saved = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'disabled_themes'").first()).value);
    assert(saved.length === 1 && saved[0] === theme, `theme "${theme}" is switched off`);
    // Settings that moved out of the game.
    const dbValue = async (key) => { const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r && JSON.parse(r.value); };
    const until = async (key, want) => { for (let i = 0; i < 50 && (await dbValue(key)) !== want; i++) await new Promise((r) => setTimeout(r, 100)); return (await dbValue(key)) === want; };
    assert(/GEMINI_API_KEY/.test(await page.textContent('#settings-body')), 'the dashboard shows which keys are set, without the keys');
    // The Connections and setup guide, from admin/connections.js, with live status.
    await page.click('#settings-body a[href="#connections"]');
    await page.waitForSelector('#conn-list details.conn[data-id=admin-sign-in][data-state=connected]', { state: 'attached' });
    assert(await page.locator('#conn-list details.conn').count() > 15, 'the setup guide lists every connection');
    assert((await page.getAttribute('details.conn[data-id=admin-sign-in]', 'data-state')) === 'connected', 'a connection whose Worker secrets are set shows Connected');
    assert((await page.getAttribute('details.conn[data-id=github-security]', 'data-state')) === 'manual', 'one with nothing to check says to check it by hand');
    await page.fill('#conn-q', 'GMAIL_APP_PASSWORD');
    await page.waitForFunction(() => [...document.querySelectorAll('details.conn')].filter((d) => !d.hidden).length === 1);
    assert(await page.locator('details.conn[data-id=gmail]').evaluate((d) => d.open && !d.hidden), 'searching a secret name finds and opens its connection');
    assert(/myaccount\.google\.com\/apppasswords/.test(await page.textContent('details.conn[data-id=gmail]')), 'its steps link to the settings page');
    await page.check('details.conn[data-id=gmail] input[data-tick=gmail-0]');
    await page.fill('#conn-q', '');
    await page.selectOption('#conn-show', 'attention');
    assert(await page.locator('details.conn[data-id=github-security]').isHidden(), 'Needs attention hides the rest');
    await page.selectOption('#conn-show', 'all');
    await shot(page, '8-connections');
    await page.click('a[href="#settings"]');
    await page.waitForSelector('input[data-key=default_music]');
    await page.uncheck('input[data-key=default_music]');
    assert(await until('default_music', false), 'theme music starts off for players who have not chosen');
    await page.waitForSelector('input[data-key=confetti]:not([disabled])');
    await page.uncheck('input[data-key=confetti]');
    assert(await until('confetti', false), 'confetti is switched off for everyone');
    await page.waitForSelector('input[data-key=fireworks]:not([disabled])');
    await page.check('input[data-key=fireworks]');
    assert(await until('fireworks', true), 'fireworks are switched on for everyone');
    await page.waitForSelector('input[data-key=celebrate_random]:not([disabled])');
    await page.check('input[data-key=celebrate_random]');
    assert(await until('celebrate_random', true), 'Random celebrations are switched on');
    // Each save redraws the settings, so a choice made while the last save is
    // still redrawing can be lost: try again until it is stored.
    const pick = async (key, value) => {
      for (let i = 0; i < 4; i++) {
        await page.waitForSelector(`#set-${key}`);
        await page.selectOption(`#set-${key}`, value);
        await page.click(`button[data-save=${key}]`);
        if (await until(key, value)) return true;
      }
      return false;
    };
    assert(await pick('portrait_style', 'lorelei'), 'the portrait style is chosen for everyone');
    assert(await pick('voice_source', 'device'), 'where voices come from is chosen for everyone');
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

    await page.click('a[href="#search"]');
    await page.waitForSelector('#search-body .tile');
    const search = await page.textContent('#search-body');
    assert(/logic grid puzzles/.test(search) && /Submitted and indexed/.test(search) && /\/rules\.html/.test(search), 'the Search section shows Google searches, pages and indexing');
    assert(/Not connected yet/.test(search), 'Bing shows how to connect it');
    await shot(page, '4-search');

    // Free-limit alerts: voices at 140 of 300 are fine; at 290 the overview warns.
    assert(!(await page.locator('#ov-body .alerts').count()), 'no free-limit warning while usage is low');

    // Daily puzzles: the coming days from the site build, and a planned change.
    const upcoming = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'site', 'daily', 'upcoming.json'), 'utf8'));
    await page.click('a[href="#daily"]');
    await page.waitForSelector('#daily-body table');
    assert((await page.textContent('#daily-body')).includes(upcoming.days[0].title), 'the planner previews the coming days from the website build');
    await page.click(`#daily-body button[data-plan="${upcoming.days[1].date}"]`);
    await page.selectOption('#dialog [name=theme]', 'scifi');
    await page.selectOption('#dialog [name=difficulty]', 'hard');
    await page.fill('#dialog [name=note]', 'Space week');
    await page.click('#dialog-ok');
    await page.waitForSelector('#daily-body .badge.warn');
    const planned = await db.prepare('SELECT theme, difficulty, note FROM daily_plan WHERE date = ?1').bind(upcoming.days[1].date).first();
    assert(planned && planned.theme === 'scifi' && planned.difficulty === 'hard' && planned.note === 'Space week', 'a coming day is planned');
    const pub = await page.evaluate(async (u) => (await fetch(u)).json(), `${API}/v1/daily/plan`);
    assert(pub.plan.length === 1 && pub.plan[0].theme === 'scifi', 'the website build can read the plan');
    await page.click(`#daily-body button[data-plan-new="${upcoming.days[2].date}"]`);
    await page.waitForFunction((d) => document.querySelector(`#daily-body button[data-plan-reset="${d}"]`), upcoming.days[2].date);
    assert((await db.prepare('SELECT reroll FROM daily_plan WHERE date = ?1').bind(upcoming.days[2].date).first()).reroll === 1, 'New story asks for a different story');
    await page.click(`#daily-body button[data-plan-reset="${upcoming.days[2].date}"]`);
    await page.waitForFunction((d) => !document.querySelector(`#daily-body button[data-plan-reset="${d}"]`), upcoming.days[2].date);
    assert(!(await db.prepare('SELECT 1 FROM daily_plan WHERE date = ?1').bind(upcoming.days[2].date).first()), 'Back to automatic removes the change');
    await shot(page, '4-daily');

    // Puzzle quality.
    await page.click('a[href="#quality"]');
    await page.waitForSelector('#quality-body .tile');
    assert(/Groups to look at/.test(await page.textContent('#quality-body')) && await page.locator('#quality-body table tbody tr').count() >= 4, 'the quality report lists themes and levels');
    // Any table downloads as CSV.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#quality-body [data-csv]')]);
    const csvFile = fs.readFileSync(await dl.path(), 'utf8');
    assert(/^\uFEFF?Theme,Difficulty/.test(csvFile) && /\.csv$/.test(dl.suggestedFilename()), `a table downloads as a CSV file (${dl.suggestedFilename()})`);
    await page.click('a[href="#players"]');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-export=scores]')]);
    assert(/Screen name/.test(fs.readFileSync(await dl2.path(), 'utf8')) && /logic-grid-scores-/.test(dl2.suggestedFilename()), 'all scores download as a CSV file');

    await db.prepare("UPDATE usage SET count = 290 WHERE name = 'tts'").run();
    await page.click('a[href="#overview"]');
    await page.waitForSelector('#ov-body .alerts');
    assert(/Free server voices today/.test(await page.textContent('#ov-body .alerts')), 'the overview warns when a free allowance is nearly used');
    await db.prepare("UPDATE usage SET count = 140 WHERE name = 'tts'").run();

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
    await game.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true })); });
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

    // Settings now run from the dashboard.
    const st = await p.evaluate(async () => (await import('./js/store.js')).loadSettings());
    assert(st.portraitStyle === 'lorelei' && st.voiceProvider === 'device' && st.confetti === false, 'the game uses the dashboard\'s pictures and voices');
    assert(st.celebrations.join() === 'fireworks' && st.celebrateRandom === true, `the game uses the dashboard's celebration effects (${st.celebrations})`);
    const openSettings = async () => { await p.click('#menu-btn'); await p.click('#app-menu [data-cmd=settings]'); await p.waitForSelector('#dlg-settings[open]'); };
    await openSettings();
    const names = await p.$$eval('#settings-form [name]', (els) => [...new Set(els.map((e) => e.name))]);
    assert(!names.some((n) => ['portraitStyle', 'confetti', 'celebrations', 'celebrateRandom', 'readAloud', 'aiKey', 'geminiKey', 'voiceProvider', 'serverVoices', 'shareLearning', 'reportErrors', 'aiPictures'].includes(n)), `Settings keeps only the player's own choices (${names.join(', ')})`);
    assert(await p.isChecked('input[name=sound]'), 'sound effects start on');
    assert(!(await p.isChecked('input[name=music]')), 'the dashboard\'s starting value for theme music applies to a player who never changed it');
    await p.check('input[name=music]');
    await p.keyboard.press('Escape');
    await p.reload();
    await p.waitForSelector('#tier-choices input');
    await openSettings();
    assert(await p.isChecked('input[name=music]'), 'a player\'s own choice wins over the dashboard\'s starting value');
    await p.keyboard.press('Escape');

    // The two boxes: an idea and a problem report arrive separately.
    await p.click('#menu-btn');
    await p.click('#app-menu [data-cmd=feedback]');
    await p.waitForSelector('#dlg-feedback[open]');
    assert(await p.$eval('#idea-form .fb-reply', (el) => el.hidden), 'a guest is not offered a thank-you email');
    await p.fill('#idea-text', 'A pirate ship lost in the fog where the crew swapped maps.');
    await p.click('#idea-form button[type=submit]');
    await p.waitForFunction(() => /sent/.test(document.querySelector('#idea-form .acct-done').textContent));
    await p.selectOption('#problem-topic', 'sound');
    await p.fill('#problem-text', 'The music stopped after the second puzzle.');
    await p.click('#problem-form button[type=submit]');
    await p.waitForFunction(() => /sent/.test(document.querySelector('#problem-form .acct-done').textContent));
    const fb = (await db.prepare('SELECT kind, topic FROM feedback ORDER BY id').all()).results.map((r) => `${r.kind}:${r.topic}`);
    assert(fb.join() === 'idea:story,problem:sound', `an idea and a problem arrive in separate boxes (${fb.join()})`);

    // ...and show up in the dashboard, each in its own list.
    const look = await browser.newContext();
    const q = await look.newPage();
    watch(q);
    await q.goto(`${API}/admin/#feedback`);
    await q.click('.break-glass summary');
    await q.fill('#token-input', TOKEN);
    await q.click('#token-form button[type=submit]');
    await q.waitForSelector('#fb-list button[data-status=done]');
    assert(/pirate ship/.test(await q.textContent('#fb-list')) && !/music stopped/.test(await q.textContent('#fb-list')), 'the dashboard lists ideas on their own');
    assert(/Thank-you emails/.test(await q.textContent('#fb-replies')), 'the dashboard shows the thank-you email counts');
    await q.check('input[name=fb-kind][value=problem]');
    await q.waitForFunction(() => /music stopped/.test(document.querySelector('#fb-list').textContent));
    await q.click('#fb-list button[data-status=done]');
    await q.waitForFunction(() => /Nothing here/.test(document.querySelector('#fb-list').textContent));
    assert((await db.prepare("SELECT status FROM feedback WHERE kind = 'problem'").first()).status === 'done', 'a problem can be marked done');
    await shot(q, '7-feedback');
    await look.close();
    await game.close();

    assert(!problems.length, `no console errors or blocked scripts (${problems.join(' | ')})`);
  } finally {
    await browser.close();
    app.kill();
    siteServer.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
