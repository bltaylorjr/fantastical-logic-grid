// Special edition puzzles: planned in the admin dashboard (Puzzle emails),
// made by the website build (scripts/seo.mjs) and emailed on their day to
// everyone on the special edition list (puzzle-mail.js). The build makes every
// daily, weekly and special puzzle in date order from the first one, so a new
// story is never used twice; that is why an edition can only be changed or
// cancelled before its day.
//
//   GET /v1/specials              every planned edition, for the website build (public)
//   (admin) GET specials, POST specials, POST specials/:id, POST specials/:id/cancel
import { THEMES } from '../../engine/src/themes.js';
import { TIERS } from '../../engine/src/tiers.js';
import { json } from './http.js';

const DAY = 24 * 3600_000;
export const SPECIAL_AHEAD_DAYS = 90;
const today = (now) => new Date(now).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const siteUrl = (env) => String(env.SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, '');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const row = (r) => ({ id: r.id, date: r.date, title: r.title, note: r.note, theme: r.theme || null, difficulty: r.difficulty || null, categories: r.categories || null, items: r.items || null, status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

export async function editionRows(env, { all = false } = {}) {
  const { results } = await env.DB.prepare(`SELECT * FROM special_editions ${all ? '' : "WHERE status = 'planned'"} ORDER BY date, id`).all();
  return results.map(row);
}

export async function editionById(env, id) {
  const r = await env.DB.prepare('SELECT * FROM special_editions WHERE id = ?1').bind(id).first();
  return r ? row(r) : null;
}

export async function handleSpecials(req, env, url) {
  if (url.pathname !== '/v1/specials' || req.method !== 'GET') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  // Only what the build needs; who planned it stays in the dashboard.
  const specials = (await editionRows(env)).map(({ status, createdBy, createdAt, updatedAt, ...e }) => e);
  return json(req, env, { specials });
}

// Returns { error } or { value } with the checked edition.
export function checkEdition(body, now) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: 'Pick the day it comes out.' };
  if (date <= today(now)) return { error: 'Pick a day from tomorrow on. The puzzle is made in the nightly site build before its day.' };
  if (date > addDays(today(now), SPECIAL_AHEAD_DAYS)) return { error: `Plan up to ${SPECIAL_AHEAD_DAYS} days ahead.` };
  const title = clean(body.title, 80);
  if (title.length < 3) return { error: 'Give it a title, like "Halloween special".' };
  const note = clean(body.note, 400);
  if (note.length < 5) return { error: 'Write a few words to players. They show in the email and the game.' };
  const theme = body.theme ? String(body.theme) : null;
  if (theme && !THEMES.some((t) => t.id === theme)) return { error: 'Choose a theme from the list.' };
  const difficulty = body.difficulty ? String(body.difficulty) : null;
  if (difficulty && !TIERS[difficulty]) return { error: 'Choose a difficulty from the list.' };
  let categories = null, items = null;
  if (body.size && body.size !== 'auto') {
    const m = String(body.size).match(/^([3-6])x([3-8])$/);
    if (!m) return { error: 'Choose a size from the list.' };
    [categories, items] = [Number(m[1]), Number(m[2])];
  }
  return { value: { date, title, note, theme, difficulty, categories, items } };
}

function newId(date) {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `se-${date}-${[...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 5)}`;
}

// The dashboard's list: every edition with how many emails went out, and the
// coming ones as the website last built them (specials/upcoming.json).
async function editionsView(env, now) {
  const specials = await editionRows(env, { all: true });
  const { results } = await env.DB.prepare("SELECT send, COUNT(*) AS n FROM puzzle_mail_got WHERE send LIKE 'special-%' GROUP BY send").all();
  const sent = Object.fromEntries(results.map((r) => [r.send.slice('special-'.length), r.n]));
  let built = null;
  try {
    const res = await fetch(`${siteUrl(env)}/specials/upcoming.json`, { cf: { cacheTtl: 60 } });
    if (res.ok) built = await res.json();
  } catch (e) { /* the site is out of reach: no preview */ }
  const preview = new Map(((built && built.specials) || []).map((x) => [x.id, x]));
  return {
    today: today(now), aheadDays: SPECIAL_AHEAD_DAYS,
    specials: specials.map((e) => ({ ...e, sent: sent[e.id] || 0, locked: e.date <= today(now), puzzle: preview.get(e.id) || null })),
    themes: THEMES.map((t) => ({ id: t.id, name: t.name })),
    tiers: Object.values(TIERS).sort((a, b) => a.order - b.order).map((t) => ({ id: t.id, name: t.name })),
  };
}

export function editionRoutes(Refusal) {
  return [
    ['GET', /^specials$/, 'viewer', 'specials.view', async ({ env, now }) => ({ body: await editionsView(env, now), quiet: true })],
    ['POST', /^specials$/, 'admin', 'specials.add', async ({ env, body, who, now }) => {
      const c = checkEdition(body, now);
      if (c.error) throw new Refusal(400, 'bad_edition', c.error);
      const v = c.value;
      const id = newId(v.date);
      await env.DB.prepare(`INSERT INTO special_editions (id, date, title, note, theme, difficulty, categories, items, status, created_by, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'planned', ?9, ?10, ?10)`).bind(id, v.date, v.title, v.note, v.theme, v.difficulty, v.categories, v.items, who.actor, now).run();
      return { body: { ok: true, id }, target: id, detail: v };
    }],
    ['POST', /^specials\/(se-[\w-]{1,40})$/, 'admin', 'specials.change', async ({ env, params: [id], body, now }) => {
      const old = await editionById(env, id);
      if (!old) throw new Refusal(404, 'gone', 'That edition is gone.');
      if (old.date <= today(now) || old.status !== 'planned') throw new Refusal(400, 'locked', 'Only editions still to come can change.');
      const c = checkEdition(body, now);
      if (c.error) throw new Refusal(400, 'bad_edition', c.error);
      const v = c.value;
      await env.DB.prepare(`UPDATE special_editions SET date = ?2, title = ?3, note = ?4, theme = ?5, difficulty = ?6, categories = ?7, items = ?8, updated_at = ?9 WHERE id = ?1`)
        .bind(id, v.date, v.title, v.note, v.theme, v.difficulty, v.categories, v.items, now).run();
      return { body: { ok: true }, target: id, detail: v };
    }],
    ['POST', /^specials\/(se-[\w-]{1,40})\/cancel$/, 'admin', 'specials.cancel', async ({ env, params: [id], now }) => {
      const old = await editionById(env, id);
      if (!old) throw new Refusal(404, 'gone', 'That edition is gone.');
      if (old.date <= today(now)) throw new Refusal(400, 'locked', 'An edition that already came out stays, so no other puzzle changes.');
      await env.DB.prepare("UPDATE special_editions SET status = 'cancelled', updated_at = ?2 WHERE id = ?1").bind(id, now).run();
      return { body: { ok: true }, target: id };
    }],
  ];
}
