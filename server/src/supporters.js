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
//   POST /admin/v1/supporters/:id/remove { reason?: ended | refund | chargeback } (admin)
//   GET  /admin/v1/supporters/:id/evidence   a dispute evidence summary to download (admin)
//   GET  /admin/v1/supporters/blocks         payment blocks after chargebacks (admin)
//   POST /admin/v1/supporters/blocks/:id/remove   lift a block (admin)
//
// Chargebacks: marking a grant as charged back ends every perk that player
// has at once (the record is kept, for the payment service's dispute) and
// blocks them, so a later payment webhook records the payment but adds no
// perks until an admin lifts the block. A refund ends only that grant.
import { alert } from './alerts.js';
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
// A payment from a blocked player (after a chargeback) is recorded, ended at
// once, so it adds no perks. Returns { blocked }.
export async function grant(env, { uid = null, email = null, kind, tier = 1, replaceTier = false, source, ref, until = null, note = null, by = null }, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new Error('bad kind');
  const blocked = source !== 'admin' && await isBlocked(env, { uid, email });
  if (blocked) { until = now; replaceTier = false; }
  await env.DB.prepare(`INSERT INTO supporters (user_id, email, kind, tier, source, ref, note, created_at, until, created_by, ended_reason)
    VALUES (?1, ?2, ?3, ?10, ?4, ?5, ?6, ?7, ?8, ?9, ?12)
    ON CONFLICT (source, ref) DO UPDATE SET tier = CASE WHEN ?11 THEN excluded.tier ELSE MAX(supporters.tier, excluded.tier) END, until = CASE
      WHEN excluded.until IS NULL OR supporters.until IS NULL THEN NULL
      ELSE MAX(supporters.until, excluded.until) END
    WHERE supporters.ended_reason IS NULL OR supporters.ended_reason = 'ended'`)
    .bind(uid, cleanEmail(email), kind, source, String(ref).slice(0, 200), note ? String(note).slice(0, 200) : null, now, until, by, cleanTier(tier) || 1, replaceTier ? 1 : 0, blocked ? 'blocked' : null).run();
  return { blocked };
}

// Whether payments from this player add no perks (a chargeback block on their
// account or their email).
export async function isBlocked(env, { uid = null, email = null }) {
  const e = cleanEmail(email);
  if (!uid && !e) return false;
  const row = await env.DB.prepare('SELECT 1 FROM payment_blocks WHERE (?1 IS NOT NULL AND user_id = ?1) OR (?2 IS NOT NULL AND email = ?2) LIMIT 1').bind(uid, e).first();
  return !!row;
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
export async function revoke(env, source, ref, now = Date.now(), reason = 'refund') {
  const r = await env.DB.prepare('UPDATE supporters SET until = ?3, ended_reason = COALESCE(ended_reason, ?4) WHERE source = ?1 AND ref = ?2 AND (until IS NULL OR until > ?3)').bind(source, String(ref), now, reason).run();
  return r.meta.changes;
}

// A chargeback (a disputed payment): ends every running grant for that player,
// keeps the records, and blocks payments from adding perks for them again.
// Payment webhooks that report a dispute call this with the grant's source and
// ref; the admin dashboard calls it with the grant's id.
export async function chargeback(env, { id = null, source = null, ref = null, note = null, by = null, ctx = null }, now = Date.now()) {
  const row = id != null
    ? await env.DB.prepare('SELECT id, user_id, email FROM supporters WHERE id = ?1').bind(Number(id)).first()
    : await env.DB.prepare('SELECT id, user_id, email FROM supporters WHERE source = ?1 AND ref = ?2').bind(source, String(ref)).first();
  if (!row) return null;
  const db = env.DB;
  const [mark, ended] = await db.batch([
    db.prepare("UPDATE supporters SET ended_reason = 'chargeback', until = CASE WHEN until IS NULL OR until > ?2 THEN ?2 ELSE until END WHERE id = ?1").bind(row.id, now),
    db.prepare(`UPDATE supporters SET until = ?3, ended_reason = COALESCE(ended_reason, 'chargeback')
      WHERE id != ?4 AND (until IS NULL OR until > ?3) AND ((?1 IS NOT NULL AND user_id = ?1) OR (?2 IS NOT NULL AND email = ?2))`).bind(row.user_id, row.email, now, row.id),
    db.prepare(`INSERT INTO payment_blocks (user_id, email, reason, note, supporter_id, created_at, created_by)
      SELECT ?1, ?2, 'chargeback', ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM payment_blocks WHERE supporter_id = ?4)`)
      .bind(row.user_id, row.email, note ? String(note).slice(0, 200) : null, row.id, now, by),
  ]);
  // A dispute reported by a payment service (not one an admin entered).
  if (!by) await alert(env, ctx, { category: 'problems', title: 'A payment was disputed', body: 'A supporter\'s payment was disputed (a chargeback). Their perks were ended and payments from them are blocked.', link: 'supporters' });
  return { ended: mark.meta.changes + ended.meta.changes, uid: row.user_id, email: row.email };
}

const day = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'never');

// A plain-text summary for answering a payment dispute: what the player paid
// for, that it was delivered at once, and that they kept using it. Payment
// services ask for exactly this ("proof of delivery or use").
export async function evidence(env, id, now = Date.now()) {
  const g = await env.DB.prepare(`SELECT s.*, p.screen_name AS name, u.created_at AS joined FROM supporters s
    LEFT JOIN players p ON p.user_id = s.user_id LEFT JOIN sync_users u ON u.user_id = s.user_id WHERE s.id = ?1`).bind(Number(id)).first();
  if (!g) return null;
  const [scores, others] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM scores WHERE user_id = ?1 AND created_at >= ?2').bind(g.user_id, g.created_at),
    env.DB.prepare('SELECT source, ref, kind, created_at, until, ended_reason FROM supporters WHERE id != ?1 AND ((?2 IS NOT NULL AND user_id = ?2) OR (?3 IS NOT NULL AND email = ?3)) ORDER BY created_at').bind(g.id, g.user_id, g.email),
  ]);
  const sc = scores.results[0] || {};
  const what = g.kind === 'premium' ? 'a Supporter badge on the scoreboard and the supporter extra themes' : 'a Supporter badge on the scoreboard';
  const lines = [
    'The Fantastical Logic Grid (thelogicgrid.com): supporter payment record',
    `Prepared ${day(now)} for a payment dispute.`,
    '',
    'The payment',
    `- Payment service: ${g.source}`,
    `- Payment id: ${g.ref}`,
    `- Received: ${day(g.created_at)}`,
    `- Email on the payment: ${g.email || '(none given)'}`,
    `- What it gave: ${what} (${TIERS[g.tier] || 'Bronze'} level), a thank-you for a voluntary tip. The game itself is free; nothing was sold that the player could not already use.`,
    `- Delivered: automatically, at once, to the player's account when the payment arrived.`,
    `- Ends: ${g.until == null ? 'never' : day(g.until)}${g.ended_reason ? ` (ended: ${g.ended_reason})` : ''}`,
    '',
    'The player',
    `- Game account: ${g.user_id ? 'yes' : 'not linked to an account'}${g.joined ? `, created ${day(g.joined)}` : ''}`,
    `- Screen name: ${g.name || '(none)'}`,
    `- Puzzles finished on the scoreboard since the payment: ${sc.n || 0}${sc.last ? `, the latest ${day(sc.last)}` : ''}`,
    `- Other payments from this player: ${others.results.length ? others.results.map((o) => `${o.source} ${o.ref} on ${day(o.created_at)}${o.ended_reason ? ` (${o.ended_reason})` : ''}`).join('; ') : 'none'}`,
    '',
    'Terms the player agreed to',
    '- https://thelogicgrid.com/terms/#tips: tips are voluntary gifts to support a free game; the badge and extras are thank-yous; refunds are given on request by email within 30 days.',
    '- Contact: support@thelogicgrid.com',
    '',
  ];
  return lines.join('\n');
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
          s.until, s.ended_reason AS endedReason, s.created_by AS createdBy, p.screen_name AS name
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
    ['POST', /^supporters\/(\d{1,12})\/remove$/, 'admin', 'supporters.remove', async ({ env, params: [id], body, who, now }) => {
      const reason = ['ended', 'refund', 'chargeback'].includes(body?.reason) ? body.reason : 'ended';
      if (reason === 'chargeback') {
        const r = await chargeback(env, { id, note: typeof body.note === 'string' ? body.note.trim() : null, by: who.actor }, now);
        if (!r) throw new Refusal(404, 'not_found');
        return { body: { ended: r.ended, blocked: true }, target: r.email || r.uid || id, detail: { reason } };
      }
      const r = await env.DB.prepare('UPDATE supporters SET until = ?2, ended_reason = ?3 WHERE id = ?1 AND (until IS NULL OR until > ?2)').bind(Number(id), now, reason).run();
      return { body: { ended: r.meta.changes }, target: id, detail: { reason } };
    }],
    ['GET', /^supporters\/(\d{1,12})\/evidence$/, 'admin', 'supporters.evidence', async ({ env, params: [id], now }) => {
      const text = await evidence(env, id, now);
      if (!text) throw new Refusal(404, 'not_found');
      return { file: text, type: 'text/plain; charset=utf-8', name: `logic-grid-payment-${id}-evidence.txt`, target: id };
    }],
    ['GET', /^supporters\/blocks$/, 'admin', 'supporters.view', async ({ env }) => {
      const { results } = await env.DB.prepare('SELECT id, user_id AS uid, email, reason, note, supporter_id AS supporterId, created_at AS createdAt, created_by AS createdBy FROM payment_blocks ORDER BY created_at DESC LIMIT 500').all();
      return { body: { blocks: results }, quiet: true };
    }],
    ['POST', /^supporters\/blocks\/(\d{1,12})\/remove$/, 'admin', 'supporters.unblock', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('DELETE FROM payment_blocks WHERE id = ?1').bind(Number(id)).run();
      return { body: { lifted: r.meta.changes }, target: id };
    }],
  ];
}
