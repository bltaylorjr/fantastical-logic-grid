// Automatic deletion of inactive accounts, and of accounts that never chose
// a screen name.
//
// An account is inactive when it has had no activity for inactive_delete_days
// (30): no plays, syncs or changes on the game server (the same rule as the
// admin player list) and no sign-in or opened session in Firebase (lastLoginAt
// and lastRefreshAt, so a player who only signs in still counts as active).
//
//   inactive_warn_days (7) before that day, a player with an email address
//   gets a warning email ("sign in to keep your account"), sent by the GitHub
//   Action .github/workflows/inactive-warning.yml through the admin routes
//   inactive-warnings/claim and inactive-warnings/done.
//
//   Every night at 2 am Eastern (nightly.js), accounts past the day are
//   deleted: first the Firebase sign-in, then all their data here (the same
//   statements as the player's own Delete account, sync.js). A player with an
//   email is only deleted once their warning was sent at least
//   inactive_warn_days ago; one with no email (or one the mail service
//   refused) is deleted without a warning. At most MAX_PER_NIGHT a night, each
//   one written to the admin audit log as "auto-cleanup".
//
// Every account needs a screen name. An account without one (a sync_users row
// with no players row) is emailed a link to its account page, where a name is
// suggested, and is deleted unnamed_grace_days (3) after that email if it
// still has no name, whatever its activity. One with no email address gets
// the same days from the night it is first found ('notice').
//
// Never deleted: the screen names in KEEP_NAMES, every admin and the owner (by
// email), and blocked players (so a ban keeps working).
//
// Nothing happens while inactive_delete_enabled is off (the default) or the
// FIREBASE_SERVICE_ACCOUNT secret (a Firebase Admin SDK service account's
// JSON key) is missing. GET /admin/v1/inactive-accounts shows who is next.
import { getSettings } from './settings.js';
import { googleToken } from './search.js';
import { nameKey } from './names.js';
import { deleteAccountStatements } from './sync.js';

export const DAY = 24 * 3600_000;
export const KEEP_NAMES = ['Fan_Logic_Admin', 'CobaltSockMonkey18', 'CobaltSockMonkey'];
const KEEP_KEYS = new Set(KEEP_NAMES.map(nameKey));
const MAX_PER_NIGHT = 50;
const MAX_CANDIDATES = 300;
const CLAIM_MAX = 100;
const LOOKUP_CHUNK = 100;
const FIREBASE_API = 'https://identitytoolkit.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const ACCOUNT_URL = 'https://thelogicgrid.com/account/';
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// Every account (screen name, synced saves or both) with its last activity on
// the game server and which section of the admin player list it is in. ?1 is now.
export const PLAYER_ROWS = `WITH ids AS (SELECT user_id FROM players UNION SELECT user_id FROM sync_users),
  base AS (SELECT i.user_id AS uid, pl.screen_name AS name, pl.name_key, pl.email,
    CASE WHEN pl.created_at IS NULL THEN u.created_at WHEN u.created_at IS NULL THEN pl.created_at ELSE MIN(pl.created_at, u.created_at) END AS joined,
    u.user_id IS NOT NULL AS synced,
    (r.name_key IS NOT NULL AND r.name_key = pl.name_key) AS approved, r.reviewed_by AS approvedBy,
    (SELECT COALESCE(SUM(points), 0) FROM scores s WHERE s.user_id = i.user_id) AS points,
    (SELECT COUNT(*) FROM scores s WHERE s.user_id = i.user_id) AS solves,
    (SELECT COUNT(*) FROM race_entries e WHERE e.user_id = i.user_id) AS races,
    MAX(COALESCE(pl.updated_at, 0), COALESCE(u.created_at, 0),
      COALESCE((SELECT MAX(updated_at) FROM sync_records x WHERE x.user_id = i.user_id), 0),
      COALESCE((SELECT MAX(created_at) FROM scores s WHERE s.user_id = i.user_id), 0),
      COALESCE((SELECT MAX(joined_at) FROM race_entries e WHERE e.user_id = i.user_id), 0)) AS seen,
    b.user_id IS NOT NULL AS banned, b.reason AS banReason, b.until AS banUntil
    FROM ids i LEFT JOIN players pl ON pl.user_id = i.user_id LEFT JOIN sync_users u ON u.user_id = i.user_id
    LEFT JOIN name_reviews r ON r.user_id = i.user_id
    LEFT JOIN bans b ON b.user_id = i.user_id AND (b.until IS NULL OR b.until > ?1)),
  rows AS (SELECT *, CASE WHEN banned THEN 'blocked' WHEN name IS NULL THEN 'account' WHEN NOT approved THEN 'pending'
    WHEN seen < ?1 - ${30 * DAY} THEN 'inactive' ELSE 'active' END AS section FROM base)`;

const lower = (v) => String(v || '').trim().toLowerCase();

export function firebaseReady(env) {
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '');
    return !!(sa.client_email && sa.private_key && env.FIREBASE_PROJECT_ID);
  } catch (e) { return false; }
}

// A small Firebase Admin client: look accounts up and delete them. Tests set
// env.TEST_FIREBASE_API to a fake.
async function firebase(env) {
  const base = `${env.TEST_FIREBASE_API || FIREBASE_API}/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}`;
  const token = env.TEST_FIREBASE_API ? 'test' : await googleToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT), SCOPE);
  const post = async (path, body) => {
    const res = await fetch(`${base}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firebase ${path}: ${res.status} ${data?.error?.message || ''}`.trim());
    return data;
  };
  return {
    // uid -> { email, emailVerified, active } for the accounts Firebase still has.
    async lookup(uids) {
      const out = new Map();
      for (let i = 0; i < uids.length; i += LOOKUP_CHUNK) {
        const { users = [] } = await post('accounts:lookup', { localId: uids.slice(i, i + LOOKUP_CHUNK) });
        for (const u of users) {
          const login = Number(u.lastLoginAt) || 0;
          const refresh = Date.parse(u.lastRefreshAt || '') || 0;
          out.set(u.localId, { email: lower(u.email), emailVerified: !!u.emailVerified, active: Math.max(login, refresh) });
        }
      }
      return out;
    },
    // The uids Firebase could not delete.
    async remove(uids) {
      if (!uids.length) return new Set();
      const { errors = [] } = await post('accounts:batchDelete', { localIds: uids, force: true });
      return new Set(errors.map((e) => uids[e.index]).filter(Boolean));
    },
  };
}

async function keptEmails(env) {
  const { results } = await env.DB.prepare('SELECT email FROM admins').all();
  return new Set([lower(env.OWNER_EMAIL), ...results.map((r) => lower(r.email))].filter(Boolean));
}

// Accounts quiet on the game server since before `cutoff`, oldest first, with
// the reason each one is kept (if it is). Firebase sign-ins are checked after.
async function quietAccounts(env, s, cutoff, now) {
  const { results } = await env.DB.prepare(`${PLAYER_ROWS}
    SELECT rows.uid, rows.name, rows.name_key, rows.email, rows.seen, rows.joined, rows.banned,
      w.kind, w.token, w.email AS warnEmail, w.claimed_at AS claimedAt, w.sent_at AS sentAt, w.unreachable
    FROM rows LEFT JOIN inactive_warnings w ON w.user_id = rows.uid
    WHERE rows.seen < ?2 OR (?4 AND rows.name IS NULL) ORDER BY rows.name IS NOT NULL, rows.seen, rows.uid LIMIT ?3`)
    .bind(now, cutoff, MAX_CANDIDATES, s.unnamed_grace_days > 0 ? 1 : 0).all();
  const admins = await keptEmails(env);
  return results.map((r) => {
    let keep = null;
    if (r.name_key && KEEP_KEYS.has(r.name_key)) keep = 'kept name';
    else if (r.email && admins.has(lower(r.email))) keep = 'admin';
    else if (r.banned) keep = 'blocked';
    return { ...r, keep, admins };
  });
}

// Joins in Firebase: last sign-in, and the address to warn (a confirmed one
// from Firebase, else the one the game kept from the player's own sign-ins).
function withFirebase(rows, fb) {
  return rows.map((r) => {
    const f = fb ? fb.get(r.uid) : null;
    const active = Math.max(r.seen || 0, f ? f.active : 0);
    let email = f && f.emailVerified && EMAIL.test(f.email) ? f.email : '';
    if (!email && r.email && EMAIL.test(lower(r.email))) email = lower(r.email);
    let keep = r.keep;
    if (!keep && f && f.email && r.admins.has(f.email)) keep = 'admin';
    return { ...r, keep, active, email, inFirebase: !!f };
  });
}

// What happens to one account next: 'kept', 'active' (came back), 'warn'
// (a warning email is due), 'notice' (no screen name and no email: the days
// start tonight), 'waiting' (warned, waiting out the days) or 'delete' (due
// tonight). kind says which rule: 'inactive' or 'name'. deleteOn is the
// earliest night it can go.
function stage(r, s, now) {
  const canWarn = !!r.email && !(r.unreachable && r.warnEmail === r.email);
  if (r.keep) return { stage: 'kept', kind: null, deleteOn: null };
  if (!r.name && s.unnamed_grace_days > 0) {
    const grace = s.unnamed_grace_days * DAY;
    const started = r.kind === 'name' && r.sentAt ? r.sentAt : 0;
    if (!started) return { stage: canWarn ? 'warn' : 'notice', kind: 'name', deleteOn: now + grace };
    const due = started + grace;
    return { stage: due <= now ? 'delete' : 'waiting', kind: 'name', deleteOn: due };
  }
  const deleteAt = r.active + s.inactive_delete_days * DAY;
  const warnAt = deleteAt - s.inactive_warn_days * DAY;
  if (r.active >= now - (s.inactive_delete_days - s.inactive_warn_days) * DAY) return { stage: 'active', kind: 'inactive', deleteOn: deleteAt };
  const warned = r.kind !== 'name' && r.sentAt && r.sentAt >= r.active;
  if (canWarn && !warned) return { stage: 'warn', kind: 'inactive', deleteOn: Math.max(deleteAt, now + s.inactive_warn_days * DAY), warnAt };
  const due = Math.max(deleteAt, warned ? r.sentAt + s.inactive_warn_days * DAY : 0);
  return { stage: due <= now ? 'delete' : 'waiting', kind: 'inactive', deleteOn: due };
}

async function plan(env, s, now, { needFirebase = true } = {}) {
  const ready = firebaseReady(env);
  const rows = await quietAccounts(env, s, now - (s.inactive_delete_days - s.inactive_warn_days) * DAY, now);
  let fb = null;
  let client = null;
  if (ready && rows.length) {
    client = await firebase(env);
    fb = await client.lookup(rows.filter((r) => !r.keep).map((r) => r.uid));
  } else if (needFirebase && !ready) return { ready, client, rows: [] };
  return { ready, client, rows: withFirebase(rows, fb).map((r) => ({ ...r, ...stage(r, s, now) })) };
}

// The nightly run (nightly.js).
export async function deleteInactive(env, now = Date.now()) {
  const s = await getSettings(env, now);
  if (!s.inactive_delete_enabled) return { off: true };
  if (!firebaseReady(env)) return { off: true, missing: 'FIREBASE_SERVICE_ACCOUNT' };
  const { client, rows } = await plan(env, s, now);
  // No screen name and no email: the days start tonight.
  const notice = rows.filter((r) => r.stage === 'notice');
  if (notice.length) {
    await env.DB.batch(notice.map((r) => env.DB.prepare(`INSERT INTO inactive_warnings (user_id, kind, token, email, claimed_at, sent_at, unreachable) VALUES (?1, 'name', ?2, NULL, NULL, ?3, 1)
      ON CONFLICT (user_id) DO UPDATE SET kind = 'name', sent_at = ?3, unreachable = 1`).bind(r.uid, newToken(), now)));
  }
  const due = rows.filter((r) => r.stage === 'delete').slice(0, MAX_PER_NIGHT);
  if (!due.length) return { deleted: 0, noticed: notice.length };
  // Firebase first: if it cannot delete a sign-in, the data stays for tomorrow.
  const failed = await client.remove(due.filter((r) => r.inFirebase).map((r) => r.uid));
  const gone = due.filter((r) => !failed.has(r.uid));
  for (let i = 0; i < gone.length; i += 10) {
    const part = gone.slice(i, i + 10);
    const stmts = [];
    for (const r of part) {
      stmts.push(...(await deleteAccountStatements(env, r.uid, now)));
      stmts.push(env.DB.prepare("INSERT INTO admin_audit (at, actor, role, action, target, detail, status) VALUES (?1, 'auto-cleanup', 'owner', 'players.auto_delete', ?2, ?3, 200)")
        .bind(now, r.uid, JSON.stringify({ rule: r.kind, name: r.name || null, lastActive: r.active, warned: r.sentAt || null })));
    }
    await env.DB.batch(stmts);
  }
  return { deleted: gone.length, noticed: notice.length, firebaseFailed: failed.size, more: rows.filter((r) => r.stage === 'delete').length > due.length };
}

// For the admin dashboard: the settings, whether Firebase is set up, and the
// accounts nearest to deletion with what happens to each next.
export async function inactiveOverview(env, now = Date.now()) {
  const s = await getSettings(env, now);
  const { ready, rows } = await plan(env, s, now, { needFirebase: false });
  const counts = { delete: 0, waiting: 0, warn: 0, notice: 0, kept: 0, active: 0 };
  for (const r of rows) counts[r.stage] += 1;
  const last = await env.DB.prepare("SELECT at FROM admin_audit WHERE action = 'players.auto_delete' ORDER BY at DESC LIMIT 1").first();
  return {
    enabled: !!s.inactive_delete_enabled, days: s.inactive_delete_days, warnDays: s.inactive_warn_days, nameDays: s.unnamed_grace_days,
    firebase: ready, keepNames: KEEP_NAMES, counts, lastDeletedAt: last ? last.at : null, more: rows.length >= MAX_CANDIDATES,
    accounts: rows.filter((r) => r.stage !== 'active').slice(0, 100).map((r) => ({
      uid: r.uid, name: r.name, joined: r.joined, lastActive: r.active || null, stage: r.stage, rule: r.kind, keep: r.keep,
      deleteOn: r.deleteOn, hasEmail: !!r.email, warnedAt: r.kind === 'name' ? r.sentAt || null : (r.sentAt && r.sentAt >= r.active ? r.sentAt : null),
    })),
  };
}

const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
const isToken = (t) => typeof t === 'string' && /^[0-9a-f]{32}$/.test(t);

// For the warning Action: up to `limit` accounts whose warning is due, marked
// as claimed so a second run the same day does not send twice. Addresses are
// never written to the audit log.
export async function claimWarnings(env, limit, now = Date.now()) {
  const s = await getSettings(env, now);
  if (!s.inactive_delete_enabled) return { off: true, list: [] };
  if (!firebaseReady(env)) return { off: true, missing: 'FIREBASE_SERVICE_ACCOUNT', list: [] };
  const n = Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX));
  const { rows } = await plan(env, s, now);
  const due = rows.filter((r) => r.stage === 'warn' && !(r.claimedAt && r.claimedAt > now - DAY)).slice(0, n);
  const list = due.map((r) => ({ uid: r.uid, kind: r.kind, token: newToken(), email: r.email, name: r.name || '', deleteOn: new Date(r.deleteOn).toISOString().slice(0, 10) }));
  if (list.length) {
    await env.DB.batch(list.map((x) => env.DB.prepare(`INSERT INTO inactive_warnings (user_id, kind, token, email, claimed_at, sent_at, unreachable) VALUES (?1, ?5, ?2, ?3, ?4, NULL, 0)
      ON CONFLICT (user_id) DO UPDATE SET kind = ?5, token = ?2, email = ?3, claimed_at = ?4, sent_at = NULL, unreachable = 0`).bind(x.uid, x.token, x.email, now, x.kind)));
  }
  return { off: false, list: list.map(({ uid, ...x }) => x), days: s.inactive_delete_days, warnDays: s.inactive_warn_days, nameDays: s.unnamed_grace_days, accountUrl: ACCOUNT_URL };
}

// The Action reports back: sent (the warning days start now), failed (tried
// again on the next run) and refused (the address does not work: the account
// is then deleted without a warning).
export async function finishWarnings(env, { sent, failed, refused } = {}, now = Date.now()) {
  const tokens = (v) => (Array.isArray(v) ? v : []).filter(isToken).slice(0, CLAIM_MAX);
  const db = env.DB;
  const stmts = [
    ...tokens(sent).map((t) => db.prepare('UPDATE inactive_warnings SET sent_at = ?2 WHERE token = ?1').bind(t, now)),
    ...tokens(failed).map((t) => db.prepare('UPDATE inactive_warnings SET claimed_at = NULL WHERE token = ?1').bind(t)),
    ...tokens(refused).map((t) => db.prepare('UPDATE inactive_warnings SET unreachable = 1 WHERE token = ?1').bind(t)),
  ];
  if (stmts.length) await db.batch(stmts);
  return { sent: tokens(sent).length, retry: tokens(failed).length, refused: tokens(refused).length };
}
