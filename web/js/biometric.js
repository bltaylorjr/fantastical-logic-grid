// Fingerprint, face or device PIN sign-in on this device (Windows Hello, Touch
// ID, Face ID, Android fingerprint). The fingerprint or face never leaves the
// device and the game never sees it: the device checks it and only answers
// "yes, it's the owner".
//
// Browsers and the Windows app use a passkey made on this device (WebAuthn,
// platform authenticator, user verification required). The Android app has
// no WebAuthn in its WebView, so it asks Android's own BiometricPrompt through
// the native bridge (mobile/shared/native-bridge.js).
//
// What it unlocks: after the player turns it on, a session that was locked
// (idle sign-out) can be opened again with the device check instead of the
// password. The passkey is per device and per account, kept in localStorage
// `flg.bio` as { uid, email, id, key, alg }. It is only ever used on this device.
import * as store from './store.js';

const KEY = 'bio';
const TIMEOUT = 60_000;

const native = () => (window.FLGNative && window.FLGNative.biometric) || null;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export class BiometricError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const CANCELLED = 'The fingerprint or face check was cancelled. Try again, or use your password.';

let availability = null;
// True when this device can check a fingerprint, face or device PIN.
export function available() {
  if (!availability) {
    availability = (async () => {
      try {
        if (native()) return !!(await native().available());
        if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
        return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      } catch (e) { return false; }
    })();
  }
  return availability;
}

function saved() { const v = store.getLocal(KEY); return v && typeof v === 'object' && v.uid ? v : null; }

// The account that can sign in with the device check here, if any.
export function enrolledFor(uid) { const v = saved(); return !!(v && (!uid || v.uid === uid)); }
export function enrolledEmail() { const v = saved(); return v ? v.email : null; }

export function forget() { store.setLocal(KEY, undefined); }

// Turns it on for this account on this device. The device asks for the
// fingerprint, face or PIN once, to make the passkey.
export async function enroll(user) {
  if (!user) throw new BiometricError('SIGNED_OUT', 'Sign in first.');
  if (!(await available())) throw new BiometricError('UNAVAILABLE', 'This device cannot check a fingerprint or face.');
  if (native()) {
    if (!(await native().verify({ title: 'Turn on fingerprint or face sign-in', subtitle: user.email }))) throw new BiometricError('CANCELLED', CANCELLED);
    store.setLocal(KEY, { uid: user.uid, email: user.email, native: true });
    return;
  }
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'The Fantastical Logic Grid' },
        // A random handle, so the passkey never carries the account id.
        user: { id: random(16), name: user.email, displayName: user.email },
        challenge: random(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none',
        timeout: TIMEOUT,
      },
    });
  } catch (e) { throw new BiometricError('CANCELLED', CANCELLED); }
  if (!cred) throw new BiometricError('CANCELLED', CANCELLED);
  const r = cred.response;
  const key = typeof r.getPublicKey === 'function' ? r.getPublicKey() : null;
  const alg = typeof r.getPublicKeyAlgorithm === 'function' ? r.getPublicKeyAlgorithm() : null;
  // Without the public key the answer could not be checked, so do not turn it on.
  if (!key || !IMPORT[alg]) throw new BiometricError('UNAVAILABLE', 'This browser cannot use fingerprint or face sign-in. Try an up-to-date Chrome, Edge, Safari or Firefox.');
  store.setLocal(KEY, { uid: user.uid, email: user.email, id: cred.id, key: b64u(key), alg });
}

const IMPORT = {
  [-7]: [{ name: 'ECDSA', namedCurve: 'P-256' }, { name: 'ECDSA', hash: 'SHA-256' }],
  [-257]: [{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, { name: 'RSASSA-PKCS1-v1_5' }],
};

// WebAuthn ECDSA signatures are DER; WebCrypto wants r|s, 32 bytes each.
function derToRaw(der) {
  const read = (i) => { const len = der[i + 1]; let v = der.slice(i + 2, i + 2 + len); while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return [out, i + 2 + len]; };
  if (der[0] !== 0x30) throw new Error('bad signature');
  const [r, next] = read(2);
  const [s] = read(next);
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32);
  return raw;
}

// Checks the answer from the device: same passkey, same challenge, this
// site, the owner was verified (not just present), and a good signature.
async function check(v, cred, challenge) {
  if (!cred || cred.id !== v.id) return false;
  const r = cred.response;
  const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
  if (client.type !== 'webauthn.get' || client.challenge !== b64u(challenge) || client.origin !== location.origin) return false;
  const auth = new Uint8Array(r.authenticatorData);
  if (!(auth[32] & 0x04)) return false; // UV: the fingerprint, face or PIN was checked
  if (!v.key || !IMPORT[v.alg]) return false;
  const [importAlg, verifyAlg] = IMPORT[v.alg];
  const pub = await crypto.subtle.importKey('spki', unb64u(v.key), importAlg, false, ['verify']);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON));
  const signed = new Uint8Array(auth.length + hash.length); signed.set(auth); signed.set(hash, auth.length);
  let sig = new Uint8Array(r.signature);
  if (v.alg === -7) sig = derToRaw(sig);
  return crypto.subtle.verify(verifyAlg, pub, sig, signed);
}

// Asks the device for the fingerprint, face or PIN. Resolves true for the
// enrolled owner; throws BiometricError otherwise.
export async function verify(uid) {
  const v = saved();
  if (!v || (uid && v.uid !== uid)) throw new BiometricError('NOT_SET_UP', 'Fingerprint or face sign-in is not on for this account on this device.');
  // The platform decides the check, never the stored record.
  if (native()) {
    if (!v.native) throw new BiometricError('NOT_SET_UP', 'Fingerprint or face sign-in is not on for this account on this device.');
    if (!(await native().verify({ title: 'Sign in to The Fantastical Logic Grid', subtitle: v.email }))) throw new BiometricError('CANCELLED', CANCELLED);
    return true;
  }
  if (v.native || !v.id) throw new BiometricError('NOT_SET_UP', 'Fingerprint or face sign-in is not on for this account on this device.');
  const challenge = random(32);
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ type: 'public-key', id: unb64u(v.id) }], userVerification: 'required', timeout: TIMEOUT } });
  } catch (e) { throw new BiometricError('CANCELLED', CANCELLED); }
  let ok = false;
  try { ok = await check(v, cred, challenge); } catch (e) { ok = false; }
  if (!ok) throw new BiometricError('FAILED', 'The device could not confirm it is you. Use your password instead.');
  return true;
}
