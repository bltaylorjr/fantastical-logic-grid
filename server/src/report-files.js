// Report a Problem, part two: the pictures and files players attach, the
// errors database (error_log) that records every step of a report, and the
// call that starts the puzzle doctor the moment a report arrives.
// Tables: migrations/2100_report_files_error_log.sql. Details: PUZZLE-REPORTS.md.
//
// Files. Up to MAX_FILES per report, each at most MAX_FILE_BYTES. The
// Report a Problem page sends them as multipart form parts beside the report's
// JSON (no base64 to decode, which keeps the Worker well inside its free CPU
// time); a JSON report may also carry small ones as base64 ({ name, data }). The type comes from the file's first bytes,
// never from the player: PNG, JPEG, WebP, GIF, PDF, or plain text (.txt, .log,
// .json, .csv) that is valid UTF-8. Anything else (SVG and HTML included,
// which could carry scripts) is refused.

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 1_048_576;
// base64 is 4/3 the size, plus room for the name and type.
export const MAX_FILES_CHARS = MAX_FILES * (Math.ceil(MAX_FILE_BYTES / 3) * 4 + 400);
// A whole multipart report: the files, the report's JSON and the form's own lines.
export const MAX_FORM_BYTES = MAX_FILES * (MAX_FILE_BYTES + 1024) + 260_000;
export const FILE_KEEP_DAYS = 90;
export const LOG_KEEP_DAYS = 365;
const TEXT_EXT = { txt: 'text/plain', log: 'text/plain', json: 'application/json', csv: 'text/csv' };
const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const starts = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// The file's real type from its first bytes, or null.
export function sniff(bytes, name) {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'image/gif';
  if (starts(bytes, ascii('RIFF')) && starts(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (starts(bytes, ascii('%PDF-'))) return 'application/pdf';
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (TEXT_EXT[ext] && !bytes.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return TEXT_EXT[ext]; } catch (e) { return null; }
  }
  return null;
}

// A safe file name with the extension that matches its real type.
export function safeName(name, mime, n) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '').replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || `attachment-${n}`;
  const ext = EXT_OF[mime] || String(name || '').toLowerCase().split('.').pop();
  return `${base}.${ext}`;
}

// The parts of a multipart report: { body, files } with the files as bytes,
// or { error } (TooLarge-style errors are the caller's to map).
export async function readForm(req, maxJsonChars) {
  const length = Number(req.headers.get('Content-Length') || 0);
  if (!length) return { error: 'length_required', status: 411 };
  if (length > MAX_FORM_BYTES) return { error: 'too_large', status: 413, message: 'Your pictures and files are too big to send together. Remove one and try again.' };
  let form;
  try { form = await req.formData(); } catch (e) { return { error: 'bad_request', status: 400 }; }
  let report = form.get('report');
  if (report && typeof report === 'object' && typeof report.text === 'function') report = report.size <= maxJsonChars ? await report.text() : 'x'.repeat(maxJsonChars + 1);
  if (typeof report !== 'string' || report.length > maxJsonChars) return { error: report ? 'too_large' : 'bad_request', status: report ? 413 : 400 };
  let body;
  try { body = JSON.parse(report); } catch (e) { return { error: 'bad_request', status: 400 }; }
  const parts = form.getAll('file').filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');
  if (parts.length > MAX_FILES) return { error: 'too_many_files', status: 400, message: `Attach up to ${MAX_FILES} pictures or files.` };
  const files = [];
  for (const f of parts) {
    if (f.size > MAX_FILE_BYTES) return { error: 'file_too_large', status: 400, message: `“${String(f.name || 'A file').slice(0, 60)}” is over 1 MB. Try a smaller picture or file.` };
    files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return { body: { ...body, files: files.length ? files : body.files } };
}

function fromBase64(s) {
  const clean = String(s || '').replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(clean);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// [{ name, mime, size, bytes }] from the report's `files`, or { error, message }.
export function readFiles(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) return { error: 'bad_files', message: 'The attachments could not be read.' };
  if (list.length > MAX_FILES) return { error: 'too_many_files', message: `Attach up to ${MAX_FILES} pictures or files.` };
  const out = [];
  for (const [i, f] of list.entries()) {
    let bytes = null;
    if (f?.bytes instanceof Uint8Array) bytes = f.bytes;
    else { try { bytes = fromBase64(f?.data); } catch (e) { bytes = null; } }
    if (!bytes || !bytes.length) return { error: 'bad_file', message: `Attachment ${i + 1} could not be read. Try attaching it again.` };
    if (bytes.length > MAX_FILE_BYTES) return { error: 'file_too_large', message: `Attachment ${i + 1} is over 1 MB. Try a smaller picture or file.` };
    const mime = sniff(bytes, f?.name);
    if (!mime) return { error: 'file_type', message: `Attachment ${i + 1} is not a type we accept. Attach pictures (PNG, JPEG, WebP, GIF), PDFs or text files (.txt, .log, .json, .csv).` };
    out.push({ name: safeName(f?.name, mime, i + 1), mime, size: bytes.length, bytes });
  }
  return out;
}

export async function saveFiles(env, reportId, tracking, files, now) {
  if (!files.length) return;
  await env.DB.batch(files.map((f) => env.DB.prepare('INSERT INTO report_files (report_id, tracking, name, mime, size, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(reportId, tracking, f.name, f.mime, f.size, f.bytes, now)));
}

export async function filesOf(env, reportId) {
  const { results } = await env.DB.prepare('SELECT id, name, mime, size, created_at AS createdAt FROM report_files WHERE report_id = ?1 ORDER BY id').bind(reportId).all();
  return results.map((r) => ({ ...r, image: IMAGE_TYPES.has(r.mime) }));
}

// One file for the dashboard (admin.js sends it): pictures may show as
// pictures; everything else downloads. Never sniffed, framed or run as a page.
export async function fileOut(env, reportId, fileId) {
  const f = await env.DB.prepare('SELECT name, mime, data FROM report_files WHERE id = ?1 AND report_id = ?2').bind(fileId, reportId).first();
  if (!f) return null;
  const inline = IMAGE_TYPES.has(f.mime);
  return {
    file: new Uint8Array(f.data), type: inline ? f.mime : 'application/octet-stream', name: f.name, quiet: true,
    headers: { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/"/g, '')}"`, 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store' },
  };
}

// ------------------------------------------------------------- errors database
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Never throws: the log must never stop a report.
export async function logEvent(env, { reportId = null, tracking, category = '', event, status = '', detail = '' }, now = Date.now()) {
  try {
    await env.DB.prepare('INSERT INTO error_log (report_id, tracking, category, event, status, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(reportId, clean(tracking, 20), clean(category, 20), clean(event, 30), clean(status, 20), clean(detail, 500), now).run();
  } catch (e) { console.error('error_log', e); }
}

export async function logOf(env, reportId) {
  const { results } = await env.DB.prepare('SELECT id, event, status, detail, created_at AS createdAt FROM error_log WHERE report_id = ?1 ORDER BY id LIMIT 200').bind(reportId).all();
  return results;
}

export async function latestLog(env, url) {
  const before = Number(url.searchParams.get('before')) || null;
  const event = /^[a-z_]{2,30}$/.test(url.searchParams.get('event') || '') ? url.searchParams.get('event') : null;
  const { results } = await env.DB.prepare(`SELECT l.id, l.report_id AS reportId, l.tracking, l.category, l.event, l.status, l.detail, l.created_at AS createdAt
    FROM error_log l WHERE (?1 IS NULL OR l.id < ?1) AND (?2 IS NULL OR l.event = ?2) ORDER BY l.id DESC LIMIT 100`).bind(before, event).all();
  return { events: results, more: results.length === 100 ? results[results.length - 1].id : null };
}

// ------------------------------------------------------------- the doctor, now
// Starts the Puzzle doctor Action straight away (the GITHUB_DISPATCH_TOKEN
// Worker secret, the same one the marketing poster and educator packages
// use), so a reported puzzle is checked and repaired within a minute or two
// instead of waiting for the next 15-minute round. Without the secret, or if
// GitHub says no, the 15-minute round still picks it up.
export const DOCTOR_URL = 'https://api.github.com/repos/bltaylorjr/fantastical-logic-grid/actions/workflows/puzzle-reports.yml/dispatches';

export async function callDoctor(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return false;
  try {
    const r = await fetch(DOCTOR_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flg-api', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return r.status === 204 || r.ok;
  } catch (e) { console.error('doctor dispatch', e); return false; }
}

export function upkeepStatements(env, now) {
  const DAY = 24 * 3600_000;
  return {
    report_files: env.DB.prepare('DELETE FROM report_files WHERE created_at < ?1').bind(now - FILE_KEEP_DAYS * DAY),
    error_log: env.DB.prepare('DELETE FROM error_log WHERE created_at < ?1').bind(now - LOG_KEEP_DAYS * DAY),
  };
}
