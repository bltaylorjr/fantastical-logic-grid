// Account sync: each signed-in player's saved puzzles, meta lists and settings.
//
// POST /v1/sync   { since?, changes?: [{ kind, key, data, deleted, updatedAt, baseRev }] }
//   Writes each change only if the server copy is still at baseRev (the rev the
//   device last saw). Otherwise the change comes back under `conflicts` with
//   the server copy, and the device merges and tries again. With `since`, the
//   reply also carries every record written after that rev (a page at a time).
// DELETE /v1/account
//   Removes all of the player's synced data. Needs a sign-in from the last
//   10 minutes, so a stolen old token cannot erase an account.

import { json } from './http.js';

const KINDS = new Set(['save', 'meta', 'settings']);
const MAX_CHANGES = 100;
const MAX_RECORD_CHARS = 1_000_000;
const MAX_RECORDS = 5000;
const PULL_ROWS = 500;
const PULL_CHARS = 1_500_000;
const RECENT_SIGN_IN = 600;

export async function isDeleted(env, uid) {
  return !!(await env.DB.prepare('SELECT 1 AS d FROM sync_deleted_users WHERE user_id = ?1').bind(uid).first());
}

export async function handleSync(req, env, user) {
  let body;
  try { body = await req.json(); } catch (e) { return json(req, env, { error: 'bad_json' }, 400); }
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > MAX_CHANGES) return json(req, env, { error: 'too_many_changes', max: MAX_CHANGES }, 413);
  for (const c of changes) {
    if (!c || !KINDS.has(c.kind) || typeof c.key !== 'string' || !c.key || c.key.length > 200) return json(req, env, { error: 'bad_change' }, 400);
    if (!c.deleted && (typeof c.data !== 'string' || c.data.length > MAX_RECORD_CHARS)) return json(req, env, { error: 'record_too_large', key: c.key }, 413);
    if (!Number.isFinite(c.updatedAt) || !Number.isInteger(c.baseRev || 0) || (c.baseRev || 0) < 0) return json(req, env, { error: 'bad_change' }, 400);
  }

  const db = env.DB;
  const uid = user.uid;
  const out = { applied: [], conflicts: [] };

  if (changes.length) {
    await db.prepare('INSERT OR IGNORE INTO sync_users (user_id, rev, created_at) VALUES (?1, 0, ?2)').bind(uid, Date.now()).run();
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE user_id = ?1').bind(uid).first();
    const full = n >= MAX_RECORDS;
    const bump = db.prepare('UPDATE sync_users SET rev = rev + 1 WHERE user_id = ?1 RETURNING rev');
    const upsert = db.prepare(`INSERT INTO sync_records (user_id, kind, key, data, deleted, updated_at, rev)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT rev FROM sync_users WHERE user_id = ?1))
      ON CONFLICT (user_id, kind, key) DO UPDATE SET data = excluded.data, deleted = excluded.deleted,
        updated_at = excluded.updated_at, rev = excluded.rev
      WHERE sync_records.rev = ?7`);
    const todo = changes.filter((c) => !(full && !c.baseRev && !c.deleted));
    if (todo.length < changes.length) out.full = true;
    const stmts = [];
    for (const c of todo) {
      stmts.push(bump.bind(uid));
      stmts.push(upsert.bind(uid, c.kind, c.key, c.deleted ? null : c.data, c.deleted ? 1 : 0, Math.round(c.updatedAt), c.baseRev || 0));
    }
    // A batch runs as one transaction, so each upsert sees the rev its bump made.
    const results = stmts.length ? await db.batch(stmts) : [];
    const lost = [];
    todo.forEach((c, i) => {
      const rev = results[2 * i].results[0].rev;
      if (results[2 * i + 1].meta.changes > 0) out.applied.push({ kind: c.kind, key: c.key, rev });
      else lost.push(c);
    });
    if (lost.length) {
      const get = db.prepare('SELECT kind, key, data, deleted, updated_at, rev FROM sync_records WHERE user_id = ?1 AND kind = ?2 AND key = ?3');
      const rows = await db.batch(lost.map((c) => get.bind(uid, c.kind, c.key)));
      for (const r of rows) { const row = r.results[0]; if (row) out.conflicts.push(toRecord(row)); }
    }
  }

  if (Number.isInteger(body.since) && body.since >= 0) Object.assign(out, await pull(db, uid, body.since, out.applied));
  return json(req, env, out);
}

function toRecord(row) {
  return { kind: row.kind, key: row.key, data: row.deleted ? null : row.data, deleted: !!row.deleted, updatedAt: row.updated_at, rev: row.rev };
}

// One page of changes after `since`, kept under PULL_CHARS so the reply stays
// small enough for slow phones and the Worker's time limit.
async function pull(db, uid, since, applied) {
  const { results: index } = await db.prepare('SELECT rev, length(data) AS size FROM sync_records WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3')
    .bind(uid, since, PULL_ROWS).all();
  if (!index.length) {
    const top = await db.prepare('SELECT rev FROM sync_users WHERE user_id = ?1').bind(uid).first();
    return { changes: [], cursor: Math.max(since, top ? top.rev : 0), more: false };
  }
  let total = 0;
  let upTo = index[0].rev;
  let cut = false;
  for (const r of index) {
    total += r.size || 0;
    if (total > PULL_CHARS && r.rev !== index[0].rev) { cut = true; break; }
    upTo = r.rev;
  }
  const { results } = await db.prepare('SELECT kind, key, data, deleted, updated_at, rev FROM sync_records WHERE user_id = ?1 AND rev > ?2 AND rev <= ?3 ORDER BY rev')
    .bind(uid, since, upTo).all();
  const mine = new Set(applied.map((a) => `${a.kind}\n${a.key}\n${a.rev}`));
  return {
    changes: results.filter((r) => !mine.has(`${r.kind}\n${r.key}\n${r.rev}`)).map(toRecord),
    cursor: upTo,
    more: cut || index.length === PULL_ROWS,
  };
}

export async function handleDeleteAccount(req, env, user) {
  if (Math.floor(Date.now() / 1000) - user.authTime > RECENT_SIGN_IN) return json(req, env, { error: 'sign_in_again' }, 403);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sync_records WHERE user_id = ?1').bind(user.uid),
    env.DB.prepare('DELETE FROM sync_users WHERE user_id = ?1').bind(user.uid),
    env.DB.prepare('INSERT OR REPLACE INTO sync_deleted_users (user_id, deleted_at) VALUES (?1, ?2)').bind(user.uid, Date.now()),
  ]);
  return json(req, env, { deleted: true });
}
