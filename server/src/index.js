// The game's Cloudflare Worker. Routes:
//   /v1/learn/*, /v1/tts, /admin/learn/*  shared learning and voices (learn.js)
//   POST /v1/sync, DELETE /v1/account    account sync (sync.js), signed in only
//   /v1/profile, /v1/scores, /v1/scoreboard, /v1/races*
//                                        screen names, races, scoreboard (compete.js)
//   POST /v1/errors, GET /admin/errors   anonymous error reports from the apps (errors.js)
//   POST /v1/feedback                    the game's idea and problem boxes (feedback.js)
//   /v1/messages*                        messages between signed-in players and the team (messages.js)
//   POST /v1/picture                     AI pictures from Workers AI (pictures.js)
//   /v1/characters*                      the game's own characters and player suggestions (characters.js)
//   GET /v1/config                       announcements, switched-off themes, features (settings.js)
//   GET /v1/daily/plan                   daily puzzle changes for the website build (daily.js)
//   /v1/daily/:date/(start|result|stats) everyone's numbers for a daily puzzle (daily-results.js)
//   /v1/daily-email[/unsubscribe]       daily puzzle by email for signed-in players (daily-email.js)
//   GET /v1/quality                      average rating and best-rated daily puzzles (quality.js)
//   POST /v1/translate                   the game's text in another language (translate.js)
//   POST /v1/m                           anonymous counts of visits from campaign links (marketing.js)
//   /v1/challenges[/:code[/result]]       Challenge a friend links, no account (challenges.js)
//   GET /v1/perks                        a signed-in player's supporter perks (supporters.js)
//   GET /v1/contributor                  a signed-in player's contributor badge (contributors.js)
//   /admin/*                             the admin dashboard and its API (admin.js)
//   GET /v1/health[?deep=1]              a quick check that the Worker (and with
//                                        deep=1, the database and daily cleanup) is up
// scheduled(): the nightly maintenance at 2 am Eastern (nightly.js: cleanup of
// old data, database tidy-up, Google and Bing search numbers) and the weekly
// archive email (archive.js), on the crons in wrangler.toml.

import { handleLearn } from './learn.js';
import { handleCompete } from './compete.js';
import { handleChallenges } from './challenges.js';
import { handleErrors } from './errors.js';
import { handleFeedback } from './feedback.js';
import { handleContributor } from './contributors.js';
import { handleMessages } from './messages.js';
import { handlePictures } from './pictures.js';
import { handleCharacters } from './characters.js';
import { handleDaily } from './daily.js';
import { handleDailyResults } from './daily-results.js';
import { handleQuality } from './quality.js';
import { handleDailyEmail } from './daily-email.js';
import { handleTranslate } from './translate.js';
import { handleAdmin } from './admin.js';
import { NIGHTLY_CRONS, isMaintenanceHour, runNightly } from './nightly.js';
import { handleMarketing } from './marketing.js';
import { handlePerks } from './supporters.js';
import { publicConfig } from './settings.js';
import { deepHealth } from './upkeep.js';
import { runArchive } from './archive.js';
import { handleSync, handleDeleteAccount, isDeleted } from './sync.js';
import { verifyIdToken, AuthError } from './auth.js';
import { json, corsHeaders, secured } from './http.js';

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

  const challenge = await handleChallenges(req, env, url);
  if (challenge) return challenge;

  const perks = await handlePerks(req, env, url, signedIn);
  if (perks) return perks;

  const contributor = await handleContributor(req, env, url, signedIn);
  if (contributor) return contributor;

  const compete = await handleCompete(req, env, ctx, url, signedIn);
  if (compete) return compete;

  const errors = await handleErrors(req, env, url);
  if (errors) return errors;

  const feedback = await handleFeedback(req, env, url);
  if (feedback) return feedback;

  const messages = await handleMessages(req, env, url, signedIn, isDeleted);
  if (messages) return messages;

  const picture = await handlePictures(req, env, ctx, url);
  if (picture) return picture;

  const character = await handleCharacters(req, env, url);
  if (character) return character;

  const dailyResults = await handleDailyResults(req, env, url);
  if (dailyResults) return dailyResults;

  const dailyEmail = await handleDailyEmail(req, env, url);
  if (dailyEmail) return dailyEmail;

  const quality = await handleQuality(req, env, url);
  if (quality) return quality;

  const daily = await handleDaily(req, env, url);
  if (daily) return daily;

  const translated = await handleTranslate(req, env, url);
  if (translated) return translated;

  const marketing = await handleMarketing(req, env, url);
  if (marketing) return marketing;

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
      return secured(await route(req, env, ctx));
    } catch (e) {
      console.error(e);
      return secured(json(req, env, { error: 'server' }, 500));
    }
  },
  async scheduled(controller, env, ctx) {
    if (controller.cron === WEEKLY_ARCHIVE_CRON) {
      // Only when Cloudflare email is connected; otherwise the GitHub Action sends it.
      ctx.waitUntil(runArchive(env).then((r) => console.log('archive', r.status, JSON.stringify(r.rows || {}))));
      return;
    }
    // The nightly maintenance (nightly.js): of the two UTC crons, only the one
    // that falls at 2 am Eastern runs it.
    const at = controller.scheduledTime || Date.now();
    if (NIGHTLY_CRONS.includes(controller.cron) && !isMaintenanceHour(at)) return;
    ctx.waitUntil(runNightly(env).then((r) => console.log('nightly', JSON.stringify(r))));
  },
};
