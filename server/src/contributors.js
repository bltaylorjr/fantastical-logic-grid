// Contributors: players the team thanks with a Contributor badge, for example
// when their story idea becomes a Player Story. An admin awards it from the
// player's page in the admin dashboard (Players > the player). The player
// sees it among their badges (through GET /v1/perks), and it shows next to
// their name on the scoreboard. The note is for the team and is never sent to
// players.
//
//   POST /admin/v1/players/:uid/contributor          { note? } award (admin)
//   POST /admin/v1/players/:uid/contributor/remove   take it back (admin)
//   GET  /admin/v1/contributors                      everyone who has it (moderator)

const cleanNote = (v) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : null);

// Whether this player has the badge.
export async function isContributor(env, uid) {
  try {
    return !!(await env.DB.prepare('SELECT 1 FROM contributors WHERE user_id = ?1').bind(uid).first());
  } catch (e) {
    return false; // table not made yet
  }
}

// Which of these players have the badge (for the scoreboard), as a Set.
export async function contributorSet(env, uids) {
  if (!uids.length) return new Set();
  try {
    const { results } = await env.DB.prepare('SELECT user_id FROM contributors WHERE user_id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(uids)).all();
    return new Set(results.map((r) => r.user_id));
  } catch (e) {
    return new Set(); // table not made yet
  }
}

// The badge row for the admin player page, or null.
export async function contributorInfo(env, uid) {
  try {
    return await env.DB.prepare('SELECT note, created_at AS createdAt, created_by AS createdBy FROM contributors WHERE user_id = ?1').bind(uid).first() || null;
  } catch (e) {
    return null;
  }
}

// Account deletion: the badge goes with the account.
export const deleteContributorStatement = (env, uid) => env.DB.prepare('DELETE FROM contributors WHERE user_id = ?1').bind(uid);

// ------------------------------------------------------------- admin
// changed(): clears the scoreboard cache, so the badge shows at once.
export function contributorRoutes(Refusal, changed = () => {}) {
  return [
    ['GET', /^contributors$/, 'moderator', 'contributors.view', async ({ env }) => {
      const { results } = await env.DB.prepare(`SELECT c.user_id AS uid, p.screen_name AS name, c.note, c.created_at AS createdAt, c.created_by AS createdBy
        FROM contributors c LEFT JOIN players p ON p.user_id = c.user_id ORDER BY c.created_at DESC LIMIT 500`).all();
      return { body: { contributors: results }, quiet: true };
    }],
    ['POST', /^players\/([\w-]{1,128})\/contributor$/, 'admin', 'players.contributor', async ({ env, params: [uid], body, who, now }) => {
      const known = await env.DB.prepare('SELECT (SELECT 1 FROM players WHERE user_id = ?1) AS p, (SELECT 1 FROM sync_users WHERE user_id = ?1) AS a, (SELECT 1 FROM sync_deleted_users WHERE user_id = ?1) AS d').bind(uid).first();
      if (!known || known.d || !(known.p || known.a)) throw new Refusal(404, 'no_player', 'No player has that id.');
      const note = cleanNote(body && body.note);
      await env.DB.prepare(`INSERT INTO contributors (user_id, note, created_at, created_by) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (user_id) DO UPDATE SET note = COALESCE(excluded.note, contributors.note)`).bind(uid, note, now, who.actor).run();
      changed();
      return { body: { ok: true }, target: uid, detail: { note } };
    }],
    ['POST', /^players\/([\w-]{1,128})\/contributor\/remove$/, 'admin', 'players.contributor_remove', async ({ env, params: [uid] }) => {
      const r = await env.DB.prepare('DELETE FROM contributors WHERE user_id = ?1').bind(uid).run();
      changed();
      return { body: { removed: r.meta.changes }, target: uid };
    }],
  ];
}
