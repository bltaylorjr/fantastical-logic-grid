// Emails for the game's idea and problem boxes. A signed-in player with a
// confirmed email can tick "Email me an update"; this queues a thank-you note
// to that account's own address, quoting what they wrote, and holds a second
// email (kind idea_update or problem_update) that goes out when the team marks
// that idea or problem addressed, with the team's note on what was done
// (releaseUpdate). The player's words only ever go to their own address, and
// are removed with it once sent.
// The domain's DNS is not on Cloudflare, so the Worker cannot send email: the
// GitHub Action .github/workflows/feedback-replies.yml asks for the waiting
// notes every 15 minutes (claimReplies), sends them from the game's Gmail
// and reports back (finishReplies), which removes the addresses.
//
// Storylines (story ideas) get exactly one email per submission: nothing
// straight away, then either "Congratulations, your storyline has been
// approved" (approveStoryline) or a thank-you for their input when the team
// disapproves it (declineStoryline). For an approved one the sender builds the
// first puzzle from the storyline with the game's engine
// (scripts/storyline-puzzle.mjs), hands it back here (storeBuiltPuzzle) so it
// is stored for the player (their game puts it in Saved puzzles), and attaches
// it to the email as a PDF with its answer key.
//
// Limits, so the boxes cannot be used to send lots of email:
//   - only to the signed-in account's own confirmed address
//   - one thank-you note per player per kind (idea, problem) a day; updates
//     only go when the team marks something addressed, and a player can have
//     at most HELD_MAX waiting for that
//   - feedback_reply_daily_cap notes a day for everyone (Gmail allows about
//     500 a day, shared with the archive and summary emails)
//   - the feedback_replies_enabled switch in the admin dashboard
import { verifyIdToken } from './auth.js';
import { getSettings } from './settings.js';
import { themeName } from './feedback.js';
import { storePuzzle } from './messages.js';
import { submissionForMail } from './story-submissions.js';

const DAY = 24 * 3600_000;
const CLAIM_MAX = 50;
const CLAIM_TIMEOUT = 30 * 60_000; // a claimed note not reported back by then is tried again
const MAX_TRIES = 3;
const HELD_MAX = 20;
export const UPDATE_KINDS = { idea: 'idea_update', problem: 'problem_update' };

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const bearer = (req) => (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1] || '';

// Returns what happened, for the game to tell the player: reply is queued,
// limit, off, unverified, signed_out or none (the player did not ask); update
// is true when an update email waits for the team to act on this one.
export async function queueReply(req, env, kind, wanted, text, feedbackId, now = Date.now(), { topic = null } = {}) {
  const none = (reply) => ({ reply, update: false });
  if (!wanted) return none('none');
  const token = bearer(req);
  if (!token) return none('signed_out');
  let user;
  try { user = await verifyIdToken(token, env); } catch (e) { return none('signed_out'); }
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || !user.emailVerified || email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return none('unverified');
  const settings = await getSettings(env, now);
  if (!settings.feedback_replies_enabled) return none('off');
  const who = await whoFor(user.uid);
  let update = false;
  const story = kind === 'idea' && topic === 'story';
  if (feedbackId) {
    const held = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE who = ?1 AND status = 'held'").bind(who).first();
    if (held.n < HELD_MAX) {
      await env.DB.prepare("INSERT INTO feedback_replies (who, kind, email, text, feedback_id, status, created_at, topic, user_id) VALUES (?1, ?2, ?3, ?4, ?5, 'held', ?6, ?7, ?8)")
        .bind(who, UPDATE_KINDS[kind], email, text, feedbackId, now, story ? 'story' : null, story ? user.uid : null).run();
      update = true;
      // A storyline's one email waits for the team's decision.
      if (story) return { reply: 'story', update: true };
    }
  }
  const since = now - DAY;
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_replies WHERE who = ?1 AND kind = ?2 AND created_at > ?3').bind(who, kind, since).first();
  if (mine.n >= 1) return { reply: 'limit', update };
  if ((await sentToday(env, since)) >= settings.feedback_reply_daily_cap) return { reply: 'limit', update };
  await env.DB.prepare('INSERT INTO feedback_replies (who, kind, email, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(who, kind, email, text, now).run();
  return { reply: 'queued', update };
}

const whoFor = async (uid) => (await sha256(`flg-reply|${uid}`)).slice(0, 32);
// Emails queued in the last day, for the shared daily cap (held updates are not queued yet).
const sentToday = async (env, since) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE created_at > ?1 AND status NOT IN ('dropped', 'held')").bind(since).first()).n;

// The team marked an idea or problem addressed (admin.js): the player who
// asked for an update gets one, with the team's note. Returns how many were
// queued (0 or 1).
export async function releaseUpdate(env, feedbackId, note) {
  const r = await env.DB.prepare("UPDATE feedback_replies SET status = 'waiting', note = ?1 WHERE feedback_id = ?2 AND status = 'held'").bind(note, Number(feedbackId)).run();
  return r.meta.changes || 0;
}

// The puzzle doctor repaired a reported puzzle (puzzle-reports.js): the player
// who asked to hear about it gets the apology email instead of the plain
// update, with what was found, what was done and the link to the repaired
// puzzle. Returns how many were queued (0 or 1).
export async function releaseRepair(env, feedbackId, note, explain, link) {
  const r = await env.DB.prepare("UPDATE feedback_replies SET status = 'waiting', kind = 'problem_repaired', note = ?1, explain = ?2, link = ?3 WHERE feedback_id = ?4 AND status = 'held'")
    .bind(note, explain, link, Number(feedbackId)).run();
  return r.meta.changes || 0;
}

// The team closed an idea or problem without a fix, or deleted it: no update
// will come, so the held address and words go. A storyline closed as done
// still gets its one email, a plain thank-you (thank = true); a deleted one
// gets nothing.
export async function dropUpdate(env, feedbackId, { thank = false } = {}) {
  const db = env.DB;
  if (thank) {
    await db.prepare("UPDATE feedback_replies SET status = 'waiting', kind = 'idea', user_id = NULL WHERE feedback_id = ?1 AND status = 'held' AND topic = 'story'").bind(Number(feedbackId)).run();
  }
  return db.prepare("UPDATE feedback_replies SET status = 'dropped', email = NULL, text = NULL, note = NULL, explain = NULL, link = NULL, user_id = NULL WHERE feedback_id = ?1 AND status = 'held'").bind(Number(feedbackId)).run();
}

// The held storyline email for an idea, if the player asked for one: the
// account id (to store the puzzle for them) and the row to release.
export async function heldStoryline(env, feedbackId) {
  return env.DB.prepare("SELECT id, user_id AS uid FROM feedback_replies WHERE feedback_id = ?1 AND status = 'held' AND topic = 'story' AND email IS NOT NULL").bind(Number(feedbackId)).first();
}

// The team approved a storyline: its one email waits for the sender, which
// builds the first puzzle from it (the account id stays until then, so the
// puzzle can be stored for the player) and attaches it as a PDF.
export async function approveStoryline(env, rowId) {
  const r = await env.DB.prepare("UPDATE feedback_replies SET status = 'waiting', kind = 'story_approved', note = NULL, puzzle_id = NULL WHERE id = ?1 AND status = 'held'")
    .bind(rowId).run();
  return r.meta.changes || 0;
}

// The team disapproved a storyline: its one email is a thank-you for their input.
export async function declineStoryline(env, feedbackId) {
  const r = await env.DB.prepare("UPDATE feedback_replies SET status = 'waiting', kind = 'story_declined', note = NULL, user_id = NULL WHERE feedback_id = ?1 AND status = 'held' AND topic = 'story' AND email IS NOT NULL")
    .bind(Number(feedbackId)).run();
  return r.meta.changes || 0;
}

// The sender built the first puzzle from an approved storyline (claimed, so
// status 'sending'): store it for the player, like a puzzle from the team.
// Returns the stored puzzle's id, or null when there is no one to store it for.
export async function storeBuiltPuzzle(env, replyId, puzzle, now = Date.now()) {
  const row = await env.DB.prepare(`SELECT user_id AS uid, puzzle_id AS puzzleId, submission_id AS submissionId, feedback_id AS feedbackId FROM feedback_replies
    WHERE id = ?1 AND kind IN ('story_approved', 'story_build') AND status = 'sending'`).bind(Number(replyId)).first();
  if (!row) return null;
  // The Storyline Submission Database keeps the first puzzle with the entry.
  if (row.submissionId || row.feedbackId) {
    await env.DB.prepare(`UPDATE story_submissions SET puzzle = ?1, puzzle_at = ?2 WHERE puzzle IS NULL AND
      ((id = ?3 AND ?3 IS NOT NULL) OR (feedback_id = ?4 AND ?4 IS NOT NULL))`).bind(JSON.stringify(puzzle), now, row.submissionId, row.feedbackId).run();
  }
  if (!row.uid) return null;
  if (row.puzzleId) return row.puzzleId;
  const id = await storePuzzle(env, row.uid, puzzle, 'storyline', now);
  await env.DB.prepare('UPDATE feedback_replies SET puzzle_id = ?1 WHERE id = ?2').bind(id, Number(replyId)).run();
  return id;
}

// Ideas with a storyline email held, for the dashboard.
export async function storylinesHeld(env, ids) {
  if (!ids.length) return new Set();
  const { results } = await env.DB.prepare(`SELECT feedback_id AS id FROM feedback_replies WHERE status = 'held' AND topic = 'story' AND email IS NOT NULL
    AND feedback_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  return new Set(results.map((r) => r.id));
}

// For account deletion: a player's waiting emails, with their addresses.
// Their storyline entries stay (they gave permission to use them, with the
// credit they chose), but lose the link to the account and the address.
export async function deleteReplyStatements(env, uid) {
  return [
    env.DB.prepare('DELETE FROM feedback_replies WHERE who = ?1 OR user_id = ?2').bind(await whoFor(uid), uid),
    env.DB.prepare('UPDATE story_submissions SET user_id = NULL, email = NULL WHERE user_id = ?1').bind(uid),
  ];
}

// Hands the sender up to `limit` waiting notes and marks them as being sent.
// While the switch is off, waiting notes are dropped (and their addresses
// removed) instead.
export async function claimReplies(env, limit, now = Date.now()) {
  const db = env.DB;
  if (!(await getSettings(env, now)).feedback_replies_enabled) {
    const r = await db.prepare("UPDATE feedback_replies SET status = 'dropped', email = NULL, text = NULL, note = NULL, explain = NULL, link = NULL, user_id = NULL WHERE status IN ('waiting', 'sending', 'held')").run();
    return { off: true, dropped: r.meta.changes || 0, replies: [] };
  }
  await db.batch([
    db.prepare("UPDATE feedback_replies SET status = 'failed', email = NULL, text = NULL, note = NULL, explain = NULL, link = NULL, user_id = NULL WHERE status = 'sending' AND claimed_at < ?1 AND tries >= ?2").bind(now - CLAIM_TIMEOUT, MAX_TRIES),
    db.prepare("UPDATE feedback_replies SET status = 'waiting' WHERE status = 'sending' AND claimed_at < ?1").bind(now - CLAIM_TIMEOUT),
  ]);
  const n = Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX));
  const { results } = await db.prepare(`SELECT r.id, r.kind, r.email, r.text, r.note, r.explain, r.link, p.puzzle, p.expires_at AS puzzleExpiresAt,
      (r.kind IN ('story_approved', 'story_build') AND r.puzzle_id IS NULL) AS mayBuild, r.user_id IS NOT NULL AS forPlayer, f.theme AS theme,
      s.kind AS sKind, s.form, s.polished, s.theme AS sTheme, s.title, s.credit, s.puzzle AS sPuzzle FROM feedback_replies r
    LEFT JOIN player_puzzles p ON p.id = r.puzzle_id AND p.expires_at > ?2
    LEFT JOIN feedback f ON f.id = r.feedback_id
    LEFT JOIN story_submissions s ON s.id = r.submission_id OR (r.submission_id IS NULL AND r.feedback_id IS NOT NULL AND s.feedback_id = r.feedback_id)
    WHERE r.status = 'waiting' AND (r.email IS NOT NULL OR r.kind = 'story_build') ORDER BY r.created_at LIMIT ?1`).bind(n, now).all();
  if (results.length) {
    await db.batch(results.map((r) => db.prepare("UPDATE feedback_replies SET status = 'sending', claimed_at = ?1, tries = tries + 1 WHERE id = ?2").bind(now, r.id)));
  }
  // An approved storyline carries its puzzle, for the sender to print as a PDF
  // with the answer key; if it is not built yet, `build` asks the sender to
  // build it (from the player's words in `text`, in the theme they picked, or
  // from the submission form's corrected words). An email about an entry in
  // the Storyline Submission Database carries the entry (`submission`), with
  // the copy of the form.
  return {
    off: false,
    replies: results.map(({ puzzle, puzzleExpiresAt, mayBuild, forPlayer, theme, sKind, form, polished, sTheme, title, credit, sPuzzle, ...r }) => {
      const submission = form && (r.kind !== 'story_approved' || !r.text) ? submissionForMail({ kind: sKind, form, polished, theme: sTheme, title, credit }) : null;
      const saved = !puzzle && sPuzzle ? JSON.parse(sPuzzle) : null;
      const ready = puzzle ? JSON.parse(puzzle) : saved;
      const fromForm = !!submission && sKind === 'storyline' && submission.form && !submission.form.idea;
      const build = mayBuild && !ready && (forPlayer || r.kind === 'story_build' || fromForm || r.email)
        ? (fromForm ? { submission: true, theme: themeName(sTheme) || '' } : { theme: themeName(theme || sTheme) || '' }) : null;
      return {
        ...r,
        ...(submission ? { submission } : {}),
        ...(ready ? { puzzle: ready, ...(puzzle ? { puzzleExpiresAt } : {}) } : {}),
        ...(saved && forPlayer && r.kind === 'story_approved' ? { storeSaved: true } : {}),
        ...(build ? { build } : {}),
      };
    }),
  };
}

// The sender reports which notes went out (their addresses and words are removed) and
// which failed (tried again later, up to MAX_TRIES times).
export async function finishReplies(env, sent, failed, now = Date.now()) {
  const db = env.DB;
  const ids = (list) => (Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger).slice(0, CLAIM_MAX);
  const stmts = [];
  for (const id of ids(sent)) stmts.push(db.prepare("UPDATE feedback_replies SET status = 'sent', sent_at = ?1, email = NULL, text = NULL, note = NULL, explain = NULL, link = NULL, user_id = NULL WHERE id = ?2 AND status = 'sending'").bind(now, id));
  for (const id of ids(failed)) {
    stmts.push(db.prepare(`UPDATE feedback_replies SET status = CASE WHEN tries >= ?1 THEN 'failed' ELSE 'waiting' END,
      email = CASE WHEN tries >= ?1 THEN NULL ELSE email END, text = CASE WHEN tries >= ?1 THEN NULL ELSE text END,
      note = CASE WHEN tries >= ?1 THEN NULL ELSE note END, user_id = CASE WHEN tries >= ?1 THEN NULL ELSE user_id END, explain = CASE WHEN tries >= ?1 THEN NULL ELSE explain END, link = CASE WHEN tries >= ?1 THEN NULL ELSE link END WHERE id = ?2 AND status = 'sending'`).bind(MAX_TRIES, id));
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

// Messages (messages.js): when the team writes to a player who turned on
// "Email me when the team writes", queue a fixed notice (kind 'message') that
// says there is a new message in the game, never what it says. Same limits:
// one a day per player, inside the shared daily cap. Returns queued, limit,
// off or none (the player did not turn it on).
export async function queueNotice(env, uid, now = Date.now()) {
  const contact = await env.DB.prepare('SELECT email FROM message_contacts WHERE user_id = ?1').bind(uid).first();
  if (!contact) return 'none';
  const settings = await getSettings(env, now);
  if (!settings.feedback_replies_enabled || !settings.message_emails_enabled) return 'off';
  const who = await whoFor(uid);
  const since = now - DAY;
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE who = ?1 AND kind = 'message' AND created_at > ?2").bind(who, since).first();
  if (mine.n >= 1) return 'limit';
  if ((await sentToday(env, since)) >= settings.feedback_reply_daily_cap) return 'limit';
  await env.DB.prepare("INSERT INTO feedback_replies (who, kind, email, created_at) VALUES (?1, 'message', ?2, ?3)").bind(who, contact.email, now).run();
  return 'queued';
}
