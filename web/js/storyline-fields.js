// The Suggest a storyline form's fields, shared by the page (web/storyline/),
// the Worker that checks and saves an entry (server/src/story-submissions.js),
// the admin dashboard's Storyline submissions page and the emails that carry a
// copy of the form. No imports, so all of them can load it.
//
// Three kinds of entry: a theme idea, a category idea for an existing theme,
// or a whole storyline. For a storyline, Title, Single-line pitch, the
// characters (at least one, each with a name) and Clues are required, and so
// is the consent box.

export const KINDS = { theme: 'Theme idea', category: 'Category idea', storyline: 'Storyline' };
export const MAX_CHARACTERS = 10;
// The categories builder: the lists of things to match (the grid's other columns).
export const MAX_CATEGORIES = 4;
export const MAX_ITEMS = 8;
// An ordered category's items are listed from the first word to the second.
export const ORDERS = [['', 'No order'], ['earlier', 'Earliest to latest (times, dates)'], ['lower', 'Lowest to highest (numbers, prices, ages)'],
  ['smaller', 'Smallest to biggest'], ['shorter', 'Shortest to longest']];
export const LIMITS = {
  idea: 20, title: 40, pitch: 80, setting: 120, name: 30, trait: 30, goal: 160,
  catName: 30, item: 30, clues: 2000, beat: 2000, branch: 1000, alt: 1000, credit: 40,
};
export const TONES = ['Lighthearted', 'Cozy', 'Whimsical', 'Funny', 'Heartwarming', 'Adventurous', 'Mysterious', 'Suspenseful', 'Spooky (not scary)', 'Dramatic'];
// The game's difficulty levels (engine/src/tiers.js), in order.
export const DIFFICULTIES = [['basic', 'Basic'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert'], ['mensa', 'Quantum Physicist'], ['theorist', 'Theoretical Physicist']];
// What a solved puzzle can give the player. Animation: the game's celebrations (web/js/effects.js).
export const REWARDS = {
  animation: { label: 'Animation', options: ['Confetti', 'Fireworks', 'Ribbons', 'Balloons', 'Shooting stars', 'Surprise me'] },
  art: { label: 'Art', options: ['Story scene picture', 'Character portraits', 'Both', 'No art'] },
  voice: { label: 'Voice', options: ['Narrator reads the ending', 'Characters speak', 'No voice'] },
};
// The puzzles a storyline can be for. With only one, the form hides the question.
export const PUZZLES = [['logic-grid', 'The Fantastical Logic Grid']];
export const ROLES = ['Main', 'Supporting'];
export const CONSENT_TEXT = 'I wrote this myself and give The Logic Grid permission to use, edit and publish it in the game and its puzzles, with credit to the name I gave.';

const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max);
const one = (v, max) => clean(v, max).replace(/\s*\n\s*/g, ' ');

// Checks an entry. Returns { value } (the cleaned form, ready to save) or
// { errors: { field: 'what to fix' } }. themeIds: the themes a category may
// be for; themeName(id) names one.
export function checkSubmission(body, { themeIds = [] } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const kind = KINDS[b.kind] ? b.kind : null;
  const errors = {};
  if (!kind) return { errors: { kind: 'Choose what you would like to send.' } };
  if (kind === 'theme') {
    const idea = one(b.idea, LIMITS.idea);
    if (!idea) errors.idea = 'Enter a theme idea.';
    return Object.keys(errors).length ? { errors } : { value: { kind, idea } };
  }
  if (kind === 'category') {
    const theme = themeIds.includes(b.theme) ? b.theme : '';
    const idea = one(b.idea, LIMITS.idea);
    if (!theme) errors.theme = 'Choose a theme.';
    if (!idea) errors.idea = 'Enter a category idea.';
    return Object.keys(errors).length ? { errors } : { value: { kind, theme, idea } };
  }
  const v = { kind };
  v.theme = themeIds.includes(b.theme) ? b.theme : ''; // optional
  v.title = one(b.title, LIMITS.title);
  v.pitch = one(b.pitch, LIMITS.pitch);
  v.setting = one(b.setting, LIMITS.setting);
  const list = Array.isArray(b.characters) ? b.characters.slice(0, MAX_CHARACTERS) : [];
  v.characters = list.map((c) => ({
    name: one(c?.name, LIMITS.name),
    trait: one(c?.trait, LIMITS.trait),
    role: ROLES.includes(c?.role) ? c.role : 'Supporting',
  }));
  // Categories: optional, but each one started needs a name and at least 3 different items.
  v.categories = [];
  const seenNames = new Set();
  (Array.isArray(b.categories) ? b.categories.slice(0, MAX_CATEGORIES) : []).forEach((c, i) => {
    const name = one(c?.name, LIMITS.catName);
    const raw = Array.isArray(c?.items) ? c.items : String(c?.items ?? '').split(/[,;\n]/);
    const seen = new Set();
    const items = [];
    for (const x of raw) { const t = one(x, LIMITS.item); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); items.push(t); } }
    if (!name && !items.length) return;
    const order = ORDERS.some(([id]) => id && id === c?.order) ? c.order : '';
    if (!name) errors[`catName${i}`] = 'Give this category a name.';
    else if (seenNames.has(name.toLowerCase())) errors[`catName${i}`] = 'Give each category a different name.';
    seenNames.add(name.toLowerCase());
    if (items.length < 3) errors[`catItems${i}`] = 'List at least 3 different items, separated by commas.';
    else if (items.length > MAX_ITEMS) errors[`catItems${i}`] = `List at most ${MAX_ITEMS} items.`;
    v.categories.push({ name, items: items.slice(0, MAX_ITEMS), order });
  });
  v.goal = one(b.goal, LIMITS.goal);
  v.puzzle = PUZZLES.some(([id]) => id === b.puzzle) ? b.puzzle : PUZZLES[0][0];
  v.clues = clean(b.clues, LIMITS.clues);
  v.beat = clean(b.beat, LIMITS.beat);
  v.branch = clean(b.branch, LIMITS.branch);
  v.alt = clean(b.alt, LIMITS.alt);
  v.tone = TONES.includes(b.tone) ? b.tone : '';
  v.difficulty = DIFFICULTIES.some(([id]) => id === b.difficulty) ? b.difficulty : '';
  v.reward = {};
  for (const [k, r] of Object.entries(REWARDS)) v.reward[k] = r.options.includes(b.reward?.[k]) ? b.reward[k] : r.options[0];
  v.credit = one(b.credit, LIMITS.credit);
  v.consent = b.consent === true;
  if (!v.title) errors.title = 'Enter a title.';
  if (!v.pitch) errors.pitch = 'Enter a pitch.';
  if (!v.characters.length) errors.characters = 'Add at least one character.';
  v.characters.forEach((c, i) => { if (!c.name) errors[`name${i}`] = 'Enter a name.'; });
  if (!v.clues) errors.clues = 'Add at least one clue.';
  if (!v.consent) errors.consent = 'Tick the box to give permission.';
  return Object.keys(errors).length ? { errors } : { value: v };
}

// The entry as [label, words] pairs, in the form's order, for the admin page,
// printing and the emailed copy. Empty optional fields are left out unless
// all = true. themeName(id) names a theme.
export function formCopy(form, themeName = (id) => id, { all = false } = {}) {
  const f = form || {};
  const out = [['Entry', KINDS[f.kind] || 'Idea']];
  const add = (label, value) => { if (all || String(value ?? '').trim()) out.push([label, String(value ?? '')]); };
  if (f.kind === 'theme') { add('Theme idea', f.idea); return out; }
  if (f.kind === 'category') { add('Theme', themeName(f.theme)); add('Category idea', f.idea); return out; }
  if (f.idea && !f.title) { add('Theme', f.theme ? themeName(f.theme) : ''); add('Their idea', f.idea); return out; } // from Share an idea
  add('Theme', f.theme ? themeName(f.theme) : '');
  add('Title', f.title);
  add('Single-line pitch', f.pitch);
  add('Storyline setting', f.setting);
  const chars = f.characters || [];
  add('Characters', chars.length ? String(chars.length) : '');
  chars.forEach((c, i) => add(`Character ${i + 1}`, [c.name, c.trait && `trait: ${c.trait}`, c.role && `${c.role.toLowerCase()} character`].filter(Boolean).join(', ')));
  (f.categories || []).forEach((c, i) => add(`Category ${i + 1}`, `${c.name}${c.order ? ` (${(ORDERS.find(([id]) => id === c.order) || ['', ''])[1].replace(/ \(.*\)$/, '').toLowerCase()})` : ''}: ${c.items.join(', ')}`));
  add('Central mystery or goal', f.goal);
  if (PUZZLES.length > 1 || all) add('Puzzle', (PUZZLES.find(([id]) => id === f.puzzle) || PUZZLES[0])[1]);
  add('Clues', f.clues);
  add('Story beat', f.beat);
  add('Story beat branch', f.branch);
  add('Story beat alternate ending', f.alt);
  add('Tone', f.tone);
  add('Level of difficulty', (DIFFICULTIES.find(([id]) => id === f.difficulty) || [])[1] || '');
  if (f.reward) add('Reward', Object.entries(REWARDS).map(([k, r]) => `${r.label}: ${f.reward[k] || r.options[0]}`).join(' · '));
  add('Storyline credit', f.credit || (all ? '' : 'Anonymous'));
  add('Consent', f.consent ? `Given: "${CONSENT_TEXT}"` : 'Not given');
  return out;
}

// The entry's words as one block, for search and as the original text.
export const formText = (form, themeName) => formCopy(form, themeName).map(([l, v]) => `${l}: ${v}`).join('\n');
