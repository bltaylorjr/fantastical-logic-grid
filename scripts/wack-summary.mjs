// Reads a Windows App Certification Kit report (the XML appcert.exe writes),
// prints every test with its result, adds the same table to the GitHub run's
// summary page, and exits 1 if a test fails that we have not accepted.
// Accepted failures (each one is explained in docs/MICROSOFT-STORE.md):
//   - "Digitally signed file": the installers are not signed, because a code
//     signing certificate costs money (the free-only rule). The Microsoft Store
//     version is signed by Microsoft for free, so this does not affect it.
// Used by .github/workflows/wack.yml. Run: node scripts/wack-summary.mjs report.xml [app name]
import { readFileSync, appendFileSync } from 'node:fs';

const [file, app = 'app'] = process.argv.slice(2);
const xml = readFileSync(file, 'utf8').replace(/^﻿/, '');
const ACCEPTED = [/digitally signed/i, /signed file/i];

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || '';
const text = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const overall = attr((xml.match(/<REPORT\b[^>]*>/) || [''])[0], 'OVERALL_RESULT');
const rows = [];
for (const m of xml.matchAll(/<TEST\b([^>]*)>([\s\S]*?)<\/TEST>/g)) {
  const name = unescape(attr(m[1], 'NAME') || attr(m[1], 'DESCRIPTION'));
  const result = text((m[2].match(/<RESULT\b[^>]*>([\s\S]*?)<\/RESULT>/) || ['', ''])[1]).toUpperCase() || '?';
  const messages = [...m[2].matchAll(/<MESSAGE\b([^>]*)\/?>/g)].map((x) => unescape(attr(x[1], 'TEXT'))).filter(Boolean);
  rows.push({ name, result, optional: /TRUE/i.test(attr(m[1], 'OPTIONAL')), messages });
}
if (!rows.length) { console.error(`No tests found in ${file}.`); process.exit(1); }

const accepted = (r) => ACCEPTED.some((re) => re.test(r.name));
const blocking = rows.filter((r) => r.result === 'FAIL' && !r.optional && !accepted(r));
const lines = [`### Windows App Certification Kit: ${app}`, '', `Kit overall result: **${overall || 'unknown'}**. Failures that block: **${blocking.length}**.`, '', '| Test | Result | Notes |', '| --- | --- | --- |'];
for (const r of rows) {
  const note = r.result === 'FAIL' ? (accepted(r) ? 'Accepted: unsigned (free-only rule). ' : r.optional ? 'Optional test. ' : '') + r.messages.slice(0, 3).join(' / ') : '';
  lines.push(`| ${r.name} | ${r.result} | ${note.replace(/\|/g, '/').slice(0, 400)} |`);
}
const out = lines.join('\n') + '\n';
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
process.exit(blocking.length ? 1 : 0);
