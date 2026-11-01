// The books database (admin > Book publishing > Books database). Every print
// book made on the Book publishing page is recorded with each of its puzzles:
//   - so a new book, volume or updated edition never prints a puzzle again
//     (the same story id or the same puzzle fingerprint), and the page can
//     leave used stories out when it makes the next book (GET books/used);
//   - so every puzzle can be scanned for trademark and copyright problems
//     (the watch list in ip-scan.js, a list of real places and venues, and the
//     AI review when the GEMINI_API_KEY secret is set). A scan is a screening
//     aid, not legal clearance.
//
//   GET  /admin/v1/books              every book, newest first
//   GET  /admin/v1/books/used         story ids and fingerprints already in books
//   GET  /admin/v1/books/:id          one book and its puzzles with their scans
//   POST /admin/v1/books              record a book (refused if it reuses a puzzle of a published book)
//   POST /admin/v1/books/:id          change its status, title, edition, ISBN or notes
//   POST /admin/v1/books/:id/scan     scan every puzzle
//   POST /admin/v1/books/:id/delete   delete a draft
import { getSettings } from './settings.js';
import { watchListFindings, aiFindings } from './ip-scan.js';

export const BOOK_STATUSES = ['draft', 'published', 'retired'];
const MAX_PUZZLES = 400;

// Real buildings, venues and landmarks the puzzle themes can name. Naming a
// real place in a sentence is normally fine, but many of these names are
// registered marks, so they are listed for a person to look at (never a problem
// on their own). Never use their logos or photos on a cover.
const PLACES = [
  'Empire State Building', 'Chrysler Building', 'Space Needle', 'Sydney Opera House', 'Carnegie Hall', 'Royal Albert Hall', 'Madison Square Garden',
  'Lincoln Center', 'Rockefeller Center', 'Hollywood', 'Broadway', 'Golden Gate Bridge', 'Eiffel Tower', 'Burj Khalifa', 'Taipei 101', 'Shard', 'CN Tower',
  'Gateway Arch', 'Willis Tower', 'Sears Tower', 'Palais Garnier', 'La Scala', 'Teatro Colon', 'Metropolitan Opera', 'Wembley', 'Fenway Park', 'Wrigley Field',
  'Disneyland', 'Disney World', 'Universal Studios', 'Smithsonian', 'Louvre', 'Guggenheim', 'Wimbledon', 'Tour de France', 'World Cup', 'Grammy', 'Oscar',
];
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACE_RE = PLACES.map((term) => ({ term, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}(?=$|[^\\p{L}\\p{N}])`, 'iu') }));

// The scan fields of one puzzle, from its stored text.
export function puzzleFields(text) {
  let t = {};
  try { t = JSON.parse(text || '{}'); } catch (e) { t = {}; }
  return [
    ['Title', t.title || ''], ['Story', (t.story || []).join(' ')], ['Clues', (t.clues || []).join(' ')],
    ['Questions', (t.questions || []).join(' ')], ['Names and items', (t.items || []).join(', ')], ['Ending', t.ending || ''],
  ].filter(([, v]) => String(v).trim());
}

export function placeFindings(fields) {
  const out = [];
  const seen = new Set();
  for (const [label, value] of fields) {
    for (const p of PLACE_RE) {
      if (seen.has(p.term) || !p.re.test(value)) continue;
      seen.add(p.term);
      out.push({ type: 'trademark', term: p.term, field: label, source: 'real places list', why: 'A real place or venue whose name may be a registered mark. Naming it is normally fine; do not use its logo or photos.', link: 'https://tmsearch.uspto.gov/', serious: false });
    }
  }
  return out;
}

const verdictOf = (findings) => (findings.some((f) => f.serious) ? 'problem' : findings.length ? 'check' : 'clear');
const worst = (list) => (list.includes('problem') ? 'problem' : list.includes('check') ? 'check' : list.length ? 'clear' : null);

// Every puzzle already recorded, with its book.
async function recorded(env) {
  const { results } = await env.DB.prepare(`SELECT p.book_id AS bookId, p.position, p.story_id AS storyId, p.fingerprint, p.title, b.title AS bookTitle, b.volume, b.edition, b.status
    FROM book_puzzles p JOIN books b ON b.id = p.book_id`).all();
  return results;
}

// Puzzles of `puzzles` already in other books: { blocking (published or retired books), drafts }.
export function reuse(puzzles, rows, selfId = 0) {
  const byStory = new Map();
  const byPrint = new Map();
  for (const r of rows) {
    if (r.bookId === selfId) continue;
    if (!byStory.has(r.storyId)) byStory.set(r.storyId, r);
    if (!byPrint.has(r.fingerprint)) byPrint.set(r.fingerprint, r);
  }
  const blocking = [];
  const drafts = [];
  for (const p of puzzles) {
    const hit = byStory.get(p.storyId) || byPrint.get(p.fingerprint);
    if (!hit) continue;
    const item = { position: p.position, title: p.title, inBook: hit.bookId, bookTitle: [hit.bookTitle, hit.volume, hit.edition].filter(Boolean).join(' · '), bookStatus: hit.status, theirPosition: hit.position };
    (hit.status === 'draft' ? drafts : blocking).push(item);
  }
  return { blocking, drafts };
}

const clean = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function cleanPuzzle(p, i) {
  const storyId = clean(p.storyId, 200);
  const fingerprint = clean(p.fingerprint, 64);
  if (!storyId || !fingerprint) return null;
  return {
    position: Number.isInteger(p.position) ? p.position : i + 1, storyId, fingerprint, title: clean(p.title, 200), theme: clean(p.theme, 40), topic: clean(p.topic, 80),
    tier: clean(p.tier, 20), size: clean(p.size, 20), seed: clean(p.seed, 120), engine: clean(p.engine, 20), text: clean(p.text, 12_000),
  };
}

async function bookById(env, id) {
  return env.DB.prepare(`SELECT id, title, volume, edition, series, status, parent_id AS parentId, isbn, pages, trim, ink, notes, created_by AS createdBy,
    created_at AS createdAt, updated_at AS updatedAt, published_at AS publishedAt, ip_verdict AS ipVerdict, ip_scan_at AS ipScanAt, settings FROM books WHERE id = ?1`).bind(id).first();
}

// Scans every puzzle of a book and stores the results.
export async function scanBook(env, id, now = Date.now()) {
  const { results: puzzles } = await env.DB.prepare('SELECT position, title, text FROM book_puzzles WHERE book_id = ?1 ORDER BY position').bind(id).all();
  const model = (await getSettings(env)).story_model;
  const per = new Map(puzzles.map((p) => [p.position, { findings: [...watchListFindings(puzzleFields(p.text)), ...placeFindings(puzzleFields(p.text))], notes: [] }]));
  // The AI review reads six puzzles at a time.
  const notes = new Set();
  let ai = false;
  for (let i = 0; i < puzzles.length; i += 6) {
    const chunk = puzzles.slice(i, i + 6);
    const fields = chunk.flatMap((p) => puzzleFields(p.text).map(([label, value]) => [`Puzzle ${p.position} ${label}`, value]));
    const r = await aiFindings(env, model, fields, 'logic puzzles (stories, clues and names) for a printed puzzle book');
    if (r.note) { notes.add(r.note.replace('The watch list and copied-entry checks still ran', 'The watch list and real places checks still ran')); if (!r.findings) break; }
    if (r.findings) {
      ai = true;
      for (const f of r.findings) {
        const m = f.field.match(/^Puzzle (\d+) (.+)$/);
        const slot = m && per.get(Number(m[1]));
        if (slot) slot.findings.push({ ...f, field: m[2] });
      }
    }
  }
  const verdicts = [];
  for (const p of puzzles) {
    const slot = per.get(p.position);
    // The same words found twice are shown once, keeping the surer one.
    const seen = new Map();
    for (const f of slot.findings) { const k = f.term.toLowerCase(); const had = seen.get(k); if (!had || (f.serious && !had.serious)) seen.set(k, f); }
    const findings = [...seen.values()];
    const verdict = verdictOf(findings);
    verdicts.push(verdict);
    await env.DB.prepare('UPDATE book_puzzles SET ip_verdict = ?1, ip_scan = ?2, ip_scan_at = ?3 WHERE book_id = ?4 AND position = ?5')
      .bind(verdict, JSON.stringify({ findings, ai, notes: [...notes] }), now, id, p.position).run();
  }
  const bookVerdict = worst(verdicts);
  await env.DB.prepare('UPDATE books SET ip_verdict = ?1, ip_scan_at = ?2, updated_at = ?2 WHERE id = ?3').bind(bookVerdict, now, id).run();
  return { verdict: bookVerdict, ai, notes: [...notes], counts: { clear: verdicts.filter((v) => v === 'clear').length, check: verdicts.filter((v) => v === 'check').length, problem: verdicts.filter((v) => v === 'problem').length } };
}

export function bookRoutes(Refusal) {
  const idOf = (params) => Number(params[0]);
  const must = async (env, id) => {
    const b = await bookById(env, id);
    if (!b) throw new Refusal(404, 'not_found', 'That book is not in the database.');
    return b;
  };
  return [
    ['GET', /^books$/, 'admin', 'books.view', async ({ env }) => {
      const { results } = await env.DB.prepare(`SELECT b.id, b.title, b.volume, b.edition, b.series, b.status, b.parent_id AS parentId, b.isbn, b.pages, b.trim, b.ink,
          b.created_by AS createdBy, b.created_at AS createdAt, b.updated_at AS updatedAt, b.published_at AS publishedAt, b.ip_verdict AS ipVerdict, b.ip_scan_at AS ipScanAt,
          (SELECT COUNT(*) FROM book_puzzles p WHERE p.book_id = b.id) AS puzzles,
          (SELECT COUNT(*) FROM book_puzzles p WHERE p.book_id = b.id AND p.ip_verdict = 'problem') AS problems,
          (SELECT COUNT(*) FROM book_puzzles p WHERE p.book_id = b.id AND p.ip_verdict = 'check') AS checks
        FROM books b ORDER BY b.created_at DESC, b.id DESC LIMIT 500`).all();
      return { body: { books: results, statuses: BOOK_STATUSES }, quiet: true };
    }],
    ['GET', /^books\/used$/, 'admin', 'books.used', async ({ env, url }) => {
      const drafts = url.searchParams.get('drafts') === '1';
      const rows = (await recorded(env)).filter((r) => drafts || r.status !== 'draft');
      return { body: { stories: [...new Set(rows.map((r) => r.storyId))], fingerprints: [...new Set(rows.map((r) => r.fingerprint))], books: new Set(rows.map((r) => r.bookId)).size }, quiet: true };
    }],
    ['GET', /^books\/(\d+)$/, 'admin', 'books.open', async ({ env, params }) => {
      const b = await must(env, idOf(params));
      const { results } = await env.DB.prepare(`SELECT position, story_id AS storyId, fingerprint, title, theme, topic, tier, size, seed, engine, ip_verdict AS ipVerdict, ip_scan AS ipScan, ip_scan_at AS ipScanAt
        FROM book_puzzles WHERE book_id = ?1 ORDER BY position`).bind(b.id).all();
      const puzzles = results.map((r) => ({ ...r, ipScan: r.ipScan ? JSON.parse(r.ipScan) : null }));
      let settings = null;
      try { settings = b.settings ? JSON.parse(b.settings) : null; } catch (e) { settings = null; }
      const later = await env.DB.prepare('SELECT id, title, volume, edition, status FROM books WHERE parent_id = ?1').bind(b.id).all();
      return { body: { book: { ...b, settings: undefined }, settings, puzzles, laterEditions: later.results }, quiet: true };
    }],
    ['POST', /^books$/, 'admin', 'books.add', async ({ env, body, who, now }) => {
      const title = clean(body.title, 200);
      if (!title) throw new Refusal(400, 'title', 'Give the book a title.');
      const list = Array.isArray(body.puzzles) ? body.puzzles.slice(0, MAX_PUZZLES).map(cleanPuzzle) : [];
      if (!list.length || list.some((p) => !p)) throw new Refusal(400, 'puzzles', 'Every puzzle needs its story id and fingerprint. Build the book again.');
      const status = BOOK_STATUSES.includes(body.status) ? body.status : 'draft';
      const parentId = Number.isInteger(body.parentId) ? body.parentId : null;
      if (parentId && !(await bookById(env, parentId))) throw new Refusal(400, 'parent', 'The earlier edition is not in the database.');
      // A puzzle in the book twice is a reuse too.
      const dupes = list.filter((p, i) => list.findIndex((q) => q.storyId === p.storyId || q.fingerprint === p.fingerprint) !== i);
      if (dupes.length) throw new Refusal(409, 'reused', `Puzzle ${dupes[0].position} repeats an earlier puzzle in this book. Build the book again.`);
      const { blocking, drafts } = reuse(list, await recorded(env));
      if (blocking.length) {
        const b = blocking[0];
        throw new Refusal(409, 'reused', `${blocking.length} ${blocking.length === 1 ? 'puzzle is' : 'puzzles are'} already in a published book (for example puzzle ${b.position}, “${b.title}”, is puzzle ${b.theirPosition} of ${b.bookTitle}). Build the book again: used puzzles are left out automatically.`);
      }
      const settings = typeof body.settings === 'object' && body.settings ? JSON.stringify(body.settings).slice(0, 200_000) : null;
      const row = await env.DB.prepare(`INSERT INTO books (title, volume, edition, series, status, parent_id, isbn, pages, trim, ink, settings, notes, created_by, created_at, updated_at, published_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15) RETURNING id`)
        .bind(title, clean(body.volume, 80), clean(body.edition, 80), clean(body.series, 200) || title, status, parentId, clean(body.isbn, 20), Number(body.pages) || null,
          clean(body.trim, 20), clean(body.ink, 20), settings, clean(body.notes, 2000), who.actor, now, status === 'published' ? now : null).first();
      const stmts = list.map((p) => env.DB.prepare(`INSERT INTO book_puzzles (book_id, position, story_id, fingerprint, title, theme, topic, tier, size, seed, engine, text)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`).bind(row.id, p.position, p.storyId, p.fingerprint, p.title, p.theme, p.topic, p.tier, p.size, p.seed, p.engine, p.text));
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      return { body: { id: row.id, draftOverlap: drafts }, target: `book ${row.id}`, detail: { title, puzzles: list.length, status } };
    }, { maxBody: 900_000 }],
    ['POST', /^books\/(\d+)$/, 'admin', 'books.change', async ({ env, params, body, now }) => {
      const b = await must(env, idOf(params));
      const status = body.status === undefined ? b.status : body.status;
      if (!BOOK_STATUSES.includes(status)) throw new Refusal(400, 'status', 'Unknown status.');
      if (status === 'published' && b.status !== 'published') {
        const { results } = await env.DB.prepare('SELECT position, story_id AS storyId, fingerprint, title FROM book_puzzles WHERE book_id = ?1').bind(b.id).all();
        const { blocking } = reuse(results, await recorded(env), b.id);
        if (blocking.length) throw new Refusal(409, 'reused', `${blocking.length} of its puzzles are already in another published book (for example puzzle ${blocking[0].position} is in ${blocking[0].bookTitle}). Make the book again before publishing.`);
      }
      const pick = (k, n) => (body[k] === undefined ? b[k] : clean(body[k], n));
      await env.DB.prepare(`UPDATE books SET status = ?1, title = ?2, volume = ?3, edition = ?4, isbn = ?5, notes = ?6, series = ?7, updated_at = ?8,
          published_at = CASE WHEN ?1 = 'published' AND published_at IS NULL THEN ?8 ELSE published_at END WHERE id = ?9`)
        .bind(status, pick('title', 200) || b.title, pick('volume', 80), pick('edition', 80), pick('isbn', 20), pick('notes', 2000), pick('series', 200) || b.series, now, b.id).run();
      return { body: { ok: true }, target: `book ${b.id}`, detail: { status } };
    }],
    ['POST', /^books\/(\d+)\/scan$/, 'admin', 'books.scan', async ({ env, params, now }) => {
      const b = await must(env, idOf(params));
      return { body: await scanBook(env, b.id, now), target: `book ${b.id}` };
    }],
    ['POST', /^books\/(\d+)\/delete$/, 'admin', 'books.delete', async ({ env, params }) => {
      const b = await must(env, idOf(params));
      if (b.status !== 'draft') throw new Refusal(400, 'not_draft', 'Only drafts can be deleted. Mark a published book Retired instead, so its puzzles stay used.');
      await env.DB.batch([env.DB.prepare('DELETE FROM book_puzzles WHERE book_id = ?1').bind(b.id), env.DB.prepare('DELETE FROM books WHERE id = ?1').bind(b.id)]);
      return { body: { ok: true }, target: `book ${b.id}`, detail: { title: b.title } };
    }],
  ];
}
