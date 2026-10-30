// Media library tests: the admin route that lists the game's sounds, voices
// and celebrations, and the dashboard's copies of the game's sound and picture
// code (scripts/admin-media.mjs). Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'break-glass-token-for-media-tests';
let mf;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: 'https://thelogicgrid.com', ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com' },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { auth, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: 'https://thelogicgrid.com', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, body: json };
}

test('the Media library lists every theme, voice and celebration with its switch', async () => {
  const media = await call('/admin/v1/media', { auth: TOKEN });
  assert.equal(media.status, 200);
  const themes = (await call('/admin/v1/settings', { auth: TOKEN })).body.themes;
  assert.deepEqual(media.body.themes, themes);
  assert.ok(media.body.voices.gemini.f.includes('Kore') && media.body.voices.gemini.m.includes('Puck'));
  assert.ok(media.body.voiceStyles.every((v) => v.name && v.gemini.f && v.gemini.m));
  const fx = Object.fromEntries(media.body.celebrations.map((c) => [c.key, c.value]));
  assert.equal(fx.fireworks, false);
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'fireworks', value: true } });
  assert.equal((await call('/admin/v1/media', { auth: TOKEN })).body.celebrations.find((c) => c.key === 'fireworks').value, true);
  assert.ok((await call('/v1/config')).body.game.celebrations.includes('fireworks'));
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'fireworks', value: false } });
  assert.equal(media.body.serverVoices, false);
  assert.equal((await call('/admin/v1/media')).status, 401);
});

test('the Media library plays the game\'s own sounds and pictures (copies are up to date)', async () => {
  const { MEDIA_COPIES, mediaCopy } = await import('../../scripts/admin-media.mjs');
  for (const [copy, game, swaps] of MEDIA_COPIES) {
    assert.equal(readFileSync(join(root, '..', copy), 'utf8'), mediaCopy(game, swaps), `${copy} is out of date: run node scripts/admin-media.mjs`);
  }
  const { MOODS } = await import('../../admin/game-audio.js');
  const { THEME_EMOJI } = await import('../../admin/game-effects.js').catch(() => ({ THEME_EMOJI: null }));
  const ids = (await call('/admin/v1/media', { auth: TOKEN })).body.themes.map((t) => t.id);
  for (const id of ids) assert.ok(MOODS[id], `theme ${id} has music`);
  if (THEME_EMOJI) for (const id of ids) assert.ok(THEME_EMOJI[id], `theme ${id} has theme pictures`);
});
