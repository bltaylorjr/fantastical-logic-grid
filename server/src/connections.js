// Live status for the admin dashboard's "Connections and setup" guide. The list
// itself is admin/connections.js (the single source); this file says, for each
// name and check there, whether it is set up:
//   - Worker secrets, variables and bindings: is the name present in env?
//     (Only presence. A value never leaves the Worker.)
//   - GitHub secrets and variables, and the Pages settings: the GitHub Action
//     "Connections status" (.github/workflows/connections-status.yml) reports
//     which names have a value, never the values, to POST /admin/v1/connections/github.
//   - http and dns checks: fetched from here (DNS through Cloudflare's free
//     DNS-over-HTTPS), cached for CHECK_CACHE_MS.
//   - setting checks: the dashboard's own switches.
import { CONNECTIONS, allNames } from '../../admin/connections.js';
import { getSettings } from './settings.js';

const CHECK_CACHE_MS = 10 * 60_000;
const REFRESH_GAP_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const MAX_NAMES = 300;

let cache = { at: 0, results: null };

const isSet = (v) => v != null && (typeof v !== 'string' || v.trim() !== '');

async function fetchText(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { redirect: 'follow', ...init, signal: ctl.signal });
    return { status: r.status, text: (await r.text()).slice(0, 20_000) };
  } finally { clearTimeout(t); }
}

async function httpCheck(c) {
  try {
    const r = await fetchText(c.url, { headers: { 'User-Agent': 'flg-api connections check' } });
    if (r.status !== 200) return { ok: false, detail: `Answered ${r.status}` };
    if (c.contains && !r.text.includes(c.contains)) return { ok: false, detail: 'Answered, but not with the expected content' };
    return { ok: true };
  } catch (e) {
    return { ok: null, detail: 'Could not reach it just now' };
  }
}

async function dnsCheck(c) {
  try {
    const r = await fetchText(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(c.name)}&type=${c.rr}`, { headers: { Accept: 'application/dns-json' } });
    if (r.status !== 200) return { ok: null, detail: 'DNS lookup failed just now' };
    const answers = (JSON.parse(r.text).Answer || []).map((a) => String(a.data));
    if (!answers.length) return { ok: false, detail: `No ${c.rr} record for ${c.name}` };
    if (c.contains && !answers.some((a) => a.toLowerCase().includes(c.contains.toLowerCase()))) return { ok: false, detail: `The ${c.rr} record does not match` };
    return { ok: true };
  } catch (e) {
    return { ok: null, detail: 'DNS lookup failed just now' };
  }
}

async function outsideChecks(now, force) {
  const stale = !cache.results || now - cache.at > CHECK_CACHE_MS || (force && now - cache.at > REFRESH_GAP_MS);
  if (!stale) return cache;
  const jobs = [];
  for (const c of CONNECTIONS) {
    (c.checks || []).forEach((k, i) => {
      if (k.type === 'http') jobs.push(httpCheck(k).then((r) => [`${c.id}#${i}`, r]));
      if (k.type === 'dns') jobs.push(dnsCheck(k).then((r) => [`${c.id}#${i}`, r]));
    });
  }
  cache = { at: now, results: Object.fromEntries(await Promise.all(jobs)) };
  return cache;
}

export async function githubReport(env) {
  try {
    const row = await env.DB.prepare("SELECT data, reported_at FROM connection_reports WHERE source = 'github'").first();
    return row ? { ...JSON.parse(row.data), reportedAt: row.reported_at } : null;
  } catch (e) { return null; } // table not made yet
}

// What the dashboard shows: { names: {"where:NAME": true|false|null}, checks:
// {"id#i": {ok, detail}}, github: {reportedAt, unlisted}, checkedAt }.
export async function connectionStatus(env, now = Date.now(), { force = false } = {}) {
  const [gh, settings, outside] = await Promise.all([githubReport(env), getSettings(env, now), outsideChecks(now, force)]);
  const secrets = new Set(gh?.secrets || []);
  const variables = new Set(gh?.variables || []);
  const names = {};
  for (const n of allNames()) {
    const key = `${n.where}:${n.name}`;
    if (n.where.startsWith('worker-')) names[key] = isSet(env[n.name]);
    else if (n.where === 'github-secret') names[key] = gh ? secrets.has(n.name) : null;
    else if (n.where === 'github-variable') names[key] = gh ? variables.has(n.name) : null;
    else names[key] = null;
  }
  const checks = { ...outside.results };
  for (const c of CONNECTIONS) {
    (c.checks || []).forEach((k, i) => {
      const id = `${c.id}#${i}`;
      if (k.type === 'setting') checks[id] = { ok: settings[k.key] === k.value };
      if (k.type === 'pages') {
        const p = gh?.pages;
        if (!gh) checks[id] = { ok: null, detail: 'Not reported by GitHub yet' };
        else if (!p) checks[id] = { ok: false, detail: 'GitHub Pages is not set up' };
        else checks[id] = { ok: p[k.field] === k.value, detail: p[k.field] === k.value ? undefined : `Now: ${p[k.field] ?? 'not set'}` };
      }
    });
  }
  // Names GitHub has that the guide does not list (an old or new secret).
  const listed = new Set(allNames().filter((n) => n.where.startsWith('github-')).map((n) => n.name));
  const unlisted = gh ? [...secrets, ...variables].filter((n) => !listed.has(n)).sort() : [];
  return { names, checks, github: gh ? { reportedAt: gh.reportedAt, unlisted } : null, checkedAt: outside.at };
}

// The GitHub Action's report: only names that have a value, never values.
export function checkGithubReport(body) {
  const list = (v) => (Array.isArray(v) && v.length <= MAX_NAMES && v.every((n) => typeof n === 'string' && NAME.test(n)) ? [...new Set(v)].sort() : null);
  const secrets = list(body.secrets);
  const variables = list(body.variables);
  if (!secrets || !variables) return { error: 'Send secrets and variables as lists of names.' };
  let pages = null;
  if (body.pages && typeof body.pages === 'object') {
    const p = body.pages;
    pages = {
      build_type: typeof p.build_type === 'string' ? p.build_type.slice(0, 40) : null,
      cname: typeof p.cname === 'string' ? p.cname.slice(0, 253) : null,
      https_enforced: p.https_enforced === true,
      status: typeof p.status === 'string' ? p.status.slice(0, 40) : null,
    };
  }
  return { value: { secrets, variables, pages } };
}

export async function saveGithubReport(env, value, now = Date.now()) {
  await env.DB.prepare(`INSERT INTO connection_reports (source, data, reported_at) VALUES ('github', ?1, ?2)
    ON CONFLICT (source) DO UPDATE SET data = excluded.data, reported_at = excluded.reported_at`).bind(JSON.stringify(value), now).run();
}
