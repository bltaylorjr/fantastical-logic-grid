// Free printable puzzle packages for educators, requested on the website's
// Educators page (thelogicgrid.com/educators/).
//
//   GET  /v1/educators/options   is the form open, and the most puzzles allowed
//   POST /v1/educators/request   the form: who they are, the package they want
//   POST /v1/educators/verify    { ref, code } the code emailed to the school address
//   POST /v1/educators/resend    { ref } a new code (up to 3 times)
//   GET  /v1/educators/status?ref=  where a request is (no personal details)
//
// Admin (educatorRoutes, under /admin/v1/):
//   GET  educators?status=       requests, newest first, with counts
//   POST educators/:id/approve   the package is made and emailed
//   POST educators/:id/decline   { note } the educator gets a polite email with the note
//   POST educators/:id/delete    remove a request (admin)
//   POST educators/claim         for the GitHub Action: emails to send and packages to build (owner)
//   POST educators/done          that Action reports what went out (owner)
//
// The domain's DNS is not on Cloudflare, so the Worker cannot send email: the
// GitHub Action .github/workflows/educator-packages.yml runs every 5 minutes
// (or straight away, when the optional GITHUB_DISPATCH_TOKEN secret lets the
// Worker start it), sends the code and decline emails, builds approved
// packages as PDFs with the game's own puzzle engine and emails them.
//
// Checks: the request is cleaned by the shared rules in
// engine/src/classroom.js; the address must be a school or organization
// address (personal mailboxes only when the admin allows them); the code is
// stored only as a hash, expires after 2 days and allows 6 tries; at most 3
// requests per address a day and educator_daily_cap for everyone.
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { checkRequest, schoolEmail } from '../../engine/src/classroom.js';

const DAY = 24 * 3600_000;
const CODE_TTL = 2 * DAY;
const MAX_TRIES = 6;
const MAX_RESENDS = 3;
const PER_EMAIL_PER_DAY = 3;
const MAIL_TIMEOUT = 30 * 60_000;
const BUILD_TIMEOUT = 60 * 60_000;
const MAX_MAIL_TRIES = 3;
const MAX_BUILD_TRIES = 3;
const BUILDS_PER_RUN = 3;
const USED_STORIES_MAX = 5000;
const MAX_BODY = 16_000;
export const STATUSES = ['unverified', 'pending', 'approved', 'building', 'sent', 'declined', 'failed', 'expired'];
// The workflow the Worker can start when GITHUB_DISPATCH_TOKEN is set.
const DISPATCH_URL = 'https://api.github.com/repos/bltaylorjr/fantastical-logic-grid/actions/workflows/educator-packages.yml/dispatches';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRef() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map((x) => REF_ALPHABET[x % REF_ALPHABET.length]).join('');
}
function newCode() {
  const b = crypto.getRandomValues(new Uint32Array(1));
  return String(b[0] % 1_000_000).padStart(6, '0');
}
const codeHash = (ref, code) => sha256(`flg-educator|${ref}|${code}`);
const cleanRef = (v) => (typeof v === 'string' && /^[A-Z2-9]{10}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);

// Starts the GitHub Action now, so codes and packages go out within a minute
// or two instead of waiting for the 5-minute schedule. Best effort.
export async function kick(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return false;
  try {
    const res = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flg-api', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return res.ok;
  } catch (e) { return false; }
}

async function readJson(req) {
  try { return JSON.parse(await readText(req, MAX_BODY)); } catch (e) { return e instanceof TooLarge ? 'too_large' : null; }
}

async function limited(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  return env.LIMIT_FEEDBACK && !(await env.LIMIT_FEEDBACK.limit({ key: `edu:${ip}` })).success;
}

async function postRequest(req, env, ctx, now) {
  const body = await readJson(req);
  if (body === 'too_large') return json(req, env, { error: 'too_large', message: 'That request is too long. Shorten the story or the lists.' }, 413);
  if (!body || typeof body !== 'object') return json(req, env, { error: 'bad_request' }, 400);
  const s = await getSettings(env, now);
  if (!s.educators_enabled) return json(req, env, { error: 'switched_off', message: 'Requests are paused for now. Please try again soon.' }, 503);
  const checked = checkRequest(body, { maxPuzzles: s.educator_max_puzzles });
  if (checked.errors) return json(req, env, { error: 'invalid', message: checked.errors[0], errors: checked.errors }, 400);
  const r = checked.value;
  const domain = schoolEmail(r.educator.email);
  if (domain.kind === 'personal' && !s.educator_personal_email) {
    return json(req, env, { error: 'school_email', message: 'Please use your school or organization email address. We send a code there to confirm you are an educator.' }, 400);
  }
  const since = now - DAY;
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM educator_requests WHERE email = ?1 AND created_at > ?2').bind(r.educator.email, since).first();
  if (mine.n >= PER_EMAIL_PER_DAY) return json(req, env, { error: 'limit', message: 'This address already sent 3 requests today. Please try again tomorrow, or wait for the ones you sent.' }, 429);
  const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM educator_requests WHERE created_at > ?1').bind(since).first();
  if (all.n >= s.educator_daily_cap) return json(req, env, { error: 'busy', message: 'We have had a lot of requests today. Please try again tomorrow.' }, 429);
  const ref = newRef();
  const code = newCode();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const { educator, ...pkg } = r;
  await env.DB.prepare(`INSERT INTO educator_requests (ref, email, name, school, role, grade, count, request, domain_kind, status, code_hash, mail, mail_code, ip_hash, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unverified', ?10, 'verify', ?11, ?12, ?13)`)
    .bind(ref, educator.email, educator.name, educator.school, educator.role, r.grade, r.count, JSON.stringify({ ...pkg, district: educator.district }), domain.kind,
      await codeHash(ref, code), code, (await sha256(`flg-edu-ip|${ip}`)).slice(0, 16), now).run();
  ctx?.waitUntil?.(kick(env));
  return json(req, env, { ref, email: educator.email, status: 'unverified', expiresAt: now + CODE_TTL });
}

async function findRef(env, ref) {
  return env.DB.prepare('SELECT id, ref, status, code_hash, verify_tries, resends, created_at FROM educator_requests WHERE ref = ?1').bind(ref).first();
}

async function postVerify(req, env, now) {
  const body = await readJson(req);
  const ref = cleanRef(body?.ref);
  const code = String(body?.code ?? '').replace(/\D/g, '');
  if (!ref || code.length !== 6) return json(req, env, { error: 'bad_code', message: 'Enter the 6-digit code from the email.' }, 400);
  const row = await findRef(env, ref);
  if (!row) return json(req, env, { error: 'not_found', message: 'We could not find that request. Please send the form again.' }, 404);
  if (row.status !== 'unverified') return json(req, env, { status: row.status });
  if (now - row.created_at > CODE_TTL) {
    await env.DB.prepare("UPDATE educator_requests SET status = 'expired', code_hash = NULL, mail = NULL, mail_code = NULL WHERE id = ?1").bind(row.id).run();
    return json(req, env, { error: 'expired', message: 'That code has expired. Please send the form again.' }, 410);
  }
  if (row.verify_tries >= MAX_TRIES) return json(req, env, { error: 'locked', message: 'Too many wrong codes. Choose "Send a new code".' }, 429);
  if ((await codeHash(ref, code)) !== row.code_hash) {
    await env.DB.prepare('UPDATE educator_requests SET verify_tries = verify_tries + 1 WHERE id = ?1').bind(row.id).run();
    const left = MAX_TRIES - row.verify_tries - 1;
    return json(req, env, { error: 'wrong_code', message: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Choose "Send a new code".' }, 400);
  }
  await env.DB.prepare("UPDATE educator_requests SET status = 'pending', verified_at = ?2, code_hash = NULL, mail = NULL, mail_code = NULL WHERE id = ?1 AND status = 'unverified'").bind(row.id, now).run();
  return json(req, env, { status: 'pending' });
}

async function postResend(req, env, ctx, now) {
  const body = await readJson(req);
  const ref = cleanRef(body?.ref);
  const row = ref && (await findRef(env, ref));
  if (!row) return json(req, env, { error: 'not_found', message: 'We could not find that request. Please send the form again.' }, 404);
  if (row.status !== 'unverified') return json(req, env, { status: row.status });
  if (now - row.created_at > CODE_TTL) return json(req, env, { error: 'expired', message: 'This request has expired. Please send the form again.' }, 410);
  if (row.resends >= MAX_RESENDS) return json(req, env, { error: 'limit', message: 'We have sent the most codes we can for this request. Check your spam or junk folder, or send the form again tomorrow.' }, 429);
  const code = newCode();
  await env.DB.prepare("UPDATE educator_requests SET code_hash = ?2, mail = 'verify', mail_code = ?3, mail_tries = 0, mail_claimed_at = NULL, verify_tries = 0, resends = resends + 1 WHERE id = ?1")
    .bind(row.id, await codeHash(ref, code), code).run();
  ctx?.waitUntil?.(kick(env));
  return json(req, env, { status: 'unverified', resent: true });
}

export async function handleEducators(req, env, ctx, url) {
  if (!url.pathname.startsWith('/v1/educators/')) return null;
  const path = url.pathname.slice('/v1/educators/'.length);
  const now = Date.now();
  if (await limited(req, env)) return json(req, env, { error: 'slow_down', message: 'Too many tries. Please wait a minute.' }, 429, { 'Retry-After': '60' });
  if (req.method === 'GET' && path === 'options') {
    const s = await getSettings(env, now);
    return json(req, env, { enabled: s.educators_enabled, maxPuzzles: s.educator_max_puzzles, personalEmail: s.educator_personal_email });
  }
  if (req.method === 'GET' && path === 'status') {
    const ref = cleanRef(url.searchParams.get('ref'));
    const row = ref && (await findRef(env, ref));
    return row ? json(req, env, { status: row.status }) : json(req, env, { error: 'not_found' }, 404);
  }
  if (req.method !== 'POST') return json(req, env, { error: 'not_found' }, 404);
  if (path === 'request') return postRequest(req, env, ctx, now);
  if (path === 'verify') return postVerify(req, env, now);
  if (path === 'resend') return postResend(req, env, ctx, now);
  return json(req, env, { error: 'not_found' }, 404);
}

// ---------------------------------------------------------------- the GitHub Action
// Emails to send (code and decline emails) and approved packages to build.
// Requests never verified within 2 days expire here.
export async function claimWork(env, limit, now = Date.now()) {
  const db = env.DB;
  await db.batch([
    db.prepare("UPDATE educator_requests SET status = 'expired', code_hash = NULL, mail = NULL, mail_code = NULL WHERE status = 'unverified' AND created_at < ?1").bind(now - CODE_TTL),
    db.prepare("UPDATE educator_requests SET mail = NULL, mail_code = NULL WHERE mail IS NOT NULL AND mail_tries >= ?1 AND mail_claimed_at < ?2").bind(MAX_MAIL_TRIES, now - MAIL_TIMEOUT),
    db.prepare("UPDATE educator_requests SET status = 'failed' WHERE status = 'building' AND build_claimed_at < ?1 AND build_tries >= ?2").bind(now - BUILD_TIMEOUT, MAX_BUILD_TRIES),
    db.prepare("UPDATE educator_requests SET status = 'approved' WHERE status = 'building' AND build_claimed_at < ?1").bind(now - BUILD_TIMEOUT),
  ]);
  const n = Math.min(50, Math.max(1, Number(limit) || 50));
  const mails = (await db.prepare(`SELECT id, ref, mail AS kind, email, name, school, mail_code AS code, note, grade, count FROM educator_requests
    WHERE mail IS NOT NULL AND (mail_claimed_at IS NULL OR mail_claimed_at < ?1) ORDER BY created_at LIMIT ?2`).bind(now - MAIL_TIMEOUT, n).all()).results;
  const builds = (await db.prepare(`SELECT id, ref, email, name, school, role, grade, count, request FROM educator_requests
    WHERE status = 'approved' ORDER BY reviewed_at LIMIT ?1`).bind(BUILDS_PER_RUN).all()).results;
  const stmts = [
    ...mails.map((m) => db.prepare('UPDATE educator_requests SET mail_claimed_at = ?1, mail_tries = mail_tries + 1 WHERE id = ?2').bind(now, m.id)),
    ...builds.map((b) => db.prepare("UPDATE educator_requests SET status = 'building', build_claimed_at = ?1, build_tries = build_tries + 1 WHERE id = ?2 AND status = 'approved'").bind(now, b.id)),
  ];
  if (stmts.length) await db.batch(stmts);
  let usedStories = [];
  if (builds.length) {
    const { results } = await db.prepare("SELECT story_ids FROM educator_requests WHERE story_ids IS NOT NULL ORDER BY sent_at DESC LIMIT 1000").all();
    for (const r of results) { try { usedStories.push(...JSON.parse(r.story_ids)); } catch (e) { /* skip */ } }
    usedStories = usedStories.slice(0, USED_STORIES_MAX);
  }
  return {
    mails: mails.map((m) => ({ ...m, code: m.kind === 'verify' ? m.code : undefined })),
    builds: builds.map((b) => ({ ...b, request: JSON.parse(b.request) })),
    usedStories,
  };
}

const ids = (v) => (Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger).slice(0, 50);

export async function finishWork(env, body, now = Date.now()) {
  const db = env.DB;
  const stmts = [];
  for (const id of ids(body?.mails?.sent)) stmts.push(db.prepare('UPDATE educator_requests SET mail = NULL, mail_code = NULL WHERE id = ?1').bind(id));
  for (const id of ids(body?.mails?.failed)) stmts.push(db.prepare('UPDATE educator_requests SET mail_claimed_at = NULL, mail = CASE WHEN mail_tries >= ?2 THEN NULL ELSE mail END, mail_code = CASE WHEN mail_tries >= ?2 THEN NULL ELSE mail_code END WHERE id = ?1').bind(id, MAX_MAIL_TRIES));
  let sent = 0, failed = 0;
  for (const b of (Array.isArray(body?.builds) ? body.builds : []).slice(0, BUILDS_PER_RUN * 2)) {
    const id = Number(b?.id);
    if (!Number.isInteger(id)) continue;
    if (b.ok) {
      const stories = (Array.isArray(b.storyIds) ? b.storyIds : []).map(String).filter((x) => x.length <= 200).slice(0, 60);
      stmts.push(db.prepare("UPDATE educator_requests SET status = 'sent', sent_at = ?2, puzzles = ?3, story_ids = ?4 WHERE id = ?1 AND status = 'building'")
        .bind(id, now, Math.max(0, Number(b.puzzles) || stories.length), JSON.stringify(stories)));
      sent++;
    } else {
      stmts.push(db.prepare("UPDATE educator_requests SET status = CASE WHEN build_tries >= ?2 THEN 'failed' ELSE 'approved' END, note = COALESCE(note, ?3) WHERE id = ?1 AND status = 'building'")
        .bind(id, MAX_BUILD_TRIES, b.error ? `Build problem: ${String(b.error).slice(0, 200)}` : null));
      failed++;
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { mails: ids(body?.mails?.sent).length, sent, failed };
}

// ---------------------------------------------------------------- admin
const PUBLIC_FIELDS = `id, ref, email, name, school, role, grade, count, request, domain_kind AS domainKind, status, created_at AS createdAt, verified_at AS verifiedAt,
  reviewed_at AS reviewedAt, reviewed_by AS reviewedBy, note, sent_at AS sentAt, puzzles, mail, build_tries AS buildTries`;

export async function educatorCounts(env) {
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM educator_requests GROUP BY status').all();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

export function educatorRoutes(Refusal) {
  const row = async (env, id) => {
    const r = await env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM educator_requests WHERE id = ?1`).bind(Number(id)).first();
    if (!r) throw new Refusal(404, 'gone', 'That request is gone.');
    return r;
  };
  return [
    ['GET', /^educators$/, 'moderator', 'educators.view', async ({ env, url }) => {
      const status = [...STATUSES, 'all', 'open'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
      const where = status === 'all' ? '1 = 1' : status === 'open' ? "status IN ('approved', 'building', 'failed')" : 'status = ?1';
      const { results } = await env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM educator_requests WHERE ${where} ORDER BY created_at DESC LIMIT 200`).bind(...(where.includes('?1') ? [status] : [])).all();
      return {
        body: { status, counts: await educatorCounts(env), dispatch: !!env.GITHUB_DISPATCH_TOKEN, requests: results.map((r) => ({ ...r, request: JSON.parse(r.request) })) },
        quiet: true,
      };
    }],
    ['POST', /^educators\/(\d{1,12})\/approve$/, 'moderator', 'educators.approve', async ({ env, ctx, params: [id], body, who, now }) => {
      const r = await row(env, id);
      if (!['pending', 'failed', 'declined'].includes(r.status)) throw new Refusal(409, 'state', r.status === 'unverified' ? 'This educator has not confirmed their email yet.' : `This request is already ${r.status}.`);
      const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      await env.DB.prepare("UPDATE educator_requests SET status = 'approved', reviewed_at = ?2, reviewed_by = ?3, note = ?4, build_tries = 0, mail = CASE WHEN mail = 'declined' THEN NULL ELSE mail END WHERE id = ?1")
        .bind(r.id, now, who.actor, note || null).run();
      ctx?.waitUntil?.(kick(env));
      return { body: { ok: true, status: 'approved' }, target: r.ref, detail: { puzzles: r.count, grade: r.grade } };
    }],
    ['POST', /^educators\/(\d{1,12})\/decline$/, 'moderator', 'educators.decline', async ({ env, ctx, params: [id], body, who, now }) => {
      const r = await row(env, id);
      if (!['pending', 'failed', 'approved'].includes(r.status)) throw new Refusal(409, 'state', `This request is ${r.status}.`);
      const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
      const email = body.email !== false;
      await env.DB.prepare(`UPDATE educator_requests SET status = 'declined', reviewed_at = ?2, reviewed_by = ?3, note = ?4, mail = ?5, mail_tries = 0, mail_claimed_at = NULL WHERE id = ?1`)
        .bind(r.id, now, who.actor, note || null, email ? 'declined' : null).run();
      if (email) ctx?.waitUntil?.(kick(env));
      return { body: { ok: true, status: 'declined' }, target: r.ref, detail: { emailed: email } };
    }],
    ['POST', /^educators\/(\d{1,12})\/delete$/, 'admin', 'educators.delete', async ({ env, params: [id] }) => {
      const r = await row(env, id);
      await env.DB.prepare('DELETE FROM educator_requests WHERE id = ?1').bind(r.id).run();
      return { body: { ok: true }, target: r.ref };
    }],
    // Called every 5 minutes; a call with nothing to do is not written to the audit log.
    ['POST', /^educators\/claim$/, 'owner', 'educators.claim', async ({ env, body, now }) => {
      const w = await claimWork(env, body.limit, now);
      return { body: w, quiet: !w.mails.length && !w.builds.length, detail: { mails: w.mails.length, builds: w.builds.map((b) => b.ref) } };
    }],
    ['POST', /^educators\/done$/, 'owner', 'educators.done', async ({ env, body, now }) => {
      const r = await finishWork(env, body, now);
      return { body: r, quiet: !r.mails && !r.sent && !r.failed, detail: r };
    }],
  ];
}
