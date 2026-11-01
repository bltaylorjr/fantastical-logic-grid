// End-to-end check of admin > Book publishing, with no installs: the admin
// files are served with the Worker's own security headers (read from
// server/src/admin.js), and the books database routes (server/src/books.js)
// run against an in-memory SQLite database made from server/migrations.
// It makes Volume 1 again, checks it page for page, saves it as published,
// scans it, makes the next book (which must leave Volume 1's puzzles out),
// prints both the interior and the cover to PDF, and checks the reuse guard.
//   node scripts/e2e-books.mjs        (SHOTS=<folder> keeps screenshots and PDFs)
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

// ---- a D1-shaped database over node:sqlite
const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync(join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) sqlite.exec(stmt);
}
const prep = (sql) => {
  let args = [];
  const st = { bind: (...a) => { args = a; return st; }, all: async () => ({ results: sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) }), first: async () => { const r = sqlite.prepare(sql).get(...args); return r ? { ...r } : null; }, run: async () => sqlite.prepare(sql).run(...args) };
  return st;
};
const env = { DB: { prepare: prep, batch: async (list) => { for (const s of list) await s.run(); } } };

// ---- the Worker's routes and headers
const adminSrc = readFileSync(join(ROOT, 'server/src/admin.js'), 'utf8');
const CSP = adminSrc.match(/'Content-Security-Policy': "([^"]+)"/)[1];
const APP_FILE = new RegExp(adminSrc.match(/const APP_FILE = \/(.+)\/;/)[1]);
class Refusal extends Error { constructor(status, error, message) { super(message); this.status = status; this.error = error; } }
const { bookRoutes } = await import(join(ROOT, 'server/src/books.js'));
const routes = bookRoutes(Refusal);
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Content-Security-Policy': CSP }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (url.pathname.startsWith('/admin/v1/')) {
    const path = url.pathname.slice('/admin/v1/'.length);
    if (path === 'me') return send(200, { email: 'owner@example.com', role: 'owner', roles: ['viewer', 'moderator', 'admin', 'owner'] });
    const route = routes.find((r) => r[0] === req.method && r[1].test(path));
    if (!route) return send(200, {});
    let raw = ''; for await (const c of req) raw += c;
    try {
      const out = await route[4]({ env, url, params: path.match(route[1]).slice(1), body: raw ? JSON.parse(raw) : {}, who: { actor: 'owner@example.com', role: 'owner' }, now: Date.now() });
      return send(200, out.body);
    } catch (e) { return send(e.status || 500, { error: e.error || 'server', message: e.message }); }
  }
  const m = url.pathname.match(APP_FILE);
  if (!m) return send(404, 'not found', 'text/plain');
  const file = join(ROOT, 'admin', m[1] || 'index.html');
  if (!existsSync(file)) return send(404, 'not found', 'text/plain');
  send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
});
await new Promise((r) => server.listen(8171, r));
const APP = 'http://localhost:8171/admin/';

const vol1 = ['The Hallway Time Capsule', 'The Frozen Lost Diary', 'The Summery Banner', 'The Twinkling Spell Book', 'The Silent Path'];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const csp = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  page.on('pageerror', (e) => csp.push(`page error: ${e.message}`));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto(APP);
  await page.evaluate(() => { document.querySelector('#phone-help').open = true; document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
  await page.fill('#token-input', 'test-key');
  await page.press('#token-input', 'Enter');
  await page.waitForSelector('#app:not([hidden])');
  assert(await page.isVisible('#nav-list a[href="#books"]'), 'Book publishing is in the menu for an owner');
  await page.click('#nav-list a[href="#books"]');
  await page.waitForSelector('#bk-panel details');
  assert((await page.inputValue('[data-path="book.title"]')) === 'The Fantastical Logic Grid', 'starts with the Volume 1 title');
  assert((await page.inputValue('[data-path="format.trim"]')) === '8.5x11', 'starts at 8.5 x 11');
  assert((await page.locator('[data-theme]:checked').count()) === 22, 'the 22 Volume 1 themes are checked');

  // Make Volume 1 again.
  await page.click('#bk-build');
  await page.waitForFunction(() => /40 puzzles, 108 pages/.test(document.querySelector('#bk-status').textContent), null, { timeout: 120000 });
  assert(true, 'made 40 puzzles on 108 pages, as Volume 1');
  assert((await page.locator('.bk-thumb').count()) === 108, '108 page previews');
  const titles = await page.$$eval('#bk-print .bk-kind-clues h1', (els) => els.map((x) => x.textContent));
  assert(vol1.every((t, i) => titles[i] === t), 'the same puzzles as Volume 1, in the same order');
  assert(/Answer keys start on page 88/.test(await page.textContent('#bk-status')), 'answer keys start on page 88');
  assert(await page.evaluate(() => document.fonts.check('12px Poppins') && document.fonts.check('12px Caladea')), 'the built-in fonts load');
  assert((await page.locator('#bk-print .bk-page').evaluateAll((els) => els.filter((s) => { const i = s.querySelector('.bk-inner'); return i.scrollHeight > i.clientHeight + 1; }).length)) === 0, 'nothing runs off a page');
  assert(await page.locator('.bk-grid').first().evaluate((t) => getComputedStyle(t).getPropertyValue('--cell').trim().endsWith('in')), 'sizes reach the pages through data-css (no inline styles)');
  const checks = await page.textContent('#bk-checks');
  assert(/108 pages/.test(checks) && /Margins meet/.test(checks), 'KDP checks pass');
  const money = await page.textContent('#bk-money');
  assert(money.includes('$2.84') && money.includes('$3.15'), 'printing cost $2.84 and $3.15 a sale at $9.99');
  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, 'books-made.png'), fullPage: false });
    await page.locator('#bk-thumbs-card').screenshot({ path: join(SHOTS, 'pages.png'), clip: undefined }).catch(() => {});
  }

  // Print the interior: page size from the trim.
  await page.click('#bk-print-btn');
  await page.waitForFunction(() => window.__printed === 1);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pdfText = pdf.toString('latin1');
  const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert(pages === 108, `interior PDF has 108 pages (${pages})`);
  assert(/\/MediaBox \[0 0 612 792\]/.test(pdfText), 'interior PDF pages are 8.5 x 11 inches');
  if (SHOTS) writeFileSync(join(SHOTS, 'interior.pdf'), pdf);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.documentElement.classList.remove('bk-printing'));

  // Per-page colors: a color book, one grid page in its own colors.
  await page.evaluate(() => document.querySelectorAll('#bk-panel details').forEach((d) => { d.open = true; }));
  await page.selectOption('[data-path="format.ink"]', 'standard');
  await page.waitForTimeout(400);
  await page.selectOption('[data-page-mode="pz-1-b"]', 'custom');
  await page.waitForSelector('.bk-thumb[data-key="pz-1-b"] [data-path="style.pages.pz-1-b.colors.grids.headBg"]');
  await page.locator('.bk-thumb[data-key="pz-1-b"] [data-path="style.pages.pz-1-b.colors.grids.headBg"]').fill('#ffcc00');
  await page.locator('.bk-thumb[data-key="pz-1-b"] [data-path="style.pages.pz-1-b.colors.grids.headBg"]').dispatchEvent('change');
  await page.waitForTimeout(600);
  const fill = await page.locator('#bk-print [data-key="pz-1-b"] .bk-cat').first().evaluate((x) => getComputedStyle(x).backgroundColor);
  const other = await page.locator('#bk-print [data-key="pz-2-b"] .bk-cat').first().evaluate((x) => getComputedStyle(x).backgroundColor);
  assert(fill === 'rgb(255, 204, 0)' && other !== fill, 'one page has its own grid header color');
  assert(/color/i.test(await page.textContent('#bk-checks')), 'checks talk about the color pages');
  for (let i = 0; i < 6 && (await page.inputValue('[data-path="format.ink"]')) !== 'bw'; i++) { await page.click('#bk-undo'); await page.waitForTimeout(300); }
  assert((await page.inputValue('[data-path="format.ink"]')) === 'bw' && !(await page.evaluate(() => JSON.parse(localStorage.getItem('flgBookSettings')).style.pages['pz-1-b'])), 'undo goes back to black and white with book colors');

  // Cover.
  await page.waitForSelector('#bk-cover .cv');
  assert(/17\.493" × 11\.250"/.test(await page.textContent('#bk-cover-size')), 'cover is 17.493 x 11.25 inches with a 0.243" spine');
  if (SHOTS) await page.locator('#bk-cover').screenshot({ path: join(SHOTS, 'cover.png') });
  await page.click('#bk-cover-btn');
  await page.waitForFunction(() => window.__printed === 2);
  await page.emulateMedia({ media: 'print' });
  const cbuf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  if (SHOTS) writeFileSync(join(SHOTS, 'cover.pdf'), cbuf);
  const cpdf = cbuf.toString('latin1');
  console.log('    cover pages', (cpdf.match(/\/Type\s*\/Page[^s]/g) || []).length, (cpdf.match(/\/MediaBox \[[^\]]+\]/g) || []).slice(0, 2));
  assert((cpdf.match(/\/Type\s*\/Page[^s]/g) || []).length === 1 && /\/MediaBox \[0 0 1260 810\]/.test(cpdf), 'cover PDF is one page, 17.493 x 11.25 inches to the nearest point');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.documentElement.classList.remove('bk-printing'));

  // Save Volume 1 as published; it is scanned.
  await page.selectOption('#bk-save-status', 'published');
  await page.click('#bk-save-btn');
  await page.waitForFunction(() => /Scan done/.test(document.querySelector('#bk-scan-status').textContent), null, { timeout: 30000 });
  assert(sqlite.prepare('SELECT COUNT(*) AS n FROM book_puzzles').get().n === 40, 'the database has Volume 1’s 40 puzzles');
  assert(sqlite.prepare("SELECT COUNT(*) AS n FROM book_puzzles WHERE ip_verdict IS NOT NULL").get().n === 40, 'every puzzle was scanned');
  const flagged = sqlite.prepare("SELECT position, title, ip_scan FROM book_puzzles WHERE ip_verdict != 'clear'").all();
  console.log(`    scan: ${flagged.length} to look at: ${flagged.map((r) => `#${r.position} ${JSON.parse(r.ip_scan).findings.map((f) => f.term).join(', ')}`).join('; ')}`);
  await page.waitForSelector('#bk-book table');
  assert(/37 clear, 3 to check, 0 problems/.test(await page.textContent('#bk-scan-status')), 'scan: 37 clear, 3 to look at, no problems');
  if (SHOTS) await page.locator('#bk-dbcard').screenshot({ path: join(SHOTS, 'books-db.png') });

  // The same puzzles cannot be saved again as a second book.
  const again = await page.evaluate(async () => {
    const r = await fetch('/admin/v1/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Copy', puzzles: [{ position: 1, storyId: 'x', fingerprint: 'y' }] }) });
    return r.status;
  });
  assert(again === 200, 'a book with new puzzles saves');
  const vol1Story = sqlite.prepare('SELECT story_id FROM book_puzzles WHERE position = 1 AND book_id = 1').get().story_id;
  const reused = await page.evaluate(async (sid) => (await fetch('/admin/v1/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Reuse', puzzles: [{ position: 1, storyId: sid, fingerprint: 'zz' }] }) })).json(), vol1Story);
  assert(reused.error === 'reused', 'a book that reuses a published puzzle is refused');

  // Volume 2: same settings, new puzzles.
  await page.fill('[data-path="book.volume"]', 'Volume 2');
  await page.dispatchEvent('[data-path="book.volume"]', 'change');
  await page.click('#bk-build');
  await page.waitForFunction(() => /Making|Made \d/.test(document.querySelector('#bk-status').textContent));
  await page.waitForFunction(() => /^40 puzzles/.test(document.querySelector('#bk-status').textContent), null, { timeout: 120000 });
  const titles2 = await page.$$eval('#bk-print .bk-kind-clues h1', (els) => els.map((x) => x.textContent));
  const used = new Set(sqlite.prepare('SELECT title FROM book_puzzles WHERE book_id = 1').all().map((r) => r.title));
  assert(titles2.length === 40 && titles2.every((t) => !used.has(t)), 'Volume 2 has 40 puzzles, none from Volume 1');
  await page.selectOption('#bk-parent', '1');
  await page.click('#bk-save-btn');
  await page.waitForFunction(() => /Scan done/.test(document.querySelector('#bk-scan-status').textContent), null, { timeout: 30000 });
  assert(sqlite.prepare('SELECT parent_id FROM books WHERE volume = ?1').get('Volume 2').parent_id === 1, 'Volume 2 is saved as the next edition of Volume 1');
  assert(csp.length === 0, `no Content-Security-Policy or page errors${csp.length ? `: ${csp.join(' | ')}` : ''}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'books-end.png'), fullPage: false });
  console.log('Book publishing: all checks passed');
} finally {
  await browser.close();
  server.close();
}
