// Storyline builder: scene, cast, goal, and the ending revealed on solve.
import { cap, joinList } from './language.js';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// A storyline is one choice of each part kind (see storylines.js and
// topics.js). Its id starts with the story key (the theme, plus the topic for
// any topic with its own story parts) and records those choices, e.g.
// "mystery|t2|o1|i3|m0|lroom.1|e4" or "holiday/halloween|t0|o5|i2|m1|lcostume.0|e3".
const PART_WEIGHTS = { t: 1, o: 3, i: 3, m: 1, l: 1, e: 2 };

export function parseStoryId(id) {
  const [key, ...parts] = String(id).split('|');
  const [theme, topic = null] = key.split('/');
  const out = { key, theme, topic };
  for (const p of parts) out[p[0]] = p.slice(1);
  return out;
}

function makeId(key, c) {
  return `${key}|t${c.adj}|o${c.o}|i${c.i}|m${c.m}|l${c.leadCat}.${c.lead}|e${c.e}`;
}

// Pick a storyline that has never been used, preferring ones that share the
// fewest parts with recently used storylines.
export function pickStoryline(rng, scenario, leadCat, usedStories = []) {
  const S = scenario.story;
  const key = scenario.key;
  const used = new Set(usedStories);
  const recent = usedStories.slice(-300).map(parseStoryId).filter((u) => u.key === key);
  const random = () => ({
    adj: rng.int(S.adjs.length), o: rng.int(S.openings.length),
    i: rng.int(S.incidents.length), m: rng.int(S.mishaps.length), leadCat, lead: rng.int(S.leads[leadCat].length),
    e: rng.int(S.endings.length),
  });
  const overlap = (c) => {
    const parts = { t: String(c.adj), o: String(c.o), i: String(c.i), m: String(c.m), l: `${c.leadCat}.${c.lead}`, e: String(c.e) };
    let score = 0;
    recent.forEach((u, idx) => {
      // The last few stories count far more, so back-to-back stories never
      // open the same way or turn on the same event.
      const fresh = recent.length - idx <= 3;
      for (const k in parts) if (u[k] === parts[k]) score += PART_WEIGHTS[k] * (fresh && (k === 'o' || k === 'i') ? 1000 : 1);
    });
    return score;
  };
  let best = null, bestScore = Infinity;
  for (let n = 0; n < 400; n++) {
    const c = random();
    const id = makeId(key, c);
    if (used.has(id)) continue;
    const sc = overlap(c);
    if (sc < bestScore) { best = { ...c, id }; bestScore = sc; }
    if (sc === 0) break;
  }
  if (best) return best;
  // Random picks all hit used storylines: walk every combination in order.
  for (let e = 0; e < S.endings.length; e++)
    for (let lead = 0; lead < S.leads[leadCat].length; lead++)
      for (let m = 0; m < S.mishaps.length; m++)
        for (let i = 0; i < S.incidents.length; i++)
          for (let o = 0; o < S.openings.length; o++)
            for (let adj = 0; adj < S.adjs.length; adj++) {
                const c = { adj, o, i, m, leadCat, lead, e };
                const id = makeId(key, c);
                if (!used.has(id)) return { ...c, id };
              }
  throw new Error(`Every ${scenario.theme.name} / ${scenario.topic.name} storyline for this goal has been used. Choose another topic.`);
}

// model: built puzzle model (see generator); goal: { cat, item }.
export function buildStory({ rng, scenario, goal, model, L, customTitle, usedStories }) {
  const { N, cats } = model;
  const S = scenario.story;
  const cast = scenario.cast;
  const names = cats[0].labels;
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  // Capitalize the start of every sentence (a part may begin with {prize}).
  const capFirst = (t) => t.replace(/(^\W*|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());

  const pick = pickStoryline(rng, scenario, cats[goal.cat].id, usedStories);
  const incident = S.incidents[pick.i];
  const goalItem = goal.cat * N + goal.item;
  const winnerEntity = model.sol[goal.cat].indexOf(goal.item);
  const winner = names[winnerEntity];
  const fact = `${winner} ${L.pos(goalItem)}`;
  const n = NUMBER_WORDS[N] || String(N);
  const vars = {
    n, N: cap(n), many: cast.many, one: cast.one,
    x: L.label(goalItem), prize: incident.prize, winner, Fact: cap(fact), fact,
  };

  const scene = [S.openings[pick.o], incident.text, S.mishaps[pick.m]].map((t) => capFirst(fill(t, vars))).join(' ');
  const castLine = `The ${cast.many} are ${joinList(names)}.`;
  const catNames = cats.slice(1).map((c) => c.name.toLowerCase());
  const task = `Use the clues to match each ${cast.one} with their ${joinList(catNames)}.`;
  const lead = capFirst(fill(S.leads[pick.leadCat][pick.lead], vars));
  const question = `Who ${L.pos(goalItem)}?`;
  const goalLine = `Can you work out who ${L.pos(goalItem)}?`;
  const ending = capFirst(fill(S.endings[pick.e], vars));

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
