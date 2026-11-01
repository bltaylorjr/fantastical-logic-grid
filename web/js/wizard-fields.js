// The Puzzle Wizard's questions and checks, one set for each game. Shared by
// the wizard pages (web/wizard/, web/js/wizard-page.js), the Worker that saves
// an entry (server/src/story-submissions.js) and the wizard's how-to videos
// (video/wizard.cjs), so the form, the checks, the help and the narration
// always agree. No imports, so all of them can load it.
//
// Each field has:
//   label    what it is
//   help     what to write
//   use      how it fits into the puzzle the wizard builds (shown under the
//            field and read in the how-to video)
//   example  an example answer
//   req      true when the puzzle cannot be built without it
//
// checkEntry(entry) returns { value, errors, warnings, ready }:
//   errors    { key: 'what to fix' }   the puzzle cannot be built yet
//   warnings  { key: 'a suggestion' }  it can be built, but could be better
//   ready     true when there are no errors (the one-answer check for a
//             NINETIMESNINE grid also needs the engine: see wizard-build.js)

export const GAMES = {
  fantastical: {
    id: 'fantastical', name: 'The Fantastical Logic Grid', short: 'logic grid',
    blurb: 'A story logic puzzle: players read your clues and mark a grid to work out who did what.',
  },
  ninetimesnine: {
    id: 'ninetimesnine', name: 'NINETIMESNINE', short: 'number grid',
    blurb: 'A number puzzle: players fill the grid so every row, column and box holds each number once.',
  },
};
export const GAME_IDS = Object.keys(GAMES);

export const LIMITS = {
  title: 40, story: 1200, ending: 300, cast: 24, name: 24, catName: 30, item: 30, phrase: 40,
  opening: 400, stakes: 160, realName: 60, fileName: 80,
};
export const MIN_NAMES = 3;
export const MAX_NAMES = 8;
export const MIN_CATEGORIES = 2;
export const MAX_CATEGORIES = 4;

// The logic grid's difficulty levels (engine/src/tiers.js), in order.
export const FLG_LEVELS = [['basic', 'Basic'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert'], ['mensa', 'Quantum Physicist'], ['theorist', 'Theoretical Physicist']];
// NINETIMESNINE's levels (engine/src/number-place.js), in order.
export const NTN_LEVELS = [['basic', 'Basic'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert'], ['master', 'Master']];
export const NTN_SIZES = [4, 6, 9];
// NINETIMESNINE story worlds (engine/src/number-place-story.js NP_STORY_THEMES ids), for the look.
export const NTN_WORLDS = [['vault', 'The Vault'], ['garden', 'The Garden'], ['', 'No preference']];
export const TONES = ['Lighthearted', 'Cozy', 'Whimsical', 'Funny', 'Heartwarming', 'Adventurous', 'Mysterious', 'Suspenseful', 'Spooky (not scary)', 'Dramatic'];
// Ordered lists (engine/src/classroom.js ORDER_WORDS): items listed first to last.
export const ORDERS = [['', 'Not in order'], ['earlier', 'Earliest to latest (times, dates)'], ['lower', 'Lowest to highest (numbers, prices, ages)'],
  ['smaller', 'Smallest to biggest'], ['shorter', 'Shortest to longest']];

// Pictures and sounds the author may add.
export const FILES = {
  image: { max: 3, label: 'Pictures', accept: 'image/*', bytes: 900_000, purposes: [['cover', 'Cover picture'], ['scene', 'Story scene'], ['character', 'Character picture'], ['other', 'Something else']] },
  sound: { max: 2, label: 'Sounds', accept: 'audio/*,.mp3,.m4a,.ogg,.oga,.wav,.webm,.aac', bytes: 700_000, purposes: [['solved', 'Plays when the puzzle is solved'], ['music', 'Background music'], ['effect', 'Sound effect for a story moment'], ['other', 'Something else']] },
};
export const CREDIT_AS = [['screen', 'My screen name'], ['real', 'My real name'], ['none', 'No credit (stay anonymous)']];
export const CONSENT_TEXT = 'I made this myself (the story, pictures and sounds I added) and give The Logic Grid permission to use, edit and publish it in its games and puzzles, with the credit I chose.';

// ---------------------------------------------------------------- the steps
// Each step: { id, title, intro, fields: [key...] }. The fields below are
// described once in FIELDS and drawn by wizard-form.js.
export const STEPS = {
  fantastical: [
    { id: 'story', title: 'Your story', intro: 'Start with the world of your puzzle: its name, the scene and how it ends.', fields: ['title', 'look', 'story', 'ending', 'tone', 'difficulty'] },
    { id: 'cast', title: 'Who is in it', intro: 'The people (or animals, robots…) your players match up. They make the first column of the grid.', fields: ['cast', 'names'] },
    { id: 'lists', title: 'What they are matched with', intro: 'Two to four lists of things to match. Each list becomes a column of the grid.', fields: ['categories'] },
    { id: 'answer', title: 'The answer', intro: 'Decide who has what. The wizard writes clues that lead to exactly this answer, and only this one.', fields: ['answerMode', 'answer'] },
    { id: 'files', title: 'Pictures and sounds', intro: 'Optional: add your own pictures and sounds for your puzzle.', fields: ['files'] },
    { id: 'credit', title: 'Credit and permission', intro: 'How you would like to be credited, and your permission to use your puzzle.', fields: ['credit', 'consent'] },
  ],
  ninetimesnine: [
    { id: 'story', title: 'Your story', intro: 'Every NINETIMESNINE puzzle tells a short case: why the grid needs filling, and how it ends.', fields: ['title', 'world', 'opening', 'stakes', 'ending'] },
    { id: 'grid', title: 'The grid', intro: 'Choose the size and rules of your grid, and who places the starting numbers.', fields: ['size', 'diagonal', 'givensMode', 'level'] },
    { id: 'givens', title: 'Starting numbers', intro: 'Type the numbers players start with. Leave the other cells empty.', fields: ['givens'] },
    { id: 'files', title: 'Pictures and sounds', intro: 'Optional: add your own pictures and sounds for your puzzle.', fields: ['files'] },
    { id: 'credit', title: 'Credit and permission', intro: 'How you would like to be credited, and your permission to use your puzzle.', fields: ['credit', 'consent'] },
  ],
};

export const FIELDS = {
  fantastical: {
    title: { label: 'Title', req: true, max: LIMITS.title, help: 'The name of your puzzle.', use: 'Printed at the top of the puzzle and the PDF, and shown in Saved puzzles and in your credit.', example: 'The Midnight Gala' },
    look: { label: 'Look', type: 'theme', help: 'The game theme whose colors, pictures and music suit your story best.', use: 'Picks the colors, scene pictures and music when your puzzle is played in the game.', example: 'Mystery' },
    story: { label: 'Opening scene', req: true, type: 'textarea', max: LIMITS.story, help: 'Set the scene in two to four sentences: where we are, and what went wrong or what needs working out.', use: 'Becomes the first paragraphs of the puzzle. The wizard adds who is in it, what to match and the question at the end.', example: 'The lights went out at the Midnight Gala, and when they came back on, the tiara was gone. Every guest was somewhere different, with a different drink in hand.' },
    ending: { label: 'Ending', type: 'textarea', max: LIMITS.ending, help: 'What happens once the puzzle is solved. Leave it empty and the wizard writes one from the answer.', use: 'Shown when the puzzle is solved, and printed on the answer key.', example: 'The tiara turns up in the greenhouse, and the gala dances on until dawn.' },
    tone: { label: 'Tone', type: 'select', options: TONES.map((t) => [t, t]), blank: 'Choose a tone', help: 'The feel of your story.', use: 'Helps the team place your puzzle and choose its music. It does not change the clues.', example: 'Mysterious' },
    difficulty: { label: 'Difficulty', req: true, type: 'select', options: FLG_LEVELS, blank: 'Choose a level', help: 'How hard the puzzle should be. Bigger grids are harder at every level.', use: 'Sets which kinds of clues the wizard may use and how much reasoning each step needs.', example: 'Medium' },
    cast: { label: 'Who they are', req: true, type: 'cast', max: LIMITS.cast, help: 'One word for the people in your story, and the word for more than one.', use: 'The heading of the grid\'s first column, and the word the clues and questions use ("Which guest…?").', example: 'guest, guests' },
    names: { label: 'Names', req: true, type: 'list', min: MIN_NAMES, max: MAX_NAMES, itemMax: LIMITS.name, help: `${MIN_NAMES} to ${MAX_NAMES} different names. Every list you add needs one item for each name.`, use: 'The first column of the grid. The number of names sets the size of the grid: 4 names make a 4 by 4 grid for each list.', example: 'Lady Ashford, the Butler, Colonel Pike, Miss Lane' },
    categories: { label: 'Lists to match', req: true, type: 'categories', min: MIN_CATEGORIES, max: MAX_CATEGORIES, help: 'Give each list a name and its items, separated by commas. Use exactly one item for each name.', use: 'Each list becomes a column of the grid, and the wizard writes clues about it. Ordered lists (times, prices, ages) also get clues like "arrived earlier than".', example: 'Room: Library, Kitchen, Garden, Attic' },
    answerMode: { label: 'Who decides the answer?', type: 'radio', options: [['mine', 'I will choose who has what'], ['auto', 'Let the wizard choose for me']], help: 'Choose the answer yourself, or let the wizard pick one.', use: 'The clues are written to lead to this answer and no other, so every player reaches the same solution.', example: 'I will choose who has what' },
    answer: { label: 'Answer key', type: 'answer', help: 'For each name, pick their item in every list. Each item can go to one name only.', use: 'Printed on the answer key page. The wizard checks it, then writes clues that prove it step by step.', example: 'Lady Ashford: Garden, 7:30 PM, Tea' },
    files: { label: 'Pictures and sounds', type: 'files', help: 'Up to 3 pictures and 2 sounds that you made yourself. For each one, say what it is for, whether we may use it, and how to credit you.', use: 'The team can use them with your puzzle in the game: a cover or scene picture, a sound when it is solved, or background music.', example: 'A drawing of the gala ballroom' },
    credit: { label: 'Author credit', type: 'credit', help: 'The name shown in the author credits of your puzzle.', use: 'Printed on your puzzle and shown in the game\'s credits if it is published.', example: 'My screen name' },
    consent: { label: 'Permission', req: true, type: 'consent', help: CONSENT_TEXT, use: 'We can only save and publish your puzzle with your permission.', example: 'Ticked' },
  },
  ninetimesnine: {
    title: { label: 'Title', req: true, max: LIMITS.title, help: 'The name of your puzzle.', use: 'Printed at the top of the puzzle and the PDF, and shown in Saved puzzles and in your credit.', example: 'The Clockmaker\'s Grid' },
    world: { label: 'Look', type: 'select', options: NTN_WORLDS, help: 'The look that suits your story best.', use: 'Picks the pictures and colors when your puzzle is played in the game.', example: 'The Vault' },
    opening: { label: 'Opening', req: true, type: 'textarea', max: LIMITS.opening, help: 'One or two sentences: who needs the grid filled, and why.', use: 'Shown above the grid and printed on the puzzle page, before the rules.', example: 'The clockmaker\'s workshop has a puzzle lock on every drawer, and the key to the shop is inside one of them.' },
    stakes: { label: 'What is at stake', max: LIMITS.stakes, help: 'One short sentence that makes it matter.', use: 'Added after the opening, so players know why they are solving.', example: 'The shop opens in an hour.' },
    ending: { label: 'Ending', req: true, type: 'textarea', max: LIMITS.ending, help: 'What happens when the grid is full.', use: 'Shown when the puzzle is solved, and printed on the answer key.', example: 'The last drawer clicks open, and there is the key, wrapped in a note: "Well reasoned."' },
    size: { label: 'Grid size', req: true, type: 'radio', options: NTN_SIZES.map((n) => [String(n), `${n} × ${n}`]), help: '4 × 4 and 6 × 6 are quick; 9 × 9 is the classic size.', use: 'Every row, column and box holds the numbers 1 to the size, each exactly once.', example: '9 × 9' },
    diagonal: { label: 'Diagonals too', type: 'check', help: 'Both long diagonals must also hold every number once.', use: 'Adds an extra rule, which also means fewer starting numbers are needed.', example: 'Off' },
    givensMode: { label: 'Who places the starting numbers?', type: 'radio', options: [['mine', 'I will type them'], ['auto', 'Let the wizard make them']], help: 'Design the grid yourself, or let the wizard make one at the level you choose.', use: 'Your numbers are checked: the puzzle must have exactly one answer, reachable by reasoning alone.', example: 'I will type them' },
    level: { label: 'Difficulty', type: 'select', options: NTN_LEVELS, blank: 'Choose a level', help: 'For a grid the wizard makes. For your own grid, the wizard works out the level from your numbers.', use: 'Sets which solving techniques the puzzle may need.', example: 'Medium' },
    givens: { label: 'Starting numbers', type: 'givens', help: 'Type a number in each cell that should start filled. Leave the rest empty.', use: 'These are the numbers printed in the grid. The wizard checks there is exactly one way to fill the rest.', example: 'A 5 in row 1, column 1' },
    files: { label: 'Pictures and sounds', type: 'files', help: 'Up to 3 pictures and 2 sounds that you made yourself. For each one, say what it is for, whether we may use it, and how to credit you.', use: 'The team can use them with your puzzle in the game: a cover picture, a sound when it is solved, or background music.', example: 'A photo of an old clock' },
    credit: { label: 'Author credit', type: 'credit', help: 'The name shown in the author credits of your puzzle.', use: 'Printed on your puzzle and shown in the game\'s credits if it is published.', example: 'My screen name' },
    consent: { label: 'Permission', req: true, type: 'consent', help: CONSENT_TEXT, use: 'We can only save and publish your puzzle with your permission.', example: 'Ticked' },
  },
};

// An empty entry for a game, with sensible starting choices.
export function blankEntry(game) {
  if (game === 'ninetimesnine') {
    return { game, title: '', world: '', opening: '', stakes: '', ending: '', size: '9', diagonal: false, givensMode: 'mine', level: 'medium', givens: Array(81).fill(0), files: [], credit: { as: 'screen', real: '' }, consent: false };
  }
  return {
    game: 'fantastical', title: '', look: '', story: '', ending: '', tone: '', difficulty: 'medium', cast: { one: '', many: '' }, names: ['', '', '', ''],
    categories: [{ name: '', items: ['', '', '', ''], order: '', pos: '', neg: '' }, { name: '', items: ['', '', '', ''], order: '', pos: '', neg: '' }],
    answerMode: 'mine', answer: {}, files: [], credit: { as: 'screen', real: '' }, consent: false,
  };
}

// ---------------------------------------------------------------- cleaning
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const one = (v, max) => clean(v, max).replace(/\s*\n\s*/g, ' ');
const low = (s) => String(s).toLowerCase();
const plural = (w) => (!w ? '' : /[^aeiou]y$/i.test(w) ? w.replace(/y$/i, 'ies') : /(s|x|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`);
export const splitItems = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/));

function cleanFiles(list) {
  const out = [];
  const count = { image: 0, sound: 0 };
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || !FILES[f.kind] || count[f.kind] >= FILES[f.kind].max) continue;
    count[f.kind]++;
    out.push({
      kind: f.kind, name: one(f.name, LIMITS.fileName) || (f.kind === 'image' ? 'picture' : 'sound'),
      purpose: FILES[f.kind].purposes.some(([id]) => id === f.purpose) ? f.purpose : 'other',
      use: f.use === true, credit: f.credit === true, creditAs: f.creditAs === 'real' ? 'real' : 'screen',
    });
  }
  return out;
}

function cleanCredit(c, errors, warnings) {
  const as = CREDIT_AS.some(([id]) => id === c?.as) ? c.as : 'screen';
  const real = one(c?.real, LIMITS.realName);
  if (as === 'real' && !real) errors.credit = 'Type your real name, or choose another credit.';
  return { as, real: as === 'real' ? real : '' };
}

function cleanShared(b, v, errors, warnings) {
  v.files = cleanFiles(b.files);
  v.credit = cleanCredit(b.credit, errors, warnings);
  v.consent = b.consent === true;
  v.files.forEach((f, i) => {
    if (!f.use) warnings[`file${i}`] = `${f.name}: tick "You may use this" if the team may use it with your puzzle; otherwise it is kept with your entry only.`;
    if (f.use && f.credit && f.creditAs === 'real' && v.credit.as !== 'real') warnings[`file${i}`] = `${f.name}: you asked for your real name on this file. Type it under Author credit (choose "My real name").`;
  });
  if (!v.consent) errors.consent = 'Tick the box to give permission.';
}

// ---------------------------------------------------------------- checks
export function checkEntry(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const game = GAMES[b.game] ? b.game : 'fantastical';
  const errors = {};
  const warnings = {};
  const v = game === 'ninetimesnine' ? checkNtn(b, errors, warnings) : checkFlg(b, errors, warnings);
  cleanShared(b, v, errors, warnings);
  return { value: v, errors, warnings, ready: !Object.keys(errors).length };
}

function checkFlg(b, errors, warnings) {
  const v = { game: 'fantastical' };
  v.title = one(b.title, LIMITS.title);
  v.look = /^[a-z0-9-]{0,24}$/.test(String(b.look || '')) ? String(b.look || '') : '';
  v.story = clean(b.story, LIMITS.story);
  v.ending = one(b.ending, LIMITS.ending);
  v.tone = TONES.includes(b.tone) ? b.tone : '';
  v.difficulty = FLG_LEVELS.some(([id]) => id === b.difficulty) ? b.difficulty : '';
  const castOne = low(one(b.cast?.one, LIMITS.cast));
  v.cast = { one: castOne, many: low(one(b.cast?.many, LIMITS.cast)) || plural(castOne) };
  // Names: different, and at least MIN_NAMES.
  const seenNames = new Set();
  v.names = [];
  splitItems(b.names).slice(0, MAX_NAMES + 4).forEach((n) => {
    const t = one(n, LIMITS.name);
    if (!t) return;
    if (seenNames.has(low(t))) { errors.names = `"${t}" is listed twice. Give every name once.`; return; }
    seenNames.add(low(t));
    v.names.push(t);
  });
  if (v.names.length > MAX_NAMES) { errors.names = `Use at most ${MAX_NAMES} names.`; v.names = v.names.slice(0, MAX_NAMES); }
  const N = v.names.length;
  // Lists.
  v.categories = [];
  const catNames = new Set();
  (Array.isArray(b.categories) ? b.categories : []).slice(0, MAX_CATEGORIES).forEach((c, i) => {
    const name = one(c?.name, LIMITS.catName);
    const seen = new Set();
    const items = [];
    let dup = '';
    for (const x of splitItems(c?.items)) {
      const t = one(x, LIMITS.item);
      if (!t) continue;
      if (seen.has(low(t))) { dup = t; continue; }
      seen.add(low(t));
      items.push(t);
    }
    if (!name && !items.length) return;
    const k = v.categories.length;
    const order = ORDERS.some(([id]) => id && id === c?.order) ? c.order : '';
    const pos = one(c?.pos, LIMITS.phrase);
    const neg = one(c?.neg, LIMITS.phrase);
    if (!name) errors[`catName${k}`] = 'Give this list a name, like Room or Arrival time.';
    else if (catNames.has(low(name))) errors[`catName${k}`] = 'Give each list a different name.';
    else if (low(name) === castOne || low(name) === 'name') errors[`catName${k}`] = `Use another name: the first column is always the ${v.cast.many || 'names'}.`;
    catNames.add(low(name));
    if (dup) errors[`catItems${k}`] = `"${dup}" is listed twice. Every item must be different.`;
    else if (items.length < 3) errors[`catItems${k}`] = 'List at least 3 different items, separated by commas.';
    else if (N >= MIN_NAMES && items.length !== N) errors[`catItems${k}`] = `List exactly ${N} items, one for each name (you have ${items.length}).`;
    if (pos && !neg) errors[`catPhrase${k}`] = `You wrote how to say a match ("${pos}"). Also write how to say it is not a match, like "did not ${pos.replace(/^(\w+?)(ed|s)?\b/, '$1')}".`;
    if (order && items.length >= 3 && /\d/.test(items.join('')) && !isAscending(items)) warnings[`catItems${k}`] = `The ${name || 'list'} items should run from first to last (${(ORDERS.find(([id]) => id === order) || ['', ''])[1].toLowerCase()}). Check their order.`;
    v.categories.push({ name, items, order, pos, neg: pos ? neg : '' });
  });
  v.answerMode = b.answerMode === 'auto' ? 'auto' : 'mine';
  // Answer key: { name: { list name: item } }, only for names and lists that exist.
  v.answer = {};
  const a = b.answer && typeof b.answer === 'object' ? b.answer : {};
  for (const n of v.names) {
    const row = a[n] && typeof a[n] === 'object' ? a[n] : {};
    v.answer[n] = {};
    for (const c of v.categories) { const it = c.items.find((x) => low(x) === low(row[c.name] || '')); if (it) v.answer[n][c.name] = it; }
  }

  if (!v.title) errors.title = 'Give your puzzle a title.';
  if (!v.story) errors.story = 'Write the opening scene: two to four sentences.';
  else if (v.story.split(/\s+/).length < 8) warnings.story = 'A few more words would help players picture the scene.';
  if (!v.difficulty) errors.difficulty = 'Choose a difficulty.';
  if (!castOne) errors.cast = 'Say who they are, like guest or student.';
  if (N < MIN_NAMES && !errors.names) errors.names = `List at least ${MIN_NAMES} different names (you have ${N}).`;
  if (v.categories.length < MIN_CATEGORIES) errors.categories = `Add at least ${MIN_CATEGORIES} lists, each with one item for every name.`;
  if (N > 6 && ['basic', 'easy'].includes(v.difficulty)) warnings.difficulty = `${N} names make a big grid for ${v.difficulty === 'basic' ? 'Basic' : 'Easy'}. It works, but players may find it long.`;
  if (v.answerMode === 'mine' && v.categories.length && N >= MIN_NAMES) {
    for (const [ci, c] of v.categories.entries()) {
      if (c.items.length !== N) continue;
      const used = new Map();
      for (const n of v.names) {
        const it = v.answer[n][c.name];
        if (!it) { errors[`answer${ci}`] = `Pick a ${c.name.toLowerCase() || 'item'} for ${n}.`; break; }
        if (used.has(low(it))) { errors[`answer${ci}`] = `${it} is given to both ${used.get(low(it))} and ${n}. Each ${c.name.toLowerCase()} goes to one name only.`; break; }
        used.set(low(it), n);
      }
    }
  }
  return v;
}

// True when items with numbers in them run lowest first ("7:00 PM", "$5", "3rd").
function isAscending(items) {
  const num = (s) => {
    const t = String(s).match(/(\d{1,2}):(\d{2})\s*([ap])?/i);
    if (t) return (Number(t[1]) % 12 + (/p/i.test(t[3] || '') ? 12 : 0)) * 60 + Number(t[2]);
    const m = String(s).replace(/,(?=\d{3})/g, '').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };
  const xs = items.map(num);
  if (xs.some((x) => Number.isNaN(x))) return true;
  return xs.every((x, i) => !i || x > xs[i - 1]);
}

function checkNtn(b, errors, warnings) {
  const v = { game: 'ninetimesnine' };
  v.title = one(b.title, LIMITS.title);
  v.world = NTN_WORLDS.some(([id]) => id === b.world) ? b.world : '';
  v.opening = one(b.opening, LIMITS.opening);
  v.stakes = one(b.stakes, LIMITS.stakes);
  v.ending = one(b.ending, LIMITS.ending);
  v.size = NTN_SIZES.includes(Number(b.size)) ? String(Number(b.size)) : '9';
  v.diagonal = b.diagonal === true;
  v.givensMode = b.givensMode === 'auto' ? 'auto' : 'mine';
  v.level = NTN_LEVELS.some(([id]) => id === b.level) ? b.level : '';
  const N = Number(v.size);
  const raw = Array.isArray(b.givens) ? b.givens : [];
  v.givens = Array.from({ length: N * N }, (_, i) => { const d = Number(raw[i]); return Number.isInteger(d) && d >= 1 && d <= N ? d : 0; });
  if (!v.title) errors.title = 'Give your puzzle a title.';
  if (!v.opening) errors.opening = 'Write the opening: who needs the grid filled, and why.';
  if (!v.ending) errors.ending = 'Write what happens when the grid is full.';
  if (v.givensMode === 'auto' && !v.level) errors.level = 'Choose a difficulty for the wizard\'s grid.';
  if (v.givensMode === 'mine') {
    const clash = givensClash(v.givens, N, v.diagonal);
    const filled = v.givens.filter(Boolean).length;
    if (clash) errors.givens = clash;
    else if (!filled) errors.givens = 'Type some starting numbers, or choose "Let the wizard make them".';
    else if (filled < MIN_GIVENS[N]) errors.givens = `A ${N} × ${N} grid needs at least ${MIN_GIVENS[N]} starting numbers for one answer (you have ${filled}).`;
  }
  return v;
}

// Fewer starting numbers than this can never give exactly one answer.
export const MIN_GIVENS = { 4: 4, 6: 8, 9: 17 };
const BOX = { 4: [2, 2], 6: [2, 3], 9: [3, 3] };

// The cells that see each other (rows, columns, boxes, and diagonals).
export function unitsOf(N, diagonal = false) {
  const [br, bc] = BOX[N];
  const units = [];
  for (let r = 0; r < N; r++) units.push({ name: `row ${r + 1}`, cells: [...Array(N)].map((_, c) => r * N + c) });
  for (let c = 0; c < N; c++) units.push({ name: `column ${c + 1}`, cells: [...Array(N)].map((_, r) => r * N + c) });
  for (let k = 0; k < N; k++) {
    const r0 = Math.floor(k / (N / bc)) * br; const c0 = (k % (N / bc)) * bc; const cells = [];
    for (let r = r0; r < r0 + br; r++) for (let c = c0; c < c0 + bc; c++) cells.push(r * N + c);
    units.push({ name: `box ${k + 1}`, cells });
  }
  if (diagonal) {
    units.push({ name: 'the falling diagonal', cells: [...Array(N)].map((_, i) => i * N + i) });
    units.push({ name: 'the rising diagonal', cells: [...Array(N)].map((_, i) => i * N + (N - 1 - i)) });
  }
  return units;
}
export const cellName = (N, c) => `row ${Math.floor(c / N) + 1}, column ${(c % N) + 1}`;

// The first repeated number in a row, column, box or diagonal, as words, or ''.
export function givensClash(givens, N, diagonal = false) {
  for (const u of unitsOf(N, diagonal)) {
    const seen = new Map();
    for (const c of u.cells) {
      const d = givens[c];
      if (!d) continue;
      if (seen.has(d)) return `${d} is in ${u.name} twice (${cellName(N, seen.get(d))} and ${cellName(N, c)}). Each number can appear once in every row, column and box.`;
      seen.set(d, c);
    }
  }
  return '';
}

// ---------------------------------------------------------------- reading it back
// The engine's custom world (engine/src/classroom.js checkCustom shape) and
// answer key (engine/src/generator.js answerSolution) for a logic grid entry.
export function flgWorld(v) {
  return {
    custom: {
      theme: v.title || 'My puzzle', title: v.title, story: v.story, ending: v.ending, cast: v.cast, names: v.names.slice(),
      categories: v.categories.map((c) => ({ name: c.name, items: c.items.slice(), order: c.order || null, pos: c.pos, neg: c.neg })),
    },
    answer: v.answerMode === 'mine' ? v.names.map((n) => ({ name: n, picks: { ...v.answer[n] } })) : null,
  };
}

// The live storyline: the puzzle's words as players will read them, from
// whatever is typed so far. Placeholders in [brackets] show what is missing.
export function storyText(entry) {
  const v = checkEntry(entry).value;
  const gap = (s, what) => s || `[${what}]`;
  if (v.game === 'ninetimesnine') {
    const N = Number(v.size);
    const parts = [gap(v.title, 'Title'), '', `${gap(v.opening, 'Opening')}${v.stakes ? ` ${v.stakes}` : ''}`, '',
      `Fill every empty cell with a number from 1 to ${N}. Each row, each column and each box holds every number exactly once.${v.diagonal ? ' Both long diagonals also hold every number exactly once.' : ''}`,
      '', v.givensMode === 'auto' ? `The wizard will make a ${(NTN_LEVELS.find(([id]) => id === v.level) || ['', 'level'])[1]} grid.` : `${v.givens.filter(Boolean).length} starting numbers placed.`,
      '', `When it is solved: ${gap(v.ending, 'Ending')}`];
    return parts.join('\n');
  }
  const many = v.cast.many || '[who they are]';
  const one = v.cast.one || '[who they are]';
  const names = v.names.length ? joinList(v.names) : '[names]';
  const lists = v.categories.length ? joinList(v.categories.map((c) => low(c.name || 'list'))) : '[lists to match]';
  const out = [gap(v.title, 'Title'), '', gap(v.story, 'Opening scene'), '', `The ${many} are ${names}.`, `Use the clues to match each ${one} with their ${lists}.`];
  for (const c of v.categories) {
    if (c.order && c.items.length >= 2) out.push(`The ${low(c.name)} list runs in order from ${c.items[0]} to ${c.items[c.items.length - 1]}.`);
  }
  for (const c of v.categories) out.push(`${c.name || '[list name]'}: ${c.items.length ? c.items.join(', ') : '[items]'}`);
  out.push('', '(The wizard writes the clues when it builds your puzzle.)', '', `When it is solved: ${v.ending || 'the wizard writes an ending from the answer.'}`);
  return out.join('\n');
}
const joinList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// The entry as [label, words] pairs for the team's view, emails and printing.
export function wizardCopy(form) {
  const v = form || {};
  const game = GAMES[v.game] || GAMES.fantastical;
  const out = [['Entry', 'Puzzle Wizard puzzle'], ['Game', game.name]];
  const add = (l, x) => { if (String(x ?? '').trim()) out.push([l, String(x)]); };
  add('Title', v.title);
  if (v.game === 'ninetimesnine') {
    add('Look', (NTN_WORLDS.find(([id]) => id === v.world) || [])[1]);
    add('Opening', v.opening); add('What is at stake', v.stakes); add('Ending', v.ending);
    add('Grid', `${v.size} × ${v.size}${v.diagonal ? ', with diagonals' : ''}`);
    add('Starting numbers', v.givensMode === 'auto' ? `Made by the wizard (${(NTN_LEVELS.find(([id]) => id === v.level) || ['', ''])[1]})` : `${(v.givens || []).filter(Boolean).length} placed by the author`);
  } else {
    add('Look', v.look); add('Opening scene', v.story); add('Ending', v.ending); add('Tone', v.tone);
    add('Difficulty', (FLG_LEVELS.find(([id]) => id === v.difficulty) || [])[1]);
    add('Who they are', v.cast && `${v.cast.one}, ${v.cast.many}`);
    add('Names', (v.names || []).join(', '));
    (v.categories || []).forEach((c, i) => add(`List ${i + 1}`, `${c.name}${c.order ? ' (in order)' : ''}: ${c.items.join(', ')}`));
    add('Answer key', v.answerMode === 'auto' ? 'Chosen by the wizard' : (v.names || []).map((n) => `${n}: ${Object.values((v.answer || {})[n] || {}).join(', ')}`).join(' · '));
  }
  (v.files || []).forEach((f, i) => add(`${f.kind === 'image' ? 'Picture' : 'Sound'} ${i + 1}`, `${f.name}: ${(FILES[f.kind].purposes.find(([id]) => id === f.purpose) || ['', ''])[1]}; ${f.use ? 'may be used' : 'not for use'}${f.use && f.credit ? `, credit as ${f.creditAs === 'real' ? 'real name' : 'screen name'}` : ''}`));
  add('Author credit', v.credit ? (v.credit.as === 'real' ? `Real name: ${v.credit.real}` : v.credit.as === 'none' ? 'Anonymous' : 'Screen name') : 'Screen name');
  add('Consent', v.consent ? `Given: "${CONSENT_TEXT}"` : 'Not given');
  return out;
}
