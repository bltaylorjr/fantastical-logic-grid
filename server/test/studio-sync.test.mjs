// Book Studio sync (studio-sync.js): each publisher's books on their own
// account, large books in parts, a save from an older version refused (409),
// no access without publishing rights, and delete. Run with `npm test` in server/.
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: 'unused-token-for-studio-sync', OWNER_EMAIL: 'owner@example.com' },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at, publishing) VALUES ('pub@example.com', 'publisher', 't', 0, 0), ('pub2@example.com', 'publisher', 't', 0, 0), ('view@example.com', 'viewer', 't', 0, 0)").run();
});
after(() => mf.dispose());

const as = (email) => signer.token({ sub: `uid-${email}`, email, email_verified: true });
async function call(email, path, body) {
  const r = await mf.dispatchFetch(`https://api.test/admin/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${as(email)}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const book = (title, extra = '') => ({ meta: { title }, pages: [{ id: 'p1', html: `<p>Hello${extra}</p>` }] });

test('a book saves, lists and opens on another device', async () => {
  const s = await call('pub@example.com', 'studio/books/bs-abcdef1', { project: book('Weekend Puzzles'), baseRev: 0, device: 'Laptop' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.book.rev, 1);
  const list = await call('pub@example.com', 'studio/books');
  assert.deepEqual(list.body.books.map((b) => [b.id, b.title, b.rev, b.device]), [['bs-abcdef1', 'Weekend Puzzles', 1, 'Laptop']]);
  const one = await call('pub@example.com', 'studio/books/bs-abcdef1');
  assert.equal(one.body.project.pages[0].html, '<p>Hello</p>');
  assert.equal(one.body.book.rev, 1);
});

test('a save from an older version is refused, so nothing is overwritten', async () => {
  const next = await call('pub@example.com', 'studio/books/bs-abcdef1', { project: book('Weekend Puzzles 2'), baseRev: 1, device: 'Phone' });
  assert.equal(next.body.book.rev, 2);
  const stale = await call('pub@example.com', 'studio/books/bs-abcdef1', { project: book('Old copy'), baseRev: 1, device: 'Laptop' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'changed');
  const fresh = await call('pub@example.com', 'studio/books/bs-abcdef2', { project: book('New'), baseRev: 3 });
  assert.equal(fresh.status, 200, 'a new book saves whatever rev the page thought it had');
  const again = await call('pub@example.com', 'studio/books/bs-abcdef2', { project: book('New'), baseRev: 0 });
  assert.equal(again.status, 409, 'a second "new" book with the same id does not replace the first');
  assert.equal((await call('pub@example.com', 'studio/books/bs-abcdef1')).body.project.meta.title, 'Weekend Puzzles 2');
});

test('a big book is stored in parts and comes back whole', async () => {
  const big = 'x'.repeat(2_500_000);
  const s = await call('pub@example.com', 'studio/books/bs-bigbook', { project: book('Big', big), baseRev: 0 });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const db = await mf.getD1Database('DB');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM studio_book_parts WHERE id = 'bs-bigbook'").first()).n, 3);
  const one = await call('pub@example.com', 'studio/books/bs-bigbook');
  assert.equal(one.body.project.pages[0].html.length, big.length + '<p>Hello</p>'.length);
  // Saving a smaller version leaves no old parts behind.
  await call('pub@example.com', 'studio/books/bs-bigbook', { project: book('Big'), baseRev: 1 });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM studio_book_parts WHERE id = 'bs-bigbook'").first()).n, 1);
  assert.equal((await call('pub@example.com', 'studio/books/bs-bigbook')).body.project.pages[0].html, '<p>Hello</p>');
});

test('each account sees only its own books', async () => {
  assert.deepEqual((await call('pub2@example.com', 'studio/books')).body.books, []);
  assert.equal((await call('pub2@example.com', 'studio/books/bs-abcdef1')).status, 404);
  const own = await call('pub2@example.com', 'studio/books/bs-abcdef1', { project: book('Mine'), baseRev: 0 });
  assert.equal(own.status, 200);
  assert.equal((await call('pub@example.com', 'studio/books/bs-abcdef1')).body.project.meta.title, 'Weekend Puzzles 2');
});

test('no sync without publishing access; bad books are refused', async () => {
  assert.equal((await call('view@example.com', 'studio/books')).status, 403);
  assert.equal((await call('stranger@example.com', 'studio/books')).status, 403);
  assert.equal((await call('pub@example.com', 'studio/books/bs-abcdef9', { project: { meta: {} }, baseRev: 0 })).status, 400);
  assert.equal((await call('pub@example.com', 'studio/books/../x', { project: book('x') })).status, 404);
});

test('delete removes the book and its parts', async () => {
  assert.equal((await call('pub@example.com', 'studio/books/bs-bigbook/delete', {})).status, 200);
  assert.equal((await call('pub@example.com', 'studio/books/bs-bigbook')).status, 404);
  const db = await mf.getD1Database('DB');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM studio_book_parts WHERE id = 'bs-bigbook'").first()).n, 0);
});
