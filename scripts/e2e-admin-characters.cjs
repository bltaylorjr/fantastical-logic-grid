// End-to-end check of the Characters section against the real Worker
// (Miniflare, local D1, a stand-in for Workers AI): a player suggests a
// character from the game, an admin reviews it in the dashboard, makes a new
// character with a drawn face, AI lines and an AI portrait, publishes both,
// and the next puzzle in the game has them.
// Needs `npm install` in server/ first and a built game (npm run build).
// SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8172;
const APP_PORT = 8173;
const APP = `http://localhost:${APP_PORT}`;
const API = `http://localhost:${API_PORT}`;
const TOKEN = 'break-glass-key-for-the-e2e-test';
const SHOTS = process.env.SHOTS;

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
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: APP, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', FIREBASE_WEB_API_KEY: 'e2e-key', TEST_CHARACTERS: '1' },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  // Every new puzzle gets a character, so the check below is certain.
  for (const [k, v] of [['character_cast_chance', 100], ['character_narrator_chance', 100]]) {
    await db.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, 0, ?3)').bind(k, JSON.stringify(v), 'e2e').run();
  }
  await mf.ready;
  const app = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const problems = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
  };
  const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); } };
  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', siteUrl: '', appVersion: 'test' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = '${API}';\n`;
  const gameContext = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })));
    return ctx;
  };
  try {
    // 1. A player suggests a character from the game.
    let game = await gameContext();
    let p = await game.newPage();
    watch(p);
    await p.goto(`${APP}/`);
    await p.waitForSelector('#tier-choices input');
    await p.waitForFunction(() => !document.querySelector('[data-cmd=suggest]').hidden);
    await p.click('#menu-btn');
    await p.click('[data-cmd=suggest]');
    await p.waitForSelector('#dlg-suggest[open]');
    await p.fill('#suggest-name', 'Pip');
    await p.check('#suggest-form input[name=gender][value=m]');
    await p.fill('#suggest-look', 'a tall green hat');
    await p.fill('#suggest-personality', 'shy but very clever');
    await p.selectOption('#suggest-voice', 'calm');
    await p.click('#suggest-form button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#suggest-form .acct-done').textContent.includes('Thank you'));
    const row = await db.prepare("SELECT name, status, source FROM characters WHERE name = 'Pip'").first();
    assert(row && row.status === 'suggested' && row.source === 'player', 'the suggestion waits for review');
    await game.close();

    // 2. The admin reviews it and makes a new character.
    const adm = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const q = await adm.newPage();
    watch(q);
    await q.goto(`${API}/admin/#characters`);
    await q.click('.break-glass summary');
    await q.fill('#token-input', TOKEN);
    await q.click('#token-form button[type=submit]');
    await q.waitForSelector('#ch-ideas [data-ch-edit]');
    assert(/Pip/.test(await q.textContent('#ch-ideas')) && /shy but very clever/.test(await q.textContent('#ch-ideas')), 'the dashboard lists the player\'s suggestion');
    await q.click('#ch-ideas [data-ch-edit]');
    await q.waitForSelector('#ch-form');
    await q.fill('#ch-lines-clue', 'If you ask me:');
    await q.click('#ch-form button[type=submit]');
    await q.waitForFunction(() => /Edit Pip/.test(document.querySelector('#ch-editor-h').textContent));
    await q.click('#ch-publish');
    await q.waitForFunction(() => document.querySelector('#ch-publish') && document.querySelector('#ch-publish').disabled);
    assert((await db.prepare("SELECT status FROM characters WHERE name = 'Pip'").first()).status === 'published', 'the reviewed suggestion is published');
    await q.click('#ch-close');

    await q.click('#ch-new');
    await q.waitForSelector('#ch-form');
    await q.fill('#ch-name', 'Captain Mo');
    await q.check('input[name=ch-gender][value=m]');
    assert(await q.locator('#ch-gemini option[value=Fenrir]').count() === 1 && await q.locator('#ch-gemini option[value=Kore]').count() === 0, 'a man gets men\'s voices to choose from');
    await q.fill('#ch-personality', 'a cheerful old sea captain');
    await q.selectOption('#ch-role', 'both');
    await q.check('input[name=ch-theme][value=adventure]');
    await q.click('#ch-reroll');
    await q.click('#ch-form button[type=submit]');
    await q.waitForFunction(() => /Edit Captain Mo/.test(document.querySelector('#ch-editor-h').textContent));
    await q.click('#ch-draft');
    await q.waitForSelector('#ch-drafts [data-ch-use]');
    await q.click('#ch-drafts [data-ch-use="clue"]');
    assert((await q.inputValue('#ch-lines-clue')).length > 3, 'an AI-drafted line can be used');
    await q.selectOption('#ch-style', 'ai');
    await q.fill('#ch-look', 'a blue coat and a white beard');
    await q.click('#ch-form button[type=submit]');
    await q.waitForFunction(() => !document.querySelector('#ch-paint').disabled);
    await q.click('#ch-paint');
    await q.waitForSelector('#ch-face img[src^="data:image/jpeg"]');
    assert(true, 'the AI portrait is painted and shown');
    await q.click('#ch-publish');
    await q.waitForFunction(() => document.querySelector('#ch-publish') && document.querySelector('#ch-publish').disabled);
    await shot(q, 'characters');
    const mo = await db.prepare("SELECT status, style, role FROM characters WHERE name = 'Captain Mo'").first();
    assert(mo.status === 'published' && mo.style === 'ai' && mo.role === 'both', 'Captain Mo is published');

    // A name that breaks the story rules can't be published.
    await q.click('#ch-close');
    await q.click('#ch-new');
    await q.fill('#ch-name', 'Library');
    await q.fill('#ch-personality', 'very quiet');
    await q.check('input[name=ch-theme][value=mystery]');
    await q.click('#ch-form button[type=submit]');
    await q.waitForFunction(() => /Fix these before publishing/.test(document.querySelector('#ch-editor').textContent));
    await q.click('#ch-publish');
    await q.waitForFunction(() => !document.querySelector('#ch-error').hidden);
    assert(/grid item/.test(await q.textContent('#ch-error')), 'a name that is a grid item is refused');
    await adm.close();

    // 3. The next puzzle has them.
    game = await gameContext();
    p = await game.newPage();
    watch(p);
    await p.goto(`${APP}/`);
    await p.waitForSelector('#tier-choices input');
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('flg.characters') || '{}').characters || []).length === 2);
    await p.reload();
    await p.waitForSelector('#tier-choices input');
    await p.check('input[name=tier][value=basic]', { force: true });
    await p.check('input[name=theme][value=adventure]', { force: true });
    await p.click('#gen-btn');
    await p.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const puzzle = await p.evaluate(() => window.__flg.state.puzzle);
    const names = puzzle.categories[0].items.map((i) => i.label);
    assert(names.includes('Captain Mo') || names.includes('Pip'), `a published character joins the cast (${names.join(', ')})`);
    await p.waitForSelector('#cast-row .cast-btn img.portrait-img, #told-by:not([hidden])');
    await game.close();

    assert(!problems.length, `no console errors or blocked scripts (${problems.join(' | ')})`);
  } finally {
    await browser.close();
    app.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
