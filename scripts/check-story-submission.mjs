#!/usr/bin/env node
// Checks a story submission (authors/submissions/*.md, made from TEMPLATE.md)
// against the same rules the engine's tests use, then builds sample stories
// and puzzles from it to prove it works in the game.
//
//   node scripts/check-story-submission.mjs authors/submissions/my-topic.md [more files]
//   node scripts/check-story-submission.mjs --emit authors/submissions/my-topic.md   (also prints the code for topics.js)
//   node scripts/check-story-submission.mjs --themes                                  (lists the theme ids)
//
// Exit code 1 when any file has a problem that must be fixed. Warnings are
// printed but do not fail. Reads only the files it is given; changes nothing.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { THEMES, getTopics, generatePuzzle, checkStoryPart } from '../engine/src/index.js';
import { TOPICS, buildScenario } from '../engine/src/topics.js';
import { buildModel, randomSolution } from '../engine/src/generator.js';
import { buildStory, countWords } from '../engine/src/story.js';
import { makeLanguage } from '../engine/src/language.js';
import { makeRng } from '../engine/src/rng.js';

const args = process.argv.slice(2);
if (args.includes('--themes')) {
  for (const t of THEMES) console.log(`${t.id.padEnd(10)} ${t.name}`);
  process.exit(0);
}
const emit = args.includes('--emit');
const files = args.filter((a) => !a.startsWith('--') && basename(a) !== 'TEMPLATE.md');
if (!files.length) {
  console.log('Usage: node scripts/check-story-submission.mjs authors/submissions/your-file.md');
  process.exit(args.length ? 0 : 1);
}

// ---------- reading the form ----------
const SECTION_KINDS = { 'title words': 'adjs', openings: 'openings', incidents: 'incidents', 'mix-ups': 'mishaps', mixups: 'mishaps', endings: 'endings' };

export function parseSubmission(text) {
  const out = { fields: {}, categories: [], parts: { adjs: [], openings: [], incidents: [], mishaps: [], endings: [] } };
  let section = '', sub = null, cat = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('>')) continue;
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    if (h2 && !h3) { section = h2[1].trim().toLowerCase(); sub = null; cat = null; continue; }
    if (h3) {
      const title = h3[1].trim();
      const c = title.match(/^Category:\s*(.*)$/i);
      if (c) { cat = { name: c[1].trim(), fields: {}, leads: [] }; out.categories.push(cat); sub = null; } else { sub = SECTION_KINDS[title.toLowerCase()] || null; cat = null; }
      continue;
    }
    const item = line.match(/^[-*]\s*(.*)$/);
    if (!item) continue;
    const body = item[1].trim();
    if (!body) continue;
    if (sub) { out.parts[sub].push(body); continue; }
    const kv = body.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase(), value = kv[2].trim();
    if (cat) {
      if (key === 'lead') { if (value) cat.leads.push(value); } else cat.fields[key] = value;
    } else out.fields[`${section}/${key}`] = value;
  }
  // Example and blank categories in the template are not part of the topic.
  out.categories = out.categories.filter((c) => c.name && !/^example\b/i.test(c.name));
  return out;
}

// ---------- turning it into a topic ----------
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clockLabel = (startMin) => (v) => {
  const m = startMin + v;
  let h = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
};
const COMPARATIVE = /\b(earlier|later|fewer|more|less|older|younger|longer|shorter|farther|further|closer|sooner|faster|slower|bigger|smaller|heavier|lighter|higher|lower|taller|deeper)\b/i;
// "walked fewer miles than" -> "walked {d} fewer than" ({d} already says "3 miles").
function byPhrase(phrase, unitMany) {
  const m = phrase.match(COMPARATIVE);
  if (!m) return null;
  const before = phrase.slice(0, m.index), after = phrase.slice(m.index + m[0].length);
  const rest = unitMany ? after.replace(new RegExp(`^\\s+${unitMany}\\b`, 'i'), '') : after;
  return `${before}{d} ${m[0]}${rest}`;
}
function parseClock(v) {
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function buildTopic(sub, problems) {
  const F = sub.fields;
  const need = (key, label) => { const v = F[key]; if (!v) problems.error(`Fill in "${label}".`); return v || ''; };
  const themeId = need('topic/theme', 'Theme').toLowerCase();
  const id = need('topic/topic id', 'Topic id');
  const kind = (F['topic/kind'] || 'fiction').toLowerCase();
  const topic = {
    id, name: need('topic/topic name', 'Topic name'), description: need('topic/description', 'Description'),
    cast: { one: need('topic/cast word, one', 'Cast word, one'), many: need('topic/cast word, many', 'Cast word, many') },
    names: list(F['topic/cast names']),
    categories: [],
    story: { adjs: sub.parts.adjs, openings: sub.parts.openings, mishaps: sub.parts.mishaps, endings: sub.parts.endings, incidents: [], leads: {} },
    art: { setting: need('picture/setting', 'Picture: Setting'), mood: need('picture/mood', 'Picture: Mood') },
  };
  for (const line of sub.parts.incidents) {
    const [name, text, prize] = line.split('|').map((s) => (s || '').trim());
    if (!name || !text || !prize) { problems.error(`Incident "${line}" needs three parts: Name | Sentence | Prize.`); continue; }
    topic.story.incidents.push({ name, text, prize });
  }
  for (const c of sub.categories) {
    const f = c.fields;
    const cid = (f.id || '').trim();
    const where = `Category "${c.name}"`;
    if (!/^[a-z][a-z0-9]*$/.test(cid)) { problems.error(`${where}: Id must be one word of lowercase letters and numbers.`); continue; }
    if (cid === 'name') { problems.error(`${where}: the Id "name" is reserved; choose another.`); continue; }
    const pos = f.sentence || '', neg = f['not sentence'] || '';
    if (!pos.includes('{x}') || !neg.includes('{x}')) problems.error(`${where}: Sentence and Not sentence must both contain {x}.`);
    const base = { id: cid, name: c.name, pos, neg, ...(f['question word'] ? { noun: f['question word'] } : {}) };
    const type = (f.type || 'plain').toLowerCase();
    let made;
    if (type === 'plain') {
      made = { ...base, items: list(f.items) };
    } else if (type === 'number') {
      const start = Number(f.start), step = Number(f.step);
      const [one, many] = list(f.unit);
      const less = f['fewer phrase'], more = f['more phrase'];
      if (!Number.isFinite(start) || !Number.isFinite(step) || step <= 0) problems.error(`${where}: Start and Step must be numbers, and Step more than 0.`);
      if (!one || !many) problems.error(`${where}: Unit needs the singular and plural, like "mile, miles".`);
      if (!less || !more) problems.error(`${where}: fill in Fewer phrase and More phrase.`);
      made = { ...base, ordinal: { start, step, count: 8, label: (v) => String(v), less, more,
        lessBy: f['fewer by phrase'] || byPhrase(less || '', many), moreBy: f['more by phrase'] || byPhrase(more || '', many),
        gap: (s) => plural(s * step, one, many) }, unit: [one, many] };
    } else if (type === 'time') {
      const startMin = parseClock(f['start time']);
      const step = Number(f['step minutes']);
      const less = f['earlier phrase'], more = f['later phrase'];
      if (startMin == null) problems.error(`${where}: Start time must look like 9:00 AM.`);
      if (!Number.isFinite(step) || step <= 0) problems.error(`${where}: Step minutes must be a number more than 0.`);
      if (!less || !more) problems.error(`${where}: fill in Earlier phrase and Later phrase.`);
      made = { ...base, ordinal: { start: 0, step, count: 8, label: clockLabel(startMin || 0), less, more,
        lessBy: f['earlier by phrase'] || byPhrase(less || ''), moreBy: f['later by phrase'] || byPhrase(more || ''),
        gap: (s) => ((s * step) % 60 === 0 ? plural((s * step) / 60, 'hour', 'hours') : plural(s * step, 'minute', 'minutes')) }, startMin };
    } else { problems.error(`${where}: Type must be plain, number or time.`); continue; }
    if (made.ordinal && (!made.ordinal.lessBy || !made.ordinal.moreBy)) problems.error(`${where}: the phrases need a comparing word such as earlier, later, fewer or more.`);
    topic.categories.push(made);
    topic.story.leads[cid] = c.leads;
  }
  if (kind === 'history') {
    const h = (k, label) => need(`fact card/${k}`, `Fact card: ${label}`);
    topic.history = { event: h('event', 'Event'), when: h('when', 'When'), where: h('where', 'Where'),
      summary: h('what really happened', 'What really happened'),
      source: { title: h('source title', 'Source title'), url: h('source link', 'Source link') } };
    const second = F['fact card/second source link'];
    for (const u of [topic.history.source.url, second].filter(Boolean)) if (!/^https:\/\//.test(u)) problems.error(`Fact card: "${u}" must be a full https:// link.`);
    if (!second) problems.warn('Fact card: add a second source that agrees, so the facts are double-checked.');
    if (!F['fact card/date checked']) problems.warn('Fact card: add the date you checked the sources.');
    const sentences = (topic.history.summary.match(/[.!?](\s|$)/g) || []).length;
    if (sentences < 2 || sentences > 4) problems.warn(`Fact card: "What really happened" should be 2 to 4 sentences (this has ${sentences}).`);
  } else if (kind !== 'fiction') problems.error('Kind must be fiction or history.');
  return { themeId, topic, kind };
}

// ---------- the rules (the same ones engine/test/run-tests.js applies) ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, word) => new RegExp(`(^|[^\\w'-])${esc(word)}(?=$|'s\\b|[^\\w'-])`, 'i').test(text);
const MIN = { adjs: 6, openings: 6, incidents: 6, mishaps: 4, endings: 4 };
const KIND_NAMES = { adjs: 'Title words', openings: 'Openings', incidents: 'Incidents', mishaps: 'Mix-ups', endings: 'Endings' };

function checkRules({ themeId, topic, kind }, sub, problems) {
  const F = sub.fields;
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) { problems.error(`Theme "${themeId}" is not one of: ${THEMES.map((t) => t.id).join(', ')}.`); return null; }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(topic.id)) problems.error('Topic id must be lowercase letters, numbers and dashes, like lighthouse-rescue.');
  if (getTopics(themeId).some((t) => t.id === topic.id)) problems.error(`The ${theme.name} theme already has a topic "${topic.id}". Choose another id.`);
  if (!/^yes$/i.test(F['about you/i wrote every story part in this file myself, in my own words (yes or no)'] || '')) problems.error('About you: answer "yes" to "I wrote every story part in this file myself". If you didn\'t, rewrite those parts first.');
  if (!F['about you/author name']) problems.error('About you: fill in Author name.');
  if (topic.names.length < 8) problems.error(`Cast names: give at least 8 (you have ${topic.names.length}).`);
  if (new Set(topic.names.map((n) => n.toLowerCase())).size !== topic.names.length) problems.error('Cast names: a name is listed twice.');
  if (topic.categories.length < 5) problems.error(`Categories: give at least 5 (you have ${topic.categories.length}).`);
  if (!topic.categories.some((c) => c.ordinal)) problems.error('Categories: at least one must be numbered (Type: number or Type: time).');
  if (new Set(topic.categories.map((c) => c.id)).size !== topic.categories.length) problems.error('Categories: two categories share an Id.');
  for (const c of topic.categories) {
    if (!c.ordinal && c.items.length !== 8) problems.error(`Category "${c.name}": needs exactly 8 items (has ${c.items.length}).`);
    const leads = topic.story.leads[c.id] || [];
    if (leads.length < 2) problems.error(`Category "${c.name}": write at least 2 leads (has ${leads.length}).`);
    for (const l of leads) if (!l.includes('{x}')) problems.error(`Category "${c.name}": the lead "${l}" must contain {x}.`);
    if (c.ordinal && /\b(higher|lower|above|below|top|bottom)\b/i.test(`${c.ordinal.less} ${c.ordinal.more}`)) problems.error(`Category "${c.name}": compare with words like earlier/later or more/fewer instead of higher/lower or above/below.`);
  }
  for (const k of Object.keys(MIN)) {
    const n = topic.story[k].length;
    if (n < MIN[k]) problems.error(`${KIND_NAMES[k]}: write at least ${MIN[k]} (you have ${n}).`);
  }
  // Items and cast names: unique, and never inside one another.
  const words = [...topic.categories.flatMap((c) => (c.ordinal ? [] : c.items.filter((x) => x.length > 1)).map((w) => [w, `${c.name} item`])), ...topic.names.map((n) => [n, 'cast name'])];
  const seen = new Map();
  for (const [w, what] of words) {
    const k = w.toLowerCase();
    if (seen.has(k)) problems.error(`"${w}" is both a ${seen.get(k)} and a ${what}. Every item and name must be different.`);
    seen.set(k, what);
  }
  for (const c of topic.categories) for (const w of (c.ordinal ? [] : c.items)) for (const n of topic.names) if (has(w, n)) problems.error(`The ${c.name} item "${w}" has the cast name "${n}" in it.`);
  // Story parts: the engine's own part rules, then "never name an item or a cast name".
  const kinds = { openings: 'openings', incidents: 'incidents', mishaps: 'mishaps', endings: 'endings' };
  for (const [k, kindId] of Object.entries(kinds)) {
    for (const part of topic.story[k]) {
      const r = checkStoryPart(kindId, part);
      const label = k === 'incidents' ? part.name : part;
      for (const e of r.errors || []) {
        if (/^Leave out numbers/.test(e)) problems.warn(`${KIND_NAMES[k]} "${label}": it has a number. Fine for real facts ("twelve seconds"), but never for how many people there are; use {n} for that.`);
        else problems.error(`${KIND_NAMES[k]} "${label}": ${e}`);
      }
    }
  }
  const casts = new Set([theme.cast, ...getTopics(themeId).map((t) => t.cast).filter(Boolean)].flatMap((c) => [c.one, c.many]));
  const otherCasts = [...casts].filter((w) => w !== topic.cast.one && w !== topic.cast.many && !has(topic.cast.many, w) && !has(topic.cast.one, w));
  const texts = [
    ...topic.story.adjs.map((t) => ['Title word', t]), ...topic.story.openings.map((t) => ['Opening', t]), ...topic.story.mishaps.map((t) => ['Mix-up', t]),
    ...topic.story.endings.map((t) => ['Ending', t]), ...topic.story.incidents.flatMap((i) => [['Incident', i.name], ['Incident', i.text], ['Incident', i.prize]]),
    ...topic.categories.flatMap((c) => (topic.story.leads[c.id] || []).map((t) => [`${c.name} lead`, t])),
  ];
  for (const [where, raw] of texts) {
    const text = raw.replace(/\{\w+\}/g, ' ');
    for (const [w, what] of words) if (has(text, w)) problems.error(`${where} "${raw}" names the ${what} "${w}". Reword it so it doesn't give away a clue.`);
    for (const w of otherCasts) if (has(text, w)) problems.error(`${where} "${raw}" uses "${w}", the cast word of another ${theme.name} topic.`);
  }
  if (kind === 'history') for (const [where, raw] of texts) {
    // Real people belong on the fact card; a capitalized two-word name in a part is worth a second look.
    const m = raw.replace(/\{\w+\}/g, ' ').match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/);
    if (m && !/^(The|A|An|At|In|On|By)\b/.test(m[0])) problems.warn(`${where} "${raw}": "${m[0]}" looks like a real name. Real people go on the fact card only.`);
  }
  return theme;
}

// ---------- does it work in the game? ----------
function trial(theme, topic, problems) {
  const list = TOPICS[theme.id] || (TOPICS[theme.id] = []);
  list.push(topic);
  try {
    const sc = buildScenario(theme, topic);
    let built = 0, longest = 0;
    const leaks = new Set();
    for (let K = 3; K <= Math.min(6, topic.categories.length + 1); K++) {
      for (let N = 3; N <= 8; N++) {
        for (const seed of ['a', 'b']) {
          const rng = makeRng(`submission|${topic.id}|${K}x${N}|${seed}`);
          const model = buildModel({ rng, scenario: sc, K, N, weights: { less: 1 } });
          model.sol = randomSolution(rng, K, N);
          const goal = { cat: model.goal.cat, item: rng.int(N) };
          const story = buildStory({ rng, scenario: sc, goal, model, L: makeLanguage(model) });
          built++;
          longest = Math.max(longest, story.wordCount);
          const goalLabel = model.cats[goal.cat].labels[goal.item];
          const all = `${story.title}\n${story.text}\n${story.ending}`;
          for (const c of sc.categories) for (const w of (c.ordinal ? [] : c.items)) if (w !== goalLabel && !has(goalLabel, w) && has(all, w)) leaks.add(w);
        }
      }
    }
    if (longest >= 150) problems.error(`Some stories run to ${longest} words; the limit is 149. Shorten the longest openings, incidents and mix-ups.`);
    for (const w of leaks) problems.error(`A built story mentions "${w}" when it isn't the answer. Check the parts for that word.`);
    const sample = generatePuzzle({ difficulty: 'easy', theme: theme.id, topic: topic.id, seed: 'author-check' });
    generatePuzzle({ difficulty: 'hard', theme: theme.id, topic: topic.id, seed: 'author-check' });
    return { built, longest, sample };
  } catch (e) {
    problems.error(`The game could not build a puzzle from this topic: ${e.message}`);
    return null;
  } finally {
    list.pop();
  }
}

// ---------- code for topics.js (--emit) ----------
function emitCode({ topic }) {
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const arr = (a) => `[${a.map(q).join(', ')}]`;
  const cats = topic.categories.map((c) => {
    const extra = c.noun ? `, { noun: ${q(c.noun)} }` : '';
    if (!c.ordinal) return `      cat(${q(c.id)}, ${q(c.name)}, ${q(c.pos)}, ${q(c.neg)}, ${arr(c.items)}${extra}),`;
    const o = c.ordinal;
    if (c.startMin != null) {
      return `      ord(${q(c.id)}, ${q(c.name)}, ${q(c.pos)}, ${q(c.neg)}, { ...timeOrd('', ${c.startMin}, ${o.step}), less: ${q(o.less)}, more: ${q(o.more)}, lessBy: ${q(o.lessBy)}, moreBy: ${q(o.moreBy)} }${extra}),`;
    }
    return `      ord(${q(c.id)}, ${q(c.name)}, ${q(c.pos)}, ${q(c.neg)}, countOrd(${o.start}, ${o.step}, null, ${q(o.less)}, ${q(o.more)}, ${q(o.lessBy)}, ${q(o.moreBy)}, (s) => plural(s * ${o.step}, ${q(c.unit[0])}, ${q(c.unit[1])}))${extra}),`;
  });
  const S = topic.story;
  return `    { id: ${q(topic.id)}, name: ${q(topic.name)}, description: ${q(topic.description)},
      cast: { one: ${q(topic.cast.one)}, many: ${q(topic.cast.many)} },
      names: ${arr(topic.names)},
      categories: [
${cats.join('\n')}
      ],
      story: {
        adjs: ${arr(S.adjs)},
        openings: [
${S.openings.map((t) => `          ${q(t)},`).join('\n')}
        ],
        incidents: [
${S.incidents.map((i) => `          { name: ${q(i.name)}, text: ${q(i.text)}, prize: ${q(i.prize)} },`).join('\n')}
        ],
        mishaps: [
${S.mishaps.map((t) => `          ${q(t)},`).join('\n')}
        ],
        endings: [
${S.endings.map((t) => `          ${q(t)},`).join('\n')}
        ],
        leads: {
${topic.categories.map((c) => `          ${c.id}: ${arr(S.leads[c.id] || [])},`).join('\n')}
        },
      },
      art: { setting: ${q(topic.art.setting)}, mood: ${q(topic.art.mood)} },${topic.history ? `
      history: ${JSON.stringify(topic.history)},` : ''}
    },`;
}

// ---------- run ----------
let failed = false;
for (const file of files) {
  const errors = [], warnings = [];
  const problems = { error: (m) => errors.push(m), warn: (m) => warnings.push(m) };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.log(`\n${file}: cannot read it (${e.code}).`); failed = true; continue; }
  const sub = parseSubmission(text);
  const built = buildTopic(sub, problems);
  const theme = errors.length ? null : checkRules(built, sub, problems);
  const result = theme && !errors.length ? trial(theme, built.topic, problems) : null;
  console.log(`\n${file}`);
  console.log(`  ${built.topic.name || '(no topic name)'} · ${theme ? theme.name : built.themeId || '(no theme)'} · ${built.kind}`);
  for (const e of errors) console.log(`  FIX   ${e}`);
  for (const w of warnings) console.log(`  CHECK ${w}`);
  if (!errors.length && result) {
    const S = built.topic.story;
    const count = S.adjs.length * S.openings.length * S.incidents.length * S.mishaps.length * S.endings.length
      * built.topic.categories.reduce((n, c) => n + (S.leads[c.id] || []).length, 0);
    console.log(`  OK    ${result.built} sample stories built (longest ${result.longest} words); about ${count.toLocaleString('en-US')} different storylines.`);
    console.log(`\n  Sample story:\n  ${result.sample.story.text.split('\n\n').join('\n  ')}\n  Ending: ${result.sample.story.ending}`);
    if (emit) console.log(`\n  Code for engine/src/topics.js (add to the ${theme.id} list):\n\n${emitCode(built)}`);
  }
  if (errors.length) failed = true;
  console.log(errors.length ? `\n  Not ready: fix the ${errors.length} item${errors.length === 1 ? '' : 's'} marked FIX.` : '\n  Ready to upload.');
}
process.exit(failed ? 1 : 0);
