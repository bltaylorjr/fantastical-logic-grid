// Story ids and player-written story parts: the small part of the story
// engine that the game page needs (learning sends which parts a player liked;
// the Suggest a storyline form checks a part before sending it). The story
// writer itself (story.js) stays on the puzzle server in server mode
// (docs/PUZZLE-SERVER.md).
import { hashString } from './rng.js';

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// A storyline is one choice of each part kind (see storylines.js and
// topics.js). Its id starts with the story key (the theme, plus the topic for
// any topic with its own story parts) and records those choices, e.g.
// "mystery|t2|o1|i3|m0|lroom.1|e4" or "holiday/halloween|t0|o5|i2|m1|lcostume.0|e3".

export function parseStoryId(id) {
  const [key, ...parts] = String(id).split('|');
  const [theme, topic = null] = key.split('/');
  const out = { key, theme, topic };
  for (const p of parts) out[p[0]] = p.slice(1);
  return out;
}

// Story parts a player wrote (or approved from the AI story writer) join the
// built-in ones. A built-in part's key is its index; an added part's key is
// "x" plus a hash of its text, so story ids stay the same whatever order the
// added parts are stored in, and a story built from them is never repeated.
// Added parts are keyed by story key: the theme id for the theme's classic
// topic, or "theme/topic" for one topic only (e.g. "holiday/halloween").
export const PART_KINDS = { openings: 'o', incidents: 'i', mishaps: 'm', endings: 'e' };

export function partKey(kind, part) {
  const text = kind === 'incidents' ? `${part.name}|${part.text}|${part.prize}` : String(part);
  return `x${hashString(text).toString(36)}`;
}

// Checks a story part a player or the AI story writer wrote before it can be
// used. Parts never touch the logic, so they cannot change a puzzle's single
// solution; these rules keep the story short, in the theme's voice, and free
// of facts (like a head count) that could contradict the grid.
const PART_RULES = {
  openings: { allowed: ['n', 'N', 'many', 'one'], need: [['n', 'N'], ['many']], words: [6, 30],
    tip: 'Use {n} (or {N} at the start of a sentence) for how many there are, and {many} for who they are, e.g. "{N} {many} met at the old pier."' },
  incidents: { allowed: ['n', 'N', 'many', 'one'], need: [], words: [5, 30], tip: 'Say what happened, give it a short name for the title, and name the thing at stake.' },
  mishaps: { allowed: ['n', 'N', 'many', 'one'], need: [], words: [5, 30], tip: 'Say why the facts got mixed up, so only the clues can be trusted.' },
  endings: { allowed: ['Fact', 'fact', 'winner', 'prize', 'many', 'one'], need: [['Fact', 'fact']], words: [5, 35],
    tip: 'Include {Fact} (the answer, e.g. "Mia has the red hat") and you may use {winner} and {prize}.' },
};
const NUMBERS = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|both|pair|trio|dozen)\b/i;
const BANNED = /\b(kill(ed|s)?|murder\w*|blood\w*|gun|guns|shoot\w*|sex\w*|drugs?|damn|hell|shit\w*|fuck\w*|bitch\w*|bastard)\b/i;

export function checkStoryPart(kind, part) {
  const rule = PART_RULES[kind];
  const errors = [];
  if (!rule) return { ok: false, errors: [`Unknown story part "${kind}".`] };
  const texts = kind === 'incidents'
    ? [['name', part && part.name], ['text', part && part.text], ['prize', part && part.prize]]
    : [['text', part]];
  for (const [field, value] of texts) {
    if (typeof value !== 'string' || !value.trim()) { errors.push(`The ${field === 'text' ? 'text' : field} is missing.`); continue; }
    if (/[<>]|https?:|www\./i.test(value)) errors.push('Links and code are not allowed.');
    if (BANNED.test(value)) errors.push('Please keep stories friendly for all ages.');
    const marks = [...value.matchAll(/\{(\w*)\}/g)].map((m) => m[1]);
    const bad = marks.filter((m) => !(field === 'text' ? rule.allowed : []).includes(m));
    if (bad.length) errors.push(field === 'text' ? `Unknown fill-in ${bad.map((b) => `{${b}}`).join(', ')}. ${rule.tip}` : `The ${field} cannot use fill-ins.`);
    if (/[{}]/.test(value.replace(/\{\w*\}/g, ''))) errors.push('A curly bracket is not closed.');
    if (NUMBERS.test(value.replace(/\{\w*\}/g, ''))) errors.push('Leave out numbers and head counts; the game fills them in so the story always matches the grid.');
  }
  if (!errors.length) {
    const text = kind === 'incidents' ? part.text : part;
    const marks = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const group of rule.need) if (!group.some((g) => marks.includes(g))) errors.push(rule.tip);
    const words = countWords(text);
    if (words < rule.words[0] || words > rule.words[1]) errors.push(`Use ${rule.words[0]} to ${rule.words[1]} words (this has ${words}).`);
    if (!/[.!?]["')]?$/.test(text.trim())) errors.push('End with a full stop, question mark or exclamation mark.');
    if (kind === 'incidents') {
      if (countWords(part.name) > 3) errors.push('Keep the name to 1 to 3 words; it becomes the title, e.g. "The Midnight Emerald".');
      if (countWords(part.prize) > 6) errors.push('Keep the thing at stake short, e.g. "the golden key".');
    }
  }
  return { ok: !errors.length, errors: [...new Set(errors)] };
}
