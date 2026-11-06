// Opens the site for a Log in and fills its sign-in form (fill.js). The login
// is kept only in this browser session's memory (chrome.storage.session, never
// on disk), only for the tab it opened, and only for 3 minutes, which covers
// sign-ins split over two pages and the 2-step code page.
const MINUTES = 3;
const ADMIN = [/^https:\/\/flg-api\.btay74\.workers\.dev\/admin\//, /^http:\/\/localhost(:\d+)?\/admin\//];

const clean = (l) => ({
  url: String(l.url || ''), hosts: (Array.isArray(l.hosts) ? l.hosts : []).map(String).slice(0, 4),
  username: String(l.username || '').slice(0, 300), password: String(l.password || '').slice(0, 2000), totp: String(l.totp || '').slice(0, 600),
  expires: Date.now() + MINUTES * 60_000,
});

// The Passwords page talks to this extension by its fixed id
// (externally_connectable in manifest.json), so other extensions on the page
// never see a login.
chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  if (!sender.url || !ADMIN.some((r) => r.test(sender.url))) return;
  if (msg?.type === 'ping') { reply({ version: chrome.runtime.getManifest().version }); return; }
  if (msg?.type !== 'fill' || !msg.login) return;
  const login = clean(msg.login);
  let url;
  try { url = new URL(login.url); } catch { reply({ ok: false }); return; }
  if (!['http:', 'https:'].includes(url.protocol)) { reply({ ok: false }); return; }
  chrome.tabs.create({ url: url.href, index: sender.tab ? sender.tab.index + 1 : undefined }).then(async (tab) => {
    await chrome.storage.session.set({ [`tab-${tab.id}`]: login });
    reply({ ok: true });
    fillTab(tab.id); // in case the page finished loading already
  });
  return true; // reply comes later
});

async function fillTab(tabId) {
  const key = `tab-${tabId}`;
  const { [key]: login } = await chrome.storage.session.get(key);
  if (!login) return;
  if (Date.now() > login.expires) { chrome.storage.session.remove(key); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['fill.js'] });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: (l) => globalThis.__flgFill?.(l), args: [login] });
  } catch { /* a page the browser does not let extensions touch */ }
}
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'complete') fillTab(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab-${tabId}`));
