// Errors that come from a browser add-on running in the page, not from the
// game: their stack points at the add-on's own files. They are not sent,
// because nothing in the game can fix them (for example a clipboard add-on's
// "copy-tracker-bridge.js").
const ADDON = /\b(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:\/\//;
export function fromAddOn(stack) {
  const s = String(stack || '');
  if (!s) return false;
  const frames = s.split('\n').filter((l) => /:\d+(?::\d+)?\)?\s*$/.test(l.trim()));
  if (!frames.length) return ADDON.test(s);
  return ADDON.test(frames[0]);
}
