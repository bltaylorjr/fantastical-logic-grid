// Report a problem on a puzzle: the button under every puzzle in the game.
//
//   POST /v1/puzzle-report        { text, puzzle, reply, platform, version } -> { tracking, reply, update }
//   GET  /v1/repaired/:token      the repaired puzzle, for the link in the apology email
//
// Admin (puzzleReportRoutes, under /admin/v1/):
//   POST puzzle-reports/claim     reports for the puzzle doctor Action (owner)
//   POST puzzle-reports/done      its findings and repaired puzzles (owner)
//   GET  puzzle-reports/:id/puzzle    the reported puzzle as a file (moderator)
//   POST puzzle-reports/:id/retry     check again with the newest engine (admin)
//
// How it works (server/PUZZLE-REPORTS.md): the report is saved as an ordinary
// problem (feedback, topic 'puzzle') plus the puzzle itself under a tracking id
// the player sees. A player signed in with a confirmed email who ticked
// "Email me when it is fixed" gets the usual "we received your report" email,
// and an update waits (replies.js). The GitHub Action puzzle-reports.yml runs
// the puzzle doctor (scripts/puzzle-doctor.mjs) every 15 minutes:
//   - repaired: the report is marked addressed, and the waiting email becomes
//     the apology with what was found, what was done and a link that puts the
//     repaired puzzle in the player's Saved puzzles (kept 30 days)
//   - needs_fix: something is wrong that today's engine still gets wrong; once a
//     fix ships, Retry (or the next engine version) repairs it
//   - no_fault: nothing wrong found; the team reads the report as usual
// Nothing here identifies the player.
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { queueReply, releaseRepair } from './replies.js';
import { cleanText } from './feedback.js';
import { checkPuzzle } from './compete.js';

const DAY = 24 * 3600_000;
export const MAX_TEXT = 1000;
export const MAX_PUZZLE_CHARS = 400_000;
const REPAIR_KEEP_MS = 30 * DAY;
export const REPORT_KEEP_DAYS = 90;
const MAX_NEW_PER_DAY = 300;
const CLAIM_MAX = 5;
const CLAIM_TIMEOUT = 20 * 60_000;
const MAX_TRIES = 3;
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const CODES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => CODES[b % CODES.length]).join('');
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A reported puzzle may be the broken one, so it is only checked for shape,
// not for being correct.
export function readablePuzzle(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.categories) || !Array.isArray(p.clues) || !Array.isArray(p.solution)) return null;
  const text = JSON.stringify(p);
  return text.length <= MAX_PUZZLE_CHARS ? text : null;
}

async function postReport(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_FEEDBACK && !(await env.LIMIT_FEEDBACK.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
    return json(req, env, { error: 'slow_down', message: 'That was quick! Wait a minute and try again.' }, 429, { 'Retry-After': '60' });
  }
  let body;
  try { body = JSON.parse(await readText(req, MAX_PUZZLE_CHARS + 8_000)); } catch (e) {
    return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400);
  }
  if (!(await getSettings(env)).feedback_enabled) return json(req, env, { error: 'switched_off', message: 'Problem reports are closed for now.' }, 503);
  const text = cleanText(body?.text).slice(0, MAX_TEXT);
  if (text.length < 5) return json(req, env, { error: 'too_short', message: 'Tell us a little about the problem (at least 5 characters).' }, 400);
  const puzzle = readablePuzzle(body?.puzzle);
  if (!puzzle) return json(req, env, { error: 'bad_puzzle', message: 'This puzzle could not be attached to the report.' }, 400);
  const now = Date.now();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM puzzle_reports WHERE created_at > ?1').bind(now - DAY).first();
  if (n >= MAX_NEW_PER_DAY) return json(req, env, { error: 'busy', message: 'Lots of problems were reported today. Please try again tomorrow.' }, 429);
  const platform = PLATFORMS.has(body.platform) ? body.platform : 'web';
  const version = /^[\w.-]{1,24}$/.test(String(body.version)) ? String(body.version) : 'unknown';
  const p = body.puzzle;
  const tracking = `PZ-${randomCode(8)}`;
  const fb = await env.DB.prepare("INSERT INTO feedback (kind, topic, text, platform, version, theme, created_at) VALUES ('problem', 'puzzle', ?1, ?2, ?3, NULL, ?4) RETURNING id")
    .bind(`[${tracking}] ${text}`, platform, version, now).first();
  await env.DB.prepare(`INSERT INTO puzzle_reports (tracking, feedback_id, puzzle, title, tier, theme, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(tracking, fb.id, puzzle, String(p.title || '').slice(0, 120), String(p.difficulty?.id || '').slice(0, 20), String(p.theme?.id || '').slice(0, 40), now).run();
  let reply = 'none';
  let update = false;
  try { ({ reply, update } = await queueReply(req, env, 'problem', body.reply === true, `${text}\n\nReport number: ${tracking}`, fb.id, now)); } catch (e) { console.error(e); reply = 'error'; }
  return json(req, env, { ok: true, tracking, reply, update });
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

// Returns a Response for the public routes, or null for anything else.
export async function handlePuzzleReports(req, env, url) {
  if (url.pathname === '/v1/puzzle-report' && req.method === 'POST') return postReport(req, env);
  const m = url.pathname.match(/^\/v1\/repaired\/([^/]{1,64})$/);
  if (m && req.method === 'GET') return getRepaired(req, env, m[1]);
  return null;
}

// ------------------------------------------------------------- the doctor
export async function claimReports(env, limit, now = Date.now()) {
  const db = env.DB;
  await db.batch([
    db.prepare("UPDATE puzzle_reports SET status = 'needs_fix', findings = COALESCE(findings, '[]') WHERE status = 'checking' AND claimed_at < ?1 AND tries >= ?2").bind(now - CLAIM_TIMEOUT, MAX_TRIES),
    db.prepare("UPDATE puzzle_reports SET status = 'new' WHERE status = 'checking' AND claimed_at < ?1").bind(now - CLAIM_TIMEOUT),
  ]);
  const n = Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX));
  const { results } = await db.prepare("SELECT id, puzzle FROM puzzle_reports WHERE status = 'new' ORDER BY created_at LIMIT ?1").bind(n).all();
  if (results.length) await db.batch(results.map((r) => db.prepare("UPDATE puzzle_reports SET status = 'checking', claimed_at = ?1, tries = tries + 1 WHERE id = ?2").bind(now, r.id)));
  return { reports: results.map((r) => ({ id: r.id, puzzle: JSON.parse(r.puzzle) })) };
}

const cleanFindings = (list) => (Array.isArray(list) ? list : []).slice(0, 12)
  .map((f) => ({ code: String(f?.code || 'other').slice(0, 30), text: String(f?.text || '').replace(/\s+/g, ' ').trim().slice(0, 300) }))
  .filter((f) => f.text);

export async function finishReports(env, results, site, now = Date.now()) {
  const db = env.DB;
  const out = { repaired: 0, needsFix: 0, noFault: 0, emailed: 0 };
  for (const res of (Array.isArray(results) ? results : []).slice(0, CLAIM_MAX)) {
    const id = Number(res?.id);
    const row = Number.isInteger(id) && await db.prepare("SELECT id, feedback_id AS fid FROM puzzle_reports WHERE id = ?1 AND status = 'checking'").bind(id).first();
    if (!row) continue;
    const findings = cleanFindings(res.findings);
    const engine = String(res.engine || '').slice(0, 20);
    const repaired = res.repaired && !checkPuzzle(res.repaired) ? JSON.stringify(res.repaired) : null;
    if (findings.length && repaired && repaired.length <= MAX_PUZZLE_CHARS) {
      const token = randomToken();
      const note = String(res.note || '').replace(/\s+/g, ' ').trim().slice(0, 500) || 'We rebuilt your puzzle with our corrected puzzle maker and checked it.';
      await db.batch([
        db.prepare("UPDATE puzzle_reports SET status = 'repaired', findings = ?2, note = ?3, repaired = ?4, token = ?5, engine = ?6, checked_at = ?7, repaired_at = ?7 WHERE id = ?1")
          .bind(id, JSON.stringify(findings), note, repaired, token, engine, now),
        db.prepare("UPDATE feedback SET status = 'addressed', note = ?2, done_at = ?3 WHERE id = ?1").bind(row.fid, note, now),
      ]);
      const link = `${String(site || 'https://thelogicgrid.com').replace(/\/+$/, '')}/?repaired=${token}`;
      out.emailed += await releaseRepair(env, row.fid, note, findings.map((f) => f.text).join('\n'), link);
      out.repaired++;
    } else {
      const status = findings.length ? 'needs_fix' : 'no_fault';
      await db.prepare('UPDATE puzzle_reports SET status = ?2, findings = ?3, engine = ?4, checked_at = ?5 WHERE id = ?1').bind(id, status, JSON.stringify(findings), engine, now).run();
      out[status === 'needs_fix' ? 'needsFix' : 'noFault']++;
    }
  }
  return out;
}

// For the Communication inbox: the report behind each puzzle problem.
export async function reportsFor(env, feedbackIds) {
  if (!feedbackIds.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT id, feedback_id AS fid, tracking, title, tier, theme, status, findings, note, engine, opened_at AS openedAt, repaired_at AS repairedAt
    FROM puzzle_reports WHERE feedback_id IN (${feedbackIds.map(() => '?').join(',')})`).bind(...feedbackIds).all();
  return new Map(results.map((r) => [r.fid, { ...r, findings: r.findings ? JSON.parse(r.findings) : [] }]));
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
      return { body: r, quiet: !r.reports.length, detail: { claimed: r.reports.length } };
    }],
    ['POST', /^puzzle-reports\/done$/, 'owner', 'puzzle-reports.done', async ({ env, body, now }) => {
      const r = await finishReports(env, body.results, env.SITE_URL, now);
      return { body: r, detail: r };
    }, { maxBody: CLAIM_MAX * (MAX_PUZZLE_CHARS + 10_000) }],
    ['GET', /^puzzle-reports\/(\d{1,12})\/puzzle$/, 'moderator', 'puzzle-reports.download', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('SELECT tracking, puzzle FROM puzzle_reports WHERE id = ?1').bind(Number(id)).first();
      if (!r) throw new Refusal(404, 'gone', 'That report is gone.');
      const file = JSON.stringify({ format: 'fantastical-logic-grid', version: 1, save: { name: `Reported ${r.tracking}`, puzzle: JSON.parse(r.puzzle) } }, null, 1);
      return { file, type: 'application/json', name: `${r.tracking}.flg.json`, target: id, quiet: true };
    }],
    ['POST', /^puzzle-reports\/(\d{1,12})\/retry$/, 'admin', 'puzzle-reports.retry', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare("UPDATE puzzle_reports SET status = 'new', tries = 0 WHERE id = ?1 AND status IN ('needs_fix', 'no_fault')").bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(409, 'not_now', 'Only a report the doctor could not repair can be checked again.');
      return { body: { ok: true }, target: id };
    }],
  ];
}
