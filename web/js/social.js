// The game's social media pages, shared by the admin setting (server
// settings.js: Settings and switches > Social links), the website's page footer
// (scripts/seo.mjs) and the game's home screen footer (app.js). Only the
// networks with a link set are shown, so a new page appears as soon as its
// link is added: in the game within about a minute, on the website after the
// next nightly build.
//
// Each button is the network's name. To show a network's own icon, put the
// official icon from its brand kit at web/icons/social/<id>.svg; the website
// build and the game use it when it is there.
export const NETWORKS = [
  { id: 'facebook', name: 'Facebook', hosts: /(^|\.)(facebook\.com|fb\.me|fb\.com)$/ },
  { id: 'instagram', name: 'Instagram', hosts: /(^|\.)instagram\.com$/ },
  { id: 'youtube', name: 'YouTube', hosts: /(^|\.)(youtube\.com|youtu\.be)$/ },
  { id: 'tiktok', name: 'TikTok', hosts: /(^|\.)tiktok\.com$/ },
  { id: 'pinterest', name: 'Pinterest', hosts: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/ },
  { id: 'x', name: 'X', hosts: /(^|\.)(x\.com|twitter\.com)$/ },
  { id: 'threads', name: 'Threads', hosts: /(^|\.)threads\.(net|com)$/ },
  { id: 'bluesky', name: 'Bluesky', hosts: /(^|\.)bsky\.app$/ },
  { id: 'reddit', name: 'Reddit', hosts: /(^|\.)reddit\.com$/ },
  { id: 'discord', name: 'Discord', hosts: /(^|\.)(discord\.gg|discord\.com)$/ },
  { id: 'linkedin', name: 'LinkedIn', hosts: /(^|\.)linkedin\.com$/ },
];
// The page the game has had since launch, used until the admin setting says otherwise.
export const DEFAULT_LINKS = { facebook: 'https://www.facebook.com/share/19pDDj5Ppf/' };

// [{ id, name, url }] for the networks with a usable link, in NETWORKS order.
export function socialLinks(links) {
  const out = [];
  for (const n of NETWORKS) {
    const raw = links && typeof links[n.id] === 'string' ? links[n.id].trim() : '';
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' && n.hosts.test(u.hostname.toLowerCase())) out.push({ id: n.id, name: n.name, url: u.href });
    } catch (e) { /* not a link */ }
  }
  return out;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The footer row: one link per network, with its icon when iconBase/<id>.svg
// exists (hasIcon) or its name alone otherwise. Opens in a new tab.
export function socialHtml(list, { iconBase = '', hasIcon = () => false } = {}) {
  if (!list.length) return '';
  return `<ul class="social" aria-label="Follow The Fantastical Logic Grid">${list.map((s) => `<li><a class="social-link social-${escHtml(s.id)}" href="${escHtml(s.url)}" rel="me noopener" target="_blank">${hasIcon(s.id) ? `<img src="${escHtml(iconBase)}${escHtml(s.id)}.svg" alt="" width="20" height="20">` : ''}<span>${escHtml(s.name)}</span></a></li>`).join('')}</ul>`;
}
