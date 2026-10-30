// Site visitors (admin Visitors page, server/src/visits.js). Once a day per
// device the game sends one anonymous visit: whether the player is signed in,
// which copy of the game this is, the operating system and the kind of device.
// The Worker adds the country (and state or province) from Cloudflare's own
// lookup; nothing else about the player, device or address is sent or kept.
import { CLOUD_URL } from './cloud-config.js';
import { platform } from './platform.js';

const KEY = 'flg-visit-day';

// The operating system and kind of device, from the browser's own description.
export function describeDevice(ua = navigator.userAgent || '', touchPoints = navigator.maxTouchPoints || 0) {
  // iPads ask for desktop pages and describe themselves as a Mac; a Mac has no touch screen.
  const ipad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  let os = 'other';
  if (ipad || /iPhone|iPod/i.test(ua)) os = 'ios';
  else if (/Android/i.test(ua)) os = 'android';
  else if (/CrOS/i.test(ua)) os = 'chromeos';
  else if (/Windows/i.test(ua)) os = 'windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'mac';
  else if (/Linux/i.test(ua)) os = 'linux';
  let device = 'desktop';
  if (ipad || /Tablet/i.test(ua) || (os === 'android' && !/Mobile/i.test(ua))) device = 'tablet';
  else if (/Mobi|iPhone|iPod/i.test(ua)) device = 'mobile';
  return { os, device };
}

// Once per page load; sends nothing if this device was already counted today.
export function countVisit(signedIn) {
  try {
    if (!CLOUD_URL) return;
    const today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(KEY) === today) return; localStorage.setItem(KEY, today); } catch (e) { /* private window: counted each load */ }
    const { os, device } = describeDevice();
    const body = JSON.stringify({ g: signedIn ? 'player' : 'guest', a: platform(), o: os, d: device });
    // text/plain keeps this a simple request (no CORS preflight).
    fetch(`${CLOUD_URL}/v1/v`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
  } catch (e) { /* never break the game */ }
}
