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
//   POST /admin/v1/vault/devices             { credId, label, prfSalt, keyIv, keyCt } unlock with Face ID or fingerprint on a device
//   POST /admin/v1/vault/devices/:id/used    note the last unlock
//   POST /admin/v1/vault/devices/:id/remove  stop that device unlocking with Face ID or fingerprint
//   POST /admin/v1/vault/drop-key            { pub, privIv, privCt } the drop box key pair (owner's dashboard)
//   POST /admin/v1/vault/inbox               { epk, iv, ct, source } add a locked login to the drop box
//                                            (any admin, the break-glass key or an assistant key: they can add, never read)
//   POST /admin/v1/vault/inbox/:id/done      the dashboard moved it into the vault
// Public: GET /v1/vault-drop-key             { pub } the drop box's public key (safe to share; it can only lock)
const DAY = 24 * 3600_000;
export const VAULT_BIN_DAYS = 30;
export const VAULT_MAX_ITEMS = 2000;
export const VAULT_ITEM_CHARS = 48_000; // one login, scrambled and in base64 (notes and extra fields included)
const ADD_MAX = 40; // per request, so an import stays inside D1's queries per request
const MIN_ITERATIONS = 310_000;
const MAX_ITERATIONS = 5_000_000;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const B64URL = /^[A-Za-z0-9_-]{16,1400}$/;
export const VAULT_MAX_DEVICES = 10;
export const VAULT_INBOX_MAX = 200;

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

const metaView = (m) => m && { salt: m.salt, iterations: m.iterations, keyIv: m.key_iv, keyCt: m.key_ct, dropPub: m.drop_pub || null, dropPrivIv: m.drop_priv_iv || null, dropPrivCt: m.drop_priv_ct || null, createdAt: m.created_at, updatedAt: m.updated_at };

// GET /v1/vault-drop-key (no sign-in): the public half of the drop box key.
export async function handleVaultDropKey(env) {
  const m = await env.DB.prepare('SELECT drop_pub FROM vault_meta WHERE id = 1').first();
  return m?.drop_pub ? { status: 200, body: { pub: m.drop_pub } } : { status: 404, body: { error: 'no_drop_box', message: 'Open Passwords in the admin app once to turn on the drop box.' } };
}

export function vaultRoutes(Refusal) {
  const big = { maxBody: VAULT_ITEM_CHARS * ADD_MAX + 4_000 };
  const one = { maxBody: VAULT_ITEM_CHARS + 2_000 };
  return [
    ['GET', /^vault$/, 'owner', 'vault.open', async ({ env, who, now }) => {
      ownerOnly(who, Refusal);
      const [, meta, items, devices, inbox] = await env.DB.batch([
        env.DB.prepare('DELETE FROM vault_items WHERE deleted_at IS NOT NULL AND deleted_at < ?1').bind(now - VAULT_BIN_DAYS * DAY),
        env.DB.prepare('SELECT * FROM vault_meta WHERE id = 1'),
        env.DB.prepare('SELECT id, iv, ct, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM vault_items ORDER BY id'),
        env.DB.prepare('SELECT id, cred_id AS credId, label, prf_salt AS prfSalt, key_iv AS keyIv, key_ct AS keyCt, created_at AS createdAt, last_used_at AS lastUsedAt FROM vault_devices ORDER BY created_at'),
        env.DB.prepare('SELECT id, epk, iv, ct, source, created_at AS createdAt FROM vault_inbox ORDER BY id'),
      ]);
      return { body: { meta: metaView(meta.results[0] || null), items: items.results, devices: devices.results, inbox: inbox.results, binDays: VAULT_BIN_DAYS, maxItems: VAULT_MAX_ITEMS } };
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
    ['POST', /^vault\/devices$/, 'owner', 'vault.device-add', async ({ env, who, body, now }) => {
      ownerOnly(who, Refusal);
      const label = String(body.label || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) || 'Device';
      if (!B64URL.test(String(body.credId || '')) || !b64(body.prfSalt, 40, 48) || !b64(body.keyIv, 16, 24) || !b64(body.keyCt, 40, 120)) {
        throw new Refusal(400, 'bad_device', 'The device key was not sent in the right form.');
      }
      if (!(await env.DB.prepare('SELECT 1 FROM vault_meta WHERE id = 1').first())) throw new Refusal(404, 'no_vault', 'Set up the vault first.');
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_devices').first();
      if (n >= VAULT_MAX_DEVICES) throw new Refusal(409, 'too_many', `Up to ${VAULT_MAX_DEVICES} devices. Remove one first.`);
      const r = await env.DB.prepare('INSERT INTO vault_devices (cred_id, label, prf_salt, key_iv, key_ct, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(cred_id) DO UPDATE SET label = ?2, prf_salt = ?3, key_iv = ?4, key_ct = ?5 RETURNING id')
        .bind(body.credId, label, body.prfSalt, body.keyIv, body.keyCt, now).first();
      return { body: { ok: true, id: r.id }, target: r.id, detail: { label } };
    }],
    ['POST', /^vault\/devices\/(\d+)\/used$/, 'owner', 'vault.device-unlock', async ({ env, who, params: [id], now }) => {
      ownerOnly(who, Refusal);
      await env.DB.prepare('UPDATE vault_devices SET last_used_at = ?1 WHERE id = ?2').bind(now, Number(id)).run();
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^vault\/devices\/(\d+)\/remove$/, 'owner', 'vault.device-remove', async ({ env, who, params: [id] }) => {
      ownerOnly(who, Refusal);
      const r = await env.DB.prepare('DELETE FROM vault_devices WHERE id = ?1').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That device was already removed.');
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^vault\/drop-key$/, 'owner', 'vault.drop-key', async ({ env, who, body, now }) => {
      ownerOnly(who, Refusal);
      if (!b64(body.pub, 80, 200) || !b64(body.privIv, 16, 24) || !b64(body.privCt, 100, 400)) throw new Refusal(400, 'bad_key', 'The drop box key was not sent in the right form.');
      const r = await env.DB.prepare('UPDATE vault_meta SET drop_pub = ?1, drop_priv_iv = ?2, drop_priv_ct = ?3, updated_at = ?4 WHERE id = 1').bind(body.pub, body.privIv, body.privCt, now).run();
      if (!r.meta.changes) throw new Refusal(404, 'no_vault', 'Set up the vault first.');
      return { body: { ok: true } };
    }],
    // Write-only: anyone with admin rights (an admin, the break-glass key, an
    // assistant key) can drop a login locked to the public key; nobody but the
    // owner's unlocked dashboard can open it.
    ['POST', /^vault\/inbox$/, 'admin', 'vault.drop', async ({ env, who, body, now }) => {
      if (!b64(body.epk, 80, 200) || !b64(body.iv, 16, 24) || !b64(body.ct, 24, VAULT_ITEM_CHARS)) throw new Refusal(400, 'bad_item', 'That login is too big or was not locked in the right form.');
      const source = String(body.source || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) || String(who.actor).slice(0, 60);
      if (!(await env.DB.prepare('SELECT 1 FROM vault_meta WHERE id = 1 AND drop_pub IS NOT NULL').first())) throw new Refusal(404, 'no_drop_box', 'Open Passwords in the admin app once to turn on the drop box.');
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_inbox').first();
      if (n >= VAULT_INBOX_MAX) throw new Refusal(409, 'full', 'The drop box is full. Unlock Passwords to empty it.');
      const r = await env.DB.prepare('INSERT INTO vault_inbox (epk, iv, ct, source, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id').bind(body.epk, body.iv, body.ct, source, now).first();
      return { body: { ok: true, id: r.id }, target: r.id, detail: { source } };
    }, one],
    ['POST', /^vault\/inbox\/(\d+)\/done$/, 'owner', 'vault.drop-done', async ({ env, who, params: [id] }) => {
      ownerOnly(who, Refusal);
      await env.DB.prepare('DELETE FROM vault_inbox WHERE id = ?1').bind(Number(id)).run();
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^vault\/reset$/, 'owner', 'vault.reset', async ({ env, who, body }) => {
      ownerOnly(who, Refusal);
      if (body.confirm !== 'DELETE') throw new Refusal(400, 'confirm', 'Type DELETE to wipe the vault.');
      const [items] = await env.DB.batch([env.DB.prepare('DELETE FROM vault_items'), env.DB.prepare('DELETE FROM vault_meta'), env.DB.prepare('DELETE FROM vault_devices'), env.DB.prepare('DELETE FROM vault_inbox')]);
      return { body: { ok: true }, detail: { removed: items.meta.changes } };
    }],
  ];
}
