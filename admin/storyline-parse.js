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
const MAX_ITEMS = 8;
const MAX_NAME = 24;
const MAX_ITEM = 30;

const squash = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
const capWords = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// "Companies" -> "Company", "Accessories" -> "Accessory", "Prices" -> "Price".
export function singular(word) {
  const w = squash(word);
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
  const scene = squash(marks.length ? t.slice(0, marks[0].start) : '');
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
