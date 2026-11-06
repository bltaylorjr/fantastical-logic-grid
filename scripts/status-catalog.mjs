#!/usr/bin/env node
// What the admin Status page should watch, read from the code itself, so it
// adds and removes things as the apps change (server/src/status.js uses it):
//
//   workflows  every GitHub Actions workflow: its name, file and schedules, and
//              how often a scheduled one should run (the longest gap between
//              its cron times), so a missed run shows as late
//   crons      the Worker's own crons (server/wrangler.toml)
//   bindings   the Worker's bindings that are switched on (vpc_services, d1, ai ...)
//   tables     database tables after every migration (created minus dropped)
//   pages      the admin dashboard's pages, so every row links somewhere real
//
// Writes server/src/status-catalog.js only when something changed. Runs on
// every Worker deploy and `wrangler dev` (the [build] command in
// server/wrangler.toml), so a new workflow, table or page is watched as soon as
// it ships and a removed one stops being watched.
//
//   node scripts/status-catalog.mjs           write it
//   node scripts/status-catalog.mjs --check   say whether the copy in the repo is current

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'server/src/status-catalog.js');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const unquote = (s) => s.trim().replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');

// ---- cron: the longest gap between runs, in minutes (5-field UTC cron)
function field(spec, lo, hi) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [range, stepS] = part.split('/');
    const step = Number(stepS || 1);
    let a = lo;
    let b = hi;
    if (range !== '*') {
      const [x, y] = range.split('-');
      a = Number(x);
      b = y === undefined ? (stepS ? hi : a) : Number(y);
    }
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
export function cronGapMinutes(crons) {
  const parsed = crons.map((c) => {
    const [mi, ho, dom, mo, dow] = c.trim().split(/\s+/);
    return { mi: field(mi, 0, 59), ho: field(ho, 0, 23), dom: field(dom, 1, 31), mo: field(mo, 1, 12), dow: new Set([...field(dow.replace(/7/g, '0'), 0, 6)]), domAny: dom === '*', dowAny: dow === '*' };
  });
  const start = Date.UTC(2026, 0, 5); // a Monday; 35 days covers weekly and most monthly gaps
  let last = null;
  let first = null;
  let gap = 0;
  for (let m = 0; m < 35 * 1440; m++) {
    const d = new Date(start + m * 60000);
    const hit = parsed.some((p) => p.mi.has(d.getUTCMinutes()) && p.ho.has(d.getUTCHours()) && p.mo.has(d.getUTCMonth() + 1)
      && (p.domAny && p.dowAny ? true : p.domAny ? p.dow.has(d.getUTCDay()) : p.dowAny ? p.dom.has(d.getUTCDate()) : p.dom.has(d.getUTCDate()) || p.dow.has(d.getUTCDay())));
    if (!hit) continue;
    if (last !== null) gap = Math.max(gap, m - last);
    if (first === null) first = m;
    last = m;
  }
  if (first === null) return null;
  if (first === last) return 31 * 1440; // once in the window: treat as monthly
  return Math.max(gap, 35 * 1440 - last + first); // wrap around the window
}

// ---- GitHub Actions workflows
function workflows() {
  const dir = join(ROOT, '.github/workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const name = unquote((text.match(/^name:\s*(.+)$/m) || [, file])[1]);
    const crons = [...text.matchAll(/^\s*-\s*cron:\s*(['"]?)([^'"\n#]+)\1/gm)].map((m) => m[2].trim());
    const on = (text.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)+)/m) || [, ''])[1];
    const events = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    const inline = (text.match(/^on:\s*\[?([^\n\]]+)\]?\s*$/m) || [, ''])[1].split(/[\s,]+/).filter((x) => /^[a-z_]+$/.test(x));
    const gap = crons.length ? cronGapMinutes(crons) : null;
    return { file, path: `.github/workflows/${file}`, name, crons, events: [...new Set([...events, ...inline])], everyMinutes: gap };
  });
}

// ---- server/wrangler.toml (only lines that aren't commented out)
function wrangler() {
  const lines = read('server/wrangler.toml').split('\n').filter((l) => !/^\s*#/.test(l));
  const text = lines.join('\n');
  const crons = (text.match(/^crons\s*=\s*\[([^\]]*)\]/m) || [, ''])[1].split(',').map(unquote).filter(Boolean);
  const bindings = {};
  let table = null;
  for (const l of lines) {
    const t = l.match(/^\s*\[\[?([a-z_.]+)\]?\]/);
    if (t) { table = t[1]; continue; }
    const b = l.match(/^\s*(?:binding|name)\s*=\s*"([A-Z0-9_]+)"/);
    if (b && table && table !== 'ratelimits' && !table.startsWith('triggers')) (bindings[table] ||= []).push(b[1]);
  }
  for (const k of Object.keys(bindings)) bindings[k] = [...new Set(bindings[k])].sort();
  return { crons, cronEveryMinutes: Object.fromEntries(crons.map((c) => [c, cronGapMinutes([c])])), bindings };
}

// ---- database tables after every migration
function tables() {
  const dir = join(ROOT, 'server/migrations');
  const have = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '');
    for (const m of sql.matchAll(/\b(CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["`]?(\w+)/gi)) {
      if (m[1].toUpperCase() === 'CREATE') have.add(m[2]); else have.delete(m[2]);
    }
    for (const m of sql.matchAll(/\bALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gi)) { have.delete(m[1]); have.add(m[2]); }
  }
  return [...have].sort();
}

// ---- the admin dashboard's pages
function pages() {
  const html = read('admin/index.html');
  const nav = [...html.matchAll(/<a href="#([\w-]+)" data-min="(\w+)"/g)].map((m) => m[1]);
  const views = [...html.matchAll(/data-view="([\w-]+)"/g)].map((m) => m[1]);
  return [...new Set([...nav, ...views])].sort();
}

export function build() {
  const catalog = { workflows: workflows(), worker: wrangler(), tables: tables(), pages: pages() };
  const hash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0, 12);
  return `// Generated by scripts/status-catalog.mjs from the repo (workflows, server/wrangler.toml,
// migrations, admin/index.html). Don't edit: it's rewritten on every Worker deploy.
export const CATALOG = ${JSON.stringify({ hash, ...catalog }, null, 1)};
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = build();
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (old === text) console.log('Status catalog: current.');
    else {
      // Not a failure: every deploy rebuilds it. This only keeps the repo copy (used by the tests) tidy.
      console.log('::warning title=Status catalog out of date::Run node scripts/status-catalog.mjs (deploys rebuild it anyway).');
    }
  } else if (old !== text) {
    writeFileSync(OUT, text);
    console.log('Status catalog updated.');
  } else console.log('Status catalog: no changes.');
}
