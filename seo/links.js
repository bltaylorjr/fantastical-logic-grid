// The link-in-bio page (links/, built by scripts/seo.mjs). Instagram and
// TikTok captions cannot hold a clickable link, so the bio points here. The
// page lists the newest posts from those sites, each through its own tracked
// link (server/src/marketing.js, GET /v1/links), so a visit from the bio
// counts for the post that sent it. Without the list the page still works:
// the fixed buttons above it are plain links.
const box = document.querySelector('#latest');
const API = (box?.dataset.api || '').replace(/\/+$/, '');
const NAMES = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function load() {
  if (!box || !API) return;
  try {
    const res = await fetch(`${API}/v1/links`);
    if (!res.ok) return;
    const { links } = await res.json();
    if (!Array.isArray(links) || !links.length) return;
    box.querySelector('ul').innerHTML = links.map((l) => `<li><a class="btn link-btn" href="${esc(l.link)}">${esc(l.title)}<small>From our ${esc(NAMES[l.channel] || l.channel)}</small></a></li>`).join('');
    box.hidden = false;
  } catch (e) { /* offline: the fixed links still work */ }
}
load();
