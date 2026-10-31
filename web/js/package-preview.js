// The full Logic Grid package (the game cards, NINETIMESNINE and the games to
// come) is in private testing. Everyone else sees The Fantastical Logic Grid
// alone, as before. A tester opens the site once with the special link
//
//   https://thelogicgrid.com/?preview=<code>
//
// and this device then shows the whole package until ?preview=off. Only a
// hash of the code is kept here; a new code means a new hash (and every tester
// needs the new link). This hides the package from the public site's screens;
// its files are still served, so nothing secret belongs in it.
const KEY = 'flg.preview';
const CODE_HASH = '261e507545d74a98d4ff595683561fb82bdc33f298c02766fc438cff27789917';

// Whether this device has the full package switched on.
export function on() {
  try { return localStorage.getItem(KEY) === CODE_HASH; } catch (e) { return false; }
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Reads ?preview= from the address once at start: the right code switches the
// package on, "off" switches it off, anything else changes nothing. The code
// is then taken out of the address so it isn't shared by accident.
export async function fromAddress() {
  let url;
  try { url = new URL(location.href); } catch (e) { return on(); }
  if (!url.searchParams.has('preview')) return on();
  const code = url.searchParams.get('preview') || '';
  try {
    if (code === 'off') localStorage.removeItem(KEY);
    else if (crypto.subtle && (await sha256(code)) === CODE_HASH) localStorage.setItem(KEY, CODE_HASH);
  } catch (e) { /* no storage or no crypto: stays as it was */ }
  url.searchParams.delete('preview');
  try { history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`); } catch (e) { /* framed */ }
  return on();
}

export function leave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* no storage */ }
}
