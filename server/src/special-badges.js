// Special badges: badges the team awards by hand (Tester, Contributor, Bug
// Hunter, or any the admin makes) and badges a player earns automatically by
// reaching a milestone the admin sets, such as 250 puzzles solved or 7 daily
// puzzles in a row. They sit beside the game's own achievement badges
// (web/js/stats.js), which each device works out for itself.
//
// Automatic badges are checked against the player's synced solve log (the
// `solves` meta record, sync.js) whenever the game asks for the player's
// badges, so they need an account with sync. A badge an admin removes is not
// given back by the next check. The "Special badges" switch (Settings > Play)
// hides them everywhere and stops the checks; awards are kept.
//
//   GET  /v1/badges                         the signed-in player's special badges and the ones still to earn
//   GET  /admin/v1/badges                   every badge, with its holder count (viewer)
//   POST /admin/v1/badges                   { name, icon, description, rule?, active? } a new badge (admin)
//   POST /admin/v1/badges/:id               the same, to change one (admin)
//   POST /admin/v1/badges/:id/delete        a badge and all its awards (admin)
//   GET  /admin/v1/badges/:id/holders       who has it, and awards removed (viewer)
//   POST /admin/v1/badges/:id/award         { who | uid, note? } give it to a player (moderator)
//   POST /admin/v1/badges/awards/:id/remove take an award away (moderator)
import { json } from './http.js';
import { AuthError } from './auth.js';
import { isDeleted } from './sync.js';
import { getSettings } from './settings.js';
import { nameKey } from './names.js';
import { TIERS } from '../../engine/src/tiers.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const UID = /^[\w-]{1,128}$/;
const STREAK_GRACE_MS = 48 * 3600 * 1000; // as web/js/daily.js
const MAX_COUNT = 100000;

const tierName = (id) => TIERS[id]?.name || id;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What an automatic badge can ask for. Each works out a number from the
// player's solve log; the badge is earned when it reaches the rule's count.
// Puzzles ended with the solution revealed never count.
export const RULES = {
  solved: { label: 'Puzzles solved', text: (r) => `Solve ${plural(r.count, 'puzzle', 'puzzles')}.`, value: (f) => f.solved.length },
  tier: { label: 'Puzzles solved at one difficulty', needsTier: true, text: (r) => `Solve ${plural(r.count, `${tierName(r.tier)} puzzle`, `${tierName(r.tier)} puzzles`)}.`, value: (f, r) => f.solved.filter((x) => x.tier === r.tier).length },
  nohints: { label: 'Puzzles solved without hints', text: (r) => `Solve ${plural(r.count, 'puzzle', 'puzzles')} without any hints.`, value: (f) => f.solved.filter((x) => !x.hints).length },
  themes: { label: 'Different themes solved', text: (r) => `Solve puzzles in ${plural(r.count, 'theme', 'different themes')}.`, value: (f) => new Set(f.solved.map((x) => x.theme).filter(Boolean)).size },
  daily: { label: 'Daily puzzles solved', text: (r) => `Solve ${plural(r.count, 'daily puzzle', 'daily puzzles')}.`, value: (f) => f.solved.filter((x) => x.daily).length },
  streak: { label: 'Daily streak (days in a row)', text: (r) => `Solve the daily puzzle ${plural(r.count, 'day', 'days in a row')}.`, value: (f) => bestStreak(f.solved) },
  races: { label: 'Races finished', text: (r) => `Finish ${plural(r.count, 'race', 'races')}.`, value: (f) => f.solved.filter((x) => x.race).length },
};

// The longest run of daily puzzles solved on consecutive days, each within
// two days of its date (the same rule as the game's own streak).
function bestStreak(solved) {
  const days = new Set();
  for (const s of solved) {
    if (typeof s.daily !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.daily)) continue;
    const start = Date.parse(`${s.daily}T00:00:00Z`);
    if (s.at >= start && s.at - start <= STREAK_GRACE_MS) days.add(s.daily);
  }
  let best = 0, run = 0, prev = null;
  for (const d of [...days].sort()) {
    run = prev != null && Date.parse(`${d}T00:00:00Z`) - prev === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = Date.parse(`${d}T00:00:00Z`);
  }
  return best;
}

export function ruleText(rule) {
  return rule && RULES[rule.kind] ? RULES[rule.kind].text(rule) : 'Awarded by the team.';
}

const parseRule = (text) => { try { const r = JSON.parse(text); return r && RULES[r.kind] ? r : null; } catch (e) { return null; } };

// A clean rule from the admin's form, or null for "by hand", or a string
// saying what is wrong.
export function checkRule(raw) {
  if (raw == null || raw === '' || raw.kind == null || raw.kind === '' || raw.kind === 'manual') return null;
  if (typeof raw !== 'object' || !RULES[raw.kind]) return 'Choose how the badge is earned.';
  const count = Number(raw.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return `The number must be a whole number from 1 to ${MAX_COUNT}.`;
  const rule = { kind: raw.kind, count };
  if (RULES[raw.kind].needsTier) {
    if (!TIERS[raw.tier]) return 'Choose the difficulty.';
    rule.tier = raw.tier;
  }
  return rule;
}

export const cleanEmail = (v) => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return EMAIL.test(e) ? e : null;
};

// The numbers automatic badges look at, from the synced solve log.
async function solveFacts(env, uid) {
  const row = await env.DB.prepare("SELECT data FROM sync_records WHERE user_id = ?1 AND kind = 'meta' AND key = 'solves' AND deleted = 0").bind(uid).first();
  let log = [];
  try { const v = row ? JSON.parse(row.data) : []; if (Array.isArray(v)) log = v; } catch (e) { /* a broken record counts as none */ }
  return { solved: log.filter((x) => x && typeof x === 'object' && !x.revealed) };
}

// Gives this player every automatic badge they now qualify for. Returns the
// facts used, or null when nothing needed checking.
async function checkAutomatic(env, uid, badges, held, now) {
  const todo = badges.filter((b) => b.rule && !held.has(b.id));
  if (!todo.length) return null;
  const facts = await solveFacts(env, uid);
  const won = todo.filter((b) => RULES[b.rule.kind].value(facts, b.rule) >= b.rule.count);
  if (won.length) {
    // One award per badge per player, even if two checks run at once.
    const add = env.DB.prepare(`INSERT INTO badge_awards (badge_id, user_id, source, awarded_at)
      SELECT ?1, ?2, 'auto', ?3 WHERE NOT EXISTS (SELECT 1 FROM badge_awards WHERE badge_id = ?1 AND user_id = ?2)`);
    await env.DB.batch(won.map((b) => add.bind(b.id, uid, now)));
  }
  return facts;
}

async function activeBadges(env) {
  const { results } = await env.DB.prepare('SELECT id, name, icon, description, rule, sort FROM special_badges WHERE active = 1 ORDER BY sort, id').all();
  return results.map((b) => ({ ...b, rule: b.rule ? parseRule(b.rule) : null }));
}

// The signed-in player's special badges, earned first, then the automatic
// ones still to earn with how far along they are.
export async function badgesFor(env, user, now = Date.now()) {
  if (!(await getSettings(env, now)).special_badges_enabled) return { badges: [], goals: [] };
  if (user.email && user.emailVerified) {
    await env.DB.prepare('UPDATE badge_awards SET user_id = ?1 WHERE user_id IS NULL AND email = ?2').bind(user.uid, user.email.toLowerCase()).run();
  }
  const badges = await activeBadges(env);
  if (!badges.length) return { badges: [], goals: [] };
  const mine = async () => (await env.DB.prepare('SELECT badge_id, awarded_at, removed_at FROM badge_awards WHERE user_id = ?1 ORDER BY awarded_at').bind(user.uid).all()).results;
  let rows = await mine();
  const facts = await checkAutomatic(env, user.uid, badges, new Set(rows.map((r) => r.badge_id)), now);
  if (facts) rows = await mine();
  const at = new Map();
  for (const r of rows) if (r.removed_at == null && !at.has(r.badge_id)) at.set(r.badge_id, r.awarded_at);
  const ever = new Set(rows.map((r) => r.badge_id));
  const shape = (b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description || ruleText(b.rule) });
  return {
    badges: badges.filter((b) => at.has(b.id)).map((b) => ({ ...shape(b), at: at.get(b.id) })),
    // A removed automatic badge is not shown as a goal: it cannot come back by itself.
    goals: badges.filter((b) => b.rule && !ever.has(b.id)).map((b) => ({
      ...shape(b), how: ruleText(b.rule), need: b.rule.count, have: facts ? Math.min(b.rule.count, RULES[b.rule.kind].value(facts, b.rule)) : 0,
    })),
  };
}

// For the scoreboard: each of these players' special badges (icon and name),
// as a Map of player id to a list, at most `max` each.
export async function specialBadgesFor(env, uids, max = 3) {
  if (!uids.length) return new Map();
  try {
    const { results } = await env.DB.prepare(`SELECT a.user_id AS uid, b.name, b.icon FROM badge_awards a JOIN special_badges b ON b.id = a.badge_id
      WHERE a.removed_at IS NULL AND b.active = 1 AND a.user_id IN (SELECT value FROM json_each(?1))
      GROUP BY a.user_id, b.id ORDER BY b.sort, b.id`).bind(JSON.stringify(uids)).all();
    const out = new Map();
    for (const r of results) {
      const list = out.get(r.uid) || [];
      if (list.length < max) list.push({ name: r.name, icon: r.icon });
      out.set(r.uid, list);
    }
    return out;
  } catch (e) {
    return new Map(); // tables not made yet
  }
}

// For the admin's player page: the badges this player has now.
export async function playerBadges(env, uid) {
  try {
    const { results } = await env.DB.prepare(`SELECT a.id AS awardId, a.badge_id AS badgeId, b.name, b.icon, b.active, a.source, a.note, a.awarded_at AS at, a.awarded_by AS by
      FROM badge_awards a JOIN special_badges b ON b.id = a.badge_id WHERE a.user_id = ?1 AND a.removed_at IS NULL ORDER BY b.sort, b.id`).bind(uid).all();
    return results.map((r) => ({ ...r, active: !!r.active }));
  } catch (e) {
    return [];
  }
}

// When an account is deleted: its badges go with it.
export const deleteBadgeStatements = (env, uid) => [env.DB.prepare('DELETE FROM badge_awards WHERE user_id = ?1').bind(uid)];

export async function handleBadges(req, env, url, signedIn) {
  if (url.pathname !== '/v1/badges' || req.method !== 'GET') return null;
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
  return json(req, env, await badgesFor(env, user));
}

// ------------------------------------------------------------- admin
const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// Who an admin typed: an email, a screen name or a player id.
async function findPlayer(env, raw) {
  const text = str(raw, 254);
  if (!text) return null;
  const email = cleanEmail(text);
  if (email) return { email, label: email };
  const byName = await env.DB.prepare('SELECT user_id, screen_name FROM players WHERE name_key = ?1').bind(nameKey(text)).first();
  if (byName) return { uid: byName.user_id, label: byName.screen_name };
  if (UID.test(text)) {
    const known = await env.DB.prepare(`SELECT (SELECT 1 FROM players WHERE user_id = ?1) AS p, (SELECT 1 FROM sync_users WHERE user_id = ?1) AS s,
      (SELECT 1 FROM scores WHERE user_id = ?1 LIMIT 1) AS c`).bind(text).first();
    if (known && (known.p || known.s || known.c)) return { uid: text, label: text };
  }
  return null;
}

export function badgeRoutes(Refusal, { onChange = () => {} } = {}) {
  const read = (body, now) => {
    const name = str(body.name, 40);
    if (!name) throw new Refusal(400, 'name', 'Give the badge a name.');
    const icon = str(body.icon, 16);
    if (!icon) throw new Refusal(400, 'icon', 'Choose an icon, such as an emoji.');
    if (/[<>&"]/.test(icon)) throw new Refusal(400, 'icon', 'Use an emoji or a few letters for the icon.');
    const rule = checkRule(body.rule);
    if (typeof rule === 'string') throw new Refusal(400, 'rule', rule);
    const sort = Number.isInteger(Number(body.sort)) && body.sort !== '' && body.sort != null ? Math.max(0, Math.min(9999, Number(body.sort))) : null;
    return { name, icon, description: str(body.description, 200), rule, active: body.active === false ? 0 : 1, sort, now };
  };
  const badge = async (env, id) => {
    const b = await env.DB.prepare('SELECT * FROM special_badges WHERE id = ?1').bind(Number(id)).first();
    if (!b) throw new Refusal(404, 'not_found', 'That badge is gone.');
    return b;
  };
  return [
    ['GET', /^badges$/, 'viewer', 'badges.view', async ({ env, now }) => {
      const [{ results: list }, settings] = await Promise.all([
        env.DB.prepare(`SELECT b.*, (SELECT COUNT(DISTINCT COALESCE(a.user_id, a.email)) FROM badge_awards a WHERE a.badge_id = b.id AND a.removed_at IS NULL) AS holders
          FROM special_badges b ORDER BY b.sort, b.id`).all(),
        getSettings(env, now),
      ]);
      return {
        body: {
          enabled: !!settings.special_badges_enabled,
          badges: list.map((b) => {
            const rule = b.rule ? parseRule(b.rule) : null;
            return { id: b.id, name: b.name, icon: b.icon, description: b.description, rule, how: ruleText(rule), active: !!b.active, sort: b.sort, holders: b.holders, createdAt: b.created_at, createdBy: b.created_by };
          }),
          kinds: Object.entries(RULES).map(([id, r]) => ({ id, label: r.label, needsTier: !!r.needsTier })),
          tiers: Object.values(TIERS).sort((a, b) => a.order - b.order).map((t) => ({ id: t.id, name: t.name })),
        },
        quiet: true,
      };
    }],
    ['POST', /^badges$/, 'admin', 'badges.add', async ({ env, body, who, now }) => {
      const b = read(body, now);
      const sort = b.sort ?? ((await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM special_badges').first('n')) || 1);
      const r = await env.DB.prepare(`INSERT INTO special_badges (name, icon, description, rule, active, sort, created_at, created_by, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7) RETURNING id`).bind(b.name, b.icon, b.description, b.rule ? JSON.stringify(b.rule) : null, b.active, sort, now, who.actor).first();
      onChange();
      return { body: { id: r.id }, target: r.id, detail: { name: b.name, rule: b.rule } };
    }],
    ['POST', /^badges\/(\d{1,12})$/, 'admin', 'badges.change', async ({ env, params: [id], body, now }) => {
      const old = await badge(env, id);
      const b = read(body, now);
      await env.DB.prepare('UPDATE special_badges SET name = ?2, icon = ?3, description = ?4, rule = ?5, active = ?6, sort = ?7, updated_at = ?8 WHERE id = ?1')
        .bind(old.id, b.name, b.icon, b.description, b.rule ? JSON.stringify(b.rule) : null, b.active, b.sort ?? old.sort, now).run();
      onChange();
      return { body: { ok: true }, target: old.id, detail: { name: b.name, rule: b.rule, active: !!b.active } };
    }],
    ['POST', /^badges\/(\d{1,12})\/delete$/, 'admin', 'badges.delete', async ({ env, params: [id] }) => {
      const old = await badge(env, id);
      const [awards] = await env.DB.batch([
        env.DB.prepare('DELETE FROM badge_awards WHERE badge_id = ?1').bind(old.id),
        env.DB.prepare('DELETE FROM special_badges WHERE id = ?1').bind(old.id),
      ]);
      onChange();
      return { body: { deleted: true, awards: awards.meta.changes }, target: old.id, detail: { name: old.name } };
    }],
    ['GET', /^badges\/(\d{1,12})\/holders$/, 'viewer', 'badges.holders', async ({ env, params: [id] }) => {
      const b = await badge(env, id);
      const { results } = await env.DB.prepare(`SELECT a.id, a.user_id AS uid, a.email, a.source, a.note, a.awarded_at AS at, a.awarded_by AS by,
          a.removed_at AS removedAt, a.removed_by AS removedBy, p.screen_name AS name
        FROM badge_awards a LEFT JOIN players p ON p.user_id = a.user_id WHERE a.badge_id = ?1
        ORDER BY a.removed_at IS NOT NULL, a.awarded_at DESC LIMIT 500`).bind(b.id).all();
      return { body: { badge: { id: b.id, name: b.name, icon: b.icon }, holders: results }, quiet: true };
    }],
    ['POST', /^badges\/(\d{1,12})\/award$/, 'moderator', 'badges.award', async ({ env, params: [id], body, who, now }) => {
      const b = await badge(env, id);
      const target = typeof body.uid === 'string' && UID.test(body.uid) ? { uid: body.uid, label: body.uid } : await findPlayer(env, body.who);
      if (!target) throw new Refusal(404, 'no_player', 'No player found. Type their email, screen name or player id.');
      const has = await env.DB.prepare('SELECT 1 FROM badge_awards WHERE badge_id = ?1 AND removed_at IS NULL AND ((?2 IS NOT NULL AND user_id = ?2) OR (?3 IS NOT NULL AND email = ?3))')
        .bind(b.id, target.uid || null, target.email || null).first();
      if (has) throw new Refusal(409, 'has_it', `${target.label} already has ${b.name}.`);
      await env.DB.prepare('INSERT INTO badge_awards (badge_id, user_id, email, source, note, awarded_at, awarded_by) VALUES (?1, ?2, ?3, \'admin\', ?4, ?5, ?6)')
        .bind(b.id, target.uid || null, target.email || null, str(body.note, 200) || null, now, who.actor).run();
      onChange();
      return { body: { ok: true, who: target.label }, target: target.uid || target.email, detail: { badge: b.name } };
    }],
    ['POST', /^badges\/awards\/(\d{1,12})\/remove$/, 'moderator', 'badges.remove', async ({ env, params: [id], who, now }) => {
      const r = await env.DB.prepare('UPDATE badge_awards SET removed_at = ?2, removed_by = ?3 WHERE id = ?1 AND removed_at IS NULL').bind(Number(id), now, who.actor).run();
      onChange();
      return { body: { removed: r.meta.changes }, target: id };
    }],
  ];
}
