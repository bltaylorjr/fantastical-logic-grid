// Amazon KDP (admin > Amazon KDP, admin/kdp.js): each book's KDP listing
// (details, AI answers, print and price), where it is on KDP, and what it sold.
// KDP has no API for any of this, so the page keeps what you type into KDP and
// what its reports say, checks it against KDP's rules (admin/kdp-calc.js) and
// the trademark and copyright watch list, and totals the sales.
//
//   GET  /admin/v1/kdp                       every listing with its sales totals, the Grid books to link, monthly totals
//   GET  /admin/v1/kdp/:id                   one listing with its months, rule check and watch-list findings
//   POST /admin/v1/kdp                       save { id?, bookId?, format, status, asin, isbn, listing }
//   POST /admin/v1/kdp/:id/delete            delete a listing and its sales
//   POST /admin/v1/kdp/:id/sales             { month: 'YYYY-MM', units, royalty } add or replace a month
//   POST /admin/v1/kdp/:id/sales/:month/delete
import { watchListFindings } from './ip-scan.js';
import { FORMATS, INKS, TRIMS, STATUSES, LIMITS, AI_TEXT, AI_IMAGES, checkListing, printingCost, royalty } from '../../admin/kdp-calc.js';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, max);
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const newId = (now) => `kdp-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ID = /^kdp-[\w-]{1,40}$/;
const MONTH = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const AI_T = AI_TEXT.map(([v]) => v);
const AI_I = AI_IMAGES.map(([v]) => v);

export function checkKdp(body) {
  const l = body.listing && typeof body.listing === 'object' ? body.listing : {};
  const title = clean(l.title, 200);
  if (title.length < 2) return { error: 'Give the listing a title.' };
  const asin = clean(body.asin, 10).toUpperCase();
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) return { error: 'An ASIN is 10 letters and numbers, like B0ABCDE123.' };
  const isbn = clean(body.isbn, 20).replace(/[\s-]/g, '');
  if (isbn && !/^(97[89])?\d{9}[\dX]$/.test(isbn)) return { error: 'An ISBN is 10 or 13 digits.' };
  const ai = l.ai || {};
  const p = l.print || {};
  const price = l.price || {};
  const usd = Math.round(Math.max(0, Math.min(10_000, Number(price.usd) || 0)) * 100) / 100;
  const listing = {
    title, subtitle: clean(l.subtitle, 200), series: clean(l.series, 200), seriesNo: clean(l.seriesNo, 10), edition: clean(l.edition, 10),
    author: clean(l.author, 120), contributors: clean(l.contributors, 300),
    description: text(l.description, 6000),
    keywords: Array.from({ length: LIMITS.keywords }, (_, i) => clean(l.keywords?.[i], 80)),
    categories: Array.from({ length: LIMITS.categories }, (_, i) => clean(l.categories?.[i], 300)),
    readingMin: clean(l.readingMin, 3), readingMax: clean(l.readingMax, 3),
    ai: { text: pick(ai.text, AI_T, ''), images: pick(ai.images, AI_I, ''), translations: pick(ai.translations, AI_T, '') },
    print: {
      ink: pick(p.ink, Object.keys(INKS), 'black'), trim: pick(p.trim, TRIMS, '6x9'), paper: pick(p.paper, ['white', 'cream'], 'white'),
      pages: Math.max(0, Math.min(2000, Math.round(Number(p.pages) || 0))), finish: pick(p.finish, ['matte', 'glossy'], 'matte'), bleed: !!p.bleed,
    },
    price: { usd, expanded: !!price.expanded },
    steps: Object.fromEntries(Object.entries(l.steps || {}).slice(0, 30).filter(([k]) => /^[a-z-]{1,30}$/.test(k)).map(([k, v]) => [k, !!v])),
    notes: text(l.notes, 4000),
  };
  return {
    value: {
      bookId: typeof body.bookId === 'string' && /^bk-[\w-]{1,40}$/.test(body.bookId) ? body.bookId : null,
      format: pick(body.format, Object.keys(FORMATS), 'paperback'), status: pick(body.status, Object.keys(STATUSES), 'planning'),
      asin, isbn, listing,
    },
  };
}

// Everything KDP would check, plus the watch list on the words shoppers see.
function review(row, listing) {
  const rules = checkListing({ ...listing, print: { ...listing.print, format: row.format } });
  const findings = watchListFindings([['Title', listing.title], ['Subtitle', listing.subtitle], ['Series', listing.series], ['Description', listing.description],
    ...listing.keywords.map((k, i) => [`Keyword ${i + 1}`, k])]);
  const pc = printingCost({ ...listing.print, format: row.format });
  const money = pc.error ? null : { cost: pc.cost, ...royalty({ price: listing.price.usd, cost: pc.cost, expanded: listing.price.expanded }) };
  return { ...rules, findings, money, ready: rules.ready && !findings.some((f) => f.serious) };
}

const rowOut = (r) => {
  const listing = JSON.parse(r.listing || '{}');
  return {
    id: r.id, bookId: r.book_id, format: r.format, status: r.status, title: r.title, asin: r.asin, isbn: r.isbn, listing,
    liveAt: r.live_at, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    units: r.units ?? 0, royaltyCents: r.royalty_cents ?? 0, lastMonth: r.last_month ?? null,
  };
};

export function kdpRoutes(Refusal) {
  const getRow = async (env, id) => {
    const r = await env.DB.prepare('SELECT * FROM kdp_listings WHERE id = ?1').bind(id).first();
    if (!r) throw new Refusal(404, 'gone', 'That listing is gone.');
    return r;
  };
  return [
    ['GET', /^kdp$/, 'viewer', 'kdp.view', async ({ env }) => {
      const { results } = await env.DB.prepare(`SELECT k.*, COALESCE(SUM(s.units), 0) AS units, COALESCE(SUM(s.royalty_cents), 0) AS royalty_cents, MAX(s.month) AS last_month
        FROM kdp_listings k LEFT JOIN kdp_sales s ON s.listing_id = k.id GROUP BY k.id ORDER BY k.updated_at DESC`).all();
      const books = await env.DB.prepare('SELECT id, title, subtitle, volume, edition, author, trim, paper, pages, status FROM books ORDER BY updated_at DESC').all();
      const months = await env.DB.prepare('SELECT month, SUM(units) AS units, SUM(royalty_cents) AS royalty_cents FROM kdp_sales GROUP BY month ORDER BY month DESC LIMIT 24').all();
      const listings = results.map((r) => { const o = rowOut(r); const rv = review(r, o.listing); return { ...o, ready: rv.ready, problems: rv.problems.length, money: rv.money }; });
      return { body: { listings, books: books.results, months: months.results.reverse() }, quiet: true };
    }],
    ['GET', /^kdp\/(kdp-[\w-]{1,40})$/, 'viewer', 'kdp.one', async ({ env, params: [id] }) => {
      const r = await getRow(env, id);
      const o = rowOut(r);
      const { results } = await env.DB.prepare('SELECT month, units, royalty_cents FROM kdp_sales WHERE listing_id = ?1 ORDER BY month DESC').bind(id).all();
      return { body: { listing: o, sales: results, review: review(r, o.listing) }, quiet: true };
    }],
    ['POST', /^kdp$/, 'admin', 'kdp.save', async ({ env, body, who, now }) => {
      const c = checkKdp(body || {});
      if (c.error) throw new Refusal(400, 'bad_listing', c.error);
      const v = c.value;
      let id = typeof body.id === 'string' && ID.test(body.id) ? body.id : null;
      const json = JSON.stringify(v.listing);
      if (id) {
        const old = await getRow(env, id);
        // The day it first went live stays, so the page can say how long it has been on sale.
        const liveAt = v.status === 'live' ? old.live_at || now : old.live_at;
        await env.DB.prepare('UPDATE kdp_listings SET book_id = ?2, format = ?3, status = ?4, title = ?5, asin = ?6, isbn = ?7, listing = ?8, live_at = ?9, updated_at = ?10 WHERE id = ?1')
          .bind(id, v.bookId, v.format, v.status, v.listing.title, v.asin, v.isbn, json, liveAt, now).run();
      } else {
        id = newId(now);
        await env.DB.prepare('INSERT INTO kdp_listings (id, book_id, format, status, title, asin, isbn, listing, live_at, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)')
          .bind(id, v.bookId, v.format, v.status, v.listing.title, v.asin, v.isbn, json, v.status === 'live' ? now : null, who.actor, now).run();
      }
      return { body: { ok: true, id }, target: id, detail: { title: v.listing.title, status: v.status } };
    }, { maxBody: 40_000 }],
    ['POST', /^kdp\/(kdp-[\w-]{1,40})\/delete$/, 'admin', 'kdp.delete', async ({ env, params: [id] }) => {
      await getRow(env, id);
      await env.DB.batch([env.DB.prepare('DELETE FROM kdp_sales WHERE listing_id = ?1').bind(id), env.DB.prepare('DELETE FROM kdp_listings WHERE id = ?1').bind(id)]);
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^kdp\/(kdp-[\w-]{1,40})\/sales$/, 'admin', 'kdp.sales', async ({ env, params: [id], body, now }) => {
      await getRow(env, id);
      const month = String(body?.month || '');
      if (!MONTH.test(month)) throw new Refusal(400, 'bad_month', 'Choose the month.');
      if (month > new Date(now).toISOString().slice(0, 7)) throw new Refusal(400, 'bad_month', 'That month has not happened yet.');
      const units = Math.round(Number(body.units));
      if (!Number.isFinite(units) || units < 0 || units > 1_000_000) throw new Refusal(400, 'bad_units', 'Copies sold must be 0 or more.');
      const royaltyUsd = Number(body.royalty);
      if (!Number.isFinite(royaltyUsd) || Math.abs(royaltyUsd) > 10_000_000) throw new Refusal(400, 'bad_royalty', 'Enter the royalty in dollars, like 12.40.');
      await env.DB.prepare(`INSERT INTO kdp_sales (listing_id, month, units, royalty_cents, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT (listing_id, month) DO UPDATE SET units = ?3, royalty_cents = ?4, updated_at = ?5`).bind(id, month, units, Math.round(royaltyUsd * 100), now).run();
      return { body: { ok: true }, target: id, detail: { month, units } };
    }],
    ['POST', /^kdp\/(kdp-[\w-]{1,40})\/sales\/(20\d\d-\d\d)\/delete$/, 'admin', 'kdp.sales-delete', async ({ env, params: [id, month] }) => {
      await env.DB.prepare('DELETE FROM kdp_sales WHERE listing_id = ?1 AND month = ?2').bind(id, month).run();
      return { body: { ok: true }, target: id, detail: { month } };
    }],
  ];
}
