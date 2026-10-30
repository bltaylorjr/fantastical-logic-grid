// Face ID and fingerprint sign-in for the admin dashboard, with passkeys
// (WebAuthn, https://www.w3.org/TR/webauthn-2/). The phone keeps the private
// key and only unlocks it with the admin's face or finger; this Worker keeps
// the public key and checks each sign-in's signature with WebCrypto, so no
// library or paid service is involved.
//
// A passkey sign-in gives a dashboard session: a random key the browser sends
// as its bearer token. Only its SHA-256 is stored (admin_sessions). It ends
// after SESSION_MAX_MS, after IDLE_MS without a request, on sign-out, or when
// the passkey or the admin is removed. The admin's role is looked up on every
// request, as for a password sign-in.
//
//   POST /admin/v1/passkeys/sign-in/options   a one-time challenge (no sign-in needed)
//   POST /admin/v1/passkeys/sign-in           the phone's signed answer -> { token, email, expiresAt }
//   POST /admin/v1/passkeys/options           set up this device: what the phone needs (signed in recently)
//   POST /admin/v1/passkeys/register          the new passkey's public key
//   GET  /admin/v1/passkeys                   this admin's passkeys; POST .../:id/remove
//   POST /admin/v1/session/end                sign out a passkey session

export const SESSION_PREFIX = 'flgp.';
export const SESSION_MAX_MS = 12 * 3600_000;
export const IDLE_MS = 30 * 60_000;
// Setting up a new device needs a sign-in from the last 15 minutes, so a
// dashboard left open cannot quietly gain someone else's passkey.
export const FRESH_MS = 15 * 60_000;
const CHALLENGE_MS = 5 * 60_000;
const SEEN_EVERY_MS = 60_000; // last_seen is written at most once a minute per session
const MAX_PER_ADMIN = 10;
const RP_NAME = 'The Fantastical Logic Grid Admin';

export class PasskeyError extends Error {
  constructor(status, error, message) { super(message || error); this.status = status; this.error = error; }
}

// ------------------------------------------------------------- bytes
export function fromB64url(s) {
  if (typeof s !== 'string' || !/^[\w-]*$/.test(s)) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function toB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomKey = (n = 32) => toB64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const tokenHash = async (token) => hex(await sha256(new TextEncoder().encode(token)));
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// A small CBOR reader (RFC 8949): enough for attestation objects and COSE keys.
export function decodeCbor(bytes) {
  let at = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (n) => { if (at + n > bytes.length) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was cut short.'); };
  const length = (info) => {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4 }[info];
    if (!size) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.');
    need(size);
    const v = size === 1 ? view.getUint8(at) : size === 2 ? view.getUint16(at) : view.getUint32(at);
    at += size;
    return v;
  };
  const item = (depth) => {
    if (depth > 8) throw new PasskeyError(400, 'bad_passkey');
    need(1);
    const first = bytes[at++];
    const type = first >> 5;
    const info = first & 31;
    if (type === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.');
    }
    const n = length(info);
    if (type === 0) return n;
    if (type === 1) return -1 - n;
    if (type === 2 || type === 3) {
      need(n);
      const b = bytes.subarray(at, at + n);
      at += n;
      return type === 2 ? b : new TextDecoder().decode(b);
    }
    if (type === 4) return Array.from({ length: n }, () => item(depth + 1));
    if (type === 5) {
      const m = new Map();
      for (let i = 0; i < n; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); }
      return m;
    }
    throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.');
  };
  const value = item(0);
  return { value, used: at };
}

// COSE public key -> a JWK WebCrypto can import. ES256 (most phones) and RS256 (Windows Hello).
export function coseToJwk(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: toB64url(cose.get(-2)), y: toB64url(cose.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: toB64url(cose.get(-1)), e: toB64url(cose.get(-2)) } };
  throw new PasskeyError(400, 'unsupported_passkey', 'This device offered a kind of passkey the dashboard does not know.');
}

// WebAuthn ECDSA signatures are DER; WebCrypto wants r and s side by side.
function derToRaw(der) {
  const int = (at) => {
    if (der[at] !== 0x02) throw new PasskeyError(400, 'bad_passkey');
    const len = der[at + 1];
    let v = der.subarray(at + 2, at + 2 + len);
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return { v: out, next: at + 2 + len };
  };
  if (der[0] !== 0x30) throw new PasskeyError(400, 'bad_passkey');
  const r = int(2);
  const s = int(r.next);
  const raw = new Uint8Array(64);
  raw.set(r.v, 0);
  raw.set(s.v, 32);
  return raw;
}

async function verifySignature(alg, jwk, signature, data) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), data);
  }
  const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}

// ------------------------------------------------------------- checks
async function takeChallenge(env, clientData, purpose, email, now) {
  const challenge = String(clientData.challenge || '');
  if (!challenge || challenge.length > 100) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.');
  const row = await env.DB.prepare('DELETE FROM admin_challenges WHERE challenge = ?1 RETURNING purpose, email, expires_at').bind(challenge).first();
  if (!row || row.purpose !== purpose || row.expires_at < now || (email && row.email !== email)) {
    throw new PasskeyError(401, 'passkey_expired', 'That took too long. Please try again.');
  }
}

function readClientData(b64, type, url) {
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(b64))); } catch (e) { throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.'); }
  if (data.type !== type) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was for something else.');
  // Only the dashboard's own page may use its passkeys.
  if (data.origin !== url.origin) throw new PasskeyError(400, 'wrong_site', 'That passkey answer came from another website.');
  return data;
}

// authenticatorData: rpIdHash(32) flags(1) signCount(4) [attested credential data]
async function readAuthData(auth, url, { attested = false } = {}) {
  if (auth.length < 37) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was cut short.');
  if (!sameBytes(auth.subarray(0, 32), await sha256(new TextEncoder().encode(url.hostname)))) throw new PasskeyError(400, 'wrong_site', 'That passkey belongs to another website.');
  const flags = auth[32];
  // User present (0x01) and user verified (0x04): the face, finger or device PIN really was checked.
  if (!(flags & 0x01) || !(flags & 0x04)) throw new PasskeyError(401, 'not_verified', 'Your phone did not check your face, fingerprint or PIN. Please try again.');
  const signCount = new DataView(auth.buffer, auth.byteOffset + 33, 4).getUint32(0);
  if (!attested) return { signCount };
  if (!(flags & 0x40)) throw new PasskeyError(400, 'bad_passkey', 'The new passkey was missing.');
  const idLen = new DataView(auth.buffer, auth.byteOffset + 53, 2).getUint16(0);
  const credentialId = auth.subarray(55, 55 + idLen);
  if (credentialId.length !== idLen || idLen > 1023) throw new PasskeyError(400, 'bad_passkey', 'The new passkey was cut short.');
  const { value: cose } = decodeCbor(auth.subarray(55 + idLen));
  if (!(cose instanceof Map)) throw new PasskeyError(400, 'bad_passkey');
  return { signCount, credentialId, ...coseToJwk(cose) };
}

const deviceName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : '') || 'This device';

// ------------------------------------------------------------- sign-in
export async function signInOptions(env, url, now = Date.now()) {
  const challenge = randomKey();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_challenges WHERE expires_at < ?1').bind(now),
    env.DB.prepare('INSERT INTO admin_challenges (challenge, purpose, email, expires_at) VALUES (?1, ?2, NULL, ?3)').bind(challenge, 'get', now + CHALLENGE_MS),
  ]);
  // The browser names the passkey it remembers (allowCredentials); the Worker
  // never says which emails have one.
  return { challenge, rpId: url.hostname, timeout: CHALLENGE_MS, userVerification: 'required' };
}

// Returns { email, passkeyId } for a good answer, or throws PasskeyError.
export async function checkSignIn(env, url, body, now = Date.now()) {
  const id = typeof body.id === 'string' ? body.id.slice(0, 1400) : '';
  if (!id) throw new PasskeyError(400, 'bad_passkey', 'That passkey answer was not readable.');
  const clientBytes = fromB64url(String(body.clientDataJSON || ''));
  const clientData = readClientData(body.clientDataJSON, 'webauthn.get', url);
  await takeChallenge(env, clientData, 'get', null, now);
  const auth = fromB64url(String(body.authenticatorData || ''));
  const { signCount } = await readAuthData(auth, url);
  const row = await env.DB.prepare('SELECT id, email, public_key, alg, sign_count FROM admin_passkeys WHERE id = ?1').bind(id).first();
  if (!row) throw new PasskeyError(401, 'unknown_passkey', 'This passkey is not set up for the dashboard any more. Sign in with your password, then set up Face ID or fingerprint again.');
  const data = new Uint8Array(auth.length + 32);
  data.set(auth, 0);
  data.set(await sha256(clientBytes), auth.length);
  let ok = false;
  try { ok = await verifySignature(row.alg, JSON.parse(row.public_key), fromB64url(String(body.signature || '')), data); } catch (e) { if (e instanceof PasskeyError) throw e; ok = false; }
  if (!ok) throw new PasskeyError(401, 'bad_signature', 'That passkey answer did not check out. Please try again.');
  // Phones that count sign-ins must count up; a count that goes back means a copied key.
  if (row.sign_count > 0 && signCount <= row.sign_count) throw new PasskeyError(401, 'copied_passkey', 'This passkey looks copied, so it was refused. Sign in with your password.');
  await env.DB.prepare('UPDATE admin_passkeys SET sign_count = ?2, last_used_at = ?3 WHERE id = ?1').bind(id, signCount, now).run();
  return { email: row.email, passkeyId: id };
}

export async function startSession(env, email, passkeyId, now = Date.now()) {
  const token = SESSION_PREFIX + randomKey();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?1 OR last_seen < ?2').bind(now, now - IDLE_MS),
    env.DB.prepare('INSERT INTO admin_sessions (token_hash, email, passkey_id, created_at, last_seen, expires_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5)')
      .bind(await tokenHash(token), email, passkeyId, now, now + SESSION_MAX_MS),
  ]);
  return { token, email, expiresAt: now + SESSION_MAX_MS, idleMinutes: IDLE_MS / 60_000 };
}

// Returns { email, hash, createdAt } for a live session, or throws PasskeyError (401).
export async function checkSession(env, token, now = Date.now()) {
  const hash = await tokenHash(token);
  const row = await env.DB.prepare('SELECT email, created_at, last_seen, expires_at FROM admin_sessions WHERE token_hash = ?1').bind(hash).first();
  if (!row) throw new PasskeyError(401, 'sign_in', 'Please sign in again.');
  if (row.expires_at < now) throw new PasskeyError(401, 'sign_in', 'For safety, please sign in again.');
  if (now - row.last_seen > IDLE_MS) throw new PasskeyError(401, 'locked', 'Locked after 30 minutes without activity.');
  if (now - row.last_seen > SEEN_EVERY_MS) await env.DB.prepare('UPDATE admin_sessions SET last_seen = ?2 WHERE token_hash = ?1').bind(hash, now).run();
  return { email: row.email, hash, createdAt: row.created_at };
}

export const endSessionStatement = (env, hash) => env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(hash);

// When an admin is removed, their passkeys and sessions go too.
export const forgetAdminStatements = (env, email) => [
  env.DB.prepare('DELETE FROM admin_passkeys WHERE email = ?1').bind(email),
  env.DB.prepare('DELETE FROM admin_sessions WHERE email = ?1').bind(email),
];

// ------------------------------------------------------------- set up a device
// who: the signed-in admin from admin.js identify(): { actor (email), signedInAt (ms) }.
function canAdd(who, now) {
  if (!String(who.actor).includes('@')) throw new PasskeyError(403, 'needs_account', 'Face ID and fingerprint sign-in is for admin accounts, not the break-glass key.');
  if (!(now - who.signedInAt < FRESH_MS)) throw new PasskeyError(403, 'sign_in_again', 'For safety, sign out and sign in again with your password, then set up Face ID or fingerprint within 15 minutes.');
}

export async function registerOptions(env, url, who, now = Date.now()) {
  canAdd(who, now);
  const email = who.actor;
  const { results } = await env.DB.prepare('SELECT id FROM admin_passkeys WHERE email = ?1').bind(email).all();
  if (results.length >= MAX_PER_ADMIN) throw new PasskeyError(409, 'too_many', `You have ${MAX_PER_ADMIN} devices set up. Remove one first.`);
  const challenge = randomKey();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_challenges WHERE expires_at < ?1').bind(now),
    env.DB.prepare('INSERT INTO admin_challenges (challenge, purpose, email, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(challenge, 'create', email, now + CHALLENGE_MS),
  ]);
  return {
    challenge,
    rp: { id: url.hostname, name: RP_NAME },
    // The same user id every time, so a phone replaces its old passkey for this admin instead of adding another.
    user: { id: toB64url((await sha256(new TextEncoder().encode(`flg-admin|${email}`))).subarray(0, 16)), name: email, displayName: email },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    excludeCredentials: results.map((r) => ({ type: 'public-key', id: r.id })),
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    attestation: 'none',
    timeout: CHALLENGE_MS,
  };
}

export async function register(env, url, who, body, now = Date.now()) {
  canAdd(who, now);
  const email = who.actor;
  const clientData = readClientData(body.clientDataJSON, 'webauthn.create', url);
  await takeChallenge(env, clientData, 'create', email, now);
  let attestation;
  try { attestation = decodeCbor(fromB64url(String(body.attestationObject || ''))).value; } catch (e) { throw new PasskeyError(400, 'bad_passkey', 'The new passkey was not readable.'); }
  const authData = attestation instanceof Map ? attestation.get('authData') : null;
  if (!(authData instanceof Uint8Array)) throw new PasskeyError(400, 'bad_passkey', 'The new passkey was not readable.');
  const cred = await readAuthData(authData, url, { attested: true });
  const id = toB64url(cred.credentialId);
  if (body.id !== id) throw new PasskeyError(400, 'bad_passkey', 'The new passkey did not match.');
  const taken = await env.DB.prepare('SELECT email FROM admin_passkeys WHERE id = ?1').bind(id).first();
  if (taken && taken.email !== email) throw new PasskeyError(409, 'bad_passkey', 'That passkey belongs to someone else.');
  const device = deviceName(body.device);
  await env.DB.prepare('INSERT OR REPLACE INTO admin_passkeys (id, email, public_key, alg, sign_count, device, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)')
    .bind(id, email, JSON.stringify(cred.jwk), cred.alg, cred.signCount, device, now).run();
  return { id, device, createdAt: now };
}

export async function listPasskeys(env, email) {
  const { results } = await env.DB.prepare('SELECT id, device, created_at, last_used_at FROM admin_passkeys WHERE email = ?1 ORDER BY created_at').bind(email).all();
  return results.map((r) => ({ id: r.id, device: r.device, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export async function removePasskey(env, email, id) {
  const res = await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_passkeys WHERE id = ?1 AND email = ?2').bind(id, email),
    env.DB.prepare('DELETE FROM admin_sessions WHERE passkey_id = ?1 AND email = ?2').bind(id, email),
  ]);
  if (!res[0].meta?.changes) throw new PasskeyError(404, 'not_found', 'That device is not set up.');
}
