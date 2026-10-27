// Supporters and premium extras. The game is free; a supporter gets a badge on
// the scoreboard, and a premium supporter also gets the themes the admin marks
// as supporter extras (Settings > Support and premium). Grants are added by an
// admin here, or by a payment service's webhook (a separate module per
// service), and never take anything away from free players.
//
// Each grant has a badge tier (Bronze, Silver, Gold, Platinum). A player shows
// the highest tier among their grants that are still running. Payment
// webhooks pick the tier with tierFor(): from the membership tier's name when
// it names one, otherwise from the amount paid and the admin's tier amounts
// (Settings > Support and premium).
//
//   GET  /v1/perks                       the signed-in player's perks
//   GET  /admin/v1/supporters            every grant (admin: it shows emails)
//   POST /admin/v1/supporters            { email | uid, kind, tier?, until?, note? } (admin)
//   POST /admin/v1/supporters/:id/remove (admin)
import { json } from './http.js';
import { AuthError } from './auth.js';
import { isDeleted } from './sync.js';
import { getSettings } from './settings.js';

export const KINDS = ['supporter', 'premium'];
export const TIERS = [null, 'Bronze', 'Silver', 'Gold', 'Platinum'];
const cleanTier = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 4 ? Number(v) : null);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const active = 'AND (until IS NULL OR until > ?2)';

export const cleanEmail = (v) => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return EMAIL.test(e) ? e : null;
};

// Adds a grant. A repeat of the same (source, ref) changes nothing, except
// that a later end date replaces an earlier one (a monthly renewal), and the
// tier rises to the higher of the two, or with replaceTier becomes the new
// one (a membership moved to another tier).
export async function grant(env, { uid = null, email = null, kind, tier = 1, replaceTier = false, source, ref, until = null, note = null, by = null }, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new Error('bad kind');
  await env.DB.prepare(`INSERT INTO supporters (user_id, email, kind, tier, source, ref, note, created_at, until, created_by)
    VALUES (?1, ?2, ?3, ?10, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT (source, ref) DO UPDATE SET tier = CASE WHEN ?11 THEN excluded.tier ELSE MAX(supporters.tier, excluded.tier) END, until = CASE
      WHEN excluded.until IS NULL OR supporters.until IS NULL THEN NULL
      ELSE MAX(supporters.until, excluded.until) END`)
    .bind(uid, cleanEmail(email), kind, source, String(ref).slice(0, 200), note ? String(note).slice(0, 200) : null, now, until, by, cleanTier(tier) || 1, replaceTier ? 1 : 0).run();
}

// The badge tier for a payment: a membership tier named "Gold supporters"
// gives Gold; otherwise the amount (in dollars, or the payment's currency)
// against the admin's tier amounts.
export async function tierFor(env, { amount = 0, name = '' } = {}) {
  const named = String(name || '').toLowerCase();
  for (let t = TIERS.length - 1; t >= 1; t--) if (named.includes(TIERS[t].toLowerCase())) return t;
  const s = await getSettings(env);
  const n = Number(amount) || 0;
  if (n >= s.tier_platinum_from) return 4;
  if (n >= s.tier_gold_from) return 3;
  if (n >= s.tier_silver_from) return 2;
  return 1;
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
  const { results } = await env.DB.prepare(`SELECT kind, tier, until FROM supporters WHERE user_id = ?1 ${active}`).bind(user.uid, now).all();
  const premium = results.filter((r) => r.kind === 'premium');
  const endOf = (rows) => (rows.some((r) => r.until == null) ? null : Math.max(...rows.map((r) => r.until)));
  return {
    supporter: results.length > 0,
    premium: premium.length > 0,
    tier: results.length ? Math.max(...results.map((r) => r.tier || 1)) : 0,
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

// The badge tier of each of these players who supports the game now (for the
// scoreboard), as a Map of player id to tier.
export async function supporterTiers(env, uids, now = Date.now()) {
  if (!uids.length) return new Map();
  try {
    const { results } = await env.DB.prepare(`SELECT user_id, MAX(tier) AS tier FROM supporters WHERE user_id IN (SELECT value FROM json_each(?1)) ${active} GROUP BY user_id`)
      .bind(JSON.stringify(uids), now).all();
    return new Map(results.map((r) => [r.user_id, r.tier || 1]));
  } catch (e) {
    return new Map(); // table not made yet
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
      const { results } = await env.DB.prepare(`SELECT s.id, s.user_id AS uid, s.email, s.kind, s.tier, s.source, s.ref, s.note, s.created_at AS createdAt,
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
      const tier = body.tier == null || body.tier === '' ? 1 : cleanTier(body.tier);
      if (!tier) throw new Refusal(400, 'bad_tier', 'Choose Bronze, Silver, Gold or Platinum.');
      const until = body.until == null || body.until === '' ? null : Number(body.until);
      if (until != null && !(Number.isFinite(until) && until > now)) throw new Refusal(400, 'until', 'The end date must be in the future, or left empty.');
      const ref = `admin-${now}-${Math.random().toString(36).slice(2, 8)}`;
      await grant(env, { uid, email, kind, tier, source: 'admin', ref, until, note: typeof body.note === 'string' ? body.note.trim() : null, by: who.actor }, now);
      return { body: { ok: true }, target: email || uid, detail: { kind, tier, until } };
    }],
    ['POST', /^supporters\/(\d{1,12})\/remove$/, 'admin', 'supporters.remove', async ({ env, params: [id], now }) => {
      const r = await env.DB.prepare('UPDATE supporters SET until = ?2 WHERE id = ?1 AND (until IS NULL OR until > ?2)').bind(Number(id), now).run();
      return { body: { ended: r.meta.changes }, target: id };
    }],
  ];
}
