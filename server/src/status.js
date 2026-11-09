// The admin dashboard's live Status page: everything worth watching, checked
// at once and put in plain words.
//
//   GET /admin/v1/status    (viewer)  { checkedAt, overall, counts, groups: [{ id, title, items }] }
//
// Each item is { id, label, state, value, detail?, link? } where state is
//   ok       working
//   warn     needs a look soon (close to a limit, late, waiting work)
//   down     broken or out of allowance
//   off      not set up (by choice or not yet)
//   unknown  couldn't tell just now
//
// What's watched comes from the code (status-catalog.js, rebuilt on every
// deploy by scripts/status-catalog.mjs): every GitHub Actions workflow, the
// Worker's bindings, the database tables and the dashboard's pages. A new
// workflow, table, binding, page or daily cap is watched as soon as it ships;
// a removed one drops off. Daily caps say what they watch in settings.js
// (watch: { usage, on }), and any other counter in the usage table shows up by
// itself under Free allowances.
//
// The page refreshes this every 30 seconds while it's open and visible, so it
// stays cheap: one batch of database counts, and the outside calls (Cloudflare's
// analytics, GitHub Actions, the website checks) are cached here for a few
// minutes. Nothing here changes anything, and no secret value leaves the Worker.

import { getSettings, SETTINGS } from './settings.js';
import { CATALOG } from './status-catalog.js';
import { FREE_LIMITS, cloudflareUsage } from './usage.js';
import { connectionStatus } from './connections.js';
import { voxServerStatus } from './vox.js';
import { puzzlesReady } from './puzzles.js';
import { CONNECTIONS, allNames } from '../../admin/connections.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const REPO = 'bltaylorjr/fantastical-logic-grid';
const PUZZLE_ORIGIN = 'http://172.30.0.10:8080';
const TABLES = new Set(CATALOG.tables);
const PAGES = new Set(CATALOG.pages);
const BINDINGS = new Set(Object.values(CATALOG.worker.bindings).flat());
// Only link to pages the dashboard still has.
const page = (p) => (p && PAGES.has(p) ? p : null);

// Short caches for the outside calls (per Worker instance).
const cache = new Map();
async function cached(key, ms, now, fn) {
  const hit = cache.get(key);
  if (hit && now - hit.at < ms) return hit.value;
  const value = await fn();
  cache.set(key, { at: now, value });
  return value;
}
export function clearStatusCache() { cache.clear(); }

const pct = (used, limit) => (limit ? Math.round((used / limit) * 100) : 0);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const ago = (ms, now) => {
  if (!ms) return 'never';
  const m = Math.round((now - ms) / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const item = (id, label, state, value, detail, link) => ({ id, label, state, value, ...(detail ? { detail } : {}), ...(page(link) ? { link } : {}) });
// A share of a free allowance: warn at the alert percent, down when it's used up.
function allowance(id, label, used, limit, at, link, unit = '') {
  if (limit == null) return item(id, label, 'off', 'Off', null, link);
  const p = pct(used, limit);
  const state = p >= 100 ? 'down' : p >= at ? 'warn' : 'ok';
  return item(id, label, state, `${p}%`, `${fmt(used)}${unit} of ${fmt(limit)}${unit}`, link);
}
// Something that should have run by now.
function lastRun(id, label, at, everyMs, now, link, extra = '') {
  if (!at) return item(id, label, 'unknown', 'Not yet', 'No run recorded yet', link);
  const late = now - at > everyMs * 1.25;
  return item(id, label, late ? 'warn' : 'ok', ago(at, now), late ? `Late: it should run every ${everyMs >= DAY * 2 ? `${Math.round(everyMs / DAY)} days` : everyMs >= DAY ? 'day' : 'hour'}${extra}` : extra.replace(/^; /, '') || null, link);
}

// Work waiting for you. Each needs its table; a feature that's removed (its
// table dropped) drops off, and a new one is added here in one line.
const WAITING = [
  { id: 'reports-stuck', label: 'Problem reports the doctor couldn\'t fix', table: 'puzzle_reports', sql: "SELECT COUNT(*) AS n FROM puzzle_reports WHERE status = 'needs_fix'", link: 'errortracking' },
  { id: 'messages', label: 'Unread player messages', table: 'conversations', sql: "SELECT COUNT(*) AS n FROM conversations WHERE status = 'open' AND admin_unread > 0", link: 'communication' },
  { id: 'feedback', label: 'New ideas and problems', table: 'feedback', sql: "SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'", link: 'communication' },
  { id: 'names', label: 'Screen names to check', table: 'name_reviews', sql: 'SELECT COUNT(*) AS n FROM players p LEFT JOIN name_reviews r ON r.user_id = p.user_id WHERE r.name_key IS NULL OR r.name_key != p.name_key', link: 'names' },
  { id: 'educators', label: 'Educator requests', table: 'educator_requests', sql: "SELECT COUNT(*) AS n FROM educator_requests WHERE status = 'pending'", link: 'educators' },
  { id: 'edu-feedback', label: 'Educator feedback', table: 'educator_feedback', sql: "SELECT COUNT(*) AS n FROM educator_feedback WHERE status = 'new' AND kind != 'survey'", link: 'edu-feedback' },
  { id: 'stories', label: 'Storyline submissions', table: 'story_submissions', sql: "SELECT COUNT(*) AS n FROM story_submissions WHERE status = 'new' AND source = 'form'", link: 'story-submissions' },
  { id: 'parts', label: 'Shared story parts to review', table: 'parts', sql: "SELECT COUNT(*) AS n FROM parts WHERE status = 'pending'", link: 'stories' },
  { id: 'keys', label: 'App key requests', table: 'licenses', sql: 'SELECT COUNT(*) AS n FROM licenses WHERE waiting = 1 AND revoked_at IS NULL', link: 'licenses' },
  { id: 'tuning', label: 'Self-tuning changes to approve', table: 'tuning_proposals', sql: "SELECT COUNT(*) AS n FROM tuning_proposals WHERE status = 'waiting'", link: 'analysis' },
];
// What the other checks read, each only if its table exists.
const READS = {
  usage: ['usage', (db, today) => db.prepare('SELECT name, count FROM usage WHERE day = ?1').bind(today)],
  errorsToday: ['app_errors', (db, today) => db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM app_errors WHERE day = ?1').bind(today)],
  errorsYesterday: ['app_errors', (db, today, yesterday) => db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM app_errors WHERE day = ?1').bind(yesterday)],
  upkeep: ['upkeep_log', (db) => db.prepare('SELECT ran_at FROM upkeep_log ORDER BY ran_at DESC LIMIT 1')],
  archive: ['archive_log', (db) => db.prepare('SELECT ran_at, status, message FROM archive_log ORDER BY ran_at DESC LIMIT 1')],
  search: ['search_snapshots', (db) => db.prepare('SELECT source, fetched_at, tried_at, error FROM search_snapshots')],
  alertsWaiting: ['alert_queue', (db) => db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM alert_queue WHERE sent_at IS NULL')],
  reportsWaiting: ['puzzle_reports', (db) => db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM puzzle_reports WHERE status IN ('new', 'checking')")],
};

async function counts(env, now) {
  const db = env.DB;
  const q = {};
  for (const [k, [table, make]] of Object.entries(READS)) if (TABLES.has(table)) q[k] = make(db, isoDay(now), isoDay(now - DAY));
  for (const w of WAITING) if (TABLES.has(w.table)) q[`w:${w.id}`] = db.prepare(w.sql);
  q.ping = db.prepare('SELECT 1 AS n');
  const names = Object.keys(q);
  const t0 = Date.now();
  const res = await db.batch(Object.values(q));
  const ms = Date.now() - t0;
  const r = Object.fromEntries(names.map((k, i) => [k, res[i].results]));
  for (const k of Object.keys(READS)) r[k] ||= [];
  const size = res.at(-1).meta?.size_after ?? null;
  return { r, ms, size };
}

// GitHub Actions (needs GITHUB_DISPATCH_TOKEN, which has Actions access to this
// repository). One call lists each workflow's state (GitHub turns scheduled
// workflows off after 60 days without activity); one lists the newest 100
// runs. Workflows that run rarely don't make it into those 100 next to the
// every-5-minute ones, so they're asked one at a time, a few per check, and
// remembered for half an hour. That keeps every check well inside the Worker's
// limit on outside calls.
const GH_PER_CHECK = 6;
const ghRuns = new Map();     // workflow path -> { at, runs }
const ghHeaders = (env) => ({ Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flg-api status' });
const slim = (x) => ({ status: x.status, conclusion: x.conclusion, at: Date.parse(x.updated_at || x.created_at), url: x.html_url, event: x.event, path: x.path });

async function githubBulk(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { configured: false };
  try {
    const [wf, runs] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/actions/workflows?per_page=100`, { headers: ghHeaders(env), signal: AbortSignal.timeout(8000) }),
      fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100&exclude_pull_requests=true`, { headers: ghHeaders(env), signal: AbortSignal.timeout(8000) }),
    ]);
    if (!runs.ok) return { configured: true, error: `GitHub answered ${runs.status}` };
    const states = wf.ok ? Object.fromEntries(((await wf.json()).workflows || []).map((w) => [w.path, w.state])) : {};
    return { configured: true, states, runs: ((await runs.json()).workflow_runs || []).map(slim) };
  } catch (e) {
    return { configured: true, error: 'GitHub did not answer' };
  }
}

async function githubRuns(env, now) {
  const bulk = await cached('gh', 3 * MIN, now, () => githubBulk(env));
  if (!bulk.configured || bulk.error) return bulk;
  const byPath = new Map();
  for (const r of bulk.runs) if (r.event !== 'pull_request') (byPath.get(r.path) || byPath.set(r.path, []).get(r.path)).push(r);
  for (const [path, runs] of byPath) ghRuns.set(path, { at: now, runs });
  // The ones not in the newest 100: a few at a time, oldest answer first.
  const want = CATALOG.workflows.filter((w) => watchable(w) && bulk.states[w.path] !== 'disabled_manually' && !byPath.has(w.path))
    .filter((w) => !ghRuns.has(w.path) || now - ghRuns.get(w.path).at > 30 * MIN)
    .sort((a, b) => (ghRuns.get(a.path)?.at || 0) - (ghRuns.get(b.path)?.at || 0)).slice(0, GH_PER_CHECK);
  await Promise.all(want.map(async (w) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${encodeURIComponent(w.file)}/runs?per_page=10&exclude_pull_requests=true`, { headers: ghHeaders(env), signal: AbortSignal.timeout(8000) });
      if (res.ok) ghRuns.set(w.path, { at: now, runs: ((await res.json()).workflow_runs || []).map(slim).filter((r) => r.event !== 'pull_request') });
    } catch (e) { /* asked again next check */ }
  }));
  return { configured: true, states: bulk.states, known: (path) => ghRuns.get(path)?.runs };
}
// Pull-request checks aren't running work; everything else is.
const watchable = (w) => w.crons.length || w.events.some((e) => e !== 'pull_request' && e !== 'pull_request_target');

// What's watched, from the code alone (not from what answered just now), so
// the page can say what was added or removed since you last looked.
function watchedList() {
  const w = {};
  for (const c of CONNECTIONS) (c.checks || []).forEach((k, i) => { if ((k.type === 'http' || k.type === 'dns') && !k.optional) w[`check-${c.id}-${i}`] = k.label; });
  if (BINDINGS.has('PUZZLES')) w.puzzles = 'Puzzle server';
  w.vox = 'Vox voice engine';
  for (const [key, def] of Object.entries(SETTINGS)) if (def.watch) w[`cap-${key}`] = `${def.watch.label || def.label} today`;
  if (TABLES.has('upkeep_log')) w.nightly = 'Nightly maintenance';
  if (TABLES.has('archive_log')) w.archive = 'Weekly archive email';
  if (TABLES.has('alert_queue')) w['owner-alerts'] = 'Your push and email alerts';
  if (TABLES.has('puzzle_reports')) w.doctor = 'Puzzle doctor';
  for (const x of CATALOG.workflows.filter(watchable)) w[`wf-${x.file.replace(/\.ya?ml$/, '')}`] = x.name;
  if (TABLES.has('app_errors')) w.errors = 'Game errors reported today';
  for (const x of WAITING) if (TABLES.has(x.table)) w[x.id] = x.label;
  return w;
}

async function puzzleServer(env) {
  if (!puzzlesReady(env)) return { ready: false };
  try {
    const res = await env.PUZZLES.fetch(`${PUZZLE_ORIGIN}/v1/health`, { headers: { 'X-FLG-Key': env.PUZZLE_KEY }, signal: AbortSignal.timeout(8000) });
    const h = await res.json().catch(() => ({}));
    return { ready: true, ok: res.ok && h.ok === true, release: h.release || null, busy: h.busy ?? null, queued: h.queued ?? null, canary: h.canary?.state ?? null };
  } catch (e) {
    return { ready: true, ok: false };
  }
}

export async function statusReport(env, now = Date.now()) {
  const settled = (p) => p.then((v) => v, () => null);
  const [db, settings, cf, gh, conn, puzzles, vox] = await Promise.all([
    settled(counts(env, now)),
    settled(getSettings(env, now)),
    cached('cf', 5 * MIN, now, () => cloudflareUsage(env, 2, now)),
    githubRuns(env, now),
    settled(cached('conn', 5 * MIN, now, () => connectionStatus(env, now))),
    puzzleServer(env),
    voxServerStatus(env),
  ]);
  const at = (settings?.alert_percent ?? 80);
  const groups = [];
  const one = (k) => (db?.r[k]?.[0]?.n) || 0;

  // ---- The game online
  const online = [];
  online.push(item('api', 'Game server (Cloudflare Worker)', 'ok', 'Answering', 'This page came from it'));
  online.push(db
    ? item('db', 'Database (Cloudflare D1)', db.ms > 1500 ? 'warn' : 'ok', `${db.ms} ms`, db.ms > 1500 ? 'Slow to answer just now' : 'Answering', 'usage')
    : item('db', 'Database (Cloudflare D1)', 'down', 'Not answering', 'The game can\'t save scores or accounts until it answers', 'usage'));
  if (conn) {
    // The website, DNS and other outside checks from Connections and setup.
    for (const c of CONNECTIONS) {
      (c.checks || []).forEach((k, i) => {
        if ((k.type !== 'http' && k.type !== 'dns') || k.optional) return;
        const r = conn.checks[`${c.id}#${i}`];
        if (!r) return;
        online.push(item(`check-${c.id}-${i}`, k.label, r.ok === true ? 'ok' : r.ok === false ? 'down' : 'unknown', r.ok === true ? 'OK' : r.ok === false ? 'Failing' : 'Unknown', r.detail || null, 'connections'));
      });
    }
    // Only names the game needs; optional ones (other hosts, extras) never make this amber.
    const missing = allNames().filter((n) => !n.optional && conn.names[`${n.where}:${n.name}`] === false).map((n) => n.name);
    online.push(item('connections', 'Connections and setup', missing.length ? 'warn' : 'ok', missing.length ? `${missing.length} not set` : 'All set',
      missing.length ? `Needed but empty: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}` : null, 'connections'));
  } else {
    online.push(item('connections', 'Connections and setup', 'unknown', 'Unknown', 'Couldn\'t check just now', 'connections'));
  }
  groups.push({ id: 'online', title: 'The game online', items: online });

  // ---- The Oracle server
  const oracle = [];
  if (!BINDINGS.has('PUZZLES')) { /* the puzzle server isn't part of this Worker any more: nothing to watch */ } else if (!puzzles.ready) oracle.push(item('puzzles', 'Puzzle server', 'off', 'Not set up', 'The site builds puzzles itself until the server is connected (docs/PUZZLE-SERVER.md)'));
  else if (!puzzles.ok) oracle.push(item('puzzles', 'Puzzle server', 'down', 'Not answering', 'Players get the built-in puzzle engine meanwhile'));
  else oracle.push(item('puzzles', 'Puzzle server', puzzles.canary === 'failing' ? 'warn' : 'ok', 'Answering',
    [puzzles.release && `release ${String(puzzles.release).slice(0, 7)}`, puzzles.busy != null && `${puzzles.busy} busy`, puzzles.queued != null && `${puzzles.queued} queued`, puzzles.canary && `canary ${puzzles.canary}`].filter(Boolean).join(' · ')));
  if (!BINDINGS.has('VOX') && !vox.ready) oracle.push(item('vox', 'Vox voice engine', 'off', 'Not set up', 'Vox runs on your Windows PC until it moves to the server (docs/VOX-SERVER.md)', 'voice-engine'));
  else if (!vox.ready && vox.reason === 'not_set_up') oracle.push(item('vox', 'Vox voice engine', 'off', 'Not set up', 'Vox runs on your Windows PC until it moves to the server (docs/VOX-SERVER.md)', 'voice-engine'));
  else if (!vox.ready) oracle.push(item('vox', 'Vox voice engine', 'down', 'Not answering', 'The game keeps its other voices meanwhile', 'voice-engine'));
  else {
    const h = vox.health || {};
    oracle.push(item('vox', 'Vox voice engine', 'ok', 'Answering', h.release ? `release ${String(h.release).slice(0, 7)}` : null, 'voice-engine'));
    const u = h.server_usage;
    if (u) {
      const LEVEL = ['Normal', 'Careful', 'Throttled', 'Essential only'];
      oracle.push(item('guard', 'Free-tier guard', u.level >= 3 ? 'down' : u.level >= 1 ? 'warn' : 'ok', LEVEL[u.level] || `Level ${u.level}`, u.reason || `checked ${ago(Date.parse(u.at), now)}`, 'voice-engine'));
      if (u.outbound) {
        const p = Math.round(u.outbound.on_pace_percent || 0);
        oracle.push(item('outbound', 'Outbound data this month', p >= 95 ? 'down' : p >= 70 ? 'warn' : 'ok', `${(u.outbound.used / 1e12).toFixed(2)} TB`, `of the free 10 TB; on pace for ${p}% by month end`));
      }
      oracle.push(item('disk', 'Server disk', u.disk_percent >= 92 ? 'down' : u.disk_percent >= 75 ? 'warn' : 'ok', `${u.disk_percent}% full`, `of the free 200 GB · Vox data ${u.vox_data_gb} GB`));
      if (u.size) oracle.push(item('size', 'Server size', u.size.free === false ? 'warn' : 'ok', `${u.size.ocpus} cores / ${u.size.memory_gb} GB`, u.size.free === false ? 'Bigger than the free 2 cores / 12 GB: Oracle charges for the difference. Resize it in the Oracle console.' : 'Within the free 2 cores / 12 GB'));
      const stale = now - Date.parse(u.at) > 3 * HOUR;
      if (stale) oracle.push(item('guard-late', 'Free-tier guard reports', 'warn', ago(Date.parse(u.at), now), 'It should report every 15 minutes; Vox goes carefully meanwhile'));
    }
    const m = h.server_maintenance;
    if (m) {
      const t = Date.parse(m.at);
      oracle.push(item('cleanup', 'Server daily cleanup and repair', now - t > 1.25 * DAY ? 'warn' : 'ok', ago(t, now),
        `freed ${fmt(m.freed_mb)} MB${m.repairs?.length ? ` · fixed: ${m.repairs.join('; ')}` : ' · nothing needed fixing'}`));
    }
  }
  if (oracle.length) groups.push({ id: 'oracle', title: 'The Oracle server', items: oracle });

  // ---- Free allowances today
  const free = [];
  const used = (name) => (db?.r.usage.find((u) => u.name === name) || {}).count || 0;
  if (db?.size != null) free.push(allowance('db-size', 'Database size', Math.round(db.size / 1048576), Math.round(FREE_LIMITS.d1DatabaseBytes / 1048576), at, 'usage', ' MB'));
  const cfToday = cf.days && cf.days.find((d) => d.date === isoDay(now));
  if (!cf.configured) free.push(item('cf', 'Cloudflare requests and database reads', 'off', 'Not connected', 'Add CF_API_TOKEN and CF_ACCOUNT_ID to see them (Usage and free limits)', 'usage'));
  else if (cf.error) free.push(item('cf', 'Cloudflare requests and database reads', 'unknown', 'Unknown', cf.error, 'usage'));
  else {
    const c = cfToday || { requests: 0, errors: 0, rowsRead: 0, rowsWritten: 0 };
    free.push(allowance('requests', 'Worker requests today', c.requests, FREE_LIMITS.workerRequestsPerDay, at, 'usage'));
    free.push(allowance('reads', 'Database rows read today', c.rowsRead, FREE_LIMITS.d1RowsReadPerDay, at, 'usage'));
    free.push(allowance('writes', 'Database rows written today', c.rowsWritten, FREE_LIMITS.d1RowsWrittenPerDay, at, 'usage'));
    const rate = c.requests ? c.errors / c.requests : 0;
    free.push(item('worker-errors', 'Worker errors today', rate >= 0.05 ? 'down' : rate >= 0.01 ? 'warn' : 'ok', fmt(c.errors), c.requests ? `${(rate * 100).toFixed(2)}% of requests` : null, 'errortracking'));
  }
  // Daily caps say in settings.js what they watch: { usage: counter name, on: switch }.
  const claimed = new Set();
  if (settings) {
    for (const [key, def] of Object.entries(SETTINGS)) {
      if (!def.watch) continue;
      claimed.add(def.watch.usage);
      const on = typeof def.watch.on === 'function' ? def.watch.on(settings) : def.watch.on ? !!settings[def.watch.on] : true;
      const label = `${def.watch.label || def.label} today`;
      free.push(on ? allowance(`cap-${key}`, label, used(def.watch.usage), settings[key], at, 'settings')
        : item(`cap-${key}`, label, 'off', 'Off', 'Switched off in Settings', 'settings'));
    }
  }
  // Any other counter the game keeps today shows up by itself.
  for (const u of db?.r.usage || []) {
    if (claimed.has(u.name)) continue;
    free.push(item(`count-${u.name}`, `${u.name.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())} today`, 'ok', fmt(u.count), 'Counted today; no daily cap is set for it'));
  }
  groups.push({ id: 'free', title: 'Free allowances (today, UTC)', items: free });

  // ---- Scheduled work
  const jobs = [];
  if (db) {
    if (TABLES.has('upkeep_log')) jobs.push(lastRun('nightly', 'Nightly maintenance (Worker, 2 am Eastern)', db.r.upkeep[0]?.ran_at, DAY, now, 'usage'));
    const a = db.r.archive[0];
    if (!TABLES.has('archive_log')) { /* no archive any more */ } else if (a && a.status === 'failed') jobs.push(item('archive', 'Weekly archive email', 'down', 'Failed', `${ago(a.ran_at, now)}${a.message ? `: ${a.message}` : ''}`, 'backups'));
    else jobs.push(lastRun('archive', 'Weekly archive email', a?.ran_at, 7 * DAY, now, 'backups', a ? `; last: ${a.status}` : ''));
    for (const s of db.r.search) {
      const label = `${s.source === 'google' ? 'Google' : s.source === 'bing' ? 'Bing' : s.source} search numbers`;
      if (s.error && s.tried_at > (s.fetched_at || 0)) jobs.push(item(`search-${s.source}`, label, 'warn', 'Last fetch failed', `${s.error} · last good ${ago(s.fetched_at, now)}`, 'search'));
      else jobs.push(lastRun(`search-${s.source}`, label, s.fetched_at, DAY, now, 'search'));
    }
    const w = db.r.alertsWaiting[0] || {};
    if (TABLES.has('alert_queue')) jobs.push(item('owner-alerts', 'Your push and email alerts', w.n && now - w.oldest > 2 * HOUR ? 'warn' : 'ok', w.n ? `${w.n} waiting` : 'Nothing waiting',
      w.n && now - w.oldest > 2 * HOUR ? `Waiting since ${ago(w.oldest, now)}; they go out every hour` : 'Sent every hour', 'settings'));
    const rw = db.r.reportsWaiting[0] || {};
    if (TABLES.has('puzzle_reports')) jobs.push(item('doctor', 'Puzzle doctor (problem reports)', rw.n && now - rw.oldest > 6 * HOUR ? 'warn' : 'ok', rw.n ? `${rw.n} in the queue` : 'Queue empty',
      rw.n && now - rw.oldest > 6 * HOUR ? `Oldest waiting ${ago(rw.oldest, now)}` : null, 'errortracking'));
  }
  if (conn?.github) jobs.push(lastRun('gh-report', 'GitHub connections report', conn.github.reportedAt, DAY, now, 'connections'));
  if (!gh.configured) jobs.push(item('actions', 'GitHub Actions', 'off', 'Not connected', 'Add the GITHUB_DISPATCH_TOKEN Worker secret to see each workflow\'s last run here', 'connections'));
  else if (gh.error) jobs.push(item('actions', 'GitHub Actions', 'unknown', 'Unknown', gh.error));
  else {
    let checking = 0;
    for (const w of CATALOG.workflows.filter(watchable).sort((x, y) => x.name.localeCompare(y.name))) {
      const id = `wf-${w.file.replace(/\.ya?ml$/, '')}`;
      const st = gh.states[w.path];
      const every = w.everyMinutes ? w.everyMinutes * MIN : null;
      const sched = every ? ` · runs every ${every >= 2 * DAY ? `${Math.round(every / DAY)} days` : every >= 2 * HOUR ? `${Math.round(every / HOUR)} hours` : `${Math.round(every / MIN)} min`}` : '';
      if (st === 'disabled_manually') { jobs.push(item(id, w.name, 'off', 'Turned off', 'Turned off on GitHub')); continue; }
      if (st === 'disabled_inactivity') { jobs.push({ ...item(id, w.name, 'warn', 'Paused by GitHub', 'GitHub stops scheduled workflows after 60 days without activity in the repo. Open it on GitHub and choose Enable workflow.'), url: `https://github.com/${REPO}/actions/workflows/${w.file}`, kind: 'action' }); continue; }
      const runs = gh.known(w.path);
      if (!runs) { checking++; continue; }
      if (!runs.length) {
        if (every) jobs.push({ ...item(id, w.name, 'unknown', 'No runs yet', `Hasn't run yet${sched}`), url: `https://github.com/${REPO}/actions/workflows/${w.file}`, kind: 'action' });
        continue;   // manual or on-push work that has never run: nothing to watch yet
      }
      const run = runs[0];
      const lastSched = runs.find((r) => r.event === 'schedule');
      // GitHub's schedules can run late; allow half the gap again, and at least 3 hours.
      const late = every && lastSched && now - lastSched.at > Math.max(every * 1.5, every + 3 * HOUR);
      let state = run.status !== 'completed' ? 'ok' : ['success', 'skipped', 'neutral'].includes(run.conclusion) ? 'ok' : run.conclusion === 'cancelled' ? 'warn' : 'down';
      if (late && state === 'ok') state = 'warn';
      const value = run.status !== 'completed' ? 'Running' : run.conclusion === 'success' ? 'Passed' : String(run.conclusion || 'Unknown').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const detail = late ? `Late: no scheduled run since ${ago(lastSched.at, now)}${sched}` : `${ago(run.at, now)} · ${run.event.replace(/_/g, ' ')}${sched}`;
      jobs.push({ ...item(id, w.name, state, value, detail), url: run.url, kind: 'action' });
    }
    if (checking) jobs.push(item('actions-checking', 'More GitHub workflows', 'unknown', `${checking} being checked`, 'Workflows that run rarely are looked up a few at a time; they appear here within a few minutes'));
  }
  groups.push({ id: 'jobs', title: 'Scheduled work', items: jobs });

  // ---- Waiting for you
  if (db) {
    const e = one('errorsToday');
    const y = one('errorsYesterday');
    const waiting = TABLES.has('app_errors') ? [item('errors', 'Game errors reported today', e > Math.max(50, y * 3) ? 'down' : e > Math.max(10, y * 1.5) ? 'warn' : 'ok', fmt(e), `yesterday ${fmt(y)}`, 'errortracking')] : [];
    for (const w of WAITING) {
      if (!TABLES.has(w.table)) continue;
      const n = db.r[`w:${w.id}`]?.[0]?.n || 0;
      waiting.push(item(w.id, w.label, n ? 'warn' : 'ok', fmt(n), null, w.link));
    }
    groups.push({ id: 'waiting', title: 'Waiting for you', items: waiting });
  }

  const all = groups.flatMap((g) => g.items);
  const count = (s) => all.filter((i) => i.state === s).length;
  const tally = { ok: count('ok'), warn: count('warn'), down: count('down'), off: count('off'), unknown: count('unknown') };
  // "Waiting for you" items are work, not faults: they don't make the whole page amber.
  const faults = groups.filter((g) => g.id !== 'waiting').flatMap((g) => g.items);
  const overall = faults.some((i) => i.state === 'down') ? 'down' : faults.some((i) => i.state === 'warn') ? 'warn' : 'ok';
  return {
    checkedAt: now, overall, counts: tally, refreshSeconds: 30, groups,
    // What's watched, for the page's "now also watching" note.
    watched: watchedList(),
    catalog: { hash: CATALOG.hash, workflows: CATALOG.workflows.filter(watchable).length, tables: CATALOG.tables.length, pages: CATALOG.pages.length, bindings: [...BINDINGS].sort() },
  };
}
