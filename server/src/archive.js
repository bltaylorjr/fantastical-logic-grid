// The weekly archive. Every Monday (the second cron in wrangler.toml) the rows
// the game no longer needs are written to CSV files in a zip, emailed to the
// owner, and only then removed from D1 to save space. Nothing that runs the
// game or serves players is ever touched: accounts, saved games and settings
// (sync_*), screen names, scores, bans, admins, settings, story parts in use
// and open races all stay. The list is ARCHIVE below; ARCHIVE.md explains it.
//
// Two dashboard switches (settings.js) control it, both off at first:
//   archive_email_enabled   send the weekly email. While on, the daily cleanup
//                           (upkeep.js) leaves these rows for the archive.
//   archive_delete_enabled  remove the rows after Cloudflare accepted the email.
//
// Email goes through Cloudflare Email Routing's send_email binding
// (ARCHIVE_EMAIL), which is free to a verified destination address. The
// address is the ARCHIVE_TO secret, so it is not in the repo. Player ids are
// replaced with a keyed code (the same player gets the same code every week),
// so the archive cannot be tied back to an account without the Worker's key.

import { getSettings } from './settings.js';
import { makeZip } from './zip.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// Cloudflare accepts up to 25 MiB to a verified address, and attachments grow
// by a third when encoded. Larger archives are refused and nothing is removed.
export const MAX_ZIP_BYTES = 17 * 1024 * 1024;
const MAX_ROWS = 20_000; // per table per run; the rest goes the next week
const MAX_RACES = 1_000; // races carry the whole puzzle, so fewer per run

// table: what goes, after how many days, and why the game does not need it.
// where takes ?1 = the cutoff. ids: player id columns replaced with codes.
export const ARCHIVE = [
  { table: 'races', label: 'Finished races, with their players and challenges', keepDays: 45, where: 'created_at < ?1', cutoff: (now) => now - 45 * DAY,
    dateColumn: 'created_at', ids: ['host_id'], limit: MAX_RACES, why: 'Races close after 7 days; results stay visible for 45 days. Scores earned in races are kept in scores.',
    children: [
      { table: 'race_entries', dateColumn: 'joined_at', ids: ['user_id'] },
      { table: 'race_invites', dateColumn: 'created_at', ids: ['from_id', 'to_id'] },
    ] },
  { table: 'plays', label: 'Anonymous play summaries', keepDays: 90, where: 'day < ?1', cutoff: (now) => isoDay(now - 90 * DAY),
    dateColumn: 'day', why: 'Difficulty tuning and the dashboard read only the last 90 days.' },
  { table: 'app_errors', label: 'Error reports from the apps', keepDays: 30, where: 'day < ?1', cutoff: (now) => isoDay(now - 30 * DAY),
    dateColumn: 'day', why: 'The dashboard shows the last 30 days.' },
  { table: 'usage', label: 'Daily voice clip counters', keepDays: 60, where: 'day < ?1', cutoff: (now) => isoDay(now - 60 * DAY),
    dateColumn: 'day', why: 'Only today\'s count protects the free voice quota.' },
  { table: 'parts', label: 'Rejected story parts', keepDays: 90, where: "status = 'rejected' AND reviewed < ?1", cutoff: (now) => new Date(now - 90 * DAY).toISOString(),
    dateColumn: 'reviewed', why: 'Rejected parts are never shown to players.' },
  { table: 'announcements', label: 'Ended announcements', keepDays: 90, where: 'ends_at IS NOT NULL AND ends_at < ?1', cutoff: (now) => now - 90 * DAY,
    dateColumn: 'ends_at', why: 'Players stop seeing them when they end.' },
  { table: 'admin_audit', label: 'Admin audit log', keepDays: 90, where: 'at < ?1', cutoff: (now) => now - 90 * DAY,
    dateColumn: 'at', why: 'The dashboard keeps 90 days on hand; older entries live on in the archive.' },
  { table: 'upkeep_log', label: 'Daily cleanup log', keepDays: 90, where: 'ran_at < ?1', cutoff: (now) => now - 90 * DAY,
    dateColumn: 'ran_at', why: 'The health check only reads the latest run.' },
];

// The daily cleanup jobs (upkeep.js) the archive takes over while it is on.
export const ARCHIVED_UPKEEP_JOBS = ['race_entries', 'races', 'usage', 'parts', 'app_errors', 'plays', 'upkeep_log', 'admin_audit', 'announcements'];

export const PERSONAL_DATA = [
  'Player ids in races, race_entries and race_invites are replaced with codes like p_3f9a1c0b7e21. No emails, screen names, passwords or saved games are included.',
  'The admin audit log keeps the email address of the admin who did each action (that is what an audit log is for), and its target column can hold a player id or a setting name.',
  'Everything else is anonymous: play summaries, error reports, voice counters, rejected story parts and announcements.',
];

const csvCell = (v) => {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : String(v);
  // Stop spreadsheet apps from running a cell as a formula.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  return [cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

async function columnsOf(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return results.map((c) => c.name);
}

function idCoder(env) {
  const cache = new Map();
  let key;
  return async (id) => {
    if (id == null || id === '') return id;
    if (cache.has(id)) return cache.get(id);
    key ||= await crypto.subtle.importKey('raw', new TextEncoder().encode(`flg-archive|${env.ARCHIVE_KEY || env.ADMIN_TOKEN || 'no-key'}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(id))));
    const code = `p_${[...sig.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    cache.set(id, code);
    return code;
  };
}

async function hideIds(rows, ids = [], code) {
  for (const r of rows) for (const c of ids) r[c] = await code(r[c]);
  return rows;
}

// Reads what is old enough right now. Returns the zip, the row counts and
// the DELETE statements that remove exactly those rows.
export async function buildArchive(env, now = Date.now()) {
  const db = env.DB;
  const code = idCoder(env);
  const files = [];
  const counts = {};
  const removals = [];
  const tables = {};
  for (const spec of ARCHIVE) {
    const cutoff = spec.cutoff(now);
    const { results } = await db.prepare(`SELECT rowid AS _rowid, * FROM ${spec.table} WHERE ${spec.where} ORDER BY rowid LIMIT ?2`).bind(cutoff, spec.limit || MAX_ROWS).all();
    const maxRowid = results.length ? results[results.length - 1]._rowid : 0;
    const columns = await columnsOf(db, spec.table);
    const rows = await hideIds(results.map(({ _rowid, ...r }) => r), spec.ids, code);
    counts[spec.table] = rows.length;
    tables[spec.table] = { label: spec.label, rows: rows.length, file: `${spec.table}.csv`, dateColumn: spec.dateColumn, keptDays: spec.keepDays, cutoff, why: spec.why };
    files.push({ name: `${spec.table}.csv`, data: toCsv(rows, columns) });
    // The same rows: those matching the cutoff up to the last rowid read.
    const picked = `SELECT code FROM ${spec.table} WHERE (${spec.where}) AND rowid <= ?2`;
    for (const child of spec.children || []) {
      const childCols = await columnsOf(db, child.table);
      const kids = rows.length ? (await db.prepare(`SELECT * FROM ${child.table} WHERE code IN (${picked})`).bind(cutoff, maxRowid).all()).results : [];
      await hideIds(kids, child.ids, code);
      counts[child.table] = kids.length;
      tables[child.table] = { label: `${spec.label} (${child.table})`, rows: kids.length, file: `${child.table}.csv`, dateColumn: child.dateColumn, keptDays: spec.keepDays, cutoff, why: spec.why };
      files.push({ name: `${child.table}.csv`, data: toCsv(kids, childCols) });
      if (rows.length) removals.push(db.prepare(`DELETE FROM ${child.table} WHERE code IN (${picked})`).bind(cutoff, maxRowid));
    }
    if (rows.length) removals.push(db.prepare(`DELETE FROM ${spec.table} WHERE (${spec.where}) AND rowid <= ?2`).bind(cutoff, maxRowid));
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const manifest = {
    app: 'The Fantastical Logic Grid', kind: 'weekly-archive', version: 1, generatedAt: new Date(now).toISOString(), total, tables, personalData: PERSONAL_DATA,
  };
  files.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  files.push({ name: 'README.txt', data: readme(manifest) });
  const zip = await makeZip(files, now);
  return { zip, counts, total, removals, name: `flg-archive-${isoDay(now)}.zip`, manifest };
}

function readme(m) {
  const lines = Object.entries(m.tables).map(([t, x]) => `  ${t}.csv  ${x.rows} rows  ${x.label}`);
  return [
    `The Fantastical Logic Grid: archive made ${m.generatedAt}`,
    '',
    'Old rows the game no longer needs, saved before they were removed from the',
    'database. Open the CSV files in any spreadsheet, or drop this zip on the',
    'Archive viewer in the admin dashboard (it runs in your browser; nothing is uploaded).',
    '',
    ...lines,
    '',
    'Personal data:',
    ...m.personalData.map((p) => `  - ${p}`),
    '',
  ].join('\r\n');
}

// How many rows would go right now, without reading them all into memory.
export async function pendingCounts(env, now = Date.now()) {
  const db = env.DB;
  const stmts = [];
  const names = [];
  for (const spec of ARCHIVE) {
    stmts.push(db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${spec.where}`).bind(spec.cutoff(now)));
    names.push(spec.table);
    for (const child of spec.children || []) {
      stmts.push(db.prepare(`SELECT COUNT(*) AS n FROM ${child.table} WHERE code IN (SELECT code FROM ${spec.table} WHERE ${spec.where})`).bind(spec.cutoff(now)));
      names.push(child.table);
    }
  }
  const res = await db.batch(stmts);
  return Object.fromEntries(names.map((n, i) => [n, res[i].results[0].n]));
}

const isSetUp = (env) => !!(env.ARCHIVE_EMAIL && env.ARCHIVE_TO && env.ARCHIVE_FROM);

async function log(env, now, entry) {
  await env.DB.prepare('INSERT OR REPLACE INTO archive_log (ran_at, trigger, status, rows, bytes, removed, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(now, entry.trigger, entry.status, JSON.stringify(entry.rows || {}), entry.bytes || 0, entry.removed ? 1 : 0, entry.message || null).run();
  return entry;
}

// trigger: 'weekly' (the cron) or the admin who pressed "Send now". A run from
// the dashboard sends even while the weekly email is off (a test), but rows
// are only removed when both switches are on.
export async function runArchive(env, now = Date.now(), { trigger = 'weekly' } = {}) {
  const settings = await getSettings(env, now);
  if (trigger === 'weekly' && !settings.archive_email_enabled) return log(env, now, { trigger, status: 'off' });
  if (!isSetUp(env)) return log(env, now, { trigger, status: 'not_set_up', message: 'Add the ARCHIVE_EMAIL binding and the ARCHIVE_TO secret (see server/ARCHIVE.md).' });
  const removeAfter = settings.archive_email_enabled && settings.archive_delete_enabled;

  let built;
  try { built = await buildArchive(env, now); } catch (e) {
    console.error('archive build', e);
    return log(env, now, { trigger, status: 'failed', message: `Could not read the old rows: ${e.message}` });
  }
  const { zip, counts, total, removals, name } = built;
  if (zip.length > MAX_ZIP_BYTES) return log(env, now, { trigger, status: 'failed', rows: counts, bytes: zip.length, message: 'The zip is too big to email. Nothing was removed.' });

  const list = Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `  ${t}: ${n} rows`).join('\n');
  const plan = !total ? 'Nothing was old enough to archive this week.'
    : removeAfter ? 'These rows have now been removed from the database. This email is the only copy, so keep it.'
      : 'Nothing was removed (removal is switched off in the dashboard), so the same rows will come again next week.';
  try {
    await env.ARCHIVE_EMAIL.send({
      to: env.ARCHIVE_TO,
      from: { email: env.ARCHIVE_FROM, name: 'The Fantastical Logic Grid' },
      subject: `Logic Grid archive ${isoDay(now)}: ${total} old rows`,
      text: `The weekly archive of data the game no longer needs.\n\n${list || '  (no rows)'}\n\n${plan}\n\nOpen the zip with Backups and archive > Archive viewer in the admin dashboard, or open the CSV files in a spreadsheet. Player ids are replaced with codes; README.txt in the zip lists the personal data it holds.\n`,
      attachments: total ? [{ filename: name, content: zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length), type: 'application/zip', disposition: 'attachment' }] : undefined,
    });
  } catch (e) {
    console.error('archive email', e);
    return log(env, now, { trigger, status: 'failed', rows: counts, bytes: zip.length, message: `The email was not sent (${e.code || e.message}). Nothing was removed.` });
  }

  let removed = false;
  if (removeAfter && removals.length) {
    try {
      await env.DB.batch(removals);
      removed = true;
    } catch (e) {
      console.error('archive remove', e);
      return log(env, now, { trigger, status: 'sent', rows: counts, bytes: zip.length, message: `Sent, but removing the rows failed (${e.message}). They go again next week.` });
    }
  }
  return log(env, now, { trigger, status: total ? 'sent' : 'empty', rows: counts, bytes: zip.length, removed });
}

export async function archiveStatus(env, now = Date.now()) {
  const settings = await getSettings(env, now);
  const { results } = await env.DB.prepare('SELECT ran_at, trigger, status, rows, bytes, removed, message FROM archive_log ORDER BY ran_at DESC LIMIT 20').all();
  return {
    setUp: { binding: !!env.ARCHIVE_EMAIL, to: !!env.ARCHIVE_TO, from: env.ARCHIVE_FROM || null },
    emailOn: settings.archive_email_enabled,
    removeOn: settings.archive_delete_enabled,
    schedule: 'Mondays at 04:47 UTC',
    plan: ARCHIVE.map((s) => ({ table: s.table, label: s.label, keepDays: s.keepDays, why: s.why, children: (s.children || []).map((c) => c.table) })),
    personalData: PERSONAL_DATA,
    pending: await pendingCounts(env, now),
    runs: results.map((r) => ({ ranAt: r.ran_at, trigger: r.trigger, status: r.status, rows: JSON.parse(r.rows), bytes: r.bytes, removed: !!r.removed, message: r.message })),
  };
}
