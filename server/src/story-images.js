// Pictures for story beats and storyline submissions.
//
// The browser shrinks every picture and turns it into WebP, JPEG or PNG first
// (web/js/image-prep.js), so any format the browser can open works: JPG, PNG,
// GIF, WebP, AVIF, BMP, SVG, ICO, and HEIC or TIFF where the browser reads
// them. This Worker only stores those three safe formats, checked by their
// first bytes, never the original file.
//
// Public routes:
//   GET /v1/beat-images          the story beat pictures: [{ id, theme, stage, alt, width, height }]
//   GET /v1/beat-images/:id      one picture (cached for a long time: a changed picture gets a new id)
//
// Admin routes (beatImageRoutes, wired into admin.js):
//   GET  /admin/v1/beat-images                    every story beat picture, with its theme and stage
//   POST /admin/v1/beat-images                    { image, theme, stage, alt } upload one
//   POST /admin/v1/beat-images/:id/edit           { theme, stage, alt }
//   POST /admin/v1/beat-images/:id/delete
//   POST /admin/v1/story-submissions/:id/images/:imageId/use   { theme, stage, alt }
//        copy a picture a player sent with their storyline into the story beat pictures
import { json } from './http.js';
import { THEMES } from '../../engine/src/themes.js';

export const STAGES = ['any', 'early', 'middle', 'late'];
export const MAX_IMAGE_BYTES = 900_000;      // one picture, after the browser shrank it
export const MAX_SUBMISSION_IMAGES = 3;
const THEME_IDS = new Set(['default', ...THEMES.map((t) => t.id)]);
const MIMES = { webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' };

function startsWith(bytes, list, at = 0) { return list.every((b, i) => bytes[at + i] === b); }

// What the first bytes say the picture is: 'webp', 'jpeg', 'png' or null.
export function sniff(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

// Checks a picture sent as { dataUrl, width, height, name }. Returns
// { value: { mime, data, bytes, width, height, name } } or { error }.
export function checkImage(img) {
  if (!img || typeof img !== 'object' || typeof img.dataUrl !== 'string') return { error: 'No picture was sent.' };
  const m = img.dataUrl.match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) return { error: 'That picture could not be read. Try a JPG or PNG.' };
  const bytes = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) return { error: 'That picture is too big. Try a smaller one.' };
  let head;
  try { head = Uint8Array.from(atob(m[2].slice(0, 32)), (c) => c.charCodeAt(0)); } catch (e) { return { error: 'That picture could not be read.' }; }
  if (sniff(head) !== m[1]) return { error: 'That picture could not be read. Try a JPG or PNG.' };
  const size = (v) => (Number.isInteger(v) && v > 0 && v <= 4000 ? v : null);
  const name = typeof img.name === 'string' ? img.name.replace(/[\u0000-\u001f\u007f<>"]/g, '').trim().slice(0, 80) || null : null;
  return { value: { mime: MIMES[m[1]], data: m[2], bytes, width: size(img.width), height: size(img.height), name } };
}

const cleanAlt = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

export function checkPlacement({ theme, stage, alt } = {}, Refusal) {
  const t = theme || 'default';
  const s = stage || 'any';
  if (!THEME_IDS.has(t)) throw new Refusal(400, 'bad_theme', 'Pick a theme.');
  if (!STAGES.includes(s)) throw new Refusal(400, 'bad_stage', 'Pick a stage.');
  const a = cleanAlt(alt);
  if (!a) throw new Refusal(400, 'bad_alt', 'Say in a few words what the picture shows. Screen readers read it out.');
  return { theme: t, stage: s, alt: a };
}

// Saves the pictures a player sent with a storyline (already checked).
export async function saveSubmissionImages(env, submissionId, images, now = Date.now()) {
  if (!images.length) return;
  await env.DB.batch(images.map((i) => env.DB.prepare(`INSERT INTO story_submission_images (submission_id, name, mime, data, width, height, bytes, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(submissionId, i.name, i.mime, i.data, i.width, i.height, i.bytes, now)));
}

// The pictures with one entry, as data URLs, for the admin's entry view.
export async function submissionImages(env, submissionId) {
  const { results } = await env.DB.prepare(`SELECT i.id, i.name, i.mime, i.data, i.width, i.height, i.bytes,
    (SELECT b.id FROM beat_images b WHERE b.from_submission = i.submission_id AND b.data = i.data LIMIT 1) AS beatImage
    FROM story_submission_images i WHERE i.submission_id = ?1 ORDER BY i.id`).bind(Number(submissionId)).all();
  return results.map((r) => ({ id: r.id, name: r.name, width: r.width, height: r.height, bytes: r.bytes, src: `data:${r.mime};base64,${r.data}`, beatImage: r.beatImage || null }));
}

export async function deleteSubmissionImages(env, submissionId) {
  await env.DB.prepare('DELETE FROM story_submission_images WHERE submission_id = ?1').bind(Number(submissionId)).run();
}

const LIST = 'SELECT id, theme, stage, alt, width, height, bytes, from_submission AS fromSubmission, created_at AS createdAt, created_by AS createdBy FROM beat_images';

// Returns a Response for the public routes, or null for anything else.
export async function handleBeatImages(req, env, url) {
  if (req.method !== 'GET' || !url.pathname.startsWith('/v1/beat-images')) return null;
  if (url.pathname === '/v1/beat-images') {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
    let results = [];
    try { ({ results } = await env.DB.prepare('SELECT id, theme, stage, alt, width, height FROM beat_images ORDER BY id').all()); } catch (e) { /* table not made yet */ }
    return json(req, env, { images: results }, 200, { 'Cache-Control': 'public, max-age=300' });
  }
  const m = url.pathname.match(/^\/v1\/beat-images\/(\d{1,12})$/);
  if (!m) return null;
  const r = await env.DB.prepare('SELECT mime, data FROM beat_images WHERE id = ?1').bind(Number(m[1])).first();
  if (!r) return json(req, env, { error: 'not_found' }, 404);
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*',
    },
  });
}

export function beatImageRoutes(Refusal) {
  const insert = (env, p, img, who, now, fromSubmission = null) => env.DB.prepare(`INSERT INTO beat_images (theme, stage, alt, mime, data, width, height, bytes, from_submission, created_at, created_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`).bind(p.theme, p.stage, p.alt, img.mime, img.data, img.width, img.height, img.bytes, fromSubmission, now, who.actor).first();
  return [
    ['GET', /^beat-images$/, 'moderator', 'beat-images.view', async ({ env }) => {
      const { results } = await env.DB.prepare(`${LIST} ORDER BY theme, stage, id`).all();
      return { body: { images: results, themes: [{ id: 'default', name: 'Every theme' }, ...THEMES.map((t) => ({ id: t.id, name: t.name }))], stages: STAGES }, quiet: true };
    }],
    ['POST', /^beat-images$/, 'moderator', 'beat-images.add', async ({ env, body, who, now }) => {
      const place = checkPlacement(body, Refusal);
      const img = checkImage(body.image);
      if (img.error) throw new Refusal(400, 'bad_image', img.error);
      const row = await insert(env, place, img.value, who, now);
      return { body: { ok: true, id: row.id }, target: String(row.id), detail: { theme: place.theme, stage: place.stage } };
    }, { maxBody: Math.ceil(MAX_IMAGE_BYTES * 1.4) + 4_000 }],
    ['POST', /^beat-images\/(\d+)\/edit$/, 'moderator', 'beat-images.edit', async ({ env, body, params: [id] }) => {
      const place = checkPlacement(body, Refusal);
      const r = await env.DB.prepare('UPDATE beat_images SET theme = ?1, stage = ?2, alt = ?3 WHERE id = ?4').bind(place.theme, place.stage, place.alt, Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That picture is gone.');
      return { body: { ok: true }, target: id, detail: { theme: place.theme, stage: place.stage } };
    }],
    ['POST', /^beat-images\/(\d+)\/delete$/, 'moderator', 'beat-images.delete', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('DELETE FROM beat_images WHERE id = ?1').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That picture is gone.');
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^story-submissions\/(\d+)\/images\/(\d+)\/use$/, 'moderator', 'story-submissions.use-image', async ({ env, body, params: [sid, iid], who, now }) => {
      const r = await env.DB.prepare('SELECT mime, data, width, height, bytes FROM story_submission_images WHERE id = ?1 AND submission_id = ?2').bind(Number(iid), Number(sid)).first();
      if (!r) throw new Refusal(404, 'gone', 'That picture is gone.');
      const place = checkPlacement(body, Refusal);
      const row = await insert(env, place, r, who, now, Number(sid));
      return { body: { ok: true, id: row.id }, target: sid, detail: { image: Number(iid), beatImage: row.id } };
    }],
  ];
}
