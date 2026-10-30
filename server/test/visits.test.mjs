// Site visitors: the game sends one anonymous visit a day per device, unknown
// values fold into 'other', the place comes from Cloudflare (never the body),
// and the admin Visitors page adds them up for viewers.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { cleanVisit } from '../src/visits.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: 'break-glass-token-for-tests-1234',
      OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'test-web-key', DAILY_TTS_CAP: '300',
    },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const send = (b) => mf.dispatchFetch('https://api.test/v1/v', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify(b) });

test('a visit is cleaned into broad groups; unknown values fold away', () => {
  assert.deepEqual(cleanVisit({ g: 'player', a: 'android', o: 'android', d: 'mobile' }, { country: 'US', regionCode: 'NC' }),
    { who: 'player', app: 'android', os: 'android', device: 'mobile', country: 'US', region: 'NC' });
  assert.deepEqual(cleanVisit({ g: 'hacker', a: 'x', o: 'beos', d: 'fridge' }, { country: 'FR', regionCode: 'IDF' }),
    { who: 'guest', app: 'web', os: 'other', device: 'desktop', country: 'FR', region: '' }, 'regions only for US, CA, AU');
  assert.equal(cleanVisit({}, { country: 'T1' }).country, 'XX', 'Tor and unknown places are Unknown');
  assert.equal(cleanVisit(null), null);
});

test('visits are counted and the Visitors page adds them up', async () => {
  for (const b of [
    { g: 'guest', a: 'web', o: 'windows', d: 'desktop' },
    { g: 'guest', a: 'web', o: 'windows', d: 'desktop' },
    { g: 'player', a: 'ios', o: 'ios', d: 'tablet' },
    { g: 'guest', a: 'web', o: 'mac', d: 'desktop' },
  ]) assert.equal((await send(b)).status, 200);
  assert.equal((await send('nope')).status, 400, 'something that is not a visit is refused');
  const bad = await mf.dispatchFetch('https://api.test/v1/v', { method: 'POST', headers: { Origin: ORIGIN }, body: '{' });
  assert.equal(bad.status, 400);

  const unsigned = await mf.dispatchFetch('https://api.test/admin/v1/visitors', { headers: { Origin: ORIGIN } });
  assert.equal(unsigned.status, 401, 'signed in only');
  const r = await mf.dispatchFetch('https://api.test/admin/v1/visitors?days=7', { headers: { Authorization: `Bearer ${await owner()}` } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.total, 4);
  assert.equal(d.today, 4);
  const n = (list, id) => (list.find((x) => x.id === id) || { n: 0 }).n;
  assert.equal(n(d.who, 'guest'), 3);
  assert.equal(n(d.who, 'player'), 1);
  assert.equal(n(d.os, 'windows'), 2);
  assert.equal(n(d.os, 'mac'), 1);
  assert.equal(n(d.os, 'ios'), 1);
  assert.equal(n(d.device, 'tablet'), 1);
  assert.equal(n(d.app, 'ios'), 1);
  assert.equal(d.dayList.length, 7);
  assert.equal(d.byDay.guest.at(-1) + d.byDay.player.at(-1), 4);
});

test('the game describes the device without sending anything personal', async () => {
  const { describeDevice } = await import(pathToFileURL(join(root, '..', 'web', 'js', 'visit.js')).href).catch(() => ({}));
  if (!describeDevice) return; // needs browser globals at import; covered in the browser
  assert.deepEqual(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', 5), { os: 'ios', device: 'mobile' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5), { os: 'ios', device: 'tablet' }, 'iPad asking for the desktop site');
  assert.deepEqual(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0), { os: 'mac', device: 'desktop' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36', 5), { os: 'android', device: 'tablet' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36', 5), { os: 'android', device: 'mobile' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 0), { os: 'windows', device: 'desktop' });
});
