// Local storage for saved puzzles, the used-story list and settings.
// Saves go to IndexedDB on this device. If IndexedDB is blocked (private
// windows, some embedded views), it falls back to localStorage, then memory.

const DB_NAME = 'fantastical-logic-grid';
const SAVES = 'saves';
const META = 'meta';
const MEDIA = 'media';
const LS_PREFIX = 'flg.';

let dbPromise = null;
let current = null;
const memory = new Map();

// Account sync listens for local changes (sync.js). Writes that sync itself
// makes pass { fromSync: true } so they are not sent back to the server.
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(kind, key, deleted, opts) {
  if (opts && opts.fromSync) return;
  for (const fn of listeners) { try { fn({ kind, key, deleted: !!deleted }); } catch (e) { /* sync is optional */ } }
}

// The browser can close our connection at any time: another tab or a new
// version of the app upgrading the database, iOS/Android suspending the page,
// clearing site data, or low disk. A closed connection throws "The database
// connection is closing" (InvalidStateError), so we forget it and reopen.
function forgetDb(db) {
  if (current === db) { current = null; dbPromise = null; }
}

function openDb() {
  if (dbPromise) return dbPromise;
  const p = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let a newer version (another tab, an app update) upgrade; we reopen on next use.
        db.onversionchange = () => { forgetDb(db); try { db.close(); } catch (e) { /* already closed */ } };
        db.onclose = () => forgetDb(db);
        current = db;
        resolve(db);
      };
      // Not cached, so a later call can try again once the block clears.
      req.onerror = () => { if (dbPromise === p) dbPromise = null; resolve(null); };
      req.onblocked = () => { if (dbPromise === p) dbPromise = null; resolve(null); };
    } catch (e) {
      resolve(null);
    }
  });
  dbPromise = p;
  return p;
}

function isClosing(e) {
  return !!e && (e.name === 'InvalidStateError' || /closing|closed/i.test(e.message || ''));
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error || new Error('Storage error'));
    t.onabort = () => reject(t.error || new Error('Storage was full or blocked'));
  });
}

// Runs one transaction, reopening the database and retrying once if the
// connection was closed under us. Returns { ok: false } when IndexedDB is
// unavailable, so the caller uses the localStorage fallback.
async function run(store, mode, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await openDb();
    if (!db) return { ok: false };
    try {
      return { ok: true, value: await tx(db, store, mode, fn) };
    } catch (e) {
      if (attempt === 0 && isClosing(e)) { forgetDb(db); continue; }
      throw e;
    }
  }
  return { ok: false };
}

// localStorage fallback keeps each save under its own key.
const ls = {
  get(k) { try { const v = localStorage.getItem(LS_PREFIX + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return memory.get(k); } },
  set(k, v) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch (e) { memory.set(k, v); if (e && e.name === 'QuotaExceededError') throw e; } },
  del(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* ignore */ } memory.delete(k); },
  keys(prefix) {
    const out = new Set([...memory.keys()].filter((k) => k.startsWith(prefix)));
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS_PREFIX + prefix)) out.add(k.slice(LS_PREFIX.length)); } } catch (e) { /* ignore */ }
    return [...out];
  },
};

export async function listSaves() {
  const r = await run(SAVES, 'readonly', (s) => s.getAll());
  if (r.ok) return r.value;
  return ls.keys('save:').map((k) => ls.get(k)).filter(Boolean);
}

export async function getSave(id) {
  const r = await run(SAVES, 'readonly', (s) => s.get(id));
  if (r.ok) return r.value;
  return ls.get(`save:${id}`);
}

export async function putSave(save, opts) {
  const r = await run(SAVES, 'readwrite', (s) => s.put(save));
  if (!r.ok) ls.set(`save:${save.id}`, save);
  changed('save', save.id, false, opts);
}

export async function deleteSave(id, opts) {
  const r = await run(SAVES, 'readwrite', (s) => s.delete(id));
  if (!r.ok) ls.del(`save:${id}`);
  changed('save', id, true, opts);
}

export async function getMeta(key, fallback) {
  const r = await run(META, 'readonly', (s) => s.get(key));
  const v = r.ok ? r.value : ls.get(`meta:${key}`);
  return v === undefined ? fallback : v;
}

export async function setMeta(key, value, opts) {
  const r = await run(META, 'readwrite', (s) => s.put(value, key));
  if (!r.ok) ls.set(`meta:${key}`, value);
  changed('meta', key, false, opts);
}

// Generated pictures and voice clips (Blobs), keyed by story id. Memory only
// when IndexedDB is unavailable.
export async function getMedia(key) {
  const r = await run(MEDIA, 'readonly', (s) => s.get(key));
  if (r.ok) return r.value;
  return memory.get(`media:${key}`);
}
export async function putMedia(key, blob) {
  const r = await run(MEDIA, 'readwrite', (s) => s.put(blob, key));
  if (r.ok) return r.value;
  memory.set(`media:${key}`, blob);
}

// Ask the browser to keep our data even when disk space runs low.
export function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
}

// Settings are small and read before first paint, so they live in localStorage.
export const DEFAULT_SETTINGS = {
  colorTheme: 'system', autoX: false, singleKeys: true, showTimer: true, coach: true, sound: true, volume: 60,
  silent: false, music: true, musicVolume: 40, instant: false,
  readAloud: true, aiPictures: 'scene', voiceProvider: 'server', kokoroReady: false, portraitStyle: 'notionists', confetti: true, celebrations: ['confetti'], celebrateRandom: false, introOffered: false,
  learn: true, shareNoticeShown: false, storyBeats: true, language: 'en-US', languageOffered: false,
};

// Chosen in the admin dashboard for every player (GET /v1/config, kept by
// remote-config.js): setting name -> its name in the config's `game`.
const ADMIN_SET = { voiceProvider: 'voiceSource', readAloud: 'readAloud', portraitStyle: 'portraitStyle', confetti: 'confetti', aiPictures: 'aiPictures',
  celebrations: 'celebrations', celebrateRandom: 'celebrateRandom' };
// Starting values the dashboard can change. They apply until the player
// changes that setting; the keys a player changed are listed in settings.chosen.
const ADMIN_DEFAULTS = ['sound', 'volume', 'music', 'musicVolume'];
// Defaults before the dashboard chose them, to tell which older saved values
// were the player's own choice (theme music used to start off).
const OLD_DEFAULTS = { sound: true, volume: 60, music: false, musicVolume: 40 };
// Settings that moved to the admin dashboard. Players' own AI keys are removed
// from this device: the game's server now makes pictures and voices.
const MOVED = ['aiKey', 'geminiKey', 'aiVoice', 'serverVoices', 'shareLearning', 'reportErrors',
  'imageModel', 'imageQuality', 'voiceModel', 'geminiVoiceModel', 'storyModel'];

export function loadSettings() {
  const saved = ls.get('settings') || {};
  const s = { ...DEFAULT_SETTINGS, ...saved };
  for (const k of MOVED) delete s[k];
  if (!Array.isArray(s.chosen)) s.chosen = ADMIN_DEFAULTS.filter((k) => k in saved && saved[k] !== OLD_DEFAULTS[k]);
  const config = ls.get('remoteConfig') || {};
  const defaults = config.defaults || {};
  for (const k of ADMIN_DEFAULTS) if (!s.chosen.includes(k) && defaults[k] !== undefined) s[k] = defaults[k];
  const game = config.game || {};
  for (const [k, from] of Object.entries(ADMIN_SET)) s[k] = game[from] !== undefined ? game[from] : DEFAULT_SETTINGS[k];
  // A config from before the effect list: confetti or nothing.
  if (game.celebrations === undefined && game.confetti !== undefined) s.celebrations = game.confetti ? ['confetti'] : [];
  return s;
}

// Remembers that the player picked this value themselves, so the dashboard's
// starting value no longer replaces it.
export function markChosen(settings, key) {
  if (ADMIN_DEFAULTS.includes(key) && !(settings.chosen || []).includes(key)) settings.chosen = [...(settings.chosen || []), key];
}

export function saveSettings(settings, opts) {
  try { ls.set('settings', settings); } catch (e) { /* settings are optional */ }
  if (!(opts && opts.fromSync)) { try { ls.set('settingsAt', Date.now()); } catch (e) { /* optional */ } }
  changed('settings', 'settings', false, opts);
}
export function settingsChangedAt() { return ls.get('settingsAt') || 0; }
export function setSettingsChangedAt(t) { try { ls.set('settingsAt', t); } catch (e) { /* optional */ } }

// Small per-device values that sync and sign-in keep in localStorage.
export function getLocal(key) { return ls.get(key); }
export function setLocal(key, value) { if (value === undefined) ls.del(key); else ls.set(key, value); }

export function loadSetupChoices() { return ls.get('setup') || null; }
export function saveSetupChoices(choices) { try { ls.set('setup', choices); } catch (e) { /* optional */ } }

// Removes every saved puzzle from this device only (signing out on a shared
// device). Synced copies stay in the player's account.
export async function clearSavesOnDevice() {
  for (const s of await listSaves()) await deleteSave(s.id, { fromSync: true });
}
