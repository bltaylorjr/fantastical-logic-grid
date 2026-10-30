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
    const winApp = /\/releases\/download\/admin-desktop\/The-Fantastical-Logic-Grid-Admin-Setup\.exe$/;
    assert(winApp.test(await page.locator('#phone-help a').first().getAttribute('href')), 'the install steps link the Windows admin app');
    assert(await page.locator('#get-windows').isHidden(), 'Download for Windows is hidden off Windows');
    {
      // On Windows the header offers the download; inside the Windows app
      // (which sets __FLG_ADMIN_DESKTOP__) neither it nor the steps show.
      const win = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0' });
      const w = await win.newPage();
      await w.goto(`${API}/admin/`);
      assert(await w.locator('#get-windows').isVisible(), 'Windows visitors see Download for Windows');
      assert(winApp.test(await w.locator('#get-windows').getAttribute('href')), 'Download for Windows links the admin installer');
      await w.addInitScript(() => { window.__FLG_ADMIN_DESKTOP__ = true; });
      await w.reload();
      assert(await w.locator('#get-windows').isHidden() && await w.locator('#phone-help').isHidden(), 'the Windows app hides the download and install steps');
      await win.close();
    }
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

    // Every Overview card opens the details for that figure, by mouse or keyboard.
    const cards = await page.locator('#ov-body a.tile').count();
    assert(cards === (await page.locator('#ov-body .tile').count()) && cards >= 12, 'every Overview card is a link');
    await page.click('#ov-body a.tile[href="#details/voices"]');
    await page.waitForSelector('[data-view="details"]:not([hidden]) #dt-body svg[role=img]');
    await shot(page, '1b-details');
    assert((await page.textContent('#h-details')) === 'Free voices' && /140/.test(await page.textContent('#dt-body')), 'the voices card opens the voice details');
    assert(await page.evaluate(() => document.activeElement.id === 'h-details'), 'the details heading takes focus');
    assert((await page.getAttribute('#nav-list a[href="#overview"]', 'aria-current')) === 'page', 'Overview stays marked in the menu on a details page');
    await page.selectOption('#dt-days', '7');
    await page.waitForFunction(() => /Day by day/.test(document.querySelector('#dt-body').textContent) && document.querySelectorAll('#dt-body tbody tr').length === 7);
    await page.click('[data-view="details"] a[href="#overview"]');
    await page.waitForSelector('[data-view="overview"]:not([hidden]) a.tile');
    assert((await page.inputValue('#ov-days')) === '7', 'the period carries back to the Overview');
    // The 7-day cards stay on screen until the 30-day numbers arrive and redraw them.
    await page.evaluate(() => { document.querySelector('#ov-body a.tile[href="#details/games"]').dataset.stale = '1'; });
    await page.selectOption('#ov-days', '30');
    await page.waitForFunction(() => { const t = document.querySelector('#ov-body a.tile[href="#details/games"]'); return t && !t.dataset.stale; });
    await page.focus('#ov-body a.tile[href="#details/games"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#h-details').textContent === 'Games finished' && /Day by day/.test(document.querySelector('#dt-body').textContent));
    assert(/mystery/.test(await page.textContent('#dt-body')), 'Enter on a card opens its details');
    for (const key of ['solved', 'races', 'scoring', 'accounts', 'pictures']) {
      await page.evaluate((k) => { location.hash = `details/${k}`; }, key);
      await page.waitForFunction(() => /Day by day/.test(document.querySelector('#dt-body').textContent));
    }
    await page.click('#home');
    await page.waitForSelector('#ov-body a.tile[data-players-section="blocked"]');
    await page.click('#ov-body a.tile[data-players-section="blocked"]');
    await page.waitForSelector('[data-view="players"]:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#players-sections [data-section="blocked"]').getAttribute('aria-pressed') === 'true');
    await page.click('#players-sections [data-section="all"]');
    await page.click('#home');
    await page.waitForSelector('[data-view="overview"]:not([hidden]) a.tile');

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
    await page.waitForSelector('input[name=theme-disabled_themes]');
    const theme = await page.getAttribute('input[name=theme-disabled_themes]:nth-of-type(1)', 'value');
    await page.locator('input[name=theme-disabled_themes]').first().check();
    await page.click('button[data-save=disabled_themes]');
    await page.waitForFunction(() => /Changed by/.test(document.querySelector('#settings-body').textContent));
    // "Changed by" can already show from an earlier save, so wait for the row itself.
    let saved = [];
    for (let i = 0; i < 50 && saved.length !== 1; i++) {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'disabled_themes'").first();
      saved = row ? JSON.parse(row.value) : [];
      if (saved.length !== 1) await new Promise((r) => setTimeout(r, 100));
    }
    assert(saved.length === 1 && saved[0] === theme, `theme "${theme}" is switched off`);
    // Settings that moved out of the game.
    const dbValue = async (key) => { const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r && JSON.parse(r.value); };
    const until = async (key, want) => { for (let i = 0; i < 50 && (await dbValue(key)) !== want; i++) await new Promise((r) => setTimeout(r, 100)); return (await dbValue(key)) === want; };
    assert(/GEMINI_API_KEY/.test(await page.textContent('#settings-body')), 'the dashboard shows which keys are set, without the keys');
    // Number Place has its own section: its games and the settings only it uses.
    assert(!(await page.locator('#settings-body [data-key^=np_]').count()), 'Number Place settings are not in the shared Settings page');
    await page.click('a[href="#numberplace"]');
    await page.waitForSelector('#np-body input[data-np-key=np_daily_enabled]');
    assert(/Number Place settings/.test(await page.textContent('#np-body')) && /Games since/.test(await page.textContent('#np-body')), 'the Number Place section shows its games and settings');
    await page.locator('#np-body input[data-np-key=np_daily_enabled]').uncheck();
    assert(await until('np_daily_enabled', false), 'a Number Place setting is saved from its own section');
    await page.selectOption('#npset-np_max_level', 'expert');
    await page.click('button[data-np-save=np_max_level]');
    assert(await until('np_max_level', 'expert'), 'the hardest Number Place level is saved');
    await page.click('a[href="#settings"]');
    await page.waitForSelector('#settings-body a[href="#connections"]');
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
    // Get the key: the owner goes to the site with the app id only (the app
    // secret is typed on return, never stored), and coming back takes the
    // code off the address bar.
    await page.click('details.conn[data-id=reddit] summary');
    await page.click('details.conn[data-id=reddit] button[data-key-site=reddit]');
    await page.fill('#dialog [name=clientId]', 'test-app');
    await page.route('https://www.reddit.com/**', (r) => r.fulfill({ body: '<p>reddit</p>', contentType: 'text/html' }));
    await Promise.all([page.waitForURL((u) => u.hostname === 'www.reddit.com'), page.click('#dialog-ok')]);
    const sent = new URL(page.url());
    assert(sent.searchParams.get('client_id') === 'test-app' && sent.searchParams.get('redirect_uri') === `${API}/admin/`
      && sent.searchParams.get('duration') === 'permanent', 'Get the key sends the app id to the site');
    await page.goto(`${API}/admin/?state=${encodeURIComponent(sent.searchParams.get('state'))}&error=access_denied`);
    await page.waitForFunction(() => /did not allow/.test(document.querySelector('#toast')?.textContent || ''));
    assert(!page.url().includes('state=') && page.url().endsWith('#connections'), 'the code is taken off the address bar');
    assert(await page.evaluate(() => !sessionStorage.getItem('flg-oauth')), 'the pending sign-in is cleared from the tab');
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

    // Media library: every sound and picture, by group, from the game's own code.
    await page.click('#nav-list a[href="#media"]');
    await page.waitForSelector('#media-body [data-music=mystery]');
    assert(await page.locator('#media-body [data-music]').count() >= 18, 'Background music: one piece for each theme');
    await page.click('#media-body [data-music=mystery]');
    assert((await page.getAttribute('#media-body [data-music=mystery]', 'aria-pressed')) === 'true', 'a theme\'s music plays');
    assert(await page.evaluate(() => new Promise((r) => setTimeout(() => r(true), 300))), 'the music keeps playing without errors');
    await page.click('#media-body [data-music=mystery]');
    assert((await page.getAttribute('#media-body [data-music=mystery]', 'aria-pressed')) === 'false', 'and stops again');
    await page.click('#media-tabs [data-tab=sfx]');
    await page.click('#media-body [data-sfx=solve]');
    assert(await page.locator('#media-body [data-sfx]').count() === 10, 'Sound effects: every sound players hear');
    await page.click('#media-tabs [data-tab=voices]');
    assert(await page.locator('#media-body [data-voice=Kore][disabled]').count() > 0, 'Voices: server voices say they are not set up yet');
    await page.click('#media-tabs [data-tab=celebrations]');
    assert(await page.isChecked('#media-body [data-fx-on=fireworks]'), 'Celebrations show which effects are on for players');
    await page.click('#media-body [data-fx=confetti]');
    await page.waitForSelector('body > canvas', { state: 'attached' });
    assert(true, 'a celebration plays here');
    await page.check('#media-body [data-fx-on=bubbles]');
    assert(await until('bubbles', true), 'a celebration can be switched on from the Media library');
    await page.uncheck('#media-body [data-fx-on=bubbles]');
    assert(await until('bubbles', false), 'and off again');
    await page.click('#media-tabs [data-tab=scenes]');
    assert(await page.locator('#media-body .scene-svg').count() >= 18, 'Theme scenes: one for each theme');
    await page.fill('#media-layers', '0');
    assert(await page.locator('#media-body .scene-svg .layer.on').count() === 0, 'the scene shows how it grows as the grid fills');
    await shot(page, '10-media-scenes');
    await page.click('#media-tabs [data-tab=faces]');
    assert(await page.locator('#media-body .media-faces img').count() === 24 && await page.locator('#media-body .media-faces svg').count() >= 72, 'Character faces: every style, women and men');
    await shot(page, '11-media-faces');
    await page.click('#media-tabs [data-tab=pictures]');
    assert(/🔍/.test(await page.textContent('#media-body')), 'Theme pictures: the little pictures for each theme');

    await page.click('a[href="#communication"]');
    await page.check('input[name=comm-tab][value=send]');
    await page.waitForSelector('#comm-send:not([hidden])');
    await page.fill('#ann-text', 'Double points this weekend!');
    await page.click('#ann-form button[type=submit]');
    await page.waitForSelector('#ann-list .badge.ok');
    assert(/Double points/.test(await page.textContent('#ann-list')), 'an announcement is published');
    await page.fill('#news-title', 'Three new worlds');
    await page.fill('#news-text', 'Explore the sunken city, the cloud market and the clockwork forest.');
    await page.click('#news-form button[type=submit]');
    await page.waitForSelector('#news-list .badge.ok');
    assert(/Three new worlds/.test(await page.textContent('#news-list')), 'news for every player\'s Messages is published');

    await page.click('a[href="#names"]');
    await page.waitForSelector('#names-rows button[data-act=reset]');
    await page.click('#names-rows button[data-act=reset]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /Nothing here/.test(document.querySelector('#names-rows').textContent));
    const renamed = (await db.prepare("SELECT screen_name FROM players WHERE user_id = 'player-1'").first()).screen_name;
    assert(/^Player [A-Z2-9]{4}$/.test(renamed), `a screen name is reset (${renamed})`);

    // Players: every account in sections, with Approve and Block on each name.
    await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind('player-2', 'Fresh Face', 'freshface', Date.now()).run();
    await db.prepare('INSERT INTO sync_users (user_id, rev, created_at) VALUES (?1, 1, ?2)').bind('sync-only-1', Date.now()).run();
    await page.click('a[href="#players"]');
    await page.waitForFunction(() => /Fresh Face/.test(document.querySelector('#players-rows').textContent) && /No screen name/.test(document.querySelector('#players-rows').textContent));
    await page.click('#players-sections [data-section=pending]');
    await page.waitForFunction(() => document.querySelector('#players-sections [data-section=pending]').getAttribute('aria-pressed') === 'true'
      && !/No screen name/.test(document.querySelector('#players-rows').textContent));
    assert(/Fresh Face/.test(await page.textContent('#players-rows')), 'Needs approval lists the new name');
    await page.click('#players-rows button[data-act=approve]');
    await page.waitForFunction(() => /No players here/.test(document.querySelector('#players-rows').textContent));
    assert((await db.prepare("SELECT 1 FROM name_reviews WHERE user_id = 'player-2'").first()), 'Approve approves the name');
    await page.click('#players-sections [data-section=active]');
    await page.waitForFunction(() => /Fresh Face/.test(document.querySelector('#players-rows').textContent));
    await page.click('#players-table th[data-sort=name] button');
    await page.waitForSelector('#players-table th[data-sort=name][aria-sort=ascending]');
    await page.click('#players-sections [data-section=all]');
    await page.waitForFunction(() => /No screen name/.test(document.querySelector('#players-rows').textContent));
    assert(/Showing 1 to 3 of 3 players/.test(await page.textContent('#players-count')), 'Everyone counts every account');
    await shot(page, '3-players');
    await page.click('#players-rows a.rowlink[href="#players/player-1"]');
    await page.waitForSelector('#player-card');
    assert(/Latest scores/.test(await page.textContent('#player-card')), 'a player opens with their scores');
    await shot(page, '3-player');

    await page.click('a[href="#supporters"]');
    await page.waitForSelector('#sup-rows td');
    await page.fill('#sup-who', 'fan@example.com');
    await page.selectOption('#sup-kind', 'premium');
    await page.selectOption('#sup-tier', '3');
    await page.fill('#sup-note', 'Ko-fi tip');
    await page.click('#sup-form button[type=submit]');
    await page.waitForSelector('#sup-rows button[data-sup-end]');
    assert(/fan@example\.com/.test(await page.textContent('#sup-rows')) && /Premium/.test(await page.textContent('#sup-rows')) && /Gold/.test(await page.textContent('#sup-rows')), 'an admin adds a Gold premium supporter by email');
    await page.click('#sup-rows button[data-reason=chargeback]');
    await page.waitForSelector('#dialog[open]');
    await page.fill('#dialog-body input[name=note]', 'Dispute dp_123');
    await page.click('#dialog-ok');
    await page.waitForSelector('#sup-blocks button[data-sup-unblock]');
    assert(/Chargeback/.test(await page.textContent('#sup-rows')) && !(await page.locator('#sup-rows button[data-sup-end]').count()), 'a chargeback ends the grant and marks it');
    assert(/fan@example\.com/.test(await page.textContent('#sup-blocks')) && /dp_123/.test(await page.textContent('#sup-blocks')), 'the player is listed as blocked, with the note');

    // App keys: make a key, see it listed, allow a second install.
    await page.click('a[href="#licenses"]');
    await page.waitForSelector('#lic-rows td');
    assert(/LICENSE_SIGNING_KEY/.test(await page.textContent('#lic-banner')), 'App keys says the signing secret is not set yet');
    await page.fill('#lic-label', 'Test player');
    await page.click('#lic-form button[type=submit]');
    await page.waitForSelector('#lic-rows code.lic-key');
    const made = await page.textContent('#lic-made-list');
    assert(/^FLG(-[2-9A-HJ-NP-Z]{5}){4}$/.test(made.trim()) && (await page.textContent('#lic-rows')).includes(made.trim()), 'an admin makes an app key and it is listed');
    assert(/0 of 1/.test(await page.textContent('#lic-rows')) && /0 of 2/.test(await page.textContent('#lic-rows')), 'the key shows its installs (0 of 1) and downloads (0 of 2)');
    await page.click('#lic-rows button[data-lic-two]');
    await page.waitForSelector('#lic-rows button[data-lic-one]');
    assert(/0 of 2[\s\S]*0 of 2/.test(await page.textContent('#lic-rows')), 'an admin allows a second install');
    await shot(page, '3-app-keys');

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
    // Ratings and insights.
    await page.click('a[href="#ratings"]');
    await page.waitForSelector('#ratings-body .tile');
    const rt = await page.textContent('#ratings-body');
    assert(/Average rating/.test(rt) && /What's working/.test(rt) && /What to improve/.test(rt) && /In a few words/.test(rt), 'Ratings and insights shows the numbers and the plain-words analysis');
    assert(await page.locator('#ratings-body .spread-list li').count() === 5 && await page.locator('#ratings-body table tbody tr').count() >= 1, 'it shows the 1 to 5 spread and a table by theme and difficulty');
    await page.selectOption('#rt-by', 'clue');
    await page.waitForFunction(() => /By clue type/.test(document.querySelector('#ratings-body').textContent));
    assert(true, 'Group by changes the table');
    await shot(page, '4b-ratings');
    // Marketing: the starter campaign, ad words with their tracked link, media and numbers.
    await db.prepare("INSERT INTO campaign_stats (day, campaign, source, medium, content, event, platform, n) VALUES (?1, 'launch-2026', 'pinterest', 'social', 'printable-pin', 'visit', 'web', 12), (?1, 'launch-2026', 'pinterest', 'social', 'printable-pin', 'solve', 'web', 5)").bind(new Date(now).toISOString().slice(0, 10)).run();
    await page.click('a[href="#marketing"]');
    await page.waitForSelector('#marketing-body .tile');
    const mk = await page.textContent('#marketing-body');
    assert(/Launch on free channels/.test(mk) && /Visits/.test(mk) && /By channel/.test(mk), 'Marketing shows the launch campaign and its numbers');
    assert(await page.locator('#marketing-body .mk-ad').count() >= 20, 'every starter ad is listed');
    assert(await page.locator('#marketing-body .mk-media img').count() >= 5, 'media show their previews');
    const pin = page.locator('#marketing-body details:has-text("Pinterest: printable puzzles pin")');
    await pin.locator('summary').click();
    const words = await pin.locator('textarea').inputValue();
    assert(/utm_campaign=launch-2026&utm_content=printable-pin/.test(words) && !/\{link\}/.test(words), 'an ad\'s words carry its tracked link');
    assert(/12 visits/.test(await pin.locator('summary').textContent()), 'each ad shows what it brought in');
    await pin.locator('[data-ad-posted]').click();
    await page.waitForSelector('#mk-dialog[open]');
    await page.fill('#mk-dialog input[name=postUrl]', 'https://www.pinterest.com/pin/1234/');
    await page.click('#mk-dialog-ok');
    await page.waitForFunction(() => /Live post/.test(document.querySelector('#marketing-body').textContent));
    assert(true, 'an ad is marked as posted with its live link');
    await page.click('#mk-c-new');
    await page.waitForSelector('#mk-dialog[open]');
    await page.fill('#mk-dialog input[name=name]', 'Library flyers');
    await page.click('#mk-dialog-ok');
    await page.waitForFunction(() => /Library flyers/.test(document.querySelector('#marketing-body').textContent));
    await page.selectOption('#mk-b-c', 'library-flyers');
    await page.fill('#mk-b-s', 'library');
    await page.selectOption('#mk-b-m', 'print');
    assert(/utm_source=library&utm_medium=print&utm_campaign=library-flyers/.test(await page.inputValue('#mk-b-out')), 'a new campaign and a tracked link from the link maker');
    await shot(page, '4c-marketing');
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

    // Responsive: every page at phone, tablet, 200% zoom and monitor sizes, with
    // no sideways scrolling and no button or field under 44 px.
    const pages = await page.$$eval('#nav-list a:not([hidden])', (as) => as.map((a) => a.getAttribute('href').slice(1)));
    for (const [label, width, height] of [['a phone', 360, 780], ['a portrait tablet', 768, 1024], ['200% zoom', 640, 400], ['a large monitor', 1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const bad = [];
      for (const view of pages) {
        await page.evaluate((v) => { location.hash = v; }, view);
        await page.waitForSelector(`[data-view="${view}"]:not([hidden])`);
        await page.waitForTimeout(250);
        const r = await page.evaluate(() => {
          const small = [];
          for (const el of document.querySelectorAll('#app button, #app a[href], #app input, #app select, #app textarea, #app summary')) {
            if (el.closest('[hidden], .sr-only') || el.matches('.skip')) continue;
            let b = el.getBoundingClientRect();
            if (!b.width || !b.height || (el.tagName === 'A' && getComputedStyle(el).display === 'inline')) continue;
            if (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')) b = el.closest('label').getBoundingClientRect();
            if (Math.round(Math.min(b.width, b.height)) < 44) small.push(`${el.id || el.tagName} "${el.textContent.trim().slice(0, 20)}"`);
          }
          // The first element that sticks out past the screen, to name in a failure.
          const out = [...document.querySelectorAll('#app *')].find((el) => {
            if (el.getBoundingClientRect().right <= innerWidth + 1) return false;
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
            return true;
          });
          return { sideways: document.documentElement.scrollWidth > innerWidth + 1 && (out ? `${out.tagName}.${out.className} "${out.textContent.trim().slice(0, 30)}"` : 'yes'), small };
        });
        if (r.sideways) bad.push(`${view} scrolls sideways (${r.sideways})`);
        if (r.small.length) bad.push(`${view}: ${r.small.join(', ')} under 44 px`);
      }
      assert(!bad.length, `every dashboard page fits ${label} (${width} x ${height}) with 44 px targets${bad.length ? `: ${bad.join('; ')}` : ''}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { location.hash = 'overview'; });
    await page.waitForSelector('#ov-body .tile');
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
    // Arriving on a campaign link: the visit is counted and the address cleaned.
    await p.goto(`${APP}/?utm_source=reddit&utm_medium=forum&utm_campaign=launch-2026&utm_content=webgames-launch`);
    await p.waitForSelector('#announcements:not([hidden]) .announcement');
    assert(/Double points/.test(await p.textContent('#announcements')), 'the game shows the announcement');
    assert(!/utm_/.test(p.url()), 'the campaign tags leave the address bar');
    let visit = null;
    for (let i = 0; i < 20 && !visit; i++) { visit = await db.prepare("SELECT n FROM campaign_stats WHERE campaign = 'launch-2026' AND source = 'reddit' AND content = 'webgames-launch' AND event = 'visit'").first(); if (!visit) await p.waitForTimeout(200); }
    assert(visit && visit.n === 1, 'a visit from a campaign link is counted');
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

    // News shows in Messages, for guests too, with a badge until seen.
    await p.waitForSelector('#menu-count:not([hidden])');
    await p.click('#menu-btn');
    await p.click('#app-menu [data-cmd=messages]');
    await p.waitForSelector('#dlg-messages[open]');
    assert(/Three new worlds/.test(await p.textContent('#msg-news')), 'the game shows the news in Messages');
    assert(await p.isVisible('#msg-signin'), 'a guest is asked to sign in to write to the team');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelector('#menu-count').hidden, null, { timeout: 3000 }).catch(() => {});
    assert(await p.locator('#menu-count').isHidden(), 'seen news is no longer counted as new');

    // The two boxes: an idea and a problem report arrive separately.
    await p.click('#menu-btn');
    await p.click('#app-menu [data-cmd=feedback]');
    await p.waitForSelector('#dlg-feedback[open]');
    assert(await p.$eval('#idea-form .fb-reply', (el) => el.hidden), 'a guest is not offered email updates');
    assert(await p.isVisible('#idea-theme'), 'a storyline idea asks which theme it is for');
    assert(await p.$$eval('#idea-theme option', (o) => o.length) > 10, 'the theme list holds the game themes');
    assert(await p.locator(`#idea-theme option[value="${theme}"]`).count() === 0, 'a switched-off theme is not in the idea theme list');
    await p.check('#idea-form input[value=feature]');
    assert(await p.locator('#idea-theme').isHidden(), 'the theme list hides for other kinds of idea');
    await p.check('#idea-form input[value=story]');
    await p.selectOption('#idea-theme', 'adventure');
    await p.fill('#idea-text', 'A pirate ship lost in the fog where the crew swapped maps.');
    await p.click('#idea-form button[type=submit]');
    await p.waitForFunction(() => /sent/.test(document.querySelector('#idea-form .acct-done').textContent));
    assert(await p.locator('#dlg-feedback #problem-form').count() === 0, 'the idea box has no problem form any more');
    await p.click('#dlg-feedback [data-close]');
    // Problems go through Report a Problem in the footer, as a Web Page Issue here.
    await p.click('#report-problem');
    await p.waitForSelector('#dlg-report[open]');
    assert(await p.isChecked('input[name=report-kind][value=page]'), 'away from a puzzle it starts as a Web Page Issue');
    assert(await p.getAttribute('#report-text', 'maxlength') === '1000', 'the box holds 1,000 characters');
    await p.fill('#report-text', 'The music stopped after the second puzzle.');
    await p.click('#report-form button[type=submit]');
    await p.waitForFunction(() => /WS-[A-Z2-9]{8}/.test(document.querySelector('#report-done').textContent));
    await p.click('#dlg-report [data-close]');
    const fb = (await db.prepare('SELECT kind, topic, theme FROM feedback ORDER BY id').all()).results.map((r) => `${r.kind}:${r.topic}${r.theme ? `:${r.theme}` : ''}`);
    assert(fb.join() === 'idea:story:adventure,problem:page', `an idea and a web page issue arrive in their own places (${fb.join()})`);

    // ...and show up in the dashboard's one inbox (the old #feedback link still works).
    await db.prepare("INSERT INTO conversations (id, user_id, topic, subject, status, admin_unread, created_at, updated_at) VALUES (900, 'player-1', 'question', 'Can I print puzzles?', 'open', 1, ?1, ?1)").bind(Date.now()).run();
    await db.prepare("INSERT INTO conversation_messages (conversation_id, sender, text, created_at) VALUES (900, 'player', 'Can I print puzzles for my class?', ?1)").bind(Date.now()).run();
    const look = await browser.newContext();
    const q = await look.newPage();
    watch(q);
    await q.goto(`${API}/admin/#feedback`);
    await q.click('.break-glass summary');
    await q.fill('#token-input', TOKEN);
    await q.click('#token-form button[type=submit]');
    await q.waitForSelector('#comm-list button[data-story-act=approve]');
    assert(await q.isVisible('#comm-list button[data-story-act=decline]') && !(await q.isVisible('#comm-list button[data-status=done]')),
      'a new storyline is decided with Approve or Disapprove, not Mark addressed or Mark done');
    assert(/#communication$/.test(q.url()) && (await q.inputValue('#comm-type')) === 'idea', 'the old ideas link opens Communication on ideas');
    assert(/Theme: Adventure/.test(await q.textContent('#comm-list')), 'the inbox shows which theme a storyline idea is for');
    assert(/pirate ship/.test(await q.textContent('#comm-list')) && !/music stopped/.test(await q.textContent('#comm-list')), 'the inbox can show ideas on their own');
    assert(/Emails to players/.test(await q.textContent('#fb-replies')), 'the dashboard shows the email counts');
    await q.selectOption('#comm-type', 'problem');
    await q.waitForFunction(() => /music stopped/.test(document.querySelector('#comm-list').textContent));
    await q.click('#comm-list button[data-status=addressed]');
    await q.waitForSelector('#dialog[open]');
    await q.fill('#dialog-body textarea[name=note]', 'The music now loops without stopping (1.7.1).');
    await q.click('#dialog-ok');
    await q.waitForFunction(() => /Nothing here/.test(document.querySelector('#comm-list').textContent));
    const marked = await db.prepare("SELECT status, note FROM feedback WHERE kind = 'problem'").first();
    assert(marked.status === 'addressed' && /loops/.test(marked.note), 'a problem can be marked addressed with a note');
    await q.selectOption('#comm-status', 'addressed');
    await q.waitForFunction(() => /What we did:.*loops/.test(document.querySelector('#comm-list').textContent));
    await q.click('#comm-list button[data-status=new]');
    await q.waitForFunction(() => /Nothing here/.test(document.querySelector('#comm-list').textContent));
    await q.selectOption('#comm-status', 'new');
    await q.waitForSelector('#comm-list button[data-status=done]');
    await q.click('#comm-list button[data-status=done]');
    await q.waitForFunction(() => /Nothing here/.test(document.querySelector('#comm-list').textContent));
    assert((await db.prepare("SELECT status FROM feedback WHERE kind = 'problem'").first()).status === 'done', 'a problem can be marked done');
    await q.selectOption('#comm-type', 'all');
    await q.waitForFunction(() => /Can I print/.test(document.querySelector('#comm-list').textContent));
    assert(/pirate ship/.test(await q.textContent('#comm-list')), 'Everything lists messages and ideas together');
    assert(/unread/.test(await q.textContent('#comm-summary')), 'the inbox says what is waiting');
    await q.fill('#comm-q', 'pirate');
    await q.click('#comm-filter button[type=submit]');
    await q.waitForFunction(() => !/Can I print/.test(document.querySelector('#comm-list').textContent));
    await q.fill('#comm-q', '');
    await q.click('#comm-filter button[type=submit]');
    await q.waitForSelector('#comm-list button[data-open="900"]');
    await q.click('#comm-list button[data-open="900"]');
    await q.waitForSelector('#comm-thread:not([hidden]) #reply-text');
    assert(await q.evaluate(() => document.activeElement && document.activeElement.id === 'thread-h'), 'opening a conversation moves focus to it');
    await q.fill('#reply-text', 'Yes! Open the puzzle and press Print.');
    await q.click('#reply-form button[type=submit]');
    await q.waitForFunction(() => document.querySelectorAll('#comm-thread .msg.team').length === 1);
    const sentRow = await db.prepare("SELECT sender, author FROM conversation_messages WHERE conversation_id = 900 AND sender = 'team'").first();
    assert(sentRow && sentRow.author === 'break-glass token', 'the reply is saved with who sent it');
    assert((await db.prepare('SELECT player_unread FROM conversations WHERE id = 900').first()).player_unread === 1, 'the player will see a new reply');
    await shot(q, '7-communication');
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
