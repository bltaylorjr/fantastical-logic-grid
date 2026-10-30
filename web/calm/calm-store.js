// Calm's own saved puzzles, kept apart from the full game's saves so neither
// app has to understand the other's. IndexedDB first; if it is blocked
// (private windows, some embedded views) localStorage, then memory.
// The used-story list is shared with the full game (store.js), so a story
// played in either app never comes back in the other.
import * as main from '../js/store.js';

const DB_NAME = 'flg-calm';
const SAVES = 'saves';
const LS_PREFIX = 'flg-calm.';
const USED_STORY_LIMIT = 5000;
const memory = new Map();

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(SAVES, { keyPath: 'id' });
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; resolve(null); };
      req.onblocked = () => { dbPromise = null; resolve(null); };
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}

async function run(mode, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await openDb();
    if (!db) return { ok: false };
    try {
      return { ok: true, value: await new Promise((resolve, reject) => {
        const t = db.transaction(SAVES, mode);
        const out = fn(t.objectStore(SAVES));
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
        t.onerror = () => reject(t.error || new Error('Storage error'));
        t.onabort = () => reject(t.error || new Error('Storage was full or blocked'));
      }) };
    } catch (e) {
      // The browser can close the connection at any time; reopen once.
      if (attempt === 0 && (e.name === 'InvalidStateError' || /clos/i.test(e.message || ''))) { dbPromise = null; continue; }
      throw e;
    }
  }
  return { ok: false };
}

const ls = {
  get(k) { try { const v = localStorage.getItem(LS_PREFIX + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return memory.get(k); } },
  set(k, v) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch (e) { memory.set(k, v); } },
  del(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* ignore */ } memory.delete(k); },
  keys(prefix) {
    const out = new Set([...memory.keys()].filter((k) => k.startsWith(prefix)));
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS_PREFIX + prefix)) out.add(k.slice(LS_PREFIX.length)); } } catch (e) { /* ignore */ }
    return [...out];
  },
};

export async function listSaves() {
  const r = await run('readonly', (s) => s.getAll());
  const list = r.ok ? r.value : ls.keys('save:').map((k) => ls.get(k)).filter(Boolean);
  return list.sort((a, b) => b.lastPlayed - a.lastPlayed);
}
export async function getSave(id) {
  const r = await run('readonly', (s) => s.get(id));
  return r.ok ? r.value : ls.get(`save:${id}`);
}
export async function putSave(save) {
  const r = await run('readwrite', (s) => s.put(save));
  if (!r.ok) ls.set(`save:${save.id}`, save);
}
export async function deleteSave(id) {
  const r = await run('readwrite', (s) => s.delete(id));
  if (!r.ok) ls.del(`save:${id}`);
}

export const usedStories = () => main.getMeta('usedStories', []);
export async function rememberStory(id) {
  const used = await usedStories();
  if (!used.includes(id)) used.push(id);
  await main.setMeta('usedStories', used.slice(-USED_STORY_LIMIT));
}

// Calm's settings and last setup choices, on this device only.
export const DEFAULT_SETTINGS = { look: 'auto', text: '1', autoX: true, instant: false };
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...(ls.get('settings') || {}) }; }
export function saveSettings(s) { ls.set('settings', s); }
export function loadSetup() { return ls.get('setup') || null; }
export function saveSetup(s) { ls.set('setup', s); }
