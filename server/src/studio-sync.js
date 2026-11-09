// Book Studio sync (admin/book-studio/, book-studio/src/sync.js): every book a
// publisher works on is kept on their account, so it opens on any computer,
// phone or the Book Studio app. Books belong to the signed-in email and only
// that account sees them. A book can carry pictures, so it is stored in parts
// of PART_CHARS characters (D1 keeps a value up to 2 MB).
//
//   GET  /admin/v1/studio/books              this account's books (no content)
//   GET  /admin/v1/studio/books/:id          one book, with its content
//   POST /admin/v1/studio/books/:id          { project, baseRev, device } save it;
//                                            409 "changed" when another device saved a newer version first
//   POST /admin/v1/studio/books/:id/delete   remove it from the account
//
// Each save raises the book's rev. The page sends the rev it started from
// (baseRev), so a save never silently replaces work from another device: the
// page keeps its own version as a copy instead.
export const STUDIO_MAX_BOOK = 15_000_000; // characters of one book's JSON
export const STUDIO_MAX_TOTAL = 300_000_000; // characters on one account
export const STUDIO_MAX_BOOKS = 200;
const PART_CHARS = 900_000;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const meta = (r) => ({ id: r.id, title: r.title || 'Untitled', rev: r.rev, size: r.size, updatedAt: r.updated_at, device: r.device || '' });

export function studioRoutes(Refusal, canPublish) {
  const mayPublish = (who) => {
    if (!canPublish(who)) throw new Refusal(403, 'no_publishing', 'This account does not have publishing access. Ask the owner to switch it on under Admins.');
  };
  const one = (env, owner, id) => env.DB.prepare('SELECT id, title, rev, size, parts, updated_at, device FROM studio_books WHERE owner = ?1 AND id = ?2').bind(owner, id).first();
  return [
    ['GET', /^studio\/books$/, 'publisher', 'studio.books', async ({ env, who }) => {
      mayPublish(who);
      const { results } = await env.DB.prepare('SELECT id, title, rev, size, updated_at, device FROM studio_books WHERE owner = ?1 ORDER BY updated_at DESC').bind(who.actor).all();
      return { body: { books: results.map(meta), limits: { book: STUDIO_MAX_BOOK, total: STUDIO_MAX_TOTAL, books: STUDIO_MAX_BOOKS } }, quiet: true };
    }],
    ['GET', /^studio\/books\/(bs-[\w-]{6,40})$/, 'publisher', 'studio.book', async ({ env, who, params: [id] }) => {
      mayPublish(who);
      const row = await one(env, who.actor, id);
      if (!row) throw new Refusal(404, 'gone', 'That book is not on your account any more.');
      const { results } = await env.DB.prepare('SELECT data FROM studio_book_parts WHERE owner = ?1 AND id = ?2 ORDER BY idx').bind(who.actor, id).all();
      let project;
      try { project = JSON.parse(results.map((p) => p.data).join('')); } catch (e) { throw new Refusal(500, 'damaged', 'That book could not be read. Open a project file instead.'); }
      return { body: { book: meta(row), project }, quiet: true };
    }],
    ['POST', /^studio\/books\/(bs-[\w-]{6,40})$/, 'publisher', 'studio.save', async ({ env, who, params: [id], body, now }) => {
      mayPublish(who);
      const project = body.project;
      if (!project || typeof project !== 'object' || Array.isArray(project) || !Array.isArray(project.pages)) throw new Refusal(400, 'bad_book', 'That is not a Book Studio book.');
      const text = JSON.stringify(project);
      if (text.length > STUDIO_MAX_BOOK) throw new Refusal(413, 'too_large', 'This book is too big to sync (over 15 MB, usually from large pictures). Save a project file to keep it.');
      const old = await one(env, who.actor, id);
      const baseRev = Number(body.baseRev) || 0;
      if (old && old.rev !== baseRev) throw new Refusal(409, 'changed', 'This book was saved from another device after you opened it here.');
      const totals = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM studio_books WHERE owner = ?1 AND id != ?2').bind(who.actor, id).first();
      if (!old && totals.n >= STUDIO_MAX_BOOKS) throw new Refusal(413, 'too_many', `Your account already has ${STUDIO_MAX_BOOKS} books. Delete some under Project to sync more.`);
      if (totals.size + text.length > STUDIO_MAX_TOTAL) throw new Refusal(413, 'account_full', 'Your account is full (300 MB of books). Delete some books under Project to sync more.');
      const rev = (old?.rev || 0) + 1;
      const title = str(project.meta?.title, 200) || 'Untitled';
      const device = str(body.device, 60);
      const parts = [];
      for (let i = 0; i < text.length; i += PART_CHARS) parts.push(text.slice(i, i + PART_CHARS));
      // One batch is one transaction: the book and all its parts change together.
      // The rev check is inside it, and the parts are written only under this
      // save's own token, so two saves at once cannot both win or mix.
      const token = crypto.randomUUID();
      const owned = '(SELECT token FROM studio_books WHERE owner = ?1 AND id = ?2) = ?3';
      const res = await env.DB.batch([
        old
          ? env.DB.prepare('UPDATE studio_books SET title = ?3, rev = ?4, size = ?5, parts = ?6, updated_at = ?7, device = ?8, token = ?9 WHERE owner = ?1 AND id = ?2 AND rev = ?10')
            .bind(who.actor, id, title, rev, text.length, parts.length, now, device, token, old.rev)
          : env.DB.prepare('INSERT INTO studio_books (owner, id, title, rev, size, parts, updated_at, device, token) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT (owner, id) DO NOTHING')
            .bind(who.actor, id, title, rev, text.length, parts.length, now, device, token),
        env.DB.prepare(`DELETE FROM studio_book_parts WHERE owner = ?1 AND id = ?2 AND ${owned}`).bind(who.actor, id, token),
        ...parts.map((data, idx) => env.DB.prepare(`INSERT INTO studio_book_parts (owner, id, idx, data) SELECT ?1, ?2, ?4, ?5 WHERE ${owned}`).bind(who.actor, id, token, idx, data)),
      ]);
      if (!res[0].meta.changes) {
        throw new Refusal(409, 'changed', 'This book was saved from another device after you opened it here.');
      }
      return { body: { book: { id, title, rev, size: text.length, updatedAt: now, device } }, quiet: true };
    }, { maxBody: STUDIO_MAX_BOOK + 20_000 }],
    ['POST', /^studio\/books\/(bs-[\w-]{6,40})\/delete$/, 'publisher', 'studio.delete', async ({ env, who, params: [id] }) => {
      mayPublish(who);
      const row = await one(env, who.actor, id);
      if (!row) return { body: { ok: true }, quiet: true };
      await env.DB.batch([
        env.DB.prepare('DELETE FROM studio_book_parts WHERE owner = ?1 AND id = ?2').bind(who.actor, id),
        env.DB.prepare('DELETE FROM studio_books WHERE owner = ?1 AND id = ?2').bind(who.actor, id),
      ]);
      return { body: { ok: true }, target: row.title || 'Untitled', detail: { id } };
    }],
  ];
}

