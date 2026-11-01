// Book publishing: everything that turns settings and puzzles into print pages,
// with no browser APIs, so the admin page (books.js) and the command line
// (scripts/book.mjs) make exactly the same book.
//
// The page markup never uses style="" (the dashboard's Content-Security-Policy
// blocks inline styles). Sizes and colors go in data-css="--name:value;..."
// and applyDataCss() sets them through the CSSOM, which the policy allows.
//
// KDP numbers below (trim sizes, page ranges, margins, spine width, printing
// cost) follow KDP's help pages as of November 2026. They change now and then:
// the page says to confirm prices in KDP's own calculator.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const curly = (s) => String(s ?? '').replace(/'/g, '’');
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- options

// KDP paperback trim sizes (inches). Large trim = wider than 6.12 or taller than 9.
export const TRIMS = [
  ['5x8', 5, 8], ['5.06x7.81', 5.06, 7.81], ['5.25x8', 5.25, 8], ['5.5x8.5', 5.5, 8.5], ['6x9', 6, 9],
  ['6.14x9.21', 6.14, 9.21], ['6.69x9.61', 6.69, 9.61], ['7x10', 7, 10], ['7.44x9.69', 7.44, 9.69],
  ['7.5x9.25', 7.5, 9.25], ['8x10', 8, 10], ['8.25x6', 8.25, 6], ['8.25x8.25', 8.25, 8.25],
  ['8.27x11.69', 8.27, 11.69], ['8.5x8.5', 8.5, 8.5], ['8.5x11', 8.5, 11],
].map(([id, w, h]) => ({ id, w, h, label: `${w}" × ${h}"${id === '8.27x11.69' ? ' (A4)' : ''}${id === '8.5x11' ? ' (Letter, Volume 1)' : ''}`, large: w > 6.12 || h > 9 }));
export const trimOf = (id) => TRIMS.find((t) => t.id === id) || TRIMS.find((t) => t.id === '8.5x11');

export const INKS = { bw: 'Black and white', standard: 'Standard color', premium: 'Premium color' };
export const PAPERS = { white: 'White', cream: 'Cream (black and white only)' };
// [min, max] pages KDP allows for a paperback.
export const PAGE_RANGE = { 'bw-white': [24, 828], 'bw-cream': [24, 776], 'standard-white': [72, 600], 'premium-white': [24, 828] };
// Inches of spine per page.
export const SPINE_PER_PAGE = { 'bw-white': 0.002252, 'bw-cream': 0.0025, 'standard-white': 0.002252, 'premium-white': 0.002347 };
export const BLEED = 0.125;

// Amazon.com paperback printing cost, USD: [fixed up to `flatTo` pages, fixed + per page above it].
// null = KDP did not publish a figure we could confirm: check its calculator.
export const PRINT_RATES = {
  bw: { flatTo: 110, regular: { flat: 2.30, fixed: 1.00, perPage: 0.012 }, large: { flat: 2.84, fixed: 1.00, perPage: 0.017 } },
  standard: { flatTo: 0, regular: { flat: null, fixed: 1.00, perPage: 0.0255 }, large: null },
  premium: { flatTo: 40, regular: { flat: 3.60, fixed: 1.00, perPage: 0.065 }, large: { flat: 4.20, fixed: 1.00, perPage: 0.08 } },
};

export const FONTS = [
  ['Poppins', 'Poppins (built in)', 'sans-serif'], ['Caladea', 'Caladea (built in)', 'serif'],
  ['Georgia', 'Georgia', 'serif'], ['Times New Roman', 'Times New Roman', 'serif'], ['Palatino Linotype', 'Palatino', 'serif'],
  ['Garamond', 'Garamond', 'serif'], ['Arial', 'Arial', 'sans-serif'], ['Verdana', 'Verdana', 'sans-serif'],
  ['Trebuchet MS', 'Trebuchet MS', 'sans-serif'], ['Courier New', 'Courier New', 'monospace'],
];
const fontStack = (name) => { const f = FONTS.find((x) => x[0] === name) || FONTS[0]; return `"${f[0]}", ${f[2]}`; };

// Per-element colors. [key, label]
export const ELEMENTS = {
  words: { label: 'Words', items: [['text', 'Body text'], ['heading', 'Headings'], ['story', 'Story text'], ['clue', 'Clues and questions'], ['rh', 'Running heads and page numbers'], ['accent', 'Lines, level dots and boxes']] },
  grids: { label: 'Grids', items: [['line', 'Grid lines'], ['divider', 'Thick dividers'], ['headBg', 'Category header fill'], ['headFg', 'Category header text'], ['label', 'Item labels'], ['cell', 'Cell fill'], ['mark', 'Answer marks (keys and example)']] },
  tables: { label: 'Tables', items: [['border', 'Borders'], ['headBg', 'Header fill'], ['headFg', 'Header text'], ['text', 'Cell text'], ['stripe', 'Every other row']] },
  page: { label: 'Page', items: [['bg', 'Page background']] },
};
const VOL1_COLORS = {
  words: { text: '#000000', heading: '#000000', story: '#000000', clue: '#000000', rh: '#333333', accent: '#000000' },
  grids: { line: '#444444', divider: '#000000', headBg: '#e6e6e6', headFg: '#000000', label: '#000000', cell: '#ffffff', mark: '#000000' },
  tables: { border: '#000000', headBg: '#e6e6e6', headFg: '#000000', text: '#000000', stripe: '#ffffff' },
  page: { bg: '#ffffff' },
};
const tint = (main, soft) => ({
  words: { text: '#1a1a1a', heading: main, story: '#1a1a1a', clue: '#1a1a1a', rh: main, accent: main },
  grids: { line: '#7a7a7a', divider: main, headBg: soft, headFg: main, label: '#1a1a1a', cell: '#ffffff', mark: main },
  tables: { border: main, headBg: soft, headFg: main, text: '#1a1a1a', stripe: '#f6f6f6' },
  page: { bg: '#ffffff' },
});
export const COLOR_PRESETS = {
  vol1: ['Volume 1 (black and white)', VOL1_COLORS],
  purple: ['Logic Grid purple', tint('#5B3CC4', '#ece7fb')],
  ocean: ['Ocean', tint('#0b5d8c', '#e2f0f8')],
  forest: ['Forest', tint('#2f6b3a', '#e5f1e7')],
  sunset: ['Sunset', tint('#b3471c', '#fbe9de')],
  berry: ['Berry', tint('#9c1f5c', '#f8e4ee')],
};

// The engine's levels, easiest first. Volume 1 used Easy to Expert.
export const LEVELS = [['basic', 'Basic'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert'], ['mensa', 'Quantum Physicist'], ['theorist', 'Theoretical Physicist']];

const HOWTO_VOL1 = `Every puzzle in this book is a short story with a mystery to crack. A small cast of characters each has exactly one item from every category, and no two characters share an item. The clues tell you just enough to work out who has what. No guessing is ever needed: each puzzle has exactly one answer, and you can reach it by reasoning alone.

## The grid
Each small square of the grid compares two categories, such as people and pets. Every box where a row meets a column asks one question: do these two go together?
- **✕ means no.** When a clue rules a pairing out, put an ✕ in its box.
- **○ means yes.** When you know two things go together, put a circle in the box.
- **One circle per row and column.** As soon as you circle a box, put ✕ in every other box in that row and column of the same square.
- **The last box left.** If every box but one in a row or column has an ✕, the last one must be a circle.

## Carry facts across the grid
Facts link up between squares. If Ana has the dog, and the dog owner has the red collar, then Ana has the red collar. Likewise, if Ana has the dog but the dog owner does *not* live on Elm Street, then Ana does not live on Elm Street either. Checking these links often breaks a puzzle open.

## Kinds of clues
- **Direct:** “Ana owns the dog.” Circle it.
- **Not:** “Ben did not buy the kite.” Mark ✕.
- **Either / or:** “Ana arrived at 2:00 or 3:00.” Rule out every other time for Ana.
- **More / less:** “Ana is older than Ben.” Ana can’t be the youngest, and Ben can’t be the oldest.
- **Exact gap:** “Ana arrived 15 minutes after Ben.” Only some pairs of times fit.
- **One of each:** “Of Ana and Ben, one has the dog and the other has the cat.” Neither can have anything else in that category.
- **If / then:** “If Ana has the dog, then Ben has the cat.” Useful once you know whether the first part is true.

## When you’re done
Fill in the answer chart under each grid, answer the story questions, then check yourself with the answer keys starting on page {keys}.`;

// Volume 1 exactly as published, so "Reset" brings it back.
export const DEFAULTS = {
  version: 1,
  book: {
    brand: 'The Logic Grid', title: 'The Fantastical Logic Grid', subtitle: 'Puzzle Book', volume: 'Volume 1', tagline: '',
    author: 'Bobby Taylor', owner: 'Bobby Taylor', year: 2026, edition: 'First edition', website: 'thelogicgrid.com', imprint: '', isbn: '',
    allowCopies: true, trademarks: true, copyrightExtra: '',
  },
  format: { trim: '8.5x11', ink: 'bw', paper: 'white', bleed: false, margins: { inside: 0.85, outside: 0.6, top: 0.6, bottom: 0.75 }, pageNumbers: true, folio: 'outside' },
  puzzles: {
    counts: { basic: 0, easy: 8, medium: 12, hard: 12, expert: 8, mensa: 0, theorist: 0 },
    sizes: {}, // { tier: { categories, items } }; empty = the level's usual size
    themes: ['mystery', 'adventure', 'holiday', 'fantasy', 'scifi', 'sports', 'cooking', 'pets', 'town', 'parks', 'travel', 'wonders', 'music', 'nautical', 'farm', 'science', 'astronomy', 'paradox', 'seasons', 'occasion', 'action', 'biology'],
    topics: {}, // { theme: [topic ids] }; missing = any topic
    questions: 3, seed: 'book1', order: 'level', skipUsed: true, includeDrafts: false,
  },
  pages: {
    title: true, copyright: true, contents: true, howto: true, example: true, levels: true, thanks: true,
    layout: 'spread', story: true, questions: true, chart: true, runningHeads: true, levelDots: true,
    keys: 'end', keysPerPage: 2, keyGrid: false, keySteps: false, notesPages: 0,
    howtoText: HOWTO_VOL1,
    levelsIntro: 'The puzzles get harder as you go. Each level adds bigger grids and new kinds of clues, so the skills from one level carry you into the next.',
    levelsTip: 'Tip: a pencil and eraser are your best friends. Mark only what you are sure of.',
    thanksTitle: 'Thanks for solving!',
    thanksText: 'Found a puzzle you loved, or one that stumped you? We’d love to hear about it on the website.',
  },
  style: {
    fonts: { heading: 'Poppins', body: 'Caladea', grid: 'Poppins' },
    sizes: { body: 11, title: 20, grid: 8.5 },
    colors: VOL1_COLORS,
    pages: {}, // per page: { mode: 'bw' | 'custom', colors }
  },
  cover: {
    finish: 'matte', layout: 'band', guides: true,
    bg: '#2a1b6e', bg2: '#5B3CC4', gradient: true, titleColor: '#ffffff', textColor: '#ffffff', accent: '#ffd166',
    motif: 'grid', motifColor: '#ffffff', motifOpacity: 18,
    headingFont: 'Poppins', bodyFont: 'Caladea', titleSize: 54,
    image: '', imageFit: 'cover', imageOpacity: 100, imagePlace: 'front',
    front: { brand: '', title: '', subtitle: '', badge: '40 story logic puzzles', footer: 'Easy · Medium · Hard · Expert', author: '' },
    pageCount: 108,
    back: {
      heading: 'Crack the case, one clue at a time.',
      blurb: 'Every puzzle is a short story with a mystery to solve. Read the clues, mark the grid, and work out who did what, with no guessing needed. Each puzzle has exactly one answer.',
      bullets: '40 brand-new story logic puzzles\nFour levels, from Easy to Expert\nA how-to guide and a worked example\nFull answer keys at the back',
      footer: 'More puzzles at thelogicgrid.com', barcode: true,
    },
    spine: { show: true, text: '', bg: '', color: '#ffffff' },
  },
  listing: {
    description: '', keywords: ['logic puzzles for adults', 'logic grid puzzles', 'story puzzle book', 'brain teasers', 'deduction puzzles', 'puzzle book for teens', 'mystery puzzles'],
    categories: ['Games & Activities > Puzzles', 'Games & Activities > Logic & Brain Teasers', ''],
    language: 'English', price: 9.99, expanded: false, isbnChoice: 'free', adult: false,
    ai: { text: 'unsure', images: 'none', translations: 'none' }, marketplace: 'Amazon.com',
  },
};

export const defaults = () => clone(DEFAULTS);

// Fills in anything missing (older saved settings, hand-edited files).
export function normalize(s) {
  const d = defaults();
  const merge = (base, over) => {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k of Object.keys(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], over[k]) : over[k];
    return out;
  };
  return merge(d, s || {});
}

// ---------------------------------------------------------------- puzzle plan

// One job per puzzle, in book order. The worker turns each into a puzzle with
// the engine (books-worker.js: makeBookPuzzles), trying fresh seeds until the
// story is new and the title reads well.
export function puzzleJobs(s) {
  const themes = s.puzzles.themes.length ? s.puzzles.themes : DEFAULTS.puzzles.themes;
  const jobs = [];
  for (const [tier] of LEVELS) {
    for (let i = 0; i < (s.puzzles.counts[tier] || 0); i++) jobs.push({ tier, i, size: s.puzzles.sizes[tier] || null });
  }
  if (s.puzzles.order === 'mixed') {
    // A steady, seeded shuffle: the same seed always gives the same order.
    let h = 2166136261;
    for (const ch of s.puzzles.seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
    for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
  }
  return { jobs, themes };
}

// The same steps Volume 1 was made with. generatePuzzle is the engine's.
// used: { stories, fingerprints } already in books (GET /admin/v1/books/used),
// so no book ever prints a puzzle twice.
export function makeBookPuzzles(generatePuzzle, s, onProgress = () => {}, usedBefore = {}) {
  const { jobs, themes } = puzzleJobs(s);
  const used = [...(usedBefore.stories || [])];
  const usedPrints = new Set(usedBefore.fingerprints || []);
  const out = [];
  let t = 0;
  for (const job of jobs) {
    let p = null;
    for (let attempt = 0; attempt < 16 && !p; attempt++) {
      const theme = themes[(t + attempt) % themes.length];
      const pick = s.puzzles.topics[theme];
      const opts = { difficulty: job.tier, theme, seed: `${s.puzzles.seed}-${job.tier}-${job.i}-${attempt}`, usedStories: used, questions: s.puzzles.questions };
      if (pick && pick.length) opts.topic = pick[(t + attempt) % pick.length];
      if (job.size?.categories) opts.categories = job.size.categories;
      if (job.size?.items) opts.items = job.size.items;
      const q = generatePuzzle(opts);
      const words = q.title.toLowerCase().split(/\s+/);
      const custom = (q.notes || []).filter((n) => !n.startsWith('Custom size'));
      if (custom.length || out.some((x) => x.title === q.title) || new Set(words).size !== words.length || used.includes(q.story.id) || usedPrints.has(puzzleFingerprint(q))) continue;
      p = q;
    }
    if (!p) throw new Error(`Could not make puzzle ${out.length + 1} (${job.tier}): every story tried is already used. Choose more themes or topics, or another seed.`);
    used.push(p.story.id);
    t++;
    out.push(p);
    onProgress(out.length, jobs.length, p);
  }
  return out;
}

// A short, stable id for a puzzle's content: its categories, answers and clues.
export function puzzleFingerprint(p) {
  const text = [
    p.categories.map((c) => `${c.name}:${c.items.map((i) => i.label).join('/')}`).join('|'),
    p.answerKey.rows.map((r) => r.join('/')).sort().join('|'),
    p.clues.map((c) => c.text).join('|'),
  ].join('#').toLowerCase();
  let a = 0x811c9dc5; let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    a = Math.imul(a ^ ch, 16777619);
    b = Math.imul(b ^ ch, 2246822519) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

// What the books database keeps about each puzzle (server/src/books.js).
export function puzzleRecord(p, position) {
  return {
    position, storyId: p.story.id, fingerprint: puzzleFingerprint(p), title: p.title, theme: p.theme.id, topic: p.topic?.id || '', tier: p.difficulty.id,
    size: `${p.categories.length}x${p.categories[0].items.length}`, seed: String(p.seed ?? ''), engine: String(p.version ?? p.engine ?? ''),
    text: JSON.stringify({
      title: p.title, story: p.story.paragraphs, clues: p.clues.map((c) => c.text), questions: p.questions.map((q) => q.text),
      items: p.categories.flatMap((c) => [c.name, ...c.items.map((i) => i.label)]), ending: p.story.ending,
    }),
  };
}

export const examplePuzzle = (generatePuzzle) => generatePuzzle({ difficulty: 'basic', theme: 'pets', seed: 'howto102', categories: 3, items: 3 });

// ---------------------------------------------------------------- colors

const hexOk = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
export function toGray(hex) {
  if (!hexOk(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const y = Math.round(0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
  const h = y.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}
export const isGray = (hex) => !hexOk(hex) || toGray(hex).toLowerCase() === hex.toLowerCase();

// The colors a page really prints with: book colors, or the page's own, then
// gray when the page (or the whole book) is black and white.
export function pageColors(s, key) {
  const own = s.style.pages[key];
  const base = own?.mode === 'custom' && own.colors ? normalizeColors(own.colors, s.style.colors) : s.style.colors;
  const gray = s.format.ink === 'bw' || own?.mode === 'bw';
  const out = {};
  for (const [g, def] of Object.entries(ELEMENTS)) {
    out[g] = {};
    for (const [k] of def.items) out[g][k] = gray ? toGray(base[g]?.[k] || VOL1_COLORS[g][k]) : base[g]?.[k] || VOL1_COLORS[g][k];
  }
  return out;
}
function normalizeColors(c, fallback) {
  const out = {};
  for (const [g, def] of Object.entries(ELEMENTS)) { out[g] = {}; for (const [k] of def.items) out[g][k] = c?.[g]?.[k] || fallback[g][k]; }
  return out;
}
const colorVars = (c) => [
  ['--w-text', c.words.text], ['--w-head', c.words.heading], ['--w-story', c.words.story], ['--w-clue', c.words.clue], ['--w-rh', c.words.rh], ['--w-accent', c.words.accent],
  ['--g-line', c.grids.line], ['--g-div', c.grids.divider], ['--g-head-bg', c.grids.headBg], ['--g-head-fg', c.grids.headFg], ['--g-label', c.grids.label], ['--g-cell', c.grids.cell], ['--g-mark', c.grids.mark],
  ['--t-border', c.tables.border], ['--t-head-bg', c.tables.headBg], ['--t-head-fg', c.tables.headFg], ['--t-text', c.tables.text], ['--t-stripe', c.tables.stripe],
  ['--p-bg', c.page.bg],
].map(([k, v]) => `${k}:${v}`).join(';');
const usesColor = (c) => Object.values(c).some((g) => Object.values(g).some((v) => !isGray(v)));

// ---------------------------------------------------------------- page geometry

export function geometry(s) {
  const t = trimOf(s.format.trim);
  const bleed = s.format.bleed ? BLEED : 0;
  const m = s.format.margins;
  return { trim: t, bleed, pageW: t.w + bleed, pageH: t.h + bleed * 2, contentW: t.w - m.inside - m.outside, contentH: t.h - m.top - m.bottom, m };
}

// ---------------------------------------------------------------- pieces

function grid(p, { solved = false, maxW = 7, maxCell = 0.5, maxH = 99, labelPt = 8.5 } = {}) {
  const cats = p.categories;
  const cols = cats.slice(1);
  const rowCats = [cats[0], ...cats.slice(2).reverse()];
  const span = (rc) => (rc === cats[0] ? cols.length : cats.indexOf(rc) - 1);
  const N = cats[0].items.length;
  const k = labelPt / 8.5; // label size scales the label space
  const longRow = Math.max(...rowCats.flatMap((c) => c.items.map((i) => i.label.length)));
  const longCol = Math.max(...cols.flatMap((c) => c.items.map((i) => i.label.length)));
  const labelW = 0.2 + longRow * 0.075 * k;
  const headH = 0.2 + longCol * 0.075 * k;
  const cell = Math.max(0.16, Math.min(maxCell, (maxW - labelW - 0.32) / (cols.length * N), (maxH - headH - 0.3) / (rowCats.length * N)));
  const same = (a, b) => p.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b));
  const mark = (a, b) => (!solved ? '' : same(a, b) ? '<span class="bk-o"></span>' : '<span class="bk-x">✕</span>');
  const head = `<tr><td class="bk-corner" colspan="2" rowspan="2"></td>${cols.map((c) => `<th colspan="${N}" class="bk-cat">${esc(c.name)}</th>`).join('')}</tr>
<tr>${cols.map((c) => c.items.map((it, j) => `<th class="bk-item bk-colh${j === 0 ? ' bk-l' : ''}" data-css="height:${headH.toFixed(3)}in"><span>${esc(curly(it.label))}</span></th>`).join('')).join('')}</tr>`;
  const body = rowCats.map((rc) => rc.items.map((it, r) => `<tr${r === 0 ? ' class="bk-t"' : ''}>${r === 0 ? `<th rowspan="${N}" class="bk-cat bk-side"><span>${esc(rc.name)}</span></th>` : ''}<th class="bk-item bk-rowh" data-css="width:${labelW.toFixed(3)}in">${esc(curly(it.label))}</th>${cols.slice(0, span(rc)).map((c) => c.items.map((x, ci) => `<td${ci === 0 ? ' class="bk-l"' : ''}>${mark(it.id, x.id)}</td>`).join('')).join('')}</tr>`).join('')).join('');
  return `<table class="bk-grid" data-css="--cell:${cell.toFixed(3)}in">${head}${body}</table>`;
}

const chart = (p) => {
  const cats = p.categories;
  return `<table class="bk-table bk-chart"><tr>${cats.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>${cats[0].items.map((it) => `<tr><th>${esc(curly(it.label))}</th>${cats.slice(1).map(() => '<td></td>').join('')}</tr>`).join('')}</table>`;
};

// "What is Eli's sneakers?" reads badly in print; "Eli's sneakers:" always works.
export const fixQuestion = (q) => { const m = q.match(/^What is (.+?)'s (.+)\?$/); return m ? `${m[1]}’s ${m[2]}:` : curly(q); };

// Tiny markup for the editable texts: blank line = new paragraph, "## " heading,
// "- " list item, **bold**, *italic*.
export function markup(text, vars = {}) {
  const inline = (t) => esc(t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<ul class="bk-rules">${list.join('')}</ul>`); list = null; } };
  let para = [];
  const endPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { endPara(); flush(); continue; }
    if (line.startsWith('## ')) { endPara(); flush(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('- ')) { endPara(); (list ||= []).push(`<li>${inline(line.slice(2))}</li>`); continue; }
    flush();
    para.push(line);
  }
  endPara(); flush();
  return out.join('\n');
}

// ---------------------------------------------------------------- the interior

// Returns { pages: [{ key, kind, label, html, folio }], keysStart, levels }.
export function buildInterior(puzzles, example, sIn) {
  const s = normalize(sIn);
  const P = s.pages;
  const g = geometry(s);
  const B = s.book;
  const specs = []; // { key, kind, label, folio, render(ctx) }
  const add = (key, kind, label, render, folio = true) => specs.push({ key, kind, label, render, folio });

  const usedLevels = LEVELS.filter(([id]) => puzzles.some((p) => p.difficulty.id === id));
  const dotsOf = (p) => {
    if (!P.levelDots) return '';
    const n = usedLevels.findIndex(([id]) => id === p.difficulty.id) + 1;
    return `<span class="bk-dots">${'●'.repeat(n)}${'○'.repeat(usedLevels.length - n)}</span>`;
  };
  const levelName = (id) => (LEVELS.find((l) => l[0] === id) || [id, id])[1];
  const tagline = B.tagline || (puzzles.length ? `${puzzles.length} story logic puzzles<br>from ${esc(levelName(usedLevels[0][0]))} to ${esc(levelName(usedLevels[usedLevels.length - 1][0]))}` : '');

  if (P.title) {
    add('title', 'title', 'Title page', () => `<div class="bk-titlepage">
${B.brand ? `<div class="bk-brand">${esc(B.brand)}</div>` : ''}
<h1>${esc(B.title)}</h1>
<div class="bk-sub">${esc([B.subtitle, B.volume].filter(Boolean).join(' · '))}</div>
<div class="bk-rule"></div>
<p class="bk-tag">${B.tagline ? esc(B.tagline) : tagline}</p>
<div class="bk-foot">${esc(B.imprint || B.website)}</div></div>`, false);
  }
  if (P.copyright) {
    add('copyright', 'copyright', 'Copyright page', () => `<div class="bk-copyright">
<p><b>${esc(B.title)}${B.trademarks ? '™' : ''}</b><br>${esc([B.subtitle, B.volume].filter(Boolean).join(' · '))}</p>
<p>Copyright © ${esc(B.year)} ${esc(B.owner)}. All rights reserved.</p>
<p>No part of this book may be reproduced, stored or shared in any form without written permission from the copyright owner, except for brief quotations in reviews.${B.allowCopies ? ' The puzzles may be photocopied for the buyer’s own personal or classroom use.' : ''}</p>
${B.trademarks ? `<p>${esc(B.title)}™${B.brand ? ` and ${esc(B.brand)}™ are trademarks` : ' is a trademark'} of ${esc(B.owner)}.</p>` : ''}
${B.copyrightExtra ? markup(B.copyrightExtra) : ''}
${B.isbn ? `<p>ISBN ${esc(B.isbn)}</p>` : ''}
${B.imprint ? `<p>Published by ${esc(B.imprint)}</p>` : ''}
<p>${esc(B.edition)}${B.edition ? ', ' : ''}${esc(B.year)}</p>
${B.website ? `<p>${esc(B.website)}</p>` : ''}</div>`, false);
  }
  if (P.contents) {
    add('contents', 'contents', 'Contents', (c) => {
      const front = [['howto', 'How to solve a logic grid'], ['example', 'A worked example'], ['levels', 'The levels']].filter(([k]) => c.pageOf(k));
      const groups = s.puzzles.order === 'level' ? usedLevels.map(([id, name]) => [name, puzzles.map((p, i) => ({ p, i })).filter(({ p }) => p.difficulty.id === id)]) : [['Puzzles', puzzles.map((p, i) => ({ p, i }))]];
      return `<h1 class="bk-ph">Contents</h1>
${front.length ? `<ul class="bk-toc">${front.map(([k, t]) => `<li><span>${t}</span><b>${c.pageOf(k)}</b></li>`).join('')}</ul>` : ''}
<div class="bk-toc-cols">${groups.map(([name, list]) => `<div class="bk-toc-group"><h2>${esc(name)}</h2><ul class="bk-toc">${list.map(({ p, i }) => `<li><span>${i + 1}. ${esc(curly(p.title))}</span><b>${c.pageOf(`pz-${i + 1}-a`)}</b></li>`).join('')}</ul></div>`).join('')}</div>
${c.keysStart ? `<ul class="bk-toc"><li><span><b>Answer keys</b></span><b>${c.keysStart}</b></li></ul>` : ''}`;
    });
  }
  if (P.howto) add('howto', 'howto', 'How to solve', (c) => `<h1 class="bk-ph">How to solve a logic grid</h1>\n${markup(P.howtoText, { keys: c.keysStart || '' }).replace('<p>', '<p class="bk-lead">')}`);
  if (P.example && example) {
    add('example', 'example', 'Worked example', () => `<h1 class="bk-ph">A worked example</h1>
<h2 class="bk-ptitle2">${esc(curly(example.title))}</h2>
${example.story.paragraphs.map((t) => `<p>${esc(curly(t))}</p>`).join('')}
<h2>Clues</h2><ol class="bk-clues">${example.clues.map((x) => `<li>${esc(curly(x.text))}</li>`).join('')}</ol>
<p class="bk-hint">Try it yourself in the grid below, then turn the page for the full walkthrough.</p>
<div class="bk-gridwrap">${grid(example, { maxCell: 0.42, maxW: g.contentW - 0.05, maxH: Math.min(3.6, g.contentH * 0.38), labelPt: s.style.sizes.grid })}</div>`);
    add('walkthrough', 'example', 'Walkthrough', () => `<h1 class="bk-ph">Walkthrough</h1>
<ol class="bk-steps">${example.solvePath.map((x) => `<li><b>${esc(x.techniqueName)}.</b> ${esc(curly(x.explanation))}</li>`).join('')}</ol>
<div class="bk-gridwrap">${grid(example, { solved: true, maxCell: 0.32, maxW: Math.min(5, g.contentW - 0.05), maxH: g.contentH * 0.3, labelPt: s.style.sizes.grid })}</div>
<p><b>Answer:</b> ${esc(curly(example.story.ending.replace(/keys goes/, 'keys go')))}</p>`);
  }
  if (P.levels && usedLevels.length) {
    add('levels', 'levels', 'The levels', () => {
      let seen = new Set();
      let first = 1;
      const blocks = usedLevels.map(([id, name]) => {
        const list = puzzles.filter((p) => p.difficulty.id === id);
        const nums = puzzles.map((p, i) => (p.difficulty.id === id ? i + 1 : 0)).filter(Boolean);
        const sizes = [...new Set(list.map((p) => `${p.categories.length} categories of ${p.categories[0].items.length} items`))];
        const types = [...new Set(list.flatMap((p) => p.clues.map((c) => c.logic.type)))];
        const names = { is: 'direct', not: '“not”', neither: '“neither / nor”', either: '“either / or”', pairs: '“one of each”', allDiff: '“all different”', less: '“more / less”', diff: 'exact gaps', ifthen: '“if / then”' };
        const fresh = types.filter((t) => !seen.has(t));
        types.forEach((t) => seen.add(t));
        const clueText = first ? `Clues: ${types.map((t) => names[t] || t).join(', ')}.` : fresh.length ? `Adds ${fresh.map((t) => names[t] || t).join(', ')} clues.` : 'Longer chains of reasoning with the same kinds of clue.';
        first = 0;
        const range = s.puzzles.order === 'level' && nums.length ? ` · Puzzles ${nums[0]}–${nums[nums.length - 1]}` : '';
        return `<div class="bk-level"><h2>${P.levelDots ? `<span class="bk-dots">${'●'.repeat(usedLevels.findIndex((l) => l[0] === id) + 1)}${'○'.repeat(usedLevels.length - usedLevels.findIndex((l) => l[0] === id) - 1)}</span> ` : ''}${esc(name)}${range}</h2><p>${esc(sizes.join(' or '))}. ${clueText}</p></div>`;
      }).join('');
      return `<h1 class="bk-ph">The levels</h1><p class="bk-lead">${esc(P.levelsIntro)}</p>${blocks}${P.levelsTip ? `<p class="bk-hint">${esc(P.levelsTip)}</p>` : ''}${B.website ? `<div class="bk-want">Want more? Play free story logic puzzles at <b>${esc(B.website)}</b></div>` : ''}`;
    });
  }

  const spread = P.layout === 'spread';
  // A spread must open on a left (even) page: add a notes page when it would not.
  const fillTo = (wantEven) => { if (((specs.length + 1) % 2 === 0) !== wantEven) add(`fill-${specs.length + 1}`, 'notes', 'Notes', notesPage); };
  const notesPage = () => '<h1 class="bk-ph">Notes</h1><div class="bk-lines"></div>';

  const keyBlock = (p, i, c) => `<div class="bk-key"><h2>Puzzle ${i + 1} · ${esc(curly(p.title))} <span class="bk-pg">page ${c.pageOf(`pz-${i + 1}-a`)}</span></h2>
${P.keyGrid ? `<div class="bk-gridwrap bk-left">${grid(p, { solved: true, maxCell: 0.22, maxW: g.contentW - 0.05, maxH: 3.2, labelPt: s.style.sizes.grid * 0.9 })}</div>` : ''}
<table class="bk-table bk-sol"><tr>${p.answerKey.columns.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>${p.answerKey.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(curly(v))}</td>`).join('')}</tr>`).join('')}</table>
${P.questions ? `<ol class="bk-ans">${p.answerKey.questions.map((q) => `<li>${esc(fixQuestion(q.question))} <b>${esc(curly(q.answer))}</b></li>`).join('')}</ol>` : ''}
<p class="bk-ending">${esc(curly(p.story.ending))}</p>
${P.keySteps ? `<ol class="bk-steps">${p.solvePath.map((x) => `<li>${esc(curly(x.explanation))}</li>`).join('')}</ol>` : ''}</div>`;

  const rh = (l, r) => (P.runningHeads ? `<div class="bk-rh"><span>${l}</span><span>${r}</span></div>` : '');
  const cluesHtml = (p, n) => `${rh(`Puzzle ${n} · ${esc(p.difficulty.name)} ${dotsOf(p)}`, esc(`${p.theme.name}${p.topic?.name ? ` · ${p.topic.name}` : ''}`))}
<h1 class="bk-ptitle">${esc(curly(p.title))}</h1>
${P.story ? `<div class="bk-story">${p.story.paragraphs.map((t) => `<p>${esc(curly(t))}</p>`).join('')}</div>` : ''}
<h2>Clues</h2><ol class="bk-clues">${p.clues.map((c) => `<li>${esc(curly(c.text))}</li>`).join('')}</ol>
${P.questions ? `<h2>Questions</h2><ol class="bk-qs">${p.questions.map((q) => `<li>${esc(fixQuestion(q.text))} <span class="bk-line"></span></li>`).join('')}</ol>` : ''}`;
  const chartH = (p) => (P.chart ? (p.categories[0].items.length + 1) * 0.28 + 0.5 : 0);

  puzzles.forEach((p, i) => {
    const n = i + 1;
    if (spread) {
      if (i === 0 || P.keys === 'after') fillTo(true);
      add(`pz-${n}-a`, 'clues', `Puzzle ${n} clues`, () => cluesHtml(p, n));
      add(`pz-${n}-b`, 'grid', `Puzzle ${n} grid`, () => `${rh(esc(curly(p.title)), `Puzzle ${n}`)}
<div class="bk-gridwrap">${grid(p, { maxW: g.contentW - 0.05, maxH: g.contentH - (P.runningHeads ? 0.35 : 0) - 0.1 - chartH(p), labelPt: s.style.sizes.grid })}</div>
${P.chart ? `<h2>Your answers</h2>${chart(p)}` : ''}`);
    } else {
      add(`pz-${n}-a`, 'puzzle', `Puzzle ${n}`, () => `${cluesHtml(p, n)}
<div class="bk-gridwrap">${grid(p, { maxW: g.contentW - 0.05, maxH: g.contentH * 0.5, maxCell: 0.34, labelPt: s.style.sizes.grid })}</div>`);
    }
    if (P.keys === 'after') add(`key-${n}`, 'keys', `Answer key ${n}`, (c) => `${rh('Answer key', `Puzzle ${n}`)}${keyBlock(p, i, c)}`);
  });

  let keysStartKey = null;
  if (P.keys === 'end' && puzzles.length) {
    const per = Math.max(1, Math.min(4, Number(P.keysPerPage) || 2));
    for (let i = 0; i < puzzles.length; i += per) {
      const key = `keys-${i / per + 1}`;
      if (!keysStartKey) keysStartKey = key;
      const first = i === 0;
      add(key, 'keys', `Answer keys ${i + 1}–${Math.min(puzzles.length, i + per)}`, (c) => `${first ? '<h1 class="bk-ph">Answer keys</h1>' : rh('Answer keys', '')}${puzzles.slice(i, i + per).map((p, j) => keyBlock(p, i + j, c)).join('')}`);
    }
  } else if (P.keys === 'after' && puzzles.length) keysStartKey = 'key-1';

  for (let i = 0; i < (Number(P.notesPages) || 0); i++) add(`notes-${i + 1}`, 'notes', 'Notes', notesPage);
  const thanks = () => `<div class="bk-endpage">${B.brand ? `<div class="bk-brand">${esc(B.brand)}</div>` : ''}<h1>${esc(P.thanksTitle)}</h1>
${B.website ? `<p>Play more story logic puzzles free at</p><p class="bk-site">${esc(B.website)}</p>` : ''}<p class="bk-small">${esc(P.thanksText)}</p></div>`;
  // KDP prints on both sides; finish on an even page.
  if (P.thanks) { if ((specs.length + 1) % 2) add(`fill-${specs.length + 1}`, 'notes', 'Notes', notesPage); add('thanks', 'thanks', 'Thanks page', thanks, false); }
  if (specs.length % 2) add(`fill-${specs.length + 1}`, 'notes', 'Notes', notesPage);

  const index = Object.fromEntries(specs.map((x, i) => [x.key, i + 1]));
  const ctx = { pageOf: (k) => index[k] || '', keysStart: keysStartKey ? index[keysStartKey] : '' };
  const pages = specs.map((x, i) => {
    const n = i + 1;
    const colors = pageColors(s, x.key);
    return { key: x.key, kind: x.kind, label: x.label, n, color: usesColor(colors), html: x.render(ctx), folio: x.folio && s.format.pageNumbers, vars: colorVars(colors) };
  });
  return { pages, keysStart: ctx.keysStart, levels: usedLevels.map((l) => l[0]) };
}

// Book-wide CSS variables (page size, margins, fonts, sizes) for .bk-book.
export function bookVars(sIn) {
  const s = normalize(sIn);
  const g = geometry(s);
  const f = s.style.fonts;
  const z = s.style.sizes;
  return [
    `--pw:${g.pageW}in`, `--ph:${g.pageH}in`, `--bleed:${g.bleed}in`,
    `--m-in:${g.m.inside}in`, `--m-out:${g.m.outside + g.bleed}in`, `--m-top:${g.m.top + g.bleed}in`, `--m-bot:${g.m.bottom + g.bleed}in`,
    `--f-head:${fontStack(f.heading)}`, `--f-body:${fontStack(f.body)}`, `--f-grid:${fontStack(f.grid)}`,
    `--fs-body:${z.body}pt`, `--fs-title:${z.title}pt`, `--fs-grid:${z.grid}pt`,
  ].join(';');
}
export const bookClass = (sIn) => `bk-book${normalize(sIn).format.folio === 'center' ? ' bk-folio-center' : ''}`;

// One page as markup (inside a .bk-book).
export const pageMarkup = (p) => `<section class="bk-page ${p.n % 2 ? 'bk-odd' : 'bk-even'} bk-kind-${p.kind}" data-n="${p.n}" data-key="${esc(p.key)}" data-css="${esc(p.vars)}"><div class="bk-inner">${p.html}</div>${p.folio ? `<div class="bk-folio">${p.n}</div>` : ''}</section>`;

// The whole interior as markup inside one .bk-book element (no <html>).
export function interiorMarkup(built, sIn) {
  return `<div class="${bookClass(sIn)}" data-css="${esc(bookVars(sIn))}">\n${built.pages.map(pageMarkup).join('\n')}\n</div>`;
}

// Sets every data-css="--a:1;b:2" through the CSSOM. root: any element with querySelectorAll.
export function applyDataCss(root) {
  const els = [...(root.matches?.('[data-css]') ? [root] : []), ...root.querySelectorAll('[data-css]')];
  for (const el of els) {
    for (const decl of el.getAttribute('data-css').split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  }
}

// ---------------------------------------------------------------- KDP numbers

export const isLarge = (s) => trimOf(s.format.trim).large;
const inkPaper = (s) => `${s.format.ink}-${s.format.ink === 'bw' ? s.format.paper : 'white'}`;
export const spineWidth = (s, pages) => pages * (SPINE_PER_PAGE[inkPaper(s)] || SPINE_PER_PAGE['bw-white']);

// Amazon.com printing cost in USD, or null when it has to be checked in KDP.
export function printingCost(s, pages) {
  const r = PRINT_RATES[s.format.ink];
  const band = r && (isLarge(s) ? r.large : r.regular);
  if (!band) return null;
  if (pages <= r.flatTo) return band.flat;
  return Math.round((band.fixed + pages * band.perPage) * 100) / 100;
}
// 60% at $9.99 and up on Amazon.com, 50% below; Expanded Distribution 40%.
export function royalty(price, cost, expanded = false) {
  if (cost == null || !(price > 0)) return null;
  const rate = price >= 9.99 ? 0.6 : 0.5;
  const amazon = Math.round((price * rate - cost) * 100) / 100;
  const ext = expanded ? Math.round((price * 0.4 - cost) * 100) / 100 : null;
  return { rate, amazon, expanded: ext };
}
export function minimumPrice(cost, expanded = false) {
  if (cost == null) return null;
  const lo = Math.ceil((cost / 0.5) * 100) / 100;
  let min = lo < 9.99 ? lo : Math.max(9.99, Math.ceil((cost / 0.6) * 100) / 100);
  if (expanded) min = Math.max(min, Math.ceil((cost / 0.4) * 100) / 100);
  return min;
}
const insideMin = (pages) => (pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875);

// Plain-words checks: [{ level: 'ok' | 'warn' | 'bad', text }].
export function kdpChecks(sIn, built, extra = {}) {
  const s = normalize(sIn);
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const n = built.pages.length;
  const [lo, hi] = PAGE_RANGE[inkPaper(s)] || [24, 828];
  if (s.format.ink !== 'bw' && s.format.paper === 'cream') add('bad', 'Cream paper is only for black-and-white books. Choose white paper for color.');
  if (n < lo || n > hi) add('bad', `${INKS[s.format.ink]} books need ${lo} to ${hi} pages. This one has ${n}.`);
  else add('ok', `${n} pages (${INKS[s.format.ink]} allows ${lo} to ${hi}).`);
  if (n % 2) add('warn', 'The page count is odd; KDP will add a blank page at the end.');
  const m = s.format.margins;
  const outMin = s.format.bleed ? 0.375 : 0.25;
  if (m.inside < insideMin(n)) add('bad', `Inside margin must be at least ${insideMin(n)}" for ${n} pages (now ${m.inside}").`);
  for (const k of ['outside', 'top', 'bottom']) if (m[k] < outMin) add('bad', `The ${k} margin must be at least ${outMin}"${s.format.bleed ? ' with bleed' : ''} (now ${m[k]}").`);
  if (!out.some((x) => x.level === 'bad' && x.text.includes('margin'))) add('ok', 'Margins meet KDP’s minimums.');
  const colorPages = built.pages.filter((p) => p.color);
  if (s.format.ink === 'bw' && Object.values(s.style.pages).some((p) => p.mode === 'custom')) add('warn', 'Some pages have their own colors, but the book is black and white, so they print in gray. Choose a color ink to print them in color.');
  if (s.format.ink !== 'bw' && !colorPages.length) add('warn', 'This is a color book, but every page is black and white. A black-and-white book costs much less to print.');
  if (s.format.ink !== 'bw' && colorPages.length) add('ok', `${colorPages.length} of ${n} pages use color. KDP prints the whole book in ${INKS[s.format.ink].toLowerCase()} and charges the same for every page.`);
  if (!s.format.bleed && built.pages.some((p) => /--p-bg:(?!#ffffff)/i.test(p.vars))) add('warn', 'Some pages have a background color but bleed is off, so a thin white edge will show. Turn on bleed for full-page color.');
  if (s.book.isbn && !/^97[89]-?\d{1,5}-?\d+-?\d+-?\d$/.test(s.book.isbn) && s.book.isbn.replace(/\D/g, '').length !== 13) add('warn', 'The ISBN should have 13 digits. Leave it empty to use KDP’s free ISBN.');
  if (extra.overflow?.length) add('bad', `Text runs off ${extra.overflow.length === 1 ? 'page' : 'pages'} ${extra.overflow.join(', ')}. Use a smaller font, a larger trim size, or fewer keys per page.`);
  else if (extra.measured) add('ok', 'Everything fits on its page.');
  if (s.pages.howto && s.pages.howtoText === HOWTO_VOL1) add('warn', 'The “How to solve” text was drafted with AI. Rewrite it in your own words, or answer Yes for AI-generated text when you publish on KDP.');
  return out;
}

// ---------------------------------------------------------------- cover

// Full-wrap paperback cover: back, spine, front, with 0.125" bleed all round.
export function coverGeometry(sIn, pages) {
  const s = normalize(sIn);
  const t = trimOf(s.format.trim);
  const spine = spineWidth(s, pages);
  const w = BLEED * 2 + t.w * 2 + spine;
  const h = BLEED * 2 + t.h;
  // PDFs made by the browser have whole-point (1/72") page sizes, so the page
  // is rounded and the difference (under 1/144") goes into the outer bleed;
  // the trim lines and the spine stay exactly where KDP puts them.
  const pageW = Math.round(w * 72) / 72;
  const pageH = Math.round(h * 72) / 72;
  return { trim: t, spine, w, h, pageW, pageH, edgeX: (pageW - w) / 2, edgeY: (pageH - h) / 2, spineText: pages >= 80 };
}

// A light pattern of grid squares for the cover background.
function motif(kind) {
  if (kind === 'grid') {
    const cells = [];
    for (let r = 0; r < 13; r++) for (let c = 0; c < 20; c++) {
      const v = (r * 7 + c * 11) % 9;
      cells.push(`<span class="${v === 0 ? 'o' : v === 4 ? 'x' : ''}">${v === 4 ? '✕' : ''}</span>`);
    }
    return `<div class="cv-motif cv-motif-grid">${cells.join('')}</div>`;
  }
  if (kind === 'dots') return '<div class="cv-motif cv-motif-dots"></div>';
  return '';
}

export function coverMarkup(sIn, pages) {
  const s = normalize(sIn);
  const c = s.cover;
  const B = s.book;
  const g = coverGeometry(s, pages);
  const title = c.front.title || B.title;
  const subtitle = c.front.subtitle || [B.subtitle, B.volume].filter(Boolean).join(' · ');
  const brand = c.front.brand || B.brand;
  const spineText = c.spine.text || `${B.title}${B.volume ? ` · ${B.volume}` : ''}`;
  const bg = c.gradient ? `linear-gradient(160deg, ${c.bg} 0%, ${c.bg2} 100%)` : c.bg;
  const vars = [
    `--cw:${g.pageW.toFixed(5)}in`, `--chh:${g.pageH.toFixed(5)}in`, `--trim-w:${g.trim.w}in`, `--trim-h:${g.trim.h}in`, `--spine:${g.spine.toFixed(5)}in`,
    `--bleed:${(BLEED + g.edgeX).toFixed(5)}in`, `--bleed-y:${(BLEED + g.edgeY).toFixed(5)}in`,
    `--cv-bg:${bg}`, `--cv-title:${c.titleColor}`, `--cv-text:${c.textColor}`, `--cv-accent:${c.accent}`, `--cv-motif:${c.motifColor}`, `--cv-motif-op:${(c.motifOpacity / 100).toFixed(2)}`,
    `--cv-spine-bg:${c.spine.bg || 'transparent'}`, `--cv-spine-fg:${c.spine.color || c.textColor}`,
    `--cv-fh:${fontStack(c.headingFont)}`, `--cv-fb:${fontStack(c.bodyFont)}`, `--cv-ts:${c.titleSize}pt`, `--cv-img-op:${(c.imageOpacity / 100).toFixed(2)}`,
  ].join(';');
  const img = c.image ? `<img class="cv-img cv-img-${c.imagePlace} cv-fit-${c.imageFit}" src="${esc(c.image)}" alt="">` : '';
  const bullets = c.back.bullets.split('\n').map((x) => x.trim()).filter(Boolean);
  return `<div class="cv cv-layout-${esc(c.layout)}${c.guides ? ' cv-guides' : ''}" data-css="${esc(vars)}">
${c.imagePlace === 'full' ? img : ''}${motif(c.motif)}
<div class="cv-back"><div class="cv-safe">
${c.back.heading ? `<h2 class="cv-back-h">${esc(c.back.heading)}</h2>` : ''}
${c.back.blurb ? `<p class="cv-blurb">${esc(c.back.blurb)}</p>` : ''}
${bullets.length ? `<ul class="cv-bullets">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
${c.back.footer ? `<p class="cv-back-foot">${esc(c.back.footer)}</p>` : ''}
</div>${c.back.barcode ? '<div class="cv-barcode"><span>Barcode area<br>KDP adds this</span></div>' : ''}</div>
<div class="cv-spine">${c.spine.show && g.spineText ? `<div class="cv-spine-text"><b>${esc(spineText)}</b>${brand ? `<span>${esc(brand)}</span>` : ''}</div>` : ''}</div>
<div class="cv-front">${c.imagePlace === 'front' ? img : ''}<div class="cv-safe">
${brand ? `<div class="cv-brand">${esc(brand)}</div>` : ''}
<h1 class="cv-title">${esc(title)}</h1>
${subtitle ? `<div class="cv-sub">${esc(subtitle)}</div>` : ''}
${c.front.badge ? `<div class="cv-badge">${esc(c.front.badge)}</div>` : ''}
${c.front.footer ? `<div class="cv-front-foot">${esc(c.front.footer)}</div>` : ''}
${c.front.author ? `<div class="cv-author">${esc(c.front.author)}</div>` : ''}
</div></div>
<div class="cv-guide cv-guide-bleed"></div><div class="cv-guide cv-guide-spine"></div>
</div>`;
}

export function coverChecks(sIn, pages) {
  const s = normalize(sIn);
  const g = coverGeometry(s, pages);
  const out = [];
  out.push({ level: 'ok', text: `Cover size ${g.w.toFixed(3)}" × ${g.h.toFixed(3)}" (spine ${g.spine.toFixed(3)}" for ${pages} pages on ${s.format.ink === 'bw' ? s.format.paper : 'white'} paper).` });
  if (s.cover.spine.show && !g.spineText) out.push({ level: 'warn', text: 'KDP allows spine text only on books with more than 79 pages, so the spine is left plain.' });
  if (!s.cover.back.barcode) out.push({ level: 'warn', text: 'No barcode space: KDP needs a clear 2" × 1.2" box at the lower right of the back cover unless you print your own barcode.' });
  out.push({ level: 'ok', text: 'Covers always print in full color, whatever the interior ink.' });
  return out;
}
