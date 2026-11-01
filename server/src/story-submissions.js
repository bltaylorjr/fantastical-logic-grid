// The Storyline Submission Database: theme ideas, category ideas and whole
// storylines players send from the game's Suggest a storyline page
// (web/storyline/), plus every storyline and theme idea sent from Share an
// idea. Each entry is kept exactly as submitted, with the player (if signed
// in), the author credit, their consent and, once approved, the first puzzle
// built from it.
//
//   POST /v1/story-submissions        an entry (web/js/storyline-fields.js checks it)
//   POST /v1/story-submissions/copy   { id, key, email } a guest asks for a copy of their form
//
// Signed in with a confirmed email, the player gets a confirmation with a copy
// of the completed form straight away. A guest gets a one-time key with the
// answer, so they can ask for the copy on the thank-you screen (within an
// hour); that address is also where the approval email goes.
//
// Admin routes (storySubmissionRoutes, wired into admin.js):
//   GET  /admin/v1/story-submissions?q=&kind=&status=&source=&page=   search the database
//   GET  /admin/v1/story-submissions/:id        one entry, with its form, emails and puzzle
//   POST /admin/v1/story-submissions/:id/polish  fix spelling, grammar and punctuation (Gemini), or save { polished }
//   POST /admin/v1/story-submissions/:id/approve  approve; a storyline's first puzzle is built from the corrected words,
//                                                saved here and in the player's Saved puzzles, and emailed as a PDF
//   POST /admin/v1/story-submissions/:id/decline  decline; the author gets a thank-you if we have their address
//   POST /admin/v1/story-submissions/:id/email   { to } email a copy of the entry (and its puzzle) to any address
//   POST /admin/v1/story-submissions/:id/delete
//
// Senders (scripts/feedback-replies.py): the confirmation, the approval and a
// decline thank-you go from noreply@thelogicgrid.com; copies the team emails
// go from support@thelogicgrid.com.
import { alert } from './alerts.js';
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { verifyIdToken } from './auth.js';
import { themeName } from './feedback.js';
import { heldStoryline, approveStoryline, declineStoryline, dropUpdate } from './replies.js';
import { THEMES } from '../../engine/src/themes.js';
import { checkSubmission, formCopy, formText, KINDS, CONSENT_TEXT } from '../../web/js/storyline-fields.js';

const THEME_IDS = THEMES.map((t) => t.id);
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const MAX_NEW_PER_DAY = 300;
const COPY_WINDOW = 3600_000; // a guest can ask for their copy for an hour
const PER_PAGE = 50;
const DAY = 24 * 3600_000;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cleanEmail = (v) => { const e = String(v || '').trim().toLowerCase(); return e.length <= 254 && EMAIL.test(e) ? e : null; };
const nameOf = (id) => themeName(id) || '';

// Queues an email about a submission (feedback_replies, sent by the GitHub
// Action). kind: story_received, story_approved, submission_approved,
// story_declined, submission_copy, or story_build (no email: only builds and
// saves the puzzle). Returns true when queued.
export async function queueSubmissionMail(env, { kind, submissionId, email = null, userId = null, now = Date.now(), cap = true }) {
  const settings = await getSettings(env, now);
  if (kind !== 'story_build' && (!email || !settings.feedback_replies_enabled)) return false;
  if (cap && kind !== 'story_build') {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE created_at > ?1 AND status NOT IN ('dropped', 'held')").bind(now - DAY).first();
    if (n >= settings.feedback_reply_daily_cap) return false;
  }
  const who = (await sha256(userId ? `flg-reply|${userId}` : `flg-reply-guest|${email || submissionId}`)).slice(0, 32);
  await env.DB.prepare("INSERT INTO feedback_replies (who, kind, email, status, created_at, topic, user_id, submission_id) VALUES (?1, ?2, ?3, 'waiting', ?4, 'story', ?5, ?6)")
    .bind(who, kind, email, now, userId, submissionId).run();
  return true;
}

// Saves a storyline or theme idea from Share an idea in the database too
// (feedback.js), so every player submission is in one place.
export async function saveIdeaBoxEntry(env, { feedbackId, topic, theme, text, platform, version, now = Date.now() }) {
  const kind = topic === 'story' ? 'storyline' : 'theme';
  const form = { kind, idea: text, theme: theme || null };
  await env.DB.prepare(`INSERT OR IGNORE INTO story_submissions (kind, source, feedback_id, theme, form, text, platform, version, created_at)
    VALUES (?1, 'idea box', ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(kind, feedbackId, theme || null, JSON.stringify(form), text, platform, version, now).run();
}

async function signedInPlayer(req, env) {
  const token = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1];
  if (!token) return null;
  try { return await verifyIdToken(token, env); } catch (e) { return null; }
}

async function submit(req, env, ctx) {
  let body;
  try { body = JSON.parse(await readText(req, 24_000)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  const settings = await getSettings(env);
  if (!settings.feedback_enabled) return json(req, env, { error: 'switched_off', message: 'Submissions are closed for now. Please try again later.' }, 503);
  const checked = checkSubmission(body, { themeIds: THEME_IDS });
  if (checked.errors) return json(req, env, { error: 'check', errors: checked.errors, message: 'Some fields need a look.' }, 400);
  const form = checked.value;
  const now = Date.now();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM story_submissions WHERE created_at > ?1 AND source = \'form\'').bind(now - DAY).first();
  if (n >= MAX_NEW_PER_DAY) return json(req, env, { error: 'busy', message: 'Lots of entries came in today. Please try again tomorrow.' }, 429);
  const user = await signedInPlayer(req, env);
  const email = user && user.emailVerified ? cleanEmail(user.email) : null;
  const key = email ? null : randomKey();
  const platform = PLATFORMS.has(body.platform) ? body.platform : 'web';
  const version = /^[\w.-]{1,24}$/.test(String(body.version)) ? String(body.version) : 'unknown';
  const row = await env.DB.prepare(`INSERT INTO story_submissions (kind, source, theme, title, pitch, credit, consent, consent_text, form, text, user_id, email, copy_key, copy_until, platform, version, created_at)
    VALUES (?1, 'form', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16) RETURNING id`)
    .bind(form.kind, form.theme || null, form.title || form.idea || null, form.pitch || null, form.credit || null, form.consent ? 1 : 0, form.consent ? CONSENT_TEXT : null,
      JSON.stringify(form), formText(form, nameOf), user ? user.uid : null, email, key ? await sha256(key) : null, key ? now + COPY_WINDOW : null, platform, version, now).first();
  await alert(env, ctx, { category: 'messages', title: `New ${KINDS[form.kind].toLowerCase()}`, body: String(form.title || form.idea || '').slice(0, 160), link: 'story-submissions' });
  let copy = 'offer';
  if (email) copy = (await queueSubmissionMail(env, { kind: 'story_received', submissionId: row.id, email, userId: user.uid, now })) ? 'emailed' : 'saved';
  return json(req, env, { ok: true, id: row.id, copy, ...(key ? { key } : {}) });
}

// A guest asks for a copy of their form on the thank-you screen.
async function askCopy(req, env) {
  let body;
  try { body = JSON.parse(await readText(req, 2_000)); } catch (e) { return json(req, env, { error: 'bad_request' }, 400); }
  const email = cleanEmail(body.email);
  if (!email) return json(req, env, { error: 'bad_email', message: 'Enter a valid email address.' }, 400);
  const id = Number(body.id);
  const key = String(body.key || '');
  if (!Number.isInteger(id) || key.length < 20) return json(req, env, { error: 'bad_request' }, 400);
  const now = Date.now();
  const r = await env.DB.prepare('UPDATE story_submissions SET email = ?1, copy_key = NULL, copy_until = NULL WHERE id = ?2 AND copy_key = ?3 AND copy_until > ?4 AND email IS NULL')
    .bind(email, id, await sha256(key), now).run();
  if (!r.meta.changes) return json(req, env, { error: 'expired', message: 'That copy can no longer be sent. Your entry is saved.' }, 410);
  const queued = await queueSubmissionMail(env, { kind: 'story_received', submissionId: id, email, now });
  return json(req, env, { ok: true, copy: queued ? 'emailed' : 'saved' });
}

// Returns a Response for this module's routes, or null for anything else.
export async function handleStorySubmissions(req, env, url, ctx) {
  const copy = url.pathname === '/v1/story-submissions/copy';
  if ((url.pathname !== '/v1/story-submissions' && !copy) || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_FEEDBACK && !(await env.LIMIT_FEEDBACK.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
    return json(req, env, { error: 'slow_down', message: 'That was quick! Wait a minute before sending another.' }, 429, { 'Retry-After': '60' });
  }
  return copy ? askCopy(req, env) : submit(req, env, ctx);
}

// ---------------------------------------------------------------- polishing
// The fields whose wording the team corrects (names stay as the author wrote them).
const POLISH_FIELDS = ['title', 'pitch', 'setting', 'goal', 'clues', 'beat', 'branch', 'alt', 'idea'];

export function polishable(form) {
  const out = {};
  for (const k of POLISH_FIELDS) if (String(form[k] || '').trim()) out[k] = form[k];
  if (Array.isArray(form.characters)) out.traits = form.characters.map((c) => c.trait || '');
  return out;
}

// Keeps only the corrected fields the form has, as plain text of sensible length.
export function cleanPolished(form, value) {
  const want = polishable(form);
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const k of Object.keys(want)) {
    if (k === 'traits') {
      if (Array.isArray(value.traits)) out.traits = want.traits.map((t, i) => String(value.traits[i] ?? t).slice(0, 60));
    } else if (typeof value[k] === 'string' && value[k].trim()) out[k] = value[k].replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2400);
  }
  return out;
}

async function polishWithAi(env, model, form) {
  if (!env.GEMINI_API_KEY) return { error: 'Fixing the wording needs the GEMINI_API_KEY Cloudflare secret. You can still edit the corrected words by hand.' };
  const fields = polishable(form);
  const prompt = `You are a careful copy editor for a family-friendly logic puzzle game. Correct the spelling, grammar and punctuation of a player's story submission.
Keep the author's own words, meaning, tone, names and every fact and clue exactly as they are. Do not add, remove or reorder ideas, and do not make it longer.
Keep lists written like "Rooms: Library, Kitchen, Garden" in that same "Label: item, item" form.
Return only JSON with the same keys as the input (an array stays an array of the same length).
Input:
${JSON.stringify(fields)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }),
  });
  if (!res.ok) return { error: res.status === 429 ? 'Google\'s free limit is used up for now. Try again later, or edit the words by hand.' : 'The AI editor did not answer. Try again.' };
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try { return { polished: cleanPolished(form, JSON.parse(text.replace(/^```(json)?|```$/g, '').trim())) }; } catch (e) { return { error: 'The AI reply could not be read. Try again.' }; }
}

// ---------------------------------------------------------------- admin
const LIST_COLUMNS = `s.id, s.kind, s.source, s.theme, s.title, s.pitch, s.credit, s.consent, s.status, s.created_at AS createdAt, s.decided_at AS decidedAt,
  s.decided_by AS decidedBy, s.user_id AS uid, s.email, s.puzzle IS NOT NULL AS hasPuzzle, s.text, p.screen_name AS player`;

function listItem(r) {
  return { ...r, consent: !!r.consent, hasPuzzle: !!r.hasPuzzle, themeName: nameOf(r.theme), text: String(r.text || '').slice(0, 280) };
}

export function storySubmissionRoutes(Refusal) {
  const load = async (env, id) => {
    const row = await env.DB.prepare('SELECT * FROM story_submissions WHERE id = ?1').bind(Number(id)).first();
    if (!row) throw new Refusal(404, 'gone', 'That entry is gone.');
    return { ...row, form: JSON.parse(row.form || '{}'), polished: row.polished ? JSON.parse(row.polished) : null };
  };
  return [
    ['GET', /^story-submissions$/, 'moderator', 'story-submissions.view', async ({ env, url }) => {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
      const kind = KINDS[url.searchParams.get('kind')] ? url.searchParams.get('kind') : '';
      const status = ['new', 'approved', 'declined', 'closed'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '';
      const source = ['form', 'idea box'].includes(url.searchParams.get('source')) ? url.searchParams.get('source') : '';
      const page = Math.max(0, Math.min(1000, Number(url.searchParams.get('page')) || 0));
      // Search words, titles, pitches, credits, theme names, emails and player names.
      const themeIds = q ? THEMES.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).map((t) => t.id) : [];
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const where = `(?1 = '' OR s.text LIKE ?2 ESCAPE '\\' OR s.title LIKE ?2 ESCAPE '\\' OR s.pitch LIKE ?2 ESCAPE '\\' OR s.credit LIKE ?2 ESCAPE '\\'
          OR s.email LIKE ?2 ESCAPE '\\' OR p.screen_name LIKE ?2 ESCAPE '\\' OR CAST(s.id AS TEXT) = ?1 OR s.theme IN (SELECT value FROM json_each(?3)))
        AND (?4 = '' OR s.kind = ?4) AND (?5 = '' OR s.status = ?5) AND (?6 = '' OR s.source = ?6)`;
      const binds = [q, like, JSON.stringify(themeIds), kind, status, source];
      const from = 'FROM story_submissions s LEFT JOIN players p ON p.user_id = s.user_id';
      const [{ results }, total, counts] = await Promise.all([
        env.DB.prepare(`SELECT ${LIST_COLUMNS} ${from} WHERE ${where} ORDER BY s.created_at DESC LIMIT ${PER_PAGE} OFFSET ${page * PER_PAGE}`).bind(...binds).all(),
        env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).bind(...binds).first(),
        env.DB.prepare('SELECT status, COUNT(*) AS n FROM story_submissions GROUP BY status').all(),
      ]);
      return { body: { items: results.map(listItem), total: total.n, page, perPage: PER_PAGE, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])) }, quiet: true };
    }],
    ['GET', /^story-submissions\/(\d+)$/, 'moderator', 'story-submissions.open', async ({ env, params: [id] }) => {
      const s = await load(env, id);
      const player = s.user_id ? await env.DB.prepare('SELECT screen_name AS name FROM players WHERE user_id = ?1').bind(s.user_id).first() : null;
      const { results: emails } = await env.DB.prepare(`SELECT kind, status, created_at AS at, sent_at AS sentAt FROM feedback_replies
        WHERE submission_id = ?1 OR (feedback_id = ?2 AND ?2 IS NOT NULL) ORDER BY created_at`).bind(s.id, s.feedback_id).all();
      const puzzle = s.puzzle ? JSON.parse(s.puzzle) : null;
      return {
        body: {
          id: s.id, kind: s.kind, source: s.source, status: s.status, theme: s.theme, themeName: nameOf(s.theme), title: s.title, pitch: s.pitch, credit: s.credit,
          consent: !!s.consent, consentText: s.consent_text, form: s.form, polished: s.polished, polishable: polishable(s.form), copy: formCopy(s.form, nameOf),
          text: s.text, uid: s.user_id, player: player?.name || null, email: s.email, platform: s.platform, version: s.version,
          createdAt: s.created_at, decidedAt: s.decided_at, decidedBy: s.decided_by, emails,
          puzzle: puzzle ? { title: puzzle.title, tier: puzzle.tier || puzzle.difficulty, at: s.puzzle_at, value: puzzle } : null,
        },
        quiet: true,
      };
    }],
    ['POST', /^story-submissions\/(\d+)\/polish$/, 'moderator', 'story-submissions.polish', async ({ env, params: [id], body }) => {
      const s = await load(env, id);
      let polished;
      if (body.polished) polished = cleanPolished(s.form, body.polished);
      else {
        const r = await polishWithAi(env, (await getSettings(env)).story_model, s.form);
        if (r.error) throw new Refusal(503, 'ai', r.error);
        polished = r.polished;
      }
      await env.DB.prepare('UPDATE story_submissions SET polished = ?1 WHERE id = ?2').bind(JSON.stringify(polished), s.id).run();
      return { body: { ok: true, polished }, target: id, detail: { manual: !!body.polished } };
    }],
    ['POST', /^story-submissions\/(\d+)\/approve$/, 'moderator', 'story-submissions.approve', async ({ env, params: [id], body, who, now }) => {
      const s = await load(env, id);
      if (s.status === 'approved') throw new Refusal(409, 'already', 'This entry is already approved.');
      let polished = s.polished;
      if (body.polished) polished = cleanPolished(s.form, body.polished);
      // The puzzle uses corrected words: fixed now if nobody has yet (the original stays as sent).
      if (!polished && s.kind === 'storyline') {
        try { const r = await polishWithAi(env, (await getSettings(env)).story_model, s.form); if (r.polished) polished = r.polished; } catch (e) { console.error(e); }
      }
      await env.DB.prepare("UPDATE story_submissions SET status = 'approved', decided_at = ?1, decided_by = ?2, polished = ?3 WHERE id = ?4")
        .bind(now, who.actor, polished ? JSON.stringify(polished) : null, s.id).run();
      let emailed = 0;
      if (s.feedback_id) {
        // From Share an idea: the same path as Approve in Communication.
        await env.DB.prepare("UPDATE feedback SET status = 'addressed', note = ?1, done_at = ?2 WHERE id = ?3 AND status = 'new'")
          .bind('Approved in Storyline submissions.', now, s.feedback_id).run();
        const held = s.kind === 'storyline' ? await heldStoryline(env, s.feedback_id) : null;
        emailed = held ? await approveStoryline(env, held.id) : 0;
        if (!held && s.kind === 'storyline' && !s.puzzle) await queueSubmissionMail(env, { kind: 'story_build', submissionId: s.id, now });
      } else if (s.kind === 'storyline') {
        const kind = s.email ? 'story_approved' : 'story_build';
        emailed = (await queueSubmissionMail(env, { kind, submissionId: s.id, email: s.email, userId: s.user_id, now, cap: false })) && s.email ? 1 : 0;
      } else if (s.email) {
        emailed = (await queueSubmissionMail(env, { kind: 'submission_approved', submissionId: s.id, email: s.email, userId: s.user_id, now, cap: false })) ? 1 : 0;
      }
      return { body: { ok: true, emailed }, target: id, detail: { kind: s.kind, emailed } };
    }],
    ['POST', /^story-submissions\/(\d+)\/decline$/, 'moderator', 'story-submissions.decline', async ({ env, params: [id], who, now }) => {
      const s = await load(env, id);
      if (s.status === 'declined') throw new Refusal(409, 'already', 'This entry is already declined.');
      await env.DB.prepare("UPDATE story_submissions SET status = 'declined', decided_at = ?1, decided_by = ?2 WHERE id = ?3").bind(now, who.actor, s.id).run();
      let emailed = 0;
      if (s.feedback_id) {
        await env.DB.prepare("UPDATE feedback SET status = 'done', declined = 1, note = NULL, done_at = ?1 WHERE id = ?2 AND status = 'new'").bind(now, s.feedback_id).run();
        emailed = s.kind === 'storyline' ? await declineStoryline(env, s.feedback_id) : 0;
        if (!emailed) await dropUpdate(env, s.feedback_id, { thank: true });
      } else if (s.email) {
        emailed = (await queueSubmissionMail(env, { kind: 'story_declined', submissionId: s.id, email: s.email, userId: s.user_id, now })) ? 1 : 0;
      }
      return { body: { ok: true, emailed }, target: id, detail: { emailed } };
    }],
    ['POST', /^story-submissions\/(\d+)\/email$/, 'moderator', 'story-submissions.email', async ({ env, params: [id], body, now }) => {
      const s = await load(env, id);
      const to = cleanEmail(body.to);
      if (!to) throw new Refusal(400, 'bad_email', 'Enter a valid email address.');
      if (!(await queueSubmissionMail(env, { kind: 'submission_copy', submissionId: s.id, email: to, now }))) {
        throw new Refusal(429, 'limit', 'Emails are switched off or today\'s email limit is used up (Settings and switches > Ideas and problems).');
      }
      return { body: { ok: true }, target: id, detail: { emailed: true } };
    }],
    ['POST', /^story-submissions\/(\d+)\/delete$/, 'admin', 'story-submissions.delete', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('DELETE FROM story_submissions WHERE id = ?1').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That entry is gone.');
      await env.DB.prepare("UPDATE feedback_replies SET status = 'dropped', email = NULL, user_id = NULL WHERE submission_id = ?1 AND status IN ('waiting', 'held')").bind(Number(id)).run();
      return { body: { ok: true }, target: id };
    }],
  ];
}

// For the Communication page's Approve and Disapprove (admin.js): keeps a
// Share an idea storyline's entry in step.
export async function syncIdeaBoxDecision(env, feedbackId, status, actor, now = Date.now()) {
  await env.DB.prepare("UPDATE story_submissions SET status = ?1, decided_at = ?2, decided_by = ?3 WHERE feedback_id = ?4 AND status = 'new'")
    .bind(status, now, actor, Number(feedbackId)).run();
}

// For the sender (replies.js claimReplies): the entry an email is about.
export function submissionForMail(row) {
  if (!row || !row.form) return null;
  const form = JSON.parse(row.form);
  return {
    kind: row.kind, title: row.title || form.title || form.idea || '', credit: row.credit || form.credit || '',
    copy: formCopy(form, nameOf), form, polished: row.polished ? JSON.parse(row.polished) : null, theme: nameOf(row.theme),
  };
}
