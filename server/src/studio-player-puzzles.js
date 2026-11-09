// Player puzzles in Book Studio (book-studio/src/playerpuzzles.js): every
// approved player puzzle (Puzzle Wizard puzzles and storylines from the
// Storyline Submission Database, story_submissions, in the Approved or
// Published section of Grid Admin's Puzzle submissions page), to add to the
// book being made, download or print. Book Studio builds and draws each
// puzzle through the website's Book maker (web/js/book-maker.js), the same
// engine and print layout the game uses.
//
//   GET  /admin/v1/studio/player-puzzles            the approved puzzles, with how many books each has been in
//   POST /admin/v1/studio/player-puzzles/:id/puzzle { puzzle } keep the puzzle Book Studio built from a
//                                                   wizard entry, so every book prints the same puzzle
//
//   POST /admin/v1/studio/player-puzzles/published { book, title, platform, kind, puzzles: [ids] }
//                                                   a book with these player puzzles was exported
//
// Publications: once Book Studio has saved an export with the book's interior
// (the submission packet or the interior PDF), it sends the player puzzles in
// the book; recordPublication() keeps one row per puzzle and book in
// submission_publications. Exporting the same book again does not count again,
// so a puzzle's count is the number of different books it has been published in.
import { formOf } from './story-submissions.js';

export const PLAYER_KINDS = ['puzzle', 'storyline'];
export const PLAYER_STAGES = ['approved', 'published'];
const MAX_PUZZLE = 400_000;

// The credit printed under a player's puzzle: their screen name, or the name
// they chose when they have none. Nothing for a player who chose to stay anonymous.
export function creditOf(row) {
  if (!String(row.credit || '').trim()) return '';
  return String(row.player || row.credit || '').trim().slice(0, 60);
}

function itemOf(r) {
  const form = formOf(r);
  let puzzle = null;
  try { puzzle = r.puzzle ? JSON.parse(r.puzzle) : null; } catch (e) { puzzle = null; }
  const wizard = r.kind === 'puzzle';
  const game = wizard ? (form.game === 'ninetimesnine' ? 'ninetimesnine' : 'fantastical') : 'fantastical';
  return {
    id: r.id, kind: r.kind, status: r.status, game,
    title: r.title || form.title || puzzle?.title || `Puzzle #${r.id}`,
    level: wizard ? (game === 'ninetimesnine' ? form.level || '' : form.difficulty || '') : puzzle?.difficulty?.id || '',
    player: r.player || '', credit: creditOf(r), anonymous: !String(r.credit || '').trim(),
    // A wizard puzzle is rebuilt from the author's entry and seed (the same
    // puzzle they made) until Book Studio keeps the one it built.
    entry: wizard && !puzzle ? form : null, seed: wizard ? form.seed || `sub-${r.id}` : null,
    puzzle, approvedAt: r.decidedAt || r.createdAt, publishedAt: r.publishedAt || null,
    books: r.books || 0, exports: r.exports || 0, lastBookAt: r.lastBookAt || null,
  };
}

// Records the player puzzles in an exported book. ids: the submission ids
// found in the book; book: its id (or title). Returns how many were counted
// for the first time in this book.
export async function recordPublication(env, { ids, book, title, platform, by, now = Date.now() }) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  const key = String(book || '').trim().slice(0, 200);
  if (!list.length || !key) return 0;
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM submission_publications WHERE book = ?1').bind(key).first();
  await env.DB.batch(list.map((id) => env.DB.prepare(`INSERT INTO submission_publications (submission_id, book, title, platform, by_email, first_at, last_at, exports)
      SELECT id, ?2, ?3, ?4, ?5, ?6, ?6, 1 FROM story_submissions WHERE id = ?1 AND kind IN ('puzzle', 'storyline')
      ON CONFLICT (submission_id, book) DO UPDATE SET title = excluded.title, platform = excluded.platform, last_at = excluded.last_at, exports = exports + 1`)
    .bind(id, key, String(title || '').slice(0, 200), String(platform || '').slice(0, 60), String(by || '').slice(0, 200), now)));
  const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM submission_publications WHERE book = ?1').bind(key).first();
  return after.n - before.n;
}

export function playerPuzzleRoutes(Refusal, canPublish) {
  const mayPublish = (who) => {
    if (!canPublish(who)) throw new Refusal(403, 'no_publishing', 'This account does not have publishing access. Ask the owner to switch it on under Admins.');
  };
  return [
    ['GET', /^studio\/player-puzzles$/, 'publisher', 'studio.player-puzzles', async ({ env, who }) => {
      mayPublish(who);
      const { results } = await env.DB.prepare(`SELECT s.id, s.kind, s.status, s.title, s.credit, s.form, s.current, s.puzzle, s.created_at AS createdAt,
          s.decided_at AS decidedAt, s.published_at AS publishedAt, p.screen_name AS player,
          (SELECT COUNT(*) FROM submission_publications u WHERE u.submission_id = s.id) AS books,
          (SELECT SUM(exports) FROM submission_publications u WHERE u.submission_id = s.id) AS exports,
          (SELECT MAX(last_at) FROM submission_publications u WHERE u.submission_id = s.id) AS lastBookAt
        FROM story_submissions s LEFT JOIN players p ON p.user_id = s.user_id
        WHERE s.kind IN ('puzzle', 'storyline') AND s.status IN ('approved', 'published')
        ORDER BY COALESCE(s.decided_at, s.created_at) DESC LIMIT 1000`).all();
      const items = results.map(itemOf);
      return {
        body: {
          // Storylines whose puzzle is not built yet are listed too, so the team knows they are there.
          items, siteUrl: String(env.SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, ''),
        },
        quiet: true,
      };
    }],
    ['POST', /^studio\/player-puzzles\/published$/, 'publisher', 'studio.player-puzzles.published', async ({ env, who, body, now }) => {
      mayPublish(who);
      if (!['packet', 'interior'].includes(body.kind)) throw new Refusal(400, 'not_interior', 'Only an export with the interior counts as a publication.');
      const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
      const title = str(body.title, 200) || 'Untitled';
      const ids = Array.isArray(body.puzzles) ? body.puzzles : [];
      const counted = await recordPublication(env, { ids, book: str(body.book, 200) || title, title, platform: str(body.platform, 60), by: who.actor, now });
      return { body: { ok: true, counted }, target: title, detail: { puzzles: ids.length, counted, kind: body.kind } };
    }],
    ['POST', /^studio\/player-puzzles\/(\d+)\/puzzle$/, 'publisher', 'studio.player-puzzle.keep', async ({ env, who, params: [id], body, now }) => {
      mayPublish(who);
      const p = body.puzzle;
      if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.title !== 'string') throw new Refusal(400, 'bad_puzzle', 'That is not a puzzle.');
      const text = JSON.stringify(p);
      if (text.length > MAX_PUZZLE) throw new Refusal(413, 'too_large', 'That puzzle is too big to keep.');
      // Only a wizard puzzle with none kept yet: a saved puzzle is never replaced.
      const r = await env.DB.prepare(`UPDATE story_submissions SET puzzle = ?2, puzzle_at = ?3
        WHERE id = ?1 AND kind = 'puzzle' AND puzzle IS NULL AND status IN ('approved', 'published')`).bind(Number(id), text, now).run();
      return { body: { ok: true, kept: !!r.meta?.changes }, target: String(id), quiet: !r.meta?.changes };
    }, { maxBody: MAX_PUZZLE + 10_000 }],
  ];
}
