// Settings the game's admin dashboard can change without a new release:
// announcements at the top of the home screen and themes that are switched
// off. Read from the shared Worker's GET /v1/config (server/src/settings.js)
// and kept on this device, so the game still works offline with the last copy.
import { CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';
import { esc } from './grid.js';

const KEY = 'remoteConfig';
const DISMISSED = 'dismissedAnnouncements';
const EVERY_MS = 10 * 60_000;

let config = store.getLocal(KEY) || null;
let onThemes = () => {};

export const disabledThemes = () => new Set((config && config.disabledThemes) || []);

function renderAnnouncements() {
  const box = document.getElementById('announcements');
  if (!box) return;
  const gone = new Set(store.getLocal(DISMISSED) || []);
  const list = ((config && config.announcements) || []).filter((a) => !gone.has(a.id));
  box.hidden = !list.length;
  box.innerHTML = list.map((a) => `<div class="announcement${a.level === 'warning' ? ' warning' : ''}" role="${a.level === 'warning' ? 'alert' : 'status'}">
    <p>${esc(a.text)}</p><button type="button" class="btn small" data-close="${Number(a.id)}" aria-label="Close this message">Close</button></div>`).join('');
}

async function refresh() {
  if (!CLOUD_URL) return;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/config`);
    if (!res.ok) return;
    const next = await res.json();
    const themesChanged = JSON.stringify((config && config.disabledThemes) || []) !== JSON.stringify(next.disabledThemes || []);
    config = { announcements: next.announcements || [], disabledThemes: next.disabledThemes || [], features: next.features || {}, fetchedAt: Date.now() };
    store.setLocal(KEY, config);
    renderAnnouncements();
    if (themesChanged) onThemes();
  } catch (e) { /* offline: keep the last copy */ }
}

export function init({ onThemesChanged } = {}) {
  if (onThemesChanged) onThemes = onThemesChanged;
  renderAnnouncements();
  const box = document.getElementById('announcements');
  if (box) {
    box.onclick = (e) => {
      const b = e.target.closest('button[data-close]');
      if (!b) return;
      // Keep only ids that are still showing, so the list stays short.
      const live = new Set(((config && config.announcements) || []).map((a) => a.id));
      store.setLocal(DISMISSED, [...new Set([...(store.getLocal(DISMISSED) || []), Number(b.dataset.close)])].filter((id) => live.has(id)));
      renderAnnouncements();
    };
  }
  if (!CLOUD_URL) return;
  refresh();
  setInterval(refresh, EVERY_MS);
  addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!config || Date.now() - (config.fetchedAt || 0) > EVERY_MS)) refresh();
  });
}
