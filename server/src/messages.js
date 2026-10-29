// Messages between signed-in players and the game's team, news for every
// player, and the admin dashboard's Communication inbox, which brings these
// together with the idea and problem boxes, error reports and the email log.
//
// For the game (signed in):
//   GET  /v1/messages              the player's conversations, newest first
//   POST /v1/messages              { topic: question|idea|problem, text } write to the team
//   POST /v1/messages/:id          { text } reply in a conversation
//   POST /v1/messages/:id/read     the player opened it
//   POST /v1/messages/email        { on } email me (a notice only) when the team writes
//   GET  /v1/messages/puzzles/:id  a puzzle the team made for this player (see below)
//   POST /v1/messages/puzzles/:id/opened   the player played or downloaded it
// News for everyone goes out with GET /v1/config (settings.js, publicNews).
//
// For the dashboard (admin.js routes call these):
//   inbox()             one list: messages, ideas, problems, error reports, emails
//   conversationView(), teamReply(), setConversationStatus(), startConversation()
//   listNews(), addNews(), endNews(), deleteNews()
//
// Puzzles for contributors: the team can attach a puzzle file to a reply
// (teamReply, body.puzzle), usually one made from the player's suggestion.
// The player sees it under Puzzles for you in Messages, can play or download
// it, and it is removed PUZZLE_KEEP_DAYS after it was sent (player_puzzles).
//
// Players only ever see "The team", never which admin wrote. Text is plain:
// both the game and the dashboard escape it. Player text has email
// addresses, web addresses and long numbers blanked, like the idea boxes.
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { cleanText, themeName } from './feedback.js';
import { withFixes } from './errors.js';
import { queueNotice, storylinesHeld } from './replies.js';
import { AuthError } from './auth.js';
import { nameKey } from './names.js';
import { checkPuzzle } from './compete.js';

const DAY = 24 * 3600_000;
export const PLAYER_TOPICS = ['question', 'idea', 'problem'];
const PLAYER_PER_DAY = 20; // messages one player can send in a day
const PLAYER_OPEN_MAX = 5; // open conversations one player can have started
const ALL_PLAYERS_PER_DAY = 2000;
const TEAM_PER_DAY = 500; // messages the team can send in a day, all admins together
const TEAM_TEXT_MAX = 2000;
const LIST_MAX = 30;
const THREAD_MAX = 100;
const NEWS_LIVE = 5;
export const PUZZLE_KEEP_DAYS = 30;
export const PUZZLE_MAX_CHARS = 400_000;
const PUZZLES_PER_PLAYER = 20; // waiting for one player at a time
const PUZZLES_TOTAL_CHARS = 50_000_000; // all stored puzzles together, well under the free database size

export class MessageRefusal extends Error {
  constructor(status, error, message) { super(message || error); this.status = status; this.error = error; }
}
const refuse = (status, error, message) => { throw new MessageRefusal(status, error, message); };

// Team text: kept as written (admins may include links), without control characters.
export function cleanTeamText(text, max = TEAM_TEXT_MAX) {
  return String(text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// "The music stopped after the first level and..." -> "The music stopped after the first level"
export function subjectOf(text, max = 60) {
  const line = String(text || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line || 'Message';
  const cut = line.slice(0, max);
  return `${(cut.lastIndexOf(' ') > 20 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[\s,.;:-]+$/, '')}…`;
}

async function isBanned(env, uid, now) {
  return !!(await env.DB.prepare('SELECT 1 FROM bans WHERE user_id = ?1 AND (until IS NULL OR until > ?2)').bind(uid, now).first());
}

async function playerLimits(env, uid, now) {
  const db = env.DB;
  const [mine, all] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ?1 AND m.sender = 'player' AND m.created_at > ?2`).bind(uid, now - DAY),
    db.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE sender = 'player' AND created_at > ?1").bind(now - DAY),
  ]);
  if (mine.results[0].n >= PLAYER_PER_DAY) refuse(429, 'limit', `You can send ${PLAYER_PER_DAY} messages a day. Please try again tomorrow.`);
  if (all.results[0].n >= ALL_PLAYERS_PER_DAY) refuse(429, 'busy', 'Messages are full for today. Please try again tomorrow.');
}

// Starts a conversation for a player. Used by POST /v1/messages and by the
// idea and problem boxes when the player asks the team to reply.
export async function startPlayerConversation(env, uid, topic, text, now = Date.now()) {
  const db = env.DB;
  if (!PLAYER_TOPICS.includes(topic)) topic = 'question';
  if (await isBanned(env, uid, now)) refuse(403, 'banned', 'Your account cannot send messages right now.');
  await playerLimits(env, uid, now);
  const open = await db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?1 AND status = 'open' AND topic != 'team'").bind(uid).first();
  if (open.n >= PLAYER_OPEN_MAX) refuse(429, 'too_many_open', `You have ${PLAYER_OPEN_MAX} conversations waiting for the team. Reply in one of those instead.`);
  const c = await db.prepare(`INSERT INTO conversations (user_id, topic, subject, status, admin_unread, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'open', 1, ?4, ?4) RETURNING id`).bind(uid, topic, subjectOf(text), now).first();
  await db.prepare("INSERT INTO conversation_messages (conversation_id, sender, text, created_at) VALUES (?1, 'player', ?2, ?3)").bind(c.id, text, now).run();
  return c.id;
}

// The idea and problem boxes: with the player's say-so, link the (otherwise
// anonymous) feedback row to a new conversation so the team can answer.
// Returns what happened, for the game to tell the player.
export async function talkAboutFeedback(env, user, kind, text, feedbackId, now = Date.now()) {
  if (!(await getSettings(env, now)).messages_enabled) return 'off';
  try {
    const id = await startPlayerConversation(env, user.uid, kind, text, now);
    await env.DB.prepare('UPDATE feedback SET conversation_id = ?1 WHERE id = ?2').bind(id, feedbackId).run();
    return 'linked';
  } catch (e) {
    if (e instanceof MessageRefusal) return e.error === 'banned' ? 'banned' : 'limit';
    throw e;
  }
}

// ------------------------------------------------------------- for the game
async function playerView(env, uid, now) {
  const db = env.DB;
  const { results: convs } = await db.prepare(`SELECT id, topic, subject, status, player_unread AS unread, created_at AS createdAt, updated_at AS updatedAt
    FROM conversations WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT ?2`).bind(uid, LIST_MAX).all();
  const byConv = new Map(convs.map((c) => [c.id, []]));
  if (convs.length) {
    const { results } = await db.prepare(`SELECT conversation_id AS c, sender, text, created_at AS at FROM conversation_messages
      WHERE conversation_id IN (${convs.map(() => '?').join(',')}) ORDER BY created_at, id`).bind(...convs.map((c) => c.id)).all();
    for (const m of results) byConv.get(m.c).push({ from: m.sender, text: m.text, at: m.at });
  }
  const contact = await db.prepare('SELECT 1 FROM message_contacts WHERE user_id = ?1').bind(uid).first();
  const { results: puzzles } = await db.prepare(`SELECT id, conversation_id AS conversationId, title, tier, created_at AS at, expires_at AS expiresAt, opened_at AS openedAt
    FROM player_puzzles WHERE user_id = ?1 AND expires_at > ?2 ORDER BY created_at DESC LIMIT ?3`).bind(uid, now, PUZZLES_PER_PLAYER).all();
  return {
    puzzles,
    conversations: convs.map((c) => ({ ...c, unread: c.unread > 0, messages: byConv.get(c.id).slice(-THREAD_MAX) })),
    unread: convs.filter((c) => c.unread > 0).length,
    email: !!contact,
    banned: await isBanned(env, uid, now),
  };
}

async function readJson(req) {
  try { return JSON.parse(await readText(req, 6_000)); } catch (e) { refuse(e instanceof TooLarge ? 413 : 400, e instanceof TooLarge ? 'too_large' : 'bad_request'); }
  return null;
}

function playerText(body) {
  const text = cleanText(body?.text);
  if (text.length < 2) refuse(400, 'too_short', 'Write a little more first.');
  return text;
}

async function playerRoute(req, env, url, user, now) {
  const db = env.DB;
  const path = url.pathname;
  if (path === '/v1/messages' && req.method === 'GET') return playerView(env, user.uid, now);
  const pz = path.match(/^\/v1\/messages\/puzzles\/(\d{1,12})(\/opened)?$/);
  if (pz && (pz[2] ? req.method === 'POST' : req.method === 'GET')) {
    const row = await db.prepare('SELECT id, title, puzzle, expires_at AS expiresAt FROM player_puzzles WHERE id = ?1 AND user_id = ?2 AND expires_at > ?3')
      .bind(Number(pz[1]), user.uid, now).first();
    if (!row) refuse(404, 'gone', 'That puzzle is no longer stored. Puzzles from the team are kept for 30 days.');
    if (pz[2]) {
      await db.prepare('UPDATE player_puzzles SET opened_at = COALESCE(opened_at, ?2) WHERE id = ?1').bind(row.id, now).run();
      return { ok: true };
    }
    return { id: row.id, title: row.title, expiresAt: row.expiresAt, puzzle: JSON.parse(row.puzzle) };
  }
  if (req.method !== 'POST') refuse(404, 'not_found');
  const body = await readJson(req);
  if (path === '/v1/messages') {
    const topic = PLAYER_TOPICS.includes(body?.topic) ? body.topic : 'question';
    const id = await startPlayerConversation(env, user.uid, topic, playerText(body), now);
    return { ok: true, id };
  }
  if (path === '/v1/messages/email') {
    if (body?.on !== true) {
      await db.prepare('DELETE FROM message_contacts WHERE user_id = ?1').bind(user.uid).run();
      return { ok: true, email: false };
    }
    const email = String(user.email || '').trim().toLowerCase();
    if (!email || !user.emailVerified || email.length > 254) refuse(403, 'unverified', 'Confirm your email address first (Menu > Account and sync).');
    await db.prepare(`INSERT INTO message_contacts (user_id, email, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`).bind(user.uid, email, now).run();
    return { ok: true, email: true };
  }
  const m = path.match(/^\/v1\/messages\/(\d{1,12})(\/read)?$/);
  if (!m) refuse(404, 'not_found');
  const conv = await db.prepare('SELECT id, status FROM conversations WHERE id = ?1 AND user_id = ?2').bind(Number(m[1]), user.uid).first();
  if (!conv) refuse(404, 'gone', 'That conversation is gone.');
  if (m[2]) {
    await db.prepare('UPDATE conversations SET player_unread = 0 WHERE id = ?1').bind(conv.id).run();
    return { ok: true };
  }
  if (await isBanned(env, user.uid, now)) refuse(403, 'banned', 'Your account cannot send messages right now.');
  const text = playerText(body);
  await playerLimits(env, user.uid, now);
  // A reply reopens a conversation the team had marked done.
  await db.batch([
    db.prepare("INSERT INTO conversation_messages (conversation_id, sender, text, created_at) VALUES (?1, 'player', ?2, ?3)").bind(conv.id, text, now),
    db.prepare("UPDATE conversations SET status = 'open', done_at = NULL, admin_unread = admin_unread + 1, updated_at = ?2 WHERE id = ?1").bind(conv.id, now),
  ]);
  return { ok: true };
}

const bucket = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Returns a Response for /v1/messages routes, or null for anything else.
export async function handleMessages(req, env, url, signedIn, isDeleted) {
  if (url.pathname !== '/v1/messages' && !url.pathname.startsWith('/v1/messages/')) return null;
  const now = Date.now();
  let user;
  try { user = await signedIn(req, env); } catch (e) {
    if (e instanceof AuthError) return json(req, env, { error: 'sign_in', message: 'Sign in to send and read messages.' }, 401);
    throw e;
  }
  if (env.LIMIT_MESSAGES && !(await env.LIMIT_MESSAGES.limit({ key: await bucket(`flg-msg|${user.uid}`) })).success) {
    return json(req, env, { error: 'slow_down', message: 'That was quick! Wait a minute and try again.' }, 429, { 'Retry-After': '60' });
  }
  if (await isDeleted(env, user.uid)) return json(req, env, { error: 'account_deleted' }, 401);
  if (!(await getSettings(env, now)).messages_enabled) {
    return req.method === 'GET'
      ? json(req, env, { off: true, conversations: [], unread: 0, email: false })
      : json(req, env, { error: 'switched_off', message: 'Messages are closed for now.' }, 503);
  }
  try {
    return json(req, env, await playerRoute(req, env, url, user, now));
  } catch (e) {
    if (e instanceof MessageRefusal) return json(req, env, { error: e.error, message: e.message }, e.status);
    throw e;
  }
}

// Statements that remove a player's messages, for account deletion.
export function deleteMessageStatements(env, uid) {
  return [
    env.DB.prepare('DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?1)').bind(uid),
    env.DB.prepare('DELETE FROM player_puzzles WHERE user_id = ?1').bind(uid),
    env.DB.prepare('UPDATE feedback SET conversation_id = NULL WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?1)').bind(uid),
    env.DB.prepare('DELETE FROM conversations WHERE user_id = ?1').bind(uid),
    env.DB.prepare('DELETE FROM message_contacts WHERE user_id = ?1').bind(uid),
  ];
}

// For the daily cleanup (upkeep.js).
export function messageUpkeepStatements(env, now) {
  const old = now - 180 * DAY;
  return {
    player_puzzles: env.DB.prepare('DELETE FROM player_puzzles WHERE expires_at < ?1 OR conversation_id NOT IN (SELECT id FROM conversations)').bind(now),
    conversation_messages: env.DB.prepare(`DELETE FROM conversation_messages WHERE conversation_id IN
      (SELECT id FROM conversations WHERE (status = 'done' AND done_at < ?1) OR updated_at < ?2)`).bind(old, now - 365 * DAY),
    conversations: env.DB.prepare("DELETE FROM conversations WHERE (status = 'done' AND done_at < ?1) OR updated_at < ?2").bind(old, now - 365 * DAY),
    news: env.DB.prepare('DELETE FROM news WHERE (ends_at IS NOT NULL AND ends_at < ?1) OR created_at < ?2').bind(now - 90 * DAY, now - 365 * DAY),
  };
}

// ------------------------------------------------------------- news
export async function publicNews(env, now = Date.now()) {
  try {
    const { results } = await env.DB.prepare(`SELECT id, title, text, created_at AS at FROM news
      WHERE created_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1) ORDER BY created_at DESC LIMIT ?2`).bind(now, NEWS_LIVE).all();
    return results;
  } catch (e) {
    return [];
  }
}

export async function listNews(env, now = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT id, title, text, created_by AS createdBy, created_at AS createdAt, ends_at AS endsAt
    FROM news ORDER BY created_at DESC LIMIT 50`).all();
  const live = new Set((await publicNews(env, now)).map((n) => n.id));
  return results.map((n) => ({ ...n, live: live.has(n.id) }));
}

export async function addNews(env, body, who, now = Date.now()) {
  const title = cleanTeamText(body.title, 100).replace(/\s+/g, ' ');
  const text = cleanTeamText(body.text, 1500);
  if (title.length < 3 || title.length > 80) refuse(400, 'bad_title', 'Write a title of 3 to 80 characters.');
  if (text.length < 3) refuse(400, 'bad_text', 'Write the news (up to 1,500 characters).');
  const endsAt = Number.isFinite(body.endsAt) ? body.endsAt : null;
  if (endsAt !== null && endsAt <= now) refuse(400, 'bad_time', 'The end must be in the future.');
  const r = await env.DB.prepare('INSERT INTO news (title, text, created_by, created_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
    .bind(title, text, who.actor, now, endsAt).first();
  return { id: r.id, title, endsAt };
}

export async function endNews(env, id, now = Date.now()) {
  await env.DB.prepare('UPDATE news SET ends_at = ?2 WHERE id = ?1 AND (ends_at IS NULL OR ends_at > ?2)').bind(id, now).run();
}

export async function deleteNews(env, id) {
  await env.DB.prepare('DELETE FROM news WHERE id = ?1').bind(id).run();
}

// ------------------------------------------------------------- the dashboard
export const INBOX_TYPES = ['all', 'message', 'idea', 'problem', 'error', 'email'];
// Which kinds of item each role may see; viewers cannot read what players wrote.
const TYPES_FOR = { viewer: ['error', 'email'], moderator: ['message', 'idea', 'problem', 'error', 'email'] };
export const typesFor = (role) => (role === 'viewer' ? TYPES_FOR.viewer : TYPES_FOR.moderator);
const PER_TYPE = 100;
const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const EMAIL_KINDS = { idea: 'Thank-you email for an idea', problem: 'Email about a problem report', idea_update: 'Update email: idea addressed', story_approved: 'Email: storyline approved, with its puzzle', problem_update: 'Update email: problem addressed', message: 'Email: new message from the team' };
const EMAIL_STATUS = { held: 'Sent once the team marks it addressed', waiting: 'Waiting to be sent', sending: 'Being sent', sent: 'Sent', failed: 'Could not be sent', dropped: 'Not sent (emails were switched off, or it was closed without being addressed)' };

// One list, newest first, of everything players sent or the game reported.
// type: one of INBOX_TYPES; status: new (open, waiting), addressed (ideas, problems
// and errors the team marked addressed with a note), done or all; q: words to find.
export async function inbox(env, role, { type = 'all', status = 'new', q = '' } = {}, now = Date.now()) {
  const db = env.DB;
  const allowed = typesFor(role);
  const want = type === 'all' ? allowed : allowed.filter((t) => t === type);
  const search = q ? like(q) : null;
  const items = [];
  const has = (t) => want.includes(t);

  if (has('message') && status !== 'addressed') {
    const st = status === 'new' ? 'open' : status;
    const { results } = await db.prepare(`SELECT c.id, c.topic, c.subject, c.status, c.admin_unread AS unread, c.updated_at AS at, c.created_at AS createdAt,
        p.screen_name AS name,
        (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS count,
        (SELECT m.text FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last,
        (SELECT m.sender FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastFrom
      FROM conversations c LEFT JOIN players p ON p.user_id = c.user_id
      WHERE (?1 = 'all' OR c.status = ?1)
        AND (?2 IS NULL OR c.subject LIKE ?2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id AND m.text LIKE ?2 ESCAPE '\\'))
      ORDER BY c.updated_at DESC LIMIT ?3`).bind(st, search, PER_TYPE).all();
    for (const c of results) {
      items.push({
        type: 'message', id: c.id, at: c.at, status: c.status === 'open' ? 'new' : 'done', title: c.subject, text: c.last || '',
        meta: { topic: c.topic, unread: c.unread, count: c.count, lastFrom: c.lastFrom, name: c.name, createdAt: c.createdAt },
      });
    }
  }
  for (const kind of ['idea', 'problem']) {
    if (!has(kind)) continue;
    const { results } = await db.prepare(`SELECT id, topic, theme, text, platform, version, status, note, created_at AS at, done_at AS doneAt, conversation_id AS conversationId FROM feedback
      WHERE kind = ?1 AND (?2 = 'all' OR status = ?2) AND (?3 IS NULL OR text LIKE ?3 ESCAPE '\\') ORDER BY created_at DESC LIMIT ?4`).bind(kind, status, search, PER_TYPE).all();
    const storyEmail = kind === 'idea' ? await storylinesHeld(env, results.filter((f) => f.topic === 'story').map((f) => f.id)).catch(() => new Set()) : new Set();
    for (const f of results) {
      items.push({ type: kind, id: f.id, at: f.at, status: f.status, title: f.topic, text: f.text, meta: { topic: f.topic, theme: f.theme || null, themeName: f.theme ? themeName(f.theme) : null, platform: f.platform, version: f.version, conversationId: f.conversationId, note: f.note, doneAt: f.doneAt, storyEmail: storyEmail.has(f.id) } });
    }
  }
  // Error reports have no done state: "new" is the last 7 days, "all" and
  // "addressed" the last 30. An error marked addressed (errors.js withFixes)
  // leaves "new" unless a report comes from the fixed version or later.
  if (has('error') && status !== 'done') {
    const since = new Date(now - ((status === 'new' ? 7 : 30) - 1) * DAY).toISOString().slice(0, 10);
    const { results } = await db.prepare(`SELECT fingerprint AS id, kind, platform, version, message, place, SUM(count) AS count, MIN(day) AS first, MAX(day) AS last
      FROM app_errors WHERE day >= ?1 AND (?2 IS NULL OR message LIKE ?2 ESCAPE '\\') GROUP BY fingerprint ORDER BY last DESC, count DESC LIMIT ?3`).bind(since, search, PER_TYPE).all();
    for (const e of await withFixes(env, results)) {
      const st = e.fix && !e.fix.missed ? 'addressed' : 'new';
      if (status !== 'all' && st !== status) continue;
      items.push({ type: 'error', id: e.id, at: Date.parse(`${e.last}T23:59:59Z`), status: st, title: e.kind, text: e.message, meta: { count: e.count, place: e.place, platform: e.platform, version: e.version, first: e.first, last: e.last, fix: e.fix || null } });
    }
  }
  // The email log: only the kind and state, never the address or the player's words.
  if (has('email') && !search && status !== 'addressed') {
    const st = status === 'new' ? "status IN ('waiting', 'sending')" : status === 'done' ? "status IN ('sent', 'failed', 'dropped')" : '1 = 1';
    try {
      const { results } = await db.prepare(`SELECT id, kind, status, created_at AS at, sent_at AS sentAt FROM feedback_replies WHERE ${st} ORDER BY created_at DESC LIMIT ?1`).bind(PER_TYPE).all();
      for (const r of results) {
        items.push({ type: 'email', id: r.id, at: r.at, status: ['waiting', 'sending'].includes(r.status) ? 'new' : 'done', title: EMAIL_KINDS[r.kind] || 'Email', text: EMAIL_STATUS[r.status] || r.status, meta: { kind: r.kind, state: r.status, sentAt: r.sentAt } });
      }
    } catch (e) { /* the email queue is not set up yet */ }
  }
  items.sort((a, b) => b.at - a.at);
  return { type, status, q, types: allowed, items: items.slice(0, 200), counts: await inboxCounts(env, role, now) };
}

// What is waiting, for the tab badges and the nav count.
export async function inboxCounts(env, role, now = Date.now()) {
  const db = env.DB;
  const since = new Date(now - 6 * DAY).toISOString().slice(0, 10);
  const viewer = role === 'viewer';
  const stmts = [
    db.prepare('SELECT COUNT(DISTINCT fingerprint) AS n FROM app_errors WHERE day >= ?1').bind(since),
    db.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE status IN ('waiting', 'sending')"),
  ];
  if (!viewer) {
    stmts.push(db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(admin_unread > 0), 0) AS unread FROM conversations WHERE status = 'open'"));
    stmts.push(db.prepare("SELECT kind, COUNT(*) AS n FROM feedback WHERE status = 'new' GROUP BY kind"));
  }
  let r;
  try { r = (await db.batch(stmts)).map((x) => x.results); } catch (e) { return {}; }
  const counts = { error: r[0][0].n, email: r[1][0].n };
  if (!viewer) {
    counts.message = r[2][0].n;
    counts.unread = r[2][0].unread;
    const fb = Object.fromEntries(r[3].map((x) => [x.kind, x.n]));
    counts.idea = fb.idea || 0;
    counts.problem = fb.problem || 0;
  }
  return counts;
}

// One conversation in full. Opening it marks the player's messages as read.
export async function conversationView(env, id) {
  const db = env.DB;
  const c = await db.prepare(`SELECT c.id, c.user_id AS uid, c.topic, c.subject, c.status, c.created_at AS createdAt, c.updated_at AS updatedAt, c.done_at AS doneAt,
      c.player_unread AS playerUnread, p.screen_name AS name
    FROM conversations c LEFT JOIN players p ON p.user_id = c.user_id WHERE c.id = ?1`).bind(id).first();
  if (!c) refuse(404, 'gone', 'That conversation is gone.');
  const [msgs, fb, contact, , puzzles] = (await db.batch([
    db.prepare('SELECT id, sender, author, text, created_at AS at FROM conversation_messages WHERE conversation_id = ?1 ORDER BY created_at, id').bind(id),
    db.prepare('SELECT id, kind, topic, platform, version FROM feedback WHERE conversation_id = ?1').bind(id),
    db.prepare('SELECT 1 AS on_ FROM message_contacts WHERE user_id = ?1').bind(c.uid),
    db.prepare('UPDATE conversations SET admin_unread = 0 WHERE id = ?1').bind(id),
    db.prepare(`SELECT id, title, tier, size, created_by AS createdBy, created_at AS at, expires_at AS expiresAt, opened_at AS openedAt
      FROM player_puzzles WHERE conversation_id = ?1 AND expires_at > ?2 ORDER BY created_at`).bind(id, Date.now()),
  ])).map((x) => x.results);
  return { ...c, messages: msgs, feedback: fb[0] || null, emailOn: !!contact.length, puzzles };
}

async function teamLimit(env, now) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE sender = 'team' AND created_at > ?1").bind(now - DAY).first();
  if (n >= TEAM_PER_DAY) refuse(429, 'limit', `The team can send ${TEAM_PER_DAY} messages a day. Try again tomorrow.`);
}

function teamText(body) {
  const text = cleanTeamText(body.text);
  if (text.length < 2) refuse(400, 'bad_text', `Write the message (up to ${TEAM_TEXT_MAX.toLocaleString('en-US')} characters).`);
  return text;
}

// Email notice: only when the player turned it on, and never the message itself.
async function notify(env, uid, wanted, now) {
  if (wanted === false) return 'none';
  try { return await queueNotice(env, uid, now); } catch (e) { console.error(e); return 'error'; }
}

export async function teamReply(env, id, body, who, now = Date.now()) {
  const db = env.DB;
  const c = await db.prepare('SELECT id, user_id AS uid FROM conversations WHERE id = ?1').bind(id).first();
  if (!c) refuse(404, 'gone', 'That conversation is gone.');
  const text = teamText(body);
  await teamLimit(env, now);
  const puzzle = body.puzzle === undefined || body.puzzle === null ? null : await attachable(env, c.uid, body.puzzle, now);
  // Replying leaves the conversation open unless the admin says it is done.
  const done = body.done === true;
  const stmts = [
    db.prepare("INSERT INTO conversation_messages (conversation_id, sender, author, text, created_at) VALUES (?1, 'team', ?2, ?3, ?4)").bind(id, who.actor, text, now),
    db.prepare(`UPDATE conversations SET player_unread = player_unread + 1, admin_unread = 0, updated_at = ?2,
      status = CASE WHEN ?3 THEN 'done' ELSE status END, done_at = CASE WHEN ?3 THEN ?2 ELSE done_at END WHERE id = ?1`).bind(id, now, done ? 1 : 0),
  ];
  if (puzzle) {
    stmts.push(db.prepare(`INSERT INTO player_puzzles (user_id, conversation_id, title, tier, puzzle, size, created_by, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(c.uid, id, puzzle.title, puzzle.tier, puzzle.text, puzzle.text.length, who.actor, now, now + PUZZLE_KEEP_DAYS * DAY));
  }
  await db.batch(stmts);
  return { ok: true, email: await notify(env, c.uid, body.email, now), length: text.length, done, puzzle: puzzle ? { title: puzzle.title, expiresAt: now + PUZZLE_KEEP_DAYS * DAY } : null };
}

// A puzzle file the team attached to a reply: the game's saved puzzle file
// ({ format: 'fantastical-logic-grid', save: { puzzle } }) or a bare puzzle.
// Checked like a race puzzle, and within the storage limits.
async function attachable(env, uid, value, now) {
  const p = value && value.format === 'fantastical-logic-grid' && value.save ? value.save.puzzle : value;
  const bad = checkPuzzle(p);
  if (bad) refuse(400, 'bad_puzzle', bad === 'puzzle_words' ? 'The puzzle has words the game does not allow.' : 'That is not a Fantastical Logic Grid puzzle file. Use a file saved from the game (Saved puzzles > Save to a file).');
  const text = JSON.stringify(p);
  if (text.length > PUZZLE_MAX_CHARS) refuse(413, 'too_large', 'That puzzle file is too big.');
  const [mine, all] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM player_puzzles WHERE user_id = ?1 AND expires_at > ?2').bind(uid, now),
    env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM player_puzzles WHERE expires_at > ?1').bind(now),
  ]);
  if (mine.results[0].n >= PUZZLES_PER_PLAYER) refuse(429, 'puzzles_full', `This player already has ${PUZZLES_PER_PLAYER} puzzles waiting. Remove one or wait for the oldest to expire.`);
  if (all.results[0].n + text.length > PUZZLES_TOTAL_CHARS) refuse(507, 'storage_full', 'Puzzle storage is full. Remove some puzzles or wait for old ones to expire.');
  return { text, title: String(p.title).slice(0, 120), tier: String(p.difficulty.id) };
}

// Stores a puzzle for a player outside a conversation (an approved storyline,
// admin.js). Same checks and limits as an attached puzzle. Returns its id.
export async function storePuzzle(env, uid, value, actor, now = Date.now()) {
  const p = await attachable(env, uid, value, now);
  const row = await env.DB.prepare(`INSERT INTO player_puzzles (user_id, conversation_id, title, tier, puzzle, size, created_by, created_at, expires_at)
    VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`).bind(uid, p.title, p.tier, p.text, p.text.length, actor, now, now + PUZZLE_KEEP_DAYS * DAY).first();
  return row.id;
}

// The team removes a stored puzzle before it expires.
export async function removePuzzle(env, convId, puzzleId) {
  const r = await env.DB.prepare('DELETE FROM player_puzzles WHERE id = ?1 AND conversation_id = ?2').bind(puzzleId, convId).run();
  if (!r.meta.changes) refuse(404, 'gone', 'That puzzle is already gone.');
  return { ok: true };
}

// Totals for the admin dashboard.
export async function puzzleStorage(env, now = Date.now()) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS chars FROM player_puzzles WHERE expires_at > ?1').bind(now).first();
  return { puzzles: r.n, chars: r.chars, capChars: PUZZLES_TOTAL_CHARS, keepDays: PUZZLE_KEEP_DAYS, perPlayer: PUZZLES_PER_PLAYER };
}

export async function setConversationStatus(env, id, status, now = Date.now()) {
  const db = env.DB;
  let r;
  if (status === 'delete') {
    const res = await db.batch([
      db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?1').bind(id),
      db.prepare('UPDATE feedback SET conversation_id = NULL WHERE conversation_id = ?1').bind(id),
      db.prepare('DELETE FROM conversations WHERE id = ?1').bind(id),
      db.prepare('DELETE FROM player_puzzles WHERE conversation_id = ?1').bind(id),
    ]);
    r = res[2];
  } else if (status === 'done' || status === 'open') {
    r = await db.prepare('UPDATE conversations SET status = ?2, done_at = ?3 WHERE id = ?1').bind(id, status, status === 'done' ? now : null).run();
  } else refuse(400, 'bad_status');
  if (!r.meta.changes) refuse(404, 'gone', 'That conversation is gone.');
  return { ok: true };
}

// An admin writes first, to one player found by screen name or player id.
export async function startConversation(env, body, who, now = Date.now()) {
  const db = env.DB;
  const to = String(body.to || '').trim().slice(0, 128);
  if (!to) refuse(400, 'no_player', 'Choose a player: their screen name or player id.');
  let uid = null;
  const byName = await db.prepare('SELECT user_id FROM players WHERE name_key = ?1').bind(nameKey(to)).first();
  if (byName) uid = byName.user_id;
  else if (/^[\w-]{6,128}$/.test(to)) {
    const acct = await db.prepare('SELECT user_id FROM sync_users WHERE user_id = ?1 UNION SELECT user_id FROM players WHERE user_id = ?1').bind(to).first();
    if (acct) uid = acct.user_id;
  }
  if (!uid) refuse(404, 'no_player', 'No player has that screen name or id.');
  if (await db.prepare('SELECT 1 FROM sync_deleted_users WHERE user_id = ?1').bind(uid).first()) refuse(404, 'no_player', 'That account was deleted.');
  const text = teamText(body);
  const subject = cleanTeamText(body.subject, 100).replace(/\s+/g, ' ') || subjectOf(text);
  await teamLimit(env, now);
  const c = await db.prepare(`INSERT INTO conversations (user_id, topic, subject, status, player_unread, created_at, updated_at)
    VALUES (?1, 'team', ?2, 'open', 1, ?3, ?3) RETURNING id`).bind(uid, subject.slice(0, 80), now).first();
  await db.prepare("INSERT INTO conversation_messages (conversation_id, sender, author, text, created_at) VALUES (?1, 'team', ?2, ?3, ?4)").bind(c.id, who.actor, text, now).run();
  return { id: c.id, uid, email: await notify(env, uid, body.email, now) };
}
