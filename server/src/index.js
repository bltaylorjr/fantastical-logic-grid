// The game's Cloudflare Worker. Routes:
//   /v1/learn/*, /v1/tts, /admin/learn*  shared learning and voices (learn.js)
//   POST /v1/sync, DELETE /v1/account    account sync (sync.js), signed in only
//   /v1/profile, /v1/scores, /v1/scoreboard, /v1/races*
//                                        screen names, races, scoreboard (compete.js)
//   POST /v1/errors, GET /admin/errors   anonymous error reports from the apps (errors.js)
//   GET /v1/config                       announcements, switched-off themes, features (settings.js)
//   /admin/*                             the admin dashboard and its API (admin.js)
//   GET /v1/health[?deep=1]              a quick check that the Worker (and with
//                                        deep=1, the database and daily cleanup) is up
// scheduled(): the daily cleanup of old data (upkeep.js), the weekly archive
// email (archive.js) and the daily fetch of Google and Bing search numbers
// (search.js), on the crons in wrangler.toml.

import { handleLearn } from './learn.js';
import { handleCompete } from './compete.js';
import { handleErrors } from './errors.js';
import { handleAdmin } from './admin.js';
import { refreshSearch, SEARCH_CRON } from './search.js';
import { publicConfig } from './settings.js';
import { runUpkeep, deepHealth } from './upkeep.js';
import { runArchive } from './archive.js';
import { handleSync, handleDeleteAccount, isDeleted } from './sync.js';
import { verifyIdToken, AuthError } from './auth.js';
import { json, corsHeaders } from './http.js';

const MAX_BODY = 4_000_000;
const WEEKLY_ARCHIVE_CRON = '47 4 * * 1';

async function signedIn(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) throw new AuthError('Not signed in');
  return verifyIdToken(m[1], env);
}

async function route(req, env, ctx) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });

  const admin = await handleAdmin(req, env, ctx, url, async () => (await handleLearn(req, env, ctx, url)) || (await handleErrors(req, env, url)) || json(req, env, { error: 'not_found' }, 404));
  if (admin) return admin;

  if (url.pathname === '/v1/config' && req.method === 'GET') {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
    return publicConfig(req, env);
  }

  const learn = await handleLearn(req, env, ctx, url);
  if (learn) return learn;

  const compete = await handleCompete(req, env, ctx, url, signedIn);
  if (compete) return compete;

  const errors = await handleErrors(req, env, url);
  if (errors) return errors;

  if (url.pathname === '/v1/health') {
    if (url.searchParams.get('deep') !== '1') return json(req, env, { ok: true });
    const health = await deepHealth(env);
    return json(req, env, health, health.ok ? 200 : 503);
  }

  const isSync = url.pathname === '/v1/sync' && req.method === 'POST';
  const isDelete = url.pathname === '/v1/account' && req.method === 'DELETE';
  if (!isSync && !isDelete) return json(req, env, { error: 'not_found' }, 404);

  if (Number(req.headers.get('Content-Length') || 0) > MAX_BODY) return json(req, env, { error: 'too_large' }, 413);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });

  let user;
  try { user = await signedIn(req, env); } catch (e) {
    if (e instanceof AuthError) return json(req, env, { error: 'sign_in', detail: e.message }, 401);
    throw e;
  }
  if (env.LIMIT_SYNC && !(await env.LIMIT_SYNC.limit({ key: user.uid })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  if (await isDeleted(env, user.uid)) return json(req, env, { error: 'account_deleted' }, 401);
  return isSync ? handleSync(req, env, user) : handleDeleteAccount(req, env, user);
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      console.error(e);
      return json(req, env, { error: 'server' }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    if (controller.cron === SEARCH_CRON) {
      ctx.waitUntil(refreshSearch(env).then((r) => console.log('search', JSON.stringify(r))));
      return;
    }
    if (controller.cron === WEEKLY_ARCHIVE_CRON) {
      ctx.waitUntil(runArchive(env).then((r) => console.log('archive', r.status, JSON.stringify(r.rows || {}))));
      return;
    }
    ctx.waitUntil(runUpkeep(env).then((removed) => console.log('upkeep', JSON.stringify(removed))));
  },
};
