// Books for publishing (books.js): saving drafts, a puzzle in one book only,
// publishing locks a book, deleting a draft frees its puzzles, the watch-list
// scan and cover templates. Run with `npm test` in server/.
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
const TOKEN = 'break-glass-token-for-book-tests';
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
const puzzle = (fp, game = 'sf') => ({ fp, game, title: `Puzzle ${fp}`, story: `story-${fp}`, scan: 'clear', content: { page: '<p>page</p>', key: '<p>key</p>', level: 'Easy', size: '6×6', rules: ['A rule.'] } });
const draft = (over = {}) => ({ title: 'Logic Puzzles', subtitle: 'Volume test', volume: 1, edition: 1, author: 'Bobby Taylor', trim: '6x9', paper: 'white', pages: 24, settings: { kind: 'mix' }, cover: { template: 'classic' }, css: { sf: '.bk-g-sf td { border: 1px solid; }' }, puzzles: [puzzle('sf:a'), puzzle('np:b', 'np')], ...over });

test('a draft saves with its puzzles, pages and covers', async () => {
  const r = await admin('books', draft());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.id, /^bk-/);
  const list = await admin('books');
  assert.equal(list.body.used, 2);
  assert.equal(list.body.siteUrl, 'https://thelogicgrid.com');
  assert.equal(list.body.books[0].puzzles, 2);
  const one = await admin(`books/${r.body.id}`);
  assert.equal(one.body.book.puzzles[1].fp, 'np:b');
  assert.equal(one.body.book.puzzles[0].content.key, '<p>key</p>');
  assert.equal(one.body.book.css.sf, '.bk-g-sf td { border: 1px solid; }');
  const used = await admin('books/used');
  assert.deepEqual(used.body.used.map((u) => u.fp).sort(), ['np:b', 'sf:a']);
});

test('a puzzle can be in one book only', async () => {
  const r = await admin('books', draft({ title: 'Another book', puzzles: [puzzle('sf:a'), puzzle('sf:c')] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'puzzle_used');
  const twice = await admin('books', draft({ title: 'Twice', puzzles: [puzzle('sf:d'), puzzle('sf:d')] }));
  assert.equal(twice.status, 400);
});

test('checks the book before saving it', async () => {
  assert.equal((await admin('books', draft({ title: '' }))).status, 400);
  assert.equal((await admin('books', draft({ trim: '5x5' }))).status, 400);
  assert.equal((await admin('books', draft({ puzzles: [{ ...puzzle('bad fp!') }] }))).status, 400);
});

test('publishing locks a book; deleting a draft frees its puzzles', async () => {
  const a = await admin('books', draft({ title: 'To publish', puzzles: [puzzle('sf:p1')] }));
  assert.equal((await admin(`books/${a.body.id}/publish`, {})).status, 200);
  const change = await admin('books', { ...draft({ title: 'Changed', puzzles: [puzzle('sf:p1')] }), id: a.body.id });
  assert.equal(change.status, 400);
  assert.equal((await admin(`books/${a.body.id}/delete`, {})).status, 400);
  const b = await admin('books', draft({ title: 'To delete', puzzles: [puzzle('sf:x1')] }));
  assert.equal((await admin(`books/${b.body.id}/delete`, {})).status, 200);
  const again = await admin('books', draft({ title: 'Reuses x1', puzzles: [puzzle('sf:x1')] }));
  assert.equal(again.status, 200, 'a deleted draft gives its puzzles back');
});

test('the scan flags protected names', async () => {
  const r = await admin('books/scan', { items: [{ fp: 'sf:1', title: 'Fine', text: 'A walk in the park.' }, { fp: 'sf:2', title: 'Oops', text: 'Harry Potter visits Hogwarts.' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].verdict, 'clear');
  assert.notEqual(r.body.results[1].verdict, 'clear');
});

test('cover templates save and delete', async () => {
  const r = await admin('book-templates', { name: 'Autumn', design: { template: 'band', colors: { bg: '#aa5500' } } });
  assert.equal(r.status, 200);
  const list = await admin('books');
  const t = list.body.templates.find((x) => x.name === 'Autumn');
  assert.equal(t.design.template, 'band');
  assert.equal((await admin(`book-templates/${t.id}/delete`, {})).status, 200);
  assert.equal((await admin('books')).body.templates.length, 0);
});
