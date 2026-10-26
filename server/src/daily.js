// The daily puzzle planner (admin dashboard) and the plan the website build
// reads (scripts/seo.mjs). The build makes every daily puzzle in date order from
// the first one, so a change here only ever applies to days still to come.
//
//   GET /v1/daily/plan            every planned change, for the website build (public)
//   (admin) GET daily, POST daily/:date, POST daily/:date/reset   see admin.js
import { THEMES } from '../../engine/src/themes.js';
import { TIERS } from '../../engine/src/tiers.js';
import { json } from './http.js';

const DAY = 24 * 3600_000;
export const PLAN_AHEAD_DAYS = 60;
const today = (now) => new Date(now).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const siteUrl = (env) => String(env.SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, '');

const row = (r) => ({ date: r.date, theme: r.theme || null, difficulty: r.difficulty || null, categories: r.categories || null, items: r.items || null, reroll: r.reroll || 0, note: r.note || null, updatedBy: r.updated_by, updatedAt: r.updated_at });

export async function planRows(env) {
  const { results } = await env.DB.prepare('SELECT * FROM daily_plan ORDER BY date').all();
  return results.map(row);
}

export async function handleDaily(req, env, url) {
  if (url.pathname !== '/v1/daily/plan' || req.method !== 'GET') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  // Only what the build needs; who changed it stays in the dashboard.
  const plan = (await planRows(env)).map(({ updatedBy, updatedAt, note, ...p }) => p);
  return json(req, env, { plan });
}

// What the dashboard shows: the next days as the website last built them
// (daily/upcoming.json, no clues or answers) and the changes planned here.
export async function plannerView(env, now) {
  const plan = await planRows(env);
  let upcoming = null;
  let siteError = null;
  try {
    const res = await fetch(`${siteUrl(env)}/daily/upcoming.json`, { cf: { cacheTtl: 60 } });
    if (res.ok) upcoming = await res.json();
    else siteError = `The website answered ${res.status}.`;
  } catch (e) { siteError = 'The website did not answer.'; }
  return {
    today: today(now), plan, upcoming, siteError, aheadDays: PLAN_AHEAD_DAYS,
    themes: THEMES.map((t) => ({ id: t.id, name: t.name })),
    tiers: Object.values(TIERS).sort((a, b) => a.order - b.order).map((t) => ({ id: t.id, name: t.name, categories: t.categories, items: t.items })),
  };
}

// Returns { error } or { value } with the checked change.
export function checkPlan(date, body, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: 'Use a date like 2026-11-01.' };
  if (date <= today(now)) return { error: 'Only days still to come can change. Past and today\'s puzzles stay as players saw them.' };
  if (date > addDays(today(now), PLAN_AHEAD_DAYS)) return { error: `Plan up to ${PLAN_AHEAD_DAYS} days ahead.` };
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
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null;
  return { value: { date, theme, difficulty, categories, items, newStory: !!body.newStory, note } };
}

export async function savePlan(env, v, actor, now) {
  const old = await env.DB.prepare('SELECT reroll FROM daily_plan WHERE date = ?1').bind(v.date).first();
  const reroll = (old ? old.reroll : 0) + (v.newStory ? 1 : 0);
  await env.DB.prepare(`INSERT INTO daily_plan (date, theme, difficulty, categories, items, reroll, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT (date) DO UPDATE SET theme = excluded.theme, difficulty = excluded.difficulty, categories = excluded.categories, items = excluded.items,
      reroll = excluded.reroll, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(v.date, v.theme, v.difficulty, v.categories, v.items, reroll, v.note, actor, now).run();
  return { ...v, reroll };
}

export async function resetPlan(env, date, now) {
  if (date <= today(now)) return { error: 'Only days still to come can change.' };
  await env.DB.prepare('DELETE FROM daily_plan WHERE date = ?1').bind(date).run();
  return { ok: true };
}
