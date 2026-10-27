// The nightly maintenance slot: 2 am US Eastern time, every night.
// Cloudflare cron triggers only know UTC, and 2 am Eastern is 07:00 UTC in
// winter (EST) and 06:00 UTC in summer (EDT), so wrangler.toml has a cron at
// both hours and the one that is not 2 am in New York does nothing.
// To move the slot, change MAINTENANCE_HOUR or MAINTENANCE_TZ here, the two
// crons in wrangler.toml, and the same three in .github/workflows/nightly.yml.
//
// At 2 am the Worker: cleans out old data (upkeep.js), lets the database tidy
// its indexes (PRAGMA optimize; D1 does not allow VACUUM and compacts storage
// itself), then refreshes the Google and Bing search numbers (search.js).
// The GitHub nightly run follows 20 minutes later and reports on all of it.

import { runUpkeep } from './upkeep.js';
import { refreshSearch } from './search.js';

export const MAINTENANCE_TZ = 'America/New_York';
export const MAINTENANCE_HOUR = 2;
export const NIGHTLY_CRONS = ['0 6 * * *', '0 7 * * *'];

export function localHour(ms, tz = MAINTENANCE_TZ) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
}

// True when a nightly cron fired in the maintenance hour (Cloudflare can run a
// cron a few minutes late, which stays inside the hour).
export const isMaintenanceHour = (ms) => localHour(ms) === MAINTENANCE_HOUR;

export async function runNightly(env, now = Date.now()) {
  const removed = await runUpkeep(env, now);
  let optimized = true;
  try { await env.DB.prepare('PRAGMA optimize').run(); } catch (e) { optimized = false; }
  const search = await refreshSearch(env, now);
  return { removed, optimized, search };
}
