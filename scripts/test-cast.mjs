// The full cast: every built-in character has a personality, a voice that
// suits it and a face that shows it, and their lines never give anything
// away. Run: node scripts/test-cast.mjs
import { THEMES } from '../engine/src/themes.js';
import { TOPICS } from '../engine/src/topics.js';
import { KNOWN_NAMES, genderOf } from '../web/js/gender.js';
import { PERSONALITIES, CAST_NAMES, KOKORO_BUNDLED, KOKORO_STAND_IN, MOODS, profileOf, personalityOf, sayingOf, moodOf, caughtLine } from '../web/js/castbook.js';
import { GEMINI_VOICES } from '../server/src/voices.js';
import * as dicebear from '../web/vendor/dicebear/dicebear.js';

let failed = 0;
const assert = (c, m) => { if (!c) { failed++; console.error(`FAIL: ${m}`); } };

// 1. Every built-in name is in the cast book, once, and nobody extra.
for (const n of KNOWN_NAMES) assert(CAST_NAMES.has(n), `"${n}" needs a personality in web/js/castbook.js`);
for (const n of CAST_NAMES) assert(KNOWN_NAMES.has(n), `castbook.js lists "${n}", who is not in the game`);

// 2. Each cast has a mix of personalities, and its characters sound different.
const casts = THEMES.map((t) => ({ id: t.id, names: t.names }));
for (const [themeId, list] of Object.entries(TOPICS)) for (const topic of list) if (topic.names) casts.push({ id: `${themeId}/${topic.id}`, names: topic.names });
for (const { id, names } of casts) {
  const kinds = new Set(names.map(personalityOf));
  assert(kinds.size >= Math.min(names.length, 6), `${id}: only ${kinds.size} personalities among ${names.length} characters`);
  const server = names.map((n) => profileOf(n).voice.gemini);
  const dupes = server.filter((v, i) => server.indexOf(v) !== i);
  assert(!dupes.length, `${id}: server voices shared by several characters: ${dupes.join(', ')}`);
}

// 3. Voices are real and match the character's gender.
const GEMINI_F = new Set(['Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat']);
const KOKORO_ALL = new Set([...KOKORO_BUNDLED, ...Object.keys(KOKORO_STAND_IN)]);
for (const [id, p] of Object.entries(PERSONALITIES)) {
  for (const g of ['f', 'm']) {
    for (const v of p.gemini[g]) {
      assert(GEMINI_VOICES.has(v), `${id}: server voice ${v} is allowed by the server`);
      assert(GEMINI_F.has(v) === (g === 'f'), `${id}: ${v} is a ${g === 'f' ? "woman's" : "man's"} voice`);
    }
    for (const kv of p.kokoro[g]) {
      const [v, pace] = kv.split(':');
      assert(KOKORO_ALL.has(v), `${id}: Kokoro voice ${v} is bundled or has a stand-in`);
      assert(v[1] === g, `${id}: Kokoro ${v} is a ${g === 'f' ? "woman's" : "man's"} voice`);
      assert(!pace || (Number(pace) >= 0.85 && Number(pace) <= 1.15), `${id}: pace ${pace} sounds natural`);
    }
  }
  for (const s of Object.values(KOKORO_STAND_IN)) assert(KOKORO_BUNDLED.has(s), `stand-in ${s} ships with the game`);
  assert(p.device.rate >= 0.85 && p.device.rate <= 1.15 && p.device.pitch >= 0.8 && p.device.pitch <= 1.2, `${id}: device voice settings are gentle`);
}
for (const n of CAST_NAMES) {
  const pr = profileOf(n);
  assert(pr.gender === genderOf(n), `${n}: profile gender matches gender.js`);
  assert(GEMINI_F.has(pr.voice.gemini) === (pr.gender === 'f'), `${n}: server voice matches gender`);
}

// 4. Faces use real DiceBear options.
for (const [id, p] of Object.entries(PERSONALITIES)) {
  for (const [style, opts] of Object.entries(p.face)) {
    const props = dicebear[style].schema.properties;
    for (const [k, vals] of Object.entries(opts)) {
      assert(k in props, `${id}: ${style}.${k} is a DiceBear option`);
      for (const x of vals) assert(props[k].items.enum.includes(x), `${id}: ${style}.${k} has ${x}`);
    }
  }
}

// 5. Lines add color only: no grid item, no character name, nothing about answers.
const labels = new Set();
const walk = (o) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o.items)) for (const x of o.items) if (typeof x === 'string') labels.add(x);
  if (o.ordinal && typeof o.ordinal.label === 'function') for (let i = 0; i < o.ordinal.count; i++) labels.add(String(o.ordinal.label(o.ordinal.start + i * o.ordinal.step)));
  for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
};
walk(THEMES); walk(TOPICS);
const words = [...labels].filter((l) => /[a-z]{3}/i.test(l));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let lines = 0;
for (const [id, p] of Object.entries(PERSONALITIES)) {
  for (const kind of ['clue', 'nothing', 'hint', 'solve']) {
    assert(p[kind].length >= 2, `${id}: at least two ${kind} lines`);
    for (const line of p[kind]) {
      lines++;
      for (const w of words) assert(!new RegExp(`\\b${esc(w)}\\b`, 'i').test(line), `${id} ${kind} line names the grid item "${w}": ${line}`);
      for (const n of KNOWN_NAMES) assert(!new RegExp(`\\b${n}\\b`).test(line), `${id} ${kind} line names ${n}: ${line}`);
      assert(!/\d/.test(line) && !/\b(last|before|after|earlier|later|older|younger|higher|lower|cheaper|bigger|smaller|next to|left of|right of)\b/i.test(line), `${id} ${kind} line sounds like a clue: ${line}`);
      assert(line.length <= 80, `${id} ${kind} line is short: ${line}`);
    }
  }
}
// The culprit's owning-up lines follow the same rules.
for (let n = 0; n < 8; n++) {
  const line = caughtLine('Clara', n);
  lines++;
  for (const w of words) assert(!new RegExp(`\\b${esc(w)}\\b`, 'i').test(line), `caught line names the grid item "${w}": ${line}`);
  for (const k of KNOWN_NAMES) assert(!new RegExp(`\\b${k}\\b`).test(line), `caught line names ${k}: ${line}`);
}
// 6. Every personality acts in a mood the talking faces know.
for (const id of Object.keys(PERSONALITIES)) {
  const name = [...CAST_NAMES].find((n) => personalityOf(n) === id);
  if (name) assert(MOODS.includes(moodOf(name)) && moodOf(name) !== 'calm', `${id} has its own mood (${moodOf(name)})`);
}
assert(sayingOf('Clara', 'clue', 3) === sayingOf('clara', 'clue', 3), 'lines are steady for a name');
assert(personalityOf('Zoe Q') === personalityOf('Zoe Q'), 'typed names get a steady personality');

console.log(failed ? `${failed} cast check(s) failed.` : `Cast checks passed (${CAST_NAMES.size} characters, ${Object.keys(PERSONALITIES).length} personalities, ${lines} lines, ${words.length} grid items checked).`);
process.exit(failed ? 1 : 0);
