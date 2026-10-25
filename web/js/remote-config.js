// Settings the game's admin dashboard can change without a new release:
// announcements at the top of the home screen, themes and shared features
// that are switched off, the sound, voice and picture choices made for every
// player, and starting values for the player's own sound settings (both
// applied in store.loadSettings). Read from the shared Worker's GET /v1/config (server/src/settings.js)
// and kept on this device, so the game still works offline with the last copy.
import { CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';
import { esc } from './grid.js';

const KEY = 'remoteConfig';
const DISMISSED = 'dismissedAnnouncements';
const EVERY_MS = 10 * 60_000;

let config = store.getLocal(KEY) || null;
let onThemes = () => {};
let onChange = () => {};

export const disabledThemes = () => new Set((config && config.disabledThemes) || []);
// A shared feature is on unless the dashboard switched it off.
export const feature = (name) => !(config && config.features && config.features[name] === false);

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
    const before = JSON.stringify(config && [config.features, config.defaults, config.game]);
    config = {
      announcements: next.announcements || [], disabledThemes: next.disabledThemes || [], features: next.features || {},
      defaults: next.defaults || {}, game: next.game || {}, fetchedAt: Date.now(),
    };
    store.setLocal(KEY, config);
    renderAnnouncements();
    if (themesChanged) onThemes();
    if (before !== JSON.stringify([config.features, config.defaults, config.game])) onChange();
  } catch (e) { /* offline: keep the last copy */ }
}

export function init({ onThemesChanged, onConfigChanged } = {}) {
  if (onThemesChanged) onThemes = onThemesChanged;
  if (onConfigChanged) onChange = onConfigChanged;
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
