// Writes the published website design (admin dashboard > Website) into every
// page of the website build. The design comes from the game's Worker
// (GET /v1/site/design); if it can't be reached, from the copy the live site
// published last time (site-design.json), so a network hiccup never undoes a
// published design. With neither, the site keeps its default look.
//
// Each page gets:
//   <html data-site="hub|np|info" data-fx-...>   which page it is, and the choices that switch layouts and effects
//   <style id="site-design">                     the chosen colors, fonts and shapes (empty for the default design)
//   the chosen words in elements marked data-design-text="key"
//   js/design-preview.js                         the dashboard's live preview (does nothing for visitors)
// The game page (fantastical/) and its two form pages (storyline/, report/) keep the game's own look.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SKIP = /^(fantastical|storyline|report)\//;

async function readPublished(base) {
  const sources = [process.env.FLG_CLOUD_URL && `${process.env.FLG_CLOUD_URL.replace(/\/+$/, '')}/v1/site/design`, `${base}/site-design.json`].filter(Boolean);
  for (const u of sources) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const body = await res.json();
      if (body && typeof body.design === 'object') return { design: body.design, version: Number(body.version) || 0, from: u };
    } catch (e) { console.warn(`Website design: ${u} ${e.message}`); }
  }
  return { design: {}, version: 0, from: 'defaults' };
}

export async function applySiteDesign({ site, base, design: given }) {
  const sd = await import(pathToFileURL(join(site, 'js', 'site-design.js')).href);
  const got = given ? { design: given, version: 0, from: 'given' } : await readPublished(base);
  const changes = sd.changes(got.design);
  const css = sd.css(changes);
  const attrs = Object.entries(sd.attributes(changes)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const words = sd.texts(changes);
  // The public copy the next build falls back on.
  writeFileSync(join(site, 'site-design.json'), `${JSON.stringify({ design: changes, version: got.version })}\n`);

  const pages = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.html')) pages.push(relative(site, p).split('\\').join('/')); } };
  walk(site);
  let count = 0;
  for (const page of pages) {
    if (SKIP.test(page) || !/<html[\s>]/.test(readFileSync(join(site, page), 'utf8').slice(0, 400))) continue;
    let html = readFileSync(join(site, page), 'utf8');
    if (!/<\/head>/.test(html)) continue;
    const kind = page === 'index.html' ? 'hub' : page === 'ninetimesnine/index.html' ? 'np' : 'info';
    html = html.replace(/<html([^>]*)>/, (m, rest) => `<html${rest.replace(/\s(data-site|data-fx-[\w-]+|data-card-[\w-]+|data-hero-[\w-]+|data-theme-picker|data-footer-links|data-app-section|data-np-[\w-]+|data-info-[\w-]+|data-shadows)="[^"]*"/g, '')} data-site="${kind}"${attrs}>`);
    html = html.replace(/<style id="site-design">[\s\S]*?<\/style>\s*/, '').replace(/<script type="module" src="[^"]*js\/design-preview\.js"><\/script>\s*/, '');
    // 404.html is served at any depth, so its address starts at the site root.
    const up = page === '404.html' ? new URL(base).pathname.replace(/\/?$/, '/') : '../'.repeat(page.split('/').length - 1);
    html = html.replace('</head>', `<style id="site-design">${css}</style>\n<script type="module" src="${up}js/design-preview.js"></script>\n</head>`);
    html = html.replace(/(<(\w+)\b[^>]*\sdata-design-text="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, inner, close) => (key in words ? `${open}${esc(words[key])}${close}` : m));
    // Search results and sharing (front page and NINETIMESNINE).
    const seo = kind === 'hub' ? ['hubTitle', 'hubDescription'] : kind === 'np' ? ['npTitle', 'npDescription'] : null;
    if (seo) {
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(words[seo[0]])}</title>`)
        .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(words[seo[1]])}$2`)
        .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(words[seo[1]])}$2`);
    }
    writeFileSync(join(site, page), html);
    count++;
  }
  console.log(`Website design: ${Object.keys(changes).length} change(s) from ${got.from}, written into ${count} pages.`);
  return { changes, version: got.version };
}
