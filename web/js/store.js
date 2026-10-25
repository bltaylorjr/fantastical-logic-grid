// Local storage for saved puzzles, the used-story list and settings.
// Saves go to IndexedDB on this device. If IndexedDB is blocked (private
// windows, some embedded views), it falls back to localStorage, then memory.

const DB_NAME = 'fantastical-logic-grid';
const SAVES = 'saves';
const META = 'meta';
const MEDIA = 'media';
const LS_PREFIX = 'flg.';

let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return dbPromise;
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
  const db = await openDb();
  if (db) return tx(db, SAVES, 'readonly', (s) => s.getAll());
  return ls.keys('save:').map((k) => ls.get(k)).filter(Boolean);
}

export async function getSave(id) {
  const db = await openDb();
  if (db) return tx(db, SAVES, 'readonly', (s) => s.get(id));
  return ls.get(`save:${id}`);
}

export async function putSave(save) {
  const db = await openDb();
  if (db) return tx(db, SAVES, 'readwrite', (s) => s.put(save));
  return ls.set(`save:${save.id}`, save);
}

export async function deleteSave(id) {
  const db = await openDb();
  if (db) return tx(db, SAVES, 'readwrite', (s) => s.delete(id));
  return ls.del(`save:${id}`);
}

export async function getMeta(key, fallback) {
  const db = await openDb();
  const v = db ? await tx(db, META, 'readonly', (s) => s.get(key)) : ls.get(`meta:${key}`);
  return v === undefined ? fallback : v;
}

export async function setMeta(key, value) {
  const db = await openDb();
  if (db) return tx(db, META, 'readwrite', (s) => s.put(value, key));
  return ls.set(`meta:${key}`, value);
}

// Generated pictures and voice clips (Blobs), keyed by story id. Memory only
// when IndexedDB is unavailable.
export async function getMedia(key) {
  const db = await openDb();
  if (db) return tx(db, MEDIA, 'readonly', (s) => s.get(key));
  return memory.get(`media:${key}`);
}
export async function putMedia(key, blob) {
  const db = await openDb();
  if (db) return tx(db, MEDIA, 'readwrite', (s) => s.put(blob, key));
  memory.set(`media:${key}`, blob);
}

// Ask the browser to keep our data even when disk space runs low.
export function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
}

// Settings are small and read before first paint, so they live in localStorage.
export const DEFAULT_SETTINGS = {
  colorTheme: 'system', autoX: false, singleKeys: true, showTimer: true, coach: true, sound: true, volume: 60,
  silent: false, music: false, musicVolume: 40, instant: false,
  readAloud: true, aiKey: '', aiPictures: 'scene', aiVoice: true, imageModel: 'gpt-image-2.5-flare', imageQuality: 'medium', voiceModel: 'gpt-4o-mini-tts',
  voiceProvider: 'kokoro', kokoroReady: false, portraitStyle: 'notionists', confetti: true, introOffered: false, geminiKey: '', geminiVoiceModel: 'gemini-3.8-flash-tts',
};

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...(ls.get('settings') || {}) };
  // gpt-image-1 was shut down on 2026-10-23; move older saved settings to the current model.
  if (s.imageModel === 'gpt-image-1') s.imageModel = DEFAULT_SETTINGS.imageModel;
  return s;
}

export function saveSettings(settings) {
  try { ls.set('settings', settings); } catch (e) { /* settings are optional */ }
}

export function loadSetupChoices() { return ls.get('setup') || null; }
export function saveSetupChoices(choices) { try { ls.set('setup', choices); } catch (e) { /* optional */ } }
