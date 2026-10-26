// The Worker looks after itself. Cloudflare runs scheduled() once a day (the
// cron in wrangler.toml) and it deletes data the game no longer needs, so the
// free D1 database never fills up:
//   races and their entries   45 days after the race was made (as compete.js does)
//   voice usage counters      after 60 days
//   rejected story parts      90 days after review
//   deleted-account markers   after 30 days (sign-in tokens last one hour)
//   error reports             after 30 days
//   anonymous play summaries  after 400 days (tuning only reads the last 90)
//   this cleanup's own log    after 90 days
//   the admin audit log       after 365 days
//   ended bans                when they end
//   ended announcements       90 days after they end
//   done ideas and problems   180 days after they were marked done
//   the weekly archive's log  after 365 days
//   kept translations         180 days after they were last used
// While the weekly archive email is on (archive.js), the rows it covers are
// left for it instead, so they are emailed before they are removed.
// Scores are never deleted here: the all-time scoreboard needs them (only an
// admin's reset in the dashboard removes a player's scores).
//
// GET /v1/health?deep=1 reports whether the database answers, when the cleanup
// last ran and how close the free voice quota is, for the GitHub health check.

import { getSettings } from './settings.js';
import { ARCHIVED_UPKEEP_JOBS } from './archive.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function runUpkeep(env, now = Date.now()) {
  const db = env.DB;
  const jobs = {
    race_invites: db.prepare('DELETE FROM race_invites WHERE code NOT IN (SELECT code FROM races) OR created_at < ?1').bind(now - 45 * DAY),
    race_entries: db.prepare('DELETE FROM race_entries WHERE code IN (SELECT code FROM races WHERE created_at < ?1)').bind(now - 45 * DAY),
    races: db.prepare('DELETE FROM races WHERE created_at < ?1').bind(now - 45 * DAY),
    usage: db.prepare('DELETE FROM usage WHERE day < ?1').bind(isoDay(now - 60 * DAY)),
    parts: db.prepare("DELETE FROM parts WHERE status = 'rejected' AND reviewed < ?1").bind(new Date(now - 90 * DAY).toISOString()),
    sync_deleted_users: db.prepare('DELETE FROM sync_deleted_users WHERE deleted_at < ?1').bind(now - 30 * DAY),
    app_errors: db.prepare('DELETE FROM app_errors WHERE day < ?1').bind(isoDay(now - 30 * DAY)),
    plays: db.prepare('DELETE FROM plays WHERE day < ?1').bind(isoDay(now - 400 * DAY)),
    upkeep_log: db.prepare('DELETE FROM upkeep_log WHERE ran_at < ?1').bind(now - 90 * DAY),
    admin_audit: db.prepare('DELETE FROM admin_audit WHERE at < ?1').bind(now - 365 * DAY),
    bans: db.prepare('DELETE FROM bans WHERE until IS NOT NULL AND until < ?1').bind(now),
    announcements: db.prepare('DELETE FROM announcements WHERE ends_at IS NOT NULL AND ends_at < ?1').bind(now - 90 * DAY),
    feedback: db.prepare("DELETE FROM feedback WHERE status IN ('done', 'addressed') AND done_at < ?1").bind(now - 180 * DAY),
    archive_log: db.prepare('DELETE FROM archive_log WHERE ran_at < ?1').bind(now - 365 * DAY),
    feedback_replies: db.prepare('DELETE FROM feedback_replies WHERE created_at < ?1').bind(now - 30 * DAY),
    translations: db.prepare('DELETE FROM translations WHERE day < ?1').bind(isoDay(now - 180 * DAY)),
    rating_insights: db.prepare('DELETE FROM rating_insights WHERE day < ?1').bind(isoDay(now - 90 * DAY)),
  };
  if ((await getSettings(env, now)).archive_email_enabled) {
    for (const name of ARCHIVED_UPKEEP_JOBS) delete jobs[name];
    jobs.race_invites = db.prepare('DELETE FROM race_invites WHERE code NOT IN (SELECT code FROM races)');
  }
  const results = await db.batch(Object.values(jobs));
  const removed = Object.fromEntries(Object.keys(jobs).map((name, i) => [name, results[i].meta?.changes || 0]));
  await db.prepare('INSERT OR REPLACE INTO upkeep_log (ran_at, removed) VALUES (?1, ?2)').bind(now, JSON.stringify(removed)).run();
  return removed;
}

export async function deepHealth(env, now = Date.now()) {
  const out = { ok: true, db: false, lastUpkeep: null, voicesToday: 0, voiceCap: 0, errorsToday: 0 };
  try {
    const last = await env.DB.prepare('SELECT ran_at FROM upkeep_log ORDER BY ran_at DESC LIMIT 1').first();
    const voices = await env.DB.prepare("SELECT count FROM usage WHERE day = ?1 AND name = 'tts'").bind(isoDay(now)).first();
    const errors = await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM app_errors WHERE day = ?1').bind(isoDay(now)).first();
    out.voiceCap = (await getSettings(env, now)).daily_tts_cap;
    out.db = true;
    out.lastUpkeep = last ? last.ran_at : null;
    out.voicesToday = voices ? voices.count : 0;
    out.errorsToday = errors.n;
  } catch (e) {
    out.ok = false;
  }
  return out;
}
