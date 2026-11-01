// End-to-end check of Challenge a friend: one player solves and makes a link,
// a second player with no account opens it, gets the same puzzle and sees both
// times. Runs the real Worker in Miniflare with a local D1 database. Needs
// `npm install` in server/ first.
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

  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: 'http://localhost:${API_PORT}', siteUrl: '${APP}', appVersion: 'test' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = CLOUD.learnUrl;\n`;
  const browser = await chromium.launch();
  const errors = [];
  async function device(name, url = `${APP}/`) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.addInitScript(() => {
      // No share sheet, so the link shows in the share box.
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true, learn: false }));
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(url);
    return { ctx, page };
  }
  async function solve(page) {
    const plan = await page.evaluate(() => {
      const S = window.__flg.state;
      const out = [];
      for (const [k, td] of S.grid.cells) {
        td.dataset.k = k;
        const [a, b] = k.split('|');
        const match = S.puzzle.solution.some((row) => { const v = Object.values(row); return v.includes(a) && v.includes(b); });
        const cur = S.marks.get(k) || '';
        out.push({ k, clicks: match ? (cur === 'O' ? 0 : cur === 'X' ? 1 : 2) : (cur === 'X' ? 0 : cur === 'O' ? 3 : 1) });
      }
      return out;
    });
    for (const { k, clicks } of plan) for (let i = 0; i < clicks; i++) await page.click(`td[data-k="${k}"]`);
    await page.waitForSelector('#solved:not([hidden])');
  }

  try {
    const a = await device('A');
    await a.page.waitForSelector('#tier-choices input');
    await a.page.check('input[name=tier][value=basic]', { force: true });
    await a.page.check('input[name=size][value="3x3"]', { force: true });
    await a.page.click('#gen-btn');
    await a.page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    // A time that is easy to beat, so the friend's win can be checked.
    await a.page.evaluate(() => { window.__flg.state.save.elapsedMs = 3_600_000; });
    await solve(a.page);
    await a.page.waitForSelector('#challenge-btn:not([hidden])');
    await a.page.click('#challenge-btn');
    await a.page.waitForSelector('#dlg-share[open]');
    const text = await a.page.inputValue('#share-text');
    const link = (text.match(/https?:\/\/\S+\?challenge=[A-Z0-9]{6}/) || [])[0];
    assert(link && /beat my time/.test(text) && /\/fantastical\/\?challenge=/.test(link), `the solver gets a challenge link to the game's page (${link})`);
    const story = await a.page.evaluate(() => window.__flg.state.puzzle.story.id);

    // This test serves the app build (dist/web), where the game is at the root;
    // on the website it is at fantastical/ (scripts/hub.mjs, tested by e2e-hub.cjs).
    const appLink = link.replace('/fantastical/', '/');
    const b = await device('B', appLink);
    await b.page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await b.page.evaluate(() => window.__flg.state.puzzle.story.id) === story, 'the friend gets the very same puzzle, no account needed');
    assert(!/challenge=/.test(b.page.url()), 'the code is taken out of the address');
    assert(/beat that time/.test(await b.page.textContent('.toast')), 'the friend is told the time to beat');
    await solve(b.page);
    await b.page.waitForSelector('#challenge-result:not([hidden])');
    const result = await b.page.textContent('#challenge-result');
    assert(/You beat your friend's time/.test(result) && /1:00:\d\d/.test(result), 'both times show and the faster one wins');
    assert(await b.page.evaluate(() => !window.__flg.state.save.scorePending), 'a challenge earns no scoreboard points');

    // Opening the link again resumes the same save instead of a new copy.
    await b.page.goto(appLink);
    await b.page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const copies = await b.page.evaluate(async () => (await (await import('./js/store.js')).listSaves()).filter((s) => s.challenge).length);
    assert(copies === 1, 'the same link opens the same saved puzzle');
    const row = await db.prepare('SELECT plays, beat FROM challenges').first();
    assert(row.plays === 1 && row.beat === 1, 'the server counted one play that beat the time');

    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
