// Player puzzles in Book Studio (studio-player-puzzles.js): only approved and
// published puzzles are listed, with the player's screen name as the credit
// (none for a player who chose to stay anonymous); a wizard puzzle built in
// Book Studio is kept once; and every saved export with the interior counts each
// player puzzle once per book. Run with `npm test` in server/.
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
let mf, db;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: 'unused-token-for-player-puzzles', OWNER_EMAIL: 'owner@example.com', SITE_URL: 'https://thelogicgrid.com/' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at, publishing) VALUES ('pub@example.com', 'publisher', 't', 0, 0), ('view@example.com', 'viewer', 't', 0, 0)").run();
  await db.prepare("INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES ('u1', 'PuzzleFox', 'puzzlefox', 0, 0)").run();
  const add = (id, kind, status, credit, form, puzzle = null, uid = 'u1') => db.prepare(`INSERT INTO story_submissions (id, kind, title, credit, form, text, user_id, status, puzzle, created_at, decided_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 'words', ?6, ?7, ?8, ?1, ?1)`).bind(id, kind, `Entry ${id}`, credit, JSON.stringify(form), uid, status, puzzle && JSON.stringify(puzzle)).run();
  await add(1, 'puzzle', 'approved', 'Jamie R.', { kind: 'puzzle', game: 'fantastical', difficulty: 'easy', title: 'Garden Party', seed: 'abc123', credit: 'Jamie R.' });
  await add(2, 'puzzle', 'published', '', { kind: 'puzzle', game: 'ninetimesnine', level: 'hard', title: 'Quiet Numbers', seed: 'zz9', credit: '' });
  await add(3, 'storyline', 'approved', 'Sam', { kind: 'storyline', title: 'Lost Hats' }, { title: 'Lost Hats', difficulty: { id: 'medium' } }, null);
  await add(4, 'puzzle', 'new', 'Kim', { kind: 'puzzle', game: 'fantastical', title: 'Not yet' });
  await add(5, 'theme', 'approved', 'Lee', { kind: 'theme', idea: 'Bees' });
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

test('only approved and published player puzzles are listed, with the screen name as credit', async () => {
  const r = await call('pub@example.com', 'studio/player-puzzles');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.siteUrl, 'https://thelogicgrid.com');
  const byId = Object.fromEntries(r.body.items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(byId).map(Number).sort(), [1, 2, 3]);
  assert.equal(byId[1].credit, 'PuzzleFox', 'a signed-in player is credited by screen name');
  assert.equal(byId[1].seed, 'abc123');
  assert.equal(byId[1].entry.title, 'Garden Party', 'a wizard puzzle comes with its entry to rebuild');
  assert.equal(byId[2].credit, '', 'a player who chose no credit gets none');
  assert.equal(byId[2].anonymous, true);
  assert.equal(byId[2].game, 'ninetimesnine');
  assert.equal(byId[3].credit, 'Sam', 'no screen name: the name they chose');
  assert.equal(byId[3].puzzle.title, 'Lost Hats');
  assert.equal(byId[3].entry, null);
});

test('a viewer without publishing access cannot list them', async () => {
  const r = await call('view@example.com', 'studio/player-puzzles');
  assert.equal(r.status, 403);
});

test('a built wizard puzzle is kept once and never replaces a saved one', async () => {
  const first = await call('pub@example.com', 'studio/player-puzzles/1/puzzle', { puzzle: { title: 'Garden Party', clues: [] } });
  assert.equal(first.body.kept, true);
  const again = await call('pub@example.com', 'studio/player-puzzles/1/puzzle', { puzzle: { title: 'Other', clues: [] } });
  assert.equal(again.body.kept, false);
  const story = await call('pub@example.com', 'studio/player-puzzles/3/puzzle', { puzzle: { title: 'Other' } });
  assert.equal(story.body.kept, false, 'a storyline keeps its own puzzle');
  const row = await db.prepare('SELECT puzzle FROM story_submissions WHERE id = 1').first();
  assert.equal(JSON.parse(row.puzzle).title, 'Garden Party');
  const bad = await call('pub@example.com', 'studio/player-puzzles/2/puzzle', { puzzle: 'nope' });
  assert.equal(bad.status, 400);
});

test('an export counts each player puzzle once per book', async () => {
  const exp = (body) => call('pub@example.com', 'studio/player-puzzles/published', { title: 'Weekend Puzzles', platform: 'Amazon KDP', ...body });
  let r = await exp({ kind: 'packet', book: 'bs-book001', puzzles: [1, 3, 3, 999] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.counted, 2, 'unknown ids and repeats are not counted');
  r = await exp({ kind: 'interior', book: 'bs-book001', puzzles: [1, 3] });
  assert.equal(r.body.counted, 0, 'the same book exported again is not a new publication');
  r = await exp({ kind: 'cover', book: 'bs-book002', puzzles: [1] });
  assert.equal(r.status, 400, 'a cover on its own is not a publication');
  r = await exp({ kind: 'packet', book: 'bs-book002', title: 'Volume 2', puzzles: [1] });
  assert.equal(r.body.counted, 1);
  const list = await call('pub@example.com', 'studio/player-puzzles');
  const one = list.body.items.find((i) => i.id === 1);
  assert.equal(one.books, 2);
  assert.equal(one.exports, 3);
  assert.equal(list.body.items.find((i) => i.id === 3).books, 1);
  // Grid Admin's Puzzle submissions page shows the count and the books.
  const admin = await call('owner@example.com', 'story-submissions?kind=puzzles');
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.items.find((i) => i.id === 1).books, 2);
  const detail = await call('owner@example.com', 'story-submissions/1');
  assert.deepEqual(detail.body.books.map((b) => [b.title, b.exports]).sort(), [['Volume 2', 1], ['Weekend Puzzles', 2]]);
});
