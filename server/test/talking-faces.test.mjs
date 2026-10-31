// Talking faces (pictures.js, kind 'face'): a character's lifelike photo is
// painted once, in the photo style, kept in D1 for every player, and served
// from there without counting toward the day's pictures again. The talking_faces
// switch turns it off. Workers AI and D1 are stand-ins (D1 is node:sqlite with
// the real migrations).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePictures } from '../src/pictures.js';
import { clearSettingsCache } from '../src/settings.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    first: async () => db.prepare(sql).get(...args.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : v))) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : v))),
  });
  return { prepare: (sql) => wrap(sql), raw: db };
}

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {} } };

test('a face is painted once in the photo style, kept for everyone, and can be switched off', async () => {
  const DB = d1();
  const asked = [];
  const env = {
    DB, ALLOWED_ORIGINS: 'https://thelogicgrid.com',
    AI: { run: async (model, input) => { asked.push(input.prompt); return { image: Buffer.from('fake jpeg').toString('base64') }; } },
  };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const ask = (body) => handlePictures(new Request('https://api.test/v1/picture', { method: 'POST', body: JSON.stringify(body) }), env, ctx, new URL('https://api.test/v1/picture'));
  const prompt = 'A woman in her thirties named Ada, whose personality is bookish. A closed-mouth expression that suits them.';

  const first = await ask({ kind: 'face', prompt });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Cache'), 'miss');
  assert.equal(Buffer.from(await first.arrayBuffer()).toString(), 'fake jpeg');
  assert.match(asked[0], /^Photorealistic/, 'faces use the photo style, not the storybook one');
  assert.match(asked[0], /lips gently closed/);
  await Promise.all(waits);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM faces').get().n, 1, 'the face is kept in D1');

  const again = await ask({ kind: 'face', prompt });
  assert.equal(again.headers.get('X-Cache'), 'hit');
  assert.equal(Buffer.from(await again.arrayBuffer()).toString(), 'fake jpeg');
  assert.equal(asked.length, 1, 'a kept face is never painted again');
  assert.equal(DB.raw.prepare("SELECT count FROM usage WHERE name = 'pictures'").get().count, 1, 'only the first painting counts toward the day');

  DB.raw.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('talking_faces', 'false', 0, 'test')").run();
  clearSettingsCache();
  const off = await ask({ kind: 'face', prompt });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error, 'switched_off');
});
