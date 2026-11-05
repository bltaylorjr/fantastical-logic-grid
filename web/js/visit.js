// Site visitors (admin Visitors page, server/src/visits.js). Once a day per
// device the game, or any other page of the site (js/page-visit.js), sends one
// anonymous visit: whether the player is signed in,
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

// Whether someone is signed in on this device, read straight from where
// account.js keeps the session (on the device, or for this tab only), so the
// website's lighter pages can tell guests from players without loading it.
export function signedInHere() {
  const has = (s) => { try { const v = JSON.parse(s.getItem('flg.auth') || 'null'); return !!(v && v.uid); } catch (e) { return false; } };
  try { return has(localStorage) || has(sessionStorage); } catch (e) { return false; }
}

// The admin Website page's live preview shows the front page in a frame; that
// is the owner looking, not a visitor.
const isPreview = () => { try { return /[?&]design-preview(=|&|$)/.test(location.search); } catch (e) { return false; } };

// Once per page load; sends nothing if this device was already counted today.
// Every page of the site shares the one daily mark, so someone who opens the
// front page and then a game is still one visit.
export function countVisit(signedIn) {
  try {
    if (!CLOUD_URL || isPreview()) return;
    const today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(KEY) === today) return; localStorage.setItem(KEY, today); } catch (e) { /* private window: counted each load */ }
    const { os, device } = describeDevice();
    const body = JSON.stringify({ g: signedIn ? 'player' : 'guest', a: platform(), o: os, d: device });
    // text/plain keeps this a simple request (no CORS preflight).
    fetch(`${CLOUD_URL}/v1/v`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
  } catch (e) { /* never break the game */ }
}
