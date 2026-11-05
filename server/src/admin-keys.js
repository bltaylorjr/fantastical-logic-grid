// Assistant keys: keys the owner makes in admin > Admins so a helper (such as
// Claude) can use the admin API without a game account or the break-glass
// token. Each key has a name, a role (viewer, moderator or admin; never
// owner), an end date of 1 to 90 days, and can be revoked at once. Only a hash
// is stored; the key is shown once. Every request made with a key goes into
// the audit log as "key: <name>".
//
// Admin routes (adminKeyRoutes, owner only, wired into admin.js):
//   GET  /admin/v1/admin-keys              the keys (never the keys themselves)
//   POST /admin/v1/admin-keys              { name, role, days } make one; the answer has the key, once
//   POST /admin/v1/admin-keys/:id/revoke   stop a key at once
export const KEY_PREFIX = 'flgk_';
const KEY_ROLES = ['viewer', 'moderator', 'admin'];
const DAY = 24 * 3600_000;
const MAX_DAYS = 90;
const MAX_ACTIVE = 10;
const USE_WRITE_GAP = 60_000; // last used is written at most once a minute per key

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newKey = () => KEY_PREFIX + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The key's name and role, or null when it is unknown, ended or revoked.
export async function checkKey(env, token, now = Date.now()) {
  if (!token.startsWith(KEY_PREFIX) || token.length < 40 || token.length > 80) return null;
  const row = await env.DB.prepare('SELECT id, name, role, expires_at AS expiresAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt FROM admin_keys WHERE hash = ?1').bind(await sha256(token)).first();
  if (!row || row.revokedAt || row.expiresAt <= now || !KEY_ROLES.includes(row.role)) return null;
  if (!row.lastUsedAt || now - row.lastUsedAt > USE_WRITE_GAP) {
    await env.DB.prepare('UPDATE admin_keys SET last_used_at = ?1, uses = uses + 1 WHERE id = ?2').bind(now, row.id).run();
  }
  return row;
}

const view = (r, now) => ({
  id: r.id, name: r.name, role: r.role, hint: r.hint, createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at, uses: r.uses, revokedAt: r.revoked_at, revokedBy: r.revoked_by,
  state: r.revoked_at ? 'revoked' : r.expires_at <= now ? 'ended' : 'active',
});

export function adminKeyRoutes(Refusal) {
  return [
    ['GET', /^admin-keys$/, 'owner', 'admin-keys.view', async ({ env, now }) => {
      const { results } = await env.DB.prepare('SELECT * FROM admin_keys ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 50').all();
      return { body: { keys: results.map((r) => view(r, now)), roles: KEY_ROLES, maxDays: MAX_DAYS }, quiet: true };
    }],
    ['POST', /^admin-keys$/, 'owner', 'admin-keys.create', async ({ env, body, who, now }) => {
      const name = String(body.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40);
      if (!name) throw new Refusal(400, 'bad_name', 'Give the key a name, for example "Claude".');
      if (!KEY_ROLES.includes(body.role)) throw new Refusal(400, 'bad_role', 'Choose viewer, moderator or admin.');
      const days = Math.floor(Number(body.days));
      if (!(days >= 1 && days <= MAX_DAYS)) throw new Refusal(400, 'bad_days', `Choose how long it works: 1 to ${MAX_DAYS} days.`);
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_keys WHERE revoked_at IS NULL AND expires_at > ?1').bind(now).first();
      if (n >= MAX_ACTIVE) throw new Refusal(409, 'too_many', `There are already ${MAX_ACTIVE} working keys. Revoke one first.`);
      const key = newKey();
      const r = await env.DB.prepare('INSERT INTO admin_keys (name, role, hash, hint, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id')
        .bind(name, body.role, await sha256(key), key.slice(-4), who.actor, now, now + days * DAY).first();
      // The key itself is in the answer only; the audit log gets the name and role.
      return { body: { ok: true, id: r.id, key, expiresAt: now + days * DAY }, target: r.id, detail: { name, role: body.role, days } };
    }],
    ['POST', /^admin-keys\/(\d+)\/revoke$/, 'owner', 'admin-keys.revoke', async ({ env, params: [id], who, now }) => {
      const r = await env.DB.prepare('UPDATE admin_keys SET revoked_at = ?1, revoked_by = ?2 WHERE id = ?3 AND revoked_at IS NULL').bind(now, who.actor, Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That key is already revoked.');
      return { body: { ok: true }, target: id };
    }],
  ];
}
