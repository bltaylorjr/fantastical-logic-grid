// Player accounts: sign up, sign in, password reset and account deletion
// through Firebase Authentication's REST API (no SDK to bundle). Firebase keeps
// the email and password; the game never stores the password.
//
// Session: with "Keep me signed in" (the default) the long-lived refresh token
// is kept on this device (as Firebase's own SDK does) so the player stays
// signed in. Without it the token lives in sessionStorage, so closing the game
// signs the player out. The short-lived ID token (one hour) lives only in
// memory and is renewed when needed.
//
// Idle sign-out (idle.js) calls lock(): the player is signed out, and when
// they turned on fingerprint or face sign-in (biometric.js) the refresh token
// is put aside on this device (where the session was kept), so unlock() can
// open it again after the device check. Signing out by hand discards it.
import { CLOUD, cloudEnabled } from './cloud-config.js';
import * as store from './store.js';

const SESSION = 'auth';
const TAB_KEY = 'flg.auth';
function readTabSession() { try { return JSON.parse(sessionStorage.getItem(TAB_KEY)) || null; } catch (e) { return null; } }
function writeTabSession(v) { try { if (v) sessionStorage.setItem(TAB_KEY, JSON.stringify(v)); else sessionStorage.removeItem(TAB_KEY); } catch (e) { /* memory only */ } }
// On a host shared with other people's games (itch.io serves every HTML game
// from the same origin), any of them could read a sign-in kept on the device,
// so there it lasts for this visit only.
const SHARED_ORIGIN = /(^|\.)itch\.zone$/i.test(location.hostname);
if (SHARED_ORIGIN && store.getLocal(SESSION)) store.setLocal(SESSION, undefined);
let session = store.getLocal(SESSION) || readTabSession(); // { uid, email, refreshToken, verified, remember }

// Keeps the session where the player chose: on the device, or for this visit only.
function saveSession() {
  if (session && session.remember === false) { store.setLocal(SESSION, undefined); writeTabSession(session); }
  else { writeTabSession(null); store.setLocal(SESSION, session || undefined); }
}
const LOCKED = 'authLocked';
const TAB_LOCKED = 'flg.authLocked';
function readTabLocked() { try { return JSON.parse(sessionStorage.getItem(TAB_LOCKED)) || null; } catch (e) { return null; } }
let locked = store.getLocal(LOCKED) || readTabLocked();
function saveLocked() {
  try { if (locked && locked.remember === false) sessionStorage.setItem(TAB_LOCKED, JSON.stringify(locked)); else sessionStorage.removeItem(TAB_LOCKED); } catch (e) { /* memory only */ }
  store.setLocal(LOCKED, locked && locked.remember !== false ? locked : undefined);
}
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
  NAME_NO_MATCH: 'That screen name and password do not match an account. Check them, or sign in with your email.',
  INVALID_EMAIL: 'That email address does not look right. Check it and try again.',
  MISSING_PASSWORD: 'Enter your password.',
  WEAK_PASSWORD: 'Choose a longer password: at least 8 characters.',
  BREACHED_PASSWORD: 'That password has turned up in a data leak on another website, so it is easy to guess. Please choose a different one.',
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

function begin(data, verified, remember = true) {
  locked = null;
  saveLocked();
  session = { uid: data.localId, email: data.email, refreshToken: data.refreshToken, verified: !!verified, remember: !SHARED_ORIGIN && remember !== false };
  idToken = data.idToken;
  idTokenExp = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  saveSession();
  emit();
}

// Checks a new password against the hundreds of millions already leaked from
// other websites (Have I Been Pwned's free Pwned Passwords list). Only the
// first 5 characters of the password's SHA-1 hash leave the device, so the
// service never learns the password. If the check cannot run (offline, slow),
// sign-up goes ahead.
export async function leakedPassword(password) {
  try {
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password)))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const rest = hex.slice(5);
    return (await res.text()).split('\n').some((line) => { const [suffix, count] = line.trim().split(':'); return suffix === rest && Number(count) > 0; });
  } catch (e) { return false; }
}

export async function signUp(email, password, { remember = true } = {}) {
  if (String(password).length < 8) throw new AccountError('WEAK_PASSWORD', MESSAGES.WEAK_PASSWORD);
  if (await leakedPassword(String(password))) throw new AccountError('BREACHED_PASSWORD', MESSAGES.BREACHED_PASSWORD);
  const data = await auth('accounts:signUp', { email, password, returnSecureToken: true });
  begin(data, false, remember);
  // A confirmation email helps the player spot a typo before they need a reset.
  auth('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: data.idToken }).catch(() => {});
}

// True when the sign-in box holds a screen name rather than an email.
export const isScreenName = (text) => !String(text || '').includes('@');

// Signs in with an email, or with a screen name: the game's server finds the
// account behind the name and signs in with Firebase for the player, without
// ever telling this device the email. The account details then come from
// Firebase with the new token.
export async function signIn(login, password, { remember = true } = {}) {
  const byName = isScreenName(login);
  const data = byName
    ? await post(`${CLOUD.syncUrl.replace(/\/$/, '')}/v1/sign-in/name`, { name: String(login).trim(), password }).catch((e) => {
      if (e.code === 'INVALID_LOGIN_CREDENTIALS') throw new AccountError(e.code, MESSAGES.NAME_NO_MATCH);
      throw e;
    })
    : await auth('accounts:signInWithPassword', { email: login, password, returnSecureToken: true });
  let user = null;
  // A screen-name sign-in needs the account's email (it is shown in the
  // account window and asked for again before deleting the account).
  if (byName) user = (await auth('accounts:lookup', { idToken: data.idToken })).users?.[0];
  else try { user = (await auth('accounts:lookup', { idToken: data.idToken })).users?.[0]; } catch (e) { /* optional */ }
  if (byName) data.email = user?.email;
  begin(data, !!user?.emailVerified, remember);
}

// Always reports success, so the form never reveals which emails have accounts.
export async function sendPasswordReset(email) {
  try { await auth('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); } catch (e) {
    if (e.code === 'OFFLINE' || e.code === 'TOO_MANY_ATTEMPTS_TRY_LATER' || e.code === 'INVALID_EMAIL') throw e;
  }
}

function end() {
  session = null;
  idToken = null;
  idTokenExp = 0;
  saveSession();
  emit();
}

export function signOut() {
  locked = null;
  saveLocked();
  end();
}

// The signed-out account whose session waits for the fingerprint or face check.
export function lockedAccount() { return locked ? { uid: locked.uid, email: locked.email } : null; }

// Signs the player out after they were idle. keep: put the session aside for
// unlock() (only when fingerprint or face sign-in is on for this account).
export function lock({ keep = false } = {}) {
  if (!session) return;
  locked = keep ? { ...session } : null;
  saveLocked();
  end();
}

// Opens the locked session again, after biometric.verify() said yes. Offline
// is fine (the game works offline and the token is renewed later); a session
// the sign-in service no longer accepts is dropped and needs the password.
export async function unlock() {
  if (!locked) throw new AccountError('SIGNED_OUT', 'Please sign in with your password.');
  session = locked;
  locked = null;
  saveLocked();
  saveSession();
  try { await getIdToken({ force: true }); } catch (e) {
    if (!session) throw e; // getIdToken signed out: the session was no longer good
  }
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
    if (data.refresh_token && data.refresh_token !== session.refreshToken) { session.refreshToken = data.refresh_token; saveSession(); }
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
