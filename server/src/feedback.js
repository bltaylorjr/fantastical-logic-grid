// The game's "Ideas and problems" boxes: two separate forms, one for story
// and other ideas and one for problems a player wants to report.
//
//   POST /v1/feedback   { kind: idea|problem, topic, text, platform, version, reply, talk, puzzle }
//
// Anonymous: nothing about the player or device is stored. Email addresses,
// web addresses and long numbers are blanked before saving. The admin
// dashboard lists them (admin.js) and the daily cleanup removes done ones.
// With reply: true and a signed-in player's token, a thank-you email is
// queued for the account's own confirmed address (replies.js), kept apart
// from the message itself. With talk: true and a token, the player asks the
// team to answer in the game's Messages: only then is the row linked to the
// account, through a new conversation (messages.js); if their email is
// confirmed it is also kept to tell them when it is addressed (followups.js).
// puzzle: the open puzzle's own details (story id, settings, clue texts),
// never anything about the player (followups.js cleanPuzzle).
import { cleanPuzzle, keepFollowup } from './followups.js';
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { queueReply } from './replies.js';
import { talkAboutFeedback } from './messages.js';
import { verifyIdToken } from './auth.js';

export const TOPICS = {
  idea: ['story', 'other'],
  problem: ['play', 'sound', 'pictures', 'saving', 'other'],
};
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const MAX_NEW_PER_DAY = 500;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanText(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<link>')
    .replace(/\d{6,}/g, '#')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1000);
}

async function postFeedback(req, env) {
  let body;
  try { body = JSON.parse(await readText(req, 24_000)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  if (!(await getSettings(env)).feedback_enabled) return json(req, env, { error: 'switched_off', message: 'The idea and problem boxes are closed for now.' }, 503);
  const kind = TOPICS[body?.kind] ? body.kind : null;
  if (!kind) return json(req, env, { error: 'bad_request' }, 400);
  const topic = TOPICS[kind].includes(body.topic) ? body.topic : 'other';
  const text = cleanText(body.text);
  if (text.length < 5) return json(req, env, { error: 'too_short', message: 'Write a little more (at least 5 characters).' }, 400);
  const platform = PLATFORMS.has(body.platform) ? body.platform : 'web';
  const version = /^[\w.-]{1,24}$/.test(String(body.version)) ? String(body.version) : 'unknown';
  const since = Date.now() - 24 * 3600_000;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE created_at > ?1').bind(since).first();
  if (n >= MAX_NEW_PER_DAY) return json(req, env, { error: 'busy', message: 'The boxes are full for today. Please try again tomorrow.' }, 429);
  const puzzle = cleanPuzzle(body.puzzle);
  const row = await env.DB.prepare('INSERT INTO feedback (kind, topic, text, platform, version, puzzle, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id')
    .bind(kind, topic, text, platform, version, puzzle, Date.now()).first();
  let reply = 'none';
  try { reply = await queueReply(req, env, kind, body.reply === true); } catch (e) { console.error(e); reply = 'error'; }
  let talk = 'none';
  if (body.talk === true) {
    const token = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1];
    let user = null;
    if (token) { try { user = await verifyIdToken(token, env); } catch (e) { /* signed out */ } }
    if (!user) talk = 'signed_out';
    else { try { talk = await talkAboutFeedback(env, user, kind, text, row.id); } catch (e) { console.error(e); talk = 'error'; } }
    if (talk === 'linked') { try { await keepFollowup(env, user, row.id); } catch (e) { console.error(e); } }
  }
  return json(req, env, { ok: true, reply, talk });
}

// Returns a Response for this module's routes, or null for anything else.
export async function handleFeedback(req, env, url) {
  if (url.pathname !== '/v1/feedback' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_FEEDBACK && !(await env.LIMIT_FEEDBACK.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
    return json(req, env, { error: 'slow_down', message: 'That was quick! Wait a minute before sending another.' }, 429, { 'Retry-After': '60' });
  }
  return postFeedback(req, env);
}
