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
//   GET  /admin/v1/visitors?days=      site visitors: guests and players, apps, systems, devices, places (visits.js)
//   GET  /admin/v1/search              Google and Bing search numbers (search.js); POST .../refresh
//   GET  /admin/v1/errors?days=        error reports, most frequent first, with the fixes marked addressed
//   POST /admin/v1/errors/fix          mark an error addressed { message, place, fixedIn, note }; POST .../fix/:id/delete
//   GET  /admin/v1/parts?status=       shared story parts; POST /admin/v1/parts/review
//   GET  /admin/v1/workshop            Story workshop choices; POST .../draft (AI writer), .../add
//   GET  /admin/v1/characters[/:id]    the Characters section; POST .../save, .../:id/(portrait|lines|publish|unpublish|delete) (characters.js)
//   GET  /admin/v1/feedback?kind=&status=  ideas and problems from the game; POST .../:id (addressed + note|done|new|delete)
//   POST /admin/v1/feedback/:id/approve  approve a storyline: addressed; the email sender builds its first puzzle, stores it for the player and emails "Congratulations" with it as a PDF
//   POST /admin/v1/feedback/:id/decline  disapprove a storyline: done; the player gets a thank-you for their input
//   POST /admin/v1/replies/puzzle      { id, puzzle } the sender built an approved storyline's puzzle: store it for the player (owner)
//   POST /admin/v1/replies/claim       thank-you emails waiting, for the GitHub Action to send (owner, replies.js)
//   POST /admin/v1/replies/done        that Action says which went out; their addresses are removed (owner)
//   GET  /admin/v1/educators?status=   educator puzzle package requests; POST .../:id/(approve|decline|delete) (educators.js)
//   POST /admin/v1/educators/claim     code emails and approved packages, for the GitHub Action (owner); POST .../done
//   POST /admin/v1/daily-email/claim   the day's daily puzzle email list, for the GitHub Action (owner, daily-email.js)
//   POST /admin/v1/daily-email/done    which of those failed (tried again) or were refused (removed) (owner)
//   GET  /admin/v1/mail                puzzle emails: list sizes, sends, switches (puzzle-mail.js); GET .../find?q= (admin),
//                                      POST .../:id/remove, .../add (admin); GET /admin/v1/export/mail.csv (owner)
//   POST /admin/v1/mail/(due|claim|done)  what the puzzle email Action sends, and how it went (owner)
//   GET  /admin/v1/specials            special edition puzzles; POST .../, .../:id, .../:id/cancel (admin, editions.js)
//   GET  /admin/v1/names?status=       screen names to moderate; POST /admin/v1/names/:uid/approve
//   GET  /admin/v1/players?q=&filter=&sort=&dir=&page=&per=  every player, a page at a time; GET /admin/v1/players/:uid
//   POST /admin/v1/players/:uid/(rename|ban|unban|reset-scores|delete)
//   GET/POST /admin/v1/settings        feature switches and limits (settings.js)
//   GET  /admin/v1/number-place        Number Place games by level (number-place.js)
//   GET/POST /admin/v1/announcements   messages in the game; POST .../:id/(end|delete)
//   GET  /admin/v1/inbox?type=&status=&q=  Communication: messages, ideas, problems, errors and emails in one list (messages.js)
//   GET  /admin/v1/conversations/:id   one conversation; POST .../:id/reply (with an optional puzzle file), .../:id/status (open|done|delete)
//   POST /admin/v1/conversations/:id/puzzles/:pid/delete   remove a stored puzzle; GET /admin/v1/puzzle-storage  totals
//   POST /admin/v1/conversations       write to one player first
//   GET/POST /admin/v1/news            news in every player's Messages; POST .../:id/(end|delete)
//   GET  /admin/v1/audit               the audit log
//   GET  /admin/v1/daily               the daily puzzle planner; POST .../:date (change), .../:date/reset (daily.js)
//   GET  /admin/v1/quality?days=       puzzles players give up on, rate low or find too hard or easy (report.js)
//   GET  /admin/v1/ratings?days=&by=[&brief=1]  puzzle ratings, trends and the plain-words analysis; POST .../summary (ratings.js)
//   GET  /admin/v1/marketing?days=     campaigns, ads, media, tracked links and their numbers (marketing.js)
//   GET/POST /admin/v1/supporters      supporters and premium grants; POST .../:id/remove (supporters.js)
//   GET/POST /admin/v1/licenses        app keys for the Windows and Android apps; GET .../:id, POST .../:id/(approve|decline|revoke|restore|devices), .../:id/devices/:device/remove (licenses.js)
//   GET/POST /admin/v1/badges          special badges; POST .../:id, .../:id/(delete|award), .../awards/:id/remove; GET .../:id/holders (special-badges.js)
//   POST /admin/v1/puzzle-reports/(claim|done)  the puzzle doctor Action (owner); GET .../:id/puzzle, POST .../:id/retry (puzzle-reports.js)
//   GET  /admin/v1/alerts              free allowances close to running out
//   GET  /admin/v1/summary?days=       the week in numbers, for the Monday summary email
//   GET  /admin/v1/export/(players|scores|feedback).csv   spreadsheet downloads
//   GET/POST /admin/v1/admins          who may sign in (owner only); POST /admin/v1/admins/remove
//   GET  /admin/v1/connections[?refresh=1]  live status for the Connections and setup guide (connections.js)
//   POST /admin/v1/connections/github  the Connections status Action's report: names that are set, never values
//   GET  /admin/v1/archive             the weekly archive: setup, what goes, past runs (archive.js)
//   POST /admin/v1/archive/run         send the archive email now (owner)
//   GET  /admin/v1/archive/download    the same zip as a download, nothing removed (owner)
//   POST /admin/v1/archive/export[?test=1]  the zip for the weekly GitHub Action to email (owner)
//   POST /admin/v1/archive/confirm     that Action says the email went out; rows may now go (owner)
//   POST /admin/v1/passkeys/sign-in[/options]  Face ID or fingerprint sign-in (no sign-in needed, passkeys.js)
//   GET  /admin/v1/passkeys            this admin's devices; POST .../options, .../register, .../:id/remove
//   POST /admin/v1/session/end         sign out a passkey session
//
// Sign-in: a Firebase ID token from a game account with a confirmed email that
// is the OWNER_EMAIL secret or listed in the admins table, or a session key
// from a passkey that admin set up (passkeys.js). The ADMIN_TOKEN secret still
// works as a break-glass key with the owner's rights.
//
// Privacy: anonymous learning data (plays, parts) is only ever counted on its
// own. Nothing here joins it to accounts, and saved puzzles are only counted,
// never shown.
import { json, readText, TooLarge } from './http.js';
import { verifyIdToken, AuthError } from './auth.js';
import { checkName, cleanName, nameKey, hasBlockedWords } from './names.js';
import { deleteCompeteStatements, clearBoardCache } from './compete.js';
import { SETTINGS, CELEBRATIONS, getSettings, checkSetting, saveSetting, themeList } from './settings.js';
import { npSummary, NP_TUNING_CACHE_KEY } from './number-place.js';
import { TUNING_CACHE_KEY } from './learn.js';
import { refreshSearch, searchSnapshots, lastTry, REFRESH_GAP_MS } from './search.js';
import { workshopOptions, addPart, draftParts } from './workshop.js';
import { characterRoutes, VOICES, VOICE_STYLES } from './characters.js';
import { TOPICS as FEEDBACK_TOPICS } from './feedback.js';
import { claimReplies, finishReplies, replyCounts, releaseUpdate, dropUpdate, deleteReplyStatements, heldStoryline, approveStoryline, declineStoryline, storeBuiltPuzzle } from './replies.js';
import { inbox, INBOX_TYPES, conversationView, teamReply, removePuzzle, puzzleStorage, PUZZLE_MAX_CHARS, setConversationStatus, startConversation, listNews, addNews, endNews, deleteNews, deleteMessageStatements, MessageRefusal } from './messages.js';
import { claimDailyEmail, finishDailyEmail } from './daily-email.js';
import { archiveStatus, runArchive, buildArchive, exportArchive, confirmArchive } from './archive.js';
import { FREE_LIMITS, cloudflareUsage } from './usage.js';
import { plannerView, checkPlan, savePlan, resetPlan } from './daily.js';
import { quality, alerts, summary, csv, CSV_KINDS } from './report.js';
import { connectionStatus, checkGithubReport, saveGithubReport } from './connections.js';
import { withFixes, errorFile } from './errors.js';
import { ratingRoutes } from './ratings.js';
import { marketingRoutes } from './marketing.js';
import { oauthRoutes } from './marketing-oauth.js';
import { supporterRoutes } from './supporters.js';
import { licenseRoutes } from './licenses.js';
import { badgeRoutes, playerBadges, deleteBadgeStatements } from './special-badges.js';
import { puzzleMailRoutes } from './puzzle-mail.js';
import { editionRoutes } from './editions.js';
import { educatorRoutes } from './educators.js';
import { puzzleReportRoutes } from './puzzle-reports.js';
import { visitorRoutes } from './visits.js';
import { SESSION_PREFIX, PasskeyError, signInOptions, checkSignIn, startSession, checkSession, endSessionStatement, forgetAdminStatements, registerOptions, register, listPasskeys, removePasskey } from './passkeys.js';

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
  'app_errors', 'upkeep_log', 'admins', 'admin_audit', 'settings', 'announcements', 'bans', 'name_reviews', 'archive_log', 'feedback', 'feedback_replies', 'error_fixes', 'conversations', 'conversation_messages', 'message_contacts', 'news', 'search_snapshots', 'daily_plan', 'translations', 'rating_insights', 'campaigns', 'campaign_ads', 'marketing_media', 'campaign_stats', 'challenges', 'daily_results', 'daily_email', 'supporters', 'payment_blocks', 'puzzle_mail', 'puzzle_mail_got', 'puzzle_mail_days', 'special_editions', 'educator_requests', 'special_badges', 'badge_awards', 'puzzle_reports', 'player_puzzles', 'visit_stats', 'educator_feedback', 'print_packs', 'print_pack_stories', 'admin_passkeys', 'admin_sessions', 'np_plays'];
// worker-src blob: lets the Media library's celebrations draw off the main
// thread, as they do in the game (canvas-confetti makes its own small worker).
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; manifest-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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

// A short plain-language note on what was done about a player's report.
const cleanNote = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);

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
async function roleOf(env, email) {
  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (owner && email === owner) return 'owner';
  const row = await env.DB.prepare('SELECT role FROM admins WHERE email = ?1').bind(email).first();
  if (!row || !STORED_ROLES.includes(row.role)) throw new Refusal(403, 'not_admin', 'This account is not an admin.');
  return row.role;
}

// who: { actor, role, key (rate limit), signedInAt (ms, when the admin last
// proved who they are), session (a passkey session's hash) }.
async function identify(req, env) {
  const token = bearer(req);
  if (!token) throw new Refusal(401, 'sign_in', 'Please sign in.');
  if (tokenMatches(env, token)) return { actor: 'break-glass token', role: 'owner', key: 'token', signedInAt: 0 };
  if (token.startsWith(SESSION_PREFIX)) {
    let s;
    try { s = await checkSession(env, token); } catch (e) {
      if (e instanceof PasskeyError) throw new Refusal(e.status, e.error, e.message);
      throw e;
    }
    // Checked on every request, so a removed admin is out at once.
    const role = await roleOf(env, s.email);
    return { actor: s.email, role, key: `pk:${s.hash.slice(0, 24)}`, signedInAt: s.createdAt, session: s.hash };
  }
  if (token.split('.').length !== 3) throw new Refusal(401, 'sign_in', 'That key is not right.');
  let user;
  try { user = await verifyIdToken(token, env); } catch (e) {
    if (e instanceof AuthError) throw new Refusal(401, 'sign_in', 'Please sign in again.');
    throw e;
  }
  if (Date.now() / 1000 - user.authTime > SESSION_MAX_S) throw new Refusal(401, 'sign_in', 'For safety, please sign in again.');
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) throw new Refusal(403, 'not_admin', 'This account is not an admin.');
  const role = await roleOf(env, email);
  // Anyone can make a Firebase account with an email they do not own, so an
  // admin's email must be confirmed.
  if (!user.emailVerified) throw new Refusal(403, 'verify_email', 'Confirm your email address first.');
  return { actor: email, role, key: user.uid, uid: user.uid, signedInAt: user.authTime * 1000 };
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
    messagesUnread: db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE status = 'open' AND admin_unread > 0"),
    picturesByDay: db.prepare("SELECT day, count AS n FROM usage WHERE name = 'pictures' AND day >= ?1").bind(sinceDay),
    namesWaiting: db.prepare('SELECT COUNT(*) AS n FROM players p LEFT JOIN name_reviews r ON r.user_id = p.user_id WHERE r.name_key IS NULL OR r.name_key != p.name_key'),
    educatorsWaiting: db.prepare("SELECT COUNT(*) AS n FROM educator_requests WHERE status = 'pending'"),
    keysWaiting: db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE waiting = 1 AND revoked_at IS NULL'),
    educatorFeedbackNew: db.prepare("SELECT COUNT(*) AS n FROM educator_feedback WHERE status = 'new' AND kind != 'survey'"),
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
    review: { parts: Object.fromEntries(r.parts.map((x) => [x.id, x.n])), namesWaiting: one('namesWaiting'), feedback: Object.fromEntries(r.feedbackNew.map((x) => [x.id, x.n])), messages: one('messagesUnread'), educators: one('educatorsWaiting'), educatorFeedback: one('educatorFeedbackNew'), keys: one('keysWaiting') },
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

// ------------------------------------------------------------- players
// Every player in one list, in sections: names that need approval, approved
// names seen in the last 30 days, approved names not seen for longer, blocked
// (banned) players, and accounts that only sync saves (no screen name yet).
// Searchable, sortable and a page at a time. Viewers see names, dates and
// counts only: no player ids, ban reasons or links.
const INACTIVE_MS = 30 * DAY;
const PLAYER_SORTS = {
  seen: 'seen', name: 'name IS NULL, name_key', joined: 'joined', solves: 'solves', races: 'races', points: 'points',
};
const PLAYER_SECTIONS = ['pending', 'active', 'inactive', 'blocked', 'account'];
const PAGE_SIZES = [25, 50, 100];
const PLAYER_ROWS = `WITH ids AS (SELECT user_id FROM players UNION SELECT user_id FROM sync_users),
  base AS (SELECT i.user_id AS uid, pl.screen_name AS name, pl.name_key,
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
    WHEN seen < ?1 - ${INACTIVE_MS} THEN 'inactive' ELSE 'active' END AS section FROM base)`;

async function findPlayers(env, url, now, role = 'owner') {
  const p = url.searchParams;
  const q = String(p.get('q') || '').trim().slice(0, 128);
  let filter = p.get('filter') === 'banned' ? 'blocked' : p.get('filter');
  if (![...PLAYER_SECTIONS, 'named', 'all'].includes(filter)) filter = 'all';
  const sort = PLAYER_SORTS[p.get('sort')] ? p.get('sort') : 'seen';
  const dir = p.get('dir') === 'asc' || (!p.get('dir') && sort === 'name') ? 'ASC' : 'DESC';
  const per = PAGE_SIZES.includes(Number(p.get('per'))) ? Number(p.get('per')) : 50;
  const page = Math.min(Math.max(1, Math.floor(Number(p.get('page')) || 1)), 10_000);
  const key = q ? nameKey(q) : '';
  const order = PLAYER_SORTS[sort].split(', ').map((c) => (c.endsWith('IS NULL') ? c : `${c} ${dir}`)).join(', ');
  const db = env.DB;
  const [list, counts] = (await db.batch([
    db.prepare(`${PLAYER_ROWS}
      SELECT *, COUNT(*) OVER () AS total FROM rows
      WHERE (?2 = '' OR (?3 != '' AND name_key LIKE ?4) OR uid = ?2 OR (length(?2) >= 6 AND uid LIKE ?5))
        AND (?6 = 'all' OR section = ?6 OR (?6 = 'named' AND name IS NOT NULL))
      ORDER BY ${order}, uid LIMIT ?7 OFFSET ?8`)
      .bind(now, q, key, `%${key}%`, `${q.replace(/[%_]/g, '')}%`, filter, per, (page - 1) * per),
    db.prepare(`${PLAYER_ROWS} SELECT section, COUNT(*) AS n FROM rows GROUP BY section`).bind(now),
  ])).map((x) => x.results);
  const total = list.length ? list[0].total : 0;
  const full = ROLES[role] >= ROLES.moderator;
  const sections = Object.fromEntries(PLAYER_SECTIONS.map((s) => [s, 0]));
  for (const c of counts) sections[c.section] = c.n;
  sections.all = PLAYER_SECTIONS.reduce((n, s) => n + sections[s], 0);
  const players = list.map((x) => ({
    ...(full ? { uid: x.uid, banReason: x.banReason, banUntil: x.banUntil, approvedBy: x.approvedBy } : {}),
    name: x.name, section: x.section, joined: x.joined, seen: x.seen || null, synced: !!x.synced,
    points: x.points, solves: x.solves, races: x.races, banned: !!x.banned, approved: !!x.approved,
  }));
  return { players, total, page, per, pages: Math.max(1, Math.ceil(total / per)), sort, dir: dir.toLowerCase(), filter, sections, ids: full };
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
    specialBadges: await playerBadges(env, uid),
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
  ['GET', /^connections$/, 'viewer', 'connections.view', async ({ env, url, now }) => ({ body: await connectionStatus(env, now, { force: url.searchParams.get('refresh') === '1' }) })],
  ['POST', /^connections\/github$/, 'admin', 'connections.github', async ({ env, body, now }) => {
    const { value, error } = checkGithubReport(body);
    if (error) throw new Refusal(400, 'bad_report', error);
    await saveGithubReport(env, value, now);
    return { body: { ok: true }, detail: { secrets: value.secrets.length, variables: value.variables.length } };
  }],
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
    return { body: { since, errors: await withFixes(env, results) } };
  }],
  ['POST', /^errors\/fix$/, 'admin', 'errors.fix', async ({ env, body, now }) => {
    const message = String(body.message || '').slice(0, 300);
    const fixedIn = String(body.fixedIn || '').trim();
    const note = cleanNote(body.note);
    if (!message) throw new Refusal(400, 'bad_message', 'Which error was fixed?');
    if (!/^\d+(\.\d+){1,3}$/.test(fixedIn)) throw new Refusal(400, 'bad_version', 'Give the version the fix shipped in, like 1.7.1.');
    if (!note) throw new Refusal(400, 'bad_note', 'Write a short note on what was done.');
    const file = errorFile(body.place);
    await env.DB.prepare(`INSERT INTO error_fixes (message, file, fixed_in, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (message, file) DO UPDATE SET fixed_in = ?3, note = ?4, created_at = ?5`).bind(message, file, fixedIn, note, now).run();
    return { body: { ok: true }, target: `${file} ${message}`.slice(0, 120), detail: { fixedIn, note } };
  }],
  ['POST', /^errors\/fix\/(\d+)\/delete$/, 'admin', 'errors.unfix', async ({ env, params: [id] }) => {
    const r = await env.DB.prepare('DELETE FROM error_fixes WHERE id = ?1').bind(Number(id)).run();
    if (!r.meta.changes) throw new Refusal(404, 'gone', 'That mark is gone.');
    return { body: { ok: true }, target: id };
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

  // ---- Characters: the game's own cast and narrators (characters.js).
  ...characterRoutes(Refusal),

  ['GET', /^feedback$/, 'moderator', 'feedback.view', async ({ env, url }) => {
    const kind = FEEDBACK_TOPICS[url.searchParams.get('kind')] ? url.searchParams.get('kind') : 'idea';
    const status = ['new', 'addressed', 'done', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'new';
    const { results } = await env.DB.prepare(`SELECT id, kind, topic, theme, text, platform, version, status, note, created_at AS createdAt, done_at AS doneAt FROM feedback
      WHERE kind = ?1 AND (?2 = 'all' OR status = ?2) ORDER BY created_at DESC LIMIT 200`).bind(kind, status).all();
    const counts = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM feedback WHERE status = 'new' GROUP BY kind").all()).results;
    return { body: { kind, status, items: results, waiting: Object.fromEntries(counts.map((x) => [x.kind, x.n])), replies: await replyCounts(env) } };
  }],
  // Called every 15 minutes; a call with nothing to send is not written to the audit log.
  ['POST', /^replies\/claim$/, 'owner', 'replies.claim', async ({ env, body, now }) => {
    const r = await claimReplies(env, body.limit, now);
    return { body: r, quiet: !r.replies.length && !r.dropped, detail: { claimed: r.replies.length, dropped: r.dropped || 0 } };
  }],
  // The sender built an approved storyline's first puzzle: stored for the player (30 days; their game keeps it in Saved puzzles).
  ['POST', /^replies\/puzzle$/, 'owner', 'replies.puzzle', async ({ env, body, now }) => {
    let puzzleId = null;
    try { puzzleId = await storeBuiltPuzzle(env, body.id, body.puzzle, now); } catch (e) {
      if (e instanceof MessageRefusal) throw new Refusal(e.status, e.error, e.message);
      throw e;
    }
    return { body: { ok: true, stored: !!puzzleId }, target: body.id, detail: { stored: !!puzzleId } };
  }, { maxBody: PUZZLE_MAX_CHARS + 20_000 }],
  ['POST', /^replies\/done$/, 'owner', 'replies.done', async ({ env, body, now }) => {
    const r = await finishReplies(env, body.sent, body.failed, now);
    return { body: r, detail: r };
  }],
  // Called once a day by the daily email Action; addresses are never written to the audit log.
  ['POST', /^daily-email\/claim$/, 'owner', 'daily-email.claim', async ({ env, body, now }) => {
    const r = await claimDailyEmail(env, String(body.day || ''), body.limit, now);
    if (r.error) throw new Refusal(400, r.error);
    return { body: r, quiet: !r.list.length, detail: { claimed: r.list.length, off: !!r.off } };
  }],
  ['POST', /^daily-email\/done$/, 'owner', 'daily-email.done', async ({ env, body }) => {
    const r = await finishDailyEmail(env, body.failed, body.refused);
    return { body: r, detail: r };
  }],
  ['POST', /^feedback\/(\d+)$/, 'moderator', 'feedback.update', async ({ env, params: [id], body, now }) => {
    let r;
    let emailed = 0;
    if (body.status === 'delete') r = await env.DB.prepare('DELETE FROM feedback WHERE id = ?1').bind(Number(id)).run();
    else if (body.status === 'addressed') {
      const note = cleanNote(body.note);
      if (!note) throw new Refusal(400, 'bad_note', 'Write a short note on what was done.');
      r = await env.DB.prepare("UPDATE feedback SET status = 'addressed', note = ?1, done_at = ?2 WHERE id = ?3").bind(note, now, Number(id)).run();
    } else if (['new', 'done'].includes(body.status)) r = await env.DB.prepare('UPDATE feedback SET status = ?1, done_at = ?2, note = NULL WHERE id = ?3').bind(body.status, body.status === 'done' ? now : null, Number(id)).run();
    else throw new Refusal(400, 'bad_status');
    if (!r.meta.changes) throw new Refusal(404, 'gone', 'That message is gone.');
    // A player who ticked "Email me an update" hears about it, with the note.
    if (body.status === 'addressed') emailed = await releaseUpdate(env, id, cleanNote(body.note));
    else if (body.status !== 'new') await dropUpdate(env, id, { thank: body.status === 'done' });
    analyticsCache.clear();
    return { body: { ok: true, emailed }, target: id, detail: { status: body.status, note: body.status === 'addressed' ? cleanNote(body.note) : undefined } };
  }],

  // Approve or disapprove a storyline (a story idea): one button each, no
  // note. Approved: marked addressed, and the player who asked for an email
  // gets "Congratulations" with the first puzzle built from their storyline
  // (built and stored for them by the email sender, see replies/puzzle).
  // Disapproved: marked done, and that player gets a thank-you for their input.
  ['POST', /^feedback\/(\d+)\/(approve|decline)$/, 'moderator', 'feedback.storyline', async ({ env, params: [id, action], now }) => {
    const f = await env.DB.prepare('SELECT kind, topic, status FROM feedback WHERE id = ?1').bind(Number(id)).first();
    if (!f) throw new Refusal(404, 'gone', 'That idea is gone.');
    if (f.kind !== 'idea' || f.topic !== 'story') throw new Refusal(400, 'not_story', 'Only story ideas can be approved or disapproved as storylines.');
    if (f.status !== 'new') throw new Refusal(409, 'already', 'This storyline was already approved or closed.');
    let emailed = 0;
    if (action === 'approve') {
      const note = 'Storyline approved. Its first puzzle is built from it and sent to the player.';
      await env.DB.prepare("UPDATE feedback SET status = 'addressed', note = ?1, done_at = ?2 WHERE id = ?3").bind(note, now, Number(id)).run();
      const held = await heldStoryline(env, id);
      emailed = held ? await approveStoryline(env, held.id) : 0;
    } else {
      await env.DB.prepare("UPDATE feedback SET status = 'done', note = NULL, done_at = ?1 WHERE id = ?2").bind(now, Number(id)).run();
      emailed = await declineStoryline(env, id);
    }
    analyticsCache.clear();
    return { body: { ok: true, emailed }, target: id, detail: { action, emailed } };
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
    clearBoardCache();
    return { body: { ok: true }, target: uid, detail: { name: p.screen_name } };
  }],

  ['GET', /^players$/, 'viewer', 'players.search', async ({ env, url, now, who }) => ({ body: await findPlayers(env, url, now, who.role), detail: { q: url.searchParams.get('q') || '' } })],
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
      ...deleteMessageStatements(env, uid),
      ...(await deleteReplyStatements(env, uid)),
      env.DB.prepare('DELETE FROM name_reviews WHERE user_id = ?1').bind(uid),
      ...deleteBadgeStatements(env, uid),
      env.DB.prepare('UPDATE supporters SET user_id = NULL WHERE user_id = ?1').bind(uid),
      env.DB.prepare('UPDATE payment_blocks SET user_id = NULL WHERE user_id = ?1').bind(uid),
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
  // The Media library: every sound and picture in the game, to try out. The
  // sounds and pictures themselves are made in the browser (admin/media.js);
  // this sends the names, the voices and the switches that sit beside them.
  ['GET', /^media$/, 'viewer', 'media.view', async ({ env }) => {
    const s = await getSettings(env);
    const one = (key) => ({ key, label: SETTINGS[key].label, help: SETTINGS[key].help, value: s[key] });
    return {
      body: {
        themes: themeList(),
        voices: VOICES,
        voiceStyles: Object.entries(VOICE_STYLES).map(([id, v]) => ({ id, name: v.name, gemini: v.gemini, kokoro: v.kokoro, speed: v.speed })),
        celebrations: CELEBRATIONS.map(one),
        random: one('celebrate_random'),
        switches: {
          soundEffects: s.sound_effects_enabled, themeMusic: s.theme_music_enabled, voices: s.tts_enabled, voiceCap: s.daily_tts_cap,
          voiceSource: (SETTINGS.voice_source.options.find((o) => o.value === s.voice_source) || {}).label || s.voice_source,
          portraitStyle: s.portrait_style, aiPictures: s.ai_pictures,
        },
        serverVoices: !!(env.GEMINI_API_KEY || env.GOOGLE_TTS_KEY),
      },
    };
  }],
  ['POST', /^settings$/, 'admin', 'settings.change', async ({ env, body, who }) => {
    const { value, error } = checkSetting(body.key, body.value);
    if (error) throw new Refusal(400, 'bad_value', error);
    const before = (await getSettings(env))[body.key];
    await saveSetting(env, body.key, value, who.actor);
    analyticsCache.clear();
    if (String(body.key).startsWith('np_')) await caches.default.delete(new Request(NP_TUNING_CACHE_KEY));
    return { body: { key: body.key, value }, target: body.key, detail: { from: before, to: value } };
  }],

  // Number Place's own section: how each level is going and what players get stuck on.
  ['GET', /^number-place$/, 'viewer', 'numberplace.view', async ({ env, url }) => ({ body: await npSummary(env, daysParam(url, 90)) })],

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

  // ---- Communication (messages.js). Viewers see error reports and the email
  // log only; reading and answering what players wrote needs a moderator.
  ['GET', /^inbox$/, 'viewer', 'inbox.view', async ({ env, url, who, now }) => {
    const type = INBOX_TYPES.includes(url.searchParams.get('type')) ? url.searchParams.get('type') : 'all';
    const status = ['new', 'addressed', 'done', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'new';
    const q = str(url.searchParams.get('q') || '', 100);
    const body = await inbox(env, who.role, { type, status, q }, now);
    return { body: { ...body, replies: await replyCounts(env) }, detail: { type, status } };
  }],
  ['GET', /^conversations\/(\d{1,12})$/, 'moderator', 'conversations.view', async ({ env, params: [id] }) => ({ body: await conversationView(env, Number(id)), target: id })],
  ['POST', /^conversations\/(\d{1,12})\/reply$/, 'moderator', 'conversations.reply', async ({ env, params: [id], body, who, now }) => {
    const r = await teamReply(env, Number(id), body, who, now);
    analyticsCache.clear();
    return { body: r, target: id, detail: { length: r.length, email: r.email, done: r.done, puzzle: r.puzzle ? r.puzzle.title : undefined } };
  }, { maxBody: PUZZLE_MAX_CHARS + 20_000 }],
  ['POST', /^conversations\/(\d{1,12})\/puzzles\/(\d{1,12})\/delete$/, 'moderator', 'puzzles.remove', async ({ env, params: [id, pid] }) => ({ body: await removePuzzle(env, Number(id), Number(pid)), target: `${id}/${pid}` })],
  ['GET', /^puzzle-storage$/, 'viewer', 'puzzles.storage', async ({ env, now }) => ({ body: await puzzleStorage(env, now), quiet: true })],
  ['POST', /^conversations\/(\d{1,12})\/status$/, 'moderator', 'conversations.status', async ({ env, params: [id], body, who, now }) => {
    if (body.status === 'delete' && ROLES[who.role] < ROLES.admin) throw new Refusal(403, 'role', 'Deleting a conversation needs the admin role.');
    analyticsCache.clear();
    return { body: await setConversationStatus(env, Number(id), body.status, now), target: id, detail: { status: body.status } };
  }],
  ['POST', /^conversations$/, 'admin', 'conversations.start', async ({ env, body, who, now }) => {
    const r = await startConversation(env, body, who, now);
    return { body: r, target: r.uid, detail: { conversation: r.id, email: r.email } };
  }],
  ['GET', /^news$/, 'viewer', 'news.view', async ({ env, now }) => ({ body: { news: await listNews(env, now) } })],
  ['POST', /^news$/, 'admin', 'news.create', async ({ env, body, who, now }) => {
    const r = await addNews(env, body, who, now);
    return { body: r, target: r.id, detail: { title: r.title, endsAt: r.endsAt } };
  }],
  ['POST', /^news\/(\d{1,12})\/end$/, 'admin', 'news.end', async ({ env, params: [id], now }) => { await endNews(env, Number(id), now); return { body: { ok: true }, target: id }; }],
  ['POST', /^news\/(\d{1,12})\/delete$/, 'admin', 'news.delete', async ({ env, params: [id] }) => { await deleteNews(env, Number(id)); return { body: { ok: true }, target: id }; }],

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

  ['GET', /^daily$/, 'moderator', 'daily.view', async ({ env, now }) => ({ body: await plannerView(env, now) })],
  ['POST', /^daily\/(\d{4}-\d{2}-\d{2})$/, 'admin', 'daily.plan', async ({ env, params: [date], body, who, now }) => {
    const { value, error } = checkPlan(date, body, now);
    if (error) throw new Refusal(400, 'bad_plan', error);
    const saved = await savePlan(env, value, who.actor, now);
    return { body: { ok: true, plan: saved }, target: date, detail: saved };
  }],
  ['POST', /^daily\/(\d{4}-\d{2}-\d{2})\/reset$/, 'admin', 'daily.reset', async ({ env, params: [date], now }) => {
    const r = await resetPlan(env, date, now);
    if (r.error) throw new Refusal(400, 'bad_plan', r.error);
    return { body: r, target: date };
  }],

  ['GET', /^quality$/, 'viewer', 'quality.view', async ({ env, url }) => ({ body: await quality(env, daysParam(url, 90)) })],
  // ---- Puzzle ratings and insights (ratings.js).
  ...ratingRoutes(Refusal),
  // ---- Marketing: campaigns, ads, media and what each link brought in (marketing.js).
  ...marketingRoutes(Refusal),
  ...oauthRoutes(Refusal),
  // ---- Puzzle emails: the weekly puzzle and special editions (puzzle-mail.js, editions.js).
  ...puzzleMailRoutes(Refusal),
  ...editionRoutes(Refusal),
  // ---- Supporters and premium extras (supporters.js).
  ...supporterRoutes(Refusal),
  // ---- App keys for the Windows and Android apps (licenses.js).
  ...licenseRoutes(Refusal),
  // ---- Special badges: Tester, Contributor and badges for milestones (special-badges.js).
  ...badgeRoutes(Refusal, { onChange: clearBoardCache }),
  ...educatorRoutes(Refusal),
  ...puzzleReportRoutes(Refusal),
  ...visitorRoutes(),
  ['GET', /^alerts$/, 'viewer', 'alerts.view', async ({ env }) => ({ body: await alerts(env) })],
  ['GET', /^summary$/, 'admin', 'summary.view', async ({ env, url }) => {
    const s = await summary(env, daysParam(url, 31));
    s.enabled = (await getSettings(env)).summary_email_enabled;
    return { body: s };
  }],
  ['GET', /^export\/(players|scores|feedback)\.csv$/, 'admin', 'export.csv', async ({ env, params: [kind], now }) => {
    if (!CSV_KINDS.includes(kind)) throw new Refusal(404, 'not_found');
    return { file: await csv(env, kind, now), type: 'text/csv; charset=utf-8', name: `logic-grid-${kind}-${new Date(now).toISOString().slice(0, 10)}.csv`, target: kind };
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
    await env.DB.batch([env.DB.prepare('DELETE FROM admins WHERE email = ?1').bind(email), ...forgetAdminStatements(env, email)]);
    return { body: { ok: true }, target: email };
  }],

  // Face ID and fingerprint sign-in on this admin's own devices (passkeys.js).
  ['GET', /^passkeys$/, 'viewer', 'passkeys.view', async ({ env, who }) => ({ body: { passkeys: String(who.actor).includes('@') ? await listPasskeys(env, who.actor) : [] }, quiet: true })],
  ['POST', /^passkeys\/options$/, 'viewer', 'passkeys.options', async ({ env, url, who, now }) => ({ body: await registerOptions(env, url, who, now), quiet: true })],
  ['POST', /^passkeys\/register$/, 'viewer', 'passkeys.add', async ({ env, url, who, body, now }) => {
    const added = await register(env, url, who, body, now);
    return { body: added, target: added.device };
  }, { maxBody: 6_000 }],
  ['POST', /^passkeys\/([\w-]{1,1400})\/remove$/, 'viewer', 'passkeys.remove', async ({ env, who, params }) => {
    await removePasskey(env, who.actor, params[0]);
    return { body: { ok: true }, target: params[0].slice(0, 16) };
  }],
  ['POST', /^session\/end$/, 'viewer', 'sign-out', async ({ env, who }) => {
    if (who.session) await endSessionStatement(env, who.session).run();
    return { body: { ok: true } };
  }],
];

async function readBody(req, max = MAX_BODY) {
  if (req.method !== 'POST') return {};
  let text;
  try { text = await readText(req, max); } catch (e) {
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

// Face ID or fingerprint sign-in. Nobody is signed in yet, so these two run
// before identify(); the per-connection limit in handleAdmin() still applies.
async function passkeySignIn(req, env, url, path) {
  let email = null;
  try {
    if (path.endsWith('/options')) return reply(await signInOptions(env, url));
    const { email: who, passkeyId } = await checkSignIn(env, url, await readBody(req, 6_000));
    email = who;
    await roleOf(env, email);
    const session = await startSession(env, email, passkeyId);
    await audit(env, { actor: email, action: 'passkeys.sign-in', status: 200 });
    return reply(session);
  } catch (e) {
    const refusal = e instanceof PasskeyError ? new Refusal(e.status, e.error, e.message) : e;
    if (!(refusal instanceof Refusal)) {
      console.error(e);
      return reply({ error: 'server' }, 500);
    }
    await audit(env, { actor: email || 'unknown', action: 'passkeys.sign-in', detail: { error: refusal.error }, status: refusal.status }).catch(() => {});
    return reply({ error: refusal.error, message: refusal.message }, refusal.status);
  }
}

async function api(req, env, ctx, url, path) {
  if (path === 'client-config' && req.method === 'GET') {
    // Public by design (it only names the Firebase project), but kept out of the repo.
    return reply({ firebaseApiKey: env.FIREBASE_WEB_API_KEY || null, projectId: env.FIREBASE_PROJECT_ID || null, tokenSignIn: true });
  }
  if (req.method === 'POST' && (path === 'passkeys/sign-in/options' || path === 'passkeys/sign-in')) return passkeySignIn(req, env, url, path);
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
    const body = await readBody(req, route[5]?.maxBody || MAX_BODY);
    let out;
    try { out = await route[4]({ req, env, ctx, url, who, params, body, now: Date.now() }); } catch (e) {
      if (e instanceof MessageRefusal || e instanceof PasskeyError) throw new Refusal(e.status, e.error, e.message);
      throw e;
    }
    if (!out.quiet) await audit(env, { actor: who.actor, role: who.role, action, target: out.target, detail: out.detail, status: 200 });
    if (out.file) {
      return new Response(out.file, {
        headers: { 'Content-Type': out.type || 'application/zip', 'Content-Disposition': `attachment; filename="${out.name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...out.headers },
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
  if (path.startsWith('/admin/v1/')) return api(req, env, ctx, url, path.slice('/admin/v1/'.length));
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

