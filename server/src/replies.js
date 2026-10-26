// Thank-you emails for the game's idea and problem boxes. A signed-in player
// with a confirmed email can tick "Email me a thank-you note"; this queues a
// fixed note (never the player's own words) to that account's own address.
// The domain's DNS is not on Cloudflare, so the Worker cannot send email: the
// GitHub Action .github/workflows/feedback-replies.yml asks for the waiting
// notes every 15 minutes (claimReplies), sends them from the game's Gmail
// and reports back (finishReplies), which removes the addresses.
//
// Limits, so the boxes cannot be used to send lots of email:
//   - only to the signed-in account's own confirmed address
//   - one note per player per kind (idea, problem) a day
//   - feedback_reply_daily_cap notes a day for everyone (Gmail allows about
//     500 a day, shared with the archive and summary emails)
//   - the feedback_replies_enabled switch in the admin dashboard
import { verifyIdToken } from './auth.js';
import { getSettings } from './settings.js';

const DAY = 24 * 3600_000;
const CLAIM_MAX = 50;
const CLAIM_TIMEOUT = 30 * 60_000; // a claimed note not reported back by then is tried again
const MAX_TRIES = 3;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const bearer = (req) => (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1] || '';

// Returns what happened, for the game to tell the player: queued, limit,
// off, unverified, signed_out or none (the player did not ask for one).
export async function queueReply(req, env, kind, wanted, now = Date.now()) {
  if (!wanted) return 'none';
  const token = bearer(req);
  if (!token) return 'signed_out';
  let user;
  try { user = await verifyIdToken(token, env); } catch (e) { return 'signed_out'; }
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || !user.emailVerified || email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return 'unverified';
  const settings = await getSettings(env, now);
  if (!settings.feedback_replies_enabled) return 'off';
  const who = (await sha256(`flg-reply|${user.uid}`)).slice(0, 32);
  const since = now - DAY;
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_replies WHERE who = ?1 AND kind = ?2 AND created_at > ?3').bind(who, kind, since).first();
  if (mine.n >= 1) return 'limit';
  const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE created_at > ?1 AND status != 'dropped'").bind(since).first();
  if (all.n >= settings.feedback_reply_daily_cap) return 'limit';
  await env.DB.prepare('INSERT INTO feedback_replies (who, kind, email, created_at) VALUES (?1, ?2, ?3, ?4)').bind(who, kind, email, now).run();
  return 'queued';
}

// Hands the sender up to `limit` waiting notes and marks them as being sent.
// While the switch is off, waiting notes are dropped (and their addresses
// removed) instead.
export async function claimReplies(env, limit, now = Date.now()) {
  const db = env.DB;
  if (!(await getSettings(env, now)).feedback_replies_enabled) {
    const r = await db.prepare("UPDATE feedback_replies SET status = 'dropped', email = NULL WHERE status IN ('waiting', 'sending')").run();
    return { off: true, dropped: r.meta.changes || 0, replies: [] };
  }
  await db.batch([
    db.prepare("UPDATE feedback_replies SET status = 'failed', email = NULL WHERE status = 'sending' AND claimed_at < ?1 AND tries >= ?2").bind(now - CLAIM_TIMEOUT, MAX_TRIES),
    db.prepare("UPDATE feedback_replies SET status = 'waiting' WHERE status = 'sending' AND claimed_at < ?1").bind(now - CLAIM_TIMEOUT),
  ]);
  const n = Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX));
  const { results } = await db.prepare("SELECT id, kind, email FROM feedback_replies WHERE status = 'waiting' AND email IS NOT NULL ORDER BY created_at LIMIT ?1").bind(n).all();
  if (results.length) {
    await db.batch(results.map((r) => db.prepare("UPDATE feedback_replies SET status = 'sending', claimed_at = ?1, tries = tries + 1 WHERE id = ?2").bind(now, r.id)));
  }
  return { off: false, replies: results };
}

// The sender reports which notes went out (their addresses are removed) and
// which failed (tried again later, up to MAX_TRIES times).
export async function finishReplies(env, sent, failed, now = Date.now()) {
  const db = env.DB;
  const ids = (list) => (Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger).slice(0, CLAIM_MAX);
  const stmts = [];
  for (const id of ids(sent)) stmts.push(db.prepare("UPDATE feedback_replies SET status = 'sent', sent_at = ?1, email = NULL WHERE id = ?2 AND status = 'sending'").bind(now, id));
  for (const id of ids(failed)) {
    stmts.push(db.prepare(`UPDATE feedback_replies SET status = CASE WHEN tries >= ?1 THEN 'failed' ELSE 'waiting' END,
      email = CASE WHEN tries >= ?1 THEN NULL ELSE email END WHERE id = ?2 AND status = 'sending'`).bind(MAX_TRIES, id));
  }
  const results = stmts.length ? await db.batch(stmts) : [];
  const changed = results.map((r) => r.meta?.changes || 0);
  return { sent: changed.slice(0, ids(sent).length).reduce((a, b) => a + b, 0), failed: changed.slice(ids(sent).length).reduce((a, b) => a + b, 0) };
}

// For the admin dashboard's Ideas and problems page.
export async function replyCounts(env, now = Date.now()) {
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM feedback_replies WHERE created_at > ?1 GROUP BY status').bind(now - DAY).all();
  const c = Object.fromEntries(results.map((r) => [r.status, r.n]));
  const settings = await getSettings(env, now);
  return { enabled: settings.feedback_replies_enabled, cap: settings.feedback_reply_daily_cap, sentToday: c.sent || 0, waiting: (c.waiting || 0) + (c.sending || 0), failedToday: c.failed || 0 };
}
