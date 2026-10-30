// Anonymous error reports: when something breaks in the game, a short note
// goes to the game's service (server/src/errors.js) so it can be fixed without
// anyone writing in. Sent: the error message, file:line of where it happened,
// the app version and platform. Never sent: names, saves, keys or page text.
// The admin dashboard switches it on or off for everyone, and it never runs
// without CLOUD_URL.
import { CLOUD_URL, CLOUD } from './cloud-config.js';
import { feature } from './remote-config.js';
import { platform } from './platform.js';

const MAX_PER_SESSION = 10;
const seen = new Set();
let queue = [];
let timer = null;
let sent = 0;

const on = () => { try { return !!CLOUD_URL && feature('errorReports'); } catch (e) { return false; } };

// Which app this is (platform.js), kept here for the files that import it from errors.js.
export { platform };

function flush() {
  timer = null;
  const errors = queue.splice(0, 5);
  if (!errors.length || !on()) return;
  // text/plain keeps this a simple request (no CORS preflight).
  fetch(`${CLOUD_URL}/v1/errors`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ errors }), keepalive: true }).catch(() => {});
  if (queue.length) timer = setTimeout(flush, 5000);
}

export function report(err, kind = 'error') {
  if (!on() || sent >= MAX_PER_SESSION) return;
  const message = String((err && err.message) || err || '').slice(0, 500);
  if (!message) return;
  const stack = String((err && err.stack) || '').slice(0, 2000);
  const key = `${kind}|${message}|${stack.slice(0, 200)}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  queue.push({ kind, message, stack, platform: platform(), version: CLOUD.appVersion || 'dev' });
  if (!timer) timer = setTimeout(flush, 2000);
}

export function init() {
  window.addEventListener('error', (e) => {
    // Failed image or script loads have no error object and are usually the network.
    if (e.error || e.message) report(e.error || e.message, 'error');
  });
  window.addEventListener('unhandledrejection', (e) => report(e.reason, 'rejection'));
  window.addEventListener('pagehide', () => { if (queue.length) flush(); });
}
