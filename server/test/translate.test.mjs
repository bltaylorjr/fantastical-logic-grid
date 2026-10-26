// Translations for players who choose another language (src/translate.js).
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
const TOKEN = 'break-glass-token-for-tests-1234';
const OWNER = 'owner@example.com';
const signer = makeSigner(PROJECT);
let mf;
let db;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    assets: { directory: join(root, '..', 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } }, LIMIT_TRANSLATE: { namespace_id: '2', simple: { limit: 400, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN,
      OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'test-web-key', DAILY_TTS_CAP: '300', TEST_TRANSLATE: '1',
    },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const idToken = (sub, email, verified = true) => signer.token({ sub, email, email_verified: verified });
const owner = () => idToken('owner-uid', OWNER);

async function call(path, { auth, method, body, origin = ORIGIN } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, body: json, text, headers: r.headers };
}

const tr = (to, texts) => call('/v1/translate', { body: { to, texts } });
const setting = (key, value) => call('/admin/v1/settings', { auth: owner(), body: { key, value } });

test('texts are translated once and then come from the database', async () => {
  const r = await tr('es', ['Daily puzzle', '  Solve the puzzle  ', 'Daily puzzle']);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.texts, ['[es] Daily puzzle', '[es] Solve the puzzle', '[es] Daily puzzle']);
  const used = await db.prepare("SELECT count FROM usage WHERE name = 'translate'").first();
  assert.equal(used.count, 2, 'a repeated text counts once');
  await db.prepare("UPDATE translations SET text = 'Rompecabezas diario' WHERE lang = 'es' AND text = '[es] Daily puzzle'").run();
  const again = await tr('es', ['Daily puzzle']);
  assert.deepEqual(again.body.texts, ['Rompecabezas diario'], 'kept translations are reused');
  assert.equal((await db.prepare("SELECT count FROM usage WHERE name = 'translate'").first()).count, 2, 'kept translations do not count');
  const fr = await tr('fr', ['Daily puzzle']);
  assert.deepEqual(fr.body.texts, ['[fr] Daily puzzle'], 'each language has its own');
});

test('bad requests are refused', async () => {
  assert.equal((await tr('xx', ['Hello'])).status, 400, 'unknown language');
  assert.equal((await tr('es', [])).status, 400, 'no texts');
  assert.equal((await tr('es', ['x'.repeat(1001)])).status, 400, 'text too long');
  assert.equal((await tr('es', Array(41).fill('Hello'))).status, 400, 'too many texts');
  assert.equal((await tr('es', [42])).status, 400, 'not text');
});

test('the daily cap and the switch are kept', async () => {
  await db.prepare("DELETE FROM usage WHERE name = 'translate'").run();
  await setting('daily_translate_cap', 2);
  const r = await tr('de', ['One', 'Two', 'Three']);
  assert.equal(r.body.reason, 'used_up');
  assert.deepEqual(r.body.texts, ['[de] One', '[de] Two', null], 'texts past the cap stay in English');
  const cfg = await call('/v1/config');
  assert.equal(cfg.body.features.translate, true, 'the game is told translations are on');
  await setting('translate_enabled', false);
  const off = await tr('de', ['One']);
  assert.deepEqual(off.body, { texts: [null], reason: 'switched_off' });
  assert.equal((await call('/v1/config')).body.features.translate, false);
  await setting('translate_enabled', true);
  await setting('daily_translate_cap', 3000);
});

test('the daily cleanup removes translations unused for 180 days', async () => {
  await db.prepare("INSERT INTO translations (lang, hash, text, day) VALUES ('it', 'old', 'Vecchio', '2020-01-01')").run();
  await db.prepare("INSERT INTO translations (lang, hash, text, day) VALUES ('it', 'new', 'Nuovo', ?1)").bind(new Date().toISOString().slice(0, 10)).run();
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '17 3 * * *' });
  assert.equal(await db.prepare("SELECT 1 FROM translations WHERE hash = 'old'").first(), null);
  assert.ok(await db.prepare("SELECT 1 FROM translations WHERE hash = 'new'").first(), 'recent ones stay');
});
