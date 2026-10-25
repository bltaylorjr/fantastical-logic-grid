// Storyline builder: scene, cast, goal, and the ending revealed on solve.
import { cap, joinList } from './language.js';
import { STORYLINES } from './storylines.js';
import { hashString } from './rng.js';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// A storyline is one choice of each part kind (see storylines.js). Its id
// records those choices, e.g. "mystery|t2|o1|i3|m0|lroom.1|e4".
const PART_WEIGHTS = { t: 1, o: 3, i: 3, m: 1, l: 1, e: 2 };

export function parseStoryId(id) {
  const [theme, ...parts] = String(id).split('|');
  const out = { theme };
  for (const p of parts) out[p[0]] = p.slice(1);
  return out;
}

function makeId(theme, c) {
  return `${theme}|t${c.adj}|o${c.o}|i${c.i}|m${c.m}|l${c.leadCat}.${c.lead}|e${c.e}`;
}

// Story parts a player wrote (or approved from the AI story writer) join the
// built-in ones. A built-in part's key is its index; an added part's key is
// "x" plus a hash of its text, so story ids stay the same whatever order the
// added parts are stored in, and a story built from them is never repeated.
export const PART_KINDS = { openings: 'o', incidents: 'i', mishaps: 'm', endings: 'e' };

export function partKey(kind, part) {
  const text = kind === 'incidents' ? `${part.name}|${part.text}|${part.prize}` : String(part);
  return `x${hashString(text).toString(36)}`;
}

function themeParts(themeId, extra) {
  const S = STORYLINES[themeId];
  const add = (extra && extra[themeId]) || {};
  const out = { adjs: S.adjs, leads: S.leads };
  for (const kind of Object.keys(PART_KINDS)) {
    const list = S[kind].map((value, i) => ({ key: String(i), value }));
    const seen = new Set();
    for (const value of add[kind] || []) {
      if (!checkStoryPart(kind, value).ok) continue;
      const key = partKey(kind, value);
      if (!seen.has(key)) { seen.add(key); list.push({ key, value }); }
    }
    out[kind] = list;
  }
  return out;
}

// Pick a storyline that has never been used, preferring ones that share the
// fewest parts with recently used storylines. prefs ({ o: { key: weight } },
// weights -1 to 1) leans toward parts the player liked and away from ones they
// did not; it never brings back a used storyline.
export function pickStoryline(rng, themeId, leadCat, usedStories = [], { extraParts, prefs } = {}) {
  const S = themeParts(themeId, extraParts);
  const used = new Set(usedStories);
  const recent = usedStories.slice(-300).map(parseStoryId).filter((u) => u.theme === themeId);
  const random = () => ({
    adj: rng.int(S.adjs.length), o: rng.pick(S.openings).key,
    i: rng.pick(S.incidents).key, m: rng.pick(S.mishaps).key, leadCat, lead: rng.int(S.leads[leadCat].length),
    e: rng.pick(S.endings).key,
  });
  const liking = prefs && Object.keys(prefs).length ? prefs : null;
  const overlap = (c) => {
    const parts = { t: String(c.adj), o: String(c.o), i: String(c.i), m: String(c.m), l: `${c.leadCat}.${c.lead}`, e: String(c.e) };
    let score = 0;
    recent.forEach((u, idx) => {
      // The last few stories count far more, so back-to-back stories never
      // open the same way or turn on the same event.
      const fresh = recent.length - idx <= 3;
      for (const k in parts) if (u[k] === parts[k]) score += PART_WEIGHTS[k] * (fresh && (k === 'o' || k === 'i') ? 1000 : 1);
    });
    if (liking) for (const k in parts) score -= 4 * PART_WEIGHTS[k] * Math.max(-1, Math.min(1, (liking[k] && liking[k][parts[k]]) || 0));
    return score;
  };
  let best = null, bestScore = Infinity;
  for (let n = 0; n < 400; n++) {
    const c = random();
    const id = makeId(themeId, c);
    if (used.has(id)) continue;
    const sc = overlap(c);
    if (sc < bestScore) { best = { ...c, id }; bestScore = sc; }
    if (sc === 0 && !liking) break;
  }
  if (best) return finish(S, best);
  // Random picks all hit used storylines: walk every combination in order.
  for (const e of S.endings)
    for (let lead = 0; lead < S.leads[leadCat].length; lead++)
      for (const m of S.mishaps)
        for (const i of S.incidents)
          for (const o of S.openings)
            for (let adj = 0; adj < S.adjs.length; adj++) {
                const c = { adj, o: o.key, i: i.key, m: m.key, leadCat, lead, e: e.key };
                const id = makeId(themeId, c);
                if (!used.has(id)) return finish(S, { ...c, id });
              }
  throw new Error(`Every ${themeId} storyline for this goal has been used. Choose another theme.`);
}

function finish(S, c) {
  const get = (kind, key) => S[kind].find((p) => p.key === key).value;
  return { ...c, parts: { opening: get('openings', c.o), incident: get('incidents', c.i), mishap: get('mishaps', c.m), ending: get('endings', c.e) } };
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

// model: built puzzle model (see generator); goal: { cat, item }.
export function buildStory({ rng, theme, goal, model, L, customTitle, usedStories, extraParts, storyPrefs }) {
  const { N, cats } = model;
  const S = STORYLINES[theme.id];
  const names = cats[0].labels;
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  // Capitalize the start of every sentence (a part may begin with {prize}).
  const capFirst = (t) => t.replace(/(^\W*|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());

  const pick = pickStoryline(rng, theme.id, cats[goal.cat].id, usedStories, { extraParts, prefs: storyPrefs });
  const incident = pick.parts.incident;
  const goalItem = goal.cat * N + goal.item;
  const winnerEntity = model.sol[goal.cat].indexOf(goal.item);
  const winner = names[winnerEntity];
  const fact = `${winner} ${L.pos(goalItem)}`;
  const n = NUMBER_WORDS[N] || String(N);
  const vars = {
    n, N: cap(n), many: theme.cast.many, one: theme.cast.one,
    x: L.label(goalItem), prize: incident.prize, winner, Fact: cap(fact), fact,
  };

  const scene = [pick.parts.opening, incident.text, pick.parts.mishap].map((t) => capFirst(fill(t, vars))).join(' ');
  const castLine = `The ${theme.cast.many} are ${joinList(names)}.`;
  const catNames = cats.slice(1).map((c) => c.name.toLowerCase());
  const task = `Use the clues to match each ${theme.cast.one} with their ${joinList(catNames)}.`;
  const lead = capFirst(fill(S.leads[pick.leadCat][pick.lead], vars));
  const question = `Who ${L.pos(goalItem)}?`;
  const goalLine = `Can you work out who ${L.pos(goalItem)}?`;
  const ending = capFirst(fill(pick.parts.ending, vars));

  let paragraphs = [scene, castLine, `${task} ${lead}`, goalLine];
  // Guideline: the story sets the scene in under 150 words.
  if (countWords(paragraphs.join(' ')) >= 150) paragraphs = [scene, `${task} ${lead}`, goalLine];

  return {
    id: pick.id,
    title: customTitle || `The ${S.adjs[pick.adj]} ${incident.name}`,
    paragraphs,
    text: paragraphs.join('\n\n'),
    goalQuestion: question,
    goalAnswer: { cat: 0, item: winnerEntity },
    ending,
    wordCount: countWords(paragraphs.join(' ')),
    parts: { t: String(pick.adj), o: pick.o, i: pick.i, m: pick.m, l: `${pick.leadCat}.${pick.lead}`, e: pick.e },
  };
}

// Answer questions: the story's goal question first, then a mix of
// "Who ...?" and "What is X's ...?" questions with one correct answer each.
export function buildQuestions({ rng, model, L, story, goal, count }) {
  const { N, K, cats, sol } = model;
  const qs = [{
    text: story.goalQuestion,
    askCat: 0,
    answer: { cat: 0, item: story.goalAnswer.item },
    about: { cat: goal.cat, item: goal.item },
  }];
  const used = new Set([`${goal.cat}:${goal.item}`]);
  for (let tries = 0; qs.length < count && tries < 100; tries++) {
    const c = 1 + rng.int(K - 1);
    const i = rng.int(N);
    const e = sol[c].indexOf(i);
    if (rng.next() < 0.5) {
      if (used.has(`${c}:${i}`)) continue;
      used.add(`${c}:${i}`);
      qs.push({ text: `Who ${L.pos(c * N + i)}?`, askCat: 0, answer: { cat: 0, item: e }, about: { cat: c, item: i } });
    } else {
      if (used.has(`0:${e}:${c}`)) continue;
      used.add(`0:${e}:${c}`);
      qs.push({ text: `What is ${cats[0].labels[e]}'s ${cats[c].noun || cats[c].name.toLowerCase()}?`, askCat: c, answer: { cat: c, item: i }, about: { cat: 0, item: e } });
    }
  }
  return qs;
}
