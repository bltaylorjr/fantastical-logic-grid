// Books for publishing (admin > Books, admin/books.js): puzzle books made from
// every game, ready for a print-on-demand service, with their covers.
//
//   GET  /admin/v1/books                 every book, saved cover templates, how many puzzles are used
//   GET  /admin/v1/books/used            every puzzle fingerprint and story already in a book (never reused)
//   GET  /admin/v1/books/:id             one book with its puzzles
//   POST /admin/v1/books                 save a draft { id?, title, ..., settings, cover, css, puzzles: [{ fp, game, title, story, scan, content }] }
//                                        (content: the printed pages, so the book prints the same again)
//   POST /admin/v1/books/:id/publish     mark it published: its puzzles stay taken for good
//   POST /admin/v1/books/:id/delete      delete a draft (its puzzles are free again)
//   POST /admin/v1/books/scan            { items: [{ fp, title, text }] } the trademark and copyright watch list
//   POST /admin/v1/book-templates        save a cover design as a template { name, design }
//   POST /admin/v1/book-templates/:id/delete
import { watchListFindings } from './ip-scan.js';

export const TRIMS = ['6x9', '7x10', '8x10', '8.25x11', '8.5x11'];
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const json = (v, max) => { const s = JSON.stringify(v ?? {}); if (s.length > max) throw new Error('too_big'); return s; };
const newId = (now) => `bk-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const FP = /^[\w:.-]{3,120}$/;

const bookRow = (r) => ({
  id: r.id, title: r.title, subtitle: r.subtitle, volume: r.volume, edition: r.edition, author: r.author, trim: r.trim, paper: r.paper,
  pages: r.pages, status: r.status, settings: JSON.parse(r.settings || '{}'), cover: JSON.parse(r.cover || '{}'),
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, puzzles: r.puzzles ?? undefined,
});

export function checkBook(body) {
  const title = clean(body.title, 120);
  if (title.length < 2) return { error: 'Give the book a title.' };
  const trim = TRIMS.includes(body.trim) ? body.trim : null;
  if (!trim) return { error: 'Choose a trim size.' };
  const puzzles = Array.isArray(body.puzzles) ? body.puzzles : [];
  if (puzzles.length > 1000) return { error: 'A book can hold up to 1,000 puzzles.' };
  const seen = new Set();
  const list = [];
  for (const p of puzzles) {
    const fp = String(p?.fp || '');
    if (!FP.test(fp)) return { error: 'One of the puzzles has no proper fingerprint. Make the puzzles again.' };
    if (seen.has(fp)) return { error: 'The same puzzle is in the book twice.' };
    seen.add(fp);
    const content = JSON.stringify(p.content && typeof p.content === 'object' ? p.content : {});
    if (content.length > 120_000) return { error: `Puzzle "${clean(p.title, 60)}" is too big to save.` };
    list.push({ fp, game: clean(p.game, 12), title: clean(p.title, 120), story: clean(p.story, 120), scan: p.scan === 'check' ? 'check' : 'clear', content });
  }
  let settings, cover, css;
  try { settings = json(body.settings, 20_000); cover = json(body.cover, 40_000); css = json(body.css, 400_000); } catch (e) { return { error: 'The book settings or cover are too big to save.' }; }
  return {
    value: {
      title, subtitle: clean(body.subtitle, 160), volume: Math.max(1, Math.min(999, Number(body.volume) || 1)), edition: Math.max(1, Math.min(99, Number(body.edition) || 1)),
      author: clean(body.author, 120), trim, paper: body.paper === 'cream' ? 'cream' : 'white', pages: Math.max(0, Math.min(2000, Number(body.pages) || 0)),
      settings, cover, css, puzzles: list,
    },
  };
}

async function booksView(env) {
  const { results } = await env.DB.prepare(`SELECT b.id, b.title, b.subtitle, b.volume, b.edition, b.author, b.trim, b.paper, b.pages, b.status, b.settings, b.cover, b.created_by, b.created_at, b.updated_at, b.published_at, (SELECT COUNT(*) FROM book_puzzles p WHERE p.book_id = b.id) AS puzzles FROM books b ORDER BY b.updated_at DESC`).all();
  const t = await env.DB.prepare('SELECT * FROM book_templates ORDER BY name').all();
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_puzzles').first();
  return {
    books: results.map(bookRow),
    templates: t.results.map((r) => ({ id: r.id, name: r.name, design: JSON.parse(r.design || '{}'), createdBy: r.created_by, createdAt: r.created_at })),
    used: used?.n || 0, trims: TRIMS,
    // The website's Book maker page (web/book-maker/) makes and prints the pages.
    siteUrl: String(env.SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, ''),
  };
}

export function bookRoutes(Refusal) {
  const getBook = async (env, id) => {
    const r = await env.DB.prepare('SELECT * FROM books WHERE id = ?1').bind(id).first();
    if (!r) throw new Refusal(404, 'gone', 'That book is gone.');
    return r;
  };
  return [
    ['GET', /^books$/, 'viewer', 'books.view', async ({ env }) => ({ body: await booksView(env), quiet: true })],
    ['GET', /^books\/used$/, 'viewer', 'books.used', async ({ env }) => {
      const { results } = await env.DB.prepare('SELECT fp, story, book_id FROM book_puzzles').all();
      return { body: { used: results.map((r) => ({ fp: r.fp, story: r.story, book: r.book_id })) }, quiet: true };
    }],
    ['GET', /^books\/(bk-[\w-]{1,40})$/, 'viewer', 'books.one', async ({ env, params: [id] }) => {
      const r = await getBook(env, id);
      const { results } = await env.DB.prepare('SELECT fp, game, title, story, position, scan, content FROM book_puzzles WHERE book_id = ?1 ORDER BY position').bind(id).all();
      return { body: { book: { ...bookRow(r), css: JSON.parse(r.css || '{}'), puzzles: results.map(({ content, ...x }) => ({ ...x, content: JSON.parse(content || '{}') })) } }, quiet: true };
    }],
    ['POST', /^books$/, 'admin', 'books.save', async ({ env, body, who, now }) => {
      const c = checkBook(body || {});
      if (c.error) throw new Refusal(400, 'bad_book', c.error);
      const v = c.value;
      let id = typeof body.id === 'string' && /^bk-[\w-]{1,40}$/.test(body.id) ? body.id : null;
      if (id) {
        const old = await getBook(env, id);
        if (old.status === 'published') throw new Refusal(400, 'locked', 'A published book cannot change. Make a new edition instead.');
      }
      // No puzzle may already be in another book.
      if (v.puzzles.length) {
        const taken = [];
        for (let i = 0; i < v.puzzles.length; i += 80) {
          const part = v.puzzles.slice(i, i + 80);
          const { results } = await env.DB.prepare(`SELECT fp, book_id FROM book_puzzles WHERE fp IN (${part.map((_, k) => `?${k + 1}`).join(',')})`).bind(...part.map((p) => p.fp)).all();
          taken.push(...results.filter((r) => r.book_id !== id));
        }
        if (taken.length) throw new Refusal(409, 'puzzle_used', `${taken.length === 1 ? 'One puzzle is' : `${taken.length} puzzles are`} already in another book. Make new puzzles for ${taken.length === 1 ? 'it' : 'them'}.`);
      }
      const stmts = [];
      if (id) {
        stmts.push(env.DB.prepare(`UPDATE books SET title = ?2, subtitle = ?3, volume = ?4, edition = ?5, author = ?6, trim = ?7, paper = ?8, pages = ?9, settings = ?10, cover = ?11, css = ?13, updated_at = ?12 WHERE id = ?1`)
          .bind(id, v.title, v.subtitle, v.volume, v.edition, v.author, v.trim, v.paper, v.pages, v.settings, v.cover, now, v.css));
        stmts.push(env.DB.prepare('DELETE FROM book_puzzles WHERE book_id = ?1').bind(id));
      } else {
        id = newId(now);
        stmts.push(env.DB.prepare(`INSERT INTO books (id, title, subtitle, volume, edition, author, trim, paper, pages, status, settings, cover, css, created_by, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10, ?11, ?14, ?12, ?13, ?13)`).bind(id, v.title, v.subtitle, v.volume, v.edition, v.author, v.trim, v.paper, v.pages, v.settings, v.cover, who.actor, now, v.css));
      }
      v.puzzles.forEach((p, k) => stmts.push(env.DB.prepare('INSERT INTO book_puzzles (fp, book_id, game, title, story, position, scan, content, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
        .bind(p.fp, id, p.game, p.title, p.story, k, p.scan, p.content, now)));
      await env.DB.batch(stmts);
      return { body: { ok: true, id }, target: id, detail: { title: v.title, puzzles: v.puzzles.length } };
    }, { maxBody: 12_000_000 }],
    ['POST', /^books\/(bk-[\w-]{1,40})\/publish$/, 'admin', 'books.publish', async ({ env, params: [id], now }) => {
      const r = await getBook(env, id);
      if (r.status === 'published') return { body: { ok: true } };
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_puzzles WHERE book_id = ?1').bind(id).first();
      if (!n?.n) throw new Refusal(400, 'empty', 'Add puzzles and save the book before publishing it.');
      await env.DB.prepare("UPDATE books SET status = 'published', published_at = ?2, updated_at = ?2 WHERE id = ?1").bind(id, now).run();
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^books\/(bk-[\w-]{1,40})\/delete$/, 'admin', 'books.delete', async ({ env, params: [id] }) => {
      const r = await getBook(env, id);
      if (r.status === 'published') throw new Refusal(400, 'locked', 'A published book stays, so its puzzles are never used again.');
      await env.DB.batch([env.DB.prepare('DELETE FROM book_puzzles WHERE book_id = ?1').bind(id), env.DB.prepare('DELETE FROM books WHERE id = ?1').bind(id)]);
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^books\/scan$/, 'viewer', 'books.scan', async ({ body }) => {
      const items = Array.isArray(body?.items) ? body.items.slice(0, 1000) : [];
      const results = items.map((it) => {
        const findings = watchListFindings([['Title', clean(it.title, 200)], ['Puzzle', String(it.text || '').slice(0, 8000)]]);
        return { fp: String(it.fp || ''), verdict: findings.some((f) => f.serious) ? 'problem' : findings.length ? 'check' : 'clear', findings };
      });
      return { body: { results }, quiet: true };
    }, { maxBody: 4_000_000 }],
    ['POST', /^book-templates$/, 'admin', 'books.template', async ({ env, body, who, now }) => {
      const name = clean(body?.name, 60);
      if (name.length < 2) throw new Refusal(400, 'bad_template', 'Give the template a name.');
      let design;
      try { design = json(body.design, 40_000); } catch (e) { throw new Refusal(400, 'bad_template', 'That design is too big to save.'); }
      const r = await env.DB.prepare('INSERT INTO book_templates (name, design, created_by, created_at) VALUES (?1, ?2, ?3, ?4)').bind(name, design, who.actor, now).run();
      return { body: { ok: true, id: r.meta?.last_row_id ?? null }, target: name };
    }, { maxBody: 60_000 }],
    ['POST', /^book-templates\/(\d+)\/delete$/, 'admin', 'books.template-delete', async ({ env, params: [id] }) => {
      await env.DB.prepare('DELETE FROM book_templates WHERE id = ?1').bind(Number(id)).run();
      return { body: { ok: true }, target: id };
    }],
  ];
}
