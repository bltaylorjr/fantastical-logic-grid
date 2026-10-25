// Checks Firebase Auth ID tokens (RS256 JWTs) with WebCrypto, as described in
// https://firebase.google.com/docs/auth/admin/verify-id-tokens. Firebase keeps
// the emails and passwords; this Worker only learns the player's uid.

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SKEW = 300; // seconds of clock difference we accept

export class AuthError extends Error {}

let cache = { keys: null, until: 0 };

async function signingKeys(env, force = false) {
  // Tests sign their own tokens and pass the matching public key here.
  if (env.TEST_JWKS) return JSON.parse(env.TEST_JWKS).keys;
  if (!force && cache.keys && Date.now() < cache.until) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Could not load the sign-in keys');
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const { keys } = await res.json();
  cache = { keys, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
}

function b64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

// Returns { uid, email, authTime } or throws AuthError.
export async function verifyIdToken(token, env) {
  const project = env.FIREBASE_PROJECT_ID;
  if (!project || project.startsWith('REPLACE')) throw new Error('FIREBASE_PROJECT_ID is not set');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  let header, claims;
  try { header = decodeJson(parts[0]); claims = decodeJson(parts[1]); } catch (e) { throw new AuthError('Malformed token'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('Wrong token type');

  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) throw new AuthError('Token is for another project');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new AuthError('Token expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + SKEW) throw new AuthError('Token issued in the future');
  if (typeof claims.auth_time !== 'number' || claims.auth_time > now + SKEW) throw new AuthError('Bad sign-in time');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new AuthError('No user in token');

  let jwk = (await signingKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await signingKeys(env, true)).find((k) => k.kid === header.kid); // keys rotate
  if (!jwk) throw new AuthError('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AuthError('Bad signature');
  return { uid: claims.sub, email: claims.email || null, authTime: claims.auth_time };
}
