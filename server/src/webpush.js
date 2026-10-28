// Web Push for the owner's alerts (alerts.js): VAPID sign-in (RFC 8292) and
// message encryption (RFC 8291, aes128gcm), using only the Worker's built-in
// WebCrypto, so no library or paid service is needed. The browser's own push
// service (Google, Apple or Mozilla) delivers the message to the device.
//
// The VAPID key pair is made once and kept in the alert_keys table; nothing
// needs setting up by hand.

const enc = new TextEncoder();

export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(text) {
  const s = String(text).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// A P-256 public key (65 bytes, uncompressed) and optional private d as a JWK.
function ecJwk(publicRaw, d) {
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(publicRaw.slice(1, 33)), y: b64u(publicRaw.slice(33, 65)), ext: true };
  if (d) jwk.d = typeof d === 'string' ? d : b64u(d);
  return jwk;
}

// Encrypt `payload` (a string or bytes) for one subscription ({ p256dh, auth },
// both base64url). `testKeys` ({ publicRaw, privateD, salt }) fixes the random
// parts so the RFC 8291 example can be checked; leave it out otherwise.
export async function encryptPayload(payload, sub, testKeys = null) {
  const plain = typeof payload === 'string' ? enc.encode(payload) : new Uint8Array(payload);
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad_subscription');

  let asPublic, asPrivate;
  if (testKeys) {
    asPublic = testKeys.publicRaw;
    asPrivate = await crypto.subtle.importKey('jwk', ecJwk(asPublic, testKeys.privateD), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    asPrivate = pair.privateKey;
  }
  const salt = testKeys?.salt || crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const rs = 4096;
  if (plain.length + 1 + 16 > rs) throw new Error('too_long');
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plain, Uint8Array.of(2))));
  const header = concat(salt, Uint8Array.of(0, 0, (rs >> 8) & 255, rs & 255), Uint8Array.of(asPublic.length), asPublic);
  return concat(header, cipher);
}

// A new VAPID key pair: { publicKey (base64url raw, for the browser), privateJwk }.
export async function newVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateJwk };
}

// The Authorization header for one push service: a signed ES256 token that
// says who is sending (subject, a mailto: or https: address).
export async function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// Send one push. Returns { ok, gone } where gone means the device turned
// alerts off (or the subscription expired) and should be forgotten.
export async function sendPush(sub, payload, keys, subject, { urgency = 'normal', ttl = 24 * 3600 } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
