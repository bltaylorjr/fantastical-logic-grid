// The admin dashboard: the app in admin/ (served from here as static files)
// and its API. Every /admin request is rate limited by connection, and every
// /admin/v1 request is signed in, checked against the admin's role, limited
// per admin and written to the audit log.
//
//   GET  /admin/                       the dashboard (admin/index.html)
//   GET  /admin/v1/client-config       the Firebase web key the sign-in form needs
//   GET  /admin/v1/me                  who is signed in and their role
//   GET  /admin/v1/analytics?days=     players, games, scores, races, voices, errors
//   GET  /admin/v1/storage             rows per table, database size, free limits
//   GET  /admin/v1/usage?days=         Cloudflare's own request and D1 counts (optional token)
//   GET  /admin/v1/search              Google and Bing search numbers (search.js); POST .../refresh
//   GET  /admin/v1/errors?days=        error reports, most frequent first
//   GET  /admin/v1/parts?status=       shared story parts; POST /admin/v1/parts/review
//   GET  /admin/v1/workshop            Story workshop choices; POST .../draft (AI writer), .../add
//   GET  /admin/v1/feedback?kind=&status=  ideas and problems from the game; POST .../:id (done|new|delete)
//   GET  /admin/v1/names?status=       screen names to moderate; POST /admin/v1/names/:uid/approve
//   GET  /admin/v1/players?q=&filter=  players with screen names; GET /admin/v1/players/:uid
//   POST /admin/v1/players/:uid/(rename|ban|unban|reset-scores|delete)
//   GET/POST /admin/v1/settings        feature switches and limits (settings.js)
//   GET/POST /admin/v1/announcements   messages in the game; POST .../:id/(end|delete)
//   GET  /admin/v1/audit               the audit log
//   GET/POST /admin/v1/admins          who may sign in (owner only); POST /admin/v1/admins/remove
//   GET  /admin/v1/archive             the weekly archive: setup, what goes, past runs (archive.js)
//   POST /admin/v1/archive/run         send the archive email now (owner)
//   GET  /admin/v1/archive/download    the same zip as a download, nothing removed (owner)
//   POST /admin/v1/archive/export[?test=1]  the zip for the weekly GitHub Action to email (owner)
//   POST /admin/v1/archive/confirm     that Action says the email went out; rows may now go (owner)
//
// Sign-in: a Firebase ID token from a game account with a confirmed email that
// is the OWNER_EMAIL secret or listed in the admins table. The ADMIN_TOKEN
// secret still works as a break-glass key with the owner's rights.
//
// Privacy: anonymous learning data (plays, parts) is only ever counted on its
// own. Nothing here joins it to accounts, and saved puzzles are only counted,
// never shown.
import { json, readText, TooLarge } from './http.js';
import { verifyIdToken, AuthError } from './auth.js';
import { checkName, cleanName, nameKey, hasBlockedWords } from './names.js';
import { deleteCompeteStatements, clearBoardCache } from './compete.js';
import { SETTINGS, getSettings, checkSetting, saveSetting, themeList } from './settings.js';
import { TUNING_CACHE_KEY } from './learn.js';
import { refreshSearch, searchSnapshots, lastTry, REFRESH_GAP_MS } from './search.js';
import { workshopOptions, addPart, draftParts } from './workshop.js';
import { TOPICS as FEEDBACK_TOPICS } from './feedback.js';
import { archiveStatus, runArchive, buildArchive, exportArchive, confirmArchive } from './archive.js';

const DAY = 24 * 3600_000;
const ROLES = { viewer: 1, moderator: 2, admin: 3, owner: 4 };
const STORED_ROLES = ['admin', 'moderator', 'viewer'];
const MAX_BODY = 8_000;
// An admin must sign in again (with their password) at least this often, even
// while the dashboard keeps refreshing their token; the dashboard itself signs
// out after 30 idle minutes.
const SESSION_MAX_S = 12 * 3600;
const DENIED_PER_DAY = 500; // refused requests written to the audit log, so a flood cannot fill it
const ANALYTICS_CACHE_MS = 120_000;
const TABLES = ['sync_users', 'sync_records', 'sync_deleted_users', 'players', 'scores', 'races', 'race_entries', 'race_invites', 'plays', 'parts', 'usage',
  'app_errors', 'upkeep_log', 'admins', 'admin_audit', 'settings', 'announcements', 'bans', 'name_reviews', 'archive_log', 'feedback', 'search_snapshots'];
// Free plan allowances (Cloudflare and Firebase pages, October 2026).
export const FREE_LIMITS = {
  workerRequestsPerDay: 100_000, d1RowsReadPerDay: 5_000_000, d1RowsWrittenPerDay: 100_000,
  d1DatabaseBytes: 500 * 1024 * 1024, d1AccountBytes: 5 * 1024 * 1024 * 1024, firebaseMonthlyActiveUsers: 50_000,
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-cache',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), interest-cohort=()',
};

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekStart = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); };
const dayStart = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const daysParam = (url, max = 90) => Math.min(max, Math.max(1, Number(url.searchParams.get('days')) || 30));

class Refusal extends Error {
  constructor(status, error, message) { super(message || error); this.status = status; this.error = error; }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const bearer = (req) => (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1] || '';
// Trimmed: a secret pasted into the Cloudflare dashboard can carry a stray space or line break.
const tokenMatches = (env, token) => { const want = String(env.ADMIN_TOKEN || '').trim(); return want.length >= 16 && safeEqual(token.trim(), want); };

// ------------------------------------------------------------- identity
async function identify(req, env) {
  const token = bearer(req);
  if (!token) throw new Refusal(401, 'sign_in', 'Please sign in.');
  if (tokenMatches(env, token)) return { actor: 'break-glass token', role: 'owner', key: 'token' };
  if (token.split('.').length !== 3) throw new Refusal(401, 'sign_in', 'That key is not right.');
  let user;
  try { user = await verifyIdToken(token, env); } catch (e) {
    if (e instanceof AuthError) throw new Refusal(401, 'sign_in', 'Please sign in again.');
    throw e;
  }
  if (Date.now() / 1000 - user.authTime > SESSION_MAX_S) throw new Refusal(401, 'sign_in', 'For safety, please sign in again.');
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) throw new Refusal(403, 'not_admin', 'This account is not an admin.');
  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  let role = owner && email === owner ? 'owner' : null;
  if (!role) {
    const row = await env.DB.prepare('SELECT role FROM admins WHERE email = ?1').bind(email).first();
    if (!row || !STORED_ROLES.includes(row.role)) throw new Refusal(403, 'not_admin', 'This account is not an admin.');
    role = row.role;
  }
  // Anyone can make a Firebase account with an email they do not own, so an
  // admin's email must be confirmed.
  if (!user.emailVerified) throw new Refusal(403, 'verify_email', 'Confirm your email address first.');
  return { actor: email, role, key: user.uid, uid: user.uid };
}

async function audit(env, entry) {
  const now = Date.now();
  if (entry.actor === 'unknown') {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE actor = 'unknown' AND at >= ?1").bind(dayStart(now)).first();
    if (n >= DENIED_PER_DAY) return;
  }
  const detail = entry.detail === undefined ? null : JSON.stringify(entry.detail).slice(0, 2000);
  await env.DB.prepare('INSERT INTO admin_audit (at, actor, role, action, target, detail, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(now, entry.actor, entry.role || null, entry.action, entry.target == null ? null : String(entry.target).slice(0, 200), detail, entry.status).run();
}

// ------------------------------------------------------------- analytics
let analyticsCache = new Map();

async function analytics(env, days, now = Date.now()) {
  const hit = analyticsCache.get(days);
  if (hit && now - hit.at < ANALYTICS_CACHE_MS) return hit.body;
  const db = env.DB;
  const since = dayStart(now) - (days - 1) * DAY;
  const sinceDay = isoDay(since);
  const q = {
    accounts: db.prepare('SELECT COUNT(*) AS n FROM sync_users'),
    accountsByDay: db.prepare("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM sync_users WHERE created_at >= ?1 GROUP BY day").bind(since),
    deleted: db.prepare('SELECT COUNT(*) AS n FROM sync_deleted_users WHERE deleted_at >= ?1').bind(since),
    names: db.prepare('SELECT COUNT(*) AS n FROM players'),
    newNames: db.prepare('SELECT COUNT(*) AS n FROM players WHERE created_at >= ?1').bind(since),
    banned: db.prepare('SELECT COUNT(*) AS n FROM bans WHERE until IS NULL OR until > ?1').bind(now),
    active7: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE created_at >= ?1').bind(now - 7 * DAY),
    activePeriod: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE created_at >= ?1').bind(since),
    playsByDay: db.prepare("SELECT day, COUNT(*) AS n, SUM(outcome = 'solved') AS solved FROM plays WHERE day >= ?1 GROUP BY day").bind(sinceDay),
    playsByTheme: db.prepare(`SELECT theme AS id, COUNT(*) AS n, SUM(outcome = 'solved') AS solved, AVG(rating) AS rating,
      AVG(CASE WHEN outcome = 'solved' THEN minutes END) AS minutes FROM plays WHERE day >= ?1 GROUP BY theme ORDER BY n DESC`).bind(sinceDay),
    playsByTier: db.prepare(`SELECT tier AS id, COUNT(*) AS n, SUM(outcome = 'solved') AS solved, AVG(rating) AS rating,
      AVG(CASE WHEN outcome = 'solved' THEN minutes END) AS minutes, AVG(hints) AS hints FROM plays WHERE day >= ?1 GROUP BY tier`).bind(sinceDay),
    playsByPlatform: db.prepare('SELECT platform AS id, COUNT(*) AS n FROM plays WHERE day >= ?1 GROUP BY platform ORDER BY n DESC').bind(sinceDay),
    outcomes: db.prepare('SELECT outcome AS id, COUNT(*) AS n FROM plays WHERE day >= ?1 GROUP BY outcome').bind(sinceDay),
    feel: db.prepare('SELECT feel AS id, COUNT(*) AS n FROM plays WHERE day >= ?1 AND feel IS NOT NULL GROUP BY feel').bind(sinceDay),
    scoresByDay: db.prepare("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n, SUM(points) AS points FROM scores WHERE created_at >= ?1 GROUP BY day").bind(since),
    scoresByTier: db.prepare('SELECT tier AS id, kind, COUNT(*) AS n, AVG(points) AS points FROM scores WHERE created_at >= ?1 GROUP BY tier, kind').bind(since),
    racesByDay: db.prepare("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM races WHERE created_at >= ?1 GROUP BY day").bind(since),
    raceEntries: db.prepare(`SELECT COUNT(*) AS entries, COALESCE(SUM(finished_at IS NOT NULL), 0) AS finished, COALESCE(SUM(solved), 0) AS solved
      FROM race_entries WHERE code IN (SELECT code FROM races WHERE created_at >= ?1)`).bind(since),
    racesOpen: db.prepare('SELECT COUNT(*) AS n FROM races WHERE closes_at > ?1').bind(now),
    voicesByDay: db.prepare("SELECT day, count AS n FROM usage WHERE name = 'tts' AND day >= ?1").bind(sinceDay),
    errorsByDay: db.prepare('SELECT day, SUM(count) AS n FROM app_errors WHERE day >= ?1 GROUP BY day').bind(sinceDay),
    parts: db.prepare('SELECT status AS id, COUNT(*) AS n FROM parts GROUP BY status'),
    feedbackNew: db.prepare("SELECT kind AS id, COUNT(*) AS n FROM feedback WHERE status = 'new' GROUP BY kind"),
    picturesByDay: db.prepare("SELECT day, count AS n FROM usage WHERE name = 'pictures' AND day >= ?1").bind(sinceDay),
    namesWaiting: db.prepare('SELECT COUNT(*) AS n FROM players p LEFT JOIN name_reviews r ON r.user_id = p.user_id WHERE r.name_key IS NULL OR r.name_key != p.name_key'),
  };
  const names = Object.keys(q);
  const res = await db.batch(Object.values(q));
  const r = Object.fromEntries(names.map((k, i) => [k, res[i].results]));
  const one = (k, f = 'n') => (r[k][0] ? r[k][0][f] || 0 : 0);
  const settings = await getSettings(env, now);
  const dayList = Array.from({ length: days }, (_, i) => isoDay(since + i * DAY));
  const series = (rows, f = 'n') => { const m = new Map(rows.map((x) => [x.day, x[f] || 0])); return dayList.map((d) => m.get(d) || 0); };
  const round = (v, p = 1) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
  const groups = (rows) => rows.map((x) => ({ ...x, rating: round(x.rating, 2), minutes: round(x.minutes), hints: round(x.hints) }));
  const body = {
    days, since: sinceDay, dayList, generatedAt: now,
    players: {
      accounts: one('accounts'), newAccounts: series(r.accountsByDay), deletedAccounts: one('deleted'),
      screenNames: one('names'), newScreenNames: one('newNames'), banned: one('banned'), active7: one('active7'), activePeriod: one('activePeriod'),
    },
    games: {
      note: 'Anonymous summaries from players who share what they play. Never linked to accounts.',
      byDay: series(r.playsByDay), solvedByDay: series(r.playsByDay, 'solved'),
      byTheme: groups(r.playsByTheme), byTier: groups(r.playsByTier), byPlatform: r.playsByPlatform, outcomes: r.outcomes, feel: r.feel,
    },
    scores: { byDay: series(r.scoresByDay), pointsByDay: series(r.scoresByDay, 'points'), byTier: r.scoresByTier.map((x) => ({ ...x, points: round(x.points) })) },
    races: { byDay: series(r.racesByDay), open: one('racesOpen'), ...r.raceEntries[0] },
    voices: { byDay: series(r.voicesByDay), cap: settings.daily_tts_cap, enabled: settings.tts_enabled, today: series(r.voicesByDay).at(-1) },
    pictures: { byDay: series(r.picturesByDay), cap: settings.daily_picture_cap, mode: settings.ai_pictures, today: series(r.picturesByDay).at(-1) },
    errors: { byDay: series(r.errorsByDay) },
    review: { parts: Object.fromEntries(r.parts.map((x) => [x.id, x.n])), namesWaiting: one('namesWaiting'), feedback: Object.fromEntries(r.feedbackNew.map((x) => [x.id, x.n])) },
  };
  analyticsCache.set(days, { at: now, body });
  return body;
}

// Row counts use MAX(rowid), which reads one row per table instead of all of
// them (D1 counts every row a query reads against the free daily allowance).
// Deleted rows leave gaps, so the counts are "up to".
async function storage(env) {
  const res = await env.DB.batch(TABLES.map((t) => env.DB.prepare(`SELECT COALESCE(MAX(rowid), 0) AS n FROM ${t}`)));
  const sizes = res.map((x) => x.meta?.size_after).filter(Number.isFinite);
  return {
    tables: TABLES.map((t, i) => ({ table: t, rows: res[i].results[0].n })),
    databaseBytes: sizes.length ? Math.max(...sizes) : null,
    limits: FREE_LIMITS,
  };
}

// Cloudflare's own daily counts for this Worker and D1, from its GraphQL
// analytics API. Optional: needs the CF_API_TOKEN (Account Analytics: Read)
// and CF_ACCOUNT_ID secrets. Free on every plan.
async function cloudflareUsage(env, days, now = Date.now()) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false, limits: FREE_LIMITS };
  const start = isoDay(now - (days - 1) * DAY);
  const end = isoDay(now);
  const query = `query ($account: String!, $start: Date!, $end: Date!, $script: String!) { viewer { accounts(filter: { accountTag: $account }) {
    d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end }) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date } }
    workers: workersInvocationsAdaptive(limit: 1000, filter: { date_geq: $start, date_leq: $end, scriptName: $script }) { sum { requests errors } dimensions { date } }
  } } }`;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, start, end, script: env.WORKER_NAME || 'flg-api' } }),
    });
    const j = await res.json();
    if (!res.ok || j.errors?.length) return { configured: true, error: (j.errors && j.errors[0]?.message) || `HTTP ${res.status}`, limits: FREE_LIMITS };
    const acct = j.data.viewer.accounts[0] || { d1: [], workers: [] };
    const byDay = {};
    const add = (date, k, v) => { (byDay[date] ||= { date, requests: 0, errors: 0, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 })[k] += v || 0; };
    for (const g of acct.d1) for (const k of ['rowsRead', 'rowsWritten', 'readQueries', 'writeQueries']) add(g.dimensions.date, k, g.sum[k]);
    for (const g of acct.workers) for (const k of ['requests', 'errors']) add(g.dimensions.date, k, g.sum[k]);
    return { configured: true, days: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)), limits: FREE_LIMITS };
  } catch (e) {
    return { configured: true, error: 'Cloudflare did not answer.', limits: FREE_LIMITS };
  }
}

// ------------------------------------------------------------- players
async function findPlayers(env, url, now) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 128);
  const filter = url.searchParams.get('filter') === 'banned' ? 'banned' : 'all';
  const { results } = await env.DB.prepare(`SELECT p.user_id AS uid, p.screen_name AS name, p.created_at AS createdAt, p.updated_at AS updatedAt,
      (SELECT COALESCE(SUM(points), 0) FROM scores s WHERE s.user_id = p.user_id) AS points,
      (SELECT COUNT(*) FROM scores s WHERE s.user_id = p.user_id) AS solves,
      (SELECT MAX(created_at) FROM scores s WHERE s.user_id = p.user_id) AS lastScore,
      b.user_id IS NOT NULL AS banned, b.reason AS banReason, b.until AS banUntil
    FROM players p LEFT JOIN bans b ON b.user_id = p.user_id AND (b.until IS NULL OR b.until > ?1)
    WHERE (?2 = '' OR p.name_key LIKE ?3 OR p.user_id = ?2) AND (?4 = 'all' OR b.user_id IS NOT NULL)
    ORDER BY p.updated_at DESC LIMIT 100`).bind(now, q, `%${nameKey(q)}%`, filter).all();
  // A player id with no screen name (an account that only syncs) is still found.
  if (!results.length && /^[\w-]{6,128}$/.test(q)) {
    const acct = await env.DB.prepare('SELECT created_at FROM sync_users WHERE user_id = ?1').bind(q).first();
    if (acct) return { players: [{ uid: q, name: null, createdAt: acct.created_at, points: 0, solves: 0 }] };
  }
  return { players: results };
}

async function playerDetail(env, uid, now) {
  const db = env.DB;
  const [profile, acct, records, deleted, ban, byKind, recent, hosted, entered, review] = (await db.batch([
    db.prepare('SELECT screen_name AS name, name_key, created_at, updated_at FROM players WHERE user_id = ?1').bind(uid),
    db.prepare('SELECT created_at, rev FROM sync_users WHERE user_id = ?1').bind(uid),
    db.prepare("SELECT COUNT(*) AS n, SUM(kind = 'save' AND deleted = 0) AS saves, COALESCE(SUM(length(data)), 0) AS bytes, MAX(updated_at) AS last FROM sync_records WHERE user_id = ?1").bind(uid),
    db.prepare('SELECT deleted_at FROM sync_deleted_users WHERE user_id = ?1').bind(uid),
    db.prepare('SELECT reason, banned_by, banned_at, until FROM bans WHERE user_id = ?1 AND (until IS NULL OR until > ?2)').bind(uid, now),
    db.prepare('SELECT kind, COUNT(*) AS n, SUM(points) AS points FROM scores WHERE user_id = ?1 GROUP BY kind').bind(uid),
    db.prepare('SELECT story_id AS storyId, kind, tier, cells, elapsed_ms AS elapsedMs, hints, checks, points, created_at AS at FROM scores WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20').bind(uid),
    db.prepare('SELECT COUNT(*) AS n FROM races WHERE host_id = ?1').bind(uid),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(solved), 0) AS solved FROM race_entries WHERE user_id = ?1').bind(uid),
    db.prepare('SELECT name_key, reviewed_by, reviewed_at FROM name_reviews WHERE user_id = ?1').bind(uid),
  ])).map((x) => x.results);
  if (!profile.length && !acct.length && !byKind.length && !deleted.length) throw new Refusal(404, 'no_player', 'No player has that id.');
  const p = profile[0];
  return {
    uid,
    screenName: p ? p.name : null,
    nameSince: p ? p.updated_at : null,
    nameReviewed: !!(p && review[0] && review[0].name_key === p.name_key),
    account: acct[0] ? { createdAt: acct[0].created_at, records: records[0].n, saves: records[0].saves || 0, bytes: records[0].bytes, lastSync: records[0].last } : null,
    deletedAt: deleted[0] ? deleted[0].deleted_at : null,
    ban: ban[0] || null,
    scores: Object.fromEntries(byKind.map((x) => [x.kind, { solves: x.n, points: x.points }])),
    recentScores: recent,
    races: { hosted: hosted[0].n, entered: entered[0].n, solved: entered[0].solved },
  };
}

async function renamePlayer(env, uid, body, who, now) {
  const player = await env.DB.prepare('SELECT screen_name FROM players WHERE user_id = ?1').bind(uid).first();
  if (!player) throw new Refusal(404, 'no_player', 'That player has no screen name.');
  let name;
  if (body.reset) {
    for (let i = 0; i < 10 && !name; i++) {
      const tag = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
      const candidate = `Player ${tag}`;
      if (!(await env.DB.prepare('SELECT 1 FROM players WHERE name_key = ?1').bind(nameKey(candidate)).first())) name = candidate;
    }
  } else {
    const settings = await getSettings(env, now);
    const problem = checkName(body.name, { extra: settings.blocked_words });
    if (problem) throw new Refusal(422, problem.code, problem.message);
    name = cleanName(body.name);
    const taken = await env.DB.prepare('SELECT user_id FROM players WHERE name_key = ?1').bind(nameKey(name)).first();
    if (taken && taken.user_id !== uid) throw new Refusal(409, 'name_taken', 'Another player has that name.');
  }
  if (!name) throw new Refusal(500, 'server');
  const key = nameKey(name);
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET screen_name = ?2, name_key = ?3, updated_at = ?4 WHERE user_id = ?1').bind(uid, name, key, now),
    env.DB.prepare('INSERT OR REPLACE INTO name_reviews (user_id, name_key, reviewed_by, reviewed_at) VALUES (?1, ?2, ?3, ?4)').bind(uid, key, who.actor, now),
  ]);
  clearBoardCache();
  return { body: { screenName: name }, detail: { from: player.screen_name, to: name } };
}

// ------------------------------------------------------------- routes
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const ROUTES = [
  ['GET', /^me$/, 'viewer', 'me', async ({ who }) => ({ body: { email: who.actor, role: who.role, roles: Object.keys(ROLES) } })],

  ['GET', /^analytics$/, 'viewer', 'analytics.view', async ({ env, url }) => ({ body: await analytics(env, daysParam(url)) })],
  ['GET', /^search$/, 'viewer', 'search.view', async ({ env }) => ({ body: { sources: await searchSnapshots(env) } })],
  ['POST', /^search\/refresh$/, 'admin', 'search.refresh', async ({ env, now }) => {
    // Google and Bing are only asked again after a short gap, whoever presses.
    if (now - (await lastTry(env)) < REFRESH_GAP_MS) throw new Refusal(429, 'too_soon', 'The search numbers were fetched a few minutes ago. Try again in 10 minutes.');
    const result = await refreshSearch(env, now);
    return { body: { result, sources: await searchSnapshots(env) }, detail: result };
  }],
  ['GET', /^storage$/, 'viewer', 'storage.view', async ({ env }) => ({ body: await storage(env) })],
  ['GET', /^usage$/, 'viewer', 'usage.view', async ({ env, url }) => ({ body: await cloudflareUsage(env, daysParam(url, 30)) })],

  ['GET', /^errors$/, 'viewer', 'errors.view', async ({ env, url }) => {
    const days = daysParam(url, 30);
    const since = isoDay(Date.now() - (days - 1) * DAY);
    const { results } = await env.DB.prepare(`SELECT kind, platform, version, message, place, SUM(count) AS count, MIN(day) AS first, MAX(day) AS last
      FROM app_errors WHERE day >= ?1 GROUP BY fingerprint ORDER BY count DESC LIMIT 100`).bind(since).all();
    return { body: { since, errors: results } };
  }],

  ['GET', /^parts$/, 'moderator', 'parts.view', async ({ env, url }) => {
    const status = ['pending', 'approved', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const { results } = await env.DB.prepare('SELECT key, theme, kind, value, source, status, submitted, reviewed FROM parts WHERE status = ?1 ORDER BY submitted DESC LIMIT 200').bind(status).all();
    return { body: { status, parts: results.map((r) => ({ ...r, value: JSON.parse(r.value) })) } };
  }],
  ['POST', /^parts\/review$/, 'moderator', 'parts.review', async ({ env, body }) => {
    if (!['approved', 'rejected', 'pending'].includes(body.status)) throw new Refusal(400, 'bad_status');
    const r = await env.DB.prepare('UPDATE parts SET status = ?1, reviewed = ?2 WHERE key = ?3').bind(body.status, new Date().toISOString(), String(body.key)).run();
    if (!r.meta.changes) throw new Refusal(404, 'no_part', 'That story part is gone.');
    await caches.default.delete(new Request(TUNING_CACHE_KEY));
    return { body: { ok: true }, target: body.key, detail: { status: body.status } };
  }],

  ['GET', /^workshop$/, 'moderator', 'workshop.view', async () => ({ body: workshopOptions() })],
  ['POST', /^workshop\/draft$/, 'moderator', 'workshop.draft', async ({ env, body }) => {
    const r = await draftParts(env, (await getSettings(env)).story_model, String(body.story), String(body.kind), String(body.idea || ''));
    if (r.error) throw new Refusal(400, 'draft_failed', r.error);
    return { body: r, target: String(body.story) };
  }],
  ['POST', /^workshop\/add$/, 'moderator', 'workshop.add', async ({ env, body }) => {
    const r = await addPart(env, String(body.story), String(body.kind), body.value, body.source);
    if (!r.ok) throw new Refusal(400, 'bad_part', r.errors.join(' '));
    await caches.default.delete(new Request(TUNING_CACHE_KEY));
    return { body: { ok: true, key: r.key }, target: r.key };
  }],

  ['GET', /^feedback$/, 'moderator', 'feedback.view', async ({ env, url }) => {
    const kind = FEEDBACK_TOPICS[url.searchParams.get('kind')] ? url.searchParams.get('kind') : 'idea';
    const status = ['new', 'done', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'new';
    const { results } = await env.DB.prepare(`SELECT id, kind, topic, text, platform, version, status, created_at AS createdAt, done_at AS doneAt FROM feedback
      WHERE kind = ?1 AND (?2 = 'all' OR status = ?2) ORDER BY created_at DESC LIMIT 200`).bind(kind, status).all();
    const counts = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM feedback WHERE status = 'new' GROUP BY kind").all()).results;
    return { body: { kind, status, items: results, waiting: Object.fromEntries(counts.map((x) => [x.kind, x.n])) } };
  }],
  ['POST', /^feedback\/(\d+)$/, 'moderator', 'feedback.update', async ({ env, params: [id], body, now }) => {
    let r;
    if (body.status === 'delete') r = await env.DB.prepare('DELETE FROM feedback WHERE id = ?1').bind(Number(id)).run();
    else if (['new', 'done'].includes(body.status)) r = await env.DB.prepare('UPDATE feedback SET status = ?1, done_at = ?2 WHERE id = ?3').bind(body.status, body.status === 'done' ? now : null, Number(id)).run();
    else throw new Refusal(400, 'bad_status');
    if (!r.meta.changes) throw new Refusal(404, 'gone', 'That message is gone.');
    analyticsCache.clear();
    return { body: { ok: true }, target: id, detail: { status: body.status } };
  }],

  ['GET', /^names$/, 'moderator', 'names.view', async ({ env, url, now }) => {
    const status = ['pending', 'reviewed', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const { results } = await env.DB.prepare(`SELECT p.user_id AS uid, p.screen_name AS name, p.created_at AS createdAt, p.updated_at AS updatedAt,
        r.reviewed_by AS reviewedBy, r.reviewed_at AS reviewedAt, (r.name_key IS NOT NULL AND r.name_key = p.name_key) AS reviewed,
        EXISTS (SELECT 1 FROM bans b WHERE b.user_id = p.user_id AND (b.until IS NULL OR b.until > ?2)) AS banned
      FROM players p LEFT JOIN name_reviews r ON r.user_id = p.user_id
      WHERE ?1 = 'all' OR (?1 = 'pending' AND (r.name_key IS NULL OR r.name_key != p.name_key)) OR (?1 = 'reviewed' AND r.name_key = p.name_key)
      ORDER BY p.updated_at DESC LIMIT 200`).bind(status, now).all();
    const { blocked_words: extra } = await getSettings(env, now);
    // Names that the current word list would refuse (for example after a
    // word was added) are marked so they can be dealt with first.
    const names = results.map((n) => ({ ...n, reviewed: !!n.reviewed, banned: !!n.banned, flagged: !!checkName(n.name, { extra }) || hasBlockedWords(n.name, { extra }) }));
    names.sort((a, b) => b.flagged - a.flagged);
    return { body: { status, names } };
  }],
  ['POST', /^names\/([\w-]{1,128})\/approve$/, 'moderator', 'names.approve', async ({ env, params: [uid], who, now }) => {
    const p = await env.DB.prepare('SELECT name_key, screen_name FROM players WHERE user_id = ?1').bind(uid).first();
    if (!p) throw new Refusal(404, 'no_player', 'That player has no screen name.');
    await env.DB.prepare('INSERT OR REPLACE INTO name_reviews (user_id, name_key, reviewed_by, reviewed_at) VALUES (?1, ?2, ?3, ?4)').bind(uid, p.name_key, who.actor, now).run();
    return { body: { ok: true }, target: uid, detail: { name: p.screen_name } };
  }],

  ['GET', /^players$/, 'moderator', 'players.search', async ({ env, url, now }) => ({ body: await findPlayers(env, url, now), detail: { q: url.searchParams.get('q') || '' } })],
  ['GET', /^players\/([\w-]{1,128})$/, 'moderator', 'players.view', async ({ env, params: [uid], now }) => ({ body: await playerDetail(env, uid, now), target: uid })],
  ['POST', /^players\/([\w-]{1,128})\/rename$/, 'moderator', 'players.rename', async ({ env, params: [uid], body, who, now }) => ({ target: uid, ...(await renamePlayer(env, uid, body, who, now)) })],
  ['POST', /^players\/([\w-]{1,128})\/ban$/, 'moderator', 'players.ban', async ({ env, params: [uid], body, who, now }) => {
    const days = body.days == null ? null : Number(body.days);
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) throw new Refusal(400, 'bad_days', 'Use 1 to 3650 days, or no end.');
    const reason = str(body.reason, 300);
    const until = days === null ? null : now + days * DAY;
    await env.DB.prepare('INSERT OR REPLACE INTO bans (user_id, reason, banned_by, banned_at, until) VALUES (?1, ?2, ?3, ?4, ?5)').bind(uid, reason || null, who.actor, now, until).run();
    clearBoardCache();
    return { body: { ok: true, until }, target: uid, detail: { reason, days } };
  }],
  ['POST', /^players\/([\w-]{1,128})\/unban$/, 'moderator', 'players.unban', async ({ env, params: [uid] }) => {
    await env.DB.prepare('DELETE FROM bans WHERE user_id = ?1').bind(uid).run();
    clearBoardCache();
    return { body: { ok: true }, target: uid };
  }],
  ['POST', /^players\/([\w-]{1,128})\/reset-scores$/, 'admin', 'players.reset_scores', async ({ env, params: [uid], body, now }) => {
    const period = body.period === 'week' ? 'week' : 'all';
    const r = await env.DB.prepare('DELETE FROM scores WHERE user_id = ?1 AND created_at >= ?2').bind(uid, period === 'week' ? weekStart(now) : 0).run();
    clearBoardCache();
    return { body: { removed: r.meta.changes }, target: uid, detail: { period, removed: r.meta.changes } };
  }],
  ['POST', /^players\/([\w-]{1,128})\/delete$/, 'admin', 'players.delete', async ({ env, params: [uid], body, now }) => {
    if (body.confirm !== uid) throw new Refusal(400, 'confirm', 'Type the player id to confirm.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sync_records WHERE user_id = ?1').bind(uid),
      env.DB.prepare('DELETE FROM sync_users WHERE user_id = ?1').bind(uid),
      ...deleteCompeteStatements(env, uid),
      env.DB.prepare('DELETE FROM name_reviews WHERE user_id = ?1').bind(uid),
      env.DB.prepare('INSERT OR REPLACE INTO sync_deleted_users (user_id, deleted_at) VALUES (?1, ?2)').bind(uid, now),
    ]);
    clearBoardCache();
    return { body: { deleted: true }, target: uid };
  }],

  ['GET', /^settings$/, 'viewer', 'settings.view', async ({ env }) => {
    const values = await getSettings(env);
    const { results } = await env.DB.prepare('SELECT key, updated_at, updated_by FROM settings').all();
    const meta = new Map(results.map((r) => [r.key, r]));
    return {
      body: {
        themes: themeList(),
        // Keys stay in Cloudflare secrets; the dashboard only shows whether they are set.
        services: { gemini: !!env.GEMINI_API_KEY, pictures: !!env.AI },
        settings: Object.entries(SETTINGS).map(([key, s]) => ({
          key, type: s.type, group: s.group, label: s.label, help: s.help, min: s.min, max: s.max, options: s.options, value: values[key],
          updatedAt: meta.get(key)?.updated_at || null, updatedBy: meta.get(key)?.updated_by || null,
        })),
      },
    };
  }],
  ['POST', /^settings$/, 'admin', 'settings.change', async ({ env, body, who }) => {
    const { value, error } = checkSetting(body.key, body.value);
    if (error) throw new Refusal(400, 'bad_value', error);
    const before = (await getSettings(env))[body.key];
    await saveSetting(env, body.key, value, who.actor);
    analyticsCache.clear();
    return { body: { key: body.key, value }, target: body.key, detail: { from: before, to: value } };
  }],

  ['GET', /^announcements$/, 'viewer', 'announcements.view', async ({ env, now }) => {
    const { results } = await env.DB.prepare(`SELECT id, text, level, starts_at AS startsAt, ends_at AS endsAt, created_by AS createdBy, created_at AS createdAt
      FROM announcements ORDER BY created_at DESC LIMIT 50`).all();
    return { body: { announcements: results.map((a) => ({ ...a, live: a.startsAt <= now && (a.endsAt == null || a.endsAt > now) })) } };
  }],
  ['POST', /^announcements$/, 'admin', 'announcements.create', async ({ env, body, who, now }) => {
    const text = str(body.text, 400);
    if (text.length < 3 || text.length > 280) throw new Refusal(400, 'bad_text', 'Write 3 to 280 characters.');
    const level = body.level === 'warning' ? 'warning' : 'info';
    const startsAt = Number.isFinite(body.startsAt) ? Math.max(now - DAY, body.startsAt) : now;
    const endsAt = Number.isFinite(body.endsAt) ? body.endsAt : null;
    if (endsAt !== null && endsAt <= startsAt) throw new Refusal(400, 'bad_time', 'The end must be after the start.');
    const r = await env.DB.prepare('INSERT INTO announcements (text, level, starts_at, ends_at, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id')
      .bind(text, level, startsAt, endsAt, who.actor, now).first();
    return { body: { id: r.id }, target: r.id, detail: { text, level, startsAt, endsAt } };
  }],
  ['POST', /^announcements\/(\d+)\/end$/, 'admin', 'announcements.end', async ({ env, params: [id], now }) => {
    await env.DB.prepare('UPDATE announcements SET ends_at = ?2 WHERE id = ?1 AND (ends_at IS NULL OR ends_at > ?2)').bind(Number(id), now).run();
    return { body: { ok: true }, target: id };
  }],
  ['POST', /^announcements\/(\d+)\/delete$/, 'admin', 'announcements.delete', async ({ env, params: [id] }) => {
    await env.DB.prepare('DELETE FROM announcements WHERE id = ?1').bind(Number(id)).run();
    return { body: { ok: true }, target: id };
  }],

  ['GET', /^audit$/, 'admin', 'audit.view', async ({ env, url }) => {
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const actor = str(url.searchParams.get('actor'), 200);
    const { results } = await env.DB.prepare(`SELECT id, at, actor, role, action, target, detail, status FROM admin_audit
      WHERE id < ?1 AND (?2 = '' OR actor = ?2) ORDER BY id DESC LIMIT 100`).bind(before, actor).all();
    return { body: { entries: results.map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) } };
  }],

  ['GET', /^archive$/, 'admin', 'archive.view', async ({ env, now }) => ({ body: await archiveStatus(env, now) })],
  ['POST', /^archive\/run$/, 'owner', 'archive.run', async ({ env, who, now }) => {
    const r = await runArchive(env, now, { trigger: who.actor });
    return { body: r, detail: { status: r.status, rows: r.rows, removed: !!r.removed } };
  }],
  ['GET', /^archive\/download$/, 'owner', 'archive.download', async ({ env, now }) => {
    const { zip, name, counts } = await buildArchive(env, now);
    return { file: zip, name, detail: { rows: counts } };
  }],
  ['POST', /^archive\/export$/, 'owner', 'archive.export', async ({ env, url, now }) => {
    const test = url.searchParams.get('test') === '1';
    const r = await exportArchive(env, now, { test });
    if (r.status === 'off') throw new Refusal(409, 'off', 'The weekly archive email is switched off in Settings and switches.');
    if (r.status === 'too_big') throw new Refusal(413, 'too_big', 'The zip is too big to email. Nothing was removed.');
    const total = Object.values(r.counts).reduce((a, n) => a + n, 0);
    return {
      file: r.zip, name: r.name, detail: { rows: r.counts, test },
      headers: { 'X-Archive-Id': String(r.id), 'X-Archive-Total': String(total), 'X-Archive-Rows': JSON.stringify(r.counts), 'X-Archive-Test': test ? '1' : '0' },
    };
  }],
  ['POST', /^archive\/confirm$/, 'owner', 'archive.confirm', async ({ env, body, now }) => {
    const r = await confirmArchive(env, body.id, now);
    if (r.status === 'unknown') throw new Refusal(404, 'unknown', r.message);
    if (r.status === 'expired') throw new Refusal(410, 'expired', 'Too late to confirm. Nothing was removed.');
    return { body: r, target: String(body.id), detail: r };
  }],

  ['GET', /^admins$/, 'owner', 'admins.view', async ({ env }) => {
    const { results } = await env.DB.prepare('SELECT email, role, added_by AS addedBy, added_at AS addedAt FROM admins ORDER BY added_at').all();
    const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
    return { body: { owner: owner || null, admins: results, roles: STORED_ROLES } };
  }],
  ['POST', /^admins$/, 'owner', 'admins.add', async ({ env, body, who, now }) => {
    const email = str(body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refusal(400, 'bad_email', 'Enter an email address.');
    if (!STORED_ROLES.includes(body.role)) throw new Refusal(400, 'bad_role', 'Choose admin, moderator or viewer.');
    if (email === String(env.OWNER_EMAIL || '').trim().toLowerCase()) throw new Refusal(400, 'owner', 'That is the owner.');
    await env.DB.prepare(`INSERT INTO admins (email, role, added_by, added_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (email) DO UPDATE SET role = excluded.role, added_by = excluded.added_by, added_at = excluded.added_at`).bind(email, body.role, who.actor, now).run();
    return { body: { ok: true }, target: email, detail: { role: body.role } };
  }],
  ['POST', /^admins\/remove$/, 'owner', 'admins.remove', async ({ env, body }) => {
    const email = str(body.email, 254).toLowerCase();
    await env.DB.prepare('DELETE FROM admins WHERE email = ?1').bind(email).run();
    return { body: { ok: true }, target: email };
  }],
];

async function readBody(req) {
  if (req.method !== 'POST') return {};
  let text;
  try { text = await readText(req, MAX_BODY); } catch (e) {
    if (e instanceof TooLarge) throw new Refusal(413, 'too_large');
    throw e;
  }
  if (!text) return {};
  try {
    const b = JSON.parse(text);
    if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  } catch (e) { /* below */ }
  throw new Refusal(400, 'bad_json');
}

// The admin API sends no CORS headers, so only the dashboard itself (served
// from this Worker's own address) can call it from a browser.
const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});

async function api(req, env, url, path) {
  if (path === 'client-config' && req.method === 'GET') {
    // Public by design (it only names the Firebase project), but kept out of the repo.
    return reply({ firebaseApiKey: env.FIREBASE_WEB_API_KEY || null, projectId: env.FIREBASE_PROJECT_ID || null, tokenSignIn: true });
  }
  let who = null;
  let action = `${req.method} ${path}`;
  let route = null;
  let params = [];
  for (const r of ROUTES) {
    const m = r[0] === req.method && path.match(r[1]);
    if (m) { route = r; params = m.slice(1); action = r[3]; break; }
  }
  try {
    who = await identify(req, env);
    if (env.LIMIT_ADMIN && !(await env.LIMIT_ADMIN.limit({ key: who.key })).success) throw new Refusal(429, 'slow_down', 'Too many requests. Wait a minute.');
    if (!route) throw new Refusal(404, 'not_found');
    if (ROLES[who.role] < ROLES[route[2]]) throw new Refusal(403, 'role', `This needs the ${route[2]} role.`);
    const body = await readBody(req);
    const out = await route[4]({ req, env, url, who, params, body, now: Date.now() });
    await audit(env, { actor: who.actor, role: who.role, action, target: out.target, detail: out.detail, status: 200 });
    if (out.file) {
      return new Response(out.file, {
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${out.name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...out.headers },
      });
    }
    return reply(out.body);
  } catch (e) {
    if (!(e instanceof Refusal)) {
      console.error(e);
      await audit(env, { actor: who ? who.actor : 'unknown', role: who?.role, action, status: 500 }).catch(() => {});
      return reply({ error: 'server' }, 500);
    }
    // Rate-limited requests are not logged, so a flood cannot fill the log.
    if (e.status !== 429) await audit(env, { actor: who ? who.actor : 'unknown', role: who?.role, action, detail: { error: e.error }, status: e.status });
    return reply({ error: e.error, message: e.message }, e.status, e.status === 429 ? { 'Retry-After': '60' } : {});
  }
}

const APP_FILE = /^\/admin\/([\w-]+\.(?:js|css|svg|png|html|webmanifest))?$/;
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', html: 'text/html; charset=utf-8', webmanifest: 'application/manifest+json' };

async function appFile(env, url, file) {
  if (!env.ASSETS) return new Response('The admin app is not deployed with this Worker.', { status: 404 });
  const res = await env.ASSETS.fetch(new Request(new URL(`/${file}`, url.origin)));
  if (!res.ok) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  return new Response(res.body, { headers: { ...SECURITY_HEADERS, 'Content-Type': TYPES[file.split('.').pop()] } });
}

const LEGACY = /^\/admin\/(learn(\/.*)?|errors)$/;

// Returns a Response for /admin paths, or null for anything else. legacy()
// runs the older token-only routes (/admin/learn/*, /admin/errors), which are
// rate limited and audited here too.
export async function handleAdmin(req, env, ctx, url, legacy) {
  const path = url.pathname;
  if (path !== '/admin' && !path.startsWith('/admin/')) return null;
  if (env.LIMIT_ADMIN_IP) {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (!(await env.LIMIT_ADMIN_IP.limit({ key: (await sha256(`flg-admin|${ip}`)).slice(0, 32) })).success) {
      return reply({ error: 'slow_down', message: 'Too many requests. Wait a minute.' }, 429, { 'Retry-After': '60' });
    }
  }
  if (path === '/admin') return Response.redirect(new URL('/admin/', url).toString(), 301);
  // The old token-only story review page moved into the dashboard.
  if (path === '/admin/learn' && req.method === 'GET') return Response.redirect(new URL('/admin/#stories', url).toString(), 301);
  if (path.startsWith('/admin/v1/')) return api(req, env, url, path.slice('/admin/v1/'.length));
  const file = req.method === 'GET' && path.match(APP_FILE);
  if (file) return appFile(env, url, file[1] || 'index.html');
  if (LEGACY.test(path)) {
    const res = await legacy();
    const ok = tokenMatches(env, bearer(req));
    await audit(env, { actor: ok ? 'break-glass token' : 'unknown', role: ok ? 'owner' : null, action: `legacy ${req.method} ${path}`, status: res.status });
    return res;
  }
  return reply({ error: 'not_found' }, 404);
}

