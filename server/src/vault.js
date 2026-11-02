// Passwords: the owner's password manager in the admin app (admin/vault.js).
//
// Zero-knowledge by design. The dashboard locks every login on the owner's
// device (AES-GCM with a random vault key; the vault key is locked with a key
// made from the master password, PBKDF2-SHA-256). This Worker only ever sees
// and stores base64 scrambled text, so a copy of the database, the break-glass
// key or an assistant key reveals nothing. The audit log records that the
// vault was opened or changed, never what is in it.
//
// Only the owner, signed in as themselves (not the break-glass key, not an
// assistant key, not a scheduled job), can use these routes.
//
// Admin routes (vaultRoutes, wired into admin.js):
//   GET  /admin/v1/vault                     { meta | null, items: [...] } (the bin empties after 30 days)
//   POST /admin/v1/vault/setup               { salt, iterations, keyIv, keyCt } first time only
//   POST /admin/v1/vault/master              { salt, iterations, keyIv, keyCt } new master password (same vault key)
//   POST /admin/v1/vault/items               { items: [{ iv, ct }] } add 1 to 40 logins
//   POST /admin/v1/vault/items/:id           { iv, ct } change one
//   POST /admin/v1/vault/items/:id/bin       move to the bin
//   POST /admin/v1/vault/items/:id/restore   back out of the bin
//   POST /admin/v1/vault/items/:id/purge     delete for good
//   POST /admin/v1/vault/reset               { confirm: 'DELETE' } wipe the whole vault (forgotten master password)
const DAY = 24 * 3600_000;
export const VAULT_BIN_DAYS = 30;
export const VAULT_MAX_ITEMS = 2000;
export const VAULT_ITEM_CHARS = 48_000; // one login, scrambled and in base64 (notes and extra fields included)
const ADD_MAX = 40; // per request, so an import stays inside D1's queries per request
const MIN_ITERATIONS = 310_000;
const MAX_ITERATIONS = 5_000_000;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const b64 = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max && B64.test(v);

function ownerOnly(who, Refusal) {
  if (who.role !== 'owner' || !String(who.actor).includes('@')) {
    throw new Refusal(403, 'owner_only', 'Passwords open only for the owner, signed in with their own account.');
  }
}

function checkMeta(body, Refusal) {
  const iterations = Math.floor(Number(body.iterations));
  if (!b64(body.salt, 16, 64) || !(iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS) || !b64(body.keyIv, 16, 24) || !b64(body.keyCt, 40, 120)) {
    throw new Refusal(400, 'bad_vault', 'The vault key was not sent in the right form.');
  }
  return { salt: body.salt, iterations, keyIv: body.keyIv, keyCt: body.keyCt };
}

function checkItem(it, Refusal) {
  if (!it || !b64(it.iv, 16, 24) || !b64(it.ct, 24, VAULT_ITEM_CHARS)) throw new Refusal(400, 'bad_item', 'That login is too big or was not sent in the right form.');
  return { iv: it.iv, ct: it.ct };
}

const metaView = (m) => m && { salt: m.salt, iterations: m.iterations, keyIv: m.key_iv, keyCt: m.key_ct, createdAt: m.created_at, updatedAt: m.updated_at };

export function vaultRoutes(Refusal) {
  const big = { maxBody: VAULT_ITEM_CHARS * ADD_MAX + 4_000 };
  const one = { maxBody: VAULT_ITEM_CHARS + 2_000 };
  return [
    ['GET', /^vault$/, 'owner', 'vault.open', async ({ env, who, now }) => {
      ownerOnly(who, Refusal);
      const [, meta, items] = await env.DB.batch([
        env.DB.prepare('DELETE FROM vault_items WHERE deleted_at IS NOT NULL AND deleted_at < ?1').bind(now - VAULT_BIN_DAYS * DAY),
        env.DB.prepare('SELECT * FROM vault_meta WHERE id = 1'),
        env.DB.prepare('SELECT id, iv, ct, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM vault_items ORDER BY id'),
      ]);
      return { body: { meta: metaView(meta.results[0] || null), items: items.results, binDays: VAULT_BIN_DAYS, maxItems: VAULT_MAX_ITEMS } };
    }],
    ['POST', /^vault\/setup$/, 'owner', 'vault.setup', async ({ env, who, body, now }) => {
      ownerOnly(who, Refusal);
      const m = checkMeta(body, Refusal);
      const r = await env.DB.prepare('INSERT OR IGNORE INTO vault_meta (id, salt, iterations, key_iv, key_ct, created_at, updated_at) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?5)')
        .bind(m.salt, m.iterations, m.keyIv, m.keyCt, now).run();
      if (!r.meta.changes) throw new Refusal(409, 'exists', 'The vault is already set up. Reload the page.');
      return { body: { ok: true } };
    }],
    ['POST', /^vault\/master$/, 'owner', 'vault.master', async ({ env, who, body, now }) => {
      ownerOnly(who, Refusal);
      const m = checkMeta(body, Refusal);
      const r = await env.DB.prepare('UPDATE vault_meta SET salt = ?1, iterations = ?2, key_iv = ?3, key_ct = ?4, updated_at = ?5 WHERE id = 1')
        .bind(m.salt, m.iterations, m.keyIv, m.keyCt, now).run();
      if (!r.meta.changes) throw new Refusal(404, 'no_vault', 'Set up the vault first.');
      return { body: { ok: true } };
    }],
    ['POST', /^vault\/items$/, 'owner', 'vault.add', async ({ env, who, body, now }) => {
      ownerOnly(who, Refusal);
      const list = Array.isArray(body.items) ? body.items : [];
      if (!list.length || list.length > ADD_MAX) throw new Refusal(400, 'bad_items', `Send 1 to ${ADD_MAX} logins at a time.`);
      const items = list.map((it) => checkItem(it, Refusal));
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_items').first();
      if (n + items.length > VAULT_MAX_ITEMS) throw new Refusal(409, 'full', `The vault holds up to ${VAULT_MAX_ITEMS} logins. Empty the bin or remove some first.`);
      const res = await env.DB.batch(items.map((it) => env.DB.prepare('INSERT INTO vault_items (iv, ct, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) RETURNING id').bind(it.iv, it.ct, now)));
      return { body: { ok: true, ids: res.map((x) => x.results[0].id), at: now }, detail: { added: items.length } };
    }, big],
    ['POST', /^vault\/items\/(\d+)$/, 'owner', 'vault.change', async ({ env, who, body, params: [id], now }) => {
      ownerOnly(who, Refusal);
      const it = checkItem(body, Refusal);
      const r = await env.DB.prepare('UPDATE vault_items SET iv = ?1, ct = ?2, updated_at = ?3 WHERE id = ?4').bind(it.iv, it.ct, now, Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That login is not in the vault any more.');
      return { body: { ok: true, at: now }, target: id };
    }, one],
    ['POST', /^vault\/items\/(\d+)\/bin$/, 'owner', 'vault.bin', async ({ env, who, params: [id], now }) => {
      ownerOnly(who, Refusal);
      const r = await env.DB.prepare('UPDATE vault_items SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(now, Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That login is already in the bin.');
      return { body: { ok: true, at: now }, target: id };
    }],
    ['POST', /^vault\/items\/(\d+)\/restore$/, 'owner', 'vault.restore', async ({ env, who, params: [id] }) => {
      ownerOnly(who, Refusal);
      const r = await env.DB.prepare('UPDATE vault_items SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That login is not in the bin.');
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^vault\/items\/(\d+)\/purge$/, 'owner', 'vault.purge', async ({ env, who, params: [id] }) => {
      ownerOnly(who, Refusal);
      const r = await env.DB.prepare('DELETE FROM vault_items WHERE id = ?1 AND deleted_at IS NOT NULL').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'Only logins in the bin can be deleted for good.');
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^vault\/reset$/, 'owner', 'vault.reset', async ({ env, who, body }) => {
      ownerOnly(who, Refusal);
      if (body.confirm !== 'DELETE') throw new Refusal(400, 'confirm', 'Type DELETE to wipe the vault.');
      const [items] = await env.DB.batch([env.DB.prepare('DELETE FROM vault_items'), env.DB.prepare('DELETE FROM vault_meta')]);
      return { body: { ok: true }, detail: { removed: items.meta.changes } };
    }],
  ];
}
