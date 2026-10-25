// Admin dashboard tests: sign-in and roles, audit log, rate limits, settings
// that change the game, announcements, players and moderation. Run with
// `npm test` in server/.
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 40, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN,
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
const player = (uid) => signer.token({ sub: uid });

test('the dashboard is served with strict security headers', async () => {
  const r = await call('/admin/', { origin: null });
  assert.equal(r.status, 200);
  assert.match(r.text, /Logic Grid Admin/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const js = await call('/admin/admin.js', { origin: null });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await call('/admin/README.md', { origin: null })).status, 404);
  const cfg = await call('/admin/v1/client-config');
  assert.equal(cfg.body.firebaseApiKey, 'test-web-key');
});

test('only confirmed admins and the break-glass key get in, and refusals are logged', async () => {
  assert.equal((await call('/admin/v1/me')).status, 401);
  assert.equal((await call('/admin/v1/me', { auth: 'wrong-token' })).status, 401);
  const stranger = await call('/admin/v1/me', { auth: idToken('u-x', 'someone@example.com') });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, 'not_admin');
  const unverified = await call('/admin/v1/me', { auth: idToken('owner-uid', OWNER, false) });
  assert.equal(unverified.body.error, 'verify_email');
  const me = await call('/admin/v1/me', { auth: owner() });
  assert.deepEqual([me.status, me.body.role], [200, 'owner']);
  const glass = await call('/admin/v1/me', { auth: TOKEN });
  assert.deepEqual([glass.body.email, glass.body.role], ['break-glass token', 'owner']);
  // No CORS: the game's site cannot read admin replies.
  assert.equal(me.headers.get('access-control-allow-origin'), null);
  const { results } = await db.prepare('SELECT actor, action, status FROM admin_audit ORDER BY id').all();
  assert.ok(results.some((r) => r.actor === 'unknown' && r.status === 401));
  assert.ok(results.some((r) => r.actor === OWNER && r.action === 'me' && r.status === 200));
  assert.ok(results.some((r) => r.actor === 'break-glass token'));
});

test('roles: the owner adds admins; each role only reaches its own tools', async () => {
  assert.equal((await call('/admin/v1/admins', { auth: owner(), body: { email: 'Mod@Example.com', role: 'moderator' } })).status, 200);
  assert.equal((await call('/admin/v1/admins', { auth: owner(), body: { email: 'view@example.com', role: 'viewer' } })).status, 200);
  assert.equal((await call('/admin/v1/admins', { auth: owner(), body: { email: 'x@example.com', role: 'owner' } })).status, 400);
  const mod = idToken('mod-uid', 'mod@example.com');
  const viewer = idToken('view-uid', 'view@example.com');
  assert.equal((await call('/admin/v1/me', { auth: mod })).body.role, 'moderator');
  assert.equal((await call('/admin/v1/analytics', { auth: viewer })).status, 200);
  assert.equal((await call('/admin/v1/players', { auth: viewer })).status, 403);
  assert.equal((await call('/admin/v1/players', { auth: mod })).status, 200);
  assert.equal((await call('/admin/v1/settings', { auth: mod, body: { key: 'races_enabled', value: false } })).status, 403);
  assert.equal((await call('/admin/v1/admins', { auth: mod })).status, 403);
  const list = await call('/admin/v1/admins', { auth: owner() });
  assert.equal(list.body.owner, OWNER);
  assert.deepEqual(list.body.admins.map((a) => a.email).sort(), ['mod@example.com', 'view@example.com']);
  assert.equal((await call('/admin/v1/admins/remove', { auth: owner(), body: { email: 'view@example.com' } })).status, 200);
  assert.equal((await call('/admin/v1/me', { auth: viewer })).status, 403);
});

test('settings switch game features off and back on', async () => {
  const off = await call('/admin/v1/settings', { auth: owner(), body: { key: 'races_enabled', value: false } });
  assert.equal(off.status, 200);
  assert.equal((await call('/v1/profile', { auth: player('p-race'), method: 'PUT', body: { screenName: 'Racer One' } })).status, 200);
  const race = await call('/v1/races/find', { auth: player('p-race'), body: {} });
  assert.deepEqual([race.status, race.body.error], [503, 'switched_off']);
  assert.equal((await call('/v1/config')).body.features.races, false);
  await call('/admin/v1/settings', { auth: owner(), body: { key: 'races_enabled', value: true } });
  assert.equal((await call('/v1/races/find', { auth: player('p-race'), body: {} })).body.error, 'no_open_races');

  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'daily_tts_cap', value: 5000 } })).status, 400);
  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'daily_tts_cap', value: 120 } })).status, 200);
  assert.equal((await call('/v1/health?deep=1')).body.voiceCap, 120);

  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'disabled_themes', value: ['no-such-theme'] } })).status, 400);
  const themes = (await call('/admin/v1/settings', { auth: owner() })).body.themes;
  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'disabled_themes', value: [themes[0].id] } })).status, 200);
  assert.deepEqual((await call('/v1/config')).body.disabledThemes, [themes[0].id]);

  await call('/admin/v1/settings', { auth: owner(), body: { key: 'blocked_words', value: ['grumble'] } });
  const name = await call('/v1/profile', { auth: player('p-word'), method: 'PUT', body: { screenName: 'Big Grumble' } });
  assert.equal(name.body.error, 'name_blocked');

  const audit = await call('/admin/v1/audit', { auth: owner() });
  const change = audit.body.entries.find((e) => e.action === 'settings.change' && e.target === 'daily_tts_cap' && e.status === 200);
  assert.deepEqual(change.detail, { from: 300, to: 120 });
});

test('announcements show in the game between their start and end', async () => {
  const made = await call('/admin/v1/announcements', { auth: owner(), body: { text: 'New themes this weekend!', level: 'info' } });
  assert.equal(made.status, 200);
  await call('/admin/v1/announcements', { auth: owner(), body: { text: 'Later', startsAt: Date.now() + 3600_000 } });
  let cfg = (await call('/v1/config')).body;
  assert.deepEqual(cfg.announcements.map((a) => a.text), ['New themes this weekend!']);
  assert.equal((await call(`/admin/v1/announcements/${made.body.id}/end`, { auth: owner(), body: {} })).status, 200);
  cfg = (await call('/v1/config')).body;
  assert.equal(cfg.announcements.length, 0);
  assert.equal((await call('/admin/v1/announcements', { auth: owner(), body: { text: 'x' } })).status, 400);
});

test('players: rename, ban, reset scores and delete', async () => {
  const uid = 'p-bad';
  assert.equal((await call('/v1/profile', { auth: player(uid), method: 'PUT', body: { screenName: 'Meanie' } })).status, 200);
  await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES (?1, 's1', 'solo', 'easy', 48, 60000, 0, 0, 30, ?2)").bind(uid, Date.now()).run();
  await db.prepare('INSERT INTO sync_users (user_id, rev, created_at) VALUES (?1, 1, ?2)').bind(uid, Date.now()).run();
  await db.prepare("INSERT INTO sync_records (user_id, kind, key, data, updated_at, rev) VALUES (?1, 'save', 'a', '{\"secret\":1}', 1, 1)").bind(uid).run();

  const found = await call('/admin/v1/players?q=mean', { auth: owner() });
  assert.equal(found.body.players[0].uid, uid);
  const detail = await call(`/admin/v1/players/${uid}`, { auth: owner() });
  assert.equal(detail.body.account.saves, 1);
  assert.ok(!JSON.stringify(detail.body).includes('secret'), 'saved puzzles are counted, never shown');

  const names = await call('/admin/v1/names?status=pending', { auth: owner() });
  assert.ok(names.body.names.some((n) => n.uid === uid));
  const renamed = await call(`/admin/v1/players/${uid}/rename`, { auth: owner(), body: { reset: true } });
  assert.match(renamed.body.screenName, /^Player [A-Z2-9]{4}$/);
  assert.ok(!(await call('/admin/v1/names?status=pending', { auth: owner() })).body.names.some((n) => n.uid === uid));

  assert.equal((await call('/v1/scoreboard?period=all')).body.rows.length > 0, true);
  assert.equal((await call(`/admin/v1/players/${uid}/ban`, { auth: owner(), body: { days: 7, reason: 'rude' } })).status, 200);
  const blocked = await call('/v1/scores', { auth: player(uid), body: { storyId: 's2', tier: 'easy', categories: 3, items: 4, elapsedMs: 60000, hints: 0, checks: 0 } });
  assert.equal(blocked.body.error, 'banned');
  assert.ok(!(await call('/v1/scoreboard?period=all')).body.rows.some((r) => r.name === renamed.body.screenName));
  assert.equal((await call('/admin/v1/players?filter=banned', { auth: owner() })).body.players[0].banned, 1);
  await call(`/admin/v1/players/${uid}/unban`, { auth: owner(), body: {} });

  const reset = await call(`/admin/v1/players/${uid}/reset-scores`, { auth: owner(), body: { period: 'all' } });
  assert.equal(reset.body.removed, 1);

  assert.equal((await call(`/admin/v1/players/${uid}/delete`, { auth: owner(), body: { confirm: 'nope' } })).status, 400);
  assert.equal((await call(`/admin/v1/players/${uid}/delete`, { auth: owner(), body: { confirm: uid } })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE user_id = ?1').bind(uid).first()).n, 0);
  assert.equal((await call('/v1/sync', { auth: player(uid), body: { since: 0 } })).body.error, 'account_deleted');
});

test('analytics, storage and story review', async () => {
  await db.prepare("INSERT INTO plays (day, platform, tier, theme, outcome, rating) VALUES (date('now'), 'web', 'easy', 'mystery', 'solved', 5)").run();
  await db.prepare("INSERT INTO parts (key, theme, kind, value, source, submitted) VALUES ('mystery|places|x', 'mystery', 'places', '\"the old mill\"', 'mine', '2026-10-25')").run();
  const a = await call('/admin/v1/analytics?days=7', { auth: owner() });
  assert.equal(a.status, 200);
  assert.equal(a.body.dayList.length, 7);
  assert.equal(a.body.games.byTheme[0].id, 'mystery');
  assert.equal(a.body.review.parts.pending, 1);
  const s = await call('/admin/v1/storage', { auth: owner() });
  assert.ok(s.body.tables.find((t) => t.table === 'plays').rows >= 1);
  assert.equal((await call('/admin/v1/usage', { auth: owner() })).body.configured, false);
  const parts = await call('/admin/v1/parts', { auth: owner() });
  assert.equal(parts.body.parts[0].value, 'the old mill');
  assert.equal((await call('/admin/v1/parts/review', { auth: owner(), body: { key: 'mystery|places|x', status: 'approved' } })).status, 200);
  assert.equal((await call('/admin/v1/parts/review', { auth: owner(), body: { key: 'gone', status: 'approved' } })).status, 404);
});

test('backups: the archive page, a download, and the viewer page', async () => {
  const status = await call('/admin/v1/archive', { auth: TOKEN });
  assert.equal(status.status, 200);
  assert.equal(status.body.setUp.binding, false, 'no email binding in tests');
  assert.equal(status.body.emailOn, false, 'the weekly email starts off');
  assert.equal(status.body.removeOn, false, 'removal starts off');
  assert.ok(status.body.plan.some((p) => p.table === 'plays'));
  assert.ok(!status.body.plan.some((p) => ['scores', 'players', 'sync_records', 'bans'].includes(p.table)));

  const run = await call('/admin/v1/archive/run', { auth: TOKEN, body: {} });
  assert.equal(run.body.status, 'not_set_up');

  const dl = await mf.dispatchFetch('https://api.test/admin/v1/archive/download', { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/zip');
  const bytes = new Uint8Array(await dl.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const page = await call('/admin/archive.html', { origin: null });
  assert.equal(page.status, 200);
  assert.match(page.text, /Archive viewer/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('the older token pages still work and are audited', async () => {
  const r = await call('/admin/errors', { auth: TOKEN });
  assert.equal(r.status, 200);
  assert.equal((await call('/admin/errors', { auth: 'nope' })).status, 401);
  const rows = (await db.prepare("SELECT actor, status FROM admin_audit WHERE action = 'legacy GET /admin/errors'").all()).results;
  assert.deepEqual(rows.map((x) => [x.actor, x.status]), [['break-glass token', 200], ['unknown', 401]]);
});

test('each admin is rate limited', async () => {
  const token = idToken('mod-uid', 'mod@example.com');
  let limited = false;
  for (let i = 0; i < 60 && !limited; i++) limited = (await call('/admin/v1/me', { auth: token })).status === 429;
  assert.ok(limited);
});
