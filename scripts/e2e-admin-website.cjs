// The admin dashboard's Website page against the real Worker (Miniflare, local
// D1, admin/ as Worker assets) and the built website: Edit on the page (pick,
// change words, move, hide), the list of changes, the editor in its own window
// (Open in a new window) staying in step with the dashboard tab, and Publish
// sending the page changes to the website build.
// Needs `npm install` in server/ first and a built site (npm run build).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8165;
const SITE_PORT = 8166;
const API = `http://localhost:${API_PORT}`;
const TOKEN = 'break-glass-key-for-the-website-test';
const SHOTS = process.env.SHOTS; // a folder for screenshots

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
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: API, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', SITE_URL: `http://localhost:${SITE_PORT}` },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const siteServer = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'site'), String(SITE_PORT)], { stdio: 'ignore' });
  await require('./wait-port.cjs')(SITE_PORT);

  const browser = await chromium.launch();
  const problems = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
  };
  const draft = async () => (await (await fetch(`${API}/admin/v1/site-design`, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: API } })).json()).draft;
  const until = async (fn, what, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`FAIL: timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 150)); } };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${API}/admin/`);
    await page.click('.break-glass summary');
    await page.fill('#token-input', TOKEN);
    await page.click('#token-form button[type=submit]');
    await page.waitForSelector('#app:not([hidden])');
    await page.goto(`${API}/admin/#website`);
    await page.waitForSelector('#web-frame');
    assert(await page.isVisible('input[name=web-mode][value=preview]:checked + span'), 'the Website page opens in Preview');

    // Edit on the page.
    await page.click('input[name=web-mode][value=edit] + span');
    await page.waitForSelector('#web-edit');
    assert(/Nothing picked yet/.test(await page.textContent('#web-sel')), 'Edit on the page shows the editor panel');
    const frame = await (await page.waitForSelector('#web-frame')).contentFrame();
    await frame.waitForFunction(() => document.documentElement.classList.contains('design-edit'));
    const at = (sel) => frame.locator(sel).first();
    await at('#games article.card[data-game="flg"] ul.points li').click({ position: { x: 20, y: 6 } });
    await page.waitForSelector('#web-sel h2:has-text("Picked: List item")');
    assert(await page.inputValue('#web-sel-words') === 'Choose a difficulty, a theme and a grid size', 'picking words shows them in the panel');
    assert(/Card/.test(await page.textContent('.web-crumbs')), 'the panel shows where the element sits');

    // New words from the panel box.
    await page.fill('#web-sel-words', 'Any difficulty, any theme, any size');
    await page.click('#web-sel [data-cmd="words"]');
    await frame.waitForFunction(() => document.querySelector('#games article.card[data-game="flg"] ul.points li').textContent === 'Any difficulty, any theme, any size');
    assert(true, 'Use these words changes them in the preview');
    await page.waitForSelector('#web-steps .badge:has-text("1")');
    const saved = await until(async () => { const d = await draft(); return d && d.design.edits && d.design.edits.length === 1 && d; }, 'the draft to save');
    assert(saved.design.edits[0].op === 'text' && saved.design.edits[0].v === 'Any difficulty, any theme, any size', 'the change is saved in the draft');

    // Bigger, then drag the card after the next one.
    await page.click('#web-sel [data-cmd="parent"]');
    await page.waitForSelector('#web-sel h2:has-text("Picked: List")');
    await page.click('#web-sel [data-cmd="parent"]');
    await page.click('#web-sel [data-cmd="parent"]');
    await page.waitForSelector('#web-sel h2:has-text("Picked: Card")');
    await frame.evaluate(() => document.querySelector('#games').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
    const from = await at('#games article.card[data-game="flg"]').boundingBox();
    const to = await at('#games article.card[data-game="ntn"]').boundingBox();
    await page.mouse.move(from.x + 40, from.y + 30);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 50, { steps: 3 });
    await page.mouse.move(to.x + to.width - 20, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await frame.waitForFunction(() => [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === 'ntn,flg');
    assert(true, 'dragging a card in the dashboard preview moves it');
    await page.waitForSelector('#web-steps .badge:has-text("2")');
    assert(/Card .*moved after/.test(await page.textContent('#web-steps')), 'the move is listed under Changes on this page');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'website-edit-on-page.png') });

    // Undo and Redo.
    await page.click('#web-undo');
    await frame.waitForFunction(() => [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === 'flg,ntn');
    await page.click('#web-redo');
    await frame.waitForFunction(() => [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === 'ntn,flg');
    assert(true, 'Undo and Redo take the move off and put it back');

    // The editor in its own window.
    const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('#web-popout')]);
    watch(pop);
    await pop.waitForSelector('body.web-editor-window #web-frame');
    assert(await pop.isHidden('.nav') && /editor=1/.test(pop.url()), 'Open in a new window shows only the website editor');
    assert(await pop.isVisible('input[name=web-mode][value=edit]:checked + span') && await pop.isVisible('#web-close'), 'the new window opens ready to edit, with Close window');
    await pop.waitForSelector('#web-steps .badge:has-text("2")');
    const pframe = await (await pop.waitForSelector('#web-frame')).contentFrame();
    await pframe.waitForFunction(() => document.documentElement.classList.contains('design-edit') && [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === 'ntn,flg');
    assert(true, 'it shows the same draft');
    const big = await pop.evaluate(() => document.getElementById('web-frame').getBoundingClientRect().width);
    assert(big > 900, `the preview fills the window (${Math.round(big)}px wide)`);

    // Hide something in the new window: the dashboard tab follows.
    await pframe.locator('#games article.card[data-game="ntn"] .rules-link').first().click({ position: { x: 4, y: 4 } });
    await pop.waitForSelector('#web-sel h2:has-text("Picked: Link")');
    if (SHOTS) { await pop.waitForTimeout(300); await pop.screenshot({ path: path.join(SHOTS, 'website-editor-window.png') }); }
    await pop.click('#web-sel [data-cmd="hide"]');
    await pframe.waitForFunction(() => getComputedStyle(document.querySelector('#games article.card[data-game="ntn"] .rules-link')).display === 'none');
    await page.waitForSelector('#web-steps .badge:has-text("3")');
    await frame.waitForFunction(() => getComputedStyle(document.querySelector('#games article.card[data-game="ntn"] .rules-link')).display === 'none');
    assert(true, 'a change in the new window shows in the dashboard tab too');

    // Remove one change from the list.
    await pop.click('#web-steps [data-remove-step]:last-of-type >> nth=-1');
    await pframe.waitForFunction(() => getComputedStyle(document.querySelector('#games article.card[data-game="ntn"] .rules-link')).display !== 'none');
    await page.waitForSelector('#web-steps .badge:has-text("2")');
    assert(true, 'Remove under Changes on this page brings the element back, in both windows');

    // Publish from the new window: the website build gets the page changes.
    await until(async () => { const d = await draft(); return d && d.design.edits && d.design.edits.length === 2; }, 'the draft to catch up');
    await pop.click('#web-publish');
    await pop.click('#dialog-ok');
    await pop.waitForSelector('.web-state .badge.ok');
    const pub = await (await fetch(`${API}/v1/site/design`)).json();
    assert(pub.design.edits.length === 2 && pub.design.edits.some((e) => e.op === 'move') && pub.design.edits.some((e) => e.op === 'text'), 'Publish sends the page changes to the website build');
    await page.waitForSelector('.web-state .badge.ok');
    assert(true, 'the dashboard tab shows the published design too');
    assert(/2 changes/.test(await page.textContent('[data-view="website"] table')), 'Published versions counts the page changes');

    assert(!problems.length, `no script errors or blocked content${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    console.log('Website editor checks passed.');
  } finally {
    await browser.close();
    siteServer.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
