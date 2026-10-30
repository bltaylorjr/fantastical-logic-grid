// Web Push encryption and VAPID signing: run with `npm test` in server/.
// The encryption is checked against the worked example in RFC 8291 Appendix A.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, b64u, fromB64u, newVapidKeys, vapidAuth } from '../src/webpush.js';

test('encryption matches the RFC 8291 example exactly', async () => {
  const out = await encryptPayload(fromB64u('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'), {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, {
    publicRaw: fromB64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
    privateD: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: fromB64u('DGv6ra1nlYgDCS1FRnbzlw'),
  });
  // The RFC gives the 86-byte header and the ciphertext separately.
  assert.equal(b64u(out.slice(0, 86)), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  assert.equal(b64u(out.slice(86)), '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ');
});

test('a VAPID token is signed with the stored key and names the push service', async () => {
  const keys = await newVapidKeys();
  assert.equal(fromB64u(keys.publicKey).length, 65);
  const auth = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:owner@example.com', Date.UTC(2026, 0, 1));
  const m = auth.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, auth);
  const claims = JSON.parse(new TextDecoder().decode(fromB64u(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:owner@example.com');
  assert.equal(m[4], keys.publicKey);
  const pub = await crypto.subtle.importKey('raw', fromB64u(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)));
});
