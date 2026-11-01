// Story beat pictures and pictures sent with storylines (src/story-images.js).
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { checkImage, sniff } from '../src/story-images.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
const OWNER = 'owner@example.com';
const DAY = 24 * 3600_000;
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

const token = (sub, email) => signer.token({ sub, email, email_verified: true });
async function call(path, { auth, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${await auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}


const FORM = {
  kind: 'storyline', theme: 'mystery', title: 'The Midnight Gala', pitch: 'Who stole the tiara?', setting: "A seaside mansion, New Year's Eve, 1925",
  characters: [{ name: 'Lady Ashford', trait: 'Nervous', role: 'Main' }, { name: 'Mr. Pike', role: 'Supporting' }, { name: 'Nora' }, { name: 'Felix' }],
  goal: 'find out which guest took the tiara', clues: 'Rooms: Library, Kitchen, Garden, Ballroom. Drinks: Tea, Punch, Cider, Lemonade. the butler wasnt in the library.',
  beat: 'Beginning: the lights go out at midnight.', tone: 'Mysterious', difficulty: 'medium', reward: { animation: 'Fireworks' }, credit: 'B. Taylor', consent: true,
};

// A 1×1 PNG and a tiny WebP, as the browser would send them.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const WEBP = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const OWNER_TOKEN = () => token('owner-uid', OWNER);

test('the admin and the game use the same picture code', () => {
  assert.equal(readFileSync(join(root, '..', 'admin', 'image-prep.js'), 'utf8'), readFileSync(join(root, '..', 'web', 'js', 'image-prep.js'), 'utf8'));
});

test('only real WebP, JPEG and PNG pictures are kept', () => {
  assert.equal(checkImage({ dataUrl: PNG, width: 1, height: 1 }).value.mime, 'image/png');
  assert.equal(checkImage({ dataUrl: WEBP }).value.mime, 'image/webp');
  assert.ok(checkImage({ dataUrl: PNG.replace('image/png', 'image/webp') }).error, 'the label must match the bytes');
  assert.ok(checkImage({ dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }).error, 'no SVG (it can hold scripts)');
  assert.ok(checkImage({ dataUrl: `data:image/png;base64,${'A'.repeat(1_300_000)}` }).error, 'too big');
  assert.ok(checkImage(null).error);
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
});

test('story beat pictures: upload, list for the game, serve, edit and delete', async () => {
  const owner = OWNER_TOKEN();
  const none = await call('/admin/v1/beat-images', { auth: owner, body: { theme: 'mystery', stage: 'early', alt: '', image: { dataUrl: PNG } } });
  assert.equal(none.status, 400, 'a description is needed');
  const bad = await call('/admin/v1/beat-images', { auth: owner, body: { theme: 'nope', stage: 'early', alt: 'A key', image: { dataUrl: PNG } } });
  assert.equal(bad.status, 400);
  const up = await call('/admin/v1/beat-images', { auth: owner, body: { theme: 'mystery', stage: 'early', alt: 'A brass key', image: { dataUrl: PNG, width: 1, height: 1, name: 'key.png' } } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const anon = await call('/admin/v1/beat-images', { body: { theme: 'mystery', stage: 'early', alt: 'x', image: { dataUrl: PNG } } });
  assert.notEqual(anon.status, 200, 'players cannot upload');

  const list = await call('/v1/beat-images');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.images.map((i) => [i.theme, i.stage, i.alt]), [['mystery', 'early', 'A brass key']]);
  assert.equal(list.body.images[0].data, undefined, 'the list does not carry the pictures');

  const pic = await mf.dispatchFetch(`https://api.test/v1/beat-images/${up.body.id}`);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('Content-Type'), 'image/png');
  assert.match(pic.headers.get('Cache-Control'), /immutable/);
  assert.equal((await pic.arrayBuffer()).byteLength, 70);

  const ed = await call(`/admin/v1/beat-images/${up.body.id}/edit`, { auth: owner, body: { theme: 'default', stage: 'any', alt: 'A key' } });
  assert.equal(ed.status, 200);
  const admin = (await call('/admin/v1/beat-images', { auth: owner })).body;
  assert.equal(admin.images[0].theme, 'default');
  assert.ok(admin.themes.some((t) => t.id === 'mystery'));
  const del = await call(`/admin/v1/beat-images/${up.body.id}/delete`, { auth: owner, body: {} });
  assert.equal(del.status, 200);
  assert.equal((await call('/v1/beat-images')).body.images.length, 0);
});

test('a storyline with pictures: saved with the entry, shown to the team, copied into story beats', async () => {
  const owner = OWNER_TOKEN();
  const four = await call('/v1/story-submissions', { body: { ...FORM, images: [PNG, PNG, PNG, PNG].map((dataUrl) => ({ dataUrl })) } });
  assert.equal(four.status, 400);
  assert.ok(four.body.errors.images);
  const fake = await call('/v1/story-submissions', { body: { ...FORM, images: [{ dataUrl: 'data:image/png;base64,PHN2Zz48c2NyaXB0Pg==' }] } });
  assert.equal(fake.status, 400);
  const r = await call('/v1/story-submissions', { body: { ...FORM, images: [{ dataUrl: PNG, width: 1, height: 1, name: 'tiara.png' }, { dataUrl: WEBP, name: 'gala.webp' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const list = (await call('/admin/v1/story-submissions?q=Midnight', { auth: owner })).body;
  assert.equal(list.items.find((i) => i.id === r.body.id).images, 2);
  const entry = (await call(`/admin/v1/story-submissions/${r.body.id}`, { auth: owner })).body;
  assert.deepEqual(entry.images.map((i) => i.name), ['tiara.png', 'gala.webp']);
  assert.match(entry.images[0].src, /^data:image\/png;base64,/);
  assert.equal(entry.images[0].beatImage, null);

  const use = await call(`/admin/v1/story-submissions/${r.body.id}/images/${entry.images[0].id}/use`, { auth: owner, body: { theme: 'mystery', stage: 'late', alt: 'The missing tiara' } });
  assert.equal(use.status, 200, JSON.stringify(use.body));
  const again = (await call(`/admin/v1/story-submissions/${r.body.id}`, { auth: owner })).body;
  assert.equal(again.images[0].beatImage, use.body.id);
  const beats = (await call('/v1/beat-images')).body.images;
  assert.ok(beats.some((b) => b.id === use.body.id && b.stage === 'late'));
  const row = await db.prepare('SELECT from_submission FROM beat_images WHERE id = ?1').bind(use.body.id).first();
  assert.equal(row.from_submission, r.body.id);

  // Deleting the entry removes its pictures; the copy in story beats stays.
  assert.equal((await call(`/admin/v1/story-submissions/${r.body.id}/delete`, { auth: owner, body: {} })).status, 200);
  const left = await db.prepare('SELECT COUNT(*) AS n FROM story_submission_images WHERE submission_id = ?1').bind(r.body.id).first();
  assert.equal(left.n, 0);
  assert.ok((await call('/v1/beat-images')).body.images.some((b) => b.id === use.body.id));
});

// ---------------------------------------------------------------- the Puzzle Wizard
import { checkSound, sniffSound } from '../src/story-sounds.js';
// A tiny WAV header and an ID3-tagged MP3 start, as the browser reads them.
const WAV = `data:audio/wav;base64,${btoa('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00')}`;
const MP3 = `data:audio/mpeg;base64,${btoa('ID3\x04\x00\x00\x00\x00\x00\x00extra')}`;

test('only real sound files are kept with a wizard puzzle', () => {
  assert.equal(checkSound({ dataUrl: WAV, name: 'tada.wav', use: true }).value.mime, 'audio/wav');
  assert.equal(checkSound({ dataUrl: MP3 }).value.mime, 'audio/mpeg');
  assert.ok(checkSound({ dataUrl: PNG }).error, 'a picture is not a sound');
  assert.equal(sniffSound(new Uint8Array([0x4f, 0x67, 0x67, 0x53])), 'ogg');
  assert.equal(checkSound({ dataUrl: WAV, use: false, credit: true }).value.credit, false, 'no credit asked for a file the team may not use');
});

const WIZARD = {
  game: 'fantastical', title: 'The Midnight Gala', story: 'The lights went out at the gala and the tiara vanished from its velvet case.', difficulty: 'medium',
  cast: { one: 'guest', many: 'guests' }, names: ['Ada', 'Ben', 'Cora', 'Dev'],
  categories: [{ name: 'Room', items: 'Library, Kitchen, Garden, Attic' }, { name: 'Arrival', items: '7:00 PM, 7:15 PM, 7:30 PM, 7:45 PM', order: 'earlier' }],
  answerMode: 'auto', credit: { as: 'real', real: 'Bobby Taylor' }, consent: true,
  files: [{ kind: 'image', name: 'ballroom.png', purpose: 'scene', use: true, credit: true, creditAs: 'real' }, { kind: 'sound', name: 'tada.wav', purpose: 'solved', use: true, credit: false }],
};

test('a Puzzle Wizard puzzle: checked, saved with its picture and sound, shown to the team', async () => {
  const missing = await call('/v1/story-submissions', { body: { kind: 'puzzle', entry: { ...WIZARD, title: '' } } });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.errors.title, 'a puzzle with no title is refused');
  const badSound = await call('/v1/story-submissions', { body: { kind: 'puzzle', entry: WIZARD, files: [{ dataUrl: PNG }, { dataUrl: PNG }] } });
  assert.equal(badSound.status, 400);
  assert.ok(badSound.body.errors.file1, 'a picture sent as a sound is refused');
  const r = await call('/v1/story-submissions', { body: { kind: 'puzzle', entry: WIZARD, seed: 'abc123', credit: 'Bobby Taylor', files: [{ dataUrl: PNG, width: 1, height: 1 }, { dataUrl: WAV }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const owner = OWNER_TOKEN();
  const list = (await call('/admin/v1/story-submissions?kind=puzzle', { auth: owner })).body;
  const row = list.items.find((x) => x.id === r.body.id);
  assert.ok(row && row.images === 1 && row.sounds === 1, 'the list counts the picture and the sound');
  assert.match(row.pitch, /Puzzle Wizard: The Fantastical Logic Grid/);
  const entry = (await call(`/admin/v1/story-submissions/${r.body.id}`, { auth: owner })).body;
  assert.equal(entry.credit, 'Bobby Taylor');
  assert.equal(entry.sounds[0].purpose, 'solved');
  assert.ok(entry.copy.some(([label, v]) => label === 'Game' && v === 'The Fantastical Logic Grid'), 'the team sees which game it is for');
  assert.ok(entry.copy.some(([label, v]) => label === 'Picture 1' && /may be used, credit as real name/.test(v)), 'the team sees how the author wants the picture used and credited');
  const del = await call(`/admin/v1/story-submissions/${r.body.id}/delete`, { auth: owner, body: {} });
  assert.equal(del.status, 200);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM story_submission_sounds WHERE submission_id = ?1').bind(r.body.id).first();
  assert.equal(n, 0, 'deleting the entry deletes its sounds');
});
