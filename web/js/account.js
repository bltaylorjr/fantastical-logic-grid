// Player accounts: sign up, sign in, password reset and account deletion
// through Firebase Authentication's REST API (no SDK to bundle). Firebase keeps
// the email and password; the game never stores the password.
//
// Session: the long-lived refresh token is kept on this device (as Firebase's
// own SDK does) so the player stays signed in. The short-lived ID token (one
// hour) lives only in memory and is renewed when needed.
import { CLOUD, cloudEnabled } from './cloud-config.js';
import * as store from './store.js';

const SESSION = 'auth';
let session = store.getLocal(SESSION) || null; // { uid, email, refreshToken, verified }
let idToken = null;
let idTokenExp = 0;
const listeners = new Set();

export const enabled = cloudEnabled;
export function current() { return session ? { uid: session.uid, email: session.email, verified: !!session.verified } : null; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(current()); } catch (e) { /* ignore */ } } }

export class AccountError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Firebase error codes, in words a player can act on.
const MESSAGES = {
  EMAIL_EXISTS: 'An account already uses this email. Sign in instead, or reset the password.',
  INVALID_LOGIN_CREDENTIALS: 'That email and password do not match an account. Check them, or reset your password.',
  INVALID_PASSWORD: 'That email and password do not match an account. Check them, or reset your password.',
  EMAIL_NOT_FOUND: 'That email and password do not match an account. Check them, or reset your password.',
  INVALID_EMAIL: 'That email address does not look right. Check it and try again.',
  MISSING_PASSWORD: 'Enter your password.',
  WEAK_PASSWORD: 'Choose a longer password: at least 8 characters.',
  PASSWORD_DOES_NOT_MEET_REQUIREMENTS: 'Choose a longer password: at least 8 characters.',
  USER_DISABLED: 'This account has been turned off. Contact support if you think this is a mistake.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes, then try again.',
  OPERATION_NOT_ALLOWED: 'Email sign-in is not switched on for this game yet.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'For safety, enter your password again.',
  TOKEN_EXPIRED: 'Your sign-in has expired. Please sign in again.',
  USER_NOT_FOUND: 'This account no longer exists. Please sign in again.',
  INVALID_REFRESH_TOKEN: 'Your sign-in has expired. Please sign in again.',
  INVALID_ID_TOKEN: 'Your sign-in has expired. Please sign in again.',
};
const SIGNED_OUT_CODES = new Set(['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'USER_DISABLED', 'INVALID_REFRESH_TOKEN', 'INVALID_ID_TOKEN']);

async function post(url, body, form = false) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  } catch (e) {
    throw new AccountError('OFFLINE', 'You seem to be offline. Your puzzles are safe on this device; try again when you are connected.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = (data.error && (data.error.message || data.error)) || `HTTP_${res.status}`;
    const code = String(raw).split(/[\s:]/)[0];
    throw new AccountError(code, MESSAGES[code] || 'Something went wrong. Please try again.');
  }
  return data;
}
const auth = (path, body) => post(`${CLOUD.authUrl}/${path}?key=${encodeURIComponent(CLOUD.firebaseApiKey)}`, body);

function begin(data, verified) {
  session = { uid: data.localId, email: data.email, refreshToken: data.refreshToken, verified: !!verified };
  idToken = data.idToken;
  idTokenExp = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  store.setLocal(SESSION, session);
  emit();
}

export async function signUp(email, password) {
  if (String(password).length < 8) throw new AccountError('WEAK_PASSWORD', MESSAGES.WEAK_PASSWORD);
  const data = await auth('accounts:signUp', { email, password, returnSecureToken: true });
  begin(data, false);
  // A confirmation email helps the player spot a typo before they need a reset.
  auth('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: data.idToken }).catch(() => {});
}

export async function signIn(email, password) {
  const data = await auth('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  let verified = false;
  try { verified = !!(await auth('accounts:lookup', { idToken: data.idToken })).users?.[0]?.emailVerified; } catch (e) { /* optional */ }
  begin(data, verified);
}

// Always reports success, so the form never reveals which emails have accounts.
export async function sendPasswordReset(email) {
  try { await auth('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); } catch (e) {
    if (e.code === 'OFFLINE' || e.code === 'TOO_MANY_ATTEMPTS_TRY_LATER' || e.code === 'INVALID_EMAIL') throw e;
  }
}

export function signOut() {
  session = null;
  idToken = null;
  idTokenExp = 0;
  store.setLocal(SESSION, undefined);
  emit();
}

// A fresh ID token for the sync service. Throws AccountError('OFFLINE') when
// there is no connection, and signs out when the session is no longer valid.
export async function getIdToken({ force = false } = {}) {
  if (!session) throw new AccountError('SIGNED_OUT', 'Not signed in.');
  if (!force && idToken && Date.now() < idTokenExp - 60_000) return idToken;
  try {
    const data = await post(`${CLOUD.tokenUrl}/token?key=${encodeURIComponent(CLOUD.firebaseApiKey)}`, { grant_type: 'refresh_token', refresh_token: session.refreshToken }, true);
    idToken = data.id_token;
    idTokenExp = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    if (data.refresh_token && data.refresh_token !== session.refreshToken) { session.refreshToken = data.refresh_token; store.setLocal(SESSION, session); }
    return idToken;
  } catch (e) {
    if (SIGNED_OUT_CODES.has(e.code)) { signOut(); throw new AccountError('SIGNED_OUT', MESSAGES[e.code]); }
    throw e;
  }
}

// Deleting needs the password again. Synced data is removed first (by the
// game's server), then the Firebase account itself.
export async function deleteAccount(password, deleteSyncedData) {
  if (!session) throw new AccountError('SIGNED_OUT', 'Not signed in.');
  const data = await auth('accounts:signInWithPassword', { email: session.email, password, returnSecureToken: true });
  if (data.localId !== session.uid) throw new AccountError('INVALID_LOGIN_CREDENTIALS', MESSAGES.INVALID_LOGIN_CREDENTIALS);
  idToken = data.idToken;
  idTokenExp = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  await deleteSyncedData(data.idToken);
  await auth('accounts:delete', { idToken: data.idToken });
  signOut();
}
