// Daily puzzle by email: a signed-in player with a confirmed email can ask for
// each day's puzzle in their inbox. The domain's DNS is not on Cloudflare, so
// the Worker cannot send email: the GitHub Action .github/workflows/daily-email.yml
// asks for the day's list once a day (claimDailyEmail), sends from the game's
// address and reports back (finishDailyEmail).
//
//   GET  /v1/daily-email                  signed in: { on, verified }
//   POST /v1/daily-email { on }           signed in: switch it on or off
//   GET|POST /v1/daily-email/unsubscribe?t=TOKEN
//                                         the link in every email (POST is the
//                                         mail programs' one-click unsubscribe)
//
// Kept: the account id, its confirmed address, a random unsubscribe token and
// the last day sent. Turning it off, unsubscribing or deleting the account
// removes the row. Limits: daily_email_daily_cap addresses in all (sign-ups
// stop at the cap, so everyone on the list gets the email) and the
// daily_email_enabled switch in the admin dashboard.
import { verifyIdToken, AuthError } from './auth.js';
import { getSettings } from './settings.js';
import { json, readText, TooLarge } from './http.js';

const CLAIM_MAX = 100;
const ROUTE = /^\/v1\/daily-email(?:\/(unsubscribe))?$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const bearer = (req) => (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1] || '';

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function page(title, text, status = 200) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.5;color:#1f1a14">
<div style="max-width:520px;margin:40px auto;background:#fffdf8;border-radius:10px;padding:24px"><h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1><p>${esc(text)}</p>
<p><a href="https://thelogicgrid.com/" style="color:#7a3e00">Go to The Fantastical Logic Grid</a></p></div></body></html>`;
  return new Response(body, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}

export async function handleDailyEmail(req, env, url) {
  const m = url.pathname.match(ROUTE);
  if (!m) return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  const db = env.DB;

  if (m[1]) {
    if (req.method !== 'GET' && req.method !== 'POST') return json(req, env, { error: 'not_found' }, 404);
    const t = url.searchParams.get('t') || '';
    if (/^[0-9a-f]{32}$/.test(t)) await db.prepare('DELETE FROM daily_email WHERE token = ?1').bind(t).run();
    // The same answer whether or not the token was on the list, so the page
    // cannot be used to test tokens.
    if (req.method === 'POST') return new Response(null, { status: 204 });
    return page('You are unsubscribed', 'You will not get the daily puzzle by email any more. You can switch it back on from the Daily puzzle card in the game at any time.');
  }

  if (req.method !== 'GET' && req.method !== 'POST') return json(req, env, { error: 'not_found' }, 404);
  let user;
  try { user = await verifyIdToken(bearer(req), env); } catch (e) {
    if (e instanceof AuthError || !bearer(req)) return json(req, env, { error: 'sign_in' }, 401);
    throw e;
  }
  const email = String(user.email || '').trim().toLowerCase();
  const verified = !!user.emailVerified && email.length <= 254 && EMAIL.test(email);
  const row = await db.prepare('SELECT email FROM daily_email WHERE uid = ?1').bind(user.uid).first();

  if (req.method === 'GET') {
    // A changed address follows the account (only a confirmed one).
    if (row && verified && row.email !== email) await db.prepare('UPDATE daily_email SET email = ?1 WHERE uid = ?2').bind(email, user.uid).run();
    return json(req, env, { on: !!row, verified });
  }

  let b;
  try { b = JSON.parse(await readText(req, 1000)); } catch (e) {
    return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400);
  }
  if (!b?.on) {
    await db.prepare('DELETE FROM daily_email WHERE uid = ?1').bind(user.uid).run();
    return json(req, env, { on: false, verified });
  }
  if (!verified) return json(req, env, { error: 'unverified', message: 'Confirm your email address first: open the link we sent when you made your account.' }, 403);
  if (row) {
    if (row.email !== email) await db.prepare('UPDATE daily_email SET email = ?1 WHERE uid = ?2').bind(email, user.uid).run();
    return json(req, env, { on: true, verified });
  }
  const s = await getSettings(env);
  if (!s.daily_email_enabled) return json(req, env, { error: 'off', message: 'The daily email is switched off for now.' }, 403);
  const n = await db.prepare('SELECT COUNT(*) AS n FROM daily_email').first();
  if (n.n >= s.daily_email_daily_cap) return json(req, env, { error: 'full', message: 'The daily email list is full for now. Please try again another day.' }, 403);
  await db.prepare('INSERT OR REPLACE INTO daily_email (uid, email, token, created_at) VALUES (?1, ?2, ?3, ?4)').bind(user.uid, email, newToken(), Date.now()).run();
  return json(req, env, { on: true, verified });
}

// Hands the sender up to `limit` addresses that have not had `day`'s email
// yet, and marks them as sent for that day, so a second run the same day
// never sends twice. While the switch is off nothing is handed out (the list
// is kept, so switching back on carries on).
export async function claimDailyEmail(env, day, limit, now = Date.now()) {
  const today = isoDay(now);
  const near = [isoDay(now - 86400_000), today, isoDay(now + 86400_000)];
  if (!near.includes(day)) return { error: 'bad_day' };
  const s = await getSettings(env, now);
  if (!s.daily_email_enabled) return { off: true, list: [] };
  const db = env.DB;
  const done = await db.prepare('SELECT COUNT(*) AS n FROM daily_email WHERE last_sent = ?1').bind(day).first();
  const n = Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX), Math.max(0, s.daily_email_daily_cap - done.n));
  if (!n) return { off: false, list: [] };
  const { results } = await db.prepare('SELECT token, email FROM daily_email WHERE (last_sent IS NULL OR last_sent < ?1) AND created_at < ?2 ORDER BY created_at LIMIT ?3')
    .bind(day, now, n).all();
  if (results.length) await db.batch(results.map((r) => db.prepare('UPDATE daily_email SET last_sent = ?1 WHERE token = ?2').bind(day, r.token)));
  return { off: false, list: results };
}

// The sender says which addresses failed: they are tried again on the next
// run. An address the mail service refuses outright is taken off the list.
export async function finishDailyEmail(env, failed, refused) {
  const tokens = (v) => (Array.isArray(v) ? v : []).filter((t) => typeof t === 'string' && /^[0-9a-f]{32}$/.test(t)).slice(0, CLAIM_MAX);
  const db = env.DB;
  const stmts = [
    ...tokens(failed).map((t) => db.prepare('UPDATE daily_email SET last_sent = NULL WHERE token = ?1').bind(t)),
    ...tokens(refused).map((t) => db.prepare('DELETE FROM daily_email WHERE token = ?1').bind(t)),
  ];
  if (stmts.length) await db.batch(stmts);
  return { retry: tokens(failed).length, removed: tokens(refused).length };
}

export async function dailyEmailCount(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_email').first();
  return r.n;
}

export const deleteDailyEmailStatement = (env, uid) => env.DB.prepare('DELETE FROM daily_email WHERE uid = ?1').bind(uid);
