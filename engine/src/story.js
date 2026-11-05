// Storyline builder: scene, cast, goal, and the ending revealed on solve.
import { cap, joinList } from './language.js';
import { countWords, parseStoryId, PART_KINDS, partKey, checkStoryPart } from './story-parts.js';

// The story-part helpers moved to story-parts.js; they are still exported here.
export { countWords, parseStoryId, PART_KINDS, partKey, checkStoryPart };

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// A storyline is one choice of each part kind (see storylines.js and
// topics.js). Its id starts with the story key (the theme, plus the topic for
// any topic with its own story parts) and records those choices, e.g.
// "mystery|t2|o1|i3|m0|lroom.1|e4" or "holiday/halloween|t0|o5|i2|m1|lcostume.0|e3".
const PART_WEIGHTS = { t: 1, o: 3, i: 3, m: 1, l: 1, e: 2 };

function makeId(key, c) {
  return `${key}|t${c.adj}|o${c.o}|i${c.i}|m${c.m}|l${c.leadCat}.${c.lead}|e${c.e}`;
}

// Story parts a player wrote (or approved from the AI story writer) join the
// built-in ones. A built-in part's key is its index; an added part's key is
// "x" plus a hash of its text, so story ids stay the same whatever order the
// added parts are stored in, and a story built from them is never repeated.
// Added parts are keyed by story key: the theme id for the theme's classic
// topic, or "theme/topic" for one topic only (e.g. "holiday/halloween").
// Parts added for a whole theme were written for its classic setting, so
// they join only the classic topic's stories; a topic uses parts added for it.
function scenarioParts(scenario, extra) {
  const S = scenario.story;
  const adds = extra && extra[scenario.key] ? [extra[scenario.key]] : [];
  const out = { adjs: S.adjs, leads: S.leads };
  for (const kind of Object.keys(PART_KINDS)) {
    const list = S[kind].map((value, i) => ({ key: String(i), value }));
    const seen = new Set();
    for (const add of adds) {
      for (const value of add[kind] || []) {
        if (!checkStoryPart(kind, value).ok) continue;
        const key = partKey(kind, value);
        if (!seen.has(key)) { seen.add(key); list.push({ key, value }); }
      }
    }
    out[kind] = list;
  }
  return out;
}

// Pick a storyline that has never been used, preferring ones that share the
// fewest parts with recently used storylines. prefs ({ o: { key: weight } },
// weights -1 to 1) leans toward parts the player liked and away from ones they
// did not; it never brings back a used storyline.
export function pickStoryline(rng, scenario, leadCat, usedStories = [], { extraParts, prefs } = {}) {
  const S = scenarioParts(scenario, extraParts);
  const key = scenario.key;
  const used = new Set(usedStories);
  const recent = usedStories.slice(-300).map(parseStoryId).filter((u) => u.key === key);
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
    const id = makeId(key, c);
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
                const id = makeId(key, c);
                if (!used.has(id)) return finish(S, { ...c, id });
              }
  throw new Error(`Every ${scenario.theme.name} / ${scenario.topic.name} storyline for this goal has been used. Choose another topic.`);
}

function finish(S, c) {
  const get = (kind, key) => S[kind].find((p) => p.key === key).value;
  return { ...c, parts: { opening: get('openings', c.o), incident: get('incidents', c.i), mishap: get('mishaps', c.m), ending: get('endings', c.e) } };
}

// model: built puzzle model (see generator); goal: { cat, item }.
export function buildStory({ rng, scenario, goal, model, L, customTitle, usedStories, extraParts, storyPrefs }) {
  const { N, cats } = model;
  const S = scenario.story;
  const cast = scenario.cast;
  const names = cats[0].labels;
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  // Capitalize the start of every sentence (a part may begin with {prize}).
  const capFirst = (t) => t.replace(/(^\W*|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());

  const pick = pickStoryline(rng, scenario, cats[goal.cat].id, usedStories, { extraParts, prefs: storyPrefs });
  const incident = pick.parts.incident;
  const goalItem = goal.cat * N + goal.item;
  const winnerEntity = model.sol[goal.cat].indexOf(goal.item);
  const winner = names[winnerEntity];
  const fact = `${winner} ${L.pos(goalItem)}`;
  const n = NUMBER_WORDS[N] || String(N);
  const vars = {
    n, N: cap(n), many: cast.many, one: cast.one,
    x: L.label(goalItem), prize: incident.prize, winner, Fact: cap(fact), fact,
  };

  const scene = [pick.parts.opening, incident.text, pick.parts.mishap].map((t) => capFirst(fill(t, vars))).join(' ');
  const castLine = `The ${cast.many} are ${joinList(names)}.`;
  const catNames = cats.slice(1).map((c) => c.name.toLowerCase());
  const task = `Use the clues to match each ${cast.one} with their ${joinList(catNames)}.`;
  const lead = capFirst(fill(S.leads[pick.leadCat][pick.lead], vars));
  const question = `Who ${L.pos(goalItem)}?`;
  // The goal question ties the grid fact back to the event, so a story about
  // a song request never ends on an unexplained "who ordered the Tacos?".
  const goalLine = `The ${cast.one} who ${L.pos(goalItem)} is the one behind ${incident.prize}. Can you work out who ${L.pos(goalItem)}?`;
  const ending = capFirst(fill(pick.parts.ending, vars));
  // Category notes explain what a column means and which way its numbers
  // run ("rank 1 is the lowest rank"). They are rules, not scene, so they
  // sit apart from the word count.
  // {low} and {high} are the smallest and biggest values this puzzle uses.
  const notes = cats.slice(1).filter((c) => c.note).map((c) => capFirst(fill(c.note, { ...vars, low: c.labels[0], high: c.labels.at(-1) })));

  const withNotes = (ps) => (notes.length ? [...ps.slice(0, -1), notes.join(' '), ps.at(-1)] : ps);
  let paragraphs = [scene, castLine, `${task} ${lead}`, goalLine];
  // Guideline: the story sets the scene in under 150 words.
  if (countWords(paragraphs.join(' ')) >= 150) paragraphs = [scene, `${task} ${lead}`, goalLine];
  const wordCount = countWords(paragraphs.join(' '));
  paragraphs = withNotes(paragraphs);

  return {
    id: pick.id,
    title: customTitle || `The ${S.adjs[pick.adj]} ${incident.name}`,
    paragraphs,
    text: paragraphs.join('\n\n'),
    goalQuestion: question,
    goalAnswer: { cat: 0, item: winnerEntity },
    ending,
    notes,
    wordCount,
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
