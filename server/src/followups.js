// Puzzle details on ideas and problems, and telling a player when what they
// sent has been addressed.
//
// Puzzle details: an idea or problem sent while a puzzle is open carries
// that puzzle's own details, so the team can open the same story and clues
// (a player asked why a song-request story ended on "who ordered the
// Tacos?"). Only the puzzle: story id, title, theme, topic, difficulty,
// seed, size, engine version and the clue texts. Never the player's marks,
// notes, name or device.
//
// Addressed: an admin marks an idea or problem addressed with a short, plain
// note of what was done (admin.js) and the version. If the player ticked "Let
// the team reply to me" (the only case where the message is linked to an
// account), the note goes to their Messages as a reply from the team, and,
// if their email was confirmed when they sent it, by email too (the same
// queue and sender as the thank-you notes, replies.js).
import { getSettings } from './settings.js';
import { cleanText } from './feedback.js';

const DAY = 24 * 3600_000;
const CLUES_MAX = 40;

const word = (v, max = 40) => (typeof v === 'string' && /^[\w .,'&:/|()!?-]{1,200}$/.test(v) ? v.trim().slice(0, max) : null);

// The puzzle details the game sent, checked and trimmed, as JSON text (or
// null when there are none or they make no sense).
export function cleanPuzzle(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {
    storyId: typeof p.storyId === 'string' && /^[\w/|.-]{1,200}$/.test(p.storyId) ? p.storyId : null,
    title: word(p.title, 80),
    theme: word(p.theme, 24),
    topic: word(p.topic, 24),
    tier: word(p.tier, 12),
    seed: typeof p.seed === 'string' && /^[\w.:-]{1,60}$/.test(p.seed) ? p.seed : null,
    size: typeof p.size === 'string' && /^\d{1,2}x\d{1,2}$/.test(p.size) ? p.size : null,
    engine: word(p.engine, 12),
    daily: p.daily === true || undefined,
    clues: Array.isArray(p.clues) ? p.clues.slice(0, CLUES_MAX).map((c) => cleanText(c).slice(0, 300)).filter(Boolean) : [],
  };
  if (!out.storyId && !out.theme && !out.clues.length) return null;
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return JSON.stringify(out);
}

export function parsePuzzle(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// At sending time: a player who linked the message to their account and has
// a confirmed email can be told when it is addressed.
export async function keepFollowup(env, user, feedbackId, now = Date.now()) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || !user.emailVerified || email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return false;
  await env.DB.prepare('INSERT OR REPLACE INTO feedback_followups (feedback_id, user_id, email, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(feedbackId, user.uid, email, now).run();
  return true;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The words the player reads in Messages and in the email.
export function fixMessage(kind, note, version) {
  const what = kind === 'idea' ? 'idea' : 'problem report';
  return `Good news: we've addressed your ${what}${version ? ` in version ${version}` : ''}. What we did: ${note}\n\nThank you for helping make the game better!`;
}

// After an idea or problem is marked addressed (admin.js): tell the player,
// if they linked it to their account. teamReply posts to that conversation
// (messages.js). Returns what reached them: { message, email }.
export async function tellPlayer(env, id, who, teamReply, now = Date.now()) {
  const db = env.DB;
  const f = await db.prepare('SELECT kind, note, fixed_in AS fixedIn, conversation_id AS conv FROM feedback WHERE id = ?1').bind(id).first();
  if (!f || !f.note) return { message: 'none', email: 'none' };
  const text = fixMessage(f.kind, f.note, f.fixedIn);
  const follow = await db.prepare('SELECT user_id AS uid, email FROM feedback_followups WHERE feedback_id = ?1').bind(id).first();
  let message = 'not_linked';
  if (f.conv) {
    try {
      // The fix email below says it all, so no separate "new message" notice.
      await teamReply(env, f.conv, { text, done: true, email: follow ? false : undefined }, who, now);
      message = 'sent';
    } catch (e) { message = e.error || 'error'; }
  }
  let email = 'none';
  if (follow) {
    email = await queueFixEmail(env, follow, text, now);
    await db.prepare('DELETE FROM feedback_followups WHERE feedback_id = ?1').bind(id).run();
  }
  return { message, email };
}

async function queueFixEmail(env, follow, text, now) {
  const settings = await getSettings(env, now);
  if (!settings.feedback_replies_enabled) return 'off';
  const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE created_at > ?1 AND status != 'dropped'").bind(now - DAY).first();
  if (all.n >= settings.feedback_reply_daily_cap) return 'limit';
  const whoHash = (await sha256(`flg-reply|${follow.uid}`)).slice(0, 32);
  await env.DB.prepare("INSERT INTO feedback_replies (who, kind, email, note, created_at) VALUES (?1, 'fixed', ?2, ?3, ?4)")
    .bind(whoHash, follow.email, text, now).run();
  return 'queued';
}

// Deleting an account and the daily cleanup (180 days) remove follow-up
// addresses too: see messages.js deleteMessageStatements and messageUpkeepStatements.
