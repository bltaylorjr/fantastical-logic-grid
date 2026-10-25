// Signs Firebase-shaped ID tokens with a throwaway RSA key, for tests only.
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function makeSigner(project) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return {
    jwks: { keys: [jwk] },
    token(claims, over = {}) {
      const now = Math.floor(Date.now() / 1000);
      const body = { iss: `https://securetoken.google.com/${project}`, aud: project, auth_time: now, iat: now, exp: now + 3600, ...claims, ...over };
      body.user_id = body.sub;
      const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
      const data = `${head}.${b64url(JSON.stringify(body))}`;
      const sig = createSign('RSA-SHA256').update(data).sign(privateKey);
      return `${data}.${b64url(sig)}`;
    },
  };
}
