// Report fixes: closes the problems players reported once the code fix for
// them is merged (server/PUZZLE-REPORTS.md, "Code fixes"). Run by the GitHub
// Action report-fixes.yml when a pull request merges into main, or by hand.
//
// The pull request says what it fixes in its body, one item per line:
//   Fixes reports: PZ-ABCD2345, WS-EFGH6789
//   Player note: The grid now fits on small tablets without extra scrolling.
//   Fixes error: Cannot read properties of undefined (reading 'toLowerCase') | app.js
// Tracking ids hold nothing personal; the player note is what the players are
// told, in everyday words. The version the fix shipped in is package.json's.
// The Worker marks each report addressed with the note and version, emails the
// players who asked, and sends puzzle reports that needed a fix in the puzzle
// maker back to the puzzle doctor for the repaired puzzle.
// The repository is public, so this prints only counts and tracking ids.
// Needs FLG_CLOUD_URL and FLG_ADMIN_TOKEN; input in PR_BODY (or TRACKINGS,
// NOTE and ERROR for a run by hand).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const TRACKING = /\b(?:PZ|WS)-[A-Z2-9]{8}\b/g;
// "Fixes reports:", "- **Fixes reports:**", "Fixed reports -" all count.
const line = (label) => new RegExp(`^[\\s>*_-]*(?:${label})[*_]*\\s*[:\\-][*_]*\\s*(.+)$`, 'i');
const REPORTS = line('fix(?:es|ed)? reports?');
const NOTE = line('player note');
const ERROR = line('fix(?:es|ed)? errors?');

export function parseFixes(body) {
  const out = { trackings: [], note: '', errors: [] };
  for (const raw of String(body || '').split(/\r?\n/)) {
    let m;
    if ((m = raw.match(REPORTS))) out.trackings.push(...(m[1].toUpperCase().match(TRACKING) || []));
    else if ((m = raw.match(NOTE)) && !out.note) out.note = m[1].replace(/[*_`]+/g, '').trim().slice(0, 400);
    else if ((m = raw.match(ERROR))) {
      const [message, place = ''] = m[1].replace(/^`|`$/g, '').split(/\s+\|\s+/);
      if (message.trim()) out.errors.push({ message: message.trim().slice(0, 300), place: place.trim().slice(0, 200) });
    }
  }
  out.trackings = [...new Set(out.trackings)];
  return out;
}

async function main() {
  const API = (process.env.FLG_CLOUD_URL || '').trim().replace(/\/+$/, '');
  const TOKEN = (process.env.FLG_ADMIN_TOKEN || '').trim();
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const fixedIn = (process.env.FIXED_IN || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).trim();
  const fixes = process.env.PR_BODY
    ? parseFixes(process.env.PR_BODY)
    : parseFixes(`Fixes reports: ${process.env.TRACKINGS || ''}\nPlayer note: ${process.env.NOTE || ''}\n${process.env.ERROR ? `Fixes error: ${process.env.ERROR}` : ''}`);
  if (!fixes.trackings.length && !fixes.errors.length) { console.log('This change does not say it fixes any reported problem.'); return; }
  if (!fixes.note) { console.log('::error::The change lists reports or errors it fixes but has no "Player note:" line, so nothing was closed.'); process.exitCode = 1; return; }
  if (!API || !TOKEN) { console.log('Report fixes is not set up yet (needs FLG_CLOUD_URL and FLG_ADMIN_TOKEN). See server/PUZZLE-REPORTS.md.'); return; }
  const call = async (path, body) => {
    const res = await fetch(`${API}/admin/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'flg-report-fixes' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`The Worker answered ${res.status} for ${path}.`);
    return res.json();
  };
  if (fixes.trackings.length) {
    const r = await call('error-tracking/close', { trackings: fixes.trackings, note: fixes.note, fixedIn });
    console.log(`Version ${fixedIn}: ${r.closed} reports closed (${r.emailed} players emailed), ${r.requeued} puzzle reports sent back to the puzzle doctor for repair.`
      + (r.skipped.length ? ` Not waiting for a fix (already done, or unknown): ${r.skipped.join(', ')}.` : ''));
  }
  for (const e of fixes.errors) await call('errors/fix', { message: e.message, place: e.place, fixedIn, note: fixes.note });
  if (fixes.errors.length) console.log(`${fixes.errors.length} app errors marked fixed in version ${fixedIn}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
