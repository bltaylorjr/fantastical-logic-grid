// The website's design, chosen in the admin dashboard's Website page. The
// options themselves live in web/js/site-design.js (shared with the dashboard
// and the site build). The dashboard keeps one draft while you try things out;
// Publish saves it as the live design and, when GITHUB_DISPATCH_TOKEN is set,
// rebuilds the website at once (otherwise the daily rebuild picks it up).
//
//   GET /v1/site/design   the published design, for the website build (public)
//   (admin) GET site-design, POST site-design/draft, POST site-design/discard,
//           POST site-design/publish, POST site-design/restore/:id   see admin.js
import { changes, normalize } from '../../web/js/site-design.js';
import { json } from './http.js';

const HISTORY = 20;
const PAGES_URL = 'https://api.github.com/repos/bltaylorjr/fantastical-logic-grid/actions/workflows/pages.yml/dispatches';
const parse = (s) => { try { return changes(JSON.parse(s)); } catch (e) { return {}; } };

async function latest(env, state) {
  const r = await env.DB.prepare('SELECT * FROM site_design WHERE state = ?1 ORDER BY id DESC LIMIT 1').bind(state).first();
  return r ? { id: r.id, design: parse(r.design), by: r.actor, at: r.at } : null;
}

export async function handleSiteDesign(req, env, url) {
  if (url.pathname !== '/v1/site/design' || req.method !== 'GET') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  const live = await latest(env, 'published');
  return json(req, env, { design: live ? live.design : {}, version: live ? live.id : 0 });
}

export async function designView(env) {
  const [draft, live, list] = await Promise.all([latest(env, 'draft'), latest(env, 'published'),
    env.DB.prepare('SELECT id, actor, at, design FROM site_design WHERE state = ?1 ORDER BY id DESC LIMIT ?2').bind('published', HISTORY).all()]);
  return {
    draft, published: live,
    history: list.results.map((r) => ({ id: r.id, by: r.actor, at: r.at, changes: Object.keys(parse(r.design)).length })),
    siteUrl: String(env.SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, ''),
    rebuildsAtOnce: !!env.GITHUB_DISPATCH_TOKEN,
  };
}

// Only known options and listed choices are kept (normalize), and only what
// differs from the defaults is stored.
export const checkDesign = (body) => {
  if (!body || typeof body.design !== 'object' || Array.isArray(body.design)) return { error: 'Send the design as an object.' };
  if (JSON.stringify(body.design).length > 20_000) return { error: 'That design is too large.' };
  return { value: changes(normalize(body.design)) };
};

export async function saveDraft(env, design, actor, now) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM site_design WHERE state = ?1').bind('draft'),
    env.DB.prepare('INSERT INTO site_design (state, design, actor, at) VALUES (?1, ?2, ?3, ?4)').bind('draft', JSON.stringify(design), actor, now),
  ]);
  return latest(env, 'draft');
}

export async function discardDraft(env) {
  await env.DB.prepare('DELETE FROM site_design WHERE state = ?1').bind('draft').run();
  return { ok: true };
}

// Starts the website build now. Best effort: the daily build publishes it anyway.
async function rebuild(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return false;
  try {
    const res = await fetch(PAGES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flg-api', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return res.ok;
  } catch (e) { return false; }
}

export async function publishDraft(env, actor, now, design) {
  const from = design || (await latest(env, 'draft'))?.design;
  if (!from) return { error: 'There is nothing to publish. Make a change first.' };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO site_design (state, design, actor, at) VALUES (?1, ?2, ?3, ?4)').bind('published', JSON.stringify(changes(from)), actor, now),
    env.DB.prepare('DELETE FROM site_design WHERE state = ?1').bind('draft'),
    // Keep the last HISTORY published versions to restore from.
    env.DB.prepare('DELETE FROM site_design WHERE state = ?1 AND id NOT IN (SELECT id FROM site_design WHERE state = ?1 ORDER BY id DESC LIMIT ?2)').bind('published', HISTORY),
  ]);
  const live = await latest(env, 'published');
  return { ok: true, published: live, rebuilding: await rebuild(env) };
}

export async function restoreVersion(env, id, actor, now) {
  const r = await env.DB.prepare('SELECT design FROM site_design WHERE id = ?1 AND state = ?2').bind(id, 'published').first();
  if (!r) return { error: 'That version is no longer kept.' };
  return { ok: true, draft: await saveDraft(env, parse(r.design), actor, now) };
}
