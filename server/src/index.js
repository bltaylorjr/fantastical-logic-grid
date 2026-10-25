// The game's Cloudflare Worker. Routes:
//   /v1/learn/*, /v1/tts, /admin/learn*  shared learning and voices (learn.js)
//   POST /v1/sync, DELETE /v1/account    account sync (sync.js), signed in only
//   /v1/profile, /v1/scores, /v1/scoreboard, /v1/races*
//                                        screen names, races, scoreboard (compete.js)
//   GET /v1/health                       a quick check that the Worker is up

import { handleLearn } from './learn.js';
import { handleCompete } from './compete.js';
import { handleSync, handleDeleteAccount, isDeleted } from './sync.js';
import { verifyIdToken, AuthError } from './auth.js';
import { json, corsHeaders } from './http.js';

const MAX_BODY = 4_000_000;

async function signedIn(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) throw new AuthError('Not signed in');
  return verifyIdToken(m[1], env);
}

async function route(req, env, ctx) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });

  const learn = await handleLearn(req, env, ctx, url);
  if (learn) return learn;

  const compete = await handleCompete(req, env, ctx, url, signedIn);
  if (compete) return compete;

  if (url.pathname === '/v1/health') return json(req, env, { ok: true });

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
};
