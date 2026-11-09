// Amazon KDP numbers for the Amazon KDP page (admin/kdp.js): printing cost,
// royalty, the lowest allowed list price and the listing rules. No DOM here,
// so server/test/kdp.test.mjs checks it directly.
//
// Figures are Amazon.com (USD), from KDP's help pages, checked 2026-11-08:
//   Paperback printing cost  https://kdp.amazon.com/en_US/help/topic/G201834340
//   Hardcover printing cost  https://kdp.amazon.com/help/topic/GTTMJWM4H3BLQA9A
//   Print royalty            https://kdp.amazon.com/help/topic/G8BKPU9AGVZSF9QF
// KDP changes them now and then: update RATES_CHECKED and the tables together.

export const RATES_CHECKED = '2026-11-08';

// Large trim: wider than 6.12 in or taller than 9 in.
export const isLarge = (trim) => {
  const [w, hgt] = String(trim || '').split('x').map(Number);
  return w > 6.12 || hgt > 9;
};

export const TRIMS = ['5x8', '5.5x8.5', '6x9', '7x10', '8x10', '8.25x11', '8.5x11'];
export const INKS = { black: 'Black ink', standard: 'Standard color', premium: 'Premium color' };
export const FORMATS = { paperback: 'Paperback', hardcover: 'Hardcover' };

// Each row: pages from..to, fixed cost, per-page cost, for regular and large trims.
const PAPERBACK = {
  black: [{ from: 24, to: 110, reg: [2.30, 0], big: [2.84, 0] }, { from: 111, to: 828, reg: [1.00, 0.012], big: [1.00, 0.017] }],
  premium: [{ from: 24, to: 40, reg: [3.60, 0], big: [4.20, 0] }, { from: 41, to: 828, reg: [1.00, 0.065], big: [1.00, 0.08] }],
  standard: [{ from: 72, to: 600, reg: [1.00, 0.0255], big: [1.00, 0.0402] }],
};
const HARDCOVER = {
  black: [{ from: 75, to: 108, reg: [6.80, 0], big: [6.80, 0] }, { from: 109, to: 550, reg: [5.50, 0.012], big: [5.50, 0.012] }],
  premium: [{ from: 75, to: 550, reg: [5.50, 0.070], big: [5.50, 0.070] }],
};

export const MAX_PRICE = 250;
// Amazon.com: 60% at $9.99 and up, 50% at $9.98 and under. Expanded Distribution: 40%.
export const RATE_BREAK = 9.99;
export const EXPANDED_RATE = 0.4;

const cents = (v) => Math.round(v * 100) / 100;

// The printing cost, or { error } when KDP does not print that combination.
export function printingCost({ format = 'paperback', ink = 'black', trim = '6x9', pages = 0 }) {
  const table = (format === 'hardcover' ? HARDCOVER : PAPERBACK)[ink];
  if (!table) return { error: `${FORMATS[format] || 'This format'} is not printed in ${(INKS[ink] || ink).toLowerCase()}.` };
  const n = Math.round(Number(pages) || 0);
  const lo = table[0].from;
  const hi = table[table.length - 1].to;
  if (n < lo || n > hi) return { error: `${FORMATS[format] || 'Paperback'} in ${(INKS[ink] || ink).toLowerCase()} needs ${lo} to ${hi} pages.` };
  const row = table.find((r) => n >= r.from && n <= r.to);
  const [fixed, per] = isLarge(trim) ? row.big : row.reg;
  return { cost: cents(fixed + per * n), fixed, per, pages: n, large: isLarge(trim) };
}

export const rateFor = (price) => (price >= RATE_BREAK ? 0.6 : 0.5);

// The lowest list price KDP accepts on Amazon.com for this printing cost.
export function minimumPrice(cost, { expanded = false } = {}) {
  const up = (v) => Math.ceil(v * 100 - 1e-9) / 100;
  const amazon = cost / 0.5 <= RATE_BREAK - 0.01 ? up(cost / 0.5) : Math.max(RATE_BREAK, up(cost / 0.6));
  return expanded ? Math.max(amazon, up(cost / EXPANDED_RATE)) : amazon;
}

// What one copy earns at this list price.
export function royalty({ price, cost, expanded = false }) {
  const p = Number(price) || 0;
  const rate = rateFor(p);
  const amazon = cents(p * rate - cost);
  const out = { rate, amazon, min: minimumPrice(cost, { expanded }) };
  if (expanded) out.expanded = cents(p * EXPANDED_RATE - cost);
  return out;
}

// ---- Listing rules (KDP's Details page).
export const LIMITS = { titleSubtitle: 200, description: 4000, keyword: 50, keywords: 7, categories: 3 };
// Words KDP's keyword guidelines say to leave out: claims, Amazon programs, time-limited offers.
const KEYWORD_BANNED = ['bestseller', 'best seller', 'best-selling', 'free', 'new', 'on sale', 'sale', 'kindle unlimited', 'kindle', 'kdp', 'amazon', 'available now', '#1', 'number one', 'top rated'];

const tokens = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'by', 'or', 'at', 'from', 'vol', 'volume', 'book']);

// What to fix (problems) and what to look at (tips) before the listing goes to KDP.
export function checkListing(l = {}) {
  const problems = [];
  const tips = [];
  const title = String(l.title || '').trim();
  const sub = String(l.subtitle || '').trim();
  if (!title) problems.push('Add the title.');
  if (title.length + sub.length > LIMITS.titleSubtitle) problems.push(`The title and subtitle together are ${title.length + sub.length} characters; KDP allows ${LIMITS.titleSubtitle}.`);
  if (!String(l.author || '').trim()) problems.push('Add the author.');
  const desc = String(l.description || '');
  if (!desc.trim()) problems.push('Add the description.');
  else if (desc.length > LIMITS.description) problems.push(`The description is ${desc.length} characters; KDP allows ${LIMITS.description}.`);
  const kws = (l.keywords || []).map((k) => String(k || '').trim());
  const titleWords = new Set(tokens(`${title} ${sub}`).filter((w) => !STOP.has(w)));
  kws.forEach((k, i) => {
    if (!k) return;
    if (k.length > LIMITS.keyword) problems.push(`Keyword ${i + 1} is ${k.length} characters; KDP allows ${LIMITS.keyword}.`);
    if (/["“”]/.test(k)) tips.push(`Keyword ${i + 1}: leave out quotation marks.`);
    if (k.includes(',')) tips.push(`Keyword ${i + 1}: separate words with spaces, not commas.`);
    const low = ` ${k.toLowerCase()} `;
    const bad = KEYWORD_BANNED.find((b) => low.includes(` ${b} `));
    if (bad) problems.push(`Keyword ${i + 1}: KDP does not allow "${bad}" in keywords.`);
    const rep = tokens(k).filter((w) => titleWords.has(w));
    if (rep.length && rep.length === tokens(k).length) tips.push(`Keyword ${i + 1} only repeats words from the title or subtitle, which Amazon already searches.`);
  });
  const filled = kws.filter(Boolean).length;
  if (filled < LIMITS.keywords) tips.push(`${LIMITS.keywords - filled} of the ${LIMITS.keywords} keyword boxes are empty.`);
  const seen = new Map();
  kws.forEach((k, i) => { const key = k.toLowerCase(); if (k && seen.has(key)) tips.push(`Keywords ${seen.get(key) + 1} and ${i + 1} are the same.`); else seen.set(key, i); });
  const cats = (l.categories || []).map((c) => String(c || '').trim()).filter(Boolean);
  if (!cats.length) problems.push('Choose at least one category.');
  else if (cats.length < LIMITS.categories) tips.push(`You can choose ${LIMITS.categories} categories; ${cats.length} chosen.`);
  const ai = l.ai || {};
  if (!['text', 'images', 'translations'].every((k) => ai[k])) problems.push('Answer the AI-generated content questions (text, images, translations).');
  const pc = printingCost(l.print || {});
  if (pc.error) problems.push(pc.error);
  else {
    const price = Number(l.price?.usd) || 0;
    const min = minimumPrice(pc.cost, { expanded: !!l.price?.expanded });
    if (!price) problems.push('Set the list price.');
    else if (price < min) problems.push(`The lowest list price KDP allows for this book is $${min.toFixed(2)}${l.price?.expanded ? ' with Expanded Distribution' : ''}.`);
    else if (price > MAX_PRICE) problems.push(`The highest list price on Amazon.com is $${MAX_PRICE}.`);
    else if (price < RATE_BREAK) tips.push(`Under $${RATE_BREAK} the royalty is 50%. At $${RATE_BREAK.toFixed(2)} it is 60%: $${(RATE_BREAK * 0.6 - pc.cost).toFixed(2)} a copy instead of $${(price * 0.5 - pc.cost).toFixed(2)}.`);
  }
  return { problems, tips, ready: !problems.length };
}

// The AI-generated content answers, as KDP words them (Content tab).
export const AI_TEXT = [['none', 'None'], ['some-min', 'Some sections, with minimal or no editing'], ['some-ext', 'Some sections, with extensive editing'], ['all-min', 'Entire work, with minimal or no editing'], ['all-ext', 'Entire work, with extensive editing']];
export const AI_IMAGES = [['none', 'None'], ['few-min', 'One or a few AI-generated images, with minimal or no editing'], ['few-ext', 'One or a few AI-generated images, with extensive editing'], ['many-min', 'Many AI-generated images, with minimal or no editing'], ['many-ext', 'Many AI-generated images, with extensive editing']];

export const STATUSES = { planning: 'Planning', draft: 'Draft on KDP', review: 'In review', live: 'Live on Amazon', unpublished: 'Unpublished' };
