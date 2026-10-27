// Classroom packages for educators: printable puzzle sets that teachers ask
// for on the website's Educators page. One list of choices is shared by that
// page (seo/educators.js), the Worker that takes and checks requests
// (server/src/educators.js) and the builder that makes the PDFs
// (scripts/educator-package.mjs), so the form, the checks and the puzzles
// always agree.
//
// - GRADES and BANDS: what suits each grade (difficulties, sizes, how much
//   story to read, how many questions, large print).
// - checkRequest(raw): cleans a request from the form, or lists what is wrong.
// - customWorld(def): an educator's own theme (cast, names, categories, story)
//   as an engine scenario; generatePuzzle({ custom }) uses it.
// - customStory(...): the story for a custom world (the educator's own words).
// - packagePlan(request, seed): the generatePuzzle options for every puzzle.
// - gradeStory(puzzle, band): the story paragraphs at the grade's reading level.
import { TIERS, TIER_ORDER, CLUE_TYPES } from './tiers.js';
import { THEMES, plural } from './themes.js';
import { getTopics } from './topics.js';
import { cap, joinList } from './language.js';
import { hashString } from './rng.js';

export const GRADES = [
  { id: 'k', name: 'Kindergarten', band: 'k2' },
  { id: '1', name: 'Grade 1', band: 'k2' },
  { id: '2', name: 'Grade 2', band: 'k2' },
  { id: '3', name: 'Grade 3', band: 'g35' },
  { id: '4', name: 'Grade 4', band: 'g35' },
  { id: '5', name: 'Grade 5', band: 'g35' },
  { id: '6', name: 'Grade 6', band: 'g68' },
  { id: '7', name: 'Grade 7', band: 'g68' },
  { id: '8', name: 'Grade 8', band: 'g68' },
  { id: '9', name: 'Grade 9', band: 'g912' },
  { id: '10', name: 'Grade 10', band: 'g912' },
  { id: '11', name: 'Grade 11', band: 'g912' },
  { id: '12', name: 'Grade 12', band: 'g912' },
  { id: 'college', name: 'College and adult learners', band: 'adult' },
];

// reading: early (who is in it, what to find, the question), simple (adds the
// opening scene) or full (the whole story). Sizes are [categories, items].
export const BANDS = {
  k2: { name: 'Kindergarten to Grade 2', tiers: ['basic'], recommended: 'basic', size: [3, 3], sizes: [[3, 3], [3, 4]], reading: 'early', questions: 1, largePrint: true,
    about: 'Three short lists and simple "is" and "is not" clues. Read the clues aloud together; the story is only who is in it and what to find.' },
  g35: { name: 'Grades 3 to 5', tiers: ['basic', 'easy', 'medium'], recommended: 'easy', size: [3, 4], sizes: [[3, 3], [3, 4], [3, 5], [4, 4]], reading: 'simple', questions: 2, largePrint: true,
    about: 'Small grids with "not", "neither" and "either" clues, and a short opening scene.' },
  g68: { name: 'Grades 6 to 8', tiers: ['easy', 'medium', 'hard'], recommended: 'medium', size: [4, 4], sizes: [[3, 4], [4, 4], [4, 5], [5, 5]], reading: 'full', questions: 3, largePrint: false,
    about: 'Four categories, with ordering clues ("earlier than", "two years older") that need careful reading.' },
  g912: { name: 'Grades 9 to 12', tiers: ['medium', 'hard', 'expert'], recommended: 'hard', size: [4, 5], sizes: [[4, 4], [4, 5], [5, 5], [5, 6]], reading: 'full', questions: 3, largePrint: false,
    about: 'Bigger grids with exact gaps, one-of-each and if/then clues that reward systematic work.' },
  adult: { name: 'College and adult', tiers: TIER_ORDER.slice(), recommended: 'hard', size: [4, 5], sizes: [[4, 4], [4, 5], [5, 5], [5, 6]], reading: 'full', questions: 3, largePrint: false,
    about: 'Any level, up to Quantum Physicist.' },
};

// What fits on a printed page: the staircase grid of 5 categories x 6 items is
// about as wide as Letter and A4 allow.
export const PRINT_LIMITS = { categories: [3, 5], items: [3, 6] };
export const MAX_PUZZLES = 30;
export const ROLES = ['Classroom teacher', 'Special education teacher', 'Teaching assistant', 'Librarian or media specialist', 'Gifted and talented coordinator', 'Homeschool educator', 'Tutor', 'School administrator', 'Other'];
export const PAPERS = { letter: 'US Letter', a4: 'A4' };
export const ORDER_WORDS = {
  earlier: { less: 'earlier', more: 'later', least: 'earliest', most: 'latest' },
  lower: { less: 'lower', more: 'higher', least: 'lowest', most: 'highest' },
  smaller: { less: 'smaller', more: 'bigger', least: 'smallest', most: 'biggest' },
  shorter: { less: 'shorter', more: 'longer', least: 'shortest', most: 'longest' },
};

// Starting points for the custom theme form: the educator edits any of it.
export const CUSTOM_STARTERS = [
  {
    id: 'science-fair', label: 'Science fair',
    title: 'The Science Fair Mix-Up', theme: 'Science fair',
    story: 'It is science fair day, and the judges have mixed up their notes! Each student built a different project and brought a different helper.',
    cast: { one: 'student', many: 'students' }, names: ['Maya', 'Leo', 'Priya', 'Sam', 'Ava', 'Noah'],
    categories: [
      { name: 'Project', items: ['Volcano', 'Solar Oven', 'Robot Arm', 'Plant Maze', 'Rain Gauge', 'Crystal Garden'], pos: 'built the', neg: 'did not build the' },
      { name: 'Helper', items: ['Grandma', 'Big Brother', 'Neighbor', 'Coach', 'Aunt', 'Best Friend'], pos: 'was helped by their', neg: 'was not helped by their' },
      { name: 'Ribbon', items: ['1st place', '2nd place', '3rd place', '4th place', '5th place', '6th place'], order: 'lower', pos: 'won', neg: 'did not win', less: 'placed ahead of', more: 'placed behind' },
    ],
  },
  {
    id: 'book-club', label: 'Book club',
    title: 'The Book Club Shuffle', theme: 'Book club',
    story: 'The class book club met in the library, but the sign-up sheet blew away. Each reader chose a different book and a different reading spot.',
    cast: { one: 'reader', many: 'readers' }, names: ['Ella', 'Omar', 'Grace', 'Theo', 'Zoe', 'Ben'],
    categories: [
      { name: 'Book', items: ['Charlotte\'s Web', 'Hatchet', 'Wonder', 'Holes', 'Matilda', 'Frindle'], pos: 'read', neg: 'did not read' },
      { name: 'Spot', items: ['Beanbag', 'Window Seat', 'Rug', 'Big Chair', 'Corner Table', 'Stage Steps'], pos: 'sat on the', neg: 'did not sit on the' },
      { name: 'Pages read', items: ['10 pages', '20 pages', '30 pages', '40 pages', '50 pages', '60 pages'], order: 'smaller', pos: 'read', neg: 'did not read', less: 'read fewer pages than', more: 'read more pages than' },
    ],
  },
  {
    id: 'field-trip', label: 'Field trip',
    title: 'The Field Trip Lunch Mystery', theme: 'Field trip',
    story: 'On the class trip to the museum, everyone packed a different lunch and visited a different room first. Now the teacher needs to know who went where.',
    cast: { one: 'classmate', many: 'classmates' }, names: ['Ruby', 'Jack', 'Lily', 'Max', 'Nora', 'Eli'],
    categories: [
      { name: 'Lunch', items: ['Sandwich', 'Pasta Salad', 'Tacos', 'Sushi Rolls', 'Soup', 'Pizza'], pos: 'packed', neg: 'did not pack' },
      { name: 'First room', items: ['Dinosaurs', 'Space', 'Oceans', 'Ancient Egypt', 'Insects', 'Gems'], pos: 'visited the room about', neg: 'did not visit the room about' },
      { name: 'Bus seat', items: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Row 5', 'Row 6'], order: 'lower', pos: 'sat in', neg: 'did not sit in', less: 'sat nearer the front than', more: 'sat nearer the back than' },
    ],
  },
];

const FILL_NAMES = ['Alex', 'Bailey', 'Casey', 'Devon', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Parker', 'Quinn', 'Riley'];

export const gradeById = (id) => GRADES.find((g) => g.id === String(id)) || null;
export const bandOf = (gradeId) => BANDS[(gradeById(gradeId) || GRADES[GRADES.length - 1]).band];

// Every choice the form offers, for the page to draw its controls.
export function classroomOptions() {
  return {
    grades: GRADES.map((g) => ({ ...g, ...pick(BANDS[g.band], ['tiers', 'recommended', 'size', 'sizes', 'reading', 'questions', 'largePrint', 'about']), bandName: BANDS[g.band].name })),
    difficulties: TIER_ORDER.map((id) => ({ id, name: TIERS[id].name, summary: TIERS[id].summary, categories: TIERS[id].categories, items: TIERS[id].items, clueTypes: Object.keys(TIERS[id].weights) })),
    themes: THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description, topics: getTopics(t.id).map((p) => ({ id: p.id, name: p.name })) })),
    clueTypes: Object.entries(CLUE_TYPES).map(([id, name]) => ({ id, name })),
    roles: ROLES, papers: PAPERS, orderWords: ORDER_WORDS, starters: CUSTOM_STARTERS,
    printLimits: PRINT_LIMITS, maxPuzzles: MAX_PUZZLES,
  };
}
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

// ---------------------------------------------------------------- checking
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const cleanBlock = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const list = (v, maxItems, maxLen) => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : [];
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const s = clean(x, maxLen);
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    if (out.length >= maxItems) break;
  }
  return out;
};
export const EMAIL_RE = /^[^\s@<>"(),;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

// Checks an educator's own theme. Returns { value } or { errors }.
export function checkCustom(raw) {
  const errors = [];
  const c = raw && typeof raw === 'object' ? raw : {};
  const value = {
    theme: clean(c.theme, 60),
    title: clean(c.title, 80),
    story: cleanBlock(c.story, 1200),
    ending: clean(c.ending, 300),
    cast: { one: clean(c.cast?.one, 30).toLowerCase(), many: clean(c.cast?.many, 30).toLowerCase() },
    names: list(c.names, 8, 24),
    categories: [],
  };
  if (!value.theme) errors.push('Give your theme a name, for example "Science fair".');
  if (!value.cast.one) value.cast.one = 'person';
  if (!value.cast.many) value.cast.many = value.cast.one === 'person' ? 'people' : `${value.cast.one}s`;
  if (value.names.length && value.names.length < 3) errors.push('List at least 3 names, or leave the names empty and we will choose them.');
  const cats = Array.isArray(c.categories) ? c.categories.slice(0, 4) : [];
  cats.forEach((cat, i) => {
    const name = clean(cat?.name, 30);
    const items = list(cat?.items, 8, 30);
    if (!name && !items.length) return;
    const n = `Category ${i + 1}${name ? ` (${name})` : ''}`;
    if (!name) errors.push(`${n}: give it a name.`);
    if (items.length < 3) errors.push(`${n}: list at least 3 different items.`);
    if (name.toLowerCase() === value.cast.one || name.toLowerCase() === 'name') errors.push(`${n}: use another name; the first column is always the ${value.cast.many}.`);
    const pos = clean(cat?.pos, 40);
    const neg = clean(cat?.neg, 40);
    if (pos && !neg) errors.push(`${n}: you wrote how to say a match ("${pos}"); also write how to say "not a match", for example "did not ${pos.replace(/^(\w+?)(ed|s)?\b/, '$1')}".`);
    const order = ORDER_WORDS[cat?.order] ? cat.order : null;
    // An ordered list can say its own comparison ("read more pages than").
    const less = order ? clean(cat?.less, 40) : '';
    const more = order ? clean(cat?.more, 40) : '';
    if (!!less !== !!more) errors.push(`${n}: write both comparisons (for example "read fewer pages than" and "read more pages than"), or neither.`);
    value.categories.push({ name, items, pos, neg: pos ? neg : '', order, less: less && more ? less : '', more: less && more ? more : '' });
  });
  if (value.categories.length < 2) errors.push('Add at least 2 categories, each with at least 3 items (for example Project and Helper).');
  const names = new Set(value.categories.map((x) => x.name.toLowerCase()));
  if (names.size !== value.categories.length) errors.push('Give each category a different name.');
  return errors.length ? { errors } : { value };
}

const sizeOk = ([k, n]) => k >= PRINT_LIMITS.categories[0] && k <= PRINT_LIMITS.categories[1] && n >= PRINT_LIMITS.items[0] && n <= PRINT_LIMITS.items[1];

// Cleans a package request from the Educators page. Returns { value } or { errors }.
// raw.educator holds the contact details; the Worker checks the email itself.
export function checkRequest(raw, { maxPuzzles = MAX_PUZZLES } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const e = r.educator && typeof r.educator === 'object' ? r.educator : {};
  const educator = {
    name: clean(e.name, 80),
    email: clean(e.email, 254).toLowerCase(),
    school: clean(e.school, 120),
    role: ROLES.includes(e.role) ? e.role : '',
    district: clean(e.district, 120),
  };
  if (!educator.name) errors.push('Enter your name.');
  if (!EMAIL_RE.test(educator.email)) errors.push('Enter your school email address.');
  if (!educator.school) errors.push('Enter your school or organization.');
  if (!educator.role) errors.push('Choose your role.');

  const grade = gradeById(r.grade);
  if (!grade) errors.push('Choose a grade level.');
  const band = grade ? BANDS[grade.band] : BANDS.adult;
  const count = Math.floor(Number(r.count));
  const max = Math.min(MAX_PUZZLES, Math.max(1, maxPuzzles));
  if (!(count >= 1 && count <= max)) errors.push(`Choose how many puzzles: 1 to ${max}.`);

  const difficulty = r.difficulty === 'progressive' || r.difficulty === 'grade' || TIERS[r.difficulty] ? r.difficulty : 'grade';
  let size = 'grade';
  if (typeof r.size === 'string' && /^\d+x\d+$/.test(r.size)) {
    const s = r.size.split('x').map(Number);
    if (sizeOk(s)) size = r.size; else errors.push(`Choose a grid size from ${PRINT_LIMITS.categories.join(' to ')} categories and ${PRINT_LIMITS.items.join(' to ')} items, so it fits on paper.`);
  }
  const source = r.source === 'custom' ? 'custom' : 'themes';
  const themes = [];
  if (source === 'themes') {
    for (const t of Array.isArray(r.themes) ? r.themes.slice(0, THEMES.length * 3) : []) {
      const [id, topic = 'any'] = String(t).split('/');
      const th = THEMES.find((x) => x.id === id);
      if (!th) continue;
      const tp = topic === 'any' || getTopics(th.id).some((x) => x.id === topic) ? topic : 'any';
      const key = `${th.id}/${tp}`;
      if (!themes.includes(key)) themes.push(key);
    }
  }
  let custom = null;
  if (source === 'custom') {
    const c = checkCustom(r.custom);
    if (c.errors) errors.push(...c.errors); else custom = c.value;
  }
  const clueTypes = Array.isArray(r.clueTypes) ? [...new Set(r.clueTypes.filter((t) => CLUE_TYPES[t]))] : [];
  const questions = Math.floor(Number(r.questions)) || band.questions;
  const value = {
    educator,
    grade: grade ? grade.id : 'college',
    count: count >= 1 ? Math.min(count, max) : 1,
    difficulty, size, source, themes, custom,
    names: source === 'themes' ? list(r.names, 8, 24) : [],
    clueTypes: clueTypes.length ? clueTypes : [],
    questions: Math.max(1, Math.min(6, questions)),
    paper: PAPERS[r.paper] ? r.paper : 'letter',
    keys: ['separate', 'after', 'none'].includes(r.keys) ? r.keys : 'separate',
    solutions: r.solutions === true,
    largePrint: typeof r.largePrint === 'boolean' ? r.largePrint : band.largePrint,
    nameLine: r.nameLine !== false,
    title: clean(r.title, 80),
    note: cleanBlock(r.note, 500),
  };
  if (value.names.length && value.names.length < 3) errors.push('List at least 3 character names, or leave them empty.');
  if (r.agree !== true) errors.push('Please agree to use the puzzles with your own students only.');
  return errors.length ? { errors } : { value };
}

// ---------------------------------------------------------------- school email
// Personal mailbox providers: not a school address. Everything else is either
// a recognized school or education domain, or unknown (allowed, and flagged
// for the team to check before approving).
const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'zohomail.com', 'tutanota.com', 'tuta.io', 'fastmail.com', 'hey.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'charter.net', 'earthlink.net', 'qq.com', '163.com', '126.com', 'web.de', 'orange.fr', 'free.fr', 'laposte.net', 'libero.it',
  'mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'yopmail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'trashmail.com', 'dispostable.com', 'getnada.com']);
// A domain whose name says school, district or college (springfieldschools.org, austinisd.org).
const SCHOOL_WORDS = /school|k12|academy|college|universit|(^|[.-])(isd|cisd|usd|sd\d*|esd|edu|lausd|cps|nycdoe)([.-]|$)|[a-z]isd$|[a-z]usd$/i;

// Returns { kind: 'school' | 'unknown' | 'personal', domain, why }.
export function schoolEmail(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  if (!domain) return { kind: 'unknown', domain, why: 'No domain.' };
  if (PERSONAL.has(domain)) return { kind: 'personal', domain, why: 'A personal email provider, not a school.' };
  const tests = [
    [/\.edu$/, 'A .edu address.'],
    [/\.edu\.[a-z]{2}$/, 'An education domain.'],
    [/\.k12\.[a-z]{2}\.us$/, 'A US K-12 school district.'],
    [/(^|\.)k12\.[a-z.]+$/, 'A K-12 domain.'],
    [/\.(sch|school|schools)\.[a-z]{2,3}(\.[a-z]{2})?$/, 'A school domain.'],
    [/\.ac\.[a-z]{2}$/, 'An academic domain.'],
    [/\.school$/, 'A .school domain.'],
    [/\.(gov|gc)\.[a-z]{2}$|\.(gov|mil)$/, 'A government or public-service domain.'],
  ];
  for (const [re, why] of tests) if (re.test(domain)) return { kind: 'school', domain, why };
  if (SCHOOL_WORDS.test(domain.replace(/\.[a-z]+$/, ''))) return { kind: 'school', domain, why: 'The domain names a school, district or college.' };
  return { kind: 'unknown', domain, why: 'Not a known school domain: check the school before approving.' };
}

// ---------------------------------------------------------------- custom worlds
export function customWorld(def) {
  const d = def && def.categories ? def : checkCustom(def).value;
  if (!d) throw new Error('This custom theme is not complete.');
  const theme = { id: 'custom', name: d.theme };
  const topic = { id: 'custom', name: d.theme, description: d.story.slice(0, 120) };
  const categories = d.categories.map((c, i) => {
    const noun = c.name.toLowerCase();
    const id = `c${i + 1}`;
    const pos = c.pos ? `${c.pos} {x}` : `has {x} as their ${noun}`;
    const neg = c.pos ? `${c.neg} {x}` : `does not have {x} as their ${noun}`;
    if (!c.order) return { id, name: c.name, noun, pos, neg, items: c.items.slice() };
    const w = ORDER_WORDS[c.order];
    const an = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');
    const own = c.less && c.more;
    return {
      id, name: c.name, noun, pos, neg,
      // Which way the list runs, so "higher" and "ahead of" are never a guess.
      note: own ? `The ${noun} list runs in order from ${c.items[0]} to ${c.items[c.items.length - 1]}.`
        : `In the ${noun} list, ${c.items[0]} is the ${w.least} and ${c.items[c.items.length - 1]} is the ${w.most}.`,
      ordinal: {
        start: 0, step: 1, count: c.items.length, label: (v) => c.items[v],
        less: own ? c.less : `has ${an(w.less)} ${w.less} ${noun} than`, more: own ? c.more : `has ${an(w.more)} ${w.more} ${noun} than`,
        lessBy: `has a ${noun} {d} ${w.less} than`, moreBy: `has a ${noun} {d} ${w.more} than`,
        gap: (s) => plural(s, 'place', 'places'),
      },
    };
  });
  // Ordered items run in the educator's order, so a puzzle uses the first N of them.
  const names = d.names.length >= 3 ? d.names : [];
  const maxItems = Math.min(...d.categories.map((c) => c.items.length), names.length ? Math.max(names.length, 3) : 8);
  const key = `custom/${hashString(JSON.stringify([d.theme, d.story, d.categories.map((c) => [c.name, c.items])])).toString(36)}`;
  return {
    def: d, theme, topic, maxItems,
    scenario: {
      custom: d, theme, topic, key,
      cast: d.cast, names: names.length ? names : FILL_NAMES.slice(),
      categories, story: null, art: { setting: d.theme, mood: 'calm' },
    },
  };
}

// The story for a custom world: the educator's own scene, who is in it, what
// to match and the goal question. Each puzzle has its own id, so it is never
// counted as a reused storyline.
export function customStory({ scenario, goal, model, L, customTitle, seed }) {
  const d = scenario.custom;
  const { N, cats } = model;
  const names = cats[0].labels;
  const goalItem = goal.cat * N + goal.item;
  const winnerEntity = model.sol[goal.cat].indexOf(goal.item);
  const fact = `${names[winnerEntity]} ${L.pos(goalItem)}`;
  const castLine = `The ${d.cast.many} are ${joinList(names)}.`;
  const task = `Use the clues to match each ${d.cast.one} with their ${joinList(cats.slice(1).map((c) => c.name.toLowerCase()))}.`;
  const notes = cats.slice(1).filter((c) => c.note).map((c) => c.note);
  const question = `Who ${L.pos(goalItem)}?`;
  const scene = d.story ? d.story.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const paragraphs = [...scene, castLine, task, ...(notes.length ? [notes.join(' ')] : []), `Can you work out who ${L.pos(goalItem)}?`];
  const text = paragraphs.join('\n\n');
  return {
    id: `${scenario.key}|${hashString(`${seed}|${names.join(',')}|${fact}`).toString(36)}`,
    title: customTitle || d.title || `The ${d.theme} Puzzle`,
    paragraphs, text,
    goalQuestion: question,
    goalAnswer: { cat: 0, item: winnerEntity },
    ending: d.ending ? d.ending : `${cap(fact)}. Well done, puzzle solver!`,
    notes,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    parts: {},
  };
}

// ---------------------------------------------------------------- planning
const SIZE_FALLBACK = (tier, [k, n]) => {
  const t = TIERS[tier];
  const fits = k >= t.categories[0] && k <= t.categories[1] && n >= t.items[0] && n <= t.items[1];
  const s = fits ? [k, n] : t.defaultSize;
  return [Math.min(PRINT_LIMITS.categories[1], Math.max(PRINT_LIMITS.categories[0], s[0])), Math.min(PRINT_LIMITS.items[1], Math.max(PRINT_LIMITS.items[0], s[1]))];
};

// The generatePuzzle options for each puzzle in a package, easiest first when
// the difficulty builds up. usedStories keeps every package story new.
export function packagePlan(req, seed, usedStories = []) {
  const band = bandOf(req.grade);
  const tiers = req.difficulty === 'progressive' ? band.tiers
    : req.difficulty === 'grade' ? [band.recommended] : [req.difficulty];
  const fixed = req.size !== 'grade' ? req.size.split('x').map(Number) : null;
  const themeKeys = req.source === 'themes' && req.themes.length ? req.themes : THEMES.map((t) => `${t.id}/any`);
  const start = hashString(String(seed)) % themeKeys.length;
  const plan = [];
  for (let i = 0; i < req.count; i++) {
    const tier = tiers[Math.min(tiers.length - 1, Math.floor((i * tiers.length) / req.count))];
    let [k, n] = fixed || SIZE_FALLBACK(tier, band.size);
    const o = { difficulty: tier, categories: k, items: n, questions: req.questions, seed: `${seed}-${i + 1}`, usedStories, timeLimitMs: 20000 };
    if (req.clueTypes.length) o.clueTypes = req.clueTypes;
    if (req.source === 'custom') {
      const w = customWorld(req.custom);
      o.custom = req.custom;
      o.categories = Math.min(k, req.custom.categories.length + 1);
      o.items = Math.min(n, w.maxItems);
    } else {
      const [theme, topic] = themeKeys[(start + i) % themeKeys.length].split('/');
      o.theme = theme;
      o.topic = topic;
      if (req.names.length) o.customNames = req.names;
    }
    plan.push(o);
  }
  return plan;
}

// The story at the grade's reading level. Early readers get who is in it,
// what to match and the question; the next band adds the opening scene; older
// students read the whole story. A custom story is the educator's own words.
export function gradeStory(p, band) {
  const all = p.story.paragraphs;
  if (p.theme.id === 'custom' || band.reading === 'full') return all.slice();
  const names = p.categories[0].items.map((x) => x.label);
  const castLine = `The ${p.cast.many} are ${joinList(names)}.`;
  const task = `Use the clues to match each ${p.cast.one} with their ${joinList(p.categories.slice(1).map((c) => c.name.toLowerCase()))}.`;
  const notes = p.story.notes && p.story.notes.length ? [p.story.notes.join(' ')] : p.categories.filter((c) => c.note).map((c) => c.note);
  // Early readers get the plain question ("Who brought the Pug?"): the full
  // goal line names the story's event, which their version leaves out.
  return band.reading === 'early' ? [castLine, task, ...notes, p.story.goal] : [all[0], castLine, task, ...notes, all[all.length - 1]];
}
