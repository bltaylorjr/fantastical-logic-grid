// The website's design (admin dashboard > Website): the shared options, the
// draft, Publish, history and the public copy the website build reads.
// Run with `npm test` in server/. The Worker runs in Miniflare with a local D1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { CATEGORIES, OPTIONS, defaults, normalize, changes, css, attributes, texts } from '../../web/js/site-design.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const ADMIN = 'test-admin-token-1234567890';
let mf;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRoot: join(root, '..'),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    ratelimits: Object.fromEntries(['LIMIT_PLAYS', 'LIMIT_ADMIN'].map((n, i) => [n, { namespace_id: String(43001 + i), simple: { limit: 1000, period: 60 } }])),
    bindings: { ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: ADMIN, FIREBASE_PROJECT_ID: 'flg-test' },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { body, token } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('every option has a label, a default and (for lists) at least two choices that include the default', () => {
  assert.ok(CATEGORIES.length >= 8);
  const keys = new Set();
  for (const o of OPTIONS) {
    assert.ok(o.label && o.default !== undefined, o.key);
    assert.ok(!keys.has(o.key), `${o.key} is listed once`);
    keys.add(o.key);
    if (o.type === 'select') {
      assert.ok(o.choices.length >= 2, o.key);
      assert.ok(o.choices.some((c) => c.value === o.default), `${o.key}: the default is one of the choices`);
    } else assert.ok(o.default.length <= o.max, `${o.key}: the default fits`);
  }
});

test('the default design changes nothing, and only known choices are kept', () => {
  assert.deepEqual(changes(defaults()), {});
  assert.equal(css({}), '');
  const d = normalize({ accentLight: '#000000', corners: 'square', heroTitle: '  <b>Hello</b>   there ', evil: 'x', fxHover: 'tilt' });
  assert.equal(d.accentLight, defaults().accentLight, 'a color that is not offered is refused');
  assert.equal(d.heroTitle, 'bHello/b there', 'no tags, tidy spaces');
  assert.equal('evil' in d, false);
  assert.deepEqual(changes(d), { corners: 'square', heroTitle: 'bHello/b there', fxHover: 'tilt' });
  assert.equal(attributes(d)['data-fx-hover'], 'tilt');
  assert.equal(texts(d).heroTitle, 'bHello/b there');
  assert.match(css({ accentLight: '#0E7490' }), /--accent:#0E7490/);
  assert.doesNotMatch(css({ accentLight: '#0E7490' }), /data-theme="contrast"\]\{/, 'high contrast is never restyled');
});

test('draft, publish, history and the public copy', async () => {
  assert.equal((await call('/admin/v1/site-design')).status, 401);
  let v = await call('/admin/v1/site-design', { token: ADMIN });
  assert.equal(v.status, 200);
  assert.equal(v.body.draft, null);
  assert.equal(v.body.published, null);
  assert.deepEqual((await call('/v1/site/design')).body, { design: {}, version: 0 });

  assert.equal((await call('/admin/v1/site-design/publish', { body: {}, token: ADMIN })).status, 400, 'nothing to publish yet');
  assert.equal((await call('/admin/v1/site-design/draft', { body: { design: 'red' }, token: ADMIN })).status, 400);
  const saved = await call('/admin/v1/site-design/draft', { body: { design: { accentLight: '#0E7490', heroTitle: 'Choose a puzzle.', bogus: 1 } }, token: ADMIN });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.draft.design, { accentLight: '#0E7490', heroTitle: 'Choose a puzzle.' });
  assert.deepEqual((await call('/v1/site/design')).body.design, {}, 'a draft is not live');

  const pub = await call('/admin/v1/site-design/publish', { body: {}, token: ADMIN });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.rebuilding, false, 'no GitHub token in tests, so the daily build publishes it');
  const live = (await call('/v1/site/design')).body;
  assert.deepEqual(live.design, { accentLight: '#0E7490', heroTitle: 'Choose a puzzle.' });
  assert.ok(live.version > 0);

  await call('/admin/v1/site-design/draft', { body: { design: { corners: 'square' } }, token: ADMIN });
  await call('/admin/v1/site-design/publish', { body: {}, token: ADMIN });
  v = await call('/admin/v1/site-design', { token: ADMIN });
  assert.equal(v.body.history.length, 2);
  assert.equal(v.body.draft, null, 'publishing clears the draft');
  const first = v.body.history[1].id;
  const restored = await call(`/admin/v1/site-design/restore/${first}`, { body: {}, token: ADMIN });
  assert.deepEqual(restored.body.draft.design, { accentLight: '#0E7490', heroTitle: 'Choose a puzzle.' }, 'an older version comes back as a draft');
  assert.equal((await call('/admin/v1/site-design/discard', { body: {}, token: ADMIN })).status, 200);
  assert.equal((await call('/admin/v1/site-design', { token: ADMIN })).body.draft, null);
  assert.equal((await call('/admin/v1/site-design/restore/99999', { body: {}, token: ADMIN })).status, 404);
});
