// Report a Problem: the button in the footer of every screen of the game and
// every page of the website, and the error-tracking database behind it.
//
//   POST /v1/puzzle-report        { kind: puzzle|page, text, puzzle?, image?, files?, page, screen, reply, platform, version }
//                                 -> { tracking, category, reply, update, files, doctor }
//                                 or multipart: a 'report' part (that JSON) and up to 3 'file' parts,
//                                 the pictures and files the player attached (report-files.js)
//   GET  /v1/repaired/:token      the repaired puzzle, for the link in the apology email
//
// Admin (puzzleReportRoutes, under /admin/v1/):
//   POST puzzle-reports/claim     reports, playbook and probes for the puzzle doctor Action (owner)
//   POST puzzle-reports/done      its findings, repairs and probe results (owner)
//   GET  puzzle-reports/:id/puzzle    the reported puzzle as a file (moderator)
//   POST puzzle-reports/:id/retry     check again with the newest engine (admin)
//   GET  error-tracking?category=&status=&q=&before=   the Error tracking list (moderator)
//   GET  error-tracking/:id       one report in full: storyline, picture, error, reason, correction (moderator)
//   POST error-tracking/:id/done  the team has dealt with a report the doctor could not (moderator)
//   POST error-tracking/close     a merged code fix closes reports by tracking id (owner; Report fixes Action)
//   GET  error-tracking/:id/files/:fid  a picture or file the player attached (moderator)
//   GET  error-log?before=&event= the errors database: every step of every report, newest first (moderator)
//   GET  fault-patterns           what the doctor has learned (viewer)
//
// Categories. The moment a report arrives it gets its tracking id and its
// category: a Puzzle Problem is 'puzzle' (PZ-XXXXXXXX), a Web Page Issue is
// 'webstructure' (WS-XXXXXXXX). Both are kept in one table and used together:
//   - each report lists the reports of the other category from the same
//     screen and app version (related), both ways
//   - a puzzle the doctor finds nothing wrong with, on a screen and version
//     with Web Page Issues, is explained as most likely a display problem
//   - the learning table (fault_patterns) counts both: puzzle faults by fault,
//     theme and difficulty; page issues by screen and app version
//
// The puzzle doctor (scripts/puzzle-doctor.mjs, run by the Action
// puzzle-reports.yml every 15 minutes) checks each Puzzle Problem with the
// game's engine. It tries rebuild strategies in the order the learning table
// says works best for that fault (playbook), and probes known faults by making
// fresh puzzles like the faulty ones: when a newer engine no longer shows a
// fault, the reports waiting for that fix are sent back and repaired, and
// their players emailed, automatically. Details: server/PUZZLE-REPORTS.md.
// Nothing here identifies the player.
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { queueReply, releaseRepair, releaseUpdate } from './replies.js';
import { cleanText } from './feedback.js';
import { checkPuzzle } from './compete.js';
import { alert } from './alerts.js';
import { readFiles, saveFiles, filesOf, fileOut, logEvent, logOf, latestLog, callDoctor, readForm, MAX_FILES_CHARS } from './report-files.js';

const DAY = 24 * 3600_000;
export const MAX_TEXT = 1000;
export const MAX_PUZZLE_CHARS = 120_000;
const MAX_IMAGE_CHARS = 120_000;
const REPAIR_KEEP_MS = 30 * DAY;
export const REPORT_KEEP_DAYS = 365;
const RELATED_DAYS = 14;
const MAX_NEW_PER_DAY = 300;
const CLAIM_MAX = 5;
const CLAIM_TIMEOUT = 20 * 60_000;
const MAX_TRIES = 3;
const PROBE_GAP_MS = 6 * 3600_000;
const PROBES_PER_RUN = 3;
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios', 'site']);
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const CODES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CATEGORIES = { puzzle: { prefix: 'PZ', topic: 'puzzle', name: 'Puzzle' }, webstructure: { prefix: 'WS', topic: 'page', name: 'Web structure' } };
const LIST_MAX = 50;

// Unbiased: bytes at or above the largest multiple of the alphabet size are
// skipped, so every character is equally likely.
function randomCode(n) {
  const limit = 256 - (256 % CODES.length);
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < limit) out += CODES[b % CODES.length];
      if (out.length === n) break;
    }
  }
  return out;
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const parse = (t, fallback) => { try { return t ? JSON.parse(t) : fallback; } catch { return fallback; } };
const plain = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// "Puzzle screen: The Moonlit Crown" -> "Puzzle screen"; a website path stays as it is.
export const pageKey = (page) => String(page || '').split(':')[0].trim().slice(0, 120);

// A reported puzzle may be the broken one, so it is only checked for shape.
export function readablePuzzle(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.categories) || !Array.isArray(p.clues) || !Array.isArray(p.solution)) return null;
  const text = JSON.stringify(p);
  return text.length <= MAX_PUZZLE_CHARS ? text : null;
}
// The puzzle's picture as the game drew it. Only shown as an image in the
// dashboard (never inline), so scripts in it could not run; still, only SVG.
const readableImage = (v) => (typeof v === 'string' && /^\s*<svg[\s>]/i.test(v) && v.length <= MAX_IMAGE_CHARS ? v : null);

// Reports of the other category from the same screen and app version.
async function findRelated(env, category, page, version, now) {
  if (!page) return [];
  const other = category === 'puzzle' ? 'webstructure' : 'puzzle';
  const { results } = await env.DB.prepare(`SELECT tracking, page FROM puzzle_reports WHERE category = ?1 AND version = ?2 AND created_at > ?3 ORDER BY created_at DESC LIMIT 100`)
    .bind(other, version, now - RELATED_DAYS * DAY).all();
  return results.filter((r) => pageKey(r.page) === pageKey(page)).map((r) => r.tracking).slice(0, 20);
}
async function linkRelated(env, tracking, related) {
  for (const t of related) {
    const r = await env.DB.prepare('SELECT related FROM puzzle_reports WHERE tracking = ?1').bind(t).first();
    if (!r) continue;
    const list = parse(r.related, []);
    if (!list.includes(tracking)) await env.DB.prepare('UPDATE puzzle_reports SET related = ?2 WHERE tracking = ?1').bind(t, JSON.stringify([...list, tracking].slice(-20))).run();
  }
}

async function postReport(req, env, ctx) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_FEEDBACK && !(await env.LIMIT_FEEDBACK.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
    return json(req, env, { error: 'slow_down', message: 'That was quick! Wait a minute and try again.' }, 429, { 'Retry-After': '60' });
  }
  let body;
  const jsonMax = MAX_PUZZLE_CHARS + MAX_IMAGE_CHARS + 8_000;
  if (/^multipart\/form-data/i.test(req.headers.get('Content-Type') || '')) {
    // The Report a Problem page: the report's JSON plus its pictures and files.
    const form = await readForm(req, jsonMax);
    if (form.error) return json(req, env, { error: form.error, ...(form.message ? { message: form.message } : {}) }, form.status);
    body = form.body;
  } else {
    try { body = JSON.parse(await readText(req, jsonMax + MAX_FILES_CHARS)); } catch (e) {
      return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400);
    }
  }
  if (!(await getSettings(env)).feedback_enabled) return json(req, env, { error: 'switched_off', message: 'Problem reports are closed for now.' }, 503);
  const text = cleanText(body?.text).slice(0, MAX_TEXT);
  if (text.length < 5) return json(req, env, { error: 'too_short', message: 'Tell us a little about the problem (at least 5 characters).' }, 400);
  const files = readFiles(body.files);
  if (files.error) return json(req, env, files, 400);
  const category = body.kind === 'page' ? 'webstructure' : 'puzzle';
  const puzzle = category === 'puzzle' && body.puzzle ? readablePuzzle(body.puzzle) : null;
  if (category === 'puzzle' && body.puzzle && !puzzle) return json(req, env, { error: 'bad_puzzle', message: 'This puzzle could not be attached to the report.' }, 400);
  const page = plain(body.page ?? body.where, 200);
  if (!puzzle && !page) return json(req, env, { error: 'no_page', message: 'Say which page or puzzle the problem is on.' }, 400);
  const now = Date.now();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM puzzle_reports WHERE created_at > ?1').bind(now - DAY).first();
  if (n >= MAX_NEW_PER_DAY) return json(req, env, { error: 'busy', message: 'Lots of problems were reported today. Please try again tomorrow.' }, 429);
  const platform = PLATFORMS.has(body.platform) ? body.platform : 'web';
  const version = /^[\w.-]{1,24}$/.test(String(body.version)) ? String(body.version) : 'unknown';
  const screen = /^\d{2,5}x\d{2,5}$/.test(String(body.screen)) ? String(body.screen) : '';
  const p = puzzle ? body.puzzle : null;
  const cat = CATEGORIES[category];
  const tracking = `${cat.prefix}-${randomCode(8)}`;
  const status = category === 'webstructure' ? 'page' : puzzle ? 'new' : 'manual';
  const related = await findRelated(env, category, page, version, now);
  const fb = await env.DB.prepare("INSERT INTO feedback (kind, topic, text, platform, version, theme, created_at) VALUES ('problem', ?1, ?2, ?3, ?4, NULL, ?5) RETURNING id")
    .bind(cat.topic, `[${tracking}] ${text}`, platform === 'site' ? 'web' : platform, version, now).first();
  const report = await env.DB.prepare(`INSERT INTO puzzle_reports (tracking, category, feedback_id, puzzle, image, title, tier, theme, size, page, screen, platform, version, text, status, related, files, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?18, ?17) RETURNING id`)
    .bind(tracking, category, fb.id, puzzle, p ? readableImage(body.image) : null, plain(p?.title, 120), plain(p?.difficulty?.id, 20), plain(p?.theme?.id, 40),
      p ? `${p.categories.length}x${p.categories[0]?.items?.length || 0}` : '', page, screen, platform, version, text, status, JSON.stringify(related), now, files.length).first();
  await saveFiles(env, report.id, tracking, files, now);
  await linkRelated(env, tracking, related);
  if (category === 'webstructure') await learnPage(env, page, version, tracking, now);
  const doctor = await reviewNow(env, ctx, { id: report.id, tracking, category, status, page, version, related, files, title: plain(p?.title, 120), text }, now);
  let reply = 'none';
  let update = false;
  try { ({ reply, update } = await queueReply(req, env, 'problem', body.reply === true, `${text}\n\nReport number: ${tracking}`, fb.id, now)); } catch (e) { console.error(e); reply = 'error'; }
  return json(req, env, { ok: true, tracking, category, reply, update, files: files.length, doctor });
}

async function getRepaired(req, env, token) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  if (!TOKEN_RE.test(token)) return json(req, env, { error: 'not_found' }, 404);
  const now = Date.now();
  const r = await env.DB.prepare("SELECT id, tracking, repaired FROM puzzle_reports WHERE token = ?1 AND status = 'repaired' AND repaired IS NOT NULL AND repaired_at > ?2")
    .bind(token, now - REPAIR_KEEP_MS).first();
  if (!r) return json(req, env, { error: 'gone', message: 'This repaired puzzle is no longer available. Repaired puzzles are kept for 30 days.' }, 404);
  await env.DB.prepare('UPDATE puzzle_reports SET opened_at = COALESCE(opened_at, ?2) WHERE id = ?1').bind(r.id, now).run();
  return json(req, env, { tracking: r.tracking, puzzle: JSON.parse(r.repaired) });
}

// The doctor's first look, the moment a report arrives, logged in the errors
// database and sent to the admins at once (a "problems" alert):
//   a puzzle      the Puzzle doctor Action is started now; it checks, repairs
//                 and reports back within a minute or two (finishReports)
//   no puzzle     the team looks; the report is counted with its screen
//   a web page    counted with its screen and version, with any puzzle
//                 reports from there, for the daily code-fix task
// Returns 'called' (the doctor is on it), 'queued' (next 15-minute round) or
// 'reviewed' (no puzzle to check).
async function reviewNow(env, ctx, r, now) {
  const base = { reportId: r.id, tracking: r.tracking, category: r.category };
  const where = r.title ? `“${r.title}”` : r.page || 'an unnamed page';
  await logEvent(env, { ...base, event: 'received', status: r.status, detail: `${CATEGORIES[r.category].name} report about ${where}${r.version ? ` (version ${r.version})` : ''}.` }, now);
  if (r.files.length) await logEvent(env, { ...base, event: 'files', status: r.status, detail: `${r.files.length} attached: ${r.files.map((f) => `${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`).join(', ')}.` }, now);
  let doctor = 'reviewed';
  let review;
  if (r.status === 'new') {
    doctor = (await callDoctor(env)) ? 'called' : 'queued';
    review = doctor === 'called' ? 'The puzzle doctor was started at once to check and repair the puzzle.' : 'The puzzle doctor will check it in its next round (within 15 minutes).';
    await logEvent(env, { ...base, event: doctor === 'called' ? 'doctor_called' : 'doctor_waiting', status: r.status, detail: review }, now);
  } else {
    const same = await env.DB.prepare('SELECT COUNT(*) AS n FROM puzzle_reports WHERE category = ?1 AND page = ?2 AND version = ?3 AND created_at > ?4')
      .bind(r.category, r.page, r.version, now - 30 * DAY).first();
    const n = same?.n || 1;
    const others = r.related.length ? ` ${r.related.length} related ${r.category === 'puzzle' ? 'page' : 'puzzle'} report${r.related.length === 1 ? '' : 's'} from the same screen.` : '';
    review = r.category === 'webstructure'
      ? `Web Page Issue on ${pageKey(r.page) || 'a page'}${n > 1 ? `: report ${n} for this screen and version in 30 days` : ''}.${others} Waiting for the daily code fix.`
      : `No puzzle was attached, so there is nothing for the doctor to rebuild; the team looks at it.${others}`;
    await logEvent(env, { ...base, event: 'reviewed', status: r.status, detail: review }, now);
  }
  await alert(env, ctx, { category: 'problems', title: `New problem report ${r.tracking}`, body: `${review} ${r.files.length ? `${r.files.length} file${r.files.length === 1 ? '' : 's'} attached. ` : ''}Player wrote: ${r.text.slice(0, 160)}`, link: 'errortracking' });
  await logEvent(env, { ...base, event: 'alerted', status: r.status, detail: 'Sent to the admins (push and email, as set in My alerts).' }, now);
  return doctor;
}

// Returns a Response for the public routes, or null for anything else.
export async function handlePuzzleReports(req, env, url, ctx) {
  if (url.pathname === '/v1/puzzle-report' && req.method === 'POST') return postReport(req, env, ctx);
  const m = url.pathname.match(/^\/v1\/repaired\/([^/]{1,64})$/);
  if (m && req.method === 'GET') return getRepaired(req, env, m[1]);
  return null;
}

// ------------------------------------------------------------- learning
async function upsertPattern(env, key, base, change, now) {
  const db = env.DB;
  const row = await db.prepare('SELECT * FROM fault_patterns WHERE key = ?1').bind(key).first();
  const p = row || { key, ...base, seen: 0, repaired: 0, needs_fix: 0, strategies: '{}', clue_types: '{}', first_seen: now, last_engine: '', last_tracking: '' };
  const next = change({ ...p, strategies: parse(p.strategies, {}), clue_types: parse(p.clue_types, {}) });
  await db.prepare(`INSERT INTO fault_patterns (key, category, code, theme, tier, size, page, version, seen, repaired, needs_fix, strategies, clue_types, first_seen, last_seen, last_engine, last_tracking, resolved_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
    ON CONFLICT (key) DO UPDATE SET size = excluded.size, seen = excluded.seen, repaired = excluded.repaired, needs_fix = excluded.needs_fix,
      strategies = excluded.strategies, clue_types = excluded.clue_types, last_seen = excluded.last_seen, last_engine = excluded.last_engine,
      last_tracking = excluded.last_tracking, resolved_at = excluded.resolved_at`)
    .bind(key, next.category, next.code, next.theme || '', next.tier || '', next.size || '', next.page || '', next.version || '', next.seen, next.repaired, next.needs_fix,
      JSON.stringify(next.strategies), JSON.stringify(next.clue_types), next.first_seen, now, next.last_engine || '', next.last_tracking || '', next.resolved_at ?? null).run();
}

function learnPage(env, page, version, tracking, now) {
  return upsertPattern(env, `ws|${pageKey(page)}|${version}`, { category: 'webstructure', code: 'page_issue', page: pageKey(page), version }, (p) => ({ ...p, seen: p.seen + 1, last_tracking: tracking }), now);
}

function learnPuzzle(env, report, res, now) {
  const codes = [...new Set(res.findings.map((f) => f.code))];
  return Promise.all(codes.map((code) => upsertPattern(env, `pz|${code}|${report.theme}|${report.tier}`, { category: 'puzzle', code, theme: report.theme, tier: report.tier, size: report.size }, (p) => {
    const strategies = { ...p.strategies };
    for (const name of res.tried || []) {
      const s = strategies[name] || { tried: 0, worked: 0 };
      strategies[name] = { tried: s.tried + 1, worked: s.worked + (name === res.strategy ? 1 : 0) };
    }
    const clueTypes = { ...p.clue_types };
    if (code === 'false_clue') for (const t of res.clueTypes || []) clueTypes[t] = (clueTypes[t] || 0) + 1;
    return { ...p, size: report.size || p.size, seen: p.seen + 1, repaired: p.repaired + (res.repaired ? 1 : 0), needs_fix: p.needs_fix + (res.repaired ? 0 : 1),
      strategies, clue_types: clueTypes, last_engine: res.engine || p.last_engine, last_tracking: report.tracking, resolved_at: res.repaired ? p.resolved_at : null };
  }, now)));
}

// { code: [strategy names, best first] }: the share of tries that worked,
// with untried strategies left in the doctor's own order.
export async function playbook(env) {
  const { results } = await env.DB.prepare("SELECT code, strategies FROM fault_patterns WHERE category = 'puzzle'").all();
  const byCode = {};
  for (const r of results) {
    for (const [name, s] of Object.entries(parse(r.strategies, {}))) {
      const b = ((byCode[r.code] ||= {})[name] ||= { tried: 0, worked: 0 });
      b.tried += s.tried || 0;
      b.worked += s.worked || 0;
    }
  }
  return Object.fromEntries(Object.entries(byCode).map(([code, m]) => [code,
    Object.entries(m).filter(([, s]) => s.worked > 0).sort((a, b) => b[1].worked / b[1].tried - a[1].worked / a[1].tried || b[1].worked - a[1].worked).map(([name]) => name)]));
}

// Known faults to self-diagnose: still waiting for a fix, or seen lately.
async function probesDue(env, now) {
  const { results } = await env.DB.prepare(`SELECT key, code, theme, tier, size FROM fault_patterns WHERE category = 'puzzle'
    AND (resolved_at IS NULL OR last_seen > ?1) AND (probe_at IS NULL OR probe_at < ?2) ORDER BY needs_fix DESC, last_seen DESC LIMIT ?3`)
    .bind(now - 30 * DAY, now - PROBE_GAP_MS, PROBES_PER_RUN).all();
  return results.map((r) => {
    const [categories, items] = String(r.size || '').split('x').map(Number);
    return { key: r.key, code: r.code, theme: r.theme, tier: r.tier, categories: categories || undefined, items: items || undefined };
  });
}

async function finishProbe(env, probe, now) {
  const db = env.DB;
  const p = await db.prepare('SELECT * FROM fault_patterns WHERE key = ?1').bind(String(probe?.key || '')).first();
  const tested = Number(probe?.tested) || 0;
  if (!p || !tested) return 0;
  const faults = Number(probe.codes?.[p.code]) || 0;
  const engine = plain(probe.engine, 20);
  const gone = faults === 0;
  await db.prepare('UPDATE fault_patterns SET probe_engine = ?2, probe_at = ?3, probe_tested = ?4, probe_faults = ?5, resolved_at = ?6 WHERE key = ?1')
    .bind(p.key, engine, now, tested, faults, gone ? (p.resolved_at || now) : null).run();
  if (!gone) return 0;
  // Self-repair: the fault no longer shows, so the reports waiting for a fix go back to the doctor.
  const r = await db.prepare(`UPDATE puzzle_reports SET status = 'new', tries = 0 WHERE category = 'puzzle' AND status = 'needs_fix' AND theme = ?1 AND tier = ?2 AND findings LIKE ?3`)
    .bind(p.theme, p.tier, `%"code":"${p.code}"%`).run();
  return r.meta.changes || 0;
}

// ------------------------------------------------------------- the doctor
export async function claimReports(env, limit, now = Date.now()) {
  const db = env.DB;
  await db.batch([
    db.prepare("UPDATE puzzle_reports SET status = 'needs_fix', findings = COALESCE(findings, '[]') WHERE status = 'checking' AND claimed_at < ?1 AND tries >= ?2").bind(now - CLAIM_TIMEOUT, MAX_TRIES),
    db.prepare("UPDATE puzzle_reports SET status = 'new' WHERE status = 'checking' AND claimed_at < ?1").bind(now - CLAIM_TIMEOUT),
  ]);
  const n = Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX));
  const { results } = await db.prepare("SELECT id, puzzle FROM puzzle_reports WHERE category = 'puzzle' AND status = 'new' AND puzzle IS NOT NULL ORDER BY created_at LIMIT ?1").bind(n).all();
  if (results.length) await db.batch(results.map((r) => db.prepare("UPDATE puzzle_reports SET status = 'checking', claimed_at = ?1, tries = tries + 1 WHERE id = ?2").bind(now, r.id)));
  return { reports: results.map((r) => ({ id: r.id, puzzle: JSON.parse(r.puzzle) })), playbook: await playbook(env), probes: await probesDue(env, now) };
}

const cleanFindings = (list) => (Array.isArray(list) ? list : []).slice(0, 12)
  .map((f) => ({ code: plain(f?.code || 'other', 30), text: plain(f?.text, 300) }))
  .filter((f) => f.text);

// The doctor's verdict, logged in the errors database and sent to the admins
// at once, so they hear the outcome as soon as the doctor has it.
const VERDICT = {
  repaired: (n) => `Repaired: ${n}`,
  needs_fix: () => 'Needs a fix in the code: today\'s puzzle maker still makes this fault, so the daily code-fix task picks it up.',
  no_fault: () => 'No fault found in the puzzle.',
  display: () => 'No fault in the puzzle; most likely a display problem, tracked with the page reports from the same screen.',
  closed: (n) => `Closed by a code fix: ${n}`,
};
async function report(env, ctx, row, event, findings, note, status, now) {
  const reason = findings.length ? ` Found: ${findings.map((f) => f.text).join(' ')}` : '';
  const detail = `${VERDICT[event](note || '')}${reason}`;
  await logEvent(env, { reportId: row.id, tracking: row.tracking, category: 'puzzle', event, status, detail }, now);
  await alert(env, ctx, { category: 'problems', title: `Doctor: ${row.tracking} ${event === 'repaired' ? 'repaired' : event === 'needs_fix' ? 'needs a code fix' : event === 'closed' ? 'closed' : 'no fault found'}`, body: detail, link: 'errortracking', instant: true });
}

export async function finishReports(env, results, site, now = Date.now(), probes = [], ctx = null) {
  const db = env.DB;
  const out = { repaired: 0, needsFix: 0, noFault: 0, emailed: 0, display: 0, requeued: 0, probed: 0, closed: 0 };
  for (const res of (Array.isArray(results) ? results : []).slice(0, CLAIM_MAX)) {
    const id = Number(res?.id);
    const row = Number.isInteger(id) && await db.prepare("SELECT id, tracking, feedback_id AS fid, theme, tier, size, page, version, related, fix_note, fixed_in FROM puzzle_reports WHERE id = ?1 AND status = 'checking'").bind(id).first();
    if (!row) continue;
    const findings = cleanFindings(res.findings);
    const engine = plain(res.engine, 20);
    await logEvent(env, { reportId: row.id, tracking: row.tracking, category: 'puzzle', event: 'reviewed', status: 'checking', detail: `Checked with engine ${engine || 'unknown'}: ${findings.length ? `${findings.length} problem${findings.length === 1 ? '' : 's'} found` : 'every check passed'}.` }, now);
    const tried = (Array.isArray(res.tried) ? res.tried : []).map((t) => plain(t, 30)).slice(0, 10);
    const strategy = res.strategy ? plain(res.strategy, 30) : null;
    const repaired = res.repaired && !checkPuzzle(res.repaired) ? JSON.stringify(res.repaired) : null;
    if (findings.length && repaired && repaired.length <= MAX_PUZZLE_CHARS) {
      const token = randomToken();
      const made = plain(res.note, 500) || 'We rebuilt your puzzle with our corrected puzzle maker and checked it.';
      const note = row.fixed_in ? withVersion(made, row.fixed_in) : made;
      await db.batch([
        db.prepare("UPDATE puzzle_reports SET status = 'repaired', findings = ?2, note = ?3, repaired = ?4, token = ?5, engine = ?6, strategy = ?7, checked_at = ?8, repaired_at = ?8 WHERE id = ?1")
          .bind(id, JSON.stringify(findings), note, repaired, token, engine, strategy, now),
        db.prepare("UPDATE feedback SET status = 'addressed', note = ?2, done_at = ?3 WHERE id = ?1").bind(row.fid, note, now),
      ]);
      const link = `${String(site || 'https://thelogicgrid.com').replace(/\/+$/, '')}/?repaired=${token}`;
      const mailed = await releaseRepair(env, row.fid, note, findings.map((f) => f.text).join('\n'), link);
      out.emailed += mailed;
      out.repaired++;
      await report(env, ctx, row, 'repaired', findings, `${note}${mailed ? ' The player was emailed the repaired puzzle.' : ''}`, 'repaired', now);
    } else if (findings.length) {
      await db.prepare("UPDATE puzzle_reports SET status = 'needs_fix', findings = ?2, engine = ?3, checked_at = ?4 WHERE id = ?1").bind(id, JSON.stringify(findings), engine, now).run();
      out.needsFix++;
      await report(env, ctx, row, 'needs_fix', findings, '', 'needs_fix', now);
    } else if (row.fix_note) {
      // Sent back after a code fix, and today's engine finds nothing left to
      // repair: the fix itself was the answer, so the report closes with its note.
      const note = withVersion(row.fix_note, row.fixed_in);
      await db.batch([
        db.prepare("UPDATE puzzle_reports SET status = 'done', findings = '[]', note = ?2, engine = ?3, checked_at = ?4 WHERE id = ?1").bind(id, note, engine, now),
        db.prepare("UPDATE feedback SET status = 'addressed', note = ?2, done_at = ?3 WHERE id = ?1").bind(row.fid, note, now),
      ]);
      out.emailed += await releaseUpdate(env, row.fid, note);
      out.closed++;
      await report(env, ctx, row, 'closed', [], note, 'done', now);
    } else {
      // Nothing wrong in the puzzle. Web Page Issues from the same screen and
      // app version point at a display problem instead.
      const related = [...new Set([...parse(row.related, []), ...(await findRelated(env, 'puzzle', row.page, row.version, now))])];
      const pages = related.filter((t) => t.startsWith('WS-'));
      const display = pages.length ? [{ code: 'display', text: `Nothing was wrong in the puzzle itself. ${pages.length === 1 ? 'Another player' : `${pages.length} other reports`} described a problem with the same screen in this version of the game, so it is most likely a display problem; it is tracked with ${pages.length === 1 ? 'that report' : 'those reports'}.` }] : [];
      await db.prepare("UPDATE puzzle_reports SET status = 'no_fault', findings = ?2, related = ?3, engine = ?4, checked_at = ?5 WHERE id = ?1")
        .bind(id, JSON.stringify(display), JSON.stringify(related), engine, now).run();
      if (display.length) { out.display++; await upsertPattern(env, `ws|${pageKey(row.page)}|${row.version}`, { category: 'webstructure', code: 'page_issue', page: pageKey(row.page), version: row.version }, (p) => ({ ...p, seen: p.seen + 1, last_tracking: row.tracking }), now); }
      out.noFault++;
      await report(env, ctx, row, display.length ? 'display' : 'no_fault', display, '', 'no_fault', now);
    }
    if (findings.length) await learnPuzzle(env, row, { findings, repaired: !!repaired, strategy, tried, engine, clueTypes: (Array.isArray(res.clueTypes) ? res.clueTypes : []).map((t) => plain(t, 20)) }, now);
  }
  for (const probe of (Array.isArray(probes) ? probes : []).slice(0, PROBES_PER_RUN)) {
    out.requeued += await finishProbe(env, probe, now);
    out.probed++;
  }
  return out;
}

// ------------------------------------------------------------- code fixes
// A merged pull request that fixes reported problems says so in its body
// ("Fixes reports: PZ-..., WS-..." and a "Player note:" in everyday words);
// the Report fixes Action (scripts/report-fixes.mjs) sends them here with the
// version the fix shipped in. Each waiting report is closed the way the team's
// Mark done button closes it: addressed, with the note and version, and the
// player who asked is emailed. A puzzle report that needed a fix in the puzzle
// maker goes back to the doctor instead, so the player gets the repaired
// puzzle; its note waits in fix_note in case nothing is left to repair.
export const TRACKING_RE = /^(PZ|WS)-[A-Z2-9]{8}$/;
export const withVersion = (note, version) => (version ? `${String(note).replace(/[\s.]*$/, '')}. Fixed in version ${version}.` : String(note));

export async function closeReports(env, { trackings, note, fixedIn }, now = Date.now()) {
  const db = env.DB;
  const list = [...new Set((Array.isArray(trackings) ? trackings : []).map((t) => String(t).trim().toUpperCase()).filter((t) => TRACKING_RE.test(t)))].slice(0, 50);
  const text = plain(note, 400);
  const version = /^\d+(\.\d+){1,3}$/.test(String(fixedIn || '')) ? String(fixedIn) : '';
  const out = { closed: 0, requeued: 0, emailed: 0, skipped: [] };
  if (!text) return out;
  for (const tracking of list) {
    const row = await db.prepare("SELECT id, feedback_id AS fid, category, status, (puzzle IS NOT NULL) AS hasPuzzle FROM puzzle_reports WHERE tracking = ?1").bind(tracking).first();
    if (!row || !['needs_fix', 'no_fault', 'manual', 'page'].includes(row.status)) { out.skipped.push(tracking); continue; }
    if (row.category === 'puzzle' && row.status === 'needs_fix' && row.hasPuzzle) {
      await db.prepare("UPDATE puzzle_reports SET status = 'new', tries = 0, fix_note = ?2, fixed_in = ?3 WHERE id = ?1").bind(row.id, text, version || null).run();
      out.requeued++;
      await logEvent(env, { reportId: row.id, tracking, category: row.category, event: 'doctor_waiting', status: 'new', detail: `A code fix${version ? ` in version ${version}` : ''} shipped; sent back to the doctor to rebuild the puzzle.` }, now);
      continue;
    }
    const full = withVersion(text, version);
    await db.batch([
      db.prepare("UPDATE puzzle_reports SET status = 'done', note = ?2, fix_note = ?3, fixed_in = ?4, checked_at = ?5 WHERE id = ?1").bind(row.id, full, text, version || null, now),
      db.prepare("UPDATE feedback SET status = 'addressed', note = ?2, done_at = ?3 WHERE id = ?1").bind(row.fid, full, now),
    ]);
    out.emailed += await releaseUpdate(env, row.fid, full);
    out.closed++;
    await logEvent(env, { reportId: row.id, tracking, category: row.category, event: 'closed', status: 'done', detail: `Closed by a code fix: ${full}` }, now);
  }
  return out;
}

// ------------------------------------------------------------- the dashboard
// For the Communication inbox: the report behind each reported problem.
export async function reportsFor(env, feedbackIds) {
  if (!feedbackIds.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT id, feedback_id AS fid, tracking, category, title, tier, theme, page, status, findings, note, strategy, related, engine, opened_at AS openedAt, repaired_at AS repairedAt
    FROM puzzle_reports WHERE feedback_id IN (${feedbackIds.map(() => '?').join(',')})`).bind(...feedbackIds).all();
  return new Map(results.map((r) => [r.fid, { ...r, findings: parse(r.findings, []), related: parse(r.related, []) }]));
}

const SUMMARY = `id, tracking, category, title, tier, theme, size, page, platform, version, text, status, findings, note, strategy, related, engine,
  fixed_in AS fixedIn, created_at AS createdAt, checked_at AS checkedAt, repaired_at AS repairedAt, opened_at AS openedAt, (image IS NOT NULL) AS hasImage, (puzzle IS NOT NULL) AS hasPuzzle, files`;

export async function errorList(env, url) {
  const category = CATEGORIES[url.searchParams.get('category')] ? url.searchParams.get('category') : null;
  const status = /^[a-z_]{2,12}$/.test(url.searchParams.get('status') || '') ? url.searchParams.get('status') : null;
  const q = plain(url.searchParams.get('q'), 60);
  const before = Number(url.searchParams.get('before')) || null;
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { results } = await env.DB.prepare(`SELECT ${SUMMARY} FROM puzzle_reports
    WHERE (?1 IS NULL OR category = ?1) AND (?2 IS NULL OR status = ?2) AND (?3 IS NULL OR id < ?3)
      AND (?4 IS NULL OR tracking LIKE ?4 ESCAPE '\\' OR title LIKE ?4 ESCAPE '\\' OR text LIKE ?4 ESCAPE '\\' OR page LIKE ?4 ESCAPE '\\')
    ORDER BY id DESC LIMIT ?5`).bind(category, status, before, like, LIST_MAX).all();
  const { results: counts } = await env.DB.prepare('SELECT category, status, COUNT(*) AS n FROM puzzle_reports GROUP BY category, status').all();
  return {
    reports: results.map((r) => ({ ...r, findings: parse(r.findings, []), related: parse(r.related, []), hasImage: !!r.hasImage, hasPuzzle: !!r.hasPuzzle })),
    counts, more: results.length === LIST_MAX ? results[results.length - 1].id : null,
  };
}

// One report in full, with the storyline and picture of the puzzle as reported
// and, when repaired, as rebuilt.
export async function errorDetail(env, id) {
  const r = await env.DB.prepare(`SELECT ${SUMMARY}, puzzle, image, repaired FROM puzzle_reports WHERE id = ?1`).bind(id).first();
  if (!r) return null;
  const story = (t) => { const p = parse(t, null); return p ? { title: p.title, theme: p.theme?.name || p.theme?.id || '', topic: p.topic?.name || '', paragraphs: p.story?.paragraphs || [], ending: p.story?.ending || '', clues: (p.clues || []).map((c) => c.text) } : null; };
  return {
    ...r, puzzle: undefined, repaired: undefined, findings: parse(r.findings, []), related: parse(r.related, []), hasImage: !!r.image, hasPuzzle: !!r.puzzle,
    story: story(r.puzzle), repairedStory: story(r.repaired), attachments: await filesOf(env, id), log: await logOf(env, id),
  };
}

export async function faultPatterns(env) {
  const { results } = await env.DB.prepare('SELECT * FROM fault_patterns ORDER BY category, (resolved_at IS NULL) DESC, last_seen DESC LIMIT 200').all();
  return {
    patterns: results.map((r) => ({ ...r, strategies: parse(r.strategies, {}), clue_types: parse(r.clue_types, {}) })),
    playbook: await playbook(env),
  };
}

export function upkeepStatements(env, now) {
  return {
    puzzle_reports: env.DB.prepare('DELETE FROM puzzle_reports WHERE created_at < ?1').bind(now - REPORT_KEEP_DAYS * DAY),
    puzzle_reports_repaired: env.DB.prepare('UPDATE puzzle_reports SET repaired = NULL, token = NULL WHERE repaired IS NOT NULL AND repaired_at < ?1').bind(now - REPAIR_KEEP_MS),
  };
}

export function puzzleReportRoutes(Refusal) {
  return [
    ['POST', /^puzzle-reports\/claim$/, 'owner', 'puzzle-reports.claim', async ({ env, body, now }) => {
      const r = await claimReports(env, body.limit, now);
      return { body: r, quiet: !r.reports.length && !r.probes.length, detail: { claimed: r.reports.length, probes: r.probes.length } };
    }],
    ['POST', /^puzzle-reports\/done$/, 'owner', 'puzzle-reports.done', async ({ env, ctx, body, now }) => {
      const r = await finishReports(env, body.results, env.SITE_URL, now, body.probes, ctx);
      return { body: r, detail: r };
    }, { maxBody: CLAIM_MAX * (MAX_PUZZLE_CHARS + 10_000) }],
    ['GET', /^puzzle-reports\/(\d{1,12})\/puzzle$/, 'moderator', 'puzzle-reports.download', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('SELECT tracking, puzzle FROM puzzle_reports WHERE id = ?1').bind(Number(id)).first();
      if (!r || !r.puzzle) throw new Refusal(404, 'gone', 'That report has no puzzle.');
      const file = JSON.stringify({ format: 'fantastical-logic-grid', version: 1, save: { name: `Reported ${r.tracking}`, puzzle: JSON.parse(r.puzzle) } }, null, 1);
      return { file, type: 'application/json', name: `${r.tracking}.flg.json`, target: id, quiet: true };
    }],
    ['POST', /^puzzle-reports\/(\d{1,12})\/retry$/, 'admin', 'puzzle-reports.retry', async ({ env, params: [id], now }) => {
      const r = await env.DB.prepare("UPDATE puzzle_reports SET status = 'new', tries = 0 WHERE id = ?1 AND puzzle IS NOT NULL AND status IN ('needs_fix', 'no_fault')").bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(409, 'not_now', 'Only a puzzle report the doctor could not repair can be checked again.');
      const row = await env.DB.prepare('SELECT tracking FROM puzzle_reports WHERE id = ?1').bind(Number(id)).first();
      const called = await callDoctor(env);
      await logEvent(env, { reportId: Number(id), tracking: row?.tracking || '', category: 'puzzle', event: called ? 'doctor_called' : 'doctor_waiting', status: 'new', detail: `Check again asked for by the team; ${called ? 'the doctor was started at once' : 'the doctor checks it in its next round'}.` }, now);
      return { body: { ok: true, doctor: called ? 'called' : 'queued' }, target: id };
    }],
    ['GET', /^error-tracking$/, 'moderator', 'errors.tracking', async ({ env, url }) => ({ body: await errorList(env, url), quiet: true })],
    ['GET', /^error-tracking\/(\d{1,12})$/, 'moderator', 'errors.tracking.view', async ({ env, params: [id] }) => {
      const r = await errorDetail(env, Number(id));
      if (!r) throw new Refusal(404, 'gone', 'That report is gone.');
      return { body: r, quiet: true };
    }],
    ['POST', /^error-tracking\/(\d{1,12})\/done$/, 'moderator', 'errors.tracking.done', async ({ env, params: [id], body, now }) => {
      const note = plain(body.note, 500);
      if (!note) throw new Refusal(400, 'bad_note', 'Write what was done, in everyday words.');
      const row = await env.DB.prepare("SELECT feedback_id AS fid, tracking, category FROM puzzle_reports WHERE id = ?1 AND status IN ('needs_fix', 'no_fault', 'manual', 'page')").bind(Number(id)).first();
      if (!row) throw new Refusal(409, 'not_now', 'That report is already repaired or done.');
      await env.DB.batch([
        env.DB.prepare("UPDATE puzzle_reports SET status = 'done', note = ?2, checked_at = ?3 WHERE id = ?1").bind(Number(id), note, now),
        env.DB.prepare("UPDATE feedback SET status = 'addressed', note = ?2, done_at = ?3 WHERE id = ?1").bind(row.fid, note, now),
      ]);
      // A player who asked gets the usual "addressed" update with this note.
      const emailed = await releaseUpdate(env, row.fid, note);
      await logEvent(env, { reportId: Number(id), tracking: row.tracking, category: row.category, event: 'done', status: 'done', detail: `Marked done by the team: ${note}${emailed ? ' The player was emailed.' : ''}` }, now);
      return { body: { ok: true, emailed }, target: id, detail: { note, emailed } };
    }],
    ['POST', /^error-tracking\/close$/, 'owner', 'errors.tracking.close', async ({ env, body, now }) => {
      if (!plain(body.note, 400)) throw new Refusal(400, 'bad_note', 'Write what was done, in everyday words.');
      const r = await closeReports(env, body, now);
      return { body: r, detail: { closed: r.closed, requeued: r.requeued, fixedIn: plain(body.fixedIn, 20) } };
    }],
    ['GET', /^error-tracking\/(\d{1,12})\/files\/(\d{1,12})$/, 'moderator', 'errors.tracking.file', async ({ env, params: [id, fid] }) => {
      const out = await fileOut(env, Number(id), Number(fid));
      if (!out) throw new Refusal(404, 'gone', 'That file is gone. Attachments are kept for 90 days.');
      return out;
    }],
    ['GET', /^error-log$/, 'moderator', 'errors.log', async ({ env, url }) => ({ body: await latestLog(env, url), quiet: true })],
    ['GET', /^fault-patterns$/, 'viewer', 'errors.patterns', async ({ env }) => ({ body: await faultPatterns(env), quiet: true })],
  ];
}
