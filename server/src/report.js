// Reports for the admin dashboard and the weekly summary email:
//   quality()  which themes and levels players give up on, rate low or find
//              too hard or too easy (from the anonymous play summaries)
//   alerts()   free allowances that are close to running out
//   summary()  the week in numbers, for the Monday email (scripts/summary-email.py),
//              with where players came from and the market test's pass marks
//   csv()      players, scores and ideas/problems as spreadsheet files
import { getSettings } from './settings.js';
import { voxServerStatus } from './vox.js';
import { FREE_LIMITS, cloudflareUsage } from './usage.js';
import { ratingInsights } from './ratings.js';
import { printPackTotals } from './print-packs.js';
import { GAMES } from './feedback.js';
import { wilson, bayesAverage, meanInterval, median, quantile, robustZ, winsorize } from './stats.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round = (v, p = 2) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
// Groups with fewer games than this are listed but never flagged.
const MIN_GAMES = 5;
// How a group is judged (all at 95% confidence, server/src/stats.js):
//   gave up, too hard, too easy   flagged only when the Wilson interval's lower
//                                 bound is above the limit, so a few games can't
//                                 raise a flag on their own
//   rating                        a Bayesian average (pulled toward the overall
//                                 average, weight 5 ratings), flagged when the
//                                 whole 95% interval is under 3 stars
//   solve time                    each solve's time over what the game expected,
//                                 clipped to 0.1-6x against stray values, and its
//                                 median (not the mean, which one long pause skews)
//   hints                         the group's average against its level's other
//                                 groups by modified z-score (median and MAD)
const LIMITS = {
  quitLow: 0.3, feelLow: 0.25, ratingBelow: 3, ratingWeight: 5,
  slowRatio: 1.6, fastRatio: 0.5, minTimed: 5, clip: [0.1, 6],
  hintZ: 3.5, minHints: 1.5, hintTimes: 2,
};

// One row per theme and level, most in need of attention first.
export async function quality(env, days = 90, now = Date.now()) {
  const since = isoDay(now - (days - 1) * DAY);
  const { results } = await env.DB.prepare(`SELECT theme, tier, outcome, rating, feel, minutes, expected, hints, mistakes
    FROM plays WHERE day >= ?1 ORDER BY rowid DESC LIMIT 60000`).bind(since).all();
  // Problem puzzles waiting on the Puzzle quality page, per theme and level.
  const waiting = {};
  try {
    const q = await env.DB.prepare("SELECT theme, tier, COUNT(*) AS n FROM quality_puzzles WHERE status IN ('open', 'fixed') GROUP BY theme, tier").all();
    for (const r of q.results) waiting[`${r.theme}|${r.tier}`] = r.n;
  } catch (e) { /* not migrated yet */ }

  const groups = new Map();
  let ratingSum = 0, ratingN = 0;
  for (const p of results) {
    const key = `${p.theme}|${p.tier}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { theme: p.theme, tier: p.tier, n: 0, solved: 0, quit: 0, ratings: [], felt: 0, hard: 0, easy: 0, minutes: [], ratios: [], hints: [], mistakes: [] }));
    g.n++;
    if (p.outcome === 'solved') g.solved++; else g.quit++;
    if (p.rating >= 1 && p.rating <= 5) { g.ratings.push(p.rating); ratingSum += p.rating; ratingN++; }
    if (p.feel) { g.felt++; if (p.feel === 'hard') g.hard++; if (p.feel === 'easy') g.easy++; }
    if (p.outcome === 'solved' && p.minutes > 0) {
      g.minutes.push(p.minutes);
      if (p.expected > 0) g.ratios.push(p.minutes / p.expected);
    }
    if (p.hints != null) g.hints.push(p.hints);
    if (p.mistakes != null) g.mistakes.push(p.mistakes);
  }
  const prior = ratingN ? ratingSum / ratingN : null;
  const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  // Each level's groups' hint averages, for the modified z-score.
  const tierHints = {};
  for (const g of groups.values()) if (g.n >= MIN_GAMES && g.hints.length) (tierHints[g.tier] ||= []).push(mean(g.hints));

  const rows = [...groups.values()].map((g) => {
    const quit = wilson(g.quit, g.n);
    const hard = wilson(g.hard, g.felt);
    const easy = wilson(g.easy, g.felt);
    const rated = g.ratings.length;
    const rating = rated ? bayesAverage(g.ratings.reduce((a, b) => a + b, 0), rated, prior, LIMITS.ratingWeight) : null;
    const ratingCI = meanInterval(g.ratings);
    const ratios = winsorize(g.ratios, ...LIMITS.clip);
    const timeRatio = ratios.length >= LIMITS.minTimed ? median(ratios) : null;
    const hints = mean(g.hints);
    const peers = tierHints[g.tier] || [];
    const hintZ = hints != null && peers.length >= 3 ? robustZ(hints, peers) : null;
    const peerNorm = peers.length ? median(peers) : null;
    const issues = [];
    if (g.n >= MIN_GAMES) {
      if (quit.low >= LIMITS.quitLow) issues.push({ code: 'quit', text: `${pctText(quit.p)} gave up or revealed the answer (at least ${pctText(quit.low)})` });
      if (g.felt >= 3 && hard.low >= LIMITS.feelLow) issues.push({ code: 'hard', text: `${pctText(hard.p)} said it was too hard (at least ${pctText(hard.low)})` });
      if (g.felt >= 3 && easy.low >= LIMITS.feelLow) issues.push({ code: 'easy', text: `${pctText(easy.p)} said it was too easy (at least ${pctText(easy.low)})` });
      if (rated >= 3 && ratingCI.high != null && ratingCI.high < LIMITS.ratingBelow) issues.push({ code: 'rating', text: `rated ${round(ratingCI.mean, 1)} of 5 (95% range ${round(Math.max(1, ratingCI.low), 1)}-${round(ratingCI.high, 1)})` });
      // Normal limits: the typical solve against the time the game expected.
      if (timeRatio != null && timeRatio > LIMITS.slowRatio && quantile(ratios, 0.25) > 1) issues.push({ code: 'slow', text: `a typical solve took ${round(timeRatio, 1)}× the expected time` });
      if (timeRatio != null && timeRatio < LIMITS.fastRatio && quantile(ratios, 0.75) < 1) issues.push({ code: 'fast', text: `a typical solve took ${Math.round(timeRatio * 100)}% of the expected time` });
      // Hints: an outlier among the level's groups, or (with few groups to compare) twice the usual.
      const hintsOff = hints != null && hints >= LIMITS.minHints && (hintZ != null ? hintZ > LIMITS.hintZ : peerNorm != null && hints >= peerNorm * LIMITS.hintTimes && peers.length > 1);
      if (hintsOff) issues.push({ code: 'hints', text: `${round(hints, 1)} hints a game (usual ${round(peerNorm, 1)})` });
    }
    // Ranked on the cautious side of each number, weighted by how many games.
    const off = issues.some((x) => x.code === 'slow') ? (timeRatio - 1) / 2 : issues.some((x) => x.code === 'fast') ? 0.25 : 0;
    const attention = issues.length ? Math.log2(1 + g.n) * (quit.low + Math.max(hard.low, easy.low) + (rating != null ? Math.max(0, 3 - rating) / 2 : 0) + off + (issues.some((x) => x.code === 'hints') ? 0.3 : 0)) : 0;
    return {
      theme: g.theme, tier: g.tier, games: g.n, solved: g.solved, solveRate: round(g.solved / g.n), quitRate: round(quit.p), quitRange: [round(quit.low), round(quit.high)],
      rating: round(rating, 1), rated, ratingRange: ratingCI.low == null ? null : [round(Math.max(1, ratingCI.low), 1), round(Math.min(5, ratingCI.high), 1)],
      tooHard: g.felt ? round(hard.p) : null, tooEasy: g.felt ? round(easy.p) : null, felt: g.felt,
      minutes: round(median(g.minutes), 1), hints: round(hints, 1), mistakes: round(mean(g.mistakes), 1), timeRatio: round(timeRatio, 2), timed: ratios.length,
      puzzles: waiting[`${g.theme}|${g.tier}`] || 0, issues, attention: round(attention, 3),
    };
  });
  rows.sort((a, b) => b.attention - a.attention || b.games - a.games);
  return {
    days, since, minGames: MIN_GAMES, limits: LIMITS, ratingAverage: round(prior, 2), rows,
    flagged: rows.filter((r) => r.issues.length).length, waiting: Object.values(waiting).reduce((a, b) => a + b, 0),
  };
}
const pctText = (v) => `${Math.round((v || 0) * 100)}%`;

// Free allowances at or above the alert level (a setting, 80% at first).
// Each: { id, level: 'warn' | 'full', label, used, limit, percent, text }.
export async function alerts(env, now = Date.now()) {
  const s = await getSettings(env, now);
  const at = s.alert_percent / 100;
  const today = isoDay(now);
  const out = [];
  const check = (id, label, used, limit, what) => {
    if (!limit || used == null) return;
    const f = used / limit;
    if (f < at) return;
    out.push({ id, label, used, limit, percent: Math.round(f * 100), level: f >= 1 ? 'full' : 'warn', text: what(Math.round(f * 100)) });
  };
  const counts = (await env.DB.prepare('SELECT name, count FROM usage WHERE day = ?1').bind(today).all()).results;
  const used = (name) => (counts.find((c) => c.name === name) || {}).count || 0;
  if (s.tts_enabled) check('voices', 'Free server voices today', used('tts'), s.daily_tts_cap, (p) => `${p}% of today's voice clips are used. When they run out players hear the Kokoro voices until midnight UTC.`);
  if (s.ai_pictures !== 'none') check('pictures', 'AI pictures today', used('pictures'), s.daily_picture_cap, (p) => `${p}% of today's AI pictures are used. After that players see the built-in art until midnight UTC.`);
  if (s.translate_enabled) check('translations', 'Translations today', used('translate'), s.daily_translate_cap, (p) => `${p}% of today's new translations are used. After that, players whose browser can't translate see English text until midnight UTC.`);
  // The database's size comes with any query.
  try {
    const r = await env.DB.prepare('SELECT 1').run();
    check('database', 'Database size', r.meta?.size_after, FREE_LIMITS.d1DatabaseBytes, (p) => `The database is ${p}% of the free 500 MB. The weekly archive (Backups) can move old rows out.`);
  } catch (e) { /* size unknown */ }
  // Cloudflare's own counts, when the optional token is set.
  const cf = await cloudflareUsage(env, 2, now);
  const latest = cf.days && cf.days.find((d) => d.date === today);
  if (latest) {
    check('requests', 'Worker requests today', latest.requests, FREE_LIMITS.workerRequestsPerDay, (p) => `${p}% of today's free 100,000 Worker requests are used. After that the game's online features stop until midnight UTC.`);
    check('reads', 'Database rows read today', latest.rowsRead, FREE_LIMITS.d1RowsReadPerDay, (p) => `${p}% of today's free 5 million database reads are used.`);
    check('writes', 'Database rows written today', latest.rowsWritten, FREE_LIMITS.d1RowsWrittenPerDay, (p) => `${p}% of today's free 100,000 database writes are used.`);
  }
  // The Oracle server's free-tier guard, reported through Vox's health check.
  const vox = await voxServerStatus(env);
  const u = vox.ready && vox.health && vox.health.server_usage;
  if (u) {
    const pace = u.outbound && u.outbound.on_pace_percent;
    if (u.level >= 2) out.push({ id: 'oracle', label: 'Oracle server free allowance', used: pace, limit: 100, percent: Math.round(pace || 0), level: u.level >= 3 ? 'full' : 'warn',
      text: `${u.reason || 'The server is near its free limits.'} Vox has paused ${u.level >= 3 ? 'everything but serving voices' : 'downloads'} until there's room again; the games keep running.` });
    if (u.size && u.size.free === false) out.push({ id: 'oracle-size', label: 'Oracle server size', used: null, limit: null, percent: 100, level: 'warn',
      text: `The server is ${u.size.ocpus} cores / ${u.size.memory_gb} GB, bigger than the free 2 cores / 12 GB, so Oracle charges for the difference. Resize it in the Oracle console.` });
  }
  return { checkedAt: now, alertPercent: s.alert_percent, cloudflare: cf.configured ? (cf.error ? 'error' : 'on') : 'off', alerts: out };
}

// The week in numbers, for the Monday summary email.
// The market test's pass marks, over the last MARKET_DAYS days. Visits,
// first puzzles and returns come from campaign links and other sites
// (marketing.js); solves and ratings from every game's play summary. A mark
// with less data than `min` is "too early" rather than pass or below.
const MARKET_DAYS = 28;
const PASS_MARKS = [
  { id: 'start', label: 'Visitors who start a puzzle', mark: 40, min: 100, unit: 'visitors' },
  { id: 'solve', label: 'Games that end solved', mark: 50, min: 30, unit: 'games' },
  { id: 'rating', label: 'Average rating', mark: 4.0, min: 30, unit: 'ratings' },
  { id: 'return', label: 'Visitors who come back within a week', mark: 15, min: 100, unit: 'visitors' },
  { id: 'support', label: 'Visitors who press Support', mark: 2, min: 100, unit: 'visitors' },
];

export async function marketTest(env, days = 7, now = Date.now()) {
  const db = env.DB;
  const since = isoDay(now - (MARKET_DAYS - 1) * DAY);
  const week = isoDay(now - (days - 1) * DAY);
  const [events, games, sources] = await db.batch([
    db.prepare('SELECT event, SUM(n) AS n FROM campaign_stats WHERE day >= ?1 GROUP BY event').bind(since),
    db.prepare("SELECT COUNT(*) AS games, COALESCE(SUM(outcome = 'solved'), 0) AS solved, AVG(rating) AS rating, COUNT(rating) AS rated FROM plays WHERE day >= ?1").bind(since),
    db.prepare('SELECT source, medium, event, SUM(n) AS n FROM campaign_stats WHERE day >= ?1 GROUP BY source, medium, event').bind(week),
  ]);
  const ev = Object.fromEntries(events.results.map((r) => [r.event, r.n]));
  const g = games.results[0] || {};
  const visits = ev.visit || 0;
  const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : null);
  const values = {
    start: [pctOf(ev.play || 0, visits), visits],
    solve: [pctOf(g.solved || 0, g.games || 0), g.games || 0],
    rating: [round(g.rating, 1), g.rated || 0],
    return: [pctOf(ev.return || 0, visits), visits],
    support: [pctOf(ev.support || 0, visits), visits],
  };
  // Support presses are counted only while the Support the game link shows.
  const s = await getSettings(env, now);
  const supportShown = !!(s.support_link_enabled && s.support_url);
  const marks = PASS_MARKS.map((m) => {
    const [value, n] = values[m.id];
    let status;
    if (m.id === 'support' && !supportShown) status = 'not_measured';
    else if (n < m.min || value == null) status = 'too_early';
    else status = value >= m.mark ? 'pass' : 'below';
    return { ...m, value, n, status };
  });
  const bySource = new Map();
  for (const r of sources.results) {
    const key = `${r.source}|${r.medium}`;
    if (!bySource.has(key)) bySource.set(key, { source: r.source, medium: r.medium, visit: 0, play: 0, solve: 0, return: 0, install: 0, download: 0, support: 0 });
    if (r.event in bySource.get(key)) bySource.get(key)[r.event] += r.n;
  }
  const funnel = [...bySource.values()].sort((a, b) => b.visit - a.visit || b.solve - a.solve).slice(0, 10)
    .map((x) => ({ ...x, startPct: pctOf(x.play, x.visit), returnPct: pctOf(x.return, x.visit) }));
  return { days: MARKET_DAYS, since, marks, funnel };
}

// Supporters for the weekly summary: running now, new this week, renewed this
// week (a Ko-fi membership payment, which sets the end 35 days after it), and
// ended this week.
async function supporterNumbers(env, since, now) {
  const r = await env.DB.prepare(`SELECT
      COUNT(DISTINCT CASE WHEN until IS NULL OR until > ?2 THEN COALESCE(user_id, email) END) AS active,
      SUM(created_at >= ?1) AS added,
      SUM(source = 'kofi' AND created_at < ?1 AND until IS NOT NULL AND until - ?3 >= ?1) AS renewed,
      SUM(until IS NOT NULL AND until >= ?1 AND until <= ?2) AS ended
    FROM supporters`).bind(since, now, 35 * DAY).first();
  return { active: r.active || 0, added: r.added || 0, renewed: r.renewed || 0, ended: r.ended || 0 };
}

export async function summary(env, days = 7, now = Date.now()) {
  const db = env.DB;
  const since = now - days * DAY;
  const sinceDay = isoDay(since);
  const q = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM sync_users'),
    db.prepare('SELECT COUNT(*) AS n FROM sync_users WHERE created_at >= ?1').bind(since),
    db.prepare('SELECT COUNT(*) AS n FROM players WHERE created_at >= ?1').bind(since),
    db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM scores WHERE created_at >= ?1').bind(since),
    db.prepare("SELECT COUNT(*) AS games, COALESCE(SUM(outcome = 'solved'), 0) AS solved, AVG(rating) AS rating FROM plays WHERE day >= ?1").bind(sinceDay),
    db.prepare('SELECT theme AS id, COUNT(*) AS n FROM plays WHERE day >= ?1 GROUP BY theme ORDER BY n DESC LIMIT 5').bind(sinceDay),
    db.prepare('SELECT tier AS id, COUNT(*) AS n FROM plays WHERE day >= ?1 GROUP BY tier ORDER BY n DESC').bind(sinceDay),
    db.prepare('SELECT COUNT(*) AS n FROM races WHERE created_at >= ?1').bind(since),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS points FROM scores WHERE created_at >= ?1').bind(since),
    db.prepare("SELECT kind, topic, text, created_at AS at FROM feedback WHERE status = 'new' AND created_at >= ?1 ORDER BY created_at DESC LIMIT 25").bind(since),
    db.prepare("SELECT kind, COUNT(*) AS n FROM feedback WHERE status = 'new' GROUP BY kind"),
    db.prepare('SELECT message, place, platform, SUM(count) AS count FROM app_errors WHERE day >= ?1 GROUP BY fingerprint ORDER BY count DESC LIMIT 5').bind(sinceDay),
    db.prepare("SELECT COUNT(*) AS n FROM parts WHERE status = 'pending'"),
    db.prepare("SELECT name, SUM(count) AS n FROM usage WHERE day >= ?1 GROUP BY name").bind(sinceDay),
  ]);
  const r = q.map((x) => x.results);
  const one = (i, f = 'n') => (r[i][0] ? r[i][0][f] || 0 : 0);
  const games = r[4][0] || {};
  const supporters = await supporterNumbers(env, since, now).catch(() => null);
  const [qual, al, rated, market] = await Promise.all([quality(env, 30, now), alerts(env, now), ratingInsights(env, days, { brief: true, now }).catch(() => null), marketTest(env, days, now)]);
  return {
    days, from: sinceDay, to: isoDay(now), generatedAt: now,
    players: { accounts: one(0), newAccounts: one(1), newScreenNames: one(2), scoringPlayers: one(3) },
    games: { finished: games.games || 0, solved: games.solved || 0, rating: round(games.rating, 1), topThemes: r[5], byTier: r[6] },
    races: one(7), scores: { solves: one(8), points: one(8, 'points') },
    feedback: { waiting: Object.fromEntries(r[10].map((x) => [x.kind, x.n])), recent: r[9] },
    errors: r[11],
    storyPartsWaiting: one(12),
    usage: Object.fromEntries(r[13].map((x) => [x.name, x.n])),
    quality: qual.rows.filter((x) => x.issues.length).slice(0, 5),
    alerts: al.alerts,
    // Puzzle ratings: the numbers, what is working, what to improve (ratings.js).
    ratings: rated && { average: rated.overall.avg, rated: rated.overall.rated, spread: rated.overall.spread, change: rated.overall.change,
      good: rated.good.slice(0, 3), improve: rated.improve.slice(0, 3), summary: rated.summary.status === 'ok' ? rated.summary.text : null },
    // Tip jar and Supporter grants (supporters.js): running now, added and ended this week.
    supporters,
    // Printable puzzle packs printed (print-packs.js).
    printPacks: await printPackTotals(env, days, now).catch(() => null),
    // Where this week's visitors came from, and the market test's pass marks.
    funnel: market.funnel,
    marketTest: { days: market.days, since: market.since, marks: market.marks },
  };
}

// Spreadsheet files. Cells a spreadsheet would treat as a formula start with
// an apostrophe, because ideas and problems are typed by players.
function toCsv(head, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
const iso = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '');
export const CSV_KINDS = ['players', 'scores', 'feedback'];

export async function csv(env, kind, now = Date.now()) {
  if (kind === 'players') {
    // Everyone: screen names and accounts that only sync (no screen name yet).
    const { results } = await env.DB.prepare(`WITH ids AS (SELECT user_id FROM players UNION SELECT user_id FROM sync_users)
      SELECT i.user_id, p.screen_name, p.created_at, p.updated_at, u.created_at AS synced_since,
        (SELECT COALESCE(SUM(points), 0) FROM scores s WHERE s.user_id = i.user_id) AS points,
        (SELECT COUNT(*) FROM scores s WHERE s.user_id = i.user_id) AS solves,
        (SELECT COUNT(*) FROM race_entries e WHERE e.user_id = i.user_id) AS races,
        (SELECT MAX(created_at) FROM scores s WHERE s.user_id = i.user_id) AS last_score,
        MAX(COALESCE(p.updated_at, 0), COALESCE(u.created_at, 0),
          COALESCE((SELECT MAX(updated_at) FROM sync_records r WHERE r.user_id = i.user_id), 0),
          COALESCE((SELECT MAX(created_at) FROM scores s WHERE s.user_id = i.user_id), 0),
          COALESCE((SELECT MAX(joined_at) FROM race_entries e WHERE e.user_id = i.user_id), 0)) AS last_seen,
        EXISTS (SELECT 1 FROM bans b WHERE b.user_id = i.user_id AND (b.until IS NULL OR b.until > ?1)) AS banned
      FROM ids i LEFT JOIN players p ON p.user_id = i.user_id LEFT JOIN sync_users u ON u.user_id = i.user_id
      ORDER BY p.screen_name IS NULL, points DESC LIMIT 50000`).bind(now).all();
    return toCsv(['Player id', 'Screen name', 'Name since', 'Name changed', 'Synced account since', 'Last seen', 'Points', 'Solves', 'Races', 'Last score', 'Banned'],
      results.map((x) => [x.user_id, x.screen_name || '', iso(x.created_at), iso(x.updated_at), iso(x.synced_since), iso(x.last_seen), x.points, x.solves, x.races, iso(x.last_score), x.banned ? 'yes' : 'no']));
  }
  if (kind === 'scores') {
    const { results } = await env.DB.prepare(`SELECT s.created_at, p.screen_name, s.kind, s.tier, s.cells, s.elapsed_ms, s.hints, s.checks, s.points
      FROM scores s LEFT JOIN players p ON p.user_id = s.user_id ORDER BY s.created_at DESC LIMIT 50000`).all();
    return toCsv(['When (UTC)', 'Screen name', 'Kind', 'Difficulty', 'Cells', 'Minutes', 'Hints', 'Checks', 'Points'],
      results.map((x) => [iso(x.created_at), x.screen_name || '', x.kind, x.tier, x.cells, round((x.elapsed_ms || 0) / 60000, 1), x.hints, x.checks, x.points]));
  }
  const { results } = await env.DB.prepare('SELECT created_at, game, kind, topic, status, platform, version, text FROM feedback ORDER BY created_at DESC LIMIT 50000').all();
  return toCsv(['When (UTC)', 'Box', 'Topic', 'Status', 'Platform', 'Version', 'Text', 'Game'],
    results.map((x) => [iso(x.created_at), x.kind, x.topic, x.status, x.platform, x.version, x.text, GAMES[x.game] || x.game]));
}
