// Every character's portrait and voice agree on whether they are a woman or a
// man, in every theme, topic and portrait style. Run: node scripts/test-gender.mjs
import { THEMES } from '../engine/src/themes.js';
import { TOPICS } from '../engine/src/topics.js';
import { genderOf, KNOWN_NAMES } from '../web/js/gender.js';
import { portrait, LOOKS } from '../web/js/portraits.js';
import { portraitSvg } from '../web/js/art.js';
import * as dicebear from '../web/vendor/dicebear/dicebear.js';

let failed = 0;
const assert = (c, m) => { if (!c) { failed++; console.error(`FAIL: ${m}`); } };

// 1. Every built-in name has a listed gender, not a guess.
const casts = [];
for (const t of THEMES) casts.push({ theme: t, topic: null, names: t.names });
for (const [themeId, list] of Object.entries(TOPICS)) {
  for (const topic of list) if (topic.names) casts.push({ theme: THEMES.find((t) => t.id === themeId), topic, names: topic.names });
}
let count = 0;
for (const { theme, topic, names } of casts) {
  for (const n of names) { count++; assert(KNOWN_NAMES.has(n), `${theme.id}${topic ? '/' + topic.id : ''}: "${n}" needs a gender in web/js/gender.js`); }
  const f = names.filter((n) => genderOf(n) === 'f').length;
  assert(f >= 2 && names.length - f >= 2, `${theme.id}${topic ? '/' + topic.id : ''} has women and men (${f} of ${names.length} women)`);
}

// 2. Names a player types in always get the same answer.
for (const n of ['Zoe', 'Marcus', 'Priya', 'Tobias', 'Q', 'Lee', 'sam smith']) {
  assert(['f', 'm'].includes(genderOf(n)) && genderOf(n) === genderOf(n), `"${n}" gets a steady gender`);
}
assert(genderOf('clara') === 'f' && genderOf('Hugo Smith') === 'm', 'case and surnames do not matter');

// 3. The look lists use real DiceBear options and never overlap.
for (const [style, looks] of Object.entries(LOOKS)) {
  const props = dicebear[style].schema.properties;
  for (const g of ['f', 'm']) {
    for (const [k, val] of Object.entries(looks[g])) {
      assert(k in props, `${style}.${k} is a DiceBear option`);
      if (Array.isArray(val)) for (const x of val) assert(props[k].items.enum.includes(x), `${style}.${k} has ${x}`);
    }
  }
  const key = Object.keys(looks.f).find((k) => Array.isArray(looks.f[k]));
  assert(!looks.f[key].some((x) => looks.m[key].includes(x)), `${style} women's and men's ${key} lists do not overlap`);
}

// 4. Each drawn portrait is labelled with the same gender the voice uses, and
//    uses only that gender's looks.
for (const { theme, topic, names } of casts) {
  const puzzle = { theme, topic, cast: topic && topic.cast ? topic.cast : theme.cast };
  for (const n of names) {
    const g = genderOf(n);
    for (const style of ['notionists', 'lorelei', 'openPeeps', 'builtin']) {
      const svg = style === 'builtin' ? portraitSvg(puzzle, n) : portrait(puzzle, n, { style });
      if (!/data-gender/.test(svg)) continue; // animal portraits
      assert(svg.includes(`data-gender="${g}"`), `${theme.id}: ${n} portrait (${style}) is drawn as ${g}`);
      if (LOOKS[style]) {
        // Drawing with the other gender's looks must give a different face.
        const other = dicebear.createAvatar(dicebear[style], { seed: `${theme.id}:${n}`, ...LOOKS[style][g === 'f' ? 'm' : 'f'] }).toString();
        const same = dicebear.createAvatar(dicebear[style], { seed: `${theme.id}:${n}`, ...LOOKS[style][g] }).toString();
        assert(same !== other, `${n} (${style}) looks different as a woman and as a man`);
      }
    }
  }
}

console.log(failed ? `${failed} failed` : `ok  ${count} names across ${casts.length} casts: portraits and voices agree`);
process.exitCode = failed ? 1 : 0;
