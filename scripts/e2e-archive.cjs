// End-to-end check of backups: the dashboard's Backups and archive section
// lists what goes and downloads the zip, and the archive viewer opens that
// zip in the browser, filters, groups, charts and exports it, with no request
// to the Worker. Runs against the real Worker (Miniflare, local D1, admin/ as
// assets). Needs `npm install` in server/ first. SHOTS=<folder> saves screenshots.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8172;
const API = `http://localhost:${API_PORT}`;
const TOKEN = 'break-glass-key-for-the-archive-test';
const SHOTS = process.env.SHOTS;
const DAY = 86400000;

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
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: API, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', ARCHIVE_FROM: 'backups@example.com' },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  // Old play summaries (past the 90 days kept), plus a recent one that stays.
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    const d = new Date(now - (100 + i) * DAY).toISOString().slice(0, 10);
    await db.prepare('INSERT INTO plays (day, platform, tier, theme, outcome, rating, minutes, hints) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(d, ['web', 'desktop', 'android'][i % 3], ['easy', 'medium', 'hard'][i % 3], ['mystery', 'fantasy', 'pets'][i % 3], i % 4 ? 'solved' : 'abandoned', 1 + (i % 5), 5 + (i % 9), i % 3).run();
  }
  await db.prepare("INSERT INTO plays (day, platform, tier, theme, outcome) VALUES (?1, 'web', 'easy', 'pets', 'solved')").bind(new Date(now).toISOString().slice(0, 10)).run();
  await db.prepare("INSERT INTO races (code, host_id, tier, cells, story_id, title, puzzle, created_at, closes_at) VALUES ('OLD1', 'uid-host', 'easy', 9, 's1', 'Old race', '{}', ?1, ?1)").bind(now - 60 * DAY).run();
  await db.prepare("INSERT INTO race_entries (code, user_id, joined_at, solved, adjusted_ms) VALUES ('OLD1', 'uid-host', ?1, 1, 90000)").bind(now - 60 * DAY).run();
  await mf.ready;

  const browser = await chromium.launch();
  const problems = [];
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-archive-'));

  try {
    await page.goto(`${API}/admin/`);
    await page.click('.break-glass summary');
    await page.fill('#token-input', TOKEN);
    await page.click('#token-form button');
    await page.waitForSelector('#app:not([hidden])');
    await page.click('a[href="#backups"]');
    await page.waitForSelector('#backups-body table');
    const text = await page.textContent('#backups-body');
    assert(/Anonymous play summaries/.test(text) && /90 days/.test(text), 'the list of what gets archived and for how long is shown');
    assert(/GitHub Action "Weekly archive email"/.test(text), 'it says the GitHub Action sends the email');
    assert(!(await page.$('#archive-send')), 'no Cloudflare send button while the GitHub Action sends');
    assert(/Switched off|Off\./.test(text), 'the weekly email starts off');
    await shot('archive-1-dashboard');

    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#archive-download')]);
    const zipPath = path.join(tmp, dl.suggestedFilename());
    await dl.saveAs(zipPath);
    assert(/^flg-archive-\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename()), `downloaded ${dl.suggestedFilename()}`);
    assert((await db.prepare('SELECT COUNT(*) AS n FROM plays').first()).n === 61, 'downloading removed nothing');

    // The viewer: no requests to the API once the page has loaded.
    await page.goto(`${API}/admin/archive.html`);
    const apiCalls = [];
    page.on('request', (r) => { if (r.url().includes('/admin/v1/')) apiCalls.push(r.url()); });
    await page.setInputFiles('#files', zipPath);
    await page.waitForSelector('#loaded:not([hidden])');
    assert((await page.textContent('#file-rows')).includes(dl.suggestedFilename()), 'the zip opens in the viewer');
    await page.selectOption('#table', 'plays');
    let tiles = await page.textContent('#summary');
    assert(/Matching rows\s*60/.test(tiles), 'all 60 old play summaries are there');
    assert(await page.isVisible('#charts svg'), 'a chart over time is drawn');
    await page.selectOption('#group', 'theme');
    assert((await page.$$('#groups tbody tr')).length === 3, 'grouped by theme: 3 groups');
    await page.selectOption('#measure', 'avg:minutes');
    assert(/Average of minutes/.test(await page.textContent('#groups thead')), 'measure switches to average minutes');
    await page.selectOption('#filter-col', 'platform');
    await page.selectOption('#filter-val', 'android');
    tiles = await page.textContent('#summary');
    assert(/Matching rows\s*20/.test(tiles), 'filtering to android leaves 20 rows');
    await shot('archive-2-viewer');

    const [rowsCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-rows')]);
    const csv = fs.readFileSync(await rowsCsv.path(), 'utf8');
    assert(csv.trim().split(/\r?\n/).length === 21 && /android/.test(csv), 'export has the header and the 20 matching rows');
    const [groupsCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-groups')]);
    assert(/theme,rows,Average of minutes/.test(fs.readFileSync(await groupsCsv.path(), 'utf8')), 'the groups export has the summary');

    await page.selectOption('#table', 'race_entries');
    assert(/p_[0-9a-f]{12}/.test(await page.textContent('#rows')), 'player ids show as codes');
    assert(!/uid-host/.test(await page.textContent('#rows')), 'raw player ids are not in the archive');

    // Opening the same zip twice counts its rows once.
    await page.setInputFiles('#files', zipPath);
    await page.selectOption('#table', 'plays');
    assert(/Matching rows\s*60/.test(await page.textContent('#summary')), 'the same archive is not counted twice');

    assert(apiCalls.length === 0, 'the viewer sent nothing to the Worker');
    assert(problems.length === 0, `no script or CSP errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    console.log('archive e2e passed');
  } finally {
    await browser.close();
    await mf.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
