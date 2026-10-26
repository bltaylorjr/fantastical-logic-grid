// Checks the built website (dist/site) the way a search engine reads it:
//   - every page has a title, a description, a canonical address, one h1 and a language
//   - every structured-data block (JSON-LD) parses and has the fields Google needs for its type
//   - every link and file a page points to on the site exists
//   - sitemap.xml lists only pages that exist, with real dates, and robots.txt points to it
// With --external it also tries every link to another website and lists the
// broken ones (as warnings: other sites go down for a while and come back).
// Run: npm run build && node scripts/check-site.mjs [--external] [--json report.json]
// Used by the Tests workflow (every pull request) and the nightly maintenance run.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist', 'site');
const args = process.argv.slice(2);
const external = args.includes('--external');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const SITE_URL = (process.env.FLG_SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, '');

const problems = [];
const warnings = [];
const problem = (m) => problems.push(m);
const warn = (m) => warnings.push(m);
if (!existsSync(join(site, 'index.html'))) { console.error('dist/site is missing; run npm run build first.'); process.exit(1); }

// Pages a search engine sees: every .html outside the app's own code folders,
// except the search-console verification files.
const pages = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const rel = relative(site, p).split('\\').join('/');
    if (statSync(p).isDirectory()) { if (!/^(vendor|engine|js|fonts|icons|media)$/.test(rel)) walk(p); }
    else if (n.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(rel)) pages.push(rel);
  }
};
walk(site);

// The fields each kind of structured data needs (Google's required and
// recommended properties for the result types this site uses).
const NEEDS = {
  WebSite: ['name', 'url'],
  VideoGame: ['name', 'url', 'description', 'image'],
  WebApplication: ['name', 'offers', 'applicationCategory', 'operatingSystem'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  HowTo: ['name', 'step'],
  VideoObject: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
  Article: ['headline', 'image', 'datePublished', 'author'],
  ItemList: ['itemListElement'],
};
function checkSchema(page, data) {
  if (!/^https?:\/\/schema\.org\/?$/.test(data['@context'] || '')) problem(`${page}: structured data has no schema.org @context.`);
  const types = [].concat(data['@type'] || []);
  if (!types.length) problem(`${page}: structured data has no @type.`);
  for (const t of types) {
    for (const f of NEEDS[t] || []) if (data[f] === undefined || data[f] === '' || (Array.isArray(data[f]) && !data[f].length)) problem(`${page}: ${t} structured data is missing "${f}".`);
  }
  if (types.includes('VideoObject') && !data.contentUrl && !data.embedUrl) problem(`${page}: VideoObject needs contentUrl or embedUrl.`);
  if (types.includes('BreadcrumbList') || types.includes('ItemList')) {
    (data.itemListElement || []).forEach((li, i) => {
      if (li.position !== i + 1) problem(`${page}: list item ${i + 1} has position ${li.position}.`);
      if (!li.name) problem(`${page}: list item ${i + 1} has no name.`);
      if (types.includes('BreadcrumbList') && !li.item) problem(`${page}: breadcrumb ${i + 1} has no address.`);
    });
  }
  if (types.includes('FAQPage')) for (const q of data.mainEntity || []) if (q['@type'] !== 'Question' || !q.name || !q.acceptedAnswer?.text) problem(`${page}: an FAQ entry needs a question and an answer.`);
  for (const d of ['datePublished', 'dateModified', 'uploadDate']) if (data[d] && Number.isNaN(Date.parse(data[d]))) problem(`${page}: ${d} "${data[d]}" is not a date.`);
}

const internal = new Set();
const externalLinks = new Map();
const strip = (h) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '');
for (const page of pages) {
  const html = readFileSync(join(site, page), 'utf8');
  const listed = !/<meta name="robots" content="noindex/i.test(html);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.trim();
  if (!title) problem(`${page}: no <title>.`);
  else if (listed && (title.length < 15 || title.length > 70)) warn(`${page}: the title is ${title.length} characters (search results show about 15 to 70): "${title}".`);
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  if (!desc) problem(`${page}: no meta description.`);
  else if (listed && (desc.length < 50 || desc.length > 170)) warn(`${page}: the description is ${desc.length} characters (aim for 50 to 170).`);
  if (!/<html lang="[a-z-]+"/i.test(html)) problem(`${page}: <html> has no lang.`);
  if (listed) {
    const canon = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
    const want = `${SITE_URL}/${page.replace(/index\.html$/, '')}`;
    if (canon !== want) problem(`${page}: the canonical address is ${canon || 'missing'}, expected ${want}.`);
    // The game page also has a hidden h1 on its play screen.
    const h1s = (strip(html).match(/<h1[\s>]/g) || []).length;
    if (page === 'index.html' ? h1s < 1 : h1s !== 1) problem(`${page}: has ${h1s} <h1> headings (should be one).`);
  }
  for (const [, block] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(block); } catch (e) { problem(`${page}: a structured-data block is not valid JSON (${e.message}).`); continue; }
    for (const d of [].concat(data['@graph'] || data)) checkSchema(page, { '@context': data['@context'], ...d });
  }
  for (const [, attr, raw] of strip(html).matchAll(/\s(href|src)="([^"]*)"/g)) {
    const href = raw.replace(/&amp;/g, '&');
    if (!href || /^(#|mailto:|tel:|data:|javascript:)/.test(href)) continue;
    let u;
    try { u = new URL(href, `${SITE_URL}/${page}`); } catch { problem(`${page}: the ${attr} "${href}" is not a valid address.`); continue; }
    if (u.origin === new URL(SITE_URL).origin) internal.add(`${u.pathname}\t${page}`);
    else if (/^https?:$/.test(u.protocol)) { if (!externalLinks.has(u.href)) externalLinks.set(u.href, page); }
  }
}
const exists = (path) => {
  const p = join(site, decodeURIComponent(path).replace(/^\/+/, ''));
  return existsSync(p) && (statSync(p).isFile() || existsSync(join(p, 'index.html')));
};
const missing = new Map();
for (const entry of internal) {
  const [path, page] = entry.split('\t');
  if (!exists(path)) missing.set(path, [...(missing.get(path) || []), page]);
}
for (const [path, from] of missing) problem(`The link ${path} goes nowhere (on ${from.slice(0, 3).join(', ')}${from.length > 3 ? ` and ${from.length - 3} more` : ''}).`);

// Sitemap and robots.txt.
const sitemap = existsSync(join(site, 'sitemap.xml')) ? readFileSync(join(site, 'sitemap.xml'), 'utf8') : '';
if (!sitemap) problem('sitemap.xml is missing.');
const locs = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)];
for (const [, loc, lastmod] of locs) {
  if (!loc.startsWith(`${SITE_URL}/`)) problem(`The sitemap lists ${loc}, which is not on ${SITE_URL}.`);
  else if (!exists(new URL(loc).pathname)) problem(`The sitemap lists ${loc}, but that page is not in the build.`);
  if (lastmod && (Number.isNaN(Date.parse(lastmod)) || Date.parse(lastmod) > Date.now() + 2 * 86400_000)) problem(`The sitemap date ${lastmod} for ${loc} is not a real date.`);
}
const listedPages = pages.filter((p) => !/<meta name="robots" content="noindex/i.test(readFileSync(join(site, p), 'utf8')));
for (const p of listedPages) if (!locs.some(([, loc]) => loc === `${SITE_URL}/${p.replace(/index\.html$/, '')}`)) warn(`${p} can be listed by search engines but is not in the sitemap.`);
const robots = existsSync(join(site, 'robots.txt')) ? readFileSync(join(site, 'robots.txt'), 'utf8') : '';
if (!robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`)) problem('robots.txt does not point to the sitemap.');
// Only the groups search engines follow matter (AI training crawlers may be shut out on purpose).
const groups = robots.split(/\n\s*\n/).map((g) => ({ agents: [...g.matchAll(/^User-agent:\s*(.+)$/gim)].map((m) => m[1].trim().toLowerCase()), block: /^Disallow:\s*\/\s*$/m.test(g) }));
for (const bot of ['*', 'googlebot', 'bingbot']) if (groups.some((g) => g.block && g.agents.includes(bot))) problem(`robots.txt blocks the whole site for ${bot === '*' ? 'every search engine' : bot}.`);

// Links to other websites (nightly only).
if (external) {
  const check = async (href) => {
    for (let i = 0; i < 2; i++) {
      try {
        const opts = { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; FLG-link-check; +https://thelogicgrid.com/)' } };
        let r = await fetch(href, { ...opts, method: 'HEAD' });
        if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(href, { ...opts, method: 'GET' });
        if (r.status < 400 || r.status === 429) return null;
        if (i === 1) return `answers ${r.status}`;
      } catch (e) { if (i === 1) return e.cause?.code || e.name; }
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
  const list = [...externalLinks];
  for (let i = 0; i < list.length; i += 8) {
    const res = await Promise.all(list.slice(i, i + 8).map(([href]) => check(href)));
    res.forEach((why, j) => { if (why) warn(`The outside link ${list[i + j][0]} (on ${list[i + j][1]}) ${why.startsWith('answers') ? why : `does not answer (${why})`}.`); });
  }
}

const summary = `${pages.length} pages, ${locs.length} in the sitemap, ${internal.size} links on the site${external ? `, ${externalLinks.size} outside links` : ''}.`;
console.log(summary);
for (const p of problems) console.log(`Problem: ${p}`);
for (const w of warnings) console.log(`Warning: ${w}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, problems, warnings }, null, 2));
if (problems.length) process.exitCode = 1;
