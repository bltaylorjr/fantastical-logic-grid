// Every account has a screen name. The Create an account form and the sign-in
// prompt ask for one, but a player can still leave in between (close the app,
// or press "Sign out instead"), which left accounts with no name at all. Such
// an account is given a made-up name from the Suggest a name list: at its
// next sign-in once it is older than GRACE_MS, and every hour by the Worker's
// hourly cron. Suggested names are approved straight away, like the ones
// players pick with Suggest a name. players.auto_named stays 1 until the
// player keeps or changes the name, and the game asks them to do that first
// (GET /v1/profile says autoNamed).
import { nameKey, SUGGEST_ADJ, SUGGEST_NOUN } from './names.js';

// Time to choose a name at sign-up before one is picked for them.
export const GRACE_MS = 15 * 60_000;
const BATCH = 200;
const TRIES = 40;

// A whole number from 0 to n - 1, every one equally likely (values past the
// last full run of n are drawn again, so none is favoured).
function below(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] - Math.floor(buf[0] / n) * n;
  }
}

function suggestion() {
  return `${SUGGEST_ADJ[below(SUGGEST_ADJ.length)]}${SUGGEST_NOUN[below(SUGGEST_NOUN.length)]}${10 + below(90)}`;
}

// Gives one nameless account a free suggested name. Returns the name, or null
// when the account already has one (or none was free).
export async function giveSuggestedName(env, uid, now = Date.now()) {
  const db = env.DB;
  for (let i = 0; i < TRIES; i++) {
    const name = suggestion();
    const key = nameKey(name);
    if (await db.prepare('SELECT 1 FROM players WHERE name_key = ?1').bind(key).first()) continue;
    try {
      const [made] = await db.batch([
        db.prepare(`INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at, accept_invites, auto_named)
          SELECT ?1, ?2, ?3, ?4, ?4, 1, 1 WHERE NOT EXISTS (SELECT 1 FROM players WHERE user_id = ?1)
            AND NOT EXISTS (SELECT 1 FROM sync_deleted_users WHERE user_id = ?1)`).bind(uid, name, key, now),
        db.prepare(`INSERT OR REPLACE INTO name_reviews (user_id, name_key, reviewed_by, reviewed_at)
          SELECT ?1, ?2, 'automatic (suggested name)', ?3 WHERE EXISTS (SELECT 1 FROM players WHERE user_id = ?1 AND name_key = ?2)`).bind(uid, key, now),
      ]);
      return made.meta && made.meta.changes ? name : null;
    } catch (e) {
      // Someone took the same name a moment ago: try another.
      if (!/UNIQUE/i.test(String(e && e.message))) throw e;
    }
  }
  return null;
}

// Accounts with no screen name whose first sign-in or sync is older than
// GRACE_MS (banned and deleted accounts are left alone).
export async function namelessAccounts(env, now = Date.now(), limit = BATCH) {
  const { results } = await env.DB.prepare(`WITH ids AS (
      SELECT user_id, first_at AS at FROM account_logins UNION ALL SELECT user_id, created_at AS at FROM sync_users)
    SELECT user_id AS uid, MIN(at) AS first FROM ids
    WHERE user_id NOT IN (SELECT user_id FROM players) AND user_id NOT IN (SELECT user_id FROM sync_deleted_users)
      AND user_id NOT IN (SELECT user_id FROM bans WHERE until IS NULL OR until > ?1)
    GROUP BY user_id HAVING MIN(at) <= ?2 ORDER BY first LIMIT ?3`).bind(now, now - GRACE_MS, limit).all();
  return results;
}

// The hourly run (and Grid Admin's "Give names now"): names every nameless account.
export async function nameNamelessAccounts(env, now = Date.now()) {
  const named = [];
  for (const { uid } of await namelessAccounts(env, now)) {
    const name = await giveSuggestedName(env, uid, now);
    if (name) named.push({ uid, name });
  }
  return named;
}
