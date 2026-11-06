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
// The page refreshes this every 30 seconds while it's open and visible, so it
// stays cheap: one batch of database counts, and the outside calls (Cloudflare's
// analytics, GitHub Actions, the website checks) are cached here for a few
// minutes. Nothing here changes anything, and no secret value leaves the Worker.

import { getSettings } from './settings.js';
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
const item = (id, label, state, value, detail, link) => ({ id, label, state, value, ...(detail ? { detail } : {}), ...(link ? { link } : {}) });
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

async function counts(env, now) {
  const db = env.DB;
  const today = isoDay(now);
  const q = {
    usage: db.prepare('SELECT name, count FROM usage WHERE day = ?1').bind(today),
    errorsToday: db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM app_errors WHERE day = ?1').bind(today),
    errorsYesterday: db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM app_errors WHERE day = ?1').bind(isoDay(now - DAY)),
    upkeep: db.prepare('SELECT ran_at FROM upkeep_log ORDER BY ran_at DESC LIMIT 1'),
    archive: db.prepare('SELECT ran_at, status, message FROM archive_log ORDER BY ran_at DESC LIMIT 1'),
    search: db.prepare('SELECT source, fetched_at, tried_at, error FROM search_snapshots'),
    alertsWaiting: db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM alert_queue WHERE sent_at IS NULL'),
    feedbackNew: db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'"),
    messagesUnread: db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE status = 'open' AND admin_unread > 0"),
    namesWaiting: db.prepare('SELECT COUNT(*) AS n FROM players p LEFT JOIN name_reviews r ON r.user_id = p.user_id WHERE r.name_key IS NULL OR r.name_key != p.name_key'),
    educatorsWaiting: db.prepare("SELECT COUNT(*) AS n FROM educator_requests WHERE status = 'pending'"),
    storiesWaiting: db.prepare("SELECT COUNT(*) AS n FROM story_submissions WHERE status = 'new' AND source = 'form'"),
    keysWaiting: db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE waiting = 1 AND revoked_at IS NULL'),
    tuningWaiting: db.prepare("SELECT COUNT(*) AS n FROM tuning_proposals WHERE status = 'waiting'"),
    reportsStuck: db.prepare("SELECT COUNT(*) AS n FROM puzzle_reports WHERE status = 'needs_fix'"),
    reportsWaiting: db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM puzzle_reports WHERE status IN ('new', 'checking')"),
  };
  const names = Object.keys(q);
  const t0 = Date.now();
  const res = await db.batch(Object.values(q));
  const ms = Date.now() - t0;
  const r = Object.fromEntries(names.map((k, i) => [k, res[i].results]));
  const size = res[0].meta?.size_after ?? null;
  return { r, ms, size };
}

// The latest run of each GitHub Actions workflow (needs GITHUB_DISPATCH_TOKEN,
// which has Actions access to this repository).
async function githubRuns(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { configured: false };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100&exclude_pull_requests=true`, {
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flg-api status' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { configured: true, error: `GitHub answered ${res.status}` };
    const j = await res.json();
    const latest = new Map();
    for (const run of j.workflow_runs || []) {
      if (run.event === 'pull_request') continue;
      if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run);
    }
    return {
      configured: true,
      runs: [...latest.values()].map((x) => ({ name: x.name, status: x.status, conclusion: x.conclusion, at: Date.parse(x.updated_at || x.created_at), url: x.html_url, event: x.event })),
    };
  } catch (e) {
    return { configured: true, error: 'GitHub did not answer' };
  }
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
    cached('gh', 3 * MIN, now, () => githubRuns(env)),
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
  if (!puzzles.ready) oracle.push(item('puzzles', 'Puzzle server', 'off', 'Not set up', 'The site builds puzzles itself until the server is connected (docs/PUZZLE-SERVER.md)'));
  else if (!puzzles.ok) oracle.push(item('puzzles', 'Puzzle server', 'down', 'Not answering', 'Players get the built-in puzzle engine meanwhile'));
  else oracle.push(item('puzzles', 'Puzzle server', puzzles.canary === 'failing' ? 'warn' : 'ok', 'Answering',
    [puzzles.release && `release ${String(puzzles.release).slice(0, 7)}`, puzzles.busy != null && `${puzzles.busy} busy`, puzzles.queued != null && `${puzzles.queued} queued`, puzzles.canary && `canary ${puzzles.canary}`].filter(Boolean).join(' · ')));
  if (!vox.ready && vox.reason === 'not_set_up') oracle.push(item('vox', 'Vox voice engine', 'off', 'Not set up', 'Vox runs on your Windows PC until it moves to the server (docs/VOX-SERVER.md)', 'voice-engine'));
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
  groups.push({ id: 'oracle', title: 'The Oracle server', items: oracle });

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
  if (settings) {
    free.push(settings.tts_enabled ? allowance('voices', 'Server voices today', used('tts'), settings.daily_tts_cap, at, 'settings') : item('voices', 'Server voices today', 'off', 'Off', 'Switched off in Settings', 'settings'));
    free.push(settings.ai_pictures !== 'none' ? allowance('pictures', 'AI pictures today', used('pictures'), settings.daily_picture_cap, at, 'settings') : item('pictures', 'AI pictures today', 'off', 'Off', 'Switched off in Settings', 'settings'));
    free.push(settings.translate_enabled ? allowance('translate', 'Translations today', used('translate'), settings.daily_translate_cap, at, 'settings') : item('translate', 'Translations today', 'off', 'Off', 'Switched off in Settings', 'settings'));
  }
  groups.push({ id: 'free', title: 'Free allowances (today, UTC)', items: free });

  // ---- Scheduled work
  const jobs = [];
  if (db) {
    jobs.push(lastRun('nightly', 'Nightly maintenance (2 am Eastern)', db.r.upkeep[0]?.ran_at, DAY, now, 'usage'));
    const a = db.r.archive[0];
    if (a && a.status === 'failed') jobs.push(item('archive', 'Weekly archive email', 'down', 'Failed', `${ago(a.ran_at, now)}${a.message ? `: ${a.message}` : ''}`, 'backups'));
    else jobs.push(lastRun('archive', 'Weekly archive email', a?.ran_at, 7 * DAY, now, 'backups', a ? `; last: ${a.status}` : ''));
    for (const s of db.r.search) {
      const label = `${s.source === 'google' ? 'Google' : s.source === 'bing' ? 'Bing' : s.source} search numbers`;
      if (s.error && s.tried_at > (s.fetched_at || 0)) jobs.push(item(`search-${s.source}`, label, 'warn', 'Last fetch failed', `${s.error} · last good ${ago(s.fetched_at, now)}`, 'search'));
      else jobs.push(lastRun(`search-${s.source}`, label, s.fetched_at, DAY, now, 'search'));
    }
    const w = db.r.alertsWaiting[0] || {};
    jobs.push(item('owner-alerts', 'Your push and email alerts', w.n && now - w.oldest > 2 * HOUR ? 'warn' : 'ok', w.n ? `${w.n} waiting` : 'Nothing waiting',
      w.n && now - w.oldest > 2 * HOUR ? `Waiting since ${ago(w.oldest, now)}; they go out every hour` : 'Sent every hour', 'settings'));
    const rw = db.r.reportsWaiting[0] || {};
    jobs.push(item('doctor', 'Puzzle doctor (problem reports)', rw.n && now - rw.oldest > 6 * HOUR ? 'warn' : 'ok', rw.n ? `${rw.n} in the queue` : 'Queue empty',
      rw.n && now - rw.oldest > 6 * HOUR ? `Oldest waiting ${ago(rw.oldest, now)}` : null, 'errortracking'));
  }
  if (conn?.github) jobs.push(lastRun('gh-report', 'GitHub connections report', conn.github.reportedAt, DAY, now, 'connections'));
  if (!gh.configured) jobs.push(item('actions', 'GitHub Actions', 'off', 'Not connected', 'Add the GITHUB_DISPATCH_TOKEN Worker secret to see each workflow\'s last run here', 'connections'));
  else if (gh.error) jobs.push(item('actions', 'GitHub Actions', 'unknown', 'Unknown', gh.error));
  else {
    for (const run of gh.runs.sort((x, y) => x.name.localeCompare(y.name))) {
      const state = run.status !== 'completed' ? 'ok' : run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral' ? 'ok' : run.conclusion === 'cancelled' ? 'warn' : 'down';
      jobs.push({ ...item(`run-${run.name}`, run.name, state, run.status !== 'completed' ? 'Running' : run.conclusion === 'success' ? 'Passed' : String(run.conclusion || 'Unknown').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), `${ago(run.at, now)} · ${run.event}`), url: run.url, kind: 'action' });
    }
  }
  groups.push({ id: 'jobs', title: 'Scheduled work', items: jobs });

  // ---- Waiting for you
  if (db) {
    const e = one('errorsToday');
    const y = one('errorsYesterday');
    const waiting = [
      item('errors', 'Game errors reported today', e > Math.max(50, y * 3) ? 'down' : e > Math.max(10, y * 1.5) ? 'warn' : 'ok', fmt(e), `yesterday ${fmt(y)}`, 'errortracking'),
      item('reports-stuck', 'Problem reports the doctor couldn\'t fix', one('reportsStuck') ? 'warn' : 'ok', fmt(one('reportsStuck')), null, 'errortracking'),
      item('messages', 'Unread player messages', one('messagesUnread') ? 'warn' : 'ok', fmt(one('messagesUnread')), null, 'communication'),
      item('feedback', 'New ideas and problems', one('feedbackNew') ? 'warn' : 'ok', fmt(one('feedbackNew')), null, 'communication'),
      item('names', 'Screen names to check', one('namesWaiting') ? 'warn' : 'ok', fmt(one('namesWaiting')), null, 'names'),
      item('educators', 'Educator requests', one('educatorsWaiting') ? 'warn' : 'ok', fmt(one('educatorsWaiting')), null, 'educators'),
      item('stories', 'Storyline submissions', one('storiesWaiting') ? 'warn' : 'ok', fmt(one('storiesWaiting')), null, 'story-submissions'),
      item('keys', 'App key requests', one('keysWaiting') ? 'warn' : 'ok', fmt(one('keysWaiting')), null, 'licenses'),
      item('tuning', 'Self-tuning changes to approve', one('tuningWaiting') ? 'warn' : 'ok', fmt(one('tuningWaiting')), null, 'analysis'),
    ];
    groups.push({ id: 'waiting', title: 'Waiting for you', items: waiting });
  }

  const all = groups.flatMap((g) => g.items);
  const count = (s) => all.filter((i) => i.state === s).length;
  const tally = { ok: count('ok'), warn: count('warn'), down: count('down'), off: count('off'), unknown: count('unknown') };
  // "Waiting for you" items are work, not faults: they don't make the whole page amber.
  const faults = groups.filter((g) => g.id !== 'waiting').flatMap((g) => g.items);
  const overall = faults.some((i) => i.state === 'down') ? 'down' : faults.some((i) => i.state === 'warn') ? 'warn' : 'ok';
  return { checkedAt: now, overall, counts: tally, refreshSeconds: 30, groups };
}
