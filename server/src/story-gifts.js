// Storyline gifts. A signed-in player who suggests a storyline (Ideas and
// problems > Suggest a storyline) can tick "make me a puzzle from my
// storyline". When the team approves it in the dashboard:
//   1. the AI writer (or the team) turns it into story parts, which join the
//      theme for every player, with the player's screen name as the credit;
//   2. the Story gifts GitHub Action (.github/workflows/story-gifts.yml) makes
//      a puzzle told with exactly those parts, puts it in the player's saved
//      puzzles (account sync) and emails them a thank-you with the puzzle and
//      its answer key as a PDF.
// The team can also credit any storyline to a player by screen name, even one
// sent without the box ticked, with an email address typed in by hand.
//
//   POST /admin/v1/feedback/:id/storyline/draft    { theme } the AI's draft parts
//   POST /admin/v1/feedback/:id/storyline/approve  { theme, parts, difficulty, credit, email, send }
//   POST /admin/v1/gifts/claim                     approved gifts, for the Action (owner)
//   POST /admin/v1/gifts/done                      { gifts: [{ id, ok, save, error }] } (owner)
import { THEMES } from '../../engine/src/themes.js';
import { getTopics } from '../../engine/src/topics.js';
import { checkStoryPart, partKey } from '../../engine/src/story.js';
import { addPart, draftStoryline } from './workshop.js';
import { getSettings } from './settings.js';
import { nameKey } from './names.js';
import { releaseUpdate, dropUpdate } from './replies.js';
import { alert } from './alerts.js';

const DISPATCH_URL = 'https://api.github.com/repos/bltaylorjr/fantastical-logic-grid/actions/workflows/story-gifts.yml/dispatches';
const KINDS = ['openings', 'incidents', 'mishaps', 'endings'];
const FORCE = { openings: 'o', incidents: 'i', mishaps: 'm', endings: 'e' };
const DIFFICULTIES = ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa'];
const ASKS_PER_DAY = 3;
const BUILD_TIMEOUT = 30 * 60_000;
const MAX_TRIES = 3;
const MAX_SAVE_CHARS = 400_000;
export const GIFT_MAX_BODY = 450_000;
const THEME_IDS = new Set(THEMES.map((t) => t.id));
const emailOk = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(e);

export async function kickGifts(env) {
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

// From the idea box: the player asked for a puzzle made from their storyline.
// Returns 'queued', 'unverified' (no confirmed email) or 'limit'.
export async function askGift(env, user, feedbackId, now = Date.now()) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || !user.emailVerified || !emailOk(email)) return 'unverified';
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM story_gifts WHERE user_id = ?1 AND created_at > ?2').bind(user.uid, now - 24 * 3600_000).first();
  if (n >= ASKS_PER_DAY) return 'limit';
  const player = await env.DB.prepare('SELECT screen_name FROM players WHERE user_id = ?1').bind(user.uid).first();
  await env.DB.prepare("INSERT INTO story_gifts (feedback_id, user_id, email, credit, status, created_at) VALUES (?1, ?2, ?3, ?4, 'asked', ?5)")
    .bind(feedbackId, user.uid, email, player?.screen_name || null, now).run();
  return 'queued';
}

// An address the player already gave the game for emails, when the team
// credits a storyline to them by screen name.
async function knownEmail(env, uid) {
  for (const sql of ['SELECT email FROM message_contacts WHERE user_id = ?1', 'SELECT email FROM daily_email WHERE uid = ?1', 'SELECT email FROM puzzle_mail WHERE uid = ?1 LIMIT 1']) {
    try { const r = await env.DB.prepare(sql).bind(uid).first(); if (r?.email) return r.email; } catch (e) { /* table not there */ }
  }
  return null;
}

// What the dashboard shows next to a storyline idea.
export async function giftsFor(env, feedbackIds) {
  if (!feedbackIds.length) return {};
  const { results } = await env.DB.prepare(`SELECT feedback_id AS f, status, credit, error, (email IS NOT NULL) AS hasEmail, sent_at AS sentAt FROM story_gifts
    WHERE feedback_id IN (${feedbackIds.map(() => '?').join(',')}) ORDER BY id`).bind(...feedbackIds).all();
  return Object.fromEntries(results.map((r) => [r.f, { status: r.status, credit: r.credit, error: r.error, hasEmail: !!r.hasEmail, sentAt: r.sentAt }]));
}

function cleanParts(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const inc = p.incidents && typeof p.incidents === 'object' ? p.incidents : {};
  return { openings: s(p.openings), incidents: { name: s(inc.name), text: s(inc.text), prize: s(inc.prize) }, mishaps: s(p.mishaps), endings: s(p.endings) };
}

export function giftRoutes(Refusal) {
  const ideaRow = async (env, id) => {
    const f = await env.DB.prepare('SELECT id, kind, topic, theme, text, status FROM feedback WHERE id = ?1').bind(Number(id)).first();
    if (!f || f.kind !== 'idea') throw new Refusal(404, 'gone', 'That idea is gone.');
    return f;
  };
  return [
    ['POST', /^feedback\/(\d{1,12})\/storyline\/draft$/, 'moderator', 'storyline.draft', async ({ env, params: [id], body }) => {
      const f = await ideaRow(env, id);
      const theme = THEME_IDS.has(body.theme) ? body.theme : f.theme;
      if (!THEME_IDS.has(theme)) throw new Refusal(400, 'bad_theme', 'Choose a theme first.');
      const r = await draftStoryline(env, (await getSettings(env)).story_model, theme, f.text);
      if (r.error) throw new Refusal(502, 'draft', r.error);
      return { body: r, quiet: true };
    }],
    ['POST', /^feedback\/(\d{1,12})\/storyline\/approve$/, 'moderator', 'storyline.approve', async ({ env, ctx, params: [id], body, who, now }) => {
      const f = await ideaRow(env, id);
      const theme = String(body.theme || '');
      if (!THEME_IDS.has(theme)) throw new Refusal(400, 'bad_theme', 'Choose a theme for the storyline.');
      const parts = cleanParts(body.parts);
      const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : 'medium';
      const asked = await env.DB.prepare("SELECT id, user_id, email, credit FROM story_gifts WHERE feedback_id = ?1 AND status IN ('asked', 'failed', 'declined') ORDER BY id DESC LIMIT 1").bind(f.id).first();

      // Who gets the credit (and the puzzle): a screen name typed in, or the player who asked.
      let uid = asked?.user_id || null;
      let credit = asked?.credit || null;
      const typed = String(body.credit || '').trim();
      if (typed) {
        const p = await env.DB.prepare('SELECT user_id, screen_name FROM players WHERE name_key = ?1').bind(nameKey(typed)).first();
        if (!p) throw new Refusal(404, 'no_player', `No player has the screen name "${typed.slice(0, 40)}".`);
        uid = p.user_id;
        credit = p.screen_name;
      }
      if (credit) parts.incidents.by = credit;

      const errors = [];
      for (const k of KINDS) {
        const c = checkStoryPart(k, parts[k]);
        if (!c.ok) errors.push(...c.errors.map((e) => `${k === 'openings' ? 'Opening' : k === 'incidents' ? 'Event' : k === 'mishaps' ? 'Mix-up' : 'Ending'}: ${e}`));
      }
      if (errors.length) throw new Refusal(400, 'bad_parts', errors.join(' '));
      for (const k of KINDS) {
        const r = await addPart(env, theme, k, parts[k], 'admin');
        if (!r.ok) throw new Refusal(400, 'bad_parts', r.errors.join(' '));
      }
      const force = Object.fromEntries(KINDS.map((k) => [FORCE[k], partKey(k, parts[k])]));

      // The gift: saved puzzle always (when there is a player), PDF by email when there is an address.
      let gift = null;
      if (body.send !== false && uid) {
        let email = String(body.email || '').trim().toLowerCase();
        if (email && !emailOk(email)) throw new Refusal(400, 'bad_email', 'That email address does not look right.');
        if (!email && asked && asked.user_id === uid) email = asked.email || '';
        if (!email) email = (await knownEmail(env, uid)) || '';
        const topic = getTopics(theme).find((t) => !t.story)?.id || null;
        const values = [uid, email || null, credit, theme, topic, difficulty, JSON.stringify(parts), JSON.stringify(force), now];
        if (asked) {
          await env.DB.prepare(`UPDATE story_gifts SET user_id = ?1, email = ?2, credit = ?3, theme = ?4, topic = ?5, difficulty = ?6, parts = ?7, force = ?8,
            approved_at = ?9, status = 'approved', tries = 0, error = NULL WHERE id = ?10`).bind(...values, asked.id).run();
        } else {
          await env.DB.prepare(`INSERT INTO story_gifts (feedback_id, user_id, email, credit, theme, topic, difficulty, parts, force, approved_at, status, created_at)
            VALUES (?10, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'approved', ?9)`).bind(...values, f.id).run();
        }
        gift = { email: !!email, credit };
        ctx?.waitUntil?.(kickGifts(env));
      }

      // The idea is done. A player getting the gift email hears it there, not twice.
      const note = `Your storyline was added to the ${THEMES.find((t) => t.id === theme).name} theme${credit ? `, credited to ${credit}` : ''}.`;
      await env.DB.prepare("UPDATE feedback SET status = 'addressed', note = ?1, done_at = ?2, theme = COALESCE(theme, ?3) WHERE id = ?4").bind(note, now, theme, f.id).run();
      if (gift && gift.email) await dropUpdate(env, f.id);
      else await releaseUpdate(env, f.id, note);
      return { body: { ok: true, gift }, target: String(f.id), detail: { theme, credit, gift: !!gift, by: who.actor } };
    }],
    ['POST', /^feedback\/(\d{1,12})\/storyline\/decline$/, 'moderator', 'storyline.decline', async ({ env, params: [id] }) => {
      await env.DB.prepare("UPDATE story_gifts SET status = 'declined', email = NULL WHERE feedback_id = ?1 AND status = 'asked'").bind(Number(id)).run();
      return { body: { ok: true }, target: id };
    }],
    // ---- for the Story gifts Action
    ['POST', /^gifts\/claim$/, 'owner', 'gifts.claim', async ({ env, now }) => {
      const db = env.DB;
      await db.batch([
        db.prepare("UPDATE story_gifts SET status = 'failed', email = NULL WHERE status = 'building' AND claimed_at < ?1 AND tries >= ?2").bind(now - BUILD_TIMEOUT, MAX_TRIES),
        db.prepare("UPDATE story_gifts SET status = 'approved' WHERE status = 'building' AND claimed_at < ?1").bind(now - BUILD_TIMEOUT),
      ]);
      const { results } = await db.prepare("SELECT id, email, credit, theme, topic, difficulty, parts, force, (user_id IS NOT NULL) AS hasPlayer FROM story_gifts WHERE status = 'approved' ORDER BY approved_at LIMIT 5").all();
      if (results.length) await db.batch(results.map((g) => db.prepare("UPDATE story_gifts SET status = 'building', claimed_at = ?1, tries = tries + 1 WHERE id = ?2 AND status = 'approved'").bind(now, g.id)));
      return {
        body: { gifts: results.map((g) => ({ ...g, hasPlayer: !!g.hasPlayer, parts: JSON.parse(g.parts), force: JSON.parse(g.force) })) },
        quiet: !results.length,
        detail: { claimed: results.length },
      };
    }],
    ['POST', /^gifts\/done$/, 'owner', 'gifts.done', async ({ env, ctx, body, now }) => {
      const db = env.DB;
      let sent = 0, failed = 0;
      for (const g of (Array.isArray(body.gifts) ? body.gifts : []).slice(0, 10)) {
        const id = Number(g?.id);
        if (!Number.isInteger(id)) continue;
        const row = await db.prepare("SELECT id, user_id, tries, credit FROM story_gifts WHERE id = ?1 AND status = 'building'").bind(id).first();
        if (!row) continue;
        let saveKey = null;
        if (g.ok && row.user_id && typeof g.save === 'string') {
          let save = null;
          try { save = g.save.length <= MAX_SAVE_CHARS ? JSON.parse(g.save) : null; } catch (e) { save = null; }
          if (save && typeof save.id === 'string' && save.id.length <= 100 && save.puzzle && typeof save.puzzle === 'object') {
            saveKey = save.id;
            // Into the player's saved puzzles: the game picks it up on its next sync.
            await db.prepare('INSERT OR IGNORE INTO sync_users (user_id, rev, created_at) VALUES (?1, 0, ?2)').bind(row.user_id, now).run();
            await db.batch([
              db.prepare('UPDATE sync_users SET rev = rev + 1 WHERE user_id = ?1').bind(row.user_id),
              db.prepare(`INSERT INTO sync_records (user_id, kind, key, data, deleted, updated_at, rev) VALUES (?1, 'save', ?2, ?3, 0, ?4, (SELECT rev FROM sync_users WHERE user_id = ?1))
                ON CONFLICT (user_id, kind, key) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at, rev = excluded.rev`).bind(row.user_id, saveKey, g.save, now),
            ]);
          } else g.ok = false, g.error = g.error || 'The saved puzzle was not right.';
        }
        if (g.ok) {
          await db.prepare("UPDATE story_gifts SET status = 'sent', sent_at = ?2, email = NULL, error = NULL, save_key = ?3 WHERE id = ?1").bind(id, now, saveKey).run();
          sent++;
        } else {
          const last = row.tries >= MAX_TRIES;
          await db.prepare("UPDATE story_gifts SET status = ?2, error = ?3, email = CASE WHEN ?2 = 'failed' THEN NULL ELSE email END WHERE id = ?1")
            .bind(id, last ? 'failed' : 'approved', String(g.error || 'Build problem').slice(0, 200)).run();
          failed++;
          if (last) await alert(env, ctx, { category: 'problems', title: 'A storyline gift could not be sent', body: `The puzzle for ${row.credit || 'a player'} failed three times: ${String(g.error || '').slice(0, 120)}`, link: 'communication' });
        }
      }
      return { body: { sent, failed }, detail: { sent, failed } };
    }],
  ];
}
