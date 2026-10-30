// Item order rule (Bobby, 2026-10-27): the items of every grid category are
// listed in a sensible order, so rows, columns, answer keys, printouts and
// clue lists all read the same way.
//   1. A category written in a natural order ({ order: 'listed' }, such as
//      eras from oldest to newest) keeps that order.
//   2. Items that make up a known sequence (times, days, months, seasons,
//      ordinals, sizes, medals, meals, parts of the day) go in that order.
//   3. Everything else is alphabetical, with numbers in number order
//      ("Table 2" before "Table 10"); a leading "The" is ignored.
// Numbered (ordinal) categories are built in number order already.

const SEQUENCES = [
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['spring', 'summer', 'fall', 'autumn', 'winter'],
  ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'last'],
  ['extra small', 'small', 'medium', 'large', 'extra large'],
  ['tiny', 'small', 'medium', 'large', 'huge', 'giant'],
  ['bronze', 'silver', 'gold', 'platinum', 'diamond'],
  ['breakfast', 'brunch', 'lunch', 'snack', 'dinner', 'supper', 'dessert'],
  ['dawn', 'morning', 'noon', 'afternoon', 'evening', 'dusk', 'night', 'midnight'],
  ['beginner', 'intermediate', 'advanced', 'expert'],
];

// "9:30 am", "12 noon", "7 pm" -> minutes after midnight.
function clockMinutes(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]) % 12;
  return (h + (/^p/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2] || 0);
}

const plain = (s) => String(s).trim().toLowerCase();
const sortName = (s) => String(s).trim().replace(/^the\s+/i, '');
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function compareItems(a, b) {
  return collator.compare(sortName(a), sortName(b)) || collator.compare(String(a), String(b));
}

// Rank of each label in a known sequence, or null when the labels are not
// all part of one.
function sequenceRanks(labels) {
  const times = labels.map(clockMinutes);
  if (times.every((t) => t != null)) return times;
  for (const seq of SEQUENCES) {
    const ranks = labels.map((l) => seq.indexOf(plain(l)));
    if (ranks.every((r) => r >= 0)) return ranks;
  }
  return null;
}

// Put a category's chosen labels in order. `listed` is the category's full
// item list, used when the category asks to keep its written order.
export function orderItems(labels, { order, listed } = {}) {
  const out = labels.slice();
  if (order === 'listed' && Array.isArray(listed)) {
    return out.sort((p, q) => listed.indexOf(p) - listed.indexOf(q));
  }
  const ranks = sequenceRanks(out);
  if (ranks) {
    const rank = new Map(out.map((l, i) => [l, ranks[i]]));
    return out.sort((p, q) => rank.get(p) - rank.get(q) || compareItems(p, q));
  }
  return out.sort(compareItems);
}

// True when the labels already follow the rule (used by the tests).
export function inOrder(labels, opts) {
  const want = orderItems(labels, opts);
  return want.every((l, i) => l === labels[i]);
}
