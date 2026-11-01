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
// Themes only premium supporters can pick (web/js/perks.js), and the page
// where players get them ('' for none).
export const premiumThemes = () => new Set((config && config.game && config.game.premiumThemes) || []);
export const extrasUrl = () => {
  const u = config && config.game && config.game.extrasUrl;
  return typeof u === 'string' && u.startsWith('https://') ? u : '';
};
// The game's social pages with a link set (social.js), for the home footer,
// or null before the server has said.
export const social = () => (config && Array.isArray(config.social) ? config.social : null);
// News from the team for everyone, shown in Messages (messages.js).
export const news = () => (config && config.news) || [];
// The owner's optional "Support the game" page (an https link), or ''.
export const supportUrl = () => {
  const u = config && config.game && config.game.supportUrl;
  return typeof u === 'string' && u.startsWith('https://') ? u : '';
};

// The dashboard's NINETIMESNINE choices (server/src/settings.js publicConfig),
// or {} before the server has said: the game then uses the module's defaults.
export const numberPlace = () => (config && config.numberPlace) || {};

// Minutes without activity before a signed-in player is signed out (idle.js);
// 0 means never. 30 until the dashboard says otherwise.
export const idleMinutes = () => {
  const m = config && config.game && config.game.idleMinutes;
  return Number.isFinite(m) && m >= 0 ? m : 30;
};

// Gentle support asks (web/js/support.js): on only with the Support page link.
export const supportAsks = () => !!(config && config.game && config.game.supportAsks) && !!supportUrl();

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
    const themeLists = (c) => JSON.stringify([(c && c.disabledThemes) || [], (c && c.game && c.game.premiumThemes) || [], (c && c.game && c.game.extrasUrl) || '']);
    const themesChanged = themeLists(config) !== themeLists(next);
    const before = JSON.stringify(config && [config.features, config.defaults, config.game, config.news, config.numberPlace]);
    config = {
      announcements: next.announcements || [], disabledThemes: next.disabledThemes || [], features: next.features || {},
      defaults: next.defaults || {}, game: next.game || {}, news: next.news || [], numberPlace: next.numberPlace || null, fetchedAt: Date.now(),
    };
    store.setLocal(KEY, config);
    renderAnnouncements();
    if (themesChanged) onThemes();
    if (before !== JSON.stringify([config.features, config.defaults, config.game, config.news, config.numberPlace])) onChange();
  } catch (e) { /* offline: keep the last copy */ }
}

// Fetch the config now (the how-to-play video capture uses it).
export const refreshNow = () => refresh();

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
  setInterval(() => { if (!document.hidden) refresh(); }, EVERY_MS);
  addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!config || Date.now() - (config.fetchedAt || 0) > EVERY_MS)) refresh();
  });
}
