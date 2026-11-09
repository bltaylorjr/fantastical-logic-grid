// Passwords drop box: lock a login to the vault's public key (ECDH P-256 with a
// one-time key, HKDF-SHA-256, AES-GCM). Whoever locks it cannot open it again;
// only the owner's unlocked dashboard, which holds the private half, can.
// Shared by admin/vault.js (in the browser) and scripts/vault-drop.mjs (Node).
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const toB64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const INFO = enc.encode('flg-vault-drop-v1');

async function boxKey(priv, pub) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const base = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// A new drop box key pair: { pub (base64 SPKI), privPkcs8 (bytes) }.
export async function makeDropKeys() {
  const kp = await subtle().generateKey(EC, true, ['deriveBits']);
  return { pub: toB64(await subtle().exportKey('spki', kp.publicKey)), privPkcs8: new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey)) };
}

export async function importDropPrivate(pkcs8) {
  return subtle().importKey('pkcs8', pkcs8, EC, false, ['deriveBits']);
}

// Lock one login (a plain object) to the public key: { epk, iv, ct }.
export async function sealDrop(pubB64, login) {
  const pub = await subtle().importKey('spki', fromB64(pubB64), EC, false, []);
  const eph = await subtle().generateKey(EC, true, ['deriveBits']);
  const key = await boxKey(eph.privateKey, pub);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(login)));
  return { epk: toB64(await subtle().exportKey('spki', eph.publicKey)), iv: toB64(iv), ct: toB64(ct) };
}

export async function openDrop(privKey, row) {
  const epk = await subtle().importKey('spki', fromB64(row.epk), EC, false, []);
  const key = await boxKey(privKey, epk);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(row.iv) }, key, fromB64(row.ct));
  return JSON.parse(dec.decode(pt));
}
