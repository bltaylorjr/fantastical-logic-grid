// End-to-end check of the weekly and special edition puzzles and their emails:
// the puzzle of the week and a special edition on the Daily puzzle card and
// from their email links, a guest signing up in Menu > Puzzle emails and
// confirming with the button in the confirm email, the one-click unsubscribe
// page, and the admin dashboard's Puzzle emails section (planner, find,
// remove). Runs the real Worker in Miniflare against the website build
// (dist/site). Needs `npm install` in server/ first.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'dist', 'site');
const API_PORT = 8171;
const APP_PORT = 8172;
const API = `http://localhost:${API_PORT}`;
const APP = `http://localhost:${APP_PORT}`;
const TOKEN = 'break-glass-key-for-the-mail-test';
const SHOTS = process.env.SHOTS; // a folder for screenshots, when set
const shot = (pg, name) => (SHOTS ? pg.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }) : null);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const engine = await import(path.join(SITE, 'engine', 'index.js'));
  const mf = new Miniflare({
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: APP, ADMIN_TOKEN: TOKEN, FIREBASE_WEB_API_KEY: 'e2e-key', SITE_URL: APP },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), SITE, String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const admin = (p, body) => fetch(`${API}/admin/v1/${p}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());

  // This week's puzzle and a special edition, as the site build publishes them.
  const now = Date.now();
  const d = new Date(now);
  const week = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  const weekly = engine.generatePuzzle({ difficulty: 'expert', theme: 'mystery', seed: `weekly-${week}` });
  const special = engine.generatePuzzle({ difficulty: 'easy', theme: 'pets', seed: 'special-se-e2e-1' });
  const summary = (p, date) => ({ date, title: p.title, themeName: p.theme.name, difficultyName: p.difficulty.name, categories: p.categories.length, items: p.categories[0].items.length, opening: p.story.paragraphs[0] });
  const files = {
    'weekly/latest.json': { week, ...summary(weekly, week), weeks: [week] },
    [`weekly/puzzles/${week}.json`]: { week, puzzle: weekly },
    'specials/index.json': { specials: [{ id: 'se-e2e-1', editionTitle: 'Harvest special', note: 'A treat for the harvest.', ...summary(special, iso(now)) }] },
    'specials/se-e2e-1.json': { id: 'se-e2e-1', date: iso(now), title: 'Harvest special', note: 'A treat for the harvest.', puzzle: special },
  };
  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', siteUrl: '${APP}', appVersion: 'test' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = CLOUD.learnUrl;\n`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  for (const [f, body] of Object.entries(files)) await ctx.route(`${APP}/${f}`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: true, learn: false })); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${APP}/fantastical/`);
    await page.waitForSelector('#weekly-box:not([hidden]) [data-edition]');
    assert((await page.textContent('#weekly-box')).includes(weekly.title), `the Daily puzzle card shows the puzzle of the week ("${weekly.title}")`);
    assert((await page.textContent('#specials-list')).includes('Harvest special'), 'and lists the special edition');
    assert(await page.isVisible('#mail-invite-btn'), 'and invites everyone to the puzzle emails');
    await page.locator('#weekly-box').scrollIntoViewIfNeeded();
    await shot(page, 'mail-1-home');
    await page.click('#weekly-box [data-edition]');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert((await page.textContent('#p-title')) === weekly.title, 'the puzzle of the week opens');
    assert((await page.textContent('#p-meta')).includes('Puzzle of the week'), 'marked as the puzzle of the week');
    assert(await page.evaluate((w) => window.__flg.state.save.edition === `weekly-${w}`, week), 'the save remembers its week');
    await page.evaluate(() => {
      const S = window.__flg.state;
      for (const [k, td] of S.grid.cells) {
        const [a, b] = k.split('|');
        if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
      }
    });
    await page.waitForSelector('#solved:not([hidden])');
    assert(!(await page.evaluate(() => window.__flg.state.save.scorePending)), 'it earns no scoreboard points (the answers are public)');

    // The special edition email's link.
    await page.goto(`${APP}/fantastical/?play=special&id=se-e2e-1&utm_source=email&utm_campaign=special-email`);
    await page.waitForSelector('#screen-play:not([hidden])');
    assert((await page.textContent('#p-title')) === special.title, 'the special edition link opens its puzzle');
    assert((await page.textContent('#p-meta')).includes('Special edition: Harvest special'), 'marked as the special edition');
    await page.goto(`${APP}/fantastical/?play=weekly`);
    await page.waitForSelector('#screen-play:not([hidden])');
    assert((await page.textContent('#p-title')) === weekly.title, 'the weekly email link reopens the saved puzzle of the week');

    // A guest signs up from the menu.
    await page.goto(`${APP}/fantastical/`);
    await page.waitForSelector('#mail-invite:not([hidden])');
    await page.click('#menu-btn');
    await page.click('[data-cmd=mail]');
    await page.waitForSelector('#dlg-mail[open]');
    assert(await page.isVisible('#mail-email'), 'a guest types their address');
    await page.click('#mail-submit');
    assert(/Type your email/.test(await page.textContent('#mail-error')), 'an empty address is caught');
    await page.fill('#mail-email', 'Guest@Example.com');
    await page.click('#mail-submit');
    await page.waitForFunction(() => /Check your inbox/.test(document.querySelector('#mail-done').textContent));
    await shot(page, 'mail-2-dialog');
    let row = await db.prepare('SELECT * FROM puzzle_mail WHERE email = ?1').bind('guest@example.com').first();
    assert(row && row.weekly === 0 && row.want === 'weekly,special', 'the address waits for its confirm link, for both lists');

    // The GitHub Action hands out the confirm email; the guest presses Confirm.
    const claim = await admin('mail/claim', { send: 'confirm' });
    const link = `${API}/v1/mail/confirm?t=${claim.list.find((x) => x.email === 'guest@example.com').token}`;
    const mailbox = await browser.newPage();
    await mailbox.goto(link);
    assert(/Confirm your puzzle emails/.test(await mailbox.textContent('h1')), 'the confirm link shows a Confirm button');
    await shot(mailbox, 'mail-3-confirm');
    row = await db.prepare('SELECT weekly FROM puzzle_mail WHERE email = ?1').bind('guest@example.com').first();
    assert(row.weekly === 0, 'opening the link alone confirms nothing');
    await mailbox.click('button[type=submit]');
    await mailbox.waitForSelector('text=You are signed up');
    row = await db.prepare('SELECT * FROM puzzle_mail WHERE email = ?1').bind('guest@example.com').first();
    assert(row.weekly === 1 && row.special === 1, 'pressing Confirm signs them up for both');
    await mailbox.goto(`${API}/v1/mail/unsubscribe?t=${row.token}&l=special`);
    assert(/still get the weekly puzzle/.test(await mailbox.textContent('main')), 'the unsubscribe link stops just that list in one click');
    await mailbox.click('text=Change my emails');
    await mailbox.uncheck('input[name=weekly]');
    await mailbox.click('button[type=submit]');
    await mailbox.waitForSelector('text=is off the list');
    assert(!(await db.prepare('SELECT * FROM puzzle_mail WHERE email = ?1').bind('guest@example.com').first()), 'unticking both on the settings page removes the address');

    // The admin dashboard: plan a special edition, find and remove an address.
    await page.goto(`${APP}/fantastical/`);
    await page.click('#menu-btn');
    await page.click('[data-cmd=mail]');
    await page.fill('#mail-email', 'second@example.com');
    await page.click('#mail-submit');
    await page.waitForFunction(() => /Check your inbox/.test(document.querySelector('#mail-done').textContent));
    const g = await browser.newPage();
    g.on('pageerror', (e) => errors.push(String(e)));
    await g.goto(`${API}/admin/`);
    await g.click('.break-glass summary');
    await g.fill('#token-input', TOKEN);
    await g.click('#token-form button[type=submit]');
    await g.waitForSelector('#app:not([hidden])');
    await g.click('#nav-list a[href="#mail"]');
    await g.waitForSelector('#mail-body .tile');
    assert(/Waiting to confirm\s*1/.test(await g.textContent('#mail-body .tiles')), 'the dashboard counts the address waiting to confirm');
    await g.click('#se-new');
    await g.fill('#dialog-body [name=date]', iso(now + 3 * 86400000));
    await g.fill('#dialog-body [name=title]', 'Winter special');
    await g.fill('#dialog-body [name=note]', 'A snowy puzzle for the holidays.');
    await g.selectOption('#dialog-body [name=difficulty]', 'hard');
    await g.click('#dialog-ok');
    await g.waitForFunction(() => /Winter special/.test(document.querySelector('#mail-body').textContent));
    await shot(g, 'mail-4-admin');
    const planned = await db.prepare("SELECT * FROM special_editions WHERE title = 'Winter special'").first();
    assert(planned && planned.difficulty === 'hard', 'a special edition is planned');
    const pub = await (await fetch(`${API}/v1/specials`)).json();
    assert(pub.specials.some((x) => x.title === 'Winter special'), 'and the website build can read it');
    await g.fill('#mail-q', 'second');
    await g.click('#mail-find button[type=submit]');
    await g.waitForSelector('[data-mail-remove]');
    await g.click('[data-mail-remove]');
    await g.click('#dialog-ok');
    await g.waitForFunction(() => !document.querySelector('[data-mail-remove]'));
    assert(!(await db.prepare("SELECT * FROM puzzle_mail WHERE email = 'second@example.com'").first()), 'an admin removes an address');
    assert(!errors.length, `no page errors (${errors.join('; ')})`);
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
