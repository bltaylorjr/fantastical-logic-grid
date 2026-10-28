// App keys for the Windows and Android apps. The website stays free and needs
// no key. An app asks for a key the first time it opens, activates it here
// once (which uses one of the key's device seats) and gets back a signed pass.
// Bobby's rule (2026-10-27): a key installs on one computer or phone, or on two
// when an admin allows it on request, and it can be used for at most two
// downloads from the website; after that the player needs a new key. Every key,
// its installs and its downloads are listed in the admin's App keys section.
// A free key a player asks for on the website works only once an admin
// approves it there (Bobby, 2026-10-28).
// The app checks that pass's signature itself with the public key built into
// it, so it keeps working offline; when online it asks here about once a day
// whether the key still works, so a key an admin cancels stops working.
//
// The pass is signed with the LICENSE_SIGNING_KEY Cloudflare secret (an
// ECDSA P-256 private key as JSON). Until that secret is set the apps do not
// ask for a key at all, so nobody is locked out before keys can be made.
//
//   POST /v1/license/activate  { key, device, platform }  a pass for this device
//   POST /v1/license/check     { pass }   does the key behind this pass still work
//   POST /v1/license/download  { key }    a website download (counts toward the key's 2 downloads)
//   GET  /v1/license/mine                 the signed-in player's own key, if they have one
//   POST /v1/license/mine                 asks for one, when Settings > App keys allows; it waits for an admin's approval
//   GET  /admin/v1/licenses?q=&status=    every key with its devices (admin)
//   POST /admin/v1/licenses               { count, label?, email?, maxDevices?, until? } (admin)
//   POST /admin/v1/licenses/:id/(approve|decline|revoke|restore|devices) (admin; devices sets 1 or 2)
//   POST /admin/v1/licenses/:id/devices/:device/remove   frees a seat (admin)
import { json, readText, TooLarge } from './http.js';
import { AuthError } from './auth.js';
import { isDeleted } from './sync.js';
import { getSettings } from './settings.js';
import { perksFor, cleanEmail } from './supporters.js';

export const PLATFORMS = ['desktop', 'android', 'ios'];
// No 0, 1, I or O, so a key read out or copied by hand cannot be mistyped that way.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const GROUPS = 4;
const GROUP = 5;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_BODY = 4096;
// The most installs and website downloads one key can ever have.
export const MOST_DEVICES = 2;
export const MOST_DOWNLOADS = 2;

// FLG-XXXXX-XXXXX-XXXXX-XXXXX from whatever the player typed or pasted
// (any case, spaces or dashes, with or without FLG), or null.
export function cleanKey(v) {
  let s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('FLG')) s = s.slice(3);
  if (s.length !== GROUPS * GROUP || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `FLG-${s.match(new RegExp(`.{${GROUP}}`, 'g')).join('-')}`;
}

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(GROUPS * GROUP));
  return cleanKey([...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join(''));
}

// Shown in lists where the whole key is not needed.
export const maskKey = (k) => `FLG-…-${String(k).slice(-5)}`;

// ------------------------------------------------------------- the signed pass
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
let keys = { from: null, sign: null, verify: null };

async function signingKeys(env) {
  const raw = String(env.LICENSE_SIGNING_KEY || '').trim();
  if (!raw) return null;
  if (keys.from === raw) return keys;
  try {
    const jwk = JSON.parse(raw);
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) return null;
    const sign = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, ALG, false, ['sign']);
    const verify = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, ALG, false, ['verify']);
    keys = { from: raw, sign, verify };
    return keys;
  } catch (e) {
    console.error('LICENSE_SIGNING_KEY is not a P-256 private key in JSON form');
    return null;
  }
}

export const signingReady = async (env) => !!(await signingKeys(env));

async function makePass(env, payload) {
  const k = await signingKeys(env);
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(SIGN, k.sign, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

async function readPass(env, pass) {
  const k = await signingKeys(env);
  const m = typeof pass === 'string' && pass.length < 2000 && pass.match(/^([\w-]+)\.([\w-]+)$/);
  if (!k || !m) return null;
  try {
    const ok = await crypto.subtle.verify(SIGN, k.verify, unb64url(m[2]), new TextEncoder().encode(m[1]));
    return ok ? JSON.parse(new TextDecoder().decode(unb64url(m[1]))) : null;
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------- keys
async function findKey(env, key) {
  return env.DB.prepare('SELECT * FROM licenses WHERE key = ?1').bind(key).first();
}

// Why a key does not work right now, or null when it does.
const problem = (row, now) => (!row ? 'unknown' : row.revoked_at ? 'revoked' : row.waiting ? 'waiting' : row.expires_at && row.expires_at <= now ? 'expired' : null);

export async function createKeys(env, { count = 1, label = null, email = null, userId = null, maxDevices = 1, until = null, source = 'admin', by = null, waiting = false }, now = Date.now()) {
  const made = [];
  for (let i = 0; i < count; i++) {
    const key = newKey();
    await env.DB.prepare(`INSERT INTO licenses (key, label, email, user_id, max_devices, max_downloads, source, created_at, created_by, expires_at, waiting)
      VALUES (?1, ?2, ?3, ?4, ?5, ?10, ?6, ?7, ?8, ?9, ?11)`).bind(key, label, email, userId, Math.min(maxDevices, MOST_DEVICES), source, now, by, until, MOST_DOWNLOADS, waiting ? 1 : 0).run();
    made.push(key);
  }
  return made;
}

// Uses a seat for this device (or finds the one it already has) and returns
// { pass } or { error }.
export async function activate(env, { key, device, platform }, now = Date.now()) {
  const row = await findKey(env, key);
  const why = problem(row, now);
  if (why) return { error: why };
  const seat = await env.DB.prepare('SELECT id, removed_at FROM license_devices WHERE license_id = ?1 AND device = ?2').bind(row.id, device).first();
  if (!seat || seat.removed_at) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM license_devices WHERE license_id = ?1 AND removed_at IS NULL').bind(row.id).first();
    if (n >= row.max_devices) return { error: 'full', max: row.max_devices };
  }
  await env.DB.prepare(`INSERT INTO license_devices (license_id, device, platform, activated_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT (license_id, device) DO UPDATE SET platform = excluded.platform, last_seen = excluded.last_seen,
      activated_at = CASE WHEN license_devices.removed_at IS NULL THEN license_devices.activated_at ELSE excluded.activated_at END, removed_at = NULL`)
    .bind(row.id, device, platform, now).run();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM license_devices WHERE license_id = ?1 AND removed_at IS NULL').bind(row.id).first();
  const pass = await makePass(env, { v: 1, l: row.id, d: device, p: platform, t: now, ...(row.expires_at ? { e: row.expires_at } : {}) });
  return { pass, key: maskKey(row.key), devices: n, maxDevices: row.max_devices, expiresAt: row.expires_at || null };
}

// { ok: true } while the key behind a pass still works on that device.
export async function check(env, pass, now = Date.now()) {
  const p = await readPass(env, pass);
  if (!p || !Number.isInteger(p.l) || typeof p.d !== 'string') return { ok: false, reason: 'bad' };
  const row = await env.DB.prepare('SELECT * FROM licenses WHERE id = ?1').bind(p.l).first();
  const why = problem(row, now);
  if (why) return { ok: false, reason: why === 'unknown' ? 'revoked' : why };
  const seat = await env.DB.prepare('SELECT id, removed_at FROM license_devices WHERE license_id = ?1 AND device = ?2').bind(row.id, p.d).first();
  if (!seat || seat.removed_at) return { ok: false, reason: 'removed' };
  await env.DB.prepare('UPDATE license_devices SET last_seen = ?2 WHERE id = ?1').bind(seat.id, now).run();
  return { ok: true, expiresAt: row.expires_at || null };
}

// Who may get a key for themselves (Settings > App keys).
async function mayGetOwn(env, s, user) {
  if (s.license_self_serve === 'signed_in') return true;
  if (s.license_self_serve === 'supporters') return (await perksFor(env, user)).supporter;
  return false;
}

async function ownKey(env, uid) {
  // One key per player, ever: a used-up or cancelled key is not replaced here;
  // the player asks the team for a new one.
  return env.DB.prepare('SELECT * FROM licenses WHERE user_id = ?1 AND source = \'self\' ORDER BY id DESC LIMIT 1').bind(uid).first();
}

// ------------------------------------------------------------- public routes
export async function handleLicenses(req, env, url, signedIn) {
  const path = url.pathname;
  if (!path.startsWith('/v1/license/')) return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const limit = async (binding) => !binding || (await binding.limit({ key: ip })).success;
  if (!(await limit(env.LIMIT_AUTHLESS))) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  const now = Date.now();

  if (path === '/v1/license/mine') {
    if (req.method !== 'GET' && req.method !== 'POST') return null;
    let user;
    try {
      user = await signedIn(req, env);
      if (await isDeleted(env, user.uid)) throw new AuthError('Account deleted');
    } catch (e) {
      if (e instanceof AuthError) return json(req, env, { error: 'sign_in' }, 401);
      throw e;
    }
    const s = await getSettings(env);
    const allowed = !!(user.email && user.emailVerified) && (await mayGetOwn(env, s, user));
    let row = await ownKey(env, user.uid);
    if (!row && req.method === 'POST') {
      if (!(user.email && user.emailVerified)) return json(req, env, { error: 'confirm_email' }, 403);
      if (!allowed) return json(req, env, { error: 'not_allowed', who: s.license_self_serve }, 403);
      const [key] = await createKeys(env, { userId: user.uid, email: cleanEmail(user.email), label: 'Asked for it on the website', maxDevices: s.license_default_devices, source: 'self', by: 'player', waiting: s.license_self_approval }, now);
      row = await findKey(env, key);
    }
    if (!row) return json(req, env, { key: null, allowed, who: s.license_self_serve, confirmed: !!user.emailVerified });
    // The key itself is shown only once an admin has approved it.
    if (row.waiting && !row.revoked_at) return json(req, env, { key: null, waiting: true, askedAt: row.created_at, allowed });
    if (row.waiting) return json(req, env, { key: null, declined: true, allowed });
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM license_devices WHERE license_id = ?1 AND removed_at IS NULL').bind(row.id).first();
    return json(req, env, { key: row.key, works: !problem(row, now), devices: n, maxDevices: row.max_devices, downloadsLeft: Math.max(0, row.max_downloads - row.downloads), expiresAt: row.expires_at || null, allowed });
  }

  if (req.method !== 'POST') return null;
  let body;
  try {
    const text = await readText(req, MAX_BODY);
    body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object') throw new SyntaxError();
  } catch (e) {
    if (e instanceof TooLarge) return json(req, env, { error: 'too_large' }, 413);
    return json(req, env, { error: 'bad_json' }, 400);
  }

  if (path === '/v1/license/check') {
    if (!(await signingReady(env))) return json(req, env, { ok: true, required: false });
    return json(req, env, { ...(await check(env, body.pass, now)), required: (await getSettings(env)).license_required });
  }

  // A wrong key costs one of a few tries a minute, so keys cannot be guessed.
  if (!(await limit(env.LIMIT_LICENSE))) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  const key = cleanKey(body.key);
  if (path === '/v1/license/download') {
    if (!key) return json(req, env, { ok: false, reason: 'unknown' });
    const row = await findKey(env, key);
    const why = problem(row, now);
    if (why) return json(req, env, { ok: false, reason: why });
    const r = await env.DB.prepare('UPDATE licenses SET downloads = downloads + 1, last_download_at = ?2 WHERE id = ?1 AND downloads < max_downloads').bind(row.id, now).run();
    if (!r.meta.changes) return json(req, env, { ok: false, reason: 'downloads_used', maxDownloads: row.max_downloads });
    return json(req, env, { ok: true, downloadsLeft: row.max_downloads - row.downloads - 1 });
  }
  if (path === '/v1/license/activate') {
    if (!(await signingReady(env))) return json(req, env, { error: 'not_ready' }, 503);
    if (!key) return json(req, env, { error: 'unknown' }, 400);
    if (typeof body.device !== 'string' || !DEVICE.test(body.device)) return json(req, env, { error: 'bad_device' }, 400);
    if (!PLATFORMS.includes(body.platform)) return json(req, env, { error: 'bad_platform' }, 400);
    const r = await activate(env, { key, device: body.device, platform: body.platform }, now);
    return json(req, env, r, r.error ? (r.error === 'unknown' ? 400 : 403) : 200);
  }
  return null;
}

// What /v1/config tells the game.
export async function licenseConfig(env, s) {
  const required = !!s.license_required && (await signingReady(env));
  return { licenseRequired: required, licenseDownload: required && !!s.license_download_needs_key, licenseOwn: required ? s.license_self_serve : 'off' };
}

// ------------------------------------------------------------- admin
export function licenseRoutes(Refusal) {
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return [
    ['GET', /^licenses$/, 'admin', 'licenses.view', async ({ env, url, now }) => {
      const q = str(url.searchParams.get('q') || '', 100).toLowerCase();
      const status = url.searchParams.get('status') || 'all';
      // ?1 and ?2 are always used, so the bindings match whatever is filtered.
      const where = ['?2 > 0'];
      if (status === 'waiting') where.push('l.waiting = 1 AND l.revoked_at IS NULL');
      if (status === 'active') where.push('l.revoked_at IS NULL AND l.waiting = 0 AND (l.expires_at IS NULL OR l.expires_at > ?2)');
      if (status === 'revoked') where.push('(l.revoked_at IS NOT NULL OR (l.expires_at IS NOT NULL AND l.expires_at <= ?2))');
      where.push(q ? "(lower(l.key) LIKE ?1 OR lower(coalesce(l.label, '')) LIKE ?1 OR lower(coalesce(l.email, '')) LIKE ?1)" : '?1 IS NOT NULL');
      const { results } = await env.DB.prepare(`SELECT l.id, l.key, l.label, l.email, l.user_id AS uid, l.max_devices AS maxDevices, l.max_downloads AS maxDownloads, l.downloads, l.last_download_at AS lastDownloadAt, l.source, l.created_at AS createdAt,
          l.created_by AS createdBy, l.expires_at AS expiresAt, l.revoked_at AS revokedAt, l.waiting, l.approved_at AS approvedAt, l.approved_by AS approvedBy, p.screen_name AS name,
          (SELECT COUNT(*) FROM license_devices d WHERE d.license_id = l.id AND d.removed_at IS NULL) AS devices,
          (SELECT MAX(last_seen) FROM license_devices d WHERE d.license_id = l.id) AS lastSeen
        FROM licenses l LEFT JOIN players p ON p.user_id = l.user_id
        WHERE ${where.join(' AND ')} ORDER BY (l.waiting = 1 AND l.revoked_at IS NULL) DESC, l.created_at DESC, l.id DESC LIMIT 500`).bind(`%${q}%`, now).all();
      const totals = await env.DB.prepare(`SELECT COUNT(*) AS keys, SUM(CASE WHEN revoked_at IS NULL AND waiting = 0 AND (expires_at IS NULL OR expires_at > ?1) THEN 1 ELSE 0 END) AS working,
          SUM(CASE WHEN revoked_at IS NULL AND waiting = 1 THEN 1 ELSE 0 END) AS waiting,
          (SELECT COUNT(*) FROM license_devices WHERE removed_at IS NULL) AS devices FROM licenses`).bind(now).first();
      const s = await getSettings(env);
      return {
        body: {
          now, ready: await signingReady(env), required: s.license_required, own: s.license_self_serve, defaultDevices: s.license_default_devices,
          totals: { keys: totals.keys || 0, working: totals.working || 0, waiting: totals.waiting || 0, devices: totals.devices || 0 }, approval: s.license_self_approval,
          keys: results.map((r) => ({ ...r, waiting: !!r.waiting && !r.revokedAt, works: !r.revokedAt && !r.waiting && !(r.expiresAt && r.expiresAt <= now) })),
        },
        quiet: true,
      };
    }],
    ['GET', /^licenses\/(\d{1,12})$/, 'admin', 'licenses.devices', async ({ env, params: [id] }) => {
      const { results } = await env.DB.prepare(`SELECT device, platform, activated_at AS activatedAt, last_seen AS lastSeen, removed_at AS removedAt
        FROM license_devices WHERE license_id = ?1 ORDER BY activated_at DESC`).bind(Number(id)).all();
      return { body: { devices: results }, quiet: true };
    }],
    ['POST', /^licenses$/, 'admin', 'licenses.add', async ({ env, body, who, now }) => {
      const count = body.count == null ? 1 : Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 100) throw new Refusal(400, 'count', 'Make 1 to 100 keys at a time.');
      const s = await getSettings(env);
      const maxDevices = body.maxDevices == null || body.maxDevices === '' ? s.license_default_devices : Number(body.maxDevices);
      if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > MOST_DEVICES) throw new Refusal(400, 'devices', 'A key installs on 1 computer or phone, or 2 when the player asked for it.');
      const email = body.email ? cleanEmail(body.email) : null;
      if (body.email && !email) throw new Refusal(400, 'email', 'That email address does not look right.');
      const until = body.until == null || body.until === '' ? null : Number(body.until);
      if (until != null && !(Number.isFinite(until) && until > now)) throw new Refusal(400, 'until', 'The end date must be in the future, or left empty.');
      const label = str(body.label, 200) || null;
      const made = await createKeys(env, { count, label, email, maxDevices, until, by: who.actor }, now);
      return { body: { keys: made }, target: label || email || `${count} keys`, detail: { count, maxDevices, until } };
    }],
    ['POST', /^licenses\/(\d{1,12})\/approve$/, 'admin', 'licenses.approve', async ({ env, params: [id], who, now }) => {
      const r = await env.DB.prepare('UPDATE licenses SET waiting = 0, approved_at = ?2, approved_by = ?3 WHERE id = ?1 AND waiting = 1 AND revoked_at IS NULL').bind(Number(id), now, who.actor).run();
      return { body: { changed: r.meta.changes }, target: id };
    }],
    // Declined: the player sees "not approved" and cannot ask again on their own.
    ['POST', /^licenses\/(\d{1,12})\/decline$/, 'admin', 'licenses.decline', async ({ env, params: [id], now }) => {
      const r = await env.DB.prepare('UPDATE licenses SET revoked_at = ?2 WHERE id = ?1 AND waiting = 1 AND revoked_at IS NULL').bind(Number(id), now).run();
      return { body: { changed: r.meta.changes }, target: id };
    }],
    ['POST', /^licenses\/(\d{1,12})\/revoke$/, 'admin', 'licenses.revoke', async ({ env, params: [id], now }) => {
      const r = await env.DB.prepare('UPDATE licenses SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL').bind(Number(id), now).run();
      return { body: { changed: r.meta.changes }, target: id };
    }],
    ['POST', /^licenses\/(\d{1,12})\/devices$/, 'admin', 'licenses.devices.set', async ({ env, params: [id], body }) => {
      const n = Number(body.maxDevices);
      if (!Number.isInteger(n) || n < 1 || n > MOST_DEVICES) throw new Refusal(400, 'devices', 'A key installs on 1 computer or phone, or 2 when the player asked for it.');
      const r = await env.DB.prepare('UPDATE licenses SET max_devices = ?2 WHERE id = ?1').bind(Number(id), n).run();
      return { body: { changed: r.meta.changes }, target: id, detail: { maxDevices: n } };
    }],
    ['POST', /^licenses\/(\d{1,12})\/restore$/, 'admin', 'licenses.restore', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('UPDATE licenses SET revoked_at = NULL WHERE id = ?1').bind(Number(id)).run();
      return { body: { changed: r.meta.changes }, target: id };
    }],
    ['POST', /^licenses\/(\d{1,12})\/devices\/([A-Za-z0-9_-]{16,64})\/remove$/, 'admin', 'licenses.device.remove', async ({ env, params: [id, device], now }) => {
      const r = await env.DB.prepare('UPDATE license_devices SET removed_at = ?3 WHERE license_id = ?1 AND device = ?2 AND removed_at IS NULL').bind(Number(id), device, now).run();
      return { body: { changed: r.meta.changes }, target: `${id}/${device.slice(0, 8)}` };
    }],
  ];
}
