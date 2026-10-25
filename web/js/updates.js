// Desktop app updates. The installed app checks GitHub Releases for a newer,
// signed version (Tauri updater). The player is asked first; nothing installs
// on its own. In a browser this does nothing (the web version updates through
// its service worker).
const tauri = () => window.__TAURI__ && window.__TAURI__.updater ? window.__TAURI__ : null;
let found = null;

export const available = () => !!tauri();

// Resolves to { version, notes } when a newer version exists, else null.
export async function check() {
  const t = tauri();
  if (!t) return null;
  try {
    found = await t.updater.check();
  } catch (e) {
    console.warn('Update check failed:', e);
    found = null;
  }
  return found ? { version: found.version, notes: found.body || '' } : null;
}

// onProgress gets 0..1 (or null when the size is unknown). Restarts the app when done.
export async function install(onProgress) {
  const t = tauri();
  if (!t || !found) throw new Error('No update to install');
  let total = 0, done = 0;
  await found.downloadAndInstall((ev) => {
    if (ev.event === 'Started') total = ev.data.contentLength || 0;
    else if (ev.event === 'Progress') { done += ev.data.chunkLength; onProgress(total ? Math.min(1, done / total) : null); }
  });
  await t.process.relaunch();
}
