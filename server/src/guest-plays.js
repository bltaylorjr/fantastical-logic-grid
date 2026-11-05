// Guest puzzles: how many new puzzles a guest (not signed in) may start each
// day, counted here so clearing the browser does not reset it.
//
//   POST /v1/guest-play  { d: device id, take: true|false }
//        take: false  how many are left today, nothing used
//        take: true   use one if any are left
//        -> { ok, left, limit }   ok: false when today's are used up
//
// Two counts, both by day in the connection's own time zone (from
// Cloudflare), so the day turns over at the player's midnight:
//   - the device (its random id, web/js/guest-limit.js): guest_daily_limit
//   - the internet connection: guest_network_daily_limit, for all guests on it
//     together, so a fresh browser on the same connection gets no more than that
// Only one-way hashes are stored (the address with a salt that changes every
// day), and rows go after 3 days (upkeep.js). Signed-in players never call this.
// The device decides when to ask; the game builds puzzles on the device, so
// this is a gate for honest browsers, not a lock on the engine.
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// The calendar day (YYYY-MM-DD) in a time zone, or US Eastern if it is unknown.
export function localDay(timeZone, now = Date.now()) {
  const fmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  try { return fmt(timeZone || 'America/New_York'); } catch (e) { return fmt('America/New_York'); }
}

// What a guest may do, from the two counts and the two limits (0 = no limit).
export function decide({ device, network }, { limit, networkLimit }) {
  if (!limit) return { ok: true, left: null, limit: 0 };
  let left = Math.max(0, limit - device);
  if (networkLimit) left = Math.min(left, Math.max(0, networkLimit - network));
  return { ok: left > 0, left, limit };
}

export async function handleGuestPlays(req, env, url) {
  if (url.pathname !== '/v1/guest-play' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: await sha256(`flg-gp|${ip}`) })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  let body;
  try { body = JSON.parse(await readText(req, 300)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  if (!body || !DEVICE_ID.test(String(body.d || ''))) return json(req, env, { error: 'bad_request' }, 400);

  const s = await getSettings(env);
  const limits = { limit: s.guest_daily_limit, networkLimit: s.guest_network_daily_limit };
  if (!limits.limit) return json(req, env, { ok: true, left: null, limit: 0 });
  const day = localDay(req.cf && req.cf.timezone);
  const dev = `d:${await sha256(`flg-guest-device|${body.d}`)}`;
  const net = `n:${await sha256(`flg-guest-net|${day}|${ip}|${env.GUEST_SALT || ''}`)}`;
  const { results } = await env.DB.prepare('SELECT who, n FROM guest_plays WHERE day = ?1 AND who IN (?2, ?3)').bind(day, dev, net).all();
  const count = (who) => (results.find((r) => r.who === who) || { n: 0 }).n;
  const now = decide({ device: count(dev), network: count(net) }, limits);
  if (!body.take || !now.ok) return json(req, env, now);
  const add = 'INSERT INTO guest_plays (day, who, n) VALUES (?1, ?2, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1';
  await env.DB.batch([env.DB.prepare(add).bind(day, dev), env.DB.prepare(add).bind(day, net)]);
  return json(req, env, { ok: true, left: now.left - 1, limit: now.limit });
}
