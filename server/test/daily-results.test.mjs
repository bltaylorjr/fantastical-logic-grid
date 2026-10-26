// Daily puzzle numbers for everyone: run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { summarize } from '../src/daily-results.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
let mf;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = async (path, body) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const today = new Date().toISOString().slice(0, 10);

test('starts, solves and reveals add up to the day\'s numbers', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await call(`/v1/daily/${today}/start`, {})).status, 200);
  await call(`/v1/daily/${today}/result`, { elapsedMs: 4 * 60_000 + 10_000 });
  await call(`/v1/daily/${today}/result`, { elapsedMs: 9 * 60_000 });
  await call(`/v1/daily/${today}/result`, { elapsedMs: 60_000, revealed: true });
  const { body } = await call(`/v1/daily/${today}/stats`);
  assert.equal(body.started, 4);
  assert.equal(body.solved, 2);
  assert.equal(body.revealed, 1);
  assert.equal(body.solvedPct, 50);
  assert.equal(body.medianMs, 4.5 * 60_000);
  assert.deepEqual(body.minutes, [[4, 1], [9, 1]]);
});

test('old days, far-off days and bad times are refused', async () => {
  assert.equal((await call('/v1/daily/2020-01-01/start', {})).body.error, 'bad_day');
  assert.equal((await call(`/v1/daily/${today}/result`, { elapsedMs: 10 })).body.error, 'bad_time');
});

test('the summary never shows more solvers than players', () => {
  const s = summarize([{ bucket: 3, n: 2 }, { bucket: -1, n: 1 }]);
  assert.equal(s.started, 2);
  assert.equal(s.solvedPct, 100);
  assert.equal(summarize([]).medianMs, null);
});
