// The admin Analysis page: every number the dashboard keeps, gathered in one
// request and grouped by topic, so admin/analysis.js can write the report
// (findings and suggestions) and compare this period with the one before.
//
//   GET /admin/v1/analysis?days=    (viewer; money figures for admin and owner only)
//
// It only reads. Each part is fetched on its own and a part that fails comes
// back as null, so one broken table never blanks the whole report. Nothing
// here joins anonymous play summaries to accounts (see admin.js "Privacy").
import { visitorNumbers } from './visits.js';
import { searchSnapshots } from './search.js';
import { quality, alerts, marketTest } from './report.js';
import { overview as marketingOverview } from './marketing.js';
import { ratingNumbers } from './ratings.js';
import { npSummary } from './number-place.js';
import { kitSummary } from './kit-games.js';
import { olderThan, errorFile } from './errors.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const safe = (p) => Promise.resolve().then(() => p()).catch(() => null);
const ROLES = { viewer: 1, moderator: 2, admin: 3, owner: 4 };

// Errors from an app version older than the one that fixed them are players
// still on an old copy, not a problem in the game today: they are counted
// apart (errorsFixed) and left out of errorsOpen and errorsOpenTop.
export function splitErrors(rows, fixes) {
  if (!rows) return {};
  const byKey = new Map((fixes || []).map((f) => [`${f.message}|${f.file}`, f]));
  const open = new Map();
  let errorsOpen = 0, errorsFixed = 0;
  for (const r of rows) {
    const f = byKey.get(`${r.message}|${errorFile(r.place)}`) || byKey.get(`${r.message}|`);
    if (f && olderThan(r.version, f.fixedIn)) { errorsFixed += r.n; continue; }
    errorsOpen += r.n;
    const k = `${r.message}|${r.place}`;
    const x = open.get(k) || { message: r.message, place: r.place, platform: r.platform, n: 0 };
    x.n += r.n;
    open.set(k, x);
  }
  return { errorsOpen, errorsFixed, errorsOpenTop: [...open.values()].sort((a, b) => b.n - a.n).slice(0, 5) };
}

// Search results keep only what the report reads: totals, the top queries and
// pages, and the sitemap and home page checks.
function trimSearch(sources) {
  if (!sources) return null;
  return Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, {
    connected: s.connected, fetchedAt: s.fetchedAt, error: s.error ? String(s.error).slice(0, 200) : null,
    start: s.data?.start || null, end: s.data?.end || null, totals: s.data?.totals || null,
    queries: (s.data?.queries || []).slice(0, 10), pages: (s.data?.pages || []).slice(0, 10),
    sitemaps: s.data?.sitemaps || [], home: s.data?.home || null,
  }]));
}

function trimMarketing(m) {
  if (!m) return null;
  const count = (list, f) => list.reduce((o, x) => ({ ...o, [x[f]]: (o[x[f]] || 0) + 1 }), {});
  return {
    since: m.since, totals: m.totals, trend: m.trend,
    bySource: m.bySource.slice(0, 12), byCampaign: m.byCampaign.slice(0, 10), byPlatform: m.byPlatform,
    campaigns: m.campaigns.length, campaignStatus: count(m.campaigns, 'status'),
    ads: m.ads.length, adStatus: count(m.ads, 'status'), adChannels: count(m.ads, 'channel'),
    posted: m.ads.filter((a) => a.postedAt).length,
  };
}

// The counts no other admin page gathers in one place, and the period before
// this one for the trend arrows.
async function extraCounts(env, days, now, role) {
  const db = env.DB;
  const since = dayStart(now) - (days - 1) * DAY;
  const prev = since - days * DAY;
  const sinceDay = isoDay(since);
  const prevDay = isoDay(prev);
  const q = {
    feedback: db.prepare('SELECT kind, status, COUNT(*) AS n, SUM(created_at >= ?1) AS recent FROM feedback GROUP BY kind, status').bind(since),
    feedbackTopics: db.prepare('SELECT kind, topic, COUNT(*) AS n FROM feedback WHERE created_at >= ?1 GROUP BY kind, topic ORDER BY n DESC LIMIT 12').bind(since),
    stories: db.prepare('SELECT status, COUNT(*) AS n, SUM(created_at >= ?1) AS recent FROM story_submissions GROUP BY status').bind(since),
    storyKinds: db.prepare('SELECT kind, COUNT(*) AS n FROM story_submissions GROUP BY kind'),
    educators: db.prepare('SELECT status, COUNT(*) AS n, COALESCE(SUM(puzzles), 0) AS puzzles FROM educator_requests GROUP BY status'),
    educatorFeedback: db.prepare('SELECT kind, COUNT(*) AS n FROM educator_feedback GROUP BY kind'),
    reports: db.prepare('SELECT status, COUNT(*) AS n FROM puzzle_reports GROUP BY status'),
    challenges: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(plays), 0) AS plays, COALESCE(SUM(beat), 0) AS beat FROM challenges WHERE created_at >= ?1').bind(since),
    daily: db.prepare('SELECT COALESCE(SUM(n), 0) AS n, COUNT(DISTINCT day) AS days FROM daily_results WHERE day >= ?1').bind(sinceDay),
    dailyEmail: db.prepare('SELECT COUNT(*) AS n FROM daily_email'),
    mail: db.prepare('SELECT COALESCE(SUM(weekly = 1), 0) AS weekly, COALESCE(SUM(special = 1), 0) AS special, COUNT(*) AS n FROM puzzle_mail'),
    printPacks: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(count), 0) AS puzzles FROM print_packs WHERE at >= ?1').bind(since),
    badges: db.prepare('SELECT COUNT(*) AS n FROM badge_awards WHERE removed_at IS NULL'),
    conversations: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(status = \'open\'), 0) AS open FROM conversations WHERE created_at >= ?1').bind(since),
    errorsTop: db.prepare('SELECT message, place, platform, SUM(count) AS n FROM app_errors WHERE day >= ?1 GROUP BY fingerprint ORDER BY n DESC LIMIT 5').bind(sinceDay),
    // Every error of the period by app version, so ones already fixed in a
    // newer version (error_fixes) are counted apart from the ones still open.
    errorRows: db.prepare('SELECT message, place, platform, version, SUM(count) AS n FROM app_errors WHERE day >= ?1 GROUP BY message, place, platform, version').bind(sinceDay),
    errorFixes: db.prepare('SELECT message, file, fixed_in AS fixedIn FROM error_fixes'),
    // The period before, for the trend arrows.
    prevPlays: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(outcome = 'solved'), 0) AS solved FROM plays WHERE day >= ?1 AND day < ?2").bind(prevDay, sinceDay),
    prevVisits: db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM visit_stats WHERE day >= ?1 AND day < ?2').bind(prevDay, sinceDay),
    prevAccounts: db.prepare('SELECT COUNT(*) AS n FROM sync_users WHERE created_at >= ?1 AND created_at < ?2').bind(prev, since),
    prevErrors: db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM app_errors WHERE day >= ?1 AND day < ?2').bind(prevDay, sinceDay),
    firstVisit: db.prepare('SELECT MIN(day) AS day FROM visit_stats'),
    firstPlay: db.prepare('SELECT MIN(day) AS day FROM plays'),
  };
  const money = ROLES[role] >= ROLES.admin;
  if (money) {
    q.supporters = db.prepare(`SELECT kind, COUNT(DISTINCT COALESCE(user_id, email)) AS n, SUM(created_at >= ?1) AS added FROM supporters
      WHERE until IS NULL OR until > ?2 GROUP BY kind`).bind(since, now);
    q.licenses = db.prepare('SELECT COALESCE(SUM(revoked_at IS NULL AND waiting = 0), 0) AS active, COALESCE(SUM(waiting = 1 AND revoked_at IS NULL), 0) AS waiting, COALESCE(SUM(downloads), 0) AS downloads FROM licenses');
  }
  const names = Object.keys(q);
  const out = {};
  // One table missing (an older database) must not stop the rest.
  await Promise.all(names.map(async (k) => {
    try { out[k] = (await q[k].all()).results; } catch (e) { out[k] = null; }
  }));
  const first = (k) => (out[k] && out[k][0]) || {};
  return {
    money,
    feedback: out.feedback, feedbackTopics: out.feedbackTopics,
    stories: out.stories, storyKinds: out.storyKinds,
    educators: out.educators, educatorFeedback: out.educatorFeedback,
    reports: out.reports,
    challenges: first('challenges'), daily: first('daily'), dailyEmail: first('dailyEmail').n || 0, mail: first('mail'),
    printPacks: first('printPacks'), badges: first('badges').n || 0, conversations: first('conversations'),
    errorsTop: out.errorsTop || [],
    ...splitErrors(out.errorRows, out.errorFixes),
    previous: { plays: first('prevPlays').n || 0, solved: first('prevPlays').solved || 0, visits: first('prevVisits').n || 0, accounts: first('prevAccounts').n || 0, errors: first('prevErrors').n || 0 },
    firstVisit: first('firstVisit').day || null, firstPlay: first('firstPlay').day || null,
    supporters: money ? out.supporters : null, licenses: money ? first('licenses') : null,
  };
}

// `analytics` and `storage` live in admin.js (with its cache), so it passes them in.
export async function analysisData(env, days, { now = Date.now(), role = 'viewer', analytics, storage } = {}) {
  const [a, visitors, search, qual, al, market, marketing, ratings, np, cm, sc, pg, store, extra] = await Promise.all([
    safe(() => analytics(env, days, now)),
    safe(() => visitorNumbers(env, days, now)),
    safe(async () => trimSearch(await searchSnapshots(env))),
    safe(() => quality(env, days, now)),
    safe(() => alerts(env, now)),
    safe(() => marketTest(env, Math.min(days, 28), now)),
    safe(async () => trimMarketing(await marketingOverview(env, days, now))),
    safe(async () => (await ratingNumbers(env, days, now, [])).overall),
    safe(() => npSummary(env, days)),
    safe(() => kitSummary(env, 'cm', days)),
    safe(() => kitSummary(env, 'sc', days)),
    safe(() => kitSummary(env, 'pg', days)),
    safe(() => storage(env)),
    safe(() => extraCounts(env, days, now, role)),
  ]);
  const game = (s) => s && { name: s.name, games: s.games, levels: s.levels.filter((l) => l.games), stuck: (s.stuck || []).slice(0, 5) };
  return {
    days, generatedAt: now, role,
    analytics: a, visitors, search, quality: qual && { ...qual, rows: qual.rows.slice(0, 15) }, alerts: al, market, marketing, ratings,
    games: { numberplace: np && { ...game({ ...np, name: 'NINETIMESNINE' }), modes: np.modes }, cagemath: game(cm), sumcross: game(sc), picturegrid: game(pg) },
    storage: store && { databaseBytes: store.databaseBytes, limits: store.limits, biggest: [...store.tables].sort((x, y) => y.rows - x.rows).slice(0, 8) },
    extra,
  };
}
