#!/usr/bin/env node
// Tools for admin/connections.js, the one list of every outside connection.
//
//   node scripts/connections.mjs check
//       Fails when code uses a secret, variable or binding that the list does
//       not name (Worker code, wrangler.toml, GitHub workflows), when an entry
//       is malformed or looks like it holds a secret value, or when
//       docs/CONNECTIONS.md is out of date. Run by the Tests workflow.
//   node scripts/connections.mjs md > docs/CONNECTIONS.md
//       The guide as Markdown, for reading on GitHub.
//   node scripts/connections.mjs email <id> [<id> ...] [--title "..."] [--intro "..."]
//       An owner task email (docs/owner-tasks/, see its README.md) made from
//       those entries, so emails and the dashboard say the same thing. Use
//       --missing to list every entry, and pick from there.
//   node scripts/connections.mjs report
//       For the Connections status Action: reads SECRETS_JSON and VARS_JSON
//       (toJSON(secrets) and toJSON(vars)), sends only the NAMES that have a
//       value, plus the Pages settings, to the Worker. Never prints a value.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTIONS, GROUPS, WHERE, IGNORED, allNames } from '../admin/connections.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MD_PATH = join(root, 'docs', 'CONNECTIONS.md');
const REPO = 'https://github.com/bltaylorjr/fantastical-logic-grid';

const walk = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, ext);
  return ext.some((x) => e.name.endsWith(x)) ? [p] : [];
});

// ------------------------------------------------------------- what the code uses
// Returns [{ name, family: 'worker' | 'github-secret' | 'github-variable', file }].
export function usedNames() {
  const out = [];
  const add = (name, family, file) => { if (!IGNORED.includes(name) && !name.startsWith('TEST_')) out.push({ name, family, file: relative(root, file) }); };
  for (const f of walk(join(root, 'server', 'src'), ['.js', '.mjs'])) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\benv\.([A-Z][A-Z0-9_]+)\b/g)) add(m[1], 'worker', f);
  }
  const toml = join(root, 'server', 'wrangler.toml');
  let section = '';
  for (const raw of readFileSync(toml, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const head = line.match(/^\[\[?([\w.]+)\]?\]$/);
    if (head) { section = head[1]; continue; }
    const kv = line.match(/^([A-Za-z_][\w]*)\s*=\s*"?([^"]*)"?/);
    if (!kv) continue;
    if (section === 'vars') add(kv[1], 'worker', toml);
    else if (kv[1] === 'binding' || (kv[1] === 'name' && ['ratelimits', 'send_email'].includes(section))) add(kv[2], 'worker', toml);
  }
  for (const f of walk(join(root, '.github', 'workflows'), ['.yml', '.yaml'])) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) add(m[1], 'github-secret', f);
    for (const m of text.matchAll(/\bvars\.([A-Za-z_][A-Za-z0-9_]*)/g)) add(m[1], 'github-variable', f);
  }
  return out;
}

const family = (where) => (where.startsWith('worker-') ? 'worker' : where);

// Things that look like a real secret value rather than a name.
const SECRET_SHAPES = [/AIza[0-9A-Za-z_-]{30,}/, /\bre_[0-9A-Za-z_]{20,}/, /\bgh[pousr]_[0-9A-Za-z]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bxox[abp]-[0-9A-Za-z-]{20,}/, /"private_key"\s*:/];

function check() {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const c of CONNECTIONS) {
    const at = `connection "${c.id}"`;
    if (!/^[a-z0-9-]+$/.test(c.id || '')) errors.push(`${at}: id must be lower-case letters, digits and dashes`);
    if (ids.has(c.id)) errors.push(`${at}: the id is used twice`);
    ids.add(c.id);
    if (!groups.has(c.group)) errors.push(`${at}: unknown group "${c.group}"`);
    for (const k of ['title', 'why', 'cost']) if (typeof c[k] !== 'string' || !c[k].trim()) errors.push(`${at}: needs "${k}"`);
    if (!Array.isArray(c.steps) || !c.steps.length || c.steps.some((s) => typeof s !== 'string' || !s.trim())) errors.push(`${at}: needs at least one step`);
    for (const n of c.names || []) {
      if (!WHERE[n.where]) errors.push(`${at}: ${n.name} has unknown where "${n.where}"`);
      if (!/^[A-Za-z_][\w.]*$/.test(n.name || '')) errors.push(`${at}: bad name "${n.name}"`);
    }
    for (const l of c.links || []) if (!/^https:\/\//.test(l.url || '') || !l.label) errors.push(`${at}: links need a label and an https:// url`);
    for (const k of c.checks || []) {
      if (!['http', 'dns', 'setting', 'pages'].includes(k.type) || !k.label) errors.push(`${at}: checks need a known type and a label`);
      if (k.type === 'http' && !/^https:\/\//.test(k.url || '')) errors.push(`${at}: http checks need an https:// url`);
      if (k.type === 'dns' && !(k.name && /^[A-Z]+$/.test(k.rr || ''))) errors.push(`${at}: dns checks need a name and rr`);
    }
    if (c.docs && !existsSync(join(root, c.docs))) errors.push(`${at}: docs file ${c.docs} does not exist`);
    const text = JSON.stringify(c);
    for (const re of SECRET_SHAPES) if (re.test(text)) errors.push(`${at}: something looks like a secret value (${re}). Only names belong in this public file.`);
  }

  const listed = allNames();
  const have = new Set(listed.map((n) => `${family(n.where)}:${n.name}`));
  const missing = new Map();
  for (const u of usedNames()) {
    const key = `${u.family}:${u.name}`;
    if (!have.has(key)) missing.set(key, [...(missing.get(key) || []), u.file]);
  }
  for (const [key, files] of missing) {
    const [fam, name] = key.split(':');
    const where = fam === 'worker' ? 'worker-secret, worker-var or worker-binding' : fam;
    errors.push(`${name} is used in ${[...new Set(files)].join(', ')} but admin/connections.js does not list it (as ${where}). Add it to the right connection, with steps, in this pull request.`);
  }
  const used = new Set(usedNames().map((u) => `${u.family}:${u.name}`));
  for (const n of listed) {
    if (n.where === 'private-file') continue;
    if (!used.has(`${family(n.where)}:${n.name}`)) warnings.push(`${n.name} (${n.where}, ${n.connection}) is listed but not used in the code. Remove it if it is gone for good.`);
  }

  const md = markdown();
  if (!existsSync(MD_PATH) || readFileSync(MD_PATH, 'utf8') !== md) errors.push('docs/CONNECTIONS.md is out of date. Run: node scripts/connections.mjs md > docs/CONNECTIONS.md');

  for (const w of warnings) console.log(`::warning::${w}`);
  if (errors.length) {
    for (const e of errors) console.log(`::error::${e}`);
    console.log(`\n${errors.length} problem(s) with admin/connections.js.`);
    process.exit(1);
  }
  console.log(`admin/connections.js: ${CONNECTIONS.length} connections, ${listed.length} names, everything the code uses is listed.`);
}

// ------------------------------------------------------------- Markdown
const mdText = (s) => String(s).replace(/(^|[\s(])(https:\/\/[^\s)]+[^\s.,)])/g, '$1<$2>');

function section(c, level = '###') {
  const lines = [`${level} ${c.title}`, '', `**Why:** ${mdText(c.why)}`, '', `**Cost:** ${mdText(c.cost)}`, ''];
  if ((c.names || []).length) {
    lines.push('| Name | Where | Notes |', '| --- | --- | --- |');
    for (const n of c.names) {
      const note = [n.value ? `Value: \`${n.value}\`` : '', n.note || '', n.optional ? 'Optional.' : ''].filter(Boolean).join(' ').replace(/\|/g, '\\|');
      lines.push(`| \`${n.name}\` | ${WHERE[n.where].label} | ${note} |`);
    }
    lines.push('');
  }
  if ((c.settings || []).length) {
    lines.push('**Settings:**', '', ...c.settings.map((s) => `- ${s.label}: ${mdText(s.value)}`), '');
  }
  lines.push('**Steps:**', '', ...c.steps.map((s, i) => `${i + 1}. ${mdText(s)}`), '');
  const links = [...(c.links || []), ...(c.docs ? [{ label: `Full guide (${c.docs})`, url: `${REPO}/blob/main/${c.docs}` }] : [])];
  if (links.length) lines.push(`**Links:** ${links.map((l) => `[${l.label}](${l.url})`).join(' · ')}`, '');
  return lines;
}

export function markdown() {
  const lines = [
    '# Connections and setup',
    '',
    '<!-- Made by `node scripts/connections.mjs md` from admin/connections.js. Do not edit by hand. -->',
    '',
    'Every outside service the game uses, why it is needed, the exact names and settings',
    '(never secret values), steps and links. The same guide, with live Connected and',
    'Missing status, is in the admin dashboard under **Connections and setup**',
    '(https://flg-api.btay74.workers.dev/admin/#connections).',
    '',
    'To change it, edit `admin/connections.js`, then run',
    '`node scripts/connections.mjs md > docs/CONNECTIONS.md`. The Tests workflow fails if code',
    'uses a secret, variable or binding that is not listed there.',
    '',
    '| Where | How to set it |',
    '| --- | --- |',
    ...Object.values(WHERE).map((w) => `| ${w.label} | ${w.place}${w.url ? ` (<${w.url}>)` : ''} |`),
    '',
  ];
  for (const g of GROUPS) {
    const list = CONNECTIONS.filter((c) => c.group === g.id);
    if (!list.length) continue;
    lines.push(`## ${g.title}`, '');
    for (const c of list) lines.push(...section(c));
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ------------------------------------------------------------- owner task email
function email(args) {
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const title = opt('--title');
  const intro = opt('--intro');
  if (args.includes('--missing')) {
    for (const c of CONNECTIONS) console.log(`${c.id.padEnd(20)} ${c.title}`);
    return;
  }
  const picked = args.map((id) => CONNECTIONS.find((c) => c.id === id) || (() => { console.error(`No connection "${id}". List them with --missing.`); process.exit(1); })());
  if (!picked.length) { console.error('Name one or more connection ids. List them with --missing.'); process.exit(1); }
  const lines = [`# ${title || (picked.length === 1 ? picked[0].title : 'Setup tasks')}`, ''];
  lines.push(intro || 'These need doing outside the code. Each one says what it is for and how to do it. Secret values are never in this email, only their names.', '');
  lines.push('The same steps, with live status, are in the admin dashboard under **Connections and setup**: <https://flg-api.btay74.workers.dev/admin/#connections>', '');
  picked.forEach((c, i) => lines.push(...section({ ...c, title: `${i + 1}. ${c.title}` }, '##')));
  process.stdout.write(`${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`);
}

// ------------------------------------------------------------- GitHub status report
async function report() {
  const names = (json) => {
    let all = {};
    try { all = JSON.parse(json || '{}') || {}; } catch (e) { /* none */ }
    return Object.entries(all).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && !IGNORED.includes(k) && typeof v === 'string' && v.trim() !== '').map(([k]) => k).sort();
  };
  const secrets = names(process.env.SECRETS_JSON);
  const variables = names(process.env.VARS_JSON);
  let pages = null;
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo && process.env.GITHUB_TOKEN) {
    const r = await fetch(`https://api.github.com/repos/${repo}/pages`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (r.ok) {
      const p = await r.json();
      pages = { build_type: p.build_type || null, cname: p.cname || null, https_enforced: !!p.https_enforced, status: p.status || null };
    } else console.log(`Pages settings: GitHub answered ${r.status}.`);
  }
  console.log(`Secrets with a value: ${secrets.join(', ') || 'none'}`);
  console.log(`Variables with a value: ${variables.join(', ') || 'none'}`);
  console.log(`Pages: ${pages ? JSON.stringify(pages) : 'not set up or not readable'}`);
  const listed = new Set(allNames().map((n) => n.name));
  const unlisted = [...secrets, ...variables].filter((n) => !listed.has(n));
  if (unlisted.length) console.log(`::warning::Set in GitHub but not listed in admin/connections.js: ${unlisted.join(', ')}`);
  const api = (process.env.FLG_CLOUD_URL || 'https://flg-api.btay74.workers.dev').replace(/\/$/, '');
  const token = (process.env.FLG_ADMIN_TOKEN || '').trim();
  if (!token) { console.log('::warning::FLG_ADMIN_TOKEN is not set, so the dashboard cannot be told.'); return; }
  const r = await fetch(`${api}/admin/v1/connections/github`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ secrets, variables, pages }) });
  // 404: the Worker on Cloudflare does not have this route yet (deploy still running).
  if (r.status === 404) { console.log('::warning::The Worker does not know this report yet. The daily run will send it.'); return; }
  if (!r.ok) { console.log(`::error::The Worker answered ${r.status}.`); process.exit(1); }
  console.log('Reported to the admin dashboard.');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'check') check();
else if (cmd === 'md') process.stdout.write(markdown());
else if (cmd === 'email') email(rest);
else if (cmd === 'report') await report();
else { console.error('Use: check | md | email <id>... | report'); process.exit(2); }
