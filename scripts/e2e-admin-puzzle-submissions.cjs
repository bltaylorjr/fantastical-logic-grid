// End-to-end check of the admin dashboard's Puzzle submissions page against
// the real Worker (Miniflare, local D1, the admin/ files as Worker assets):
// the four sections, editing, emailing the player, pushing a puzzle to their
// Saved puzzles, moving an entry to Published and deleting (after the
// confirmation). Needs `npm install` in server/ first. SHOTS=<folder> saves
// screenshots there.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8172;
const API = `http://localhost:${API_PORT}`;
const PROJECT = 'flg-e2e';
const OWNER = 'owner@example.com';
const SHOTS = process.env.SHOTS;

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const { generatePuzzle } = await import(path.join(ROOT, 'engine/src/index.js'));
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: API, ADMIN_TOKEN: 'break-glass-key-for-the-e2e-test', OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  // Entries in every section, from a signed-in player and a guest.
  const now = Date.now();
  const FORM = {
    kind: 'storyline', theme: 'mystery', pitch: 'Who stole the tiara?', setting: 'A seaside mansion', characters: [{ name: 'Lady Ashford' }, { name: 'Mr. Pike' }, { name: 'Nora' }],
    goal: 'find out who took the tiara', clues: 'Rooms: Library, Kitchen, Garden. Drinks: Tea, Punch, Cider.', beat: 'The lights go out at midnight.', credit: 'B. Taylor', consent: true,
  };
  const puzzle = generatePuzzle({ difficulty: 'easy', categories: 3, items: 4, seed: 'e2e-ps' });
  await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind('pat-uid', 'PierPat', 'pierpat', now).run();
  const add = (title, status, extra = {}) => db.prepare(`INSERT INTO story_submissions (kind, source, title, form, text, status, user_id, email, puzzle, puzzle_at, created_at)
    VALUES (?1, 'form', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`).bind(extra.kind || 'storyline', title, JSON.stringify(extra.kind ? { kind: extra.kind, idea: extra.idea } : { ...FORM, title }), `Title: ${title}`, status,
    extra.guest ? null : 'pat-uid', extra.guest ? null : 'pat@example.com', extra.puzzle ? JSON.stringify(puzzle) : null, extra.puzzle ? now : null, now).first();
  const waiting = await add('The Pier Puzzle', 'new', { puzzle: true });
  await add('Guest Lighthouse', 'new', { guest: true });
  await add('Needs Clues', 'edits');
  await add('Approved Garden', 'approved', { puzzle: true });
  await add('Gone Live', 'published');
  await add('A theme idea', 'new', { kind: 'theme', idea: 'Space bakery' });
  const doomed = await add('Delete Me', 'declined');
  await mf.ready;

  const browser = await chromium.launch();
  const problems = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('https://identitytoolkit.googleapis.com/**', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (r.request().url().includes('signInWithPassword')) {
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ localId: 'owner-uid', email: body.email, idToken: signer.token({ sub: 'owner-uid', email: body.email, email_verified: true }), refreshToken: 'r1', expiresIn: '3600' }) });
      }
      return r.fulfill({ contentType: 'application/json', body: '{}' });
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${API}/admin/`);
    await page.fill('#login-email', OWNER);
    await page.fill('#login-password', 'right-password');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#app:not([hidden]) .tile');
    await page.goto(`${API}/admin/#puzzle-submissions`);
    await page.waitForSelector('#ps-list li');
    const tabs = await page.$$eval('#ps-tabs button', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    assert(['Awaiting approval 2', 'Awaiting edits 1', 'Approved 1', 'Published 1', 'Not used 1'].every((t) => tabs.includes(t)), `the four sections and Not used, with counts (${tabs.join(', ')})`);
    const titles = await page.$$eval('#ps-list .ss-title b', (bs) => bs.map((b) => b.textContent));
    assert(titles.includes('The Pier Puzzle') && !titles.includes('A theme idea'), 'Awaiting approval lists puzzles, not theme ideas');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'puzzle-submissions.png'), fullPage: true });

    // Open, email the player, push the puzzle.
    await page.click(`[data-ps-open="${waiting.id}"]`);
    await page.waitForSelector('#ps-detail');
    await page.click('[data-ps-email]');
    await page.fill('#dialog textarea', 'Thank you! We love it.');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /15 minutes/.test(document.body.textContent));
    const q = await db.prepare("SELECT email, note FROM feedback_replies WHERE kind = 'submission_message'").first();
    assert(q && q.email === 'pat@example.com' && q.note === 'Thank you! We love it.', 'Email the player queues the note to their address');
    await page.click('[data-ps-push]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /put in their Saved puzzles once/.test(document.querySelector('#ps-detail')?.textContent || ''));
    const pp = await db.prepare("SELECT COUNT(*) AS n FROM player_puzzles WHERE user_id = 'pat-uid'").first();
    assert(pp.n === 1, 'Push to Saved puzzles stores it for the player');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'puzzle-submissions-open.png'), fullPage: true });

    // Edit the title.
    await page.click('[data-ps-edit]');
    await page.fill('#ss-ed-title', 'The Pier Puzzle, Revised');
    await page.click('#ss-editor button[type=submit]');
    await page.waitForFunction(() => /Revised/.test(document.querySelector('#ps-detail-h')?.textContent || ''));
    assert(true, 'Edit saves a new version');

    // Move to Published.
    await page.waitForLoadState('networkidle');
    await page.selectOption('#ps-move', 'published');
    await page.click('[data-ps-move]');
    await page.fill('#dialog input', 'December special edition');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /Published 2/.test(document.querySelector('#ps-tabs').textContent.replace(/\s+/g, ' ')));
    assert((await db.prepare('SELECT status, published_note FROM story_submissions WHERE id = ?1').bind(waiting.id).first()).published_note === 'December special edition', 'Mark as published moves it, with where');

    // The guest's entry cannot be pushed.
    await page.click('[data-ps-tab="new"]');
    await page.waitForFunction(() => /Guest Lighthouse/.test(document.querySelector('#ps-list').textContent));
    await page.click('#ps-list li:has-text("Guest Lighthouse") [data-ps-open]');
    await page.waitForSelector('#ps-detail');
    assert(await page.isDisabled('[data-ps-push]') && await page.isDisabled('[data-ps-email]'), 'a guest with no address: no push, no email');

    // Delete asks first; Cancel keeps it.
    await page.click('[data-ps-tab="unused"]');
    await page.waitForFunction(() => /Delete Me/.test(document.querySelector('#ps-list').textContent));
    await page.click(`[data-ps-open="${doomed.id}"]`);
    await page.waitForSelector('#ps-detail');
    await page.click('[data-ps-delete]');
    assert(/cannot be undone/.test(await page.textContent('#dialog')), 'Delete asks for confirmation and says it cannot be undone');
    await page.click('#dialog-cancel');
    assert(await db.prepare('SELECT id FROM story_submissions WHERE id = ?1').bind(doomed.id).first(), 'Cancel keeps the entry');
    await page.click('[data-ps-delete]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => !document.querySelector('#ps-detail'));
    assert(!(await db.prepare('SELECT id FROM story_submissions WHERE id = ?1').bind(doomed.id).first()), 'Delete for good removes it');

    // Full review opens it on the Storyline submissions page.
    await page.goto(`${API}/admin/#story-submissions/${waiting.id}`);
    await page.waitForSelector('#ss-detail');
    assert(/Revised/.test(await page.textContent('#ss-detail-h')), 'Full review opens the same entry on Storyline submissions');
    assert(problems.length === 0, `no script errors (${problems.join(' | ')})`);
  } finally {
    await browser.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
