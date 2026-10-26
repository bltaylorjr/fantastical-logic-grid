// Sound fixes for the Kokoro voices. Kokoro learned American English from
// sounds like "stˈɔɹi", but its word-to-sound step (eSpeak) writes a long
// "oː" or "ɔː" before an r and doubles the r in words like "categories", so
// "story" and "categories" came out with a heavy, drawn-out "or".
// video/build.py keeps the same list for the how-to-play video.
const FIXES = [
  // categories, category: KAT-uh-gor-eez, not KAT-ih-gur-reez
  [/kˈæɾɪɡɚɹ/g, 'kˈæɾəɡˌɔɹ'],
  // story, more, four, door, glory: a plain "or"
  [/[oɔ]ːɹ/g, 'ɔɹ'],
  // history, memory: one r, not "er-r"
  [/ɚɹ/g, 'əɹ'],
];

export function fixPhonemes(p) {
  for (const [re, to] of FIXES) p = p.replace(re, to);
  return p;
}
