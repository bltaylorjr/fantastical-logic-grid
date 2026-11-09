// Amazon KDP (kdp.js, admin/kdp-calc.js): printing cost, royalty and lowest
// price, the listing rules and watch list, saving listings and monthly sales.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
const TOKEN = 'break-glass-token-for-kdp-tests';
const signer = makeSigner(PROJECT);
let mf;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', SITE_URL: 'https://thelogicgrid.com' },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function admin(path, body) {
  const r = await mf.dispatchFetch(`https://api.test/admin/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const listing = (over = {}) => ({
  title: 'The Fantastical Logic Grid', subtitle: 'Logic Puzzles for Adults, Volume 1', author: 'Bobby Taylor',
  description: 'Story logic grid puzzles with answers.',
  keywords: ['logic grid puzzles adults', 'brain teaser gift', 'deduction puzzle book', 'story puzzles', 'puzzle book for seniors', 'logic problems with answers', 'mystery puzzles'],
  categories: ['Games & Activities > Logic & Brain Teasers', 'Games & Activities > Puzzles', 'Humor & Entertainment > Puzzles & Games'],
  ai: { text: 'none', images: 'none', translations: 'none' },
  print: { ink: 'black', trim: '8.5x11', paper: 'white', pages: 120 }, price: { usd: 9.99, expanded: false }, ...over,
});

test('printing cost follows KDP’s Amazon.com tables', async () => {
  const { printingCost, minimumPrice, royalty } = await import('../../admin/kdp-calc.js');
  assert.equal(printingCost({ ink: 'black', trim: '6x9', pages: 60 }).cost, 2.30);
  assert.equal(printingCost({ ink: 'black', trim: '8.5x11', pages: 60 }).cost, 2.84);
  assert.equal(printingCost({ ink: 'black', trim: '6x9', pages: 300 }).cost, 4.60);
  assert.equal(printingCost({ ink: 'black', trim: '8.5x11', pages: 300 }).cost, 6.10);
  assert.equal(printingCost({ ink: 'premium', trim: '6x9', pages: 100 }).cost, 7.50);
  assert.equal(printingCost({ format: 'hardcover', ink: 'black', trim: '6x9', pages: 300 }).cost, 9.10);
  assert.ok(printingCost({ ink: 'black', pages: 20 }).error);
  assert.ok(printingCost({ format: 'hardcover', ink: 'standard', pages: 200 }).error);
  // KDP's own example: 300 pages, $9.99 → (0.60 × 9.99) − 4.60 = $1.39.
  assert.equal(royalty({ price: 9.99, cost: 4.60 }).amazon, 1.39);
  assert.equal(royalty({ price: 9.98, cost: 4.60 }).rate, 0.5);
  assert.equal(royalty({ price: 12, cost: 4.60, expanded: true }).expanded, 0.20);
  assert.equal(minimumPrice(2.30), 4.60);
  assert.equal(minimumPrice(6.10), 10.17);
  assert.equal(minimumPrice(5.50), 9.99);
  assert.equal(minimumPrice(4.60, { expanded: true }), 11.50);
});

test('the listing check finds what KDP would refuse', async () => {
  const { checkListing } = await import('../../admin/kdp-calc.js');
  assert.deepEqual(checkListing(listing()).problems, []);
  const bad = checkListing(listing({ title: '', keywords: ['free logic puzzles', 'x'.repeat(51)], price: { usd: 3 }, ai: {} }));
  assert.ok(bad.problems.some((p) => /title/.test(p)));
  assert.ok(bad.problems.some((p) => /"free"/.test(p)));
  assert.ok(bad.problems.some((p) => /Keyword 2 is 51/.test(p)));
  assert.ok(bad.problems.some((p) => /lowest list price/.test(p)));
  assert.ok(bad.problems.some((p) => /AI-generated/.test(p)));
  assert.ok(checkListing(listing({ price: { usd: 8 } })).tips.some((t) => /60%/.test(t)));
});

test('a listing saves, shows its check and totals its sales', async () => {
  const r = await admin('kdp', { format: 'paperback', status: 'planning', listing: listing() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.id;
  let one = await admin(`kdp/${id}`);
  assert.equal(one.body.review.ready, true, JSON.stringify(one.body.review));
  assert.equal(one.body.review.money.cost, 3.04);
  assert.equal(one.body.listing.listing.keywords.length, 7);
  // Going live records the day once.
  assert.equal((await admin('kdp', { id, format: 'paperback', status: 'live', asin: 'b0abcde123', listing: listing() })).status, 200);
  one = await admin(`kdp/${id}`);
  assert.equal(one.body.listing.asin, 'B0ABCDE123');
  assert.ok(one.body.listing.liveAt);
  assert.equal((await admin(`kdp/${id}/sales`, { month: '2026-09', units: 4, royalty: 5.6 })).status, 200);
  assert.equal((await admin(`kdp/${id}/sales`, { month: '2026-10', units: 10, royalty: 14.01 })).status, 200);
  assert.equal((await admin(`kdp/${id}/sales`, { month: '2026-10', units: 11, royalty: 15.41 })).status, 200);
  assert.equal((await admin(`kdp/${id}/sales`, { month: '2099-01', units: 1, royalty: 1 })).status, 400);
  assert.equal((await admin(`kdp/${id}/sales`, { month: '2026-13', units: 1, royalty: 1 })).status, 400);
  const list = await admin('kdp');
  const row = list.body.listings.find((l) => l.id === id);
  assert.equal(row.units, 15);
  assert.equal(row.royaltyCents, 2101);
  assert.equal(row.lastMonth, '2026-10');
  assert.deepEqual(list.body.months.map((m) => m.month), ['2026-09', '2026-10']);
  assert.equal((await admin(`kdp/${id}/sales/2026-09/delete`, {})).status, 200);
  assert.equal((await admin(`kdp/${id}`)).body.sales.length, 1);
  assert.equal((await admin(`kdp/${id}/delete`, {})).status, 200);
  assert.equal((await admin(`kdp/${id}`)).status, 404);
});

test('checks a listing before saving it, and flags trademarks', async () => {
  assert.equal((await admin('kdp', { listing: listing({ title: '' }) })).status, 400);
  assert.equal((await admin('kdp', { asin: 'nope', listing: listing() })).status, 400);
  assert.equal((await admin('kdp', { isbn: '12345', listing: listing() })).status, 400);
  const r = await admin('kdp', { listing: listing({ keywords: ['pokemon logic puzzles'] }) });
  const one = await admin(`kdp/${r.body.id}`);
  assert.ok(one.body.review.findings.some((f) => f.term === 'Pokemon'));
  assert.equal(one.body.review.ready, false);
});
