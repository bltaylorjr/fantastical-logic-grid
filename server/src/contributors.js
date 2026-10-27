// Contributor badges. Signed-in players who send ideas, problem reports or
// character suggestions can tick "Count this toward my Contributor badge".
// Each one counts once the team uses it (an idea or problem marked addressed,
// a suggested character published). The badge rises with the count: Bronze,
// Silver, Gold and Platinum, at the numbers the admin sets under Settings >
// Contributors. Admins can also add a credit by hand for help given outside
// the game.
//
//   GET  /v1/contributor                    the signed-in player's count and badge
//   GET  /admin/v1/contributors             every player with credits (moderator)
//   POST /admin/v1/contributors             { uid | name, note } a credit by hand (admin)
//   POST /admin/v1/contributors/:id/remove  (admin)
import { json } from './http.js';
import { AuthError, verifyIdToken } from './auth.js';
import { isDeleted } from './sync.js';
import { getSettings } from './settings.js';

export const KINDS = ['idea', 'problem', 'character', 'admin'];
export const TIERS = [null, 'Bronze', 'Silver', 'Gold', 'Platinum'];

// The badge tier for a count: 0 (none yet) up to 4 (Platinum).
export function tierOf(count, s) {
  const from = [0, s.contributor_bronze_from, s.contributor_silver_from, s.contributor_gold_from, s.contributor_platinum_from];
  for (let t = 4; t >= 1; t--) if (count >= from[t]) return t;
  return 0;
}

const nextAt = (tier, s) => [s.contributor_bronze_from, s.contributor_silver_from, s.contributor_gold_from, s.contributor_platinum_from][tier] ?? null;

// Which kinds count right now: fixed problem reports only while the admin
// lets them.
const countedKinds = (s) => KINDS.filter((k) => k !== 'problem' || s.contributor_problems_count);

// The player behind a request's sign-in token, or null when signed out.
export async function playerOf(req, env) {
  const token = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1];
  if (!token) return null;
  try { return await verifyIdToken(token, env); } catch (e) { return null; }
}

// Links something a player sent to their account, waiting for the team.
// Returns 'waiting', 'off' or 'signed_out'.
export async function recordContribution(env, user, kind, ref, now = Date.now()) {
  if (!user) return 'signed_out';
  if (!(await getSettings(env, now)).contributor_badges_enabled) return 'off';
  await env.DB.prepare('INSERT OR IGNORE INTO contributions (user_id, kind, ref, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(user.uid, kind, String(ref), now).run();
  return 'waiting';
}

// The team used it (marked addressed, published): it counts from now on,
// even after the idea itself is cleaned up months later.
export async function countContribution(env, kind, ref, now = Date.now()) {
  try {
    await env.DB.prepare("UPDATE contributions SET status = 'counted', counted_at = ?3 WHERE kind = ?1 AND ref = ?2 AND status = 'waiting'").bind(kind, String(ref), now).run();
  } catch (e) { /* table not made yet */ }
}

// Marked addressed by mistake and moved back: it waits again.
export async function uncountContribution(env, kind, ref) {
  try {
    await env.DB.prepare("UPDATE contributions SET status = 'waiting', counted_at = NULL WHERE kind = ?1 AND ref = ?2").bind(kind, String(ref)).run();
  } catch (e) { /* table not made yet */ }
}

// Deleted before the team used it: nothing to count.
export async function dropContribution(env, kind, ref) {
  try {
    await env.DB.prepare("DELETE FROM contributions WHERE kind = ?1 AND ref = ?2 AND status = 'waiting'").bind(kind, String(ref)).run();
  } catch (e) { /* table not made yet */ }
}

export async function contributorFor(env, uid, now = Date.now()) {
  const s = await getSettings(env, now);
  if (!s.contributor_badges_enabled) return { enabled: false, count: 0, waiting: 0, tier: 0, nextAt: null };
  const kinds = countedKinds(s);
  const r = await env.DB.prepare(`SELECT SUM(status = 'counted' AND kind IN (SELECT value FROM json_each(?2))) AS counted, SUM(status = 'waiting') AS waiting
    FROM contributions WHERE user_id = ?1`).bind(uid, JSON.stringify(kinds)).first();
  const count = r?.counted || 0;
  const tier = tierOf(count, s);
  return { enabled: true, count, waiting: r?.waiting || 0, tier, nextAt: nextAt(tier, s) };
}

// The badge tier of each of these players (for the scoreboard), as a Map of
// player id to tier. Players without a badge yet are left out.
export async function contributorTiers(env, uids, now = Date.now()) {
  if (!uids.length) return new Map();
  const s = await getSettings(env, now);
  if (!s.contributor_badges_enabled) return new Map();
  try {
    const { results } = await env.DB.prepare(`SELECT user_id, COUNT(*) AS n FROM contributions
      WHERE status = 'counted' AND user_id IN (SELECT value FROM json_each(?1)) AND kind IN (SELECT value FROM json_each(?2)) GROUP BY user_id`)
      .bind(JSON.stringify(uids), JSON.stringify(countedKinds(s))).all();
    return new Map(results.map((r) => [r.user_id, tierOf(r.n, s)]).filter(([, t]) => t > 0));
  } catch (e) {
    return new Map(); // table not made yet
  }
}

export const deleteContributionStatements = (env, uid) => [env.DB.prepare('DELETE FROM contributions WHERE user_id = ?1').bind(uid)];

export async function handleContributor(req, env, url, signedIn) {
  if (url.pathname !== '/v1/contributor' || req.method !== 'GET') return null;
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
  return json(req, env, await contributorFor(env, user.uid));
}

// ------------------------------------------------------------- admin
export function contributorRoutes(Refusal) {
  return [
    ['GET', /^contributors$/, 'moderator', 'contributors.view', async ({ env, now }) => {
      const s = await getSettings(env, now);
      const kinds = JSON.stringify(countedKinds(s));
      const { results: players } = await env.DB.prepare(`SELECT c.user_id AS uid, p.screen_name AS name,
          SUM(c.status = 'counted' AND c.kind IN (SELECT value FROM json_each(?1))) AS counted, SUM(c.status = 'waiting') AS waiting,
          SUM(c.status = 'counted' AND c.kind = 'idea') AS ideas, SUM(c.status = 'counted' AND c.kind = 'problem') AS problems,
          SUM(c.status = 'counted' AND c.kind = 'character') AS characters, SUM(c.status = 'counted' AND c.kind = 'admin') AS byHand
        FROM contributions c LEFT JOIN players p ON p.user_id = c.user_id GROUP BY c.user_id ORDER BY counted DESC, waiting DESC LIMIT 500`).bind(kinds).all();
      const { results: credits } = await env.DB.prepare(`SELECT c.id, c.user_id AS uid, p.screen_name AS name, c.note, c.created_at AS createdAt, c.created_by AS createdBy
        FROM contributions c LEFT JOIN players p ON p.user_id = c.user_id WHERE c.kind = 'admin' ORDER BY c.created_at DESC LIMIT 200`).all();
      return {
        body: {
          enabled: s.contributor_badges_enabled,
          players: players.map((r) => ({ ...r, tier: tierOf(r.counted || 0, s) })),
          credits,
        },
        quiet: true,
      };
    }],
    ['POST', /^contributors$/, 'admin', 'contributors.add', async ({ env, body, who, now }) => {
      let uid = typeof body.uid === 'string' && /^[\w-]{1,128}$/.test(body.uid.trim()) ? body.uid.trim() : null;
      if (!uid && typeof body.name === 'string' && body.name.trim()) {
        const p = await env.DB.prepare('SELECT user_id FROM players WHERE screen_name = ?1 COLLATE NOCASE').bind(body.name.trim()).first();
        uid = p ? p.user_id : null;
        if (!uid) throw new Refusal(404, 'no_player', 'No player has that screen name.');
      }
      if (!uid) throw new Refusal(400, 'who', 'Give the player\'s screen name or player id.');
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
      if (!note) throw new Refusal(400, 'note', 'Write a few words on what it is for.');
      const ref = `admin-${now}-${Math.random().toString(36).slice(2, 8)}`;
      await env.DB.prepare("INSERT INTO contributions (user_id, kind, ref, status, note, created_at, counted_at, created_by) VALUES (?1, 'admin', ?2, 'counted', ?3, ?4, ?4, ?5)")
        .bind(uid, ref, note, now, who.actor).run();
      return { body: { ok: true }, target: uid, detail: { note } };
    }],
    ['POST', /^contributors\/(\d{1,12})\/remove$/, 'admin', 'contributors.remove', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare("DELETE FROM contributions WHERE id = ?1 AND kind = 'admin'").bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That credit is gone.');
      return { body: { ok: true }, target: id };
    }],
  ];
}
