// End-to-end check of Book Studio's Project > Make a copy without AI content,
// against the real Worker (Miniflare, local D1, the admin/ files as Worker
// assets): pictures labelled as AI-made in their file come ticked, puzzles are
// not listed, the original stays unchanged on the account, the copy opens with
// marked empty spots, and each spot's prompt takes your own words (or Leave it
// out, or Later); the Publish check and exports stop while any are empty.
// Needs `npm install` in server/ and `node book-studio/build.mjs` first.
// SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const PORT = 8176;
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'flg-e2e-noai';
const OWNER = 'owner@example.com';
const SHOTS = process.env.SHOTS;

// A 2 × 2 PNG, with an optional text note like the ones AI image tools write.
function png(note) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (note) parts.push(chunk('tEXt', Buffer.from(`parameters\0${note}`)));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return 'data:image/png;base64,' + Buffer.concat(parts).toString('base64');
}

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const signer = makeSigner(PROJECT);
  const mf = new Miniflare({
    port: PORT, modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'), compatibilityDate: '2026-08-01', d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: BASE, ADMIN_TOKEN: 'break-glass-key-for-the-noai-test', OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const browser = await chromium.launch();
  const problems = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    const stored = JSON.stringify({ mode: 'firebase', email: OWNER, idToken: signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true }), refreshToken: 'x', exp: Date.now() + 3_000_000, seen: Date.now() });
    await ctx.addInitScript((s) => { sessionStorage.setItem('flg-admin-session', s); }, stored);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|^Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    await page.goto(`${BASE}/admin/book-studio/`);
    await page.waitForFunction(() => !document.querySelector('#app').hidden && document.querySelector('#whoEmail').textContent, null, { timeout: 30000 });

    // The sample book a new device starts with, synced, before ours replaces it.
    await page.waitForFunction(() => document.querySelector('#sbSync')?.textContent.startsWith('Synced'), null, { timeout: 30000 });
    // A book with an AI-labelled picture, a plain picture, words, a puzzle and a description.
    const AI = png('a castle at dusk\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7');
    const PLAIN = png('');
    await page.evaluate(async ({ AI, PLAIN }) => {
      const p = blankProject();
      p.meta = { ...p.meta, title: 'Castle Puzzles', author: 'Bobby Taylor', description: 'An AI-written description.' };
      p.pages = [
        { id: 'pa', html: `<h1>Castle Puzzles</h1><p>An AI-written story about the castle.</p><p><img src="${AI}" alt=""></p><p>Words I wrote myself.</p><p><img src="${PLAIN}" alt=""></p>` },
        { id: 'pb', html: `<div class="puzzle" contenteditable="false" data-kind="maze"><img src="${PLAIN}" alt="Maze"></div>` },
      ];
      S.syncId = undefined;
      await loadProject(p);
      syEnsureId(); markDirty();
    }, { AI, PLAIN });
    await page.waitForFunction(() => S.syncId && document.querySelector('#sbSync')?.textContent.startsWith('Synced') && !syPending(syCurrent()), null, { timeout: 30000 });
    const original = await page.evaluate(() => S.syncId);

    await page.click('#projMenuBtn');
    await page.click('#noaiBtn');
    await page.waitForSelector('#dlgNoAi[open] .noai-item');
    const listed = await page.$$eval('[data-noai]', (els) => els.map((e) => ({ key: e.dataset.noai, on: e.checked, text: e.closest('label').textContent })));
    assert(listed.some((i) => i.on && /AI label found/.test(i.text)), 'A picture labelled as AI-made in its file comes ticked');
    assert(listed.filter((i) => /Picture/.test(i.text) && !i.on).length === 1, 'A plain picture is listed but not ticked');
    assert(!listed.some((i) => i.key.startsWith('p1:')), 'The puzzle page is not listed');
    await page.click('label.noai-item:has-text("An AI-written story") input');
    await page.click('label.noai-item:has-text("An AI-written description") input');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'noai-review.png') });
    await page.click('#noaiMake');

    // The copy opens and the first removed spot asks for your own words.
    await page.waitForSelector('#dlgNoAiFill[open]');
    const copyId = await page.evaluate(() => S.syncId);
    assert(copyId && copyId !== original, 'The copy is a new book');
    assert(/1 of 3/.test(await page.textContent('#noaiFillStep')), 'Three removed spots to fill');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'noai-fill.png') });
    await page.fill('#noaiFillText', 'My own story about the castle.');
    await page.click('#noaiFillPut');
    await page.waitForFunction(() => /picture/i.test(document.querySelector('#noaiFillTitle').textContent));
    assert(await page.isVisible('#noaiFillPic'), 'A removed picture offers Choose my own picture');
    await page.click('#noaiFillOut');
    await page.waitForFunction(() => /description/i.test(document.querySelector('#noaiFillTitle').textContent));
    await page.click('#noaiFillLater');
    await page.waitForFunction(() => !document.querySelector('#dlgNoAiFill').open);
    assert(await page.evaluate(() => aiGapCount()) === 1, 'Later keeps one spot for later');
    const blocked = await page.evaluate(async () => (await runChecks()).some((i) => i.id === 'aigaps' && i.sev === 'error'));
    assert(blocked, 'The Publish check stops while a spot is empty');
    await page.click('#projMenuBtn');
    assert(/\(1\)/.test(await page.textContent('#noaiFillBtn')), 'Project shows Fill the removed spots (1)');
    await page.click('#noaiFillBtn');
    await page.waitForSelector('#dlgNoAiFill[open]');
    await page.fill('#noaiFillText', 'A book of castle logic puzzles.');
    await page.click('#noaiFillPut');
    await page.waitForFunction(() => !document.querySelector('#dlgNoAiFill').open);

    const copy = await page.evaluate(() => { syncPagesFromDom(); return { html: S.pages.map((p) => p.html).join(''), desc: S.meta.description, gaps: aiGapCount(), noAi: S.noAi }; });
    assert(copy.gaps === 0, 'Every spot is filled');
    assert(copy.html.includes('My own story about the castle.') && !copy.html.includes('AI-written'), 'Your words replace the AI-written ones');
    assert(!copy.html.includes(AI) && copy.html.includes(PLAIN) && copy.html.includes('Words I wrote myself.'), 'The AI picture is gone; your own picture and words stay');
    assert(copy.html.includes('class="puzzle"'), 'The puzzle stays');
    assert(copy.desc === 'A book of castle logic puzzles.' && copy.noAi?.from === original, 'The description is yours, and the copy knows its original');

    await page.evaluate(() => syPush());
    await page.waitForFunction(() => !syPending(syCurrent()) && document.querySelector('#sbSync')?.textContent.startsWith('Synced'), null, { timeout: 30000 });
    const rows = (await db.prepare('SELECT id, title FROM studio_books').all()).results;
    assert(rows.find((r) => r.id === copyId)?.title === 'Castle Puzzles (no AI content)', 'The account lists the copy as "(no AI content)"');
    const parts = (await db.prepare('SELECT data FROM studio_book_parts WHERE id = ?1 ORDER BY idx').bind(original).all()).results.map((r) => r.data).join('');
    assert(parts.includes('An AI-written story') && rows.find((r) => r.id === original)?.title === 'Castle Puzzles', 'The original is unchanged on the account');
    assert(problems.length === 0, `no script errors (${problems.join(' | ')})`);
  } finally {
    await browser.close();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
