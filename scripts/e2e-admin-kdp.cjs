// End-to-end check of the admin dashboard's Amazon KDP page against the real
// Worker (Miniflare, local D1, the admin/ files as Worker assets): a new
// listing filled in from a Grid book, the live check and price box, saving,
// adding a month of sales, and deleting after the confirmation. Needs
// `npm install` in server/ first. SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8174;
const API = `http://localhost:${API_PORT}`;
const PROJECT = 'flg-e2e';
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: API, ADMIN_TOKEN: 'break-glass-key-for-the-e2e-test', OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  // A Grid book to link.
  const now = Date.now();
  await db.prepare(`INSERT INTO books (id, title, subtitle, volume, edition, author, trim, paper, pages, status, settings, cover, css, created_by, created_at, updated_at)
    VALUES ('bk-e2e-1', 'Logic Grid Puzzles', 'Volume 1', 1, 1, 'Bobby Taylor', '8.5x11', 'white', 120, 'draft', '{}', '{}', '{}', 'owner', ?1, ?1)`).bind(now).run();
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
    await page.goto(`${API}/admin/#kdp`);
    await page.waitForSelector('#kdp-rows td');
    assert(/No listings yet/.test(await page.textContent('#kdp-rows')), 'Starts with no listings');
    await page.click('#kdp-new');
    await page.waitForSelector('#kdp-editor:not([hidden]) #kdp-book');
    await page.selectOption('#kdp-book', 'bk-e2e-1');
    await page.click('#kdp-fill');
    assert(await page.inputValue('#kdp-title') === 'Logic Grid Puzzles', 'Fill in copies the title from the Grid book');
    assert(await page.inputValue('#kdp-pages') === '120', 'and the page count');
    assert(/to fix before KDP/.test(await page.textContent('#kdp-check')), 'The check lists what is missing');
    await page.click('[data-group="details"] summary');
    await page.waitForFunction(() => document.querySelectorAll('.kdp-group[open]').length === 1 && document.querySelector('[data-group="details"]').open);
    assert(true, 'Only one group is open at a time');
    await page.fill('#kdp-desc', 'Story logic grid puzzles, with answers at the back.');
    await page.click('[data-group="keywords"] summary');
    const kws = ['logic puzzles adults', 'brain teasers gift', 'deduction puzzle book', 'story puzzles seniors', 'logic problems answers', 'mystery puzzles', 'free puzzles'];
    for (let i = 0; i < 7; i++) await page.fill(`#kdp-kw-${i}`, kws[i]);
    assert(/does not allow "free"/.test(await page.textContent('#kdp-check')), 'A banned keyword word is flagged');
    await page.fill('#kdp-kw-6', 'grid puzzle activity book');
    await page.fill('#kdp-cat-0', 'Games & Activities > Logic & Brain Teasers');
    await page.click('[data-group="ai"] summary');
    await page.selectOption('#kdp-ai-text', 'none');
    await page.selectOption('#kdp-ai-images', 'none');
    await page.selectOption('#kdp-ai-tr', 'none');
    await page.click('[data-group="price"] summary');
    assert(/\$3\.04/.test(await page.textContent('#kdp-money')), 'Printing cost for 120 large-trim pages is $3.04');
    await page.fill('#kdp-price', '5');
    assert(/lowest list price KDP allows for this book is \$6\.08/.test(await page.textContent('#kdp-check')), 'A price under the minimum is flagged');
    await page.fill('#kdp-price', '9.99');
    assert(/\$2\.95/.test(await page.textContent('#kdp-money')), 'Royalty at $9.99 is 60% less printing');
    assert(/Ready to type into KDP/.test(await page.textContent('#kdp-check')), 'The listing is ready');
    if (SHOTS) await (await page.$('#kdp-editor')).screenshot({ path: path.join(SHOTS, 'kdp-price.png') });
    await page.click('#kdp-save');
    await page.waitForFunction(() => /#kdp\/kdp-/.test(location.hash));
    const row = await db.prepare('SELECT * FROM kdp_listings').first();
    assert(row && row.book_id === 'bk-e2e-1' && JSON.parse(row.listing).price.usd === 9.99, 'Save keeps the listing linked to the Grid book');
    assert(/Ready for KDP/.test(await page.textContent('#kdp-rows')), 'The list shows it is ready');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'kdp-editor.png'), fullPage: true });

    // A month of sales.
    await page.click('[data-group="sales"] summary');
    await page.fill('#kdp-s-month', '2026-10');
    await page.fill('#kdp-s-units', '12');
    await page.fill('#kdp-s-royalty', '35.40');
    await page.click('#kdp-s-add');
    await page.waitForSelector('[data-kdp-sale-del="2026-10"]');
    assert(/\$35\.40/.test(await page.textContent('#kdp-tiles')), 'Royalties total on the tiles');

    // Changes are kept until saved or discarded.
    await page.click('[data-group="details"] summary');
    await page.fill('#kdp-title', 'Changed title');
    assert(/Not saved/.test(await page.textContent('#kdp-check')), 'An edit shows Not saved');
    await page.click('#kdp-discard');
    await page.waitForFunction(() => document.querySelector('#kdp-title')?.value === 'Logic Grid Puzzles');
    assert(true, 'Discard changes puts the saved words back');

    await page.click('#kdp-delete');
    assert(/deleted for good/.test(await page.textContent('#dialog')), 'Delete asks first');
    await page.click('#dialog-cancel');
    assert(await db.prepare('SELECT id FROM kdp_listings').first(), 'Cancel keeps the listing');
    await page.click('#kdp-delete');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => /No listings yet/.test(document.querySelector('#kdp-rows').textContent));
    assert(!(await db.prepare('SELECT id FROM kdp_listings').first()) && !(await db.prepare('SELECT * FROM kdp_sales').first()), 'Delete removes the listing and its sales');
    assert(problems.length === 0, `no script errors (${problems.join(' | ')})`);
  } finally {
    await browser.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
