// End-to-end check of everyone's numbers for the daily puzzle: the home card
// shows how many played and solved, and the solved panel adds how this time
// compares. Runs the real Worker in Miniflare against the website build
// (dist/site has the daily files). Needs `npm install` in server/ first.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'dist', 'site');
const API_PORT = 8162;
const APP_PORT = 8163;
const APP = `http://localhost:${APP_PORT}`;

(async () => {
  const latest = JSON.parse(fs.readFileSync(path.join(SITE, 'daily', 'latest.json'), 'utf8'));
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
  // Earlier players today: five opened it, four solved in 2, 5, 12 and 20 minutes.
  await db.prepare('INSERT INTO daily_results (day, bucket, n) VALUES (?1, -1, 5), (?1, 2, 1), (?1, 5, 1), (?1, 12, 1), (?1, 20, 1)').bind(latest.date).run();
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), SITE, String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: 'http://localhost:${API_PORT}', siteUrl: '${APP}', appVersion: 'test' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = CLOUD.learnUrl;\n`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true, learn: false })); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${APP}/fantastical/`);
    await page.waitForSelector('#daily-numbers:not([hidden])');
    const home = await page.textContent('#daily-numbers');
    assert(/5 players so far/.test(home) && /80% solved/.test(home) && /about \d+ minutes/.test(home), `the home card shows today's numbers ("${home}")`);

    await page.click('#daily-today [data-daily]');
    await page.waitForSelector('#screen-play:not([hidden])');
    await page.waitForTimeout(300);
    let row = await db.prepare('SELECT n FROM daily_results WHERE day = ?1 AND bucket = -1').bind(latest.date).first();
    assert(row.n === 6, 'opening the daily puzzle counts one more player');
    // Seven and a half minutes on the clock.
    await page.evaluate(() => { window.__flg.state.save.elapsedMs = 450_000; });
    await page.evaluate(() => {
      const S = window.__flg.state;
      for (const [k, td] of S.grid.cells) {
        const [a, b] = k.split('|');
        if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
      }
    });
    await page.waitForSelector('#solved-daily-numbers:not([hidden])');
    const solved = await page.textContent('#solved-daily-numbers');
    assert(/6 players so far/.test(solved) && /quicker than 50% of the other solvers/.test(solved), `the solved panel compares this time ("${solved}")`);
    row = await db.prepare('SELECT n FROM daily_results WHERE day = ?1 AND bucket = 7').bind(latest.date).first();
    assert(row && row.n === 1, 'the solve time was counted once, in its minute');
    await page.click('#home-btn');
    await page.waitForSelector('#screen-home:not([hidden])');
    await page.reload();
    await page.waitForSelector('#daily-today [data-daily]');
    await page.click('#daily-today [data-daily]');
    await page.waitForSelector('#solved:not([hidden])');
    await page.waitForTimeout(500);
    row = await db.prepare('SELECT SUM(n) AS n FROM daily_results WHERE day = ?1 AND bucket >= 0').bind(latest.date).first();
    assert(row.n === 5, 'opening the solved puzzle again does not count it twice');
    // The daily email's link opens today's daily puzzle straight away.
    const fresh = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    await fresh.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await fresh.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true, learn: false })));
    await fresh.route('**/daily/picks.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ picks: [{ date: latest.date, title: 'A picked case', difficultyName: 'Easy', themeName: 'Space', hand: true }] }) }));
    const linked = await fresh.newPage();
    linked.on('pageerror', (e) => errors.push(String(e)));
    await linked.goto(`${APP}/fantastical/`);
    await linked.waitForSelector('#daily-picks:not([hidden])');
    const picks = await linked.textContent('#daily-picks-list');
    assert(/A picked case/.test(picks) && /picked by the team/.test(picks), `the daily card lists the Hand-picked puzzles ("${picks.trim()}")`);
    await linked.goto(`${APP}/fantastical/?play=daily&day=2001-01-01`);
    await linked.waitForSelector('#screen-home:not([hidden])');
    await linked.waitForTimeout(800);
    assert(await linked.evaluate(() => !window.__flg.state?.save && !document.querySelector('#screen-home').hidden), 'a link to a day with no puzzle stays on the home screen');
    await linked.goto(`${APP}/fantastical/?play=daily&utm_source=email&utm_campaign=daily-email`);
    await linked.waitForSelector('#screen-play:not([hidden])');
    assert(await linked.evaluate((d) => window.__flg.state.save.daily === d, latest.date), 'a ?play=daily link opens today\'s daily puzzle');
    assert(!/play=/.test(linked.url()), 'and the link is tidied from the address bar');
    assert(await linked.evaluate(() => document.querySelector('#daily-email')?.hidden !== false), 'the email switch stays hidden without accounts');
    await fresh.close();
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
