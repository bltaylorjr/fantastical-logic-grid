// Sign in with a screen name instead of an email.
//
//   POST /v1/sign-in/name   { name, password }
//        -> { idToken, refreshToken, localId, expiresIn }  (Firebase's shape, without the email)
//
// Firebase only signs in by email, so the Worker looks up the email behind the
// screen name (players.email, kept from the player's own verified sign-ins)
// and asks Firebase on the player's behalf. The email never leaves the Worker:
// a wrong name and a wrong password get the same answer, and a successful
// sign-in returns only the tokens (the game then reads its own account details
// from Firebase with them), so a screen name can never be used to find out
// someone's email address.
import { json, readText } from './http.js';
import { cleanName, nameKey, NAME_MAX } from './names.js';
import { isDeleted } from './sync.js';

const SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const NO_MATCH = 'INVALID_LOGIN_CREDENTIALS';
// Firebase codes passed on to the player as they are; anything else is a no-match.
const PASS_ON = new Set(['TOO_MANY_ATTEMPTS_TRY_LATER', 'USER_DISABLED', 'MISSING_PASSWORD']);

export async function handleNameSignIn(req, env, url) {
  if (url.pathname !== '/v1/sign-in/name') return null;
  const fail = (error, status = 400, extra = {}) => json(req, env, { error: { message: error }, ...extra }, status);
  if (req.method !== 'POST') return fail('not_found', 404);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  // Each connection gets a few tries a minute, so names and passwords cannot be guessed in bulk.
  if (env.LIMIT_SIGN_IN && !(await env.LIMIT_SIGN_IN.limit({ key: ip })).success) return fail('TOO_MANY_ATTEMPTS_TRY_LATER', 429, { retryAfter: 60 });
  const key = env.FIREBASE_WEB_API_KEY;
  if (!key) return fail('OPERATION_NOT_ALLOWED', 503);

  let b = null;
  try { b = JSON.parse(await readText(req, 8_000)); } catch (e) { /* unreadable */ }
  const name = cleanName(b && b.name);
  const password = typeof (b && b.password) === 'string' ? b.password : '';
  if (!password) return fail('MISSING_PASSWORD');
  if (!name || name.length > NAME_MAX || password.length > 4096) return fail(NO_MATCH);

  const row = await env.DB.prepare('SELECT user_id, email FROM players WHERE name_key = ?1').bind(nameKey(name)).first();
  if (!row || !row.email || await isDeleted(env, row.user_id)) return fail(NO_MATCH);

  let res;
  try {
    res = await fetch(`${env.TEST_SIGN_IN_URL || SIGN_IN_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      // The web key may be limited to the game's website.
      headers: { 'Content-Type': 'application/json', Referer: `${env.SITE_URL || 'https://thelogicgrid.com'}/` },
      body: JSON.stringify({ email: row.email, password, returnSecureToken: true }),
    });
  } catch (e) { return fail('OFFLINE', 502); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String((data.error && data.error.message) || '').split(/[\s:]/)[0];
    return fail(PASS_ON.has(code) ? code : NO_MATCH, code === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 429 : 400);
  }
  // The account may have moved to another email since the name was saved.
  if (data.localId !== row.user_id) return fail(NO_MATCH);
  return json(req, env, { idToken: data.idToken, refreshToken: data.refreshToken, localId: data.localId, expiresIn: data.expiresIn });
}
