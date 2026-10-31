// Reports for the admin dashboard and the weekly summary email:
//   quality()  which themes and levels players give up on, rate low or find
//              too hard or too easy (from the anonymous play summaries)
//   alerts()   free allowances that are close to running out
//   summary()  the week in numbers, for the Monday email (scripts/summary-email.py),
//              with where players came from and the market test's pass marks
//   csv()      players, scores and ideas/problems as spreadsheet files
import { getSettings } from './settings.js';
import { FREE_LIMITS, cloudflareUsage } from './usage.js';
import { ratingInsights } from './ratings.js';
import { printPackTotals } from './print-packs.js';
import { GAMES } from './feedback.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round = (v, p = 2) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
// Groups with fewer games than this are listed but never flagged.
const MIN_GAMES = 5;

// One row per theme and level, most in need of attention first.
export async function quality(env, days = 90, now = Date.now()) {
  const since = isoDay(now - (days - 1) * DAY);
  const { results } = await env.DB.prepare(`SELECT theme, tier, COUNT(*) AS games,
      SUM(outcome = 'solved') AS solved, SUM(outcome = 'revealed') AS revealed, SUM(outcome = 'abandoned') AS abandoned,
      AVG(rating) AS rating, COUNT(rating) AS rated, SUM(feel = 'hard') AS tooHard, SUM(feel = 'easy') AS tooEasy, COUNT(feel) AS felt,
      AVG(CASE WHEN outcome = 'solved' THEN minutes END) AS minutes, AVG(hints) AS hints
    FROM plays WHERE day >= ?1 GROUP BY theme, tier`).bind(since).all();
  const rows = results.map((r) => {
    const quit = (r.revealed + r.abandoned) / r.games;
    const hard = r.felt ? r.tooHard / r.felt : 0;
    const easy = r.felt ? r.tooEasy / r.felt : 0;
    const issues = [];
    if (r.games >= MIN_GAMES) {
      if (quit >= 0.4) issues.push({ code: 'quit', text: `${Math.round(quit * 100)}% gave up or revealed the answer` });
      if (r.felt >= 3 && hard >= 0.4) issues.push({ code: 'hard', text: `${Math.round(hard * 100)}% said it was too hard` });
      if (r.felt >= 3 && easy >= 0.4) issues.push({ code: 'easy', text: `${Math.round(easy * 100)}% said it was too easy` });
      if (r.rated >= 3 && r.rating < 3) issues.push({ code: 'rating', text: `rated ${round(r.rating, 1)} out of 5` });
    }
    // More games and bigger problems come first.
    const attention = issues.length ? Math.log2(1 + r.games) * (quit + Math.max(hard, easy) + (r.rated >= 3 ? Math.max(0, 3 - r.rating) / 2 : 0)) : 0;
    return {
      theme: r.theme, tier: r.tier, games: r.games, solved: r.solved, solveRate: round(r.solved / r.games), quitRate: round(quit),
      rating: round(r.rating, 1), rated: r.rated, tooHard: round(hard), tooEasy: round(easy), minutes: round(r.minutes, 1), hints: round(r.hints, 1),
      issues, attention: round(attention, 3),
    };
  });
  rows.sort((a, b) => b.attention - a.attention || b.games - a.games);
  return { days, since, minGames: MIN_GAMES, rows, flagged: rows.filter((r) => r.issues.length).length };
}

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
