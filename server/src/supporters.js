// Supporters and premium extras. The game is free; a supporter gets a badge on
// the scoreboard, and a premium supporter also gets the themes the admin marks
// as supporter extras (Settings > Support and premium). Grants are added by an
// admin here, or by a payment service's webhook (a separate module per
// service), and never take anything away from free players.
//
//   GET  /v1/perks                       the signed-in player's perks
//   GET  /admin/v1/supporters            every grant (admin: it shows emails)
//   POST /admin/v1/supporters            { email | uid, kind, until?, note? } (admin)
//   POST /admin/v1/supporters/:id/remove (admin)
import { json } from './http.js';
import { AuthError } from './auth.js';
import { isDeleted } from './sync.js';

export const KINDS = ['supporter', 'premium'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const active = 'AND (until IS NULL OR until > ?2)';

export const cleanEmail = (v) => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return EMAIL.test(e) ? e : null;
};

// Adds a grant. A repeat of the same (source, ref) changes nothing, except
// that a later end date replaces an earlier one (a monthly renewal).
export async function grant(env, { uid = null, email = null, kind, source, ref, until = null, note = null, by = null }, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new Error('bad kind');
  await env.DB.prepare(`INSERT INTO supporters (user_id, email, kind, source, ref, note, created_at, until, created_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT (source, ref) DO UPDATE SET until = CASE
      WHEN excluded.until IS NULL OR supporters.until IS NULL THEN NULL
      ELSE MAX(supporters.until, excluded.until) END`)
    .bind(uid, cleanEmail(email), kind, source, String(ref).slice(0, 200), note ? String(note).slice(0, 200) : null, now, until, by).run();
}

// Ends a grant early, for a refund or a cancelled membership.
export async function revoke(env, source, ref, now = Date.now()) {
  const r = await env.DB.prepare('UPDATE supporters SET until = ?3 WHERE source = ?1 AND ref = ?2 AND (until IS NULL OR until > ?3)').bind(source, String(ref), now).run();
  return r.meta.changes;
}

// A player's perks. Grants made out to their confirmed email are linked to
// their account here, so they keep them if they change email later.
export async function perksFor(env, user, now = Date.now()) {
  if (user.email && user.emailVerified) {
    await env.DB.prepare('UPDATE supporters SET user_id = ?1 WHERE user_id IS NULL AND email = ?2').bind(user.uid, user.email.toLowerCase()).run();
  }
  const { results } = await env.DB.prepare(`SELECT kind, until FROM supporters WHERE user_id = ?1 ${active}`).bind(user.uid, now).all();
  const premium = results.filter((r) => r.kind === 'premium');
  const endOf = (rows) => (rows.some((r) => r.until == null) ? null : Math.max(...rows.map((r) => r.until)));
  return {
    supporter: results.length > 0,
    premium: premium.length > 0,
    until: premium.length ? endOf(premium) : results.length ? endOf(results) : null,
  };
}

// For payment webhooks: compares a secret in constant time. Secrets are
// trimmed, because one pasted into the Cloudflare dashboard can carry a stray
// space or line break.
export function secretMatches(given, secret) {
  const a = String(given || '').trim();
  const b = String(secret || '').trim();
  if (b.length < 16 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Which of these players are supporters now (for the scoreboard badge).
export async function supporterSet(env, uids, now = Date.now()) {
  if (!uids.length) return new Set();
  try {
    const { results } = await env.DB.prepare(`SELECT DISTINCT user_id FROM supporters WHERE user_id IN (SELECT value FROM json_each(?1)) ${active}`)
      .bind(JSON.stringify(uids), now).all();
    return new Set(results.map((r) => r.user_id));
  } catch (e) {
    return new Set(); // table not made yet
  }
}

export async function handlePerks(req, env, url, signedIn) {
  if (url.pathname !== '/v1/perks' || req.method !== 'GET') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  let user;
  try {
    user = await signedIn(req, env);
    if (await isDeleted(env, user.uid)) throw new AuthError('Account deleted');
  } catch (e) {
    if (e instanceof AuthError) return json(req, env, { error: 'sign_in' }, 401);
    throw e;
  }
  return json(req, env, await perksFor(env, user));
}

// ------------------------------------------------------------- admin
export function supporterRoutes(Refusal) {
  return [
    ['GET', /^supporters$/, 'admin', 'supporters.view', async ({ env, now }) => {
      const { results } = await env.DB.prepare(`SELECT s.id, s.user_id AS uid, s.email, s.kind, s.source, s.ref, s.note, s.created_at AS createdAt,
          s.until, s.created_by AS createdBy, p.screen_name AS name
        FROM supporters s LEFT JOIN players p ON p.user_id = s.user_id ORDER BY s.created_at DESC LIMIT 500`).all();
      return { body: { now, supporters: results.map((r) => ({ ...r, active: r.until == null || r.until > now })) }, quiet: true };
    }],
    ['POST', /^supporters$/, 'admin', 'supporters.add', async ({ env, body, who, now }) => {
      const kind = KINDS.includes(body.kind) ? body.kind : null;
      if (!kind) throw new Refusal(400, 'bad_kind', 'Choose Supporter or Premium.');
      const email = body.email ? cleanEmail(body.email) : null;
      const uid = typeof body.uid === 'string' && /^[\w-]{1,128}$/.test(body.uid) ? body.uid : null;
      if (!email && !uid) throw new Refusal(400, 'who', 'Give the player\'s email or player id.');
      const until = body.until == null || body.until === '' ? null : Number(body.until);
      if (until != null && !(Number.isFinite(until) && until > now)) throw new Refusal(400, 'until', 'The end date must be in the future, or left empty.');
      const ref = `admin-${now}-${Math.random().toString(36).slice(2, 8)}`;
      await grant(env, { uid, email, kind, source: 'admin', ref, until, note: typeof body.note === 'string' ? body.note.trim() : null, by: who.actor }, now);
      return { body: { ok: true }, target: email || uid, detail: { kind, until } };
    }],
    ['POST', /^supporters\/(\d{1,12})\/remove$/, 'admin', 'supporters.remove', async ({ env, params: [id], now }) => {
      const r = await env.DB.prepare('UPDATE supporters SET until = ?2 WHERE id = ?1 AND (until IS NULL OR until > ?2)').bind(Number(id), now).run();
      return { body: { ended: r.meta.changes }, target: id };
    }],
  ];
}
