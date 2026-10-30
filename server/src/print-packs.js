// Printable puzzle packs: a signed-in player can print a small pack of
// brand-new puzzles (each with its answer key), a few times each period. The
// game writes the puzzles on the player's device, as it does for every
// puzzle; the Worker only keeps count, so the limits hold across devices.
//
//   GET  /v1/print-packs                    signed in: the player's allowance
//   POST /v1/print-packs { stories: [id] }  signed in: count one pack of these
//                                           stories, or say why not
//
// Limits, all in the admin dashboard (Settings > Printable puzzle packs):
// print_packs_enabled, print_pack_size (puzzles in one pack, most),
// print_packs_per_period and print_pack_period_days (packs in a rolling
// window of that many days). A story already in one of the player's packs is
// refused, so every printed puzzle is new to them.
import { verifyIdToken, AuthError } from './auth.js';
import { getSettings } from './settings.js';
import { json, readText, TooLarge } from './http.js';

const DAY = 24 * 3600_000;
const STORY_ID = /^[\w:/|.,=+-]{1,300}$/;
const bearer = (req) => (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1] || '';

// { on, size, perPeriod, periodDays, used, left, nextAt }: nextAt is when the
// oldest pack in the window drops out (null while packs are left).
export async function allowance(env, uid, now = Date.now()) {
  const s = await getSettings(env, now);
  const since = now - s.print_pack_period_days * DAY;
  const { results } = await env.DB.prepare('SELECT at FROM print_packs WHERE uid = ?1 AND at > ?2 ORDER BY at').bind(uid, since).all();
  const used = results.length;
  const left = Math.max(0, s.print_packs_per_period - used);
  const nextAt = left > 0 || !used ? null : results[used - s.print_packs_per_period].at + s.print_pack_period_days * DAY;
  return { on: !!s.print_packs_enabled, size: s.print_pack_size, perPeriod: s.print_packs_per_period, periodDays: s.print_pack_period_days, used, left, nextAt };
}

export async function handlePrintPacks(req, env, url) {
  if (url.pathname !== '/v1/print-packs') return null;
  if (req.method !== 'GET' && req.method !== 'POST') return json(req, env, { error: 'not_found' }, 404);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  let user;
  try { user = await verifyIdToken(bearer(req), env); } catch (e) {
    if (e instanceof AuthError || !bearer(req)) return json(req, env, { error: 'sign_in' }, 401);
    throw e;
  }
  const now = Date.now();
  const a = await allowance(env, user.uid, now);
  if (req.method === 'GET') return json(req, env, a);

  let b;
  try { b = JSON.parse(await readText(req, 20_000)); } catch (e) {
    return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400);
  }
  if (!a.on) return json(req, env, { ...a, error: 'off', message: 'Printable puzzle packs are switched off for now.' }, 403);
  const stories = Array.isArray(b?.stories) ? b.stories : null;
  if (!stories || !stories.length || stories.some((x) => typeof x !== 'string' || !STORY_ID.test(x)) || new Set(stories).size !== stories.length) {
    return json(req, env, { error: 'bad_request' }, 400);
  }
  if (stories.length > a.size) return json(req, env, { ...a, error: 'too_many', message: `A pack can have up to ${a.size} puzzles.` }, 403);
  if (!a.left) return json(req, env, { ...a, error: 'limit', message: 'You have printed all your packs for now.' }, 429);
  const db = env.DB;
  const seen = await db.prepare(`SELECT story_id FROM print_pack_stories WHERE uid = ?1 AND story_id IN (${stories.map((_, i) => `?${i + 2}`).join(',')})`)
    .bind(user.uid, ...stories).all();
  if (seen.results.length) return json(req, env, { ...a, error: 'used', stories: seen.results.map((r) => r.story_id) }, 409);
  await db.batch([
    db.prepare('INSERT INTO print_packs (uid, at, count) VALUES (?1, ?2, ?3)').bind(user.uid, now, stories.length),
    ...stories.map((id) => db.prepare('INSERT OR IGNORE INTO print_pack_stories (uid, story_id, at) VALUES (?1, ?2, ?3)').bind(user.uid, id, now)),
  ]);
  return json(req, env, { ok: true, ...(await allowance(env, user.uid, now)) });
}

// Packs printed in the last `days` days, for the admin dashboard.
export async function printPackTotals(env, days = 7, now = Date.now()) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS packs, COALESCE(SUM(count), 0) AS puzzles, COUNT(DISTINCT uid) AS players FROM print_packs WHERE at > ?1').bind(now - days * DAY).first();
  return { packs: r.packs, puzzles: r.puzzles, players: r.players };
}

export const deletePrintPackStatements = (env, uid) => [
  env.DB.prepare('DELETE FROM print_packs WHERE uid = ?1').bind(uid),
  env.DB.prepare('DELETE FROM print_pack_stories WHERE uid = ?1').bind(uid),
];
