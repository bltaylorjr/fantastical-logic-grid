// Reads a player's storyline idea (plain words from Menu > Ideas and problems)
// into a custom world for the puzzle engine: the scene, who is in it and the
// lists to match. Shared by the admin dashboard (to show what the puzzle will
// be built from before Approve is pressed) and scripts/storyline-puzzle.mjs
// (which builds the puzzle when the approval email is sent). No imports, so
// both can load it.
//
// A storyline is read as "Label: item, item, item" lists, for example
//   A beach rental story. Umbrella Companies: Shady Summers, In the Shade,
//   Beach Bums. Price: $60, $69, $75. Accessories: Bluetooth, Wifi Hotspot.
// - Text before the first list is the scene.
// - The first list of names (not numbers) is the cast: the grid's first column.
// - A list of numbers or prices is ordered, lowest first.
// - "Category: Price $60, $69" takes its name from the first item's words.
// The result has the shape engine/src/classroom.js checkCustom() expects.

const MAX_CATEGORIES = 4; // besides the cast (checkCustom keeps 4)
// The order words engine/src/classroom.js knows (ORDER_WORDS).
const ORDERED = { earlier: 1, lower: 1, smaller: 1, shorter: 1 };
const MAX_ITEMS = 8;
const MAX_NAME = 24;
const MAX_ITEM = 30;

const squash = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
const capWords = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// "Companies" -> "Company", "Accessories" -> "Accessory", "Prices" -> "Price".
// Words ending in "-ies" whose one ends in "-ie", not "-y" ("Movies" -> "Movie").
const IE_WORDS = /(^|\s)(movies|cookies|pies|ties|lies|brownies|zombies|rookies|hippies|calories|goodies|goalies|smoothies|selfies|veggies|collies|genies|pixies|hoodies|beanies|aunties|sweeties|birdies|cuties|newbies|sorties|lassies|pinkies|boogies|indies|walkie-talkies)$/i;

export function singular(word) {
  const w = squash(word);
  // The last word decides ("Clothing Themes" -> "Clothing Theme").
  if (IE_WORDS.test(w)) return w.replace(/ies$/i, (m) => (m[0] === 'I' ? 'IE' : 'ie'));
  if (/ies$/i.test(w)) return w.replace(/ies$/i, (m) => (m[0] === 'I' ? 'Y' : 'y'));
  if (/(ss|us|is)$/i.test(w)) return w;
  if (/(ches|shes|xes|sses)$/i.test(w)) return w.replace(/es$/i, '');
  if (/s$/i.test(w)) return w.replace(/s$/i, '');
  return w;
}
const plural = (word) => (/[^aeiou]y$/i.test(word) ? word.replace(/y$/i, 'ies') : /(s|x|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`);

// A number in an item ("$60", "1,200", "3.5 miles"), or NaN.
const numberOf = (item) => {
  const m = String(item).replace(/,(?=\d{3}\b)/g, '').match(/^\$?\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : NaN;
};

function splitItems(body) {
  const out = [];
  const seen = new Set();
  for (let part of body.split(/[,;\n]/)) {
    // A list ends where a new sentence starts ("Lemonade. The butler was ...");
    // a short abbreviation like "Mr. Pike" stays one item.
    const stop = part.match(/^(.*?[^.\s])[.!?]\s+(\S+\s+\S+\s+\S+.*)$/s);
    if (stop) part = stop[1];
    part = squash(part).replace(/^(and|or)\s+/i, '').replace(/[.!?]+$/, '').trim();
    if (!part || seen.has(part.toLowerCase())) continue;
    seen.add(part.toLowerCase());
    out.push(part);
  }
  return out;
}

// The lists in the text: [{ label, items }], and the scene before them.
function findLists(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n');
  const re = /(^|[\n.;!?]\s*)([A-Za-z][A-Za-z0-9'&\- ]{0,38}?)\s*:\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ start: m.index + m[1].length, bodyStart: m.index + m[0].length, label: squash(m[2]) });
  const lists = marks.map((k, i) => ({ label: k.label, items: splitItems(t.slice(k.bodyStart, i + 1 < marks.length ? marks[i + 1].start : t.length)) }));
  const scene = squash(marks.length ? t.slice(0, marks[0].start) : t); // no lists: it is all scene
  return { scene, lists };
}

// "Category: Price $60, $69" -> name "Price", first item "$60".
function nameGeneric(list, i) {
  if (!/^(category|list|group)\s*\d*$/i.test(list.label)) return list;
  const first = list.items[0] || '';
  const m = first.match(/^([A-Za-z][A-Za-z' ]*?)\s+(?=[$\d])(.+)$/);
  if (m) return { label: m[1], items: [m[2], ...list.items.slice(1)] };
  return { label: `Category ${i + 1}`, items: list.items };
}

// Returns { def, summary } when the storyline has a cast and at least two
// more lists of 3 or more items, otherwise { def: null, reason }.
// themeName: the theme the player picked, if any (used to name the world).
export function readStoryline(text, themeName = '') {
  const { scene, lists: raw } = findLists(text);
  const lists = raw.map(nameGeneric).filter((l) => l.items.length >= 3);
  if (!lists.length) return { def: null, reason: 'No lists were found. A storyline needs lists like "Companies: A, B, C".' };
  const isNumbers = (l) => l.items.every((x) => Number.isFinite(numberOf(x)));
  const castIdx = lists.findIndex((l) => !isNumbers(l));
  let cast = { one: 'person', many: 'people' };
  let names = [];
  let rest = lists;
  if (castIdx >= 0) {
    const c = lists[castIdx];
    const one = singular(c.label).toLowerCase();
    cast = { one, many: plural(one) };
    names = c.items.map((x) => x.slice(0, MAX_NAME)).slice(0, MAX_ITEMS);
    rest = lists.filter((_, i) => i !== castIdx);
  }
  const used = new Set([cast.one, 'name']);
  const categories = [];
  for (const l of rest) {
    if (categories.length >= MAX_CATEGORIES) break;
    let name = capWords(singular(l.label)).slice(0, 30);
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    if (isNumbers(l)) {
      const items = l.items.slice().sort((a, b) => numberOf(a) - numberOf(b)).slice(0, MAX_ITEMS).map((x) => x.slice(0, MAX_ITEM));
      const money = items.every((x) => /^\$/.test(x));
      categories.push(money
        ? { name, items, pos: 'costs', neg: 'does not cost', order: 'lower', less: 'costs less than', more: 'costs more than' }
        : { name, items, pos: '', neg: '', order: 'lower', less: '', more: '' });
    } else {
      categories.push({ name, items: l.items.slice(0, MAX_ITEMS).map((x) => x.slice(0, MAX_ITEM)), pos: '', neg: '', order: null, less: '', more: '' });
    }
  }
  if (categories.length < 2) return { def: null, reason: 'A storyline needs at least 3 lists of 3 or more items (who is in it, plus 2 things to match).' };
  const world = squash(themeName) || capWords(cast.many);
  const def = {
    theme: world.slice(0, 60),
    title: `The ${capWords(cast.many)} Mix-Up`.slice(0, 80),
    story: scene.slice(0, 1200),
    ending: '',
    cast,
    names: names.length >= 3 ? names : [],
    categories,
  };
  const summary = [`${capWords(cast.many)} (${names.length >= 3 ? names.length : 'names chosen for you'})`, ...categories.map((c) => `${c.name} (${c.items.length})`)].join(', ');
  return { def, summary };
}

// Reads an entry from the Suggest a storyline form (web/js/storyline-fields.js)
// the same way: the characters' names are the cast, and the lists in the clues
// and story beat ("Rooms: Library, Kitchen, Garden") are what to match. The
// story uses the team's corrected words when there are some (polished), and
// the title is the author's own. Returns { def, summary, difficulty } or
// { def: null, reason }.
export function readSubmission(form, polished = null, themeName = '') {
  const f = form || {};
  const p = polished || {};
  const word = (k) => squash(p[k] || f[k] || '');
  const names = (f.characters || []).map((c) => squash(c.name).slice(0, MAX_NAME)).filter(Boolean).slice(0, MAX_ITEMS);
  // Lists in the clues, then in the story beat: read line by line, so a list
  // on one line never runs on into the next line or into the story.
  const byLine = (text) => String(text || '').split(/\r?\n/).flatMap((line) => findLists(line).lists);
  const raw = [...byLine(p.clues || f.clues), ...byLine(p.beat || f.beat)];
  const known = new Set(names.map((n) => n.toLowerCase()));
  // A list of the characters' own names is the cast, not a category.
  const lists = raw.map(nameGeneric).filter((l) => l.items.length >= 3 && !l.items.every((x) => known.has(x.toLowerCase())));
  // Categories from the form's builder come first, as the author set them up
  // (items in the order typed; an ordered list runs from its first item).
  const built = (f.categories || []).filter((c) => c && c.name && (c.items || []).length >= 3).map((c) => ({
    name: capWords(squash(c.name)).slice(0, 30), items: c.items.slice(0, MAX_ITEMS).map((x) => squash(x).slice(0, MAX_ITEM)),
    pos: '', neg: '', order: ORDERED[c.order] ? c.order : null, less: '', more: '',
  }));
  // Then lists in the clues and story beat. A stand-in cast line keeps
  // readStoryline from taking one of them as the cast.
  const fromClues = lists.length ? readStoryline(`Characters: Zz1, Zz2, Zz3.\n${lists.map((l) => `${l.label}: ${l.items.join(', ')}.`).join('\n')}\nZzend: a, b, c.`, '') : null;
  const used = new Set(['character', 'name', ...built.map((c) => c.name.toLowerCase())]);
  const categories = [...built];
  for (const c of fromClues?.def?.categories || []) {
    if (categories.length >= MAX_CATEGORIES) break;
    if (c.name === 'Zzend' || used.has(c.name.toLowerCase())) continue;
    used.add(c.name.toLowerCase());
    categories.push(c);
  }
  if (categories.length < 2) {
    return { def: null, reason: 'It needs at least 2 categories of 3 or more things to match: add them in the Categories builder, or as lists in the clues like "Rooms: Library, Kitchen, Garden".' };
  }
  const read = { def: { theme: (squash(themeName) || word('title') || 'Characters').slice(0, 60), title: 'The Characters Mix-Up', story: '', ending: '', cast: { one: 'character', many: 'characters' }, names: [], categories } };
  read.summary = [`Characters (${names.length >= 3 ? names.length : 'names chosen for them'})`, ...categories.map((c) => `${c.name} (${c.items.length})`)].join(', ');
  // The story beat's words ("Beginning: the lights go out."), without its lists of things to match.
  const beat = String(p.beat || f.beat || '').split(/\r?\n/).flatMap((line) => {
    const r = findLists(line);
    return [r.scene, ...r.lists.filter((l) => l.items.length < 3).map((l) => l.items.join(', '))];
  }).map((x) => squash(x).replace(/[.!?]+$/, '')).filter(Boolean).join('. ');
  const story = [word('setting'), word('goal'), beat].filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
  const def = { ...read.def, title: (word('title') || read.def.title).slice(0, 80), story: story.slice(0, 1200) || read.def.story };
  if (names.length >= 3) def.names = names;
  return { def, summary: read.summary, difficulty: f.difficulty || '' };
}
