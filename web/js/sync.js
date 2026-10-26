// Offline-first account sync. Every change is saved on this device first, as
// before; when the player is signed in, changed records are sent to the
// game's server in the background and changes from other devices come back.
//
// Each record (a saved puzzle, a meta list such as the used-story list, or
// the settings) carries the server's rev number from the last time this
// device saw it. A write the server already has a newer copy of comes back as
// a conflict, and the two copies are merged here:
//   saved puzzle  a solved copy beats an unsolved one, otherwise the copy
//                 played most recently wins. If the other copy had progress
//                 or notes of its own, it is kept as "<name> (from another device)".
//                 Progress beats a deletion. The open puzzle always wins
//                 while it is being played.
//   used stories  both lists are combined, so a story is never reused.
//   history       both lists are combined (also the solve log for stats and streaks).
//   badges        every badge from both, with the earliest time it was earned.
//   settings      the most recent change wins. Keys stay on each device.
import { CLOUD } from './cloud-config.js';
import * as store from './store.js';
import * as account from './account.js';

const STATE_KEY = 'syncState';
// Meta records that sync, and how two copies combine.
const SYNC_META = {
  usedStories: { merge: 'union', limit: 5000 }, history: { merge: 'history', limit: 50 },
  solves: { merge: 'history', limit: 2000 }, badges: { merge: 'earliest' },
};
// Settings that stay on each device: API keys and download state.
const DEVICE_ONLY = new Set(['aiKey', 'geminiKey', 'kokoroReady']);
const MAX_CHANGES = 100;
const MAX_REQUEST_CHARS = 900_000;
const MAX_RECORD_CHARS = 950_000;
const PERIODIC_MS = 5 * 60 * 1000;

let state = null; // { uid, cursor, recs: { rk: { rev, dirty, seq } }, pending: { rk: record } }
let hooks = { isBusy: () => false, onApplied: () => {}, onStatus: () => {} };
let chain = Promise.resolve();
let queued = null;
let timer = null;
let failures = 0;
let lastStatus = { state: 'off' };
let persistTimer = null;

const rk = (kind, key) => `${kind}:${key}`;
const splitRk = (k) => { const i = k.indexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; };

function setStatus(s) { lastStatus = { ...s, pending: pendingCount() }; try { hooks.onStatus(lastStatus); } catch (e) { /* ignore */ } }
export function status() { return lastStatus; }
export function pendingCount() { return state ? Object.values(state.recs).filter((r) => r.dirty).length : 0; }

function persist(now = false) {
  clearTimeout(persistTimer);
  const write = () => store.setMeta(STATE_KEY, state, { fromSync: true }).catch(() => {});
  if (now) return write();
  persistTimer = setTimeout(write, 300);
}

function mark(kind, key) {
  const k = rk(kind, key);
  const r = state.recs[k] || (state.recs[k] = { rev: 0, dirty: false, seq: 0 });
  r.dirty = true;
  r.seq++;
}

export function syncedSettings(s) {
  return Object.fromEntries(Object.entries(s).filter(([k]) => !DEVICE_ONLY.has(k)));
}

// ---------------------------------------------------------------- start up
export async function start(h) {
  hooks = { ...hooks, ...h };
  if (!account.enabled()) { setStatus({ state: 'off' }); return; }
  state = await store.getMeta(STATE_KEY, null).catch(() => null);
  if (!state || typeof state !== 'object') state = { uid: null, cursor: 0, recs: {}, pending: {} };
  state.pending ||= {};

  // Changes are tracked while the device belongs to an account, even when
  // signed out for a while, so nothing is missed when the same player returns.
  store.onChange(({ kind, key }) => {
    if (!state.uid) return;
    if (kind === 'meta' && !SYNC_META[key]) return;
    mark(kind, key);
    persist();
    if (account.current()) schedule(3000);
  });
  account.onChange((user) => { adopt(user).then(() => schedule(0)); });
  window.addEventListener('online', () => schedule(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(500);
    else if (pendingCount()) syncNow(); // best effort before the app is put away
  });
  setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, PERIODIC_MS);

  await adopt(account.current());
  if (account.current()) schedule(0);
  else setStatus({ state: 'signedout' });
}

// A new player on this device: everything already here joins their account.
async function adopt(user) {
  if (!user) { setStatus({ state: 'signedout' }); return; }
  if (state.uid === user.uid) return;
  state = { uid: user.uid, cursor: 0, recs: {}, pending: {} };
  for (const s of await store.listSaves().catch(() => [])) mark('save', s.id);
  for (const key of Object.keys(SYNC_META)) if (await store.getMeta(key, undefined) !== undefined) mark('meta', key);
  mark('settings', 'settings');
  await persist(true);
}

// Forget this device's link to the account (after sign-out or deletion).
export async function forget() {
  if (!state) return;
  state = { uid: null, cursor: 0, recs: {}, pending: {} };
  await persist(true);
  setStatus({ state: 'signedout' });
}

export function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}

// ----------------------------------------------------------------- network
async function request(body, { method = 'POST', path = '/v1/sync', token } = {}) {
  const send = async (t) => {
    try {
      return await fetch(`${CLOUD.syncUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw Object.assign(new Error('offline'), { code: 'OFFLINE' }); }
  };
  let res = await send(token || await account.getIdToken());
  if (res.status === 401 && !token) res = await send(await account.getIdToken({ force: true }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.error || `HTTP_${res.status}`, status: res.status });
  return data;
}

export async function deleteRemote(idToken) {
  await request(null, { method: 'DELETE', path: '/v1/account', token: idToken });
}

// -------------------------------------------------------------------- sync
// Runs one at a time. A call made during a run waits for one more full run,
// so whatever changed before the call is included.
export function syncNow() {
  if (queued) return queued;
  queued = chain.then(() => { queued = null; return run(); });
  chain = queued.catch(() => {});
  return queued;
}

async function run() {
  if (!state || !account.enabled()) return;
  const user = account.current();
  if (!user) { setStatus({ state: 'signedout' }); return; }
  if (state.uid !== user.uid) await adopt(user);
  if (navigator.onLine === false) { setStatus({ state: 'offline', at: lastStatus.at }); return; }
  setStatus({ state: 'syncing', at: lastStatus.at });
  const changed = { saves: false, settings: false, meta: false };
  try {
    await applyPending(changed);
    for (let round = 0; round < 6; round++) {
      const batch = await collect();
      if (!batch.length) break;
      for (const part of chunk(batch)) {
        const res = await request({ changes: part.map((b) => b.change) });
        if (state.uid !== user.uid) return; // signed out meanwhile
        for (const a of res.applied) {
          const k = rk(a.kind, a.key);
          const r = state.recs[k];
          const sent = part.find((b) => b.k === k);
          if (r) { r.rev = a.rev; if (sent && r.seq === sent.seq) r.dirty = false; }
        }
        for (const c of res.conflicts) await resolve(c, changed);
        persist();
      }
    }
    for (let page = 0; page < 200; page++) {
      const res = await request({ since: state.cursor });
      if (state.uid !== user.uid) return;
      for (const c of res.changes) await receive(c, changed);
      state.cursor = res.cursor;
      persist();
      if (!res.more) break;
    }
    failures = 0;
    await persist(true);
    setStatus({ state: 'synced', at: Date.now() });
  } catch (e) {
    failures++;
    if (e.code === 'account_deleted' || e.code === 'sign_in') {
      // The account was deleted elsewhere, or the sign-in is no longer accepted.
      const gone = e.code === 'account_deleted';
      account.signOut();
      if (gone) await forget();
      setStatus({ state: 'signedout', message: gone ? 'This account was deleted.' : 'Please sign in again.' });
      return;
    }
    if (e.code === 'OFFLINE') setStatus({ state: 'offline', at: lastStatus.at });
    else if (e.code === 'SIGNED_OUT') setStatus({ state: 'signedout', message: e.message });
    else setStatus({ state: 'error', at: lastStatus.at, message: e.status === 429 ? 'The sync service is busy. Trying again shortly.' : 'Sync did not finish. It will try again.' });
    if (e.code !== 'SIGNED_OUT') schedule(Math.min(10 * 60 * 1000, 15000 * 2 ** Math.min(failures, 6)));
  } finally {
    if (changed.saves || changed.settings || changed.meta) { try { hooks.onApplied(changed); } catch (e) { /* ignore */ } }
  }
}

function chunk(batch) {
  const parts = [];
  let cur = [];
  let size = 0;
  for (const b of batch) {
    const n = (b.change.data || '').length;
    if (cur.length && (cur.length >= MAX_CHANGES || size + n > MAX_REQUEST_CHARS)) { parts.push(cur); cur = []; size = 0; }
    cur.push(b);
    size += n;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

async function localValue(kind, key) {
  if (kind === 'save') return (await store.getSave(key)) || null;
  if (kind === 'meta') return store.getMeta(key, undefined);
  return syncedSettings(store.loadSettings());
}

// The dirty records, read fresh from this device.
async function collect() {
  const out = [];
  for (const [k, r] of Object.entries(state.recs)) {
    if (!r.dirty) continue;
    const [kind, key] = splitRk(k);
    const v = await localValue(kind, key);
    const change = { kind, key, baseRev: r.rev || 0, updatedAt: Date.now() };
    if (kind === 'save') {
      if (!v) {
        if (!r.rev) { delete state.recs[k]; continue; } // never reached the server
        change.deleted = true;
      } else {
        change.updatedAt = v.lastPlayed || Date.now();
        change.data = JSON.stringify(v);
        // Very long undo histories are trimmed for the copy in the account.
        if (change.data.length > MAX_RECORD_CHARS) change.data = JSON.stringify({ ...v, undo: (v.undo || []).slice(-200), redo: [] });
        if (change.data.length > MAX_RECORD_CHARS) { r.dirty = false; continue; }
      }
    } else if (kind === 'meta') {
      if (v === undefined) { r.dirty = false; continue; }
      change.data = JSON.stringify(v);
    } else {
      change.updatedAt = store.settingsChangedAt() || Date.now();
      change.data = JSON.stringify(v);
    }
    out.push({ k, seq: r.seq, change });
  }
  return out;
}

async function applyPending(changed) {
  for (const [k, c] of Object.entries(state.pending)) {
    if (hooks.isBusy(c.kind, c.key)) continue;
    delete state.pending[k];
    await receive(c, changed);
  }
}

// A change from another device.
async function receive(c, changed) {
  const k = rk(c.kind, c.key);
  const r = state.recs[k];
  if (r && r.rev >= c.rev) return; // already have it (our own write coming back)
  if (c.kind === 'save' && hooks.isBusy(c.kind, c.key)) { state.pending[k] = c; return; }
  if (r && r.dirty) { await resolve(c, changed); return; }
  await write(c.kind, c.key, c.deleted ? null : JSON.parse(c.data), c.updatedAt, changed);
  state.recs[k] = { rev: c.rev, dirty: false, seq: r ? r.seq : 0 };
}

async function write(kind, key, value, updatedAt, changed) {
  if (kind === 'save') {
    if (value) await store.putSave(value, { fromSync: true });
    else await store.deleteSave(key, { fromSync: true });
    changed.saves = true;
  } else if (kind === 'meta') {
    await store.setMeta(key, value, { fromSync: true });
    changed.meta = true;
  } else {
    store.saveSettings({ ...store.loadSettings(), ...syncedSettings(value || {}) }, { fromSync: true });
    store.setSettingsChangedAt(updatedAt);
    changed.settings = true;
  }
}

// Both this device and the server changed the same record: merge them.
async function resolve(server, changed) {
  const { kind, key } = server;
  const k = rk(kind, key);
  const r = state.recs[k] || (state.recs[k] = { rev: 0, dirty: false, seq: 0 });
  const local = await localValue(kind, key);
  const remote = server.deleted ? null : JSON.parse(server.data);
  let keepLocal = false;

  if (kind === 'save') {
    const busy = hooks.isBusy(kind, key);
    if (!local && !remote) keepLocal = false;
    else if (local && !remote) keepLocal = true; // progress beats a deletion
    else if (!local && remote) keepLocal = false;
    else {
      keepLocal = busy || better(local, remote);
      const [winner, loser] = keepLocal ? [local, remote] : [remote, local];
      if (ownProgress(loser, winner)) {
        const copy = { ...loser, id: newId(), name: `${loser.name} (from another device)`, lastPlayed: (loser.lastPlayed || Date.now()) - 1 };
        await store.putSave(copy); // a normal write, so it syncs as a new puzzle
        changed.saves = true;
      }
    }
    if (!keepLocal) await write(kind, key, remote, server.updatedAt, changed);
    r.rev = server.rev;
    r.dirty = keepLocal;
    return;
  }

  if (kind === 'meta') {
    const merged = mergeMeta(key, local, remote);
    const same = JSON.stringify(merged) === JSON.stringify(remote);
    if (JSON.stringify(merged) !== JSON.stringify(local)) await write(kind, key, merged, server.updatedAt, changed);
    r.rev = server.rev;
    r.dirty = !same;
    return;
  }

  // Settings: the most recent change wins.
  keepLocal = (store.settingsChangedAt() || 0) > (server.updatedAt || 0);
  if (!keepLocal && remote) await write(kind, key, remote, server.updatedAt, changed);
  r.rev = server.rev;
  r.dirty = keepLocal;
}

function better(a, b) {
  if (!!a.solved !== !!b.solved) return !!a.solved;
  return (a.lastPlayed || 0) >= (b.lastPlayed || 0);
}

// Does the losing copy hold progress or notes the winner lacks?
function ownProgress(loser, winner) {
  if (!loser || !loser.puzzle) return false;
  const notes = (loser.myNotes || '').trim();
  if (notes && !(winner.myNotes || '').includes(notes)) return true;
  if (loser.solved || winner.solved) return false;
  const lm = loser.marks || {};
  const wm = winner.marks || {};
  const keys = Object.keys(lm);
  return keys.length > 0 && keys.some((c) => lm[c] !== wm[c]);
}

function mergeMeta(key, local, remote) {
  const rule = SYNC_META[key];
  if (rule && rule.merge === 'earliest') {
    const out = { ...(remote && typeof remote === 'object' ? remote : {}) };
    for (const [k, t] of Object.entries(local && typeof local === 'object' ? local : {})) out[k] = out[k] ? Math.min(out[k], t) : t;
    return out;
  }
  const a = Array.isArray(remote) ? remote : [];
  const b = Array.isArray(local) ? local : [];
  if (!rule) return remote ?? local;
  if (rule.merge === 'union') {
    const seen = new Set(a);
    return [...a, ...b.filter((x) => !seen.has(x) && seen.add(x))].slice(-rule.limit);
  }
  const id = (h) => `${h.at}|${h.tier}|${h.ms}`;
  const map = new Map([...a, ...b].map((h) => [id(h), h]));
  return [...map.values()].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-rule.limit);
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `s${Date.now()}${Math.random().toString(36).slice(2)}`;
}
