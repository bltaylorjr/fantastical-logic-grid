// Book Studio. Built from book-studio/src by book-studio/build.mjs: do not edit here.
'use strict';
/* ---------- Publisher specifications ----------
   Aligned with the project's publisher-specs.json (compiled 2026-11-05) and the
   Puzzle Book Publishing Guide PDF. Values marked unverified there are safe defaults:
   always confirm the final cover size in the publisher's own calculator. */
const IN = 96; // CSS px per inch

const TRIMS = {};
[[4, 6], [4.25, 6.875], [4.25, 7], [4.37, 7], [5, 8], [5.06, 7.81], [5.2, 7.76], [5.25, 8], [5.25, 8.5], [5.5, 8.25], [5.5, 8.5], [5.83, 8.27],
 [6, 9], [6.14, 9.21], [6.63, 10.25], [6.69, 9.61], [7, 10], [7.44, 9.68], [7.44, 9.69], [7.5, 7.5], [7.5, 9.25], [8, 8], [8, 10], [8.25, 6], [8.25, 8.25],
 [8.25, 11], [8.27, 11.69], [8.5, 8.5], [8.5, 11], [9, 7], [11, 8.5], [11.69, 8.27]].forEach(([w, h]) => TRIMS[`${w}x${h}`] = [w, h]);
const TRIM_NAMES = { '8.27x11.69': 'A4', '5.83x8.27': 'A5', '11.69x8.27': 'A4 landscape', '6.14x9.21': 'Royal', '6x9': 'US Trade', '5.5x8.5': 'Digest', '8.5x11': 'US Letter', '5.2x7.76': 'Demy' };
const TRIM_LABEL = t => t.replace('x', ' × ') + ' in' + (TRIM_NAMES[t] ? ` (${TRIM_NAMES[t]})` : '');
const T = (...a) => a.map(s => s.replace(' ', ''));

function gutterFrom(table, pages) { for (const r of table) if (pages >= r.min && pages <= r.max) return r.inside; return table[table.length - 1].inside; }

const PUBLISHERS = {
  kdp: {
    name: 'Amazon KDP', short: 'KDP',
    trims: T('5x8', '5.06x7.81', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '6.69x9.61', '7x10', '7.44x9.69', '7.5x9.25', '8x10', '8.25x6', '8.25x8.25', '8.5x8.5', '8.5x11', '8.27x11.69'),
    defaultTrim: '8.5x11', minPages: 24, maxPages: 828, maxPagesFor: (trim, paper) => (paper === 'white' && (trim === '8.5x11' || trim === '8.5x8.5')) ? 590 : 828,
    bleedRule: 'outside', // page = trim w + 0.125, h + 0.25
    gutter: [{ min: 1, max: 150, inside: 0.375 }, { min: 151, max: 300, inside: 0.5 }, { min: 301, max: 500, inside: 0.625 }, { min: 501, max: 700, inside: 0.75 }, { min: 701, max: 9999, inside: 0.875 }],
    outside: { noBleed: 0.25, bleed: 0.375 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002347 },
    spineTextMinPages: 80, spineTextClearance: 0.0625, coverSafe: 0.125,
    barcode: { w: 2, h: 1.2, from: 0.25 },
    isbnRequired: false, evenPages: false, lastPageBlank: false, descMax: 4000, keywords: 7, categories: 3,
    notes: [
      'Upload the interior and the cover as separate PDFs. This app flattens fonts and images at the export resolution.',
      'KDP can assign a free ISBN (Amazon-only imprint), or you can use your own.',
      'Leave the barcode area on the back cover clear. KDP prints the barcode there.',
      'Spine text needs at least 80 pages.',
      'Puzzle minimums: text at least 7 pt, grid lines at least 0.75 pt, gray shading at least 10%.',
      '8.5 × 11 and 8.5 × 8.5 books on white paper top out at 590 pages.',
      'Order a printed proof before you publish.'
    ],
    links: { guide: 'https://kdp.amazon.com/en_US/help/topic/G201834240', cover: 'https://kdp.amazon.com/cover-calculator', submit: 'https://kdp.amazon.com/en_US/bookshelf' }
  },
  ingram: {
    name: 'IngramSpark', short: 'IngramSpark',
    trims: T('5x8', '5.5x8.5', '6x9', '6.14x9.21', '7x10', '8x10', '8.5x8.5', '8.5x11'),
    defaultTrim: '8.5x11', minPages: 24, maxPages: 1200,
    bleedRule: 'all', // trim + 0.125 on all four sides
    gutter: [{ min: 1, max: 150, inside: 0.375 }, { min: 151, max: 300, inside: 0.5 }, { min: 301, max: 500, inside: 0.625 }, { min: 501, max: 700, inside: 0.75 }, { min: 701, max: 9999, inside: 0.875 }],
    outside: { noBleed: 0.5, bleed: 0.5 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002252 },
    spineTextMinPages: 48, spineTextClearance: 0.0625, coverSafe: 0.25,
    barcode: { w: 1.5, h: 1.25, from: 0.25 },
    isbnRequired: true, evenPages: true, lastPageBlank: true, descMax: 4000, keywords: 7, categories: 3,
    notes: [
      'IngramSpark requires your own ISBN for each format (in the US, buy from Bowker).',
      'Interior must have an even page count and the last page must be blank.',
      'PDF/X-1a:2001 is recommended. Run the files through the upload validator and accept any conversion it offers.',
      'Generate the official cover template with your ISBN to confirm the exact spine width.',
      'Bleed goes on all four sides of each interior page.'
    ],
    links: { guide: 'https://www.ingramspark.com/plan-your-book/print/trim-sizes', submit: 'https://myaccount.ingramspark.com' }
  },
  lulu: {
    name: 'Lulu', short: 'Lulu',
    trims: T('4.25x6.875', '5x8', '5.5x8.5', '5.83x8.27', '6x9', '6.14x9.21', '6.63x10.25', '7x10', '7.44x9.68', '7.5x7.5', '8.27x11.69', '8.5x8.5', '8.5x11', '9x7', '11x8.5', '11.69x8.27'),
    defaultTrim: '8.5x11', minPages: 32, maxPages: 800,
    bleedRule: 'all',
    gutter: [{ min: 1, max: 60, inside: 0.5 }, { min: 61, max: 150, inside: 0.625 }, { min: 151, max: 400, inside: 1.0 }, { min: 401, max: 600, inside: 1.125 }, { min: 601, max: 9999, inside: 1.25 }],
    outside: { noBleed: 0.5, bleed: 0.5 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002252 },
    spineFormula: pages => pages / 444 + 0.06,
    spineTextMinPages: 81, spineTextClearance: 0.0625, coverSafe: 0.5,
    barcode: { w: 2, h: 1.2, from: 0.25 },
    isbnRequired: false, evenPages: false, lastPageBlank: false, descMax: 5000, keywords: 7, categories: 2,
    notes: [
      'Lulu needs a 0.5 in safety margin on every side for text and important art.',
      'Paperback perfect binding needs at least 32 pages. Coil and saddle-stitch bindings are also offered.',
      'Spine text needs at least 81 pages. Spine width is page count ÷ 444 + 0.06 in.',
      'Lulu can assign a free ISBN, or you can use your own.'
    ],
    links: { guide: 'https://www.lulu.com', submit: 'https://www.lulu.com/create' }
  },
  bn: {
    name: 'Barnes & Noble Press', short: 'B&N Press',
    trims: T('4x6', '4.25x7', '4.37x7', '5x8', '5.06x7.81', '5.25x8', '5.5x8.25', '5.5x8.5', '5.83x8.27', '6x9', '6.14x9.21', '7x10', '7.5x9.25', '8x8', '8x10', '8.25x11', '8.27x11.69', '8.5x8.5', '8.5x11', '11x8.5'),
    defaultTrim: '8.5x11', minPages: 18, maxPages: 800,
    bleedRule: 'outside',
    gutter: [{ min: 1, max: 150, inside: 0.375 }, { min: 151, max: 300, inside: 0.5 }, { min: 301, max: 500, inside: 0.625 }, { min: 501, max: 9999, inside: 0.75 }],
    outside: { noBleed: 0.5, bleed: 0.5 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002347 },
    spineTextMinPages: 80, spineTextClearance: 0.0625, coverSafe: 0.25,
    barcode: { w: 2, h: 1.2, from: 0.25 },
    isbnRequired: false, evenPages: false, lastPageBlank: false, descMax: 4000, keywords: 7, categories: 3,
    notes: [
      'B&N Press can provide a free ISBN for print books.',
      'Use the Quick Quote and cover tools in your B&N Press account to confirm spine width.',
      'Gutter and outside margins here are safe defaults; B&N does not publish exact numbers.'
    ],
    links: { guide: 'https://press.barnesandnoble.com', submit: 'https://press.barnesandnoble.com' }
  },
  d2d: {
    name: 'Draft2Digital Print', short: 'D2D Print',
    trims: T('5x8', '5.25x8.5', '5.5x8.5', '6x9', '7.5x9.25', '8.5x11'),
    defaultTrim: '8.5x11', minPages: 64, maxPages: 740,
    bleedRule: 'outside',
    gutter: [{ min: 1, max: 150, inside: 0.375 }, { min: 151, max: 300, inside: 0.5 }, { min: 301, max: 500, inside: 0.625 }, { min: 501, max: 9999, inside: 0.75 }],
    outside: { noBleed: 0.5, bleed: 0.5 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002252 },
    spineTextMinPages: 80, spineTextClearance: 0.0625, coverSafe: 0.25,
    barcode: { w: 2, h: 1.2, from: 0.25 },
    isbnRequired: false, evenPages: false, lastPageBlank: false, descMax: 4000, keywords: 7, categories: 3,
    notes: ['D2D Print is black-and-white paperback only and needs at least 64 pages.', 'D2D\'s print specs have not been updated recently; check them in your account before you upload.'],
    links: { guide: 'https://draft2digital.com', submit: 'https://draft2digital.com' }
  },
  bookvault: {
    name: 'Bookvault', short: 'Bookvault',
    trims: T('5.2x7.76', '5.83x8.27', '6.14x9.21', '8.27x11.69'),
    defaultTrim: '8.27x11.69', minPages: 24, maxPages: 800,
    bleedRule: 'all',
    gutter: [{ min: 1, max: 150, inside: 0.5 }, { min: 151, max: 300, inside: 0.625 }, { min: 301, max: 9999, inside: 0.75 }],
    outside: { noBleed: 0.5, bleed: 0.5 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002252 },
    spineTextMinPages: 80, spineTextClearance: 0.0625, coverSafe: 0.25,
    barcode: { w: 2, h: 1.2, from: 0.25 },
    isbnRequired: false, evenPages: false, lastPageBlank: false, descMax: 4000, keywords: 7, categories: 3,
    notes: ['Bookvault allows custom sizes and offers spiral, wire-O and saddle-stitch bindings.', 'Margins and page limits here are safe defaults; confirm them with Bookvault\'s quote tool.'],
    links: { guide: 'https://bookvault.app', submit: 'https://bookvault.app' }
  },
  custom: {
    name: 'Custom / other printer', short: 'Custom',
    trims: Object.keys(TRIMS), defaultTrim: '8.5x11', minPages: 1, maxPages: 2000,
    bleedRule: 'outside',
    gutter: [{ min: 1, max: 9999, inside: 0.5 }],
    outside: { noBleed: 0.5, bleed: 0.5 },
    papers: { white: 0.002252, cream: 0.0025, color: 0.002347 },
    spineTextMinPages: 80, spineTextClearance: 0.0625, coverSafe: 0.125,
    barcode: { w: 2, h: 1.2, from: 0.25 },
    isbnRequired: false, evenPages: false, lastPageBlank: false, descMax: 4000, keywords: 7, categories: 3,
    notes: ['Check your printer\'s specifications before submitting.'], links: {}
  }
};
// Shared print rules and helpers
for (const P of Object.values(PUBLISHERS)) {
  P.minFontPt = 7; P.minLinePt = 0.75; P.minGrayPct = 10; P.minDpi = 300;
  P.minMargins = (pages, bleed) => { const o = bleed ? P.outside.bleed : P.outside.noBleed; return { top: o, bottom: o, outside: o, inside: gutterFrom(P.gutter, pages) }; };
  // Recommended: at least the minimum, never tighter than 0.5 in so puzzles do not crowd the trim
  P.margins = (pages, bleed) => { const m = P.minMargins(pages, bleed); return { top: Math.max(m.top, 0.5), bottom: Math.max(m.bottom, 0.5), outside: Math.max(m.outside, 0.5), inside: Math.max(m.inside, 0.5) }; };
}

function spineWidth(pubKey, paper, pages) {
  const p = PUBLISHERS[pubKey];
  if (p.spineFormula) return p.spineFormula(pages);
  return pages * (p.papers[paper] || p.papers.white);
}

/* ---------- Utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtIn = v => (Math.round(v * 1000) / 1000).toFixed(3) + ' in';
const slug = s => (String(s || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book').slice(0, 60);

let toastTimer;
function toast(msg, ms = 3200) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
// The progress card. Long work that calls allowCancel() first gets a Cancel
// button; after it is pressed, the next busy() step throws { code: 'cancelled' }.
let busyEl, busyCanCancel = false, busyCancelled = false;
function allowCancel() { busyCanCancel = true; busyCancelled = false; }
function busy(label, frac) {
  if (label === false) { if (busyEl) busyEl.remove(); busyEl = null; busyCanCancel = false; busyCancelled = false; return; }
  if (busyCancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
  if (!busyEl) {
    busyEl = document.createElement('div'); busyEl.className = 'busy';
    busyEl.innerHTML = '<div class="busy-card"><b class="busy-label"></b><div class="progress"><div></div></div><small class="hint busy-sub"></small><button class="btn busy-cancel" type="button" hidden>Cancel</button></div>';
    document.body.appendChild(busyEl);
    const stop = $('.busy-cancel', busyEl);
    stop.onclick = () => { busyCancelled = true; stop.disabled = true; stop.textContent = 'Stopping…'; };
  }
  $('.busy-cancel', busyEl).hidden = !busyCanCancel;
  $('.busy-label', busyEl).textContent = label;
  $('.progress > div', busyEl).style.width = (frac == null ? 5 : Math.round(frac * 100)) + '%';
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

/* Lazy CDN loader (only allow-listed CDNs work inside the viewer) */
const LIBS = {
  fabric: { url: 'vendor/fabric.min.js', test: () => window.fabric },
  jspdf: { url: 'vendor/jspdf.umd.min.js', test: () => window.jspdf },
  html2canvas: { url: 'vendor/html2canvas.min.js', test: () => window.html2canvas },
  jszip: { url: 'vendor/jszip.min.js', test: () => window.JSZip },
  mammoth: { url: 'vendor/mammoth.browser.min.js', test: () => window.mammoth },
  pdfjs: { url: 'vendor/pdf.min.js', test: () => window.pdfjsLib },
  pdfworker: { url: 'vendor/pdf.worker.min.js', test: () => window.pdfjsWorker },
  pako: { url: 'vendor/pako.min.js', test: () => window.pako },
  utif: { url: 'vendor/UTIF.js', test: () => window.UTIF },
  marked: { url: 'vendor/marked.min.js', test: () => window.marked }
};
const libPromises = {};
function loadLib(name) {
  const L = LIBS[name];
  if (L.test()) return Promise.resolve();
  if (!libPromises[name]) libPromises[name] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = L.url; s.async = true;
    s.onload = () => res(); s.onerror = () => { delete libPromises[name]; rej(new Error('Could not load the ' + name + ' library. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return libPromises[name];
}
async function loadLibs(...names) { for (const n of names) await loadLib(n); }

/* File save: uses the viewer's download capability when hosted, a plain link otherwise */
async function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
  if (window.claude && typeof window.claude.use === 'function') {
    let d = null;
    try { d = await window.claude.use('downloads'); } catch (e) { d = null; }
    if (d) {
      try { await d.save({ filename, data: blob }); toast('Saved ' + filename); return true; }
      catch (e) {
        if (e && e.code === 'declined') { toast('Download canceled'); return false; }
        if (e && e.code === 'rate_limited') { toast('Another download is waiting for your answer'); return false; }
        if (e && e.code === 'rejected_extension') { toast('This file type cannot be downloaded here'); return false; }
      }
    }
  }
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    toast('Saved ' + filename); return true;
  } catch (e) { toast('Download is not available in this view'); return false; }
}

/* ---------- Fonts ---------- */
const BOOK_FONTS = ['Libre Baskerville', 'Merriweather', 'Lora', 'EB Garamond', 'Playfair Display', 'Roboto Slab', 'Open Sans', 'Nunito', 'Fredoka', 'Oswald', 'Bebas Neue', 'Patrick Hand', 'Permanent Marker', 'Courier Prime', 'Georgia', 'Arial', 'Times New Roman', 'Verdana'];
const fontStack = f => `"${f}", ${/Courier/.test(f) ? 'monospace' : /Sans|Nunito|Fredoka|Oswald|Bebas|Arial|Verdana|Hand|Marker/.test(f) ? 'sans-serif' : 'serif'}`;

/* ---------- State ---------- */
// Puzzle themes: each puzzle can carry a theme and a subcategory
// (data-pz-theme / data-pz-sub on the puzzle, so they sync with its page).
// The list itself is part of the book (S.puzzleThemes) and is editable;
// a new book starts with the list of the book that was open.
const DEFAULT_PUZZLE_THEMES = [
  { name: 'Holidays', subs: ['Christmas', 'Hanukkah', 'Kwanzaa', 'New Year', "Valentine's Day", "St. Patrick's Day", 'Easter', "Mother's Day", "Father's Day", 'Fourth of July', 'Halloween', 'Thanksgiving'] },
  { name: 'Seasons', subs: ['Spring', 'Summer', 'Fall', 'Winter'] },
  { name: 'Animals', subs: ['Pets', 'Farm animals', 'Wildlife', 'Ocean life', 'Birds', 'Insects', 'Dinosaurs'] },
  { name: 'Nature', subs: ['Gardens and flowers', 'Trees and forests', 'Weather', 'Mountains', 'Beaches'] },
  { name: 'Food and drink', subs: ['Baking', 'Fruits and vegetables', 'Desserts', 'World food', 'Coffee and tea'] },
  { name: 'Sports and games', subs: ['Football', 'Baseball', 'Basketball', 'Soccer', 'Golf', 'Olympics', 'Board games'] },
  { name: 'Travel and places', subs: ['USA', 'Europe', 'World cities', 'National parks', 'Landmarks'] },
  { name: 'Science and space', subs: ['Space and planets', 'Chemistry', 'Human body', 'Inventions', 'Technology'] },
  { name: 'History', subs: ['Ancient world', 'American history', 'Presidents', 'Famous people'] },
  { name: 'Arts and entertainment', subs: ['Movies', 'TV', 'Music', 'Books and authors', 'Art'] },
  { name: 'Mystery and adventure', subs: ['Detectives', 'Pirates', 'Treasure hunts', 'Spies'] },
  { name: 'Fantasy', subs: ['Dragons', 'Fairy tales', 'Magic', 'Mythology'] },
  { name: 'Faith', subs: ['Bible stories', 'Hymns', 'Saints'] },
  { name: 'Everyday life', subs: ['Home', 'School', 'Jobs', 'Transportation', 'Hobbies'] }
];
let themeSeed = null;
const puzzleThemes = () => (S && S.puzzleThemes) || DEFAULT_PUZZLE_THEMES;
function cloneThemes(list) {
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).forEach(t => {
    const name = String(t && t.name || '').trim().slice(0, 60); if (!name || seen.has(name.toLowerCase())) return; seen.add(name.toLowerCase());
    const subs = [], ss = new Set();
    (Array.isArray(t.subs) ? t.subs : []).forEach(x => { const v = String(x || '').trim().slice(0, 60); if (v && !ss.has(v.toLowerCase())) { ss.add(v.toLowerCase()); subs.push(v); } });
    out.push({ name, subs: subs.slice(0, 100) });
  });
  return out.slice(0, 200);
}

const DEFAULT_META = { title: '', subtitle: '', author: '', contributors: '', series: '', seriesNo: '', edition: 'First edition', imprint: '', isbn: '', pubDate: '', language: 'English', price: '', audience: 'Adult', copyright: '', description: '', blurb: '', keywords: '', categories: '' };
function blankProject() {
  return {
    version: 1, meta: { ...DEFAULT_META },
    pub: 'kdp', trim: '8.5x11', paper: 'white', ink: 'bw', bleed: false,
    margins: { top: 0.5, bottom: 0.5, inside: 0.5, outside: 0.5 },
    body: { font: 'Nunito', size: 12, lh: 1.35 },
    folio: { on: true, pos: 'outside', start: 3 },
    pages: [{ id: uid(), html: '<h1>Untitled puzzle book</h1><p>Start typing, import a manuscript, or use Puzzles to generate pages.</p>' }],
    counters: { sudoku: 0, wordsearch: 0, maze: 0 },
    cover: null, coverGeom: null, theme: 'navy',
    ...(themeSeed ? { puzzleThemes: cloneThemes(themeSeed) } : {})
  };
}
let S = blankProject();
let curPage = 0;

/* Geometry helpers */
function trimWH() { const t = TRIMS[S.trim] || [8.5, 11]; return { w: t[0], h: t[1] }; }
function bleedIn() { return S.bleed ? 0.125 : 0; }
function pageCount() { return S.pages.length; }
function spineIn() { return spineWidth(S.pub, S.paper, Math.max(pageCount(), 1)); }
function coverGeom() {
  const { w, h } = trimWH(); const b = 0.125; const sp = spineIn();
  return { w, h, b, sp, W: 2 * b + 2 * w + sp, H: 2 * b + h, backX: b, spineX: b + w, frontX: b + w + sp };
}

/* ---------- Persistence (IndexedDB, falls back silently) ---------- */
const DB_NAME = 'puzzle-book-studio', STORE = 'projects';
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function idbPut(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return true; } catch (e) { return false; } }
async function idbGet(key) { try { const db = await idb(); return await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; } }

let saveTimer;
function markDirty() {
  $('#sbSave').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState();
    const snap = JSON.stringify(S);
    const ok = await idbPut('current', JSON.parse(snap));
    $('#sbSave').textContent = ok ? 'Saved in this browser' : 'Not saved: browser storage is unavailable. Save a project file.';
    // Grid Admin build: also sync the book to the account (sync.js).
    if (typeof syChanged === 'function') syChanged(snap);
  }, 1200);
}

/* ---------- Interior editor ---------- */
let zoom = 0.75, savedRange = null, selImg = null, selPuzzle = null;
let undoStack = [], lastStructAt = 0, lastTypeAt = 0;

function snapshot(label) {
  syncPagesFromDom();
  undoStack.push({ label, pages: JSON.parse(JSON.stringify(S.pages)), cur: curPage, at: Date.now() });
  if (undoStack.length > 25) undoStack.shift();
  lastStructAt = Date.now();
}
function undoStructural() {
  const h = undoStack.pop(); if (!h) return false;
  S.pages = h.pages; curPage = Math.min(h.cur, S.pages.length - 1); renderPages(); refreshAll(); toast('Undid: ' + h.label); return true;
}

function contentEls() { return $$('#pages .page .content'); }
function pageEl(i) { return $$('#pages .page')[i]; }
function isOverflow(c) { return c.scrollHeight > c.clientHeight + 2; }

function syncPagesFromDom() {
  const cs = contentEls();
  if (cs.length !== S.pages.length) return;
  cs.forEach((c, i) => {
    $$('.sel', c).forEach(e => e.classList.remove('sel'));
    // A Grid book block's shrink-to-fit scale is redone on every screen and export
    // (fitGridBlocks); saving it made a just-opened book look changed and sync again.
    S.pages[i].html = c.innerHTML.replace(/(<div class="grid-block" contenteditable="false") style="[^"]*"/g, '$1');
  });
}

function pageGeomPx(i) {
  const { w, h } = trimWH(); const m = S.margins; const recto = i % 2 === 0;
  return {
    w: w * IN, h: h * IN, top: m.top * IN, bottom: m.bottom * IN,
    left: (recto ? m.inside : m.outside) * IN, right: (recto ? m.outside : m.inside) * IN, recto
  };
}

function bleedInsideIn() { return S.bleed && PUBLISHERS[S.pub].bleedRule === 'all' ? 0.125 : 0; }
function placeBleed(el, recto, b) {
  const bi = bleedInsideIn() * IN;
  el.style.top = -b + 'px'; el.style.bottom = -b + 'px';
  if (recto) { el.style.left = -bi + 'px'; el.style.right = -b + 'px'; } else { el.style.left = -b + 'px'; el.style.right = -bi + 'px'; }
}
function buildPageNode(i, forExport) {
  const p = S.pages[i]; const g = pageGeomPx(i); const b = bleedIn() * IN;
  const el = document.createElement('div');
  el.className = 'page' + (g.recto ? ' recto' : ' verso');
  el.dataset.id = p.id;
  el.style.width = g.w + 'px'; el.style.height = g.h + 'px';
  // Background (extends into bleed on the outside, top and bottom edges)
  if (p.bg) {
    const bg = document.createElement('div'); bg.className = 'page-bg';
    placeBleed(bg, g.recto, b);
    bg.style.backgroundImage = `url("${p.bg}")`;
    el.appendChild(bg);
  }
  if (!forExport) {
    if (S.bleed) {
      const bl = document.createElement('div'); bl.className = 'bleedline';
      placeBleed(bl, g.recto, b);
      el.appendChild(bl);
    }
    const sl = document.createElement('div'); sl.className = 'safeline';
    Object.assign(sl.style, { top: g.top + 'px', bottom: g.bottom + 'px', left: g.left + 'px', right: g.right + 'px' });
    el.appendChild(sl);
    const tag = document.createElement('div'); tag.className = 'tag';
    tag.innerHTML = `<span>Page ${i + 1} · ${g.recto ? 'right' : 'left'}</span><span class="of" hidden>Content overflows: use Reflow</span>`;
    el.appendChild(tag);
  }
  const c = document.createElement('div'); c.className = 'content';
  if (!forExport) { c.contentEditable = 'true'; c.spellcheck = true; }
  Object.assign(c.style, { top: g.top + 'px', bottom: g.bottom + 'px', left: g.left + 'px', right: g.right + 'px' });
  c.innerHTML = p.html;
  el.appendChild(c);
  const num = i + 1;
  if (S.folio.on && num >= S.folio.start && !p.noFolio) {
    const f = document.createElement('div'); f.className = 'folio'; f.textContent = num;
    f.style.bottom = Math.max(g.bottom / 2 - 8, 8) + 'px';
    if (S.folio.pos === 'center') { f.style.left = '0'; f.style.right = '0'; f.style.textAlign = 'center'; }
    else if (g.recto) { f.style.right = g.right + 'px'; } else { f.style.left = g.left + 'px'; }
    el.appendChild(f);
  }
  // A player's puzzle (playerpuzzles.js): "Puzzle by <screen name>" at the foot
  // of the page, when it is on for this puzzle and for the book.
  const credit = pageCredit(p);
  if (credit) {
    const c = document.createElement('div'); c.className = 'page-credit'; c.textContent = credit;
    c.style.bottom = Math.max(g.bottom / 2 - 8, 8) + 'px';
    // Opposite the page number: centered, or on the outside edge when the number is centered.
    if (S.folio.on && S.folio.pos === 'center') { if (g.recto) c.style.right = g.right + 'px'; else c.style.left = g.left + 'px'; }
    else { c.style.left = g.left + 'px'; c.style.right = g.right + 'px'; c.style.textAlign = 'center'; }
    el.appendChild(c);
  }
  return el;
}
function pageCredit(p) {
  if (!p || !p.player || !p.player.credit || p.player.show === false || S.playerCredits === false) return '';
  return 'Puzzle by ' + String(p.player.credit).slice(0, 60);
}

function applyBookVars(root) {
  root.style.setProperty('--book-font', fontStack(S.body.font));
  root.style.setProperty('--book-size', S.body.size + 'pt');
  root.style.setProperty('--book-lh', S.body.lh);
}

function renderPages() {
  const host = $('#pages'); host.innerHTML = '';
  applyBookVars(host); applyGridCss();
  host.style.zoom = zoom;
  S.pages.forEach((p, i) => host.appendChild(buildPageNode(i)));
  setActivePage(clamp(curPage, 0, S.pages.length - 1), false);
  requestAnimationFrame(checkAllOverflow);
  renderPageList();
}

function checkAllOverflow() { fitGridBlocks($('#pages')); $$('#pages .page').forEach(checkPageOverflow); renderPageList(); }
function checkPageOverflow(pg) {
  const c = $('.content', pg); if (!c) return false;
  const o = isOverflow(c); pg.classList.toggle('overflow', o);
  const of = $('.tag .of', pg); if (of) of.hidden = !o;
  return o;
}

function pageLabel(p) {
  const d = document.createElement('div'); d.innerHTML = p.html;
  const h = d.querySelector('h1,h2,h3'); const pz = d.querySelector('.puzzle');
  if (h && h.textContent.trim()) return h.textContent.trim();
  if (pz) return pz.dataset.kind === 'sudoku' ? 'Sudoku' : pz.dataset.kind === 'wordsearch' ? 'Word search' : 'Maze';
  if (d.querySelector('img')) return 'Image';
  const t = d.textContent.trim(); return t ? t.slice(0, 40) : 'Blank';
}
function renderPageList() {
  const list = $('#pagelist'); const pgs = $$('#pages .page');
  list.innerHTML = `<div class="pagelist-head"><span>${S.pages.length} pages</span><button class="btn ghost" id="plAdd" title="Add page">+ Add</button></div>`;
  S.pages.forEach((p, i) => {
    const it = document.createElement('div'); it.className = 'pl-item' + (i === curPage ? ' active' : ''); it.tabIndex = 0;
    const lines = Math.min(6, Math.ceil((p.html || '').length / 200));
    const thumb = `<div class="pl-thumb">${Array.from({ length: lines }, (_, k) => `<i style="top:${7 + k * 6}px"></i>`).join('')}</div>`;
    const of = pgs[i] && pgs[i].classList.contains('overflow');
    it.innerHTML = `${thumb}<div class="pl-meta"><b>${i + 1}</b><span>${esc(pageLabel(p))}</span></div>${of ? '<i class="pl-flag" title="Overflowing"></i>' : ''}`;
    it.onclick = () => { setActivePage(i, true); };
    it.onkeydown = e => { if (e.key === 'Enter') setActivePage(i, true); };
    list.appendChild(it);
  });
  $('#plAdd').onclick = () => addPageAfter(curPage);
}

// The author credit switches show only on a player's puzzle page.
function refreshCreditTools() {
  const box = $('#pgCreditBox'); if (!box) return;
  const p = S.pages[curPage]; const pl = p && p.player;
  box.hidden = !pl;
  if (!pl) return;
  $('#pgCredit').checked = !!pl.credit && pl.show !== false; $('#pgCredit').disabled = !pl.credit;
  $('#pgCreditBook').checked = S.playerCredits !== false;
  $('#pgCreditName').textContent = pl.credit ? `“Puzzle by ${pl.credit}” at the foot of the page.` : 'The author chose to stay anonymous, so this puzzle has no credit.';
}
function setActivePage(i, scroll) {
  curPage = clamp(i, 0, S.pages.length - 1);
  $$('#pages .page').forEach((p, k) => p.classList.toggle('active', k === curPage));
  $$('#pagelist .pl-item').forEach((p, k) => p.classList.toggle('active', k === curPage));
  const p = S.pages[curPage]; if (p) $('#pgNoFolio').checked = !!p.noFolio;
  refreshCreditTools();
  if (scroll) { const el = pageEl(curPage); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}

function addPageAfter(i, html = '<p><br></p>', extra = {}) {
  snapshot('add page'); syncPagesFromDom();
  S.pages.splice(i + 1, 0, { id: uid(), html, ...extra });
  curPage = i + 1; renderPages(); setActivePage(curPage, true); refreshAll(); markDirty();
}

/* Reflow: move overflowing blocks onto the next page of the same text flow, adding pages as needed */
function splitTextBlock(el, c) {
  // Split a text-only block so that the first part fits. Returns the remainder element or null.
  if (![...el.childNodes].every(n => n.nodeType === 3 || (n.nodeType === 1 && ['B', 'I', 'EM', 'STRONG', 'SPAN', 'U', 'BR'].includes(n.tagName) && !n.children.length))) return null;
  const words = el.textContent.split(/(\s+)/);
  if (words.length < 6) return null;
  const orig = el.innerHTML;
  let lo = 0, hi = words.length, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.textContent = words.slice(0, mid).join('');
    if (!isOverflow(c)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 2) { el.innerHTML = orig; return null; }
  el.textContent = words.slice(0, best).join('').trimEnd();
  const rest = el.cloneNode(false); rest.textContent = words.slice(best).join('').trimStart();
  return rest;
}

function reflow(fromIdx = 0, quiet = false) {
  syncPagesFromDom();
  let added = 0, guard = 0;
  for (let i = fromIdx; i < S.pages.length && guard < 4000; i++, guard++) {
    const pg = pageEl(i); if (!pg) break;
    const c = $('.content', pg);
    if (!isOverflow(c)) continue;
    const moved = [];
    while (isOverflow(c) && c.childNodes.length > 1) {
      const last = c.lastChild; moved.unshift(last); last.remove();
      if (!isOverflow(c)) {
        // try to put back part of a long paragraph
        c.appendChild(last); moved.shift();
        const rest = splitTextBlock(last, c);
        if (rest) { moved.unshift(rest); } else { last.remove(); moved.unshift(last); }
        break;
      }
    }
    if (c.childNodes.length === 1 && isOverflow(c) && !moved.length) {
      const rest = splitTextBlock(c.firstChild, c); if (rest) moved.unshift(rest);
    }
    if (!moved.length) continue;
    S.pages[i].html = c.innerHTML;
    const flow = S.pages[i].flow || (S.pages[i].flow = uid());
    let next = S.pages[i + 1];
    if (!next || next.flow !== flow) {
      next = { id: uid(), html: '', flow };
      S.pages.splice(i + 1, 0, next); added++;
      const node = buildPageNode(i + 1); pg.after(node);
      // re-render geometry for following pages (recto/verso swap)
    }
    const nc = $('.content', pageEl(i + 1));
    const frag = document.createDocumentFragment(); moved.forEach(n => frag.appendChild(n));
    nc.insertBefore(frag, nc.firstChild);
    S.pages[i + 1].html = nc.innerHTML;
  }
  syncPagesFromDom();
  renderPages(); refreshAll(); markDirty();
  if (!quiet) toast(added ? `Reflowed text onto ${added} new page${added > 1 ? 's' : ''}` : 'Pages reflowed');
  return added;
}

/* ---------- Toolbar ---------- */
function saveSel() {
  const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); const c = r.commonAncestorContainer;
  const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
  if (host) savedRange = r.cloneRange();
}
function restoreSel() {
  if (!savedRange) return false;
  const c = savedRange.commonAncestorContainer; const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
  if (!host || !document.contains(host)) { savedRange = null; return false; }
  host.focus({ preventScroll: true });
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); return true;
}
function currentContent() { return $('.content', pageEl(curPage)); }
function insertHTMLAtCursor(html) {
  if (!restoreSel()) {
    const c = currentContent(); c.focus({ preventScroll: true });
    const r = document.createRange(); r.selectNodeContents(c); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  document.execCommand('insertHTML', false, html);
  afterEdit();
}
function exec(cmd, val = null) {
  if (cmd === 'undo' && lastStructAt > lastTypeAt && undoStack.length) { undoStructural(); return; }
  restoreSel();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, val);
  afterEdit();
}
function afterEdit() {
  lastTypeAt = Date.now();
  const pg = pageEl(curPage); if (pg) checkPageOverflow(pg);
  markDirty(); updateToolbarState();
}
function updateToolbarState() {
  ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'].forEach(c => {
    const b = $(`.tb[data-cmd="${c}"]`); if (b) { let on = false; try { on = document.queryCommandState(c); } catch (e) { } b.classList.toggle('on', on); }
  });
}
function applyFontSizePt(pt) {
  restoreSel(); document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '7');
  const c = currentContent();
  $$('#pages .content span, #pages .content font').forEach(el => {
    if (el.style.fontSize === 'xxx-large' || el.style.fontSize === '-webkit-xxx-large' || el.getAttribute('size') === '7') {
      el.removeAttribute('size'); el.style.fontSize = pt + 'pt';
    }
  });
  afterEdit();
}
function applyLineHeight(v) {
  restoreSel(); const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); const c = currentContent();
  [...c.children].filter(ch => r.intersectsNode(ch)).forEach(ch => ch.style.lineHeight = v);
  afterEdit();
}

function wireEditor() {
  const fam = $('#fontFam'), bf = $('#bodyFont');
  fam.innerHTML = '<option value="">Font</option>' + BOOK_FONTS.map(f => `<option value="${f}" style="font-family:${fontStack(f).replace(/"/g, "'")}">${f}</option>`).join('');
  bf.innerHTML = BOOK_FONTS.map(f => `<option value="${f}">${f}</option>`).join('');
  $('#fontSize').innerHTML = '<option value="">Size</option>' + [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72].map(s => `<option value="${s}">${s} pt</option>`).join('');

  $('#tb').addEventListener('mousedown', e => { if (e.target.closest('.tb') && !e.target.closest('input')) e.preventDefault(); });
  $$('.tb[data-cmd]').forEach(b => b.onclick = () => exec(b.dataset.cmd));
  fam.onchange = () => { if (fam.value) exec('fontName', fam.value); fam.value = ''; };
  $('#fontSize').onchange = e => { if (e.target.value) applyFontSizePt(+e.target.value); e.target.value = ''; };
  $('#blockFmt').onchange = e => { exec('formatBlock', e.target.value); };
  $('#lineH').onchange = e => { if (e.target.value) applyLineHeight(e.target.value); e.target.value = ''; };
  $('#foreColor').oninput = e => exec('foreColor', e.target.value);
  $('#hiliteColor').oninput = e => exec('hiliteColor', e.target.value);

  document.addEventListener('selectionchange', () => { saveSel(); updateToolbarState(); });
  const pagesEl = $('#pages');
  pagesEl.addEventListener('focusin', e => { const pg = e.target.closest('.page'); if (pg) setActivePage($$('#pages .page').indexOf(pg), false); });
  pagesEl.addEventListener('mousedown', e => { const pg = e.target.closest('.page'); if (pg) { const i = $$('#pages .page').indexOf(pg); if (i !== curPage) setActivePage(i, false); } });
  pagesEl.addEventListener('input', e => { lastTypeAt = Date.now(); const pg = e.target.closest('.page'); if (pg) checkPageOverflow(pg); markDirty(); });
  pagesEl.addEventListener('click', e => {
    $$('#pages .sel').forEach(x => x.classList.remove('sel'));
    selImg = null; selPuzzle = null;
    const img = e.target.closest('.content img'); const pz = e.target.closest('.content .puzzle') || e.target.closest('.content .grid-room');
    if (pz) { selPuzzle = pz; pz.classList.add('sel'); }
    else if (img) { selImg = img; img.classList.add('sel'); }
    showSelTools();
  });
  pagesEl.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && ((selPuzzle && selPuzzle.classList.contains('puzzle')) || selImg) && document.activeElement.closest('.content')) {
      e.preventDefault(); (selPuzzle || selImg).remove(); selPuzzle = selImg = null; showSelTools(); afterEdit();
    }
  });
  pagesEl.addEventListener('paste', e => {
    // Images pasted from the clipboard go in as data URLs; HTML is cleaned.
    const items = [...(e.clipboardData?.items || [])];
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault(); const f = imgItem.getAsFile();
      fileToDataURL(f).then(u => insertHTMLAtCursor(`<img src="${u}" alt="">`));
      return;
    }
    const html = e.clipboardData?.getData('text/html');
    if (html) { e.preventDefault(); insertHTMLAtCursor(sanitizeHTML(html)); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !$('#view-manuscript').hidden) { e.preventDefault(); openDlg('#dlgFind'); $('#findQ').focus(); }
  });

  $('#zoom').onchange = e => { zoom = +e.target.value; $('#pages').style.zoom = zoom; };
  $('#guidesBtn').onclick = () => { $('#desk').classList.toggle('hide-guides'); $('#guidesBtn').classList.toggle('on', !$('#desk').classList.contains('hide-guides')); };
  $('#guidesBtn').classList.add('on');
  $('#inspToggle').onclick = () => $('#workspace').classList.toggle('show-insp');
  $('#addPage').onclick = () => addPageAfter(curPage);
  $('#reflowBtn').onclick = () => { snapshot('reflow'); reflow(0); };
  $('#pgDup').onclick = () => { syncPagesFromDom(); const p = S.pages[curPage]; addPageAfter(curPage, p.html, { bg: p.bg, noFolio: p.noFolio }); };
  $('#pgDel').onclick = () => {
    if (S.pages.length <= 1) { toast('A book needs at least one page'); return; }
    snapshot('delete page'); S.pages.splice(curPage, 1); curPage = Math.max(0, curPage - 1); renderPages(); refreshAll(); markDirty();
    toast('Page deleted. Use Undo to bring it back.');
  };
  $('#pgUp').onclick = () => movePage(-1); $('#pgDown').onclick = () => movePage(1);
  $('#pgNoFolio').onchange = e => { syncPagesFromDom(); S.pages[curPage].noFolio = e.target.checked; renderPages(); markDirty(); };
  $('#pgBgImg').onclick = () => pickImage(async u => { syncPagesFromDom(); S.pages[curPage].bg = u; renderPages(); markDirty(); });
  $('#pgBgClear').onclick = () => { syncPagesFromDom(); delete S.pages[curPage].bg; renderPages(); markDirty(); };
  $('#insImage').onclick = () => pickImage(u => insertHTMLAtCursor(`<img src="${u}" alt="">`));
  $('#insTable').onclick = () => openDlg('#dlgTable');
  $('#tblGo').onclick = () => {
    const r = clamp(+$('#tblRows').value || 1, 1, 40), c = clamp(+$('#tblCols').value || 1, 1, 40), sq = $('#tblSquare').checked;
    const cw = sq ? `width:${Math.min(0.5, 5.5 / c).toFixed(3)}in;height:${Math.min(0.5, 5.5 / c).toFixed(3)}in;` : 'min-width:0.6in;';
    const html = `<table>${Array.from({ length: r }, () => `<tr>${Array.from({ length: c }, () => `<td style="${cw}">&nbsp;</td>`).join('')}</tr>`).join('')}</table><p><br></p>`;
    closeDlg('#dlgTable'); insertHTMLAtCursor(html);
  };

  // Inspector: margins, body text, folios
  const mIds = { mTop: 'top', mBottom: 'bottom', mInside: 'inside', mOutside: 'outside' };
  Object.entries(mIds).forEach(([id, k]) => $('#' + id).onchange = e => { syncPagesFromDom(); S.margins[k] = Math.max(0, +e.target.value || 0); renderPages(); refreshAll(); markDirty(); });
  $('#bodyFont').onchange = e => { S.body.font = e.target.value; applyBookVars($('#pages')); requestAnimationFrame(checkAllOverflow); markDirty(); };
  $('#bodySize').onchange = e => { S.body.size = clamp(+e.target.value || 12, 6, 36); applyBookVars($('#pages')); requestAnimationFrame(checkAllOverflow); markDirty(); };
  $('#bodyLh').onchange = e => { S.body.lh = clamp(+e.target.value || 1.3, 1, 3); applyBookVars($('#pages')); requestAnimationFrame(checkAllOverflow); markDirty(); };
  // Author credit on a player's puzzle page (playerpuzzles.js).
  $('#pgCredit').onchange = e => {
    syncPagesFromDom(); const p = S.pages[curPage]; if (!p || !p.player) return;
    // Every page of the same puzzle follows (a puzzle can take two pages).
    S.pages.forEach(q => { if (q.player && q.player.id === p.player.id) q.player.show = e.target.checked; });
    renderPages(); markDirty();
  };
  $('#pgCreditBook').onchange = e => { syncPagesFromDom(); S.playerCredits = e.target.checked; renderPages(); markDirty(); };
  $('#folioOn').onchange = e => { syncPagesFromDom(); S.folio.on = e.target.checked; renderPages(); markDirty(); };
  $('#folioPos').onchange = e => { syncPagesFromDom(); S.folio.pos = e.target.value; renderPages(); markDirty(); };
  $('#folioStart').onchange = e => { syncPagesFromDom(); S.folio.start = Math.max(1, +e.target.value || 1); renderPages(); markDirty(); };

  // Image tools
  $('#imgW').oninput = e => { if (selImg) { selImg.style.width = e.target.value + '%'; selImg.style.maxWidth = '100%'; afterEdit(); } };
  $$('[data-img]').forEach(b => b.onclick = () => imageAction(b.dataset.img));
  $('#cropGo').onclick = () => { closeDlg('#dlgCrop'); bakeImage({ crop: { t: +$('#crT').value || 0, b: +$('#crB').value || 0, l: +$('#crL').value || 0, r: +$('#crR').value || 0 } }); };
  $('#pzSize').oninput = e => { if (selPuzzle) { setPuzzleSize(selPuzzle, +e.target.value); afterEdit(); } };
  $('#pzDel').onclick = () => { if (selPuzzle) { selPuzzle.remove(); selPuzzle = null; showSelTools(); afterEdit(); } };
  $('#pzRegen').onclick = () => { if (selPuzzle) regeneratePuzzle(selPuzzle); };

  // Find & replace
  $('#findBtn').onclick = () => { openDlg('#dlgFind'); $('#findQ').focus(); };
  $('#findCount').onclick = () => { const n = findReplace(false); $('#findInfo').textContent = n + ' match' + (n === 1 ? '' : 'es') + ' in the book'; };
  $('#findAll').onclick = () => { snapshot('replace all'); const n = findReplace(true); $('#findInfo').textContent = 'Replaced ' + n + ' match' + (n === 1 ? '' : 'es'); markDirty(); };
  $('#cleanBtn').onclick = () => { $('#cleanInfo').textContent = ''; openDlg('#dlgClean'); };
  $('#cleanGo').onclick = () => {
    snapshot('auto-edit');
    const n = autoEditText({ quotes: $('#ceQuotes').checked, dashes: $('#ceDashes').checked, ellipsis: $('#ceEllipsis').checked, spaces: $('#ceSpaces').checked, empty: $('#ceEmpty').checked, fonts: $('#ceFonts').checked, heads: $('#ceHeads').checked });
    $('#cleanInfo').textContent = n ? `Made ${n} change${n > 1 ? 's' : ''}.` : 'Nothing needed changing.';
  };
}

function movePage(d) {
  const j = curPage + d; if (j < 0 || j >= S.pages.length) return;
  snapshot('move page'); syncPagesFromDom();
  const [p] = S.pages.splice(curPage, 1); S.pages.splice(j, 0, p); curPage = j; renderPages(); setActivePage(j, true); refreshAll(); markDirty();
}

function showSelTools() {
  // A Grid book puzzle (.grid-room) is a fixed block: it takes a theme, nothing else.
  const own = !!selPuzzle && selPuzzle.classList.contains('puzzle');
  $('#imgTools').hidden = !selImg; $('#pzTools').hidden = !own; showThemeTools();
  if (selImg) {
    const w = selImg.style.width ? parseFloat(selImg.style.width) : 100; $('#imgW').value = w;
    $('#imgBright').value = 100; $('#imgContrast').value = 100;
    const dpi = imageDpi(selImg); $('#imgDpi').textContent = dpi ? `Print resolution at this size: ${dpi} DPI${dpi < 300 ? ' (below the 300 DPI print standard)' : ''}` : '';
    if (window.innerWidth <= 1100) $('#workspace').classList.add('show-insp');
  }
  if (own) $('#pzSize').value = parseFloat(selPuzzle.dataset.size || 5);
  if (selPuzzle && window.innerWidth <= 1100) $('#workspace').classList.add('show-insp');
}
function imageDpi(img) {
  if (!img.naturalWidth) return 0;
  const wIn = img.offsetWidth / IN; return wIn ? Math.round(img.naturalWidth / wIn) : 0;
}
function imageAction(a) {
  if (a === 'pagebg' && selImg) { syncPagesFromDom(); S.pages[curPage].bg = selImg.src; selImg.remove(); selImg = null; syncPagesFromDom(); renderPages(); markDirty(); showSelTools(); return; }
  if (!selImg) return;
  if (a === 'delete') { selImg.remove(); selImg = null; showSelTools(); afterEdit(); return; }
  if (a === 'left' || a === 'right') { selImg.style.float = a; selImg.style.margin = a === 'left' ? '0 .15in .1in 0' : '0 0 .1in .15in'; selImg.style.width = selImg.style.width || '45%'; afterEdit(); return; }
  if (a === 'center') { selImg.style.float = ''; selImg.style.margin = ''; afterEdit(); return; }
  if (a === 'crop') { openDlg('#dlgCrop'); return; }
  if (a === 'rotate') return bakeImage({ rotate: 90 });
  if (a === 'flip') return bakeImage({ flip: true });
  if (a === 'gray') return bakeImage({ gray: true });
  if (a === 'apply') return bakeImage({ bright: +$('#imgBright').value, contrast: +$('#imgContrast').value });
}
function bakeImage(o) {
  const img = selImg; if (!img) return;
  const src = new Image(); src.onload = () => {
    let sw = src.naturalWidth, sh = src.naturalHeight, sx = 0, sy = 0;
    if (o.crop) { sx = sw * o.crop.l / 100; sy = sh * o.crop.t / 100; sw = sw * (1 - (o.crop.l + o.crop.r) / 100); sh = sh * (1 - (o.crop.t + o.crop.b) / 100); }
    const rot = o.rotate === 90; const cv = document.createElement('canvas');
    cv.width = rot ? sh : sw; cv.height = rot ? sw : sh; const ctx = cv.getContext('2d');
    const f = []; if (o.gray) f.push('grayscale(1)'); if (o.bright && o.bright !== 100) f.push(`brightness(${o.bright}%)`); if (o.contrast && o.contrast !== 100) f.push(`contrast(${o.contrast}%)`);
    ctx.filter = f.join(' ') || 'none';
    ctx.translate(cv.width / 2, cv.height / 2); if (rot) ctx.rotate(Math.PI / 2); if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    const jpeg = /^data:image\/jpe?g/.test(img.src);
    img.src = jpeg ? cv.toDataURL('image/jpeg', 0.93) : cv.toDataURL('image/png');
    afterEdit(); setTimeout(showSelTools, 50);
  };
  src.src = img.src;
}

function findReplace(doReplace) {
  const q = $('#findQ').value; if (!q) return 0;
  const r = $('#findR').value; const flags = $('#findCase').checked ? 'g' : 'gi';
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  let n = 0;
  contentEls().forEach(c => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.puzzle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(t => { const m = t.nodeValue.match(re); if (m) { n += m.length; if (doReplace) t.nodeValue = t.nodeValue.replace(re, r); } });
  });
  if (doReplace) { syncPagesFromDom(); checkAllOverflow(); }
  return n;
}

function titleCase(s) {
  const small = /^(a|an|and|as|at|but|by|for|in|nor|of|on|or|the|to|up|vs?)$/i;
  return s.replace(/\S+/g, (w, i) => (i > 0 && small.test(w)) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1));
}
function autoEditText(o) {
  let n = 0;
  contentEls().forEach(c => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.puzzle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(t => {
      let v = t.nodeValue; const before = v;
      if (o.spaces) v = v.replace(/[ \t ]{2,}/g, ' ');
      if (o.dashes) v = v.replace(/\s?---?\s?/g, '—');
      if (o.ellipsis) v = v.replace(/\.\s?\.\s?\./g, '…');
      if (o.quotes) {
        v = v.replace(/(^|[\s(\[{—-])"/g, '$1“').replace(/"/g, '”')
          .replace(/(^|[\s(\[{—-])'/g, '$1‘').replace(/'/g, '’');
      }
      if (v !== before) { t.nodeValue = v; n++; }
    });
    if (o.spaces) $$('p,h1,h2,h3,li', c).forEach(el => {
      const f = el.firstChild, l = el.lastChild;
      if (f && f.nodeType === 3 && /^\s+\S/.test(f.nodeValue)) { f.nodeValue = f.nodeValue.replace(/^\s+/, ''); n++; }
      if (l && l.nodeType === 3 && /\S\s+$/.test(l.nodeValue)) { l.nodeValue = l.nodeValue.replace(/\s+$/, ''); n++; }
    });
    if (o.empty) {
      const ps = $$('p', c).filter(p => !p.textContent.trim() && !p.querySelector('img,table,.puzzle,br+br'));
      // keep a single empty paragraph on otherwise empty pages so they stay editable
      ps.forEach(p => { if (c.children.length > 1 && p.previousElementSibling && (!p.previousElementSibling.textContent.trim() && p.previousElementSibling.tagName === 'P')) { p.remove(); n++; } });
    }
    if (o.fonts) $$('[style]', c).forEach(el => { if (el.closest('.puzzle')) return; if (el.style.fontFamily) { el.style.fontFamily = ''; n++; } });
    if (o.fonts) $$('font[face]', c).forEach(el => { el.removeAttribute('face'); n++; });
    if (o.heads) $$('h1,h2,h3', c).forEach(h => { if (h.children.length === 0) { const t = titleCase(h.textContent); if (t !== h.textContent) { h.textContent = t; n++; } } });
  });
  syncPagesFromDom(); checkAllOverflow(); markDirty();
  return n;
}

/* Sanitize imported/pasted HTML with an allowlist: keep structure and basic
   formatting; unwrap unknown elements; drop scripts, embeds, forms and every
   attribute or URL that is not plainly safe. Parsing with DOMParser is inert. */
const SAFE_TAGS = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'SPAN', 'DIV',
  'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
  'COLGROUP', 'COL', 'IMG', 'A', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'FIGURE', 'FIGCAPTION', 'SMALL', 'MARK']);
const DROP_TAGS = 'script,style,meta,link,base,iframe,frame,frameset,object,embed,applet,noscript,template,title,head,svg,math,form,input,button,select,textarea,video,audio,source,track,canvas,portal';
const SAFE_ATTRS = new Set(['style', 'src', 'href', 'alt', 'title', 'colspan', 'rowspan', 'align', 'width', 'height', 'start', 'type']);
const safeUrl = (v, img) => {
  const u = String(v).replace(/[\u0000- \u007f-\u009f]/g, '');
  return img ? /^(data:image\/(png|jpe?g|gif|webp|bmp);|blob:|https?:)/i.test(u) : /^(https?:|mailto:|#)/i.test(u);
};
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  $$(DROP_TAGS, doc).forEach(e => e.remove());
  // Deepest first, so unwrapping never skips a node.
  $$('*', doc.body).reverse().forEach(el => {
    if (!SAFE_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (!SAFE_ATTRS.has(n)) el.removeAttribute(a.name);
      else if ((n === 'src' || n === 'href') && !safeUrl(a.value, el.tagName === 'IMG')) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A') { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
    if (el.style) {
      ['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'margin', 'padding', 'background', 'background-color', 'background-image', 'font-family', 'font-size', 'line-height'].forEach(p => el.style.removeProperty(p));
      if (/url\s*\(|expression\s*\(/i.test(el.getAttribute('style') || '')) el.removeAttribute('style');
    }
  });
  $$('div,section,article,main,header,footer', doc.body).reverse().forEach(el => {
    if (!el.querySelector('p,div,h1,h2,h3,h4,ul,ol,table,img')) { const p = doc.createElement('p'); p.append(...el.childNodes); el.replaceWith(p); }
  });
  $$('h4,h5,h6', doc.body).forEach(h => { const n = doc.createElement('h3'); n.append(...h.childNodes); h.replaceWith(n); });
  return doc.body.innerHTML;
}

function refreshInspector() {
  $('#mTop').value = S.margins.top; $('#mBottom').value = S.margins.bottom; $('#mInside').value = S.margins.inside; $('#mOutside').value = S.margins.outside;
  const mm = PUBLISHERS[S.pub].minMargins(pageCount(), S.bleed);
  $('#marginHint').textContent = `${PUBLISHERS[S.pub].short} minimum for ${pageCount()} pages: inside ${mm.inside} in, outside ${mm.outside} in, top/bottom ${mm.top} in.`;
  $('#bodyFont').value = S.body.font; $('#bodySize').value = S.body.size; $('#bodyLh').value = S.body.lh;
  $('#folioOn').checked = S.folio.on; $('#folioPos').value = S.folio.pos; $('#folioStart').value = S.folio.start;
}

/* Dialog helpers */
function openDlg(sel) { const d = $(sel); if (!d.open) d.showModal(); }
function closeDlg(sel) { const d = $(sel); if (d.open) d.close(); }
document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });

/* ---------- Puzzle generators ---------- */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Sudoku: full grid by randomized backtracking, then remove clues while the solution stays unique.
function sdFill(g) {
  const i = g.indexOf(0); if (i < 0) return true;
  const r = Math.floor(i / 9), c = i % 9;
  for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) { if (sdOk(g, r, c, v)) { g[i] = v; if (sdFill(g)) return true; g[i] = 0; } }
  return false;
}
function sdOk(g, r, c, v) {
  for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false; }
  const br = r - r % 3, bc = c - c % 3;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (g[(br + y) * 9 + bc + x] === v) return false;
  return true;
}
function sdCount(g, limit = 2) {
  let best = -1, bestN = 10;
  for (let i = 0; i < 81; i++) if (!g[i]) {
    let n = 0; const r = Math.floor(i / 9), c = i % 9; for (let v = 1; v <= 9; v++) if (sdOk(g, r, c, v)) n++;
    if (n < bestN) { bestN = n; best = i; if (n === 0) return 0; }
  }
  if (best < 0) return 1;
  let total = 0; const r = Math.floor(best / 9), c = best % 9;
  for (let v = 1; v <= 9; v++) if (sdOk(g, r, c, v)) { g[best] = v; total += sdCount(g, limit); g[best] = 0; if (total >= limit) break; }
  return total;
}
function makeSudoku(diff) {
  const sol = new Array(81).fill(0); sdFill(sol);
  const target = { easy: 38, medium: 31, hard: 27, expert: 24 }[diff] || 31;
  const puz = sol.slice(); let clues = 81;
  for (const i of shuffle([...Array(81).keys()])) {
    if (clues <= target) break;
    const keep = puz[i]; puz[i] = 0;
    if (sdCount(puz.slice()) !== 1) puz[i] = keep; else clues--;
  }
  return { puz, sol };
}

// Word search
const WS_DIRS = { easy: [[0, 1], [1, 0]], medium: [[0, 1], [1, 0], [1, 1], [-1, 1]], hard: [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]] };
function makeWordSearch(words, size, level) {
  const clean = [...new Set(words.map(w => w.toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length >= 2 && w.length <= size))].sort((a, b) => b.length - a.length);
  for (let attempt = 0; attempt < 30; attempt++) {
    const g = Array.from({ length: size }, () => Array(size).fill(''));
    const placed = []; let failed = [];
    for (const w of clean) {
      let ok = false;
      for (let t = 0; t < 300 && !ok; t++) {
        const [dr, dc] = WS_DIRS[level][Math.floor(Math.random() * WS_DIRS[level].length)];
        const r0 = Math.floor(Math.random() * size), c0 = Math.floor(Math.random() * size);
        const r1 = r0 + dr * (w.length - 1), c1 = c0 + dc * (w.length - 1);
        if (r1 < 0 || r1 >= size || c1 < 0 || c1 >= size) continue;
        let fits = true;
        for (let k = 0; k < w.length; k++) { const ch = g[r0 + dr * k][c0 + dc * k]; if (ch && ch !== w[k]) { fits = false; break; } }
        if (!fits) continue;
        const cells = [];
        for (let k = 0; k < w.length; k++) { g[r0 + dr * k][c0 + dc * k] = w[k]; cells.push((r0 + dr * k) * size + c0 + dc * k); }
        placed.push({ w, cells }); ok = true;
      }
      if (!ok) failed.push(w);
    }
    if (!failed.length || attempt === 29) {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!g[r][c]) g[r][c] = A[Math.floor(Math.random() * 26)];
      return { grid: g.flat(), size, placed, failed };
    }
  }
}

// Maze: recursive backtracker; returns a PNG data URL of puzzle and solution
function makeMaze(n, shape) {
  const W = n, H = n; const cell = Array.from({ length: W * H }, () => ({ n: 1, e: 1, s: 1, w: 1, v: 0 }));
  const inside = (x, y) => { if (shape !== 'circle') return true; const cx = (W - 1) / 2, cy = (H - 1) / 2; return ((x - cx) ** 2 + (y - cy) ** 2) <= (W / 2) ** 2; };
  const st = [[Math.floor(W / 2), 0]]; cell[Math.floor(W / 2)].v = 1;
  while (st.length) {
    const [x, y] = st[st.length - 1];
    const nb = [[0, -1, 'n', 's'], [1, 0, 'e', 'w'], [0, 1, 's', 'n'], [-1, 0, 'w', 'e']].filter(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && inside(nx, ny) && !cell[ny * W + nx].v; });
    if (!nb.length) { st.pop(); continue; }
    const [dx, dy, a, b] = nb[Math.floor(Math.random() * nb.length)];
    cell[y * W + x][a] = 0; const nc = cell[(y + dy) * W + x + dx]; nc[b] = 0; nc.v = 1; st.push([x + dx, y + dy]);
  }
  // entrance top middle, exit bottom middle (or lowest inside cell for round)
  const sx = Math.floor(W / 2); let ex = Math.floor(W / 2), ey = H - 1; while (!cell[ey * W + ex].v) ey--;
  cell[sx].n = 0; cell[ey * W + ex].s = 0;
  // solve (BFS)
  const prev = new Map(); const q = [sx]; prev.set(sx, -1);
  while (q.length) { const i = q.shift(); const x = i % W, y = Math.floor(i / W); const c = cell[i];
    [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']].forEach(([dx, dy, d]) => { const nx = x + dx, ny = y + dy; if (c[d] || nx < 0 || ny < 0 || nx >= W || ny >= H) return; const j = ny * W + nx; if (!prev.has(j) && cell[j].v) { prev.set(j, i); q.push(j); } }); }
  const path = []; for (let i = ey * W + ex; i !== -1 && i !== undefined; i = prev.get(i)) path.push(i);
  const draw = (sol) => {
    const px = Math.max(20, Math.floor(2400 / n)); const pad = px; const cv = document.createElement('canvas');
    cv.width = W * px + pad * 2; cv.height = H * px + pad * 2; const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (sol) { ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = px * 0.35; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      path.forEach((i, k) => { const x = pad + (i % W + .5) * px, y = pad + (Math.floor(i / W) + .5) * px; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(3, px * 0.12); ctx.lineCap = 'square'; ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = cell[y * W + x]; if (!c.v) continue; const X = pad + x * px, Y = pad + y * px;
      if (c.n) { ctx.moveTo(X, Y); ctx.lineTo(X + px, Y); } if (c.s) { ctx.moveTo(X, Y + px); ctx.lineTo(X + px, Y + px); }
      if (c.w) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + px); } if (c.e) { ctx.moveTo(X + px, Y); ctx.lineTo(X + px, Y + px); } }
    ctx.stroke();
    return cv.toDataURL('image/png');
  };
  return { puz: draw(false), sol: draw(true) };
}

/* ---------- Puzzle HTML ---------- */
function setPuzzleSize(el, inches) {
  el.dataset.size = inches; el.style.width = inches + 'in';
  const grid = $('.pz-grid', el); if (!grid) return;
  const n = +grid.dataset.n; const cellIn = inches / n;
  grid.style.fontSize = (cellIn * 72 * (el.dataset.kind === 'sudoku' ? 0.55 : 0.6)).toFixed(1) + 'pt';
}
function sudokuHTML(puz, sol, sizeIn, showSol, label) {
  const cells = puz.map((v, i) => { const r = Math.floor(i / 9), c = i % 9; const cls = [r % 3 === 0 && r ? 'bt' : '', c % 3 === 0 && c ? 'bl' : '', v ? 'given' : (showSol ? 'fill' : '')].join(' ').trim();
    return `<div class="${cls}">${v || (showSol ? sol[i] : '')}</div>`; }).join('');
  const el = document.createElement('div'); el.className = 'puzzle'; el.contentEditable = 'false'; el.dataset.kind = 'sudoku';
  el.dataset.puz = puz.join(''); el.dataset.sol = sol.join(''); if (label) el.dataset.label = label;
  el.innerHTML = `<div class="pz-grid pz-sudoku" data-n="9" style="grid-template-columns:repeat(9,1fr)">${cells}</div>${showSol && label ? `<div class="pz-caption">${esc(label)}</div>` : ''}`;
  setPuzzleSize(el, sizeIn); return el.outerHTML;
}
function wordsearchHTML(ws, words, sizeIn, showSol, label) {
  const hits = new Set(showSol ? ws.placed.flatMap(p => p.cells) : []);
  const el = document.createElement('div'); el.className = 'puzzle'; el.contentEditable = 'false'; el.dataset.kind = 'wordsearch';
  el.dataset.grid = ws.grid.join(''); el.dataset.n = ws.size; el.dataset.cells = JSON.stringify(ws.placed.map(p => p.cells)); if (label) el.dataset.label = label;
  el.dataset.words = JSON.stringify(ws.placed.map(p => p.w));
  el.innerHTML = `<div class="pz-grid pz-ws" data-n="${ws.size}" style="grid-template-columns:repeat(${ws.size},1fr);border-width:1.5px">${ws.grid.map((ch, i) => `<div class="${hits.has(i) ? 'hit' : ''}" style="border:0">${ch}</div>`).join('')}</div>` +
    (showSol ? (label ? `<div class="pz-caption">${esc(label)}</div>` : '') : `<div class="pz-words">${ws.placed.map(p => `<span>${p.w}</span>`).sort().join('')}</div>`);
  setPuzzleSize(el, sizeIn); return el.outerHTML;
}
function mazeHTML(src, sol, sizeIn, showSol, label) {
  return `<div class="puzzle" contenteditable="false" data-kind="maze" data-size="${sizeIn}" ${label ? `data-label="${esc(label)}"` : ''} style="width:${sizeIn}in"><img src="${showSol ? sol : src}" alt="Maze" style="width:100%;margin:0">${showSol && label ? `<div class="pz-caption">${esc(label)}</div>` : ''}</div>`;
}

const SAMPLE_LISTS = `Garden
TULIP
DAISY
ROSE
SEEDS
SPADE
HOSE
COMPOST
ORCHID
FERN
LILAC
SHOVEL
BLOSSOM

Ocean Life
WHALE
DOLPHIN
OCTOPUS
CORAL
SHARK
SEAHORSE
STARFISH
CRAB
JELLYFISH
TURTLE
SQUID
LOBSTER`;

function contentWidthIn() { const { w } = trimWH(); return w - S.margins.inside - S.margins.outside; }
function contentHeightIn() { const { h } = trimWH(); return h - S.margins.top - S.margins.bottom; }

function wirePuzzles() {
  let kind = 'sudoku';
  $('#wsLists').value = SAMPLE_LISTS;
  $$('#pzKind button').forEach(b => b.onclick = () => {
    kind = b.dataset.k; $$('#pzKind button').forEach(x => x.classList.toggle('on', x === b));
    ['sudoku', 'wordsearch', 'maze'].forEach(k => $('#pzOpts-' + k).hidden = k !== kind);
    if (kind === 'wordsearch') $('#pzCount').value = $('#wsLists').value.trim().split(/\n\s*\n/).length;
  });
  $('#insPuzzle').onclick = () => openDlg('#dlgPuzzle');
  $('#insPuzzle').addEventListener('click', () => fillThemeSelects($('#pzGenTheme'), $('#pzGenSub'), lastGenTheme.theme, lastGenTheme.sub));
  $('#pzGenTheme').onchange = () => fillThemeSelects($('#pzGenTheme'), $('#pzGenSub'), $('#pzGenTheme').value, '');
  $('#pzGenThemeEdit').onclick = () => openThemeEditor(() => fillThemeSelects($('#pzGenTheme'), $('#pzGenSub'), $('#pzGenTheme').value, $('#pzGenSub').value));
  wireThemes();
  $('#pzGo').onclick = async () => {
    closeDlg('#dlgPuzzle');
    lastGenTheme = { theme: $('#pzGenTheme').value, sub: $('#pzGenSub').value };
    await generatePuzzles(kind, {
      theme: lastGenTheme.theme, sub: lastGenTheme.sub,
      count: clamp(+$('#pzCount').value || 1, 1, 500), perPage: +$('#pzPerPage').value, answers: $('#pzAnswers').checked, newPages: $('#pzNewPages').checked,
      diff: $('#sdDiff').value, wsSize: +$('#wsSize').value, wsDir: $('#wsDir').value, lists: $('#wsLists').value, mzSize: +$('#mzSize').value, mzShape: $('#mzShape').value
    });
  };
}

async function generatePuzzles(kind, o) {
  snapshot('generate puzzles'); syncPagesFromDom();
  const cw = contentWidthIn(), ch = contentHeightIn();
  const per = o.perPage;
  // Puzzle size: fit width, and leave room for heading + word list
  const size = per === 1 ? Math.min(cw, ch * (kind === 'wordsearch' ? 0.66 : 0.82)) : per === 2 ? Math.min(cw * 0.8, ch / 2 - 0.9) : Math.min(cw / 2 - 0.2, ch / 2 - 0.8);
  const lists = kind === 'wordsearch' ? o.lists.trim().split(/\n\s*\n/).map(b => { const ls = b.trim().split(/\n/).map(s => s.trim()).filter(Boolean); return { title: ls[0], words: ls.slice(1) }; }).filter(l => l.words.length) : [];
  const count = kind === 'wordsearch' ? Math.min(o.count, Math.max(lists.length, 1) * 50) : o.count;
  if (kind === 'wordsearch' && !lists.length) { toast('Add at least one word list'); return; }
  const blocks = [], answers = [];
  const theme = o.theme ? { theme: o.theme, sub: o.sub || '' } : null;
  for (let k = 0; k < count; k++) {
    busy(`Generating ${kind === 'wordsearch' ? 'word search' : kind} ${k + 1} of ${count}`, k / count); await nextFrame();
    const num = ++S.counters[kind];
    if (kind === 'sudoku') {
      const { puz, sol } = makeSudoku(o.diff); const d = o.diff[0].toUpperCase() + o.diff.slice(1);
      blocks.push(`<h2 class="center">Sudoku #${num} · ${d}</h2>` + sudokuHTML(puz, sol, size, false));
      answers.push(sudokuHTML(puz, sol, 2.1, true, `Sudoku #${num}`));
    } else if (kind === 'wordsearch') {
      const L = lists[k % lists.length]; const ws = makeWordSearch(L.words, o.wsSize, o.wsDir);
      blocks.push(`<h2 class="center">${esc(L.title)}</h2>` + wordsearchHTML(ws, L.words, size, false));
      answers.push(wordsearchHTML(ws, L.words, Math.max(2.1, o.wsSize * 0.165), true, `Word search #${num}: ${L.title}`));
      if (ws.failed.length) toast(`Could not fit: ${ws.failed.join(', ')}. Try a bigger grid.`, 5000);
    } else {
      const m = makeMaze(o.mzSize, o.mzShape);
      blocks.push(`<h2 class="center">Maze #${num}</h2>` + mazeHTML(m.puz, m.sol, size, false));
      answers.push(mazeHTML(m.puz, m.sol, 2.1, true, `Maze #${num}`));
    }
    // The puzzle and its solution share an id, so a theme set later reaches both.
    const pid = uid(); const tag = h => tagPuzzleHTML(h, pid, theme);
    blocks[blocks.length - 1] = tag(blocks[blocks.length - 1]); answers[answers.length - 1] = tag(answers[answers.length - 1]);
  }
  busy(false);
  if (o.newPages) {
    const pagesNew = []; for (let i = 0; i < blocks.length; i += per) pagesNew.push({ id: uid(), html: blocks.slice(i, i + per).join(per > 2 ? '' : '<p><br></p>'), noFlow: true });
    if (per === 4) pagesNew.forEach(p => p.html = `<div class="answers-wrap" style="text-align:center">${p.html}</div>`);
    S.pages.splice(curPage + 1, 0, ...pagesNew);
    curPage = curPage + 1;
  } else {
    S.pages[curPage].html += blocks.join('');
  }
  if (o.answers) addAnswers(answers);
  renderPages(); refreshAll(); markDirty();
  setTimeout(() => { setActivePage(curPage, true); reflowAnswers(); }, 60);
  toast(`Added ${count} puzzle${count > 1 ? 's' : ''}${o.answers ? ' and their solutions' : ''}`);
}

function addAnswers(list) {
  let idx = S.pages.findIndex(p => p.answers);
  if (idx < 0) { S.pages.push({ id: uid(), html: '<h1 class="center">Solutions</h1><div class="answers-wrap" style="text-align:center"></div>', answers: true, flow: 'answers' }); idx = S.pages.length - 1; }
  // append to the last answers page; reflow will spread them
  const last = S.pages.map((p, i) => p.answers ? i : -1).filter(i => i >= 0).pop();
  const d = document.createElement('div'); d.innerHTML = S.pages[last].html;
  let wrap = d.querySelector('.answers-wrap'); if (!wrap) { wrap = document.createElement('div'); wrap.className = 'answers-wrap'; wrap.style.textAlign = 'center'; d.appendChild(wrap); }
  wrap.insertAdjacentHTML('beforeend', list.join(''));
  S.pages[last].html = d.innerHTML;
}
// Answer pages hold one wrapper of many small grids: split the wrapper across pages when it overflows.
function reflowAnswers() {
  let changed = false;
  for (let guard = 0; guard < 500; guard++) {
    const pgs = $$('#pages .page'); let moved = false;
    for (let i = 0; i < S.pages.length; i++) {
      if (!S.pages[i].answers) continue;
      const c = $('.content', pgs[i]); const wrap = $('.answers-wrap', c); if (!wrap || !isOverflow(c)) continue;
      const out = [];
      while (isOverflow(c) && wrap.children.length > 1) { out.unshift(wrap.lastElementChild.outerHTML); wrap.lastElementChild.remove(); }
      if (!out.length) continue;
      S.pages[i].html = c.innerHTML;
      let nx = S.pages[i + 1];
      if (!nx || !nx.answers) { nx = { id: uid(), html: '<div class="answers-wrap" style="text-align:center"></div>', answers: true, flow: 'answers' }; S.pages.splice(i + 1, 0, nx); }
      const d = document.createElement('div'); d.innerHTML = nx.html; let w2 = d.querySelector('.answers-wrap');
      if (!w2) { w2 = document.createElement('div'); w2.className = 'answers-wrap'; w2.style.textAlign = 'center'; d.appendChild(w2); }
      w2.insertAdjacentHTML('afterbegin', out.join('')); nx.html = d.innerHTML;
      moved = changed = true; break;
    }
    if (!moved) break;
    renderPages();
  }
  if (changed) { refreshAll(); markDirty(); }
}

function regeneratePuzzle(el) {
  const k = el.dataset.kind; const size = parseFloat(el.dataset.size || 5);
  let html;
  if (k === 'sudoku') { const filled = (el.dataset.puz || '').replace(/0/g, '').length; const diff = filled >= 36 ? 'easy' : filled >= 30 ? 'medium' : filled >= 26 ? 'hard' : 'expert'; const { puz, sol } = makeSudoku(diff); html = sudokuHTML(puz, sol, size, false); }
  else if (k === 'wordsearch') { const words = JSON.parse(el.dataset.words || '[]'); const ws = makeWordSearch(words, +el.dataset.n || 15, 'medium'); html = wordsearchHTML(ws, words, size, false); }
  else { const m = makeMaze(18, 'square'); html = mazeHTML(m.puz, m.sol, size, false); }
  const t = document.createElement('div'); t.innerHTML = html; const nu = t.firstElementChild;
  ['pzTheme', 'pzSub'].forEach(k => { if (el.dataset[k]) nu.dataset[k] = el.dataset[k]; }); // keeps its theme (its old solution no longer matches, so no shared id)
  el.replaceWith(nu);
  selPuzzle = null; showSelTools(); afterEdit();
  toast('New puzzle made. Its old solution in the answer key no longer matches; delete it there.', 5000);
}

/* ---------- Puzzle themes ----------
   A puzzle's theme and subcategory are data-pz-theme / data-pz-sub on the
   puzzle (or, for a Grid book page, its .grid-room), so they are saved and
   synced with the page. A generated puzzle and its solution share data-pz-id,
   so changing one changes both. The list is S.puzzleThemes (core.js). */
let lastGenTheme = { theme: '', sub: '' };
// Every generated puzzle's HTML starts with <div class="puzzle" (sudokuHTML,
// wordsearchHTML, mazeHTML), so the attributes go in there, escaped.
function tagPuzzleHTML(html, pid, theme) {
  const at = ` data-pz-id="${esc(pid)}"` + (theme ? ` data-pz-theme="${esc(theme.theme)}"` + (theme.sub ? ` data-pz-sub="${esc(theme.sub)}"` : '') : '');
  return html.replace(/<div class="puzzle"/, m => m + at);
}
function setPuzzleTheme(el, theme, sub) {
  if (theme) el.dataset.pzTheme = theme; else delete el.dataset.pzTheme;
  if (theme && sub) el.dataset.pzSub = sub; else delete el.dataset.pzSub;
}
// Fill a theme select and its subcategory select. A value that is no longer in
// the list (renamed, removed, or from another book) still shows, marked so.
function fillThemeSelects(selT, selS, theme, sub) {
  const list = puzzleThemes();
  const known = list.find(t => t.name === theme);
  selT.innerHTML = '<option value="">No theme</option>' + list.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('') +
    (theme && !known ? `<option value="${esc(theme)}">${esc(theme)} (not in your list)</option>` : '');
  selT.value = theme || '';
  const subs = known ? known.subs : [];
  selS.innerHTML = `<option value="">${theme ? 'Any ' + esc(theme.toLowerCase()) : 'Pick a theme first'}</option>` + subs.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('') +
    (theme && sub && !subs.includes(sub) ? `<option value="${esc(sub)}">${esc(sub)} (not in your list)</option>` : '');
  selS.value = theme ? (sub || '') : '';
  selS.disabled = !theme;
}
function showThemeTools() {
  const el = selPuzzle; $('#pzThemeTools').hidden = !el; if (!el) return;
  fillThemeSelects($('#pzTheme'), $('#pzSub'), el.dataset.pzTheme || '', el.dataset.pzSub || '');
}
// Puzzles that change with this one: its solution (same id), anywhere in the book.
function puzzleTwins(el) {
  const id = el.dataset.pzId; if (!id) return [el];
  return $$('#pages .puzzle').filter(p => p === el || p.dataset.pzId === id);
}
function applyThemeTo(els, theme, sub) {
  const set = new Set(); els.forEach(e => puzzleTwins(e).forEach(x => set.add(x)));
  set.forEach(x => setPuzzleTheme(x, theme, sub));
  syncPagesFromDom(); markDirty(); // twins can be on other pages
  if (selPuzzle) selPuzzle.classList.add('sel');
}
function wireThemes() {
  $('#pzTheme').onchange = () => { const el = selPuzzle; if (!el) return; fillThemeSelects($('#pzTheme'), $('#pzSub'), $('#pzTheme').value, ''); applyThemeTo([el], $('#pzTheme').value, ''); };
  $('#pzSub').onchange = () => { const el = selPuzzle; if (!el) return; applyThemeTo([el], $('#pzTheme').value, $('#pzSub').value); };
  $('#pzThemePage').onclick = () => {
    const el = selPuzzle; if (!el) return; const pg = el.closest('.page'); if (!pg) return;
    const all = $$('.content .puzzle, .content .grid-room', pg);
    const th = el.dataset.pzTheme || '', sb = el.dataset.pzSub || '';
    applyThemeTo(all, th, sb);
    toast(th ? `${all.length} puzzle${all.length === 1 ? ' is' : 's are'} now ${th}${sb ? ' › ' + sb : ''}` : `Took the theme off ${all.length} puzzle${all.length === 1 ? '' : 's'}`);
  };
  $('#pzThemeEdit').onclick = () => openThemeEditor(showThemeTools);
  $('#thAdd').onclick = () => { const r = themeRow({ name: '', subs: [] }); $('#thList').appendChild(r); $('input', r).focus(); };
  $('#thReset').onclick = () => { $('#thList').innerHTML = ''; DEFAULT_PUZZLE_THEMES.forEach(t => $('#thList').appendChild(themeRow(t))); };
  $('#thList').addEventListener('click', e => { const b = e.target.closest('.th-del'); if (b) b.closest('.th-row').remove(); });
  $('#thSave').onclick = saveThemeEditor;
}
let themeEditorDone = null;
function themeRow(t) {
  const r = document.createElement('div'); r.className = 'th-row'; r.dataset.orig = t.name || '';
  r.innerHTML = `<label class="lab">Theme <input type="text" class="th-name" maxlength="60" value="${esc(t.name)}" placeholder="Theme name"></label>` +
    `<label class="lab th-subs">Subcategories <input type="text" class="th-sub" value="${esc(t.subs.join(', '))}" placeholder="Separate with commas"></label>` +
    `<button class="btn danger th-del" type="button" aria-label="Remove ${esc(t.name || 'this theme')}">Remove</button>`;
  return r;
}
function openThemeEditor(done) {
  themeEditorDone = done || null;
  const box = $('#thList'); box.innerHTML = '';
  puzzleThemes().forEach(t => box.appendChild(themeRow(t)));
  openDlg('#dlgThemes');
}
function saveThemeEditor() {
  const rows = $$('#thList .th-row');
  const list = cloneThemes(rows.map(r => ({ name: $('.th-name', r).value, subs: $('.th-sub', r).value.split(/[,\n]/) })));
  if (!list.length) { toast('Keep at least one theme, or press Use the default list'); return; }
  // A renamed theme is renamed on every puzzle in the book.
  const renames = new Map();
  rows.forEach(r => { const o = r.dataset.orig, n = $('.th-name', r).value.trim(); if (o && n && o !== n) renames.set(o, n); });
  snapshot('edit themes');
  S.puzzleThemes = list; themeSeed = list;
  if (renames.size) {
    // Every page is on screen in #pages, so rename there and save the pages.
    let n = 0;
    $$('#pages [data-pz-theme]').forEach(el => { const to = renames.get(el.dataset.pzTheme); if (to) { el.dataset.pzTheme = to; n++; } });
    if (n) { syncPagesFromDom(); if (selPuzzle) selPuzzle.classList.add('sel'); }
  }
  closeDlg('#dlgThemes'); markDirty();
  toast(`Saved ${list.length} theme${list.length === 1 ? '' : 's'}`);
  if (themeEditorDone) themeEditorDone();
}

/* ---------- Import ---------- */
function fileToDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); }); }
const ext = name => (name.split('.').pop() || '').toLowerCase();
const IMG_NATIVE = ['png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'apng'];

async function imageFileToDataURL(f) {
  const e = ext(f.name);
  if (e === 'tif' || e === 'tiff' || f.type === 'image/tiff') {
    await loadLibs('pako', 'utif');
    const buf = await f.arrayBuffer(); const ifds = UTIF.decode(buf); UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]); const cv = document.createElement('canvas'); cv.width = ifds[0].width; cv.height = ifds[0].height;
    const ctx = cv.getContext('2d'); const id = ctx.createImageData(cv.width, cv.height); id.data.set(rgba); ctx.putImageData(id, 0, 0);
    return cv.toDataURL('image/png');
  }
  if (e === 'heic' || e === 'heif' || /heic|heif/.test(f.type)) {
    if (LIBS.heic2any) { await loadLib('heic2any'); const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.95 }); return fileToDataURL(Array.isArray(out) ? out[0] : out); }
    // No HEIC decoder here: Safari can open HEIC itself; other browsers need a JPEG or PNG.
    const u = await fileToDataURL(f);
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); res(cv.toDataURL('image/jpeg', 0.95)); }; im.onerror = () => rej(new Error('This browser cannot open HEIC photos. Save it as JPEG or PNG (or use Safari) and import again.')); im.src = u; });
  }
  if (e === 'bmp' || e === 'ico' || e === 'avif') {
    // normalise to PNG so PDF export and older viewers handle it
    const u = await fileToDataURL(f); return await new Promise(res => { const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); res(cv.toDataURL('image/png')); }; im.onerror = () => res(u); im.src = u; });
  }
  return fileToDataURL(f);
}

function pickImage(cb) {
  const inp = $('#fileImg'); inp.value = '';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { busy('Loading image'); cb(await imageFileToDataURL(f)); } catch (e) { toast('Could not read that image: ' + e.message); } finally { busy(false); } };
  inp.click();
}

function textToHTML(t) {
  return t.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
function rtfToText(rtf) {
  let s = rtf.replace(/\\par[d]?/g, '\n\n').replace(/\\line/g, '\n').replace(/\\tab/g, '\t');
  s = s.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n));
  // drop groups such as font tables, color tables, stylesheets, pictures
  s = s.replace(/\{\\(\*|fonttbl|colortbl|stylesheet|info|pict|header|footer)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n');
}
function csvToHTML(t, sep) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return `<table>${rows.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
async function odtToHTML(f) {
  await loadLib('jszip'); const z = await JSZip.loadAsync(f); const xml = await z.file('content.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const out = [];
  const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const walk = n => { for (const c of n.childNodes) {
    if (c.namespaceURI === TEXT && c.localName === 'h') out.push(`<h2>${esc(c.textContent)}</h2>`);
    else if (c.namespaceURI === TEXT && c.localName === 'p') out.push(`<p>${esc(c.textContent) || '<br>'}</p>`);
    else if (c.nodeType === 1) walk(c); } };
  walk(doc.documentElement); return out.join('');
}
async function epubToHTML(f) {
  await loadLib('jszip'); const z = await JSZip.loadAsync(f);
  const cont = new DOMParser().parseFromString(await z.file('META-INF/container.xml').async('string'), 'application/xml');
  const opfPath = cont.querySelector('rootfile').getAttribute('full-path'); const base = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
  const opf = new DOMParser().parseFromString(await z.file(opfPath).async('string'), 'application/xml');
  const items = {}; opf.querySelectorAll('manifest item').forEach(i => items[i.getAttribute('id')] = i.getAttribute('href'));
  let html = '';
  for (const ir of opf.querySelectorAll('spine itemref')) {
    const href = items[ir.getAttribute('idref')]; const file = z.file(base + decodeURIComponent(href)); if (!file) continue;
    const d = new DOMParser().parseFromString(await file.async('string'), 'text/html');
    for (const img of d.querySelectorAll('img')) { const src = img.getAttribute('src'); const dir = (base + href).replace(/[^/]+$/, '');
      const p = new URL(src, 'http://x/' + dir).pathname.slice(1); const imf = z.file(decodeURIComponent(p));
      if (imf) { const b64 = await imf.async('base64'); const e = ext(p); img.setAttribute('src', `data:image/${e === 'jpg' ? 'jpeg' : e === 'svg' ? 'svg+xml' : e};base64,${b64}`); } }
    html += sanitizeHTML(d.body.innerHTML);
  }
  return html;
}
async function pdfLoad(f) {
  await loadLibs('pdfworker', 'pdfjs');
  return pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
}
async function pdfToText(f) {
  const pdf = await pdfLoad(f); let html = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(`Reading PDF page ${i} of ${pdf.numPages}`, i / pdf.numPages);
    const tc = await (await pdf.getPage(i)).getTextContent(); let lines = [], line = '', lastY = null;
    tc.items.forEach(it => { const y = it.transform[5]; if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; } line += it.str; lastY = y; if (it.hasEOL) { lines.push(line); line = ''; lastY = null; } });
    lines.push(line);
    html += textToHTML(lines.join('\n').replace(/([^\n.!?:"”])\n(?=[a-z])/g, '$1 '));
  }
  return html;
}
async function pdfToImages(f, dpi = 300) {
  const pdf = await pdfLoad(f); const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(`Rendering PDF page ${i} of ${pdf.numPages}`, i / pdf.numPages);
    const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: dpi / 72 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(cv.toDataURL('image/jpeg', 0.92)); cv.width = cv.height = 0;
  }
  return out;
}

async function fileToHTML(f) {
  const e = ext(f.name);
  if (e === 'docx') { await loadLib('mammoth'); const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() }); return sanitizeHTML(r.value); }
  if (e === 'doc') throw new Error('Old .doc files cannot be read in the browser. Save it as .docx and import again.');
  if (e === 'odt') return odtToHTML(f);
  if (e === 'epub') return epubToHTML(f);
  if (e === 'rtf') return textToHTML(rtfToText(await f.text()));
  if (e === 'md' || e === 'markdown') { await loadLib('marked'); return sanitizeHTML(marked.parse(await f.text())); }
  if (e === 'html' || e === 'htm' || e === 'xhtml') return sanitizeHTML(await f.text());
  if (e === 'csv') return csvToHTML(await f.text(), ',');
  if (e === 'tsv') return csvToHTML(await f.text(), '\t');
  if (e === 'pdf') return pdfToText(f);
  return textToHTML(await f.text());
}

async function importFiles(files) {
  const textMode = $('#impTextMode').value, imgMode = $('#impImgMode').value, pdfMode = $('#impPdfMode').value;
  snapshot('import'); syncPagesFromDom();
  let insertAt = curPage + 1, flowStart = -1, added = 0;
  const addImagePages = urls => {
    urls.forEach(u => {
      if (imgMode === 'page-bleed') S.pages.splice(insertAt++, 0, { id: uid(), html: '<p><br></p>', bg: u, noFolio: true });
      else S.pages.splice(insertAt++, 0, { id: uid(), html: `<img src="${u}" alt="" style="max-height:${(contentHeightIn() - 0.1).toFixed(2)}in;width:auto;max-width:100%">` });
      added++;
    });
  };
  try {
    for (const [k, f] of [...files].entries()) {
      busy(`Importing ${f.name}`, k / files.length); await nextFrame();
      const e = ext(f.name);
      if (e === 'json') { const data = JSON.parse(await f.text()); if (data && data.pages) { delete data.syncId; loadProject(data); toast('Opened project ' + (data.meta?.title || f.name)); busy(false); return; } continue; }
      const isImg = f.type.startsWith('image/') || IMG_NATIVE.includes(e) || ['tif', 'tiff', 'heic', 'heif'].includes(e);
      if (isImg) {
        const u = await imageFileToDataURL(f);
        if (imgMode === 'cursor') { if (added) { renderPages(); added = 0; } insertHTMLAtCursor(`<img src="${u}" alt="">`); syncPagesFromDom(); }
        else addImagePages([u]);
        continue;
      }
      if (e === 'pdf' && pdfMode === 'images') {
        const urls = await pdfToImages(f, +($('#dpi')?.value || 300));
        if (imgMode === 'cursor') { if (added) { renderPages(); added = 0; } urls.forEach(u => insertHTMLAtCursor(`<img src="${u}" alt="">`)); syncPagesFromDom(); }
        else addImagePages(urls);
        continue;
      }
      const html = await fileToHTML(f);
      if (textMode === 'cursor') { if (added) { renderPages(); added = 0; } insertHTMLAtCursor(html); syncPagesFromDom(); }
      else { const flow = uid(); if (flowStart < 0) flowStart = insertAt; S.pages.splice(insertAt++, 0, { id: uid(), html: html || '<p><br></p>', flow }); added++; }
    }
  } catch (err) { busy(false); toast(err.message || 'Import failed', 6000); renderPages(); refreshAll(); return; }
  renderPages(); refreshAll();
  if (flowStart >= 0) { busy('Laying out pages', 0.9); await nextFrame(); await nextFrame(); reflow(flowStart, true); }
  busy(false); markDirty();
  setActivePage(Math.min(curPage + 1, S.pages.length - 1), true);
  toast(`Imported ${files.length} file${files.length > 1 ? 's' : ''}. The book now has ${S.pages.length} pages.`);
}

function wireImport() {
  $('#importBtn').onclick = () => openDlg('#dlgImport');
  const dz = $('#dropzone'), inp = $('#importFile');
  dz.onclick = () => inp.click(); dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); };
  inp.onchange = () => { const fl = [...inp.files]; inp.value = ''; if (fl.length) { closeDlg('#dlgImport'); importFiles(fl); } };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files.length) { closeDlg('#dlgImport'); importFiles([...e.dataTransfer.files]); } };
  // Dropping files straight onto the pages also imports them
  $('#desk').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  $('#desk').addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); importFiles([...e.dataTransfer.files]); } });
}

/* ---------- Cover designer (Fabric.js) ---------- */
let cv = null, cvZoom = 0.5, coverReady = null, lastGeom = null, showCvGuides = true;
// Covers still loading into the canvas. Until they finish, the canvas holds the
// old cover, so it must not be read back into S.cover (syncCoverToState).
let cvLoading = 0;
const THEMES = {
  navy: { name: 'Midnight', bg: '#1f3a5f', accent: '#f2c14e', text: '#ffffff', title: 'Bebas Neue', body: 'Nunito' },
  sunny: { name: 'Sunshine', bg: '#f6c945', accent: '#1d1d1d', text: '#1d1d1d', title: 'Fredoka', body: 'Nunito' },
  forest: { name: 'Forest', bg: '#244b3a', accent: '#e9d8a6', text: '#fdfbf3', title: 'Playfair Display', body: 'Lora' },
  berry: { name: 'Berry', bg: '#7a1f4b', accent: '#ffd5e5', text: '#ffffff', title: 'Oswald', body: 'Open Sans' },
  sky: { name: 'Sky', bg: '#3fa7d6', accent: '#ffffff', text: '#0f2a3a', title: 'Fredoka', body: 'Nunito' },
  ink: { name: 'Ink & red', bg: '#121212', accent: '#e63946', text: '#ffffff', title: 'Bebas Neue', body: 'Open Sans' }
};
const CV_PROPS = ['role', 'selectable', 'evented'];
// An object's kind in lower case: Fabric 6+ writes "Textbox" and "Image" where 5 wrote "textbox" and "image".
const cvType = (o) => String(o?.type || '').toLowerCase();

async function ensureFonts(fams) { try { await Promise.all([...new Set(fams)].map(f => document.fonts.load(`40px "${f}"`))); } catch (e) { } }

function ensureCover() {
  if (coverReady) return coverReady;
  coverReady = (async () => {
    await loadLib('fabric');
    // Fabric 6+ keeps defaults in ownDefaults. Positions stay measured from the
    // top left, as in Fabric 5 (7 centres them by default), so saved covers don't move.
    Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
    Object.assign(fabric.InteractiveFabricObject.ownDefaults, { transparentCorners: false, cornerColor: '#1f5fd6', borderColor: '#1f5fd6', cornerSize: 10 });
    cv = new fabric.Canvas('coverCanvas', { preserveObjectStacking: true, backgroundColor: '#ffffff' });
    cv.on('selection:created', cvSelChanged); cv.on('selection:updated', cvSelChanged); cv.on('selection:cleared', cvSelChanged);
    cv.on('object:modified', () => markDirty()); cv.on('text:changed', () => markDirty());
    sizeCoverCanvas();
    if (S.cover) await loadCoverJSON(S.cover, S.coverGeom);
    else await autoDesignCover();
    lastGeom = coverGeom();
    return cv;
  })().catch(e => { coverReady = null; toast(e.message, 6000); throw e; });
  return coverReady;
}
function loadCoverJSON(json, oldGeom) {
  cvLoading++;
  return new Promise(res => {
    const fams = (json.objects || []).filter(o => o.fontFamily).map(o => o.fontFamily);
    ensureFonts(fams).then(() => cv.loadFromJSON(json)).then(() => {
      sizeCoverCanvas();
      if (oldGeom) relayoutCover(oldGeom, coverGeom());
      cv.requestRenderAll(); res();
    });
  }).finally(() => { cvLoading--; });
}
function sizeCoverCanvas() {
  if (!cv) return; const g = coverGeom();
  cv.setZoom(cvZoom); cv.setDimensions({ width: Math.round(g.W * IN * cvZoom), height: Math.round(g.H * IN * cvZoom) });
  const st = $('#coverStage'); st.style.width = Math.round(g.W * IN * cvZoom) + 'px'; st.style.height = Math.round(g.H * IN * cvZoom) + 'px';
  drawCoverGuides(); updateCoverSpecs();
}
function drawCoverGuides() {
  const g = coverGeom(), z = cvZoom * IN, P = PUBLISHERS[S.pub]; const host = $('#coverGuides'); host.innerHTML = '';
  host.hidden = !showCvGuides;
  const line = (x, y, w, h, color, dash = true) => { const d = document.createElement('div'); d.className = 'g'; Object.assign(d.style, { left: x * z + 'px', top: y * z + 'px', width: w * z + 'px', height: h * z + 'px', border: `1px ${dash ? 'dashed' : 'solid'} ${color}` }); host.appendChild(d); return d; };
  const css = getComputedStyle(document.documentElement);
  const red = css.getPropertyValue('--guide-bleed').trim(), blue = css.getPropertyValue('--guide-safe').trim(), purple = css.getPropertyValue('--guide-spine').trim();
  line(g.b, g.b, g.W - 2 * g.b, g.H - 2 * g.b, red, false);
  line(g.spineX, 0, g.sp, g.H, purple, false);
  const s = P.coverSafe;
  line(g.backX + s, g.b + s, g.w - 2 * s, g.h - 2 * s, blue);
  line(g.frontX + s, g.b + s, g.w - 2 * s, g.h - 2 * s, blue);
  const bc = P.barcode; const bx = g.spineX - bc.from - bc.w, by = g.H - g.b - bc.from - bc.h;
  const bd = line(bx, by, bc.w, bc.h, '#555', false); bd.style.background = 'rgba(255,255,255,.92)';
  const lb = document.createElement('div'); lb.className = 'lbl'; lb.textContent = 'Barcode area'; Object.assign(lb.style, { left: (bx + 0.1) * z + 'px', top: (by + 0.1) * z + 'px' }); host.appendChild(lb);
  const names = $('#cvNames'); names.style.width = g.W * z + 'px';
  names.innerHTML = `<div style="width:${(g.b + g.w) * z}px">Back cover</div><div style="width:${g.sp * z}px" title="Spine">${g.sp * z > 40 ? 'Spine' : ''}</div><div style="width:${(g.b + g.w) * z}px">Front cover</div>`;
}
function updateCoverSpecs() {
  const g = coverGeom(); const P = PUBLISHERS[S.pub];
  $('#cvSpecs').innerHTML = `<dt>Full cover</dt><dd>${g.W.toFixed(3)} × ${g.H.toFixed(3)} in</dd><dt>Trim (each side)</dt><dd>${g.w} × ${g.h} in</dd><dt>Spine</dt><dd>${fmtIn(g.sp)}</dd><dt>Bleed</dt><dd>0.125 in</dd><dt>Pages</dt><dd>${pageCount()}</dd><dt>Spine text</dt><dd>${pageCount() >= P.spineTextMinPages ? 'allowed' : 'needs ' + P.spineTextMinPages + '+ pages'}</dd>`;
}

function regionOf(x, g) { return x < g.spineX ? 'back' : x < g.frontX ? 'spine' : 'front'; }
function regionSpan(r, g) { return r === 'back' ? [0, g.spineX] : r === 'spine' ? [g.spineX, g.frontX] : [g.frontX, g.W]; }
function relayoutCover(o, n) {
  if (!cv) return;
  const O = { ...o, W: o.W * IN, H: o.H * IN, spineX: o.spineX * IN, frontX: o.frontX * IN };
  const N = { ...n, W: n.W * IN, H: n.H * IN, spineX: n.spineX * IN, frontX: n.frontX * IN };
  if (Math.abs(O.W - N.W) < 0.01 && Math.abs(O.H - N.H) < 0.01 && Math.abs(O.spineX - N.spineX) < 0.01) return;
  const sc = n.w / o.w;
  cv.getObjects().forEach(ob => {
    if (ob.role === 'bg') { ob.set({ left: 0, top: 0, width: N.W, height: N.H, scaleX: 1, scaleY: 1 }); ob.setCoords(); return; }
    if (ob.role === 'gridcover') { ob.set({ left: 0, top: 0, originX: 'left', originY: 'top', scaleX: N.W / ob.width, scaleY: N.H / ob.height }); ob.setCoords(); return; }
    if (ob.role === 'bgimg') { const s = Math.max(N.W / ob.width, N.H / ob.height); ob.set({ scaleX: s, scaleY: s, left: N.W / 2, top: N.H / 2, originX: 'center', originY: 'center' }); ob.setCoords(); return; }
    const c = ob.getCenterPoint(); const r = regionOf(c.x, O); const [a0, a1] = regionSpan(r, O), [b0, b1] = regionSpan(r, N);
    const fx = (c.x - a0) / Math.max(a1 - a0, 1e-6), fy = c.y / O.H;
    if (Math.abs(sc - 1) > 0.001 && r !== 'spine') ob.set({ scaleX: ob.scaleX * sc, scaleY: ob.scaleY * sc });
    if (r === 'spine' && cvType(ob) === 'textbox') { const maxF = (n.sp * IN) * 0.55; if (ob.fontSize * ob.scaleY > maxF) ob.set({ scaleX: maxF / ob.fontSize, scaleY: maxF / ob.fontSize }); }
    ob.setPositionByOrigin(new fabric.Point(b0 + fx * (b1 - b0), fy * N.H), 'center', 'center'); ob.setCoords();
  });
  cv.requestRenderAll();
}
function onGeometryChanged() {
  if (!cv) { updateStatus(); return; }
  const g = coverGeom(); if (lastGeom) relayoutCover(lastGeom, g); lastGeom = g; sizeCoverCanvas(); updateStatus();
}

function motifGroup(sizePx, t, digits = true) {
  const n = 3, cell = sizePx / n; const items = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const filled = (r + c) % 2 === 0;
    items.push(new fabric.Rect({ left: c * cell, top: r * cell, width: cell, height: cell, fill: filled ? t.accent : 'rgba(255,255,255,0.0)', stroke: t.text, strokeWidth: Math.max(2, sizePx * 0.012) }));
    if (digits) { const d = [5, 3, 7, 6, 1, 9, 8, 2, 4][r * 3 + c]; items.push(new fabric.Text(String(d), { left: c * cell + cell / 2, top: r * cell + cell / 2, originX: 'center', originY: 'center', fontSize: cell * 0.62, fontFamily: 'Courier Prime', fontWeight: 'bold', fill: filled ? t.bg : t.text })); }
  }
  const g = new fabric.Group(items, { originX: 'center', originY: 'center' }); g.role = 'motif'; return g;
}

async function autoDesignCover(themeKey) {
  await loadLib('fabric'); if (!cv) return ensureCover();
  const t = THEMES[themeKey || S.theme] || THEMES.navy; S.theme = themeKey || S.theme;
  const g = coverGeom(); const P = PUBLISHERS[S.pub]; const m = S.meta; const px = v => v * IN;
  await ensureFonts([t.title, t.body, 'Courier Prime']);
  cv.clear(); cv.backgroundColor = '#ffffff';
  const bg = new fabric.Rect({ left: 0, top: 0, width: px(g.W), height: px(g.H), fill: t.bg, selectable: false, evented: false }); bg.role = 'bg'; cv.add(bg);
  const fcx = px(g.frontX + g.w / 2), bcx = px(g.backX + g.w / 2), wpx = px(g.w);
  const title = new fabric.Textbox((m.title || 'Puzzle Book').toUpperCase(), { left: fcx, top: px(g.b + g.h * 0.08), originX: 'center', width: wpx * 0.84, fontSize: wpx * (t.title === 'Bebas Neue' || t.title === 'Oswald' ? 0.15 : 0.11), fontFamily: t.title, fontWeight: t.title === 'Playfair Display' ? 800 : 'normal', fill: t.text, textAlign: 'center', lineHeight: 0.95 }); title.role = 'title';
  cv.add(title);
  // keep the title to roughly the top quarter of the front cover
  for (let k = 0; k < 30 && title.height * title.scaleY > px(g.h) * 0.24; k++) { title.set('fontSize', title.fontSize * 0.92); title.initDimensions(); }
  let bottom = title.top + title.height + px(0.15);
  if (m.subtitle) { const sub = new fabric.Textbox(m.subtitle, { left: fcx, top: bottom, originX: 'center', width: wpx * 0.78, fontSize: wpx * 0.042, fontFamily: t.body, fill: t.text, textAlign: 'center' }); sub.role = 'subtitle'; cv.add(sub); bottom = sub.top + sub.height; }
  const authorTop = px(g.b + g.h * 0.86); const motSize = Math.min(wpx * 0.5, authorTop - bottom - px(0.5));
  if (motSize > px(0.8)) { const mot = motifGroup(motSize, t); mot.set({ left: fcx, top: (bottom + authorTop) / 2 }); cv.add(mot); }
  const au = new fabric.Textbox(m.author || 'Author Name', { left: fcx, top: px(g.b + g.h * 0.86), originX: 'center', width: wpx * 0.8, fontSize: wpx * 0.05, fontFamily: t.body, fontWeight: 'bold', fill: t.accent, textAlign: 'center' }); au.role = 'author'; cv.add(au);
  if (pageCount() >= P.spineTextMinPages) addSpineText(t);
  const blurb = new fabric.Textbox(m.blurb || m.description || 'Describe what makes this puzzle book fun: how many puzzles, the difficulty levels, and who it is for.', { left: bcx, top: px(g.b + 0.9), originX: 'center', width: wpx - px(1.4), fontSize: Math.max(14, wpx * 0.032), fontFamily: t.body, fill: t.text, textAlign: 'left', lineHeight: 1.3 }); blurb.role = 'blurb'; cv.add(blurb);
  const mot2 = motifGroup(wpx * 0.22, t, false); mot2.set({ left: px(g.backX + 0.9 + 0.11 * g.w), top: px(g.H - g.b - 1.25) }); cv.add(mot2);
  cv.requestRenderAll(); lastGeom = coverGeom(); $('#cvBg').value = t.bg; markDirty();
}
function addSpineText(t) {
  t = t || THEMES[S.theme] || THEMES.navy; const g = coverGeom(); const m = S.meta;
  const fs = Math.min(g.sp * IN * 0.5, 30);
  const sp = new fabric.Textbox(`${(m.title || 'Puzzle Book').toUpperCase()}   ${m.author || ''}`.trim(), { width: g.h * IN * 0.8, fontSize: fs, fontFamily: t.title, fill: t.text, textAlign: 'center', angle: 90, originX: 'center', originY: 'center' });
  sp.role = 'spine'; sp.left = (g.spineX + g.sp / 2) * IN; sp.top = (g.b + g.h / 2) * IN; cv.add(sp);
}

function cvSelChanged() {
  const o = cv.getActiveObject(); $('#cvObjTools').hidden = !o; if (!o) return;
  const isText = 'fontFamily' in o && cvType(o) !== 'group';
  ['cvFont', 'cvSize', 'cvBold', 'cvItalic', 'cvAlign'].forEach(id => $('#' + id).disabled = !isText);
  if (isText) { $('#cvFont').value = o.fontFamily; $('#cvSize').value = Math.round(o.fontSize * o.scaleY); $('#cvAlign').value = o.textAlign || 'left'; }
  const fill = typeof o.fill === 'string' && o.fill.startsWith('#') ? o.fill : '#ffffff'; $('#cvColor').value = fill.length === 7 ? fill : '#ffffff';
  $('#cvOpacity').value = Math.round((o.opacity ?? 1) * 100);
}
function cvSet(props) { const o = cv?.getActiveObject(); if (!o) return; o.set(props); o.setCoords(); cv.requestRenderAll(); markDirty(); }

function syncCoverToState() { if (!cv || cvLoading) return; S.cover = cv.toObject(CV_PROPS); S.coverGeom = coverGeom(); }

function wireCover() {
  $('#cvTheme').innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');
  $('#cvFont').innerHTML = BOOK_FONTS.map(f => `<option>${f}</option>`).join('');
  $('#cvAuto').onclick = async () => { await ensureCover(); await autoDesignCover($('#cvTheme').value); toast('Cover rebuilt from your book details'); };
  $('#cvTheme').onchange = async e => { await ensureCover(); await autoDesignCover(e.target.value); };
  $('#cvText').onclick = async () => { await ensureCover(); const g = coverGeom(); const t = new fabric.Textbox('Double-click to edit', { left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center', width: g.w * IN * 0.7, fontSize: 40, fontFamily: 'Nunito', fill: '#ffffff', textAlign: 'center' }); t.role = 'user'; cv.add(t); cv.setActiveObject(t); cv.requestRenderAll(); markDirty(); };
  $('#cvImage').onclick = async () => { await ensureCover(); pickImage(u => fabric.Image.fromURL(u).then(img => { const g = coverGeom(); const s = (g.w * IN * 0.6) / img.width; img.set({ scaleX: s, scaleY: s, left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center' }); img.role = 'user'; cv.add(img); cv.setActiveObject(img); cv.requestRenderAll(); markDirty(); })); };
  $('#cvBgImg').onclick = async () => { await ensureCover(); pickImage(u => fabric.Image.fromURL(u).then(img => { const g = coverGeom(); cv.getObjects().filter(o => o.role === 'bgimg').forEach(o => cv.remove(o)); const s = Math.max(g.W * IN / img.width, g.H * IN / img.height); img.set({ scaleX: s, scaleY: s, left: g.W * IN / 2, top: g.H * IN / 2, originX: 'center', originY: 'center' }); img.role = 'bgimg'; cv.add(img); const bgi = cv.getObjects().findIndex(o => o.role === 'bg'); img.moveTo(bgi + 1); cv.requestRenderAll(); markDirty(); })); };
  $('#cvRect').onclick = async () => { await ensureCover(); const g = coverGeom(); const r = new fabric.Rect({ left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center', width: g.w * IN * 0.6, height: g.w * IN * 0.25, fill: (THEMES[S.theme] || THEMES.navy).accent, rx: 8, ry: 8 }); r.role = 'user'; cv.add(r); cv.setActiveObject(r); cv.requestRenderAll(); markDirty(); };
  $('#cvCircle').onclick = async () => { await ensureCover(); const g = coverGeom(); const r = new fabric.Circle({ left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center', radius: g.w * IN * 0.15, fill: (THEMES[S.theme] || THEMES.navy).accent }); r.role = 'user'; cv.add(r); cv.setActiveObject(r); cv.requestRenderAll(); markDirty(); };
  $('#cvGrid').onclick = async () => { await ensureCover(); const g = coverGeom(); const m = motifGroup(g.w * IN * 0.4, THEMES[S.theme] || THEMES.navy); m.set({ left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN }); cv.add(m); cv.setActiveObject(m); cv.requestRenderAll(); markDirty(); };
  $('#cvBg').oninput = async e => { await ensureCover(); const bg = cv.getObjects().find(o => o.role === 'bg'); if (bg) { bg.set('fill', e.target.value); cv.requestRenderAll(); markDirty(); } };
  $('#cvFwd').onclick = () => { const o = cv?.getActiveObject(); if (o) { cv.bringObjectForward(o); cv.requestRenderAll(); markDirty(); } };
  $('#cvBack').onclick = () => { const o = cv?.getActiveObject(); if (o) { const bgi = cv.getObjects().findIndex(x => x.role === 'bg' || x.role === 'bgimg'); if (cv.getObjects().indexOf(o) > bgi + 1) cv.sendObjectBackwards(o); cv.requestRenderAll(); markDirty(); } };
  $('#cvDup').onclick = () => { const o = cv?.getActiveObject(); if (o) o.clone(CV_PROPS).then(c => { c.set({ left: o.left + 20, top: o.top + 20 }); c.role = o.role === 'bg' ? 'user' : o.role; cv.add(c); cv.setActiveObject(c); cv.requestRenderAll(); markDirty(); }); };
  const del = () => { const o = cv?.getActiveObject(); if (!o || o.isEditing) return; (cvType(o) === 'activeselection' ? o.getObjects() : [o]).forEach(x => cv.remove(x)); cv.discardActiveObject(); cv.requestRenderAll(); markDirty(); };
  $('#cvDel').onclick = del;
  document.addEventListener('keydown', e => { if ($('#view-cover').hidden) return; if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const o = cv?.getActiveObject(); if (o && !o.isEditing) { e.preventDefault(); del(); } } });
  $('#cvZoom').onchange = e => { cvZoom = +e.target.value; sizeCoverCanvas(); };
  $('#cvGuidesBtn').onclick = () => { showCvGuides = !showCvGuides; $('#cvGuidesBtn').classList.toggle('on', showCvGuides); drawCoverGuides(); };
  $('#cvGuidesBtn').classList.add('on');
  $('#cvFont').onchange = async e => { await ensureFonts([e.target.value]); cvSet({ fontFamily: e.target.value }); };
  $('#cvSize').onchange = e => { const o = cv?.getActiveObject(); if (o) cvSet({ fontSize: (+e.target.value || 20) / (o.scaleY || 1) }); };
  $('#cvColor').oninput = e => cvSet({ fill: e.target.value });
  $('#cvBold').onclick = () => { const o = cv?.getActiveObject(); if (o) cvSet({ fontWeight: o.fontWeight === 'bold' || o.fontWeight >= 700 ? 'normal' : 'bold' }); };
  $('#cvItalic').onclick = () => { const o = cv?.getActiveObject(); if (o) cvSet({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }); };
  $('#cvAlign').onchange = e => cvSet({ textAlign: e.target.value });
  $('#cvOpacity').oninput = e => cvSet({ opacity: +e.target.value / 100 });
  $$('[data-snap]').forEach(b => b.onclick = () => {
    const o = cv?.getActiveObject(); if (!o) return; const g = coverGeom(); const c = o.getCenterPoint(); const a = b.dataset.snap;
    if (a === 'rotate') { o.rotate(((o.angle || 0) + 90) % 360); }
    else { const x = a === 'front' ? g.frontX + g.w / 2 : a === 'back' ? g.backX + g.w / 2 : g.spineX + g.sp / 2; if (a === 'spine') { o.rotate(90); o.role = o.role === 'user' ? 'spine' : o.role; } o.setPositionByOrigin(new fabric.Point(x * IN, a === 'spine' ? (g.b + g.h / 2) * IN : c.y), 'center', 'center'); }
    o.setCoords(); cv.requestRenderAll(); markDirty();
  });
}

/* Cover checks used by preflight */
function coverIssues() {
  const out = []; if (!cv) return out;
  const g = coverGeom(), P = PUBLISHERS[S.pub];
  // A Grid book's cover comes in as one finished picture of the whole wrap
  // (role gridcover): it fills the front, and leaves its own barcode space.
  const gridCover = cv.getObjects().some(o => o.role === 'gridcover');
  const objs = cv.getObjects().filter(o => o.role !== 'bg' && o.role !== 'bgimg' && o.role !== 'gridcover');
  const spineTexts = objs.filter(o => o.role === 'spine');
  if (spineTexts.length && pageCount() < P.spineTextMinPages) out.push({ sev: 'error', id: 'spine-text', msg: `Spine text is not allowed under ${P.spineTextMinPages} pages`, sub: `${P.short} rejects spine text on a ${pageCount()}-page book because the spine is only ${fmtIn(g.sp)} wide.`, fix: () => { spineTexts.forEach(o => cv.remove(o)); cv.requestRenderAll(); markDirty(); } });
  if (!spineTexts.length && pageCount() >= P.spineTextMinPages && S.meta.title) out.push({ sev: 'info', id: 'spine-add', msg: 'No spine text yet', sub: 'Your page count allows a title on the spine.', fix: () => { addSpineText(); cv.requestRenderAll(); markDirty(); } });
  const s = P.coverSafe * IN; const bc = P.barcode;
  const barcode = { l: (g.spineX - bc.from - bc.w) * IN, t: (g.H - g.b - bc.from - bc.h) * IN, r: (g.spineX - bc.from) * IN, b: (g.H - g.b - bc.from) * IN };
  let unsafe = 0, overBarcode = 0;
  objs.forEach(o => {
    const r = o.getBoundingRect(); const L = r.left, T = r.top, R = r.left + r.width, B = r.top + r.height;
    const isText = ['textbox', 'text', 'i-text', 'itext'].includes(cvType(o));
    if (isText) {
      const reg = regionOf(o.getCenterPoint().x, { spineX: g.spineX * IN, frontX: g.frontX * IN });
      let x0, x1; if (reg === 'back') { x0 = g.backX * IN + s; x1 = g.spineX * IN - s; } else if (reg === 'front') { x0 = g.frontX * IN + s; x1 = (g.frontX + g.w) * IN - s; } else { x0 = g.spineX * IN + P.spineTextClearance * IN; x1 = g.frontX * IN - P.spineTextClearance * IN; }
      if (L < x0 - 1 || R > x1 + 1 || T < g.b * IN + s - 1 || B > (g.b + g.h) * IN - s + 1) unsafe++;
    }
    if (o.role !== 'motif' && L < barcode.r && R > barcode.l && T < barcode.b && B > barcode.t && (isText || cvType(o) === 'image')) overBarcode++;
    if (cvType(o) === 'image' && o._element) { const dpi = o._element.naturalWidth / (o.width * o.scaleX / IN); if (dpi < 290) out.push({ sev: 'warn', id: 'cv-dpi', msg: `Cover image prints at ${Math.round(dpi)} DPI`, sub: 'Use an image with more pixels or make it smaller. 300 DPI is the print standard.' }); }
  });
  cv.getObjects().filter(o => o.role === 'bgimg' && o._element).forEach(o => { const dpi = o._element.naturalWidth / (o.width * o.scaleX / IN); if (dpi < 290) out.push({ sev: 'warn', id: 'cv-bgdpi', msg: `Cover background prints at ${Math.round(dpi)} DPI`, sub: `A full-wrap background needs about ${Math.round(g.W * 300)} × ${Math.round(g.H * 300)} pixels.` }); });
  if (unsafe) out.push({ sev: 'warn', id: 'cv-safe', msg: `${unsafe} text item${unsafe > 1 ? 's' : ''} on the cover cross the safe zone`, sub: `Keep text ${P.coverSafe} in inside the trim and clear of the spine folds. Open the Cover tab and drag it inside the blue guides.` });
  if (overBarcode) out.push({ sev: 'warn', id: 'cv-barcode', msg: 'Something overlaps the barcode area', sub: 'Move text and images out of the white box on the back cover.' });
  const front = objs.filter(o => o.getCenterPoint().x > g.frontX * IN); if (!front.length && !gridCover) out.push({ sev: 'error', id: 'cv-empty', msg: 'The front cover is empty', sub: 'Use Auto-design cover or add a title.', fix: () => autoDesignCover() });
  return out;
}

async function renderCoverDataURL(dpi) {
  await ensureCover(); cv.discardActiveObject(); cv.requestRenderAll();
  const fams = cv.getObjects().filter(o => o.fontFamily).map(o => o.fontFamily); await ensureFonts(fams);
  return cv.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: (dpi / IN) / cvZoom });
}

/* ---------- Preflight, one-click publisher fixes, export ---------- */
let lastIssues = [], applyLog = null;

function isbnValid(s) {
  const d = String(s || '').replace(/[^0-9X]/gi, '');
  if (d.length === 13) { let sum = 0; for (let i = 0; i < 12; i++) sum += +d[i] * (i % 2 ? 3 : 1); return (10 - sum % 10) % 10 === +d[12]; }
  if (d.length === 10) { let sum = 0; for (let i = 0; i < 10; i++) { const v = d[i].toUpperCase() === 'X' ? 10 : +d[i]; sum += v * (10 - i); } return sum % 11 === 0; }
  return false;
}
const lines = s => String(s || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
function nearestTrim(list) { const { w, h } = trimWH(); let best = list[0], bd = 1e9; list.forEach(t => { const [a, b] = TRIMS[t]; const d = Math.abs(a - w) + Math.abs(b - h); if (d < bd) { bd = d; best = t; } }); return best; }
function pageIsBlank(p) { const d = document.createElement('div'); d.innerHTML = p.html; return !d.textContent.trim() && !d.querySelector('img,table,.puzzle') && !p.bg; }

function smallTextCount() {
  const minPx = 7 * IN / 72 - 0.05; let n = 0;
  contentEls().forEach(c => $$('*', c).forEach(el => { if (el.closest('.pz-caption') || !el.childNodes.length) return; const hasText = [...el.childNodes].some(t => t.nodeType === 3 && t.nodeValue.trim()); if (hasText && parseFloat(getComputedStyle(el).fontSize) < minPx) n++; }));
  return n;
}
function fixSmallText() { const minPx = 7 * IN / 72; contentEls().forEach(c => $$('*', c).forEach(el => { if ([...el.childNodes].some(t => t.nodeType === 3 && t.nodeValue.trim()) && parseFloat(getComputedStyle(el).fontSize) < minPx - 0.05) el.style.fontSize = '7pt'; })); syncPagesFromDom(); }
function lowResImages() { let n = 0, worst = 999; contentEls().forEach(c => $$('img', c).forEach(img => { if (img.closest('.puzzle')) return; const d = imageDpi(img); if (d && d < 290) { n++; worst = Math.min(worst, d); } })); return { n, worst }; }
function textQualityCount() { let n = 0; contentEls().forEach(c => { const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const t = w.currentNode; if (t.parentElement.closest('.puzzle')) continue; const v = t.nodeValue; n += (v.match(/["']/g) || []).length + (v.match(/ {2,}/g) || []).length + (v.match(/--/g) || []).length; } }); return n; }
function hasColor() {
  let color = false; contentEls().forEach(c => $$('[style]', c).forEach(el => { const col = el.style.color || el.style.backgroundColor; if (col) { const m = col.match(/\d+/g); if (m && m.length >= 3 && (Math.abs(m[0] - m[1]) > 12 || Math.abs(m[1] - m[2]) > 12)) color = true; } }));
  return color || $$('#pages .content img').length > 0 || S.pages.some(p => p.bg);
}

async function runChecks(opts = {}) {
  syncPagesFromDom(); const P = PUBLISHERS[S.pub]; const n = pageCount(); const out = [];
  const add = (sev, id, msg, sub, fix, act) => out.push({ sev, id, msg, sub, fix, act });
  const toDetails = { label: 'Edit details', fn: () => showTab('details') };
  if (!S.meta.title.trim()) add('error', 'title', 'The book has no title', 'Add one in Book details. It is used on the cover, title page and metadata.', null, toDetails);
  if (typeof aiGapCount === 'function' && aiGapCount()) add('error', 'aigaps', `${aiGapCount()} removed spot${aiGapCount() === 1 ? ' is' : 's are'} still empty`, 'This copy had AI-made parts taken out. Write your own words or choose your own pictures for them, or leave them out.', null, { label: 'Fill them', fn: () => noaiOpenFill() });
  if (!S.meta.author.trim()) add('error', 'author', 'No author name', 'Add the author or pen name in Book details.', null, toDetails);
  if (!P.trims.includes(S.trim)) add('error', 'trim', `${P.short} does not print ${TRIM_LABEL(S.trim)}`, `Switch to a supported size, such as ${TRIM_LABEL(nearestTrim(P.trims))}.`, () => { S.trim = nearestTrim(P.trims); });
  const maxP = P.maxPagesFor ? P.maxPagesFor(S.trim, S.paper) : P.maxPages;
  if (n < P.minPages) add('error', 'minpages', `${n} pages is below the ${P.minPages}-page minimum`, `${P.short} needs at least ${P.minPages} pages. The fix adds ${P.minPages - n} blank "Notes" pages at the end; replace them with more puzzles if you like.`, () => padPages(P.minPages));
  if (n > maxP) add('error', 'maxpages', `${n} pages is over the ${maxP}-page maximum`, 'Split the book into volumes or use a larger trim size.');
  if (P.evenPages && n % 2) add('error', 'even', 'Page count must be even', `${P.short} requires an even number of pages.`, () => padPages(n + 1));
  if (P.lastPageBlank && !pageIsBlank(S.pages[n - 1])) add('error', 'lastblank', 'The last page must be blank', `${P.short} requires a blank final page.`, () => { S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); if (P.evenPages && S.pages.length % 2) S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); });
  if (!P.evenPages && n % 2) add('info', 'odd', 'Odd page count', 'Printers add a blank page at the end. Nothing to do unless you want to fill it.');
  const mm = P.minMargins(n, S.bleed); const low = Object.keys(mm).filter(k => S.margins[k] + 1e-6 < mm[k]);
  if (low.length) add('error', 'margins', `Margins too small: ${low.join(', ')}`, `${P.short} minimum for ${n} pages: inside ${mm.inside} in, outside ${mm.outside} in, top and bottom ${mm.top} in.`, () => { S.margins = P.margins(pageCount(), S.bleed); });
  const over = $$('#pages .page.overflow').length; if (over) add('error', 'overflow', `${over} page${over > 1 ? 's have' : ' has'} content cut off at the bottom`, 'Reflow moves the extra content onto following pages.', () => 'reflow');
  const lr = lowResImages(); if (lr.n) add('warn', 'dpi', `${lr.n} image${lr.n > 1 ? 's' : ''} below 300 DPI (lowest ${lr.worst} DPI)`, 'They may print blurry. Use a higher-resolution file or make the image smaller on the page.');
  const st = smallTextCount(); if (st) add('warn', 'smalltext', `${st} text item${st > 1 ? 's are' : ' is'} smaller than ${P.minFontPt} pt`, 'Print guidelines ask for at least 7 pt so text stays readable.', () => fixSmallText());
  const bgPages = S.pages.filter(p => p.bg).length;
  if (bgPages && !S.bleed) add('warn', 'bleed-off', `${bgPages} page${bgPages > 1 ? 's have' : ' has'} edge-to-edge art but bleed is off`, 'Without bleed, a thin white edge can appear after trimming.', () => { S.bleed = true; });
  if (S.bleed && !bgPages) add('info', 'bleed-unused', 'Bleed is on but nothing reaches the page edge', 'That is fine. Turn bleed off if you prefer smaller outside margins.');
  if (S.ink === 'bw' && hasColor()) add('info', 'gray', 'Color content in a black-and-white interior', 'Pages are converted to grayscale when you export, so check that colored text and images still read well.');
  const blanks = S.pages.slice(0, -1).filter(pageIsBlank).length; if (blanks) add('info', 'blanks', `${blanks} blank page${blanks > 1 ? 's' : ''} inside the book`, 'Fine for spacing or notes pages; delete them if they are accidental.');
  if (!S.folio.on) add('info', 'folio', 'Page numbers are off', 'Puzzle books usually number pages so readers can find answers.', () => { S.folio.on = true; });
  if (S.meta.title && !S.pages.some(p => p.front === 'title')) add('info', 'front', 'No title page or copyright page', 'The fix inserts both at the front using your book details.', () => insertFrontMatter(true));
  const tq = textQualityCount(); if (tq) add('info', 'text', `${tq} typography fix${tq > 1 ? 'es' : ''} available`, 'Straight quotes, double hyphens and double spaces. Auto-edit converts them.', () => autoEditText({ quotes: true, dashes: true, ellipsis: true, spaces: true }));
  // Metadata
  if (P.isbnRequired && !S.meta.isbn.trim()) add('error', 'isbn', `${P.short} requires your own ISBN`, 'Buy one from your national ISBN agency (Bowker in the US) and add it in Book details.', null, toDetails);
  if (S.meta.isbn.trim() && !isbnValid(S.meta.isbn)) add('error', 'isbn-bad', 'The ISBN is not valid', 'Check the digits; the last one is a check digit.', null, toDetails);
  const dl = S.meta.description.length; if (!dl) add('warn', 'desc', 'No book description', 'Retailers show this on your product page.', null, toDetails);
  if (dl > P.descMax) add('error', 'desc-long', `Description is ${dl} characters`, `${P.short} allows ${P.descMax}.`, null, toDetails);
  const kw = lines(S.meta.keywords); if (!kw.length) add('warn', 'kw', 'No keywords', `Add up to ${P.keywords} search keywords.`, null, toDetails);
  if (kw.length > P.keywords) add('warn', 'kw-many', `${kw.length} keywords; ${P.short} uses ${P.keywords}`, 'Extra keywords are dropped from the metadata sheet.', () => { S.meta.keywords = kw.slice(0, P.keywords).join('\n'); fillMetaForm(); });
  const cats = lines(S.meta.categories); if (cats.length > P.categories) add('warn', 'cats', `${cats.length} categories; ${P.short} accepts ${P.categories}`, 'Keep the most specific ones.', null, toDetails);
  // Cover
  if (opts.cover !== false) { try { await ensureCover(); coverIssues().forEach(i => out.push(i)); } catch (e) { add('warn', 'cover-load', 'Cover could not be checked', e.message); } }
  const rank = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.sev] - rank[b.sev]);
  lastIssues = out; renderIssues(); updateStatus();
  return out;
}

function padPages(target) {
  // Notes pages go before the answer key so solutions stay at the back
  while (S.pages.length < target) {
    const ansIdx = S.pages.findIndex(p => p.answers);
    const pg = { id: uid(), html: '<h2 class="center">Notes</h2><p><br></p>', notes: true };
    if (ansIdx >= 0) S.pages.splice(ansIdx, 0, pg); else S.pages.push(pg);
  }
}

function insertFrontMatter(quiet) {
  syncPagesFromDom(); const m = S.meta; const year = (m.pubDate || '').slice(0, 4) || new Date().getFullYear();
  S.pages = S.pages.filter(p => p.front !== 'title' && p.front !== 'copyright');
  const title = `<div style="height:2.2in"></div><h1 class="center" style="font-size:2.6em">${esc(m.title || 'Untitled')}</h1>${m.subtitle ? `<h2 class="center" style="font-weight:400">${esc(m.subtitle)}</h2>` : ''}<div style="height:.6in"></div><p class="center" style="font-size:1.25em">${esc(m.author || '')}</p>${m.imprint ? `<div style="height:2in"></div><p class="center">${esc(m.imprint)}</p>` : ''}`;
  const copy = `<div style="height:4.5in"></div><p style="font-size:9pt">Copyright © ${year} ${esc(m.copyright || m.author || '')}. All rights reserved.</p><p style="font-size:9pt">No part of this book may be reproduced in any form without written permission from the publisher, except for brief quotations in reviews.</p>${m.isbn ? `<p style="font-size:9pt">ISBN ${esc(m.isbn)}</p>` : ''}${m.edition ? `<p style="font-size:9pt">${esc(m.edition)}</p>` : ''}${m.imprint ? `<p style="font-size:9pt">Published by ${esc(m.imprint)}</p>` : ''}`;
  S.pages.unshift({ id: uid(), html: title, front: 'title', noFolio: true }, { id: uid(), html: copy, front: 'copyright', noFolio: true });
  if (!quiet) { renderPages(); refreshAll(); markDirty(); toast('Added a title page and a copyright page at the front'); }
}

async function applyIssueFix(issue) {
  snapshot('fix: ' + issue.msg); syncPagesFromDom();
  const r = issue.fix(); if (r && r.then) await r;
  if (r === 'reflow') { reflow(0, true); reflowAnswers(); }
  renderPages(); refreshUI(); onGeometryChanged(); markDirty();
  await nextFrame(); await runChecks();
}

/* One click: apply a publisher's specs and fix everything fixable */
async function applyPublisher() {
  const P = PUBLISHERS[S.pub]; const log = [];
  busy(`Applying ${P.name} specs`, 0.1); await nextFrame();
  snapshot('apply ' + P.short); syncPagesFromDom();
  if (!P.trims.includes(S.trim)) { const t = nearestTrim(P.trims); log.push(`Trim size changed to ${TRIM_LABEL(t)}`); S.trim = t; }
  if (S.pages.some(p => p.bg) && !S.bleed) { S.bleed = true; log.push('Bleed turned on for edge-to-edge pages'); }
  S.margins = P.margins(pageCount(), S.bleed); renderPages(); await nextFrame();
  busy('Fixing text and layout', 0.3);
  const ed = autoEditText({ quotes: true, dashes: true, ellipsis: true, spaces: true }); if (ed) log.push(`Auto-edited text (${ed} fixes)`);
  if (smallTextCount()) { fixSmallText(); log.push('Raised text below 7 pt to 7 pt'); }
  if (S.meta.title && !S.pages.some(p => p.front === 'title')) { insertFrontMatter(true); log.push('Added title and copyright pages'); }
  renderPages(); await nextFrame();
  if ($$('#pages .page.overflow').length) { const a = reflow(0, true); reflowAnswers(); log.push(`Reflowed overflowing pages${a ? ` (+${a} pages)` : ''}`); }
  busy('Checking page count', 0.55);
  if (pageCount() < P.minPages) { log.push(`Added ${P.minPages - pageCount()} Notes pages to reach the ${P.minPages}-page minimum`); padPages(P.minPages); }
  if (P.lastPageBlank && !pageIsBlank(S.pages[pageCount() - 1])) { S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); log.push('Added a blank last page'); }
  if (P.evenPages && pageCount() % 2) { S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); log.push('Added a page to make the count even'); }
  // gutter depends on page count, so set margins again
  const m2 = P.margins(pageCount(), S.bleed); S.margins = m2;
  log.push(`Margins set: inside ${m2.inside} in, outside ${m2.outside} in, top/bottom ${m2.top} in`);
  if (!S.folio.on) { S.folio.on = true; log.push('Page numbers turned on'); }
  const kw = lines(S.meta.keywords); if (kw.length > P.keywords) { S.meta.keywords = kw.slice(0, P.keywords).join('\n'); log.push(`Keywords trimmed to ${P.keywords}`); }
  renderPages(); refreshUI(); await nextFrame();
  if ($$('#pages .page.overflow').length) { reflow(0, true); reflowAnswers(); }
  busy('Updating cover', 0.75);
  try {
    await ensureCover(); onGeometryChanged();
    const sp = cv.getObjects().filter(o => o.role === 'spine');
    if (sp.length && pageCount() < P.spineTextMinPages) { sp.forEach(o => cv.remove(o)); log.push('Removed spine text (book is too thin)'); }
    if (!sp.length && pageCount() >= P.spineTextMinPages && S.meta.title) { addSpineText(); log.push('Added spine text'); }
    log.push(`Cover resized to ${coverGeom().W.toFixed(3)} × ${coverGeom().H.toFixed(3)} in with a ${fmtIn(spineIn())} spine`);
    cv.requestRenderAll();
  } catch (e) { log.push('Cover could not be updated: ' + e.message); }
  busy('Running checks', 0.9);
  markDirty(); await runChecks();
  busy(false);
  showTab('publish');
  applyLog = { pub: P.name, log }; renderIssues();
}

function renderIssues() {
  const box = $('#issues'); const sum = $('#checkSummary');
  const c = { error: 0, warn: 0, info: 0 }; lastIssues.forEach(i => c[i.sev]++);
  const errs = c.error;
  const applied = applyLog ? `<div class="card" style="flex-basis:100%"><h3>Applied ${esc(applyLog.pub)} specs</h3><ul class="plain">${applyLog.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="hint">${errs ? `${errs > 1 ? errs + ' items still need' : '1 item still needs'} you. They are listed below.` : 'Everything required is in place. Download the submission packet when you are ready.'}</p></div>` : '';
  sum.innerHTML = applied + `<span class="chip ${c.error ? 'error' : 'ok'}">${c.error ? c.error + ' must fix' : 'Ready to submit'}</span><span class="chip warn">${c.warn} warnings</span><span class="chip info">${c.info} notes</span>` + (lastIssues.some(i => i.fix) ? '<button class="btn" id="fixAll">Fix all automatically</button>' : '');
  if (!lastIssues.length) { box.innerHTML = '<div class="issue"><span class="chip ok">OK</span><div class="txt">No problems found for this publisher.</div><span></span></div>'; return; }
  box.innerHTML = '';
  lastIssues.forEach(i => {
    const row = document.createElement('div'); row.className = 'issue';
    row.innerHTML = `<span class="chip ${i.sev}">${i.sev === 'error' ? 'Must fix' : i.sev === 'warn' ? 'Warning' : 'Note'}</span><div class="txt">${esc(i.msg)}<small>${esc(i.sub || '')}</small></div><span></span>`;
    const slot = row.lastElementChild;
    if (i.fix) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Fix'; b.onclick = () => applyIssueFix(i); slot.appendChild(b); }
    else if (i.act) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = i.act.label; b.onclick = i.act.fn; slot.appendChild(b); }
    box.appendChild(row);
  });
  const fa = $('#fixAll'); if (fa) fa.onclick = async () => { snapshot('fix all'); for (const i of lastIssues.filter(x => x.fix)) { const r = i.fix(); if (r && r.then) await r; if (r === 'reflow') { reflow(0, true); reflowAnswers(); } renderPages(); await nextFrame(); } refreshUI(); onGeometryChanged(); markDirty(); await runChecks(); toast('Applied all automatic fixes'); };
}

/* ---------- Export ---------- */
function grayscaleCanvas(c) {
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height); const a = d.data;
  for (let i = 0; i < a.length; i += 4) { const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = y; }
  ctx.putImageData(d, 0, 0);
}
async function renderPageCanvas(i, dpi) {
  const host = $('#renderHost'); host.innerHTML = ''; applyBookVars(host);
  const { w, h } = trimWH(); const b = bleedIn(); const bi = bleedInsideIn(); const recto = i % 2 === 0;
  const sheet = document.createElement('div');
  const SW = w + b + bi, SH = h + 2 * b;
  Object.assign(sheet.style, { width: SW * IN + 'px', height: SH * IN + 'px', position: 'relative', background: '#fff', overflow: 'hidden' });
  const node = buildPageNode(i, true); node.style.position = 'absolute'; node.style.left = (recto ? bi : b) * IN + 'px'; node.style.top = b * IN + 'px'; node.style.boxShadow = 'none';
  sheet.appendChild(node); host.appendChild(sheet);
  await nextFrame(); fitGridBlocks(sheet);
  const canvas = await html2canvas(sheet, { scale: dpi / IN, backgroundColor: '#ffffff', logging: false, useCORS: true });
  if (S.ink === 'bw') grayscaleCanvas(canvas);
  host.innerHTML = '';
  return { canvas, SW, SH };
}
async function buildInteriorPDF(dpi) {
  await loadLibs('jspdf', 'html2canvas'); syncPagesFromDom();
  try { await document.fonts.ready; await ensureFonts([S.body.font, 'Courier Prime']); } catch (e) { }
  const { jsPDF } = window.jspdf; let pdf = null;
  const n = S.pages.length, started = Date.now();
  for (let i = 0; i < n; i++) {
    // Big books take minutes: say roughly how long is left once a few pages are done.
    const left = i >= 5 ? Math.round((Date.now() - started) / i * (n - i) / 60000) : 0;
    busy(`Rendering interior page ${i + 1} of ${n}${left >= 1 ? ` · about ${left} min left` : ''}`, i / n);
    const { canvas, SW, SH } = await renderPageCanvas(i, dpi);
    const orient = SW > SH ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ unit: 'in', format: [SW, SH], orientation: orient, compress: true });
    else pdf.addPage([SW, SH], orient);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, SW, SH, undefined, 'FAST');
    canvas.width = canvas.height = 0;
  }
  setPdfInfo(pdf, 'Interior');
  return pdf.output('blob');
}
async function buildCoverPDF(dpi) {
  await loadLibs('jspdf'); busy('Rendering cover', 0.5); const g = coverGeom();
  const url = await renderCoverDataURL(dpi); const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'in', format: [g.W, g.H], orientation: 'landscape', compress: true });
  pdf.addImage(url, 'JPEG', 0, 0, g.W, g.H, undefined, 'FAST'); setPdfInfo(pdf, 'Cover');
  return { blob: pdf.output('blob'), url };
}
async function buildFrontCoverJPG(dpi) {
  const g = coverGeom(); const full = await renderCoverDataURL(dpi);
  const img = await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = full; });
  const k = img.naturalWidth / g.W; const c = document.createElement('canvas'); c.width = Math.round(g.w * k); c.height = Math.round(g.h * k);
  c.getContext('2d').drawImage(img, g.frontX * k, g.b * k, g.w * k, g.h * k, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}
function setPdfInfo(pdf, part) { pdf.setProperties({ title: `${S.meta.title || 'Untitled'} - ${part}`, author: S.meta.author || '', subject: S.meta.subtitle || '', keywords: lines(S.meta.keywords).join(', '), creator: 'Puzzle Book Studio' }); }

function metadataObject() {
  const P = PUBLISHERS[S.pub]; const g = coverGeom(); const m = S.meta;
  return {
    publisher_platform: P.name, generated: new Date().toISOString(),
    title: m.title, subtitle: m.subtitle, author: m.author, contributors: m.contributors, series: m.series, series_number: m.seriesNo, edition: m.edition,
    imprint: m.imprint, isbn: m.isbn, publication_date: m.pubDate, language: m.language, list_price_usd: m.price, audience: m.audience, copyright_holder: m.copyright || m.author,
    description: m.description, back_cover_blurb: m.blurb, keywords: lines(m.keywords).slice(0, P.keywords), categories: lines(m.categories).slice(0, P.categories),
    print: { binding: 'Paperback (perfect bound)', trim_in: `${g.w} x ${g.h}`, interior_ink: S.ink === 'bw' ? 'Black & white' : 'Color', paper: S.paper, bleed: S.bleed, page_count: pageCount(), spine_width_in: +g.sp.toFixed(4), full_cover_in: `${g.W.toFixed(3)} x ${g.H.toFixed(3)}`, margins_in: S.margins }
  };
}
function metadataText() {
  const o = metadataObject(); const p = o.print; const P = PUBLISHERS[S.pub];
  const L = [`${o.title || 'Untitled'}${o.subtitle ? ': ' + o.subtitle : ''}`, `Metadata sheet for ${P.name}`, '='.repeat(60), '',
    `Title:            ${o.title}`, `Subtitle:         ${o.subtitle}`, `Author:           ${o.author}`, `Contributors:     ${o.contributors}`, `Series:           ${o.series}${o.series_number ? ' #' + o.series_number : ''}`,
    `Edition:          ${o.edition}`, `Imprint:          ${o.imprint}`, `ISBN:             ${o.isbn || (P.isbnRequired ? 'REQUIRED: add your ISBN' : 'Use the free ISBN offered by ' + P.short)}`, `Publication date: ${o.publication_date}`,
    `Language:         ${o.language}`, `List price (USD): ${o.list_price_usd}`, `Audience:         ${o.audience}`, `Copyright:        ${o.copyright_holder}`, '',
    'DESCRIPTION', '-'.repeat(60), o.description, '', 'KEYWORDS', '-'.repeat(60), ...o.keywords.map((k, i) => `${i + 1}. ${k}`), '', 'CATEGORIES', '-'.repeat(60), ...o.categories, '',
    'PRINT SPECIFICATIONS', '-'.repeat(60), `Binding:      ${p.binding}`, `Trim size:    ${p.trim_in} in`, `Interior:     ${p.interior_ink} on ${p.paper} paper`, `Bleed:        ${p.bleed ? 'Yes (0.125 in)' : 'No'}`,
    `Page count:   ${p.page_count}`, `Spine width:  ${p.spine_width_in} in`, `Full cover:   ${p.full_cover_in} in (including 0.125 in bleed)`,
    `Margins:      top ${p.margins_in.top}, bottom ${p.margins_in.bottom}, inside ${p.margins_in.inside}, outside ${p.margins_in.outside} in`];
  return L.join('\n');
}
function checklistText(files) {
  const P = PUBLISHERS[S.pub]; const errs = lastIssues.filter(i => i.sev === 'error');
  return [`${P.name} submission checklist`, '='.repeat(60), '',
    'Files in this packet:', ...files.map(f => '  - ' + f), '',
    'Steps:', `  1. Sign in at ${P.links.submit || P.links.guide || 'your printer\'s site'} and start a new paperback.`,
    '  2. Copy title, author, description, keywords and categories from metadata.txt.',
    `  3. Choose trim ${coverGeom().w} x ${coverGeom().h} in, ${S.ink === 'bw' ? 'black & white' : 'color'} interior on ${S.paper} paper, bleed ${S.bleed ? 'ON' : 'OFF'}.`,
    '  4. Upload the interior PDF, then the cover PDF.', '  5. Open the online previewer and look at every page.', '  6. Order a printed proof before you publish.', '',
    'Publisher notes:', ...P.notes.map(n => '  - ' + n), '',
    errs.length ? 'OPEN ISSUES (fix before submitting):' : 'Preflight: no blocking issues.', ...errs.map(e => '  - ' + e.msg + '. ' + (e.sub || '')), '',
    P.links.cover ? `Confirm the cover size with the official calculator: ${P.links.cover}` : 'Confirm the cover size with the printer\'s cover template tool.'
  ].join('\n');
}
function reportText() {
  const P = PUBLISHERS[S.pub];
  return [`Preflight report: ${S.meta.title || 'Untitled'} for ${P.name}`, `Generated ${new Date().toLocaleString()}`, '',
    ...(lastIssues.length ? lastIssues.map(i => `[${i.sev === 'error' ? 'MUST FIX' : i.sev === 'warn' ? 'WARNING' : 'NOTE'}] ${i.msg}\n    ${i.sub || ''}`) : ['No problems found.']), '',
    'Spec values follow the project publisher spec sheet (2026-11-05). Some numbers are safe defaults where the publisher does not publish one; confirm in the publisher\'s calculator.'].join('\n');
}

// In Grid Admin, every export checks in first (auth.js); the stand-alone build has no check.
const mayExport = async (kind) => {
  // A copy without AI content prints nothing until every removed spot is filled or left out.
  if (typeof aiGapCount === 'function' && aiGapCount()) { toast(`Fill or leave out the ${aiGapCount()} removed spot${aiGapCount() === 1 ? '' : 's'} first (Project › Fill the removed spots).`, 6000); noaiOpenFill(); return false; }
  return typeof checkInExport === 'function' ? checkInExport(kind) : true;
};
async function exportPacket() {
  if (!(await mayExport('packet'))) return;
  allowCancel();
  const dpi = +$('#dpi').value; const base = slug(S.meta.title) + '-' + slug(PUBLISHERS[S.pub].short);
  try {
    busy('Checking the book', 0.02); await runChecks();
    await loadLibs('jszip');
    const interior = await buildInteriorPDF(dpi);
    const cover = await buildCoverPDF(dpi);
    busy('Preparing front cover image', 0.92); const front = await buildFrontCoverJPG(Math.min(dpi, 300));
    busy('Packing the submission packet', 0.96);
    syncPagesFromDom(); syncCoverToState();
    const files = [`${base}-interior.pdf`, `${base}-cover.pdf`, `${base}-front-cover.jpg`, 'metadata.txt', 'metadata.json', 'preflight-report.txt', 'SUBMISSION-CHECKLIST.txt', `${base}-project.json`];
    const zip = new JSZip(); const dir = zip.folder(base + '-packet');
    dir.file(files[0], interior); dir.file(files[1], cover.blob); dir.file(files[2], front);
    dir.file('metadata.txt', metadataText()); dir.file('metadata.json', JSON.stringify(metadataObject(), null, 2));
    dir.file('preflight-report.txt', reportText()); dir.file('SUBMISSION-CHECKLIST.txt', checklistText(files));
    dir.file(files[7], JSON.stringify(S));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    busy('Saving', 1); busy(false);
    if ((await saveFile(base + '-submission-packet.zip', blob)) && typeof ppRecordExport === 'function') ppRecordExport('packet');
  } catch (e) { exportFailed(e); }
}
// Cancel on the progress card ends an export quietly; anything else is reported.
function exportFailed(e) {
  busy(false);
  if (e && e.code === 'cancelled') { toast('Export cancelled. Nothing was saved.'); return; }
  console.error(e); toast('Export failed: ' + ((e && e.message) || e), 7000);
}
async function exportInterior() { if (!(await mayExport('interior'))) return; allowCancel(); try { const b = await buildInteriorPDF(+$('#dpi').value); busy('Saving', 1); busy(false); if ((await saveFile(slug(S.meta.title) + '-interior.pdf', b)) && typeof ppRecordExport === 'function') ppRecordExport('interior'); } catch (e) { exportFailed(e); } }
async function exportCover() { if (!(await mayExport('cover'))) return; allowCancel(); try { const { blob } = await buildCoverPDF(+$('#dpi').value); busy('Saving', 1); busy(false); await saveFile(slug(S.meta.title) + '-cover.pdf', blob); } catch (e) { exportFailed(e); } }

function renderPubCard() {
  const P = PUBLISHERS[S.pub]; const g = coverGeom(); const n = pageCount(); const rec = P.margins(n, S.bleed);
  $('#pubSpecs').innerHTML = `<dt>Trim sizes</dt><dd>${P.trims.length} supported</dd><dt>Page count</dt><dd>${P.minPages}–${P.maxPagesFor ? P.maxPagesFor(S.trim, S.paper) : P.maxPages}</dd><dt>Bleed</dt><dd>0.125 in ${P.bleedRule === 'all' ? '(all sides)' : '(outside, top, bottom)'}</dd><dt>Gutter at ${n} pp</dt><dd>${gutterFrom(P.gutter, n)} in min</dd><dt>Recommended margins</dt><dd>${rec.inside} / ${rec.outside} / ${rec.top} in</dd><dt>Spine</dt><dd>${fmtIn(g.sp)}</dd><dt>Spine text from</dt><dd>${P.spineTextMinPages} pages</dd><dt>ISBN</dt><dd>${P.isbnRequired ? 'required' : 'optional'}</dd><dt>Images</dt><dd>${P.minDpi} DPI min</dd>`;
  $('#pubNotes').innerHTML = P.notes.map(n => `<li>${esc(n)}</li>`).join('');
  const L = P.links; $('#pubLinks').innerHTML = [L.guide && `<a href="${L.guide}" target="_blank" rel="noopener">Print guidelines</a>`, L.cover && `<a href="${L.cover}" target="_blank" rel="noopener">Cover calculator</a>`, L.submit && `<a href="${L.submit}" target="_blank" rel="noopener">Submit</a>`].filter(Boolean).join(' · ');
}

/* ---------- Grid books: books made from the game's own puzzles ----------
   The Grid books tab (Grid Admin build, auth.js) runs the dashboard's Books
   and covers (admin/books.js): the Book maker, saved books, cover templates
   and Mark as published. "Open in the editor" there hands a book to
   importGridBook(), which turns its pages into editor pages:
   - title, copyright, notes and other text pages stay editable;
   - puzzles, answer keys, contents and how-to-play pages are fixed blocks,
     shrunk to fit the page (each game's print styles come with the book);
   - the cover comes in as one picture on the cover canvas, to keep or redo. */

// Scripts, frames, forms and event attributes never come in; Book Studio's
// page policy (script-src 'self') is the second line.
const GRID_DROP = 'script,iframe,frame,object,embed,applet,link,meta,base,style,form,input,button,select,textarea,template,noscript,foreignObject,portal';
function sanitizeGridHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html');
  $$(GRID_DROP, doc).forEach(e => e.remove());
  $$('*', doc.body).forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase(); const v = a.value.replace(/[\u0000- \u007f-\u009f]/g, '');
      if (n.startsWith('on') || n === 'contenteditable' || n === 'srcdoc' || n === 'formaction' || n === 'action') el.removeAttribute(a.name);
      else if (/(^|:)href$|^src$|^xlink:href$/.test(n) && !/^(#|data:image\/(png|jpe?g|gif|webp);|https?:)/i.test(v)) el.removeAttribute(a.name);
      else if (n === 'style' && /url\s*\(|expression\s*\(/i.test(v)) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}
// Each game's print styles, already scoped to .bk-g-<game>: no outside fetches.
// They go in as a <style> element's textContent, which is never parsed as HTML.
function cleanGridCss(css) {
  return String(css || '').replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/url\s*\([^)]*\)/gi, 'none').slice(0, 400_000);
}
function applyGridCss() {
  let el = $('#gridBookCss');
  const css = S.gridCss || '';
  if (!css) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'gridBookCss'; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

// One page of a Grid book (from admin/books.js layout()) as editor HTML.
function gridPageHtml(pg) {
  const body = sanitizeGridHTML(pg.body || '');
  const head = pg.head ? `<div class="bk-head" contenteditable="false">${sanitizeGridHTML(pg.head)}</div>` : '';
  const block = (inner) => `<div class="grid-room"><div class="grid-block" contenteditable="false">${inner}</div></div>`;
  if (pg.kind === 'key') {
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
    const keys = $$('.bk-key', doc.body).map(k => {
      const h = k.querySelector('.bk-keyh'); const fit = k.querySelector('.bk-fit');
      return `<div class="grid-key">${h ? `<p class="bk-keyh">${h.innerHTML}</p>` : ''}${block(fit ? fit.outerHTML : '')}</div>`;
    });
    return `<div class="grid-page">${head}${keys.join('')}</div>`;
  }
  if (pg.kind === 'puzzle' || pg.fitAll) return `<div class="grid-page">${head}${block(pg.kind === 'puzzle' ? body : `<div class="bk-fit">${body}</div>`)}</div>`;
  return `<div class="grid-page grid-text">${head}${body}</div>`;
}

// Shrink each fixed block to its room (also before each page is drawn for export).
// The contents are laid out at the room's width, and wider when they must
// shrink, so a puzzle's story and clues rewrap into the space the shrinking
// makes instead of running off the page (as the Book maker's fitPages does).
function fitGridBlocks(root) {
  $$('.grid-room > .grid-block', root).forEach(b => {
    const room = b.parentElement; b.style.transform = ''; b.style.width = '';
    const w = room.clientWidth, h = room.clientHeight;
    const fit = b.firstElementChild;
    const size = () => [Math.max(b.scrollWidth, fit ? fit.scrollWidth : 0), b.scrollHeight];
    let [cw, ch] = size();
    if (!w || !h || !cw || !ch) return;
    let s = Math.min(1, w / cw, h / ch);
    for (let k = 0; k < 4 && s < 0.999; k++) {
      b.style.width = `${w / s}px`;
      [cw, ch] = size();
      const next = Math.max(0.1, Math.min(1, w / cw, h / ch));
      if (Math.abs(next - s) < 0.005) { s = Math.min(s, next); break; }
      s = next;
    }
    if (s < 0.999) {
      // Some boards grow with the space they get: measure once more at the final width.
      b.style.width = `${w / s}px`; [cw, ch] = size();
      s = Math.max(0.1, Math.min(s, w / cw, h / ch));
      b.style.width = `${w / s}px`; b.style.transform = `scale(${s.toFixed(4)})`;
    } else b.style.width = '';
  });
}

// A book from the Grid books tab: { title, subtitle, author, trim, paper, isbn,
// pages: [{ kind, head, body, front, fitAll }], css, coverSvg }.
async function importGridBook(g) {
  const p = blankProject();
  p.pub = PUBLISHERS[g.pub] ? g.pub : S.pub || 'kdp';
  const trim = String(g.trim || '6x9');
  p.trim = TRIMS[trim] ? trim : (PUBLISHERS[p.pub].defaultTrim || '6x9');
  p.paper = g.paper === 'cream' ? 'cream' : 'white';
  p.meta = { ...p.meta, title: String(g.title || '').slice(0, 200), subtitle: String(g.subtitle || '').slice(0, 200), author: String(g.author || '').slice(0, 120), copyright: String(g.author || '').slice(0, 120), isbn: String(g.isbn || '').slice(0, 20), pubDate: new Date().toISOString().slice(0, 10),
    ...(g.description ? { description: String(g.description).slice(0, 4000), blurb: String(g.description).slice(0, 4000) } : {}), ...(g.keywords ? { keywords: String(g.keywords).slice(0, 500) } : {}) };
  p.gridCss = cleanGridCss(g.css);
  p.gridBook = String(g.id || '');
  // The book's own title and copyright pages count as the front matter, so Apply
  // specs does not add a second pair (and the page count asked for holds).
  p.pages = (g.pages || []).map(pg => ({ id: uid(), html: gridPageHtml(pg), grid: pg.kind, noFolio: !!pg.front, ...(pg.kind === 'answers' ? { answers: true } : {}), ...(pg.kind === 'title' || pg.kind === 'copyright' ? { front: pg.kind } : {}) }));
  if (!p.pages.length) p.pages = [{ id: uid(), html: '<p><br></p>' }];
  p.cover = null;
  loadProject(p);
  showTab('manuscript');
  if (g.coverSvg) {
    try { await ensureCover(); await placeGridCover(g.coverSvg); } catch (e) { toast('The cover did not come in. Use Auto-design cover on the Cover tab.', 6000); }
  }
  markDirty();
  toast(`Opened “${p.meta.title || 'the book'}” from Grid books. Pick a publisher and press Apply specs.`, 6000);
}
async function placeGridCover(svg) {
  // Drawn as an image: an SVG shown as an <img> never runs scripts or loads anything.
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svg));
  const img = await fabric.Image.fromURL(url).then((o) => { if (!o || !o.width) throw new Error('no image'); return o; });
  const g = coverGeom();
  cv.clear(); cv.backgroundColor = '#ffffff';
  img.set({ left: 0, top: 0, scaleX: (g.W * IN) / img.width, scaleY: (g.H * IN) / img.height, selectable: false, evented: false });
  img.role = 'gridcover';
  cv.add(img); cv.requestRenderAll(); syncCoverToState();
}

/* Make the whole book for me (Grid books, Make it from a topic): open the
   book here, apply the publisher's specs, check every page and setting, and
   make the submission packet. Anything only the person can fix (an ISBN the
   publisher requires, say) stops it on the Publish tab with the list. */
async function submitGridBook(g, pub) {
  await importGridBook({ ...g, pub });
  await applyPublisher();
  const issues = await runChecks();
  const errors = issues.filter(i => i.sev === 'error');
  if (errors.length) {
    showTab('publish');
    toast(`Almost ready for ${PUBLISHERS[S.pub].short}: ${errors.length} thing${errors.length === 1 ? '' : 's'} to fix on the Publish tab, then Export the submission packet.`, 10000);
    return { ready: false, errors: errors.map(e => e.msg) };
  }
  await exportPacket();
  showTab('publish');
  return { ready: true };
}


/* ---------- Writing tools: QuillBot and Scribbr ----------
   Neither QuillBot nor Scribbr has a public API, so Book Studio hands text to
   their own web tools: a button copies the text and opens the tool in a new
   tab (the writer's own account, the normal browser in the desktop app), and
   the fixed text is pasted back here and put back where it came from: the
   selected passage or paragraph in the manuscript, a Book details field, or a
   text box on the cover. Nothing is sent anywhere by Book Studio itself. */
const WRITING_TOOLS = [
  { site: 'QuillBot', name: 'Paraphraser', url: 'https://quillbot.com/paraphrasing-tool' },
  { site: 'QuillBot', name: 'Grammar Checker', url: 'https://quillbot.com/grammar-check' },
  { site: 'QuillBot', name: 'Summarizer', url: 'https://quillbot.com/summarize' },
  { site: 'QuillBot', name: 'AI Detector', url: 'https://quillbot.com/ai-content-detector' },
  { site: 'QuillBot', name: 'Plagiarism Checker', url: 'https://quillbot.com/plagiarism-checker' },
  { site: 'Scribbr', name: 'Grammar Checker', url: 'https://www.scribbr.com/grammar-checker/' },
  { site: 'Scribbr', name: 'Paraphraser', url: 'https://www.scribbr.com/paraphrasing-tool/' },
  { site: 'Scribbr', name: 'AI Detector', url: 'https://www.scribbr.com/ai-detector/' },
  { site: 'Scribbr', name: 'Plagiarism Checker', url: 'https://www.scribbr.com/plagiarism-checker/' },
  { site: 'Scribbr', name: 'Citation Generator', url: 'https://www.scribbr.com/citation/generator/', noText: true },
];
const WT_META = ['title', 'subtitle', 'description', 'blurb'];
let wtTarget = null, wtLastMeta = 'description';

const wtWords = t => (t.trim().match(/\S+/g) || []).length;

// The manuscript passage: the selection, or the whole paragraph the cursor is in.
function wtPageTarget() {
  const r = savedRange; if (!r) return null;
  const c = r.commonAncestorContainer; const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
  if (!host || !document.contains(host)) return null;
  if (!r.collapsed) {
    const text = window.getSelection().toString() || r.toString();
    return text.trim() ? { kind: 'page', range: r.cloneRange(), text, what: 'the selected text' } : null;
  }
  let block = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  while (block && block.parentElement !== host) block = block.parentElement;
  if (!block || block === host || block.closest('.puzzle, .grid-room, .grid-block') || block.querySelector('.puzzle, .grid-room, img, table')) return null;
  const text = block.innerText.trim(); if (!text) return null;
  const range = document.createRange(); range.selectNodeContents(block);
  return { kind: 'page', range, text, what: 'this paragraph' };
}

function openWriting(target) {
  wtTarget = target;
  const t = $('#wtText'); t.value = target ? target.text : '';
  $('#wtResult').value = '';
  $('#wtFrom').textContent = target
    ? `Working on ${target.what}. Pick a tool, then paste the fixed text below and press Put it back.`
    : 'Nothing was selected, so type or paste text here. To fix text in the book, select it (or click in a paragraph) first.';
  $('#wtApply').disabled = !target;
  wtCount(); openDlg('#dlgWrite'); t.focus();
}
function wtCount() {
  const n = wtWords($('#wtText').value);
  $('#wtCount').textContent = `${n} word${n === 1 ? '' : 's'}${n > 125 ? ' · QuillBot\'s free Paraphraser takes 125 words at a time' : ''}`;
}

function wtOpenTool(tool) {
  const t = $('#wtText'); const text = t.value;
  if (!tool.noText) {
    if (!text.trim()) { toast('Type or select some text first'); t.focus(); return; }
    // Copy straight away (inside the click), before the new tab takes focus.
    t.focus(); t.select(); let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { }
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
    t.setSelectionRange(text.length, text.length);
  }
  const w = window.open(tool.url, '_blank', 'noopener');
  if (w === null && !window.__FLG_BOOK_STUDIO_DESKTOP__) toast(`Your browser blocked the new tab. Allow pop-ups for Book Studio, or open ${tool.url}`, 7000);
  else toast(tool.noText ? `Opened Scribbr's ${tool.name}` : `Copied. Paste it into ${tool.site}'s ${tool.name} with Ctrl+V (⌘V on a Mac), then copy the result and come back.`, 6000);
}

async function wtPaste() {
  const r = $('#wtResult');
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) { r.value = text.trim(); toast('Pasted'); return; }
    toast('The clipboard is empty. Copy the result in QuillBot or Scribbr first.');
  } catch (e) { toast('Click in the box and press Ctrl+V (⌘V on a Mac) to paste'); }
  r.focus();
}

function wtApply() {
  const v = $('#wtResult').value.trim(); const tg = wtTarget;
  if (!v) { toast('Paste the fixed text into the second box first'); $('#wtResult').focus(); return; }
  if (!tg) return;
  if (tg.kind === 'page') {
    const c = tg.range.commonAncestorContainer; const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
    if (!host || !document.contains(host)) { toast('That page changed. Select the text again, then use Writing tools.'); return; }
    closeDlg('#dlgWrite');
    host.focus({ preventScroll: true });
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(tg.range);
    const paras = v.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paras.length > 1) document.execCommand('insertHTML', false, paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
    else if (v.includes('\n')) document.execCommand('insertHTML', false, esc(v).replace(/\n/g, '<br>'));
    else document.execCommand('insertText', false, v);
    afterEdit();
  } else if (tg.kind === 'meta') {
    tg.el.value = v; tg.el.dispatchEvent(new Event('input', { bubbles: true }));
    closeDlg('#dlgWrite');
  } else if (tg.kind === 'cover') {
    if (!cv || !cv.getObjects().includes(tg.obj)) { toast('That text box is gone. Select one and try again.'); return; }
    if (tg.obj.isEditing) tg.obj.exitEditing();
    tg.obj.set('text', v); tg.obj.setCoords(); cv.requestRenderAll(); markDirty();
    closeDlg('#dlgWrite');
  }
  wtTarget = null; toast('Put back in your book');
}

function wireWriting() {
  const row = site => WRITING_TOOLS.filter(t => t.site === site).map(t => `<button class="btn" type="button" data-wt="${WRITING_TOOLS.indexOf(t)}">${esc(t.name)}</button>`).join('');
  $('#wtQuill').innerHTML = row('QuillBot'); $('#wtScribbr').innerHTML = row('Scribbr');
  $$('#dlgWrite [data-wt]').forEach(b => b.onclick = () => wtOpenTool(WRITING_TOOLS[+b.dataset.wt]));
  $('#wtText').addEventListener('input', wtCount);
  $('#wtPaste').onclick = wtPaste; $('#wtApply').onclick = wtApply;
  // Manuscript: the selection, or the paragraph with the cursor.
  $('#writeBtn').onclick = () => openWriting(wtPageTarget());
  // Book details: the last of title, subtitle, description or blurb you were in.
  WT_META.forEach(k => $(`[data-meta="${k}"]`)?.addEventListener('focus', () => { wtLastMeta = k; }));
  $('#writeMeta').onclick = () => {
    const el = $(`[data-meta="${wtLastMeta}"]`);
    const label = { title: 'the title', subtitle: 'the subtitle', description: 'the description', blurb: 'the back cover blurb' }[wtLastMeta];
    openWriting({ kind: 'meta', el, text: el.value, what: label });
  };
  // Cover: the selected text box.
  $('#cvWrite').onclick = () => {
    const o = cv?.getActiveObject();
    if (!o || typeof o.text !== 'string') { toast('Click a text box on the cover first'); return; }
    openWriting({ kind: 'cover', obj: o, text: o.text, what: 'the selected cover text' });
  };
}

/* ---------- Make a copy without AI content (Project menu) ----------
   Makes a new book from the one open, leaving the original exactly as it is,
   with the AI-made parts taken out, so KDP's AI question can honestly be
   answered "None" for the copy:

   1. Review: every picture (pages and cover) and every block of words
      (pages, cover text, description, back cover blurb) is listed. Pictures
      whose file says an AI made them (C2PA / IPTC "trained algorithmic
      media", AI image tools' prompt notes) come ticked. Words can't be
      told apart, so you tick the ones an AI wrote. Puzzles made by Book
      Studio's generators or the game's engines are not AI and are not listed.
   2. The copy: the original is synced (or saved as a project file in the
      stand-alone build), then a new book opens with each ticked part taken
      out and a marked empty spot in its place.
   3. Fill: each empty spot opens in turn with a text box to write what goes
      there instead (or your own picture, for a picture), Leave it out, or
      Later. Project > Fill the removed spots comes back to the rest, and the
      Publish check stops an export while any are empty. */

const NOAI_MARKS = [
  [/trainedAlgorithmicMedia/i, 'the file is labelled as made by an AI'],
  [/c2pa|jumbf/i, 'the file carries a Content Credentials (C2PA) record'],
  [/Stable[ _-]?Diffusion|sd_xl|SDXL/i, 'made with Stable Diffusion'],
  [/DALL[·· _-]?E|OpenAI/i, 'made with DALL·E'],
  [/Midjourney/i, 'made with Midjourney'],
  [/Firefly/i, 'made with Adobe Firefly'],
  [/Imagen|SynthID|Gemini/i, 'made with Google Imagen or Gemini'],
  [/Workers AI|@cf\/(?:black-forest-labs|stabilityai|bytedance|lykon|runwayml)/i, 'made with Cloudflare Workers AI'],
  [/ComfyUI|NovelAI|Leonardo\.Ai|Ideogram|DreamStudio|Flux\.1|black-forest-labs/i, 'made with an AI image tool'],
  [/Negative prompt:|Steps: \d+, Sampler:/, 'the file holds an AI image prompt'],
];
// The first and last part of a picture's file, where its labels are kept.
function noaiPictureWhy(src) {
  const s = String(src || '');
  const m = /^data:([^;,]+)(;base64)?,/.exec(s);
  if (!m) return '';
  let text = '';
  try {
    const body = s.slice(m[0].length);
    if (!m[2]) text = decodeURIComponent(body.slice(0, 600_000));
    else {
      const head = body.slice(0, 700_000 - (700_000 % 4));
      const tailStart = Math.max(head.length, body.length - 200_000);
      const tail = body.slice(tailStart - (tailStart % 4));
      text = atob(head) + (tail.length && tailStart > head.length ? atob(tail) : '');
    }
  } catch (e) { return ''; }
  const hit = NOAI_MARKS.find(([re]) => re.test(text));
  return hit ? hit[1] : '';
}

const NOAI_TEXT_BLOCKS = 'p,h1,h2,h3,h4,ul,ol,blockquote,table,pre,div';
const noaiShort = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// One page's pictures and blocks of words, in order, read from the page as
// the editor shows it (never re-parsed from text). Puzzles and the game's
// fixed puzzle blocks are left out: engines made them, not an AI.
function noaiScanPage(root) {
  const skip = (el) => el.closest('.puzzle,.grid-block,.grid-room,.bk-head,.ai-gap');
  const out = [];
  const walk = (el) => {
    for (const c of [...el.children]) {
      if (skip(c)) continue;
      if (c.tagName === 'IMG') { out.push({ type: 'pic', el: c }); continue; }
      const imgs = $$('img', c).filter(i => !skip(i));
      if (c.matches(NOAI_TEXT_BLOCKS) && c.tagName === 'DIV' && c.querySelector(NOAI_TEXT_BLOCKS)) { walk(c); continue; }
      if (c.textContent.trim() && c.matches(NOAI_TEXT_BLOCKS + ',span,b,i,em,strong')) out.push({ type: 'text', el: c });
      imgs.forEach(i => out.push({ type: 'pic', el: i }));
    }
  };
  if (root) walk(root);
  return { items: out };
}

// Everything that could have come from an AI, for the review list.
function noaiCollect() {
  syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState();
  const items = [];
  S.pages.forEach((pg, pi) => {
    if (pg.grid) return; // a Grid book's puzzle pages: made by the game's engines
    noaiScanPage(contentEls()[pi]).items.forEach((it, k) => {
      const src = it.type === 'pic' ? it.el.getAttribute('src') || '' : '';
      items.push({ key: `p${pi}:${k}`, where: `Page ${pi + 1}`, page: pi, k, type: it.type, src, text: it.type === 'text' ? it.el.textContent : '', tag: it.el.tagName.toLowerCase(), why: it.type === 'pic' ? noaiPictureWhy(src) : '' });
    });
  });
  (S.cover?.objects || []).forEach((o, k) => {
    if (o.role === 'gridcover' || o.role === 'bg' || o.role === 'spine' || /^aigap/.test(o.role || '')) return; // the game's own cover picture, plain shapes
    if (cvType(o) === 'image') items.push({ key: `c${k}`, where: 'Cover', k, type: 'coverpic', src: o.src || '', why: noaiPictureWhy(o.src) });
    else if (/textbox|i-?text|text/.test(cvType(o)) && String(o.text || '').trim()) items.push({ key: `c${k}`, where: 'Cover', k, type: 'covertext', text: o.text, role: o.role });
  });
  [['description', 'Description'], ['blurb', 'Back cover blurb']].forEach(([f, label]) => {
    if (String(S.meta[f] || '').trim()) items.push({ key: `m:${f}`, where: label, type: 'meta', field: f, text: S.meta[f] });
  });
  return items;
}

let noaiItems = [];
let noaiWas = {}; // what each removed spot held, this visit only: never saved into the copy
let noaiQueue = [], noaiAt = 0;

function noaiOpenReview() {
  closeDlg('#dlgProject');
  noaiItems = noaiCollect();
  const flagged = noaiItems.filter(i => i.why).length;
  const groups = {};
  noaiItems.forEach(i => { (groups[i.where] ||= []).push(i); });
  const row = (i) => {
    const what = i.type === 'pic' || i.type === 'coverpic'
      ? `<img class="noai-thumb" src="${esc(i.src)}" alt=""><span>Picture${i.why ? ` <b class="noai-flag">AI label found: ${esc(i.why)}</b>` : ''}</span>`
      : `<span>${i.type === 'covertext' ? 'Cover words: ' : ''}${esc(noaiShort(i.text))}</span>`;
    return `<label class="noai-item"><input type="checkbox" data-noai="${esc(i.key)}"${i.why ? ' checked' : ''}> ${what}</label>`;
  };
  $('#noaiList').innerHTML = noaiItems.length ? Object.entries(groups).map(([g, list]) => `<fieldset class="noai-group"><legend>${esc(g)} <button class="btn ghost" type="button" data-noai-all="${esc(g)}">Tick all</button></legend>${list.map(row).join('')}</fieldset>`).join('')
    : '<p class="hint">Nothing to review: this book has no pictures or words of its own outside the puzzles.</p>';
  $('#noaiSummary').textContent = `${noaiItems.length} part${noaiItems.length === 1 ? '' : 's'} to look at${flagged ? `, ${flagged} picture${flagged === 1 ? '' : 's'} labelled as AI-made (ticked)` : ''}. Tick everything an AI made; the rest stays in the copy.`;
  noaiCount();
  openDlg('#dlgNoAi');
}
function noaiCount() {
  const n = $$('[data-noai]:checked').length;
  $('#noaiMake').textContent = n ? `Make the copy without ${n} part${n === 1 ? '' : 's'}` : 'Make the copy';
}

async function noaiMakeCopy() {
  const picked = new Set($$('[data-noai]:checked').map(c => c.dataset.noai));
  closeDlg('#dlgNoAi');
  busy('Keeping the original safe');
  try {
    syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState();
    // The original stays as it is: on the account (synced first), or as a project file here.
    const synced = typeof syPush === 'function' && typeof syReady !== 'undefined' && syReady && typeof gaMe !== 'undefined' && gaMe;
    if (synced) await syPush();
    else await saveFile(slug(S.meta.title) + '-original-project.json', JSON.stringify(S));
    busy('Making the copy');
    const copy = JSON.parse(JSON.stringify(S));
    delete copy.syncId;
    copy.noAi = { from: S.syncId || '', title: S.meta.title || '', at: new Date().toISOString().slice(0, 10) };
    copy.aiGaps = [];
    noaiWas = {};
    const gap = (g, was) => { g.id = 'g' + uid(); copy.aiGaps.push(g); noaiWas[g.id] = was; return g.id; };
    // Cover: the part comes off, and a dashed box keeps its place.
    const objs = copy.cover?.objects || [];
    const coverPicked = noaiItems.filter(i => picked.has(i.key) && (i.type === 'coverpic' || i.type === 'covertext')).sort((a, b) => b.k - a.k);
    coverPicked.forEach(i => {
      const o = objs[i.k]; if (!o) return;
      const w = (o.width || 100) * (o.scaleX || 1), h = (o.height || 40) * (o.scaleY || 1);
      const style = i.type === 'covertext' ? Object.fromEntries(['left', 'top', 'width', 'originX', 'originY', 'angle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fill', 'textAlign', 'lineHeight', 'role'].filter(k => o[k] != null).map(k => [k, o[k]])) : null;
      const id = gap({ kind: i.type === 'coverpic' ? 'coverpic' : 'covertext', where: 'Cover', box: { left: o.left, top: o.top, originX: o.originX || 'left', originY: o.originY || 'top', angle: o.angle || 0, w, h }, style }, i.type === 'coverpic' ? { src: i.src } : { text: i.text });
      objs.splice(i.k, 1, { type: 'rect', version: o.version, left: o.left, top: o.top, originX: o.originX || 'left', originY: o.originY || 'top', angle: o.angle || 0, width: w, height: h, scaleX: 1, scaleY: 1, fill: 'rgba(255,255,255,0.15)', stroke: '#d33', strokeWidth: 3, strokeDashArray: [12, 8], role: 'aigap:' + id });
    });
    // Description and blurb.
    noaiItems.filter(i => picked.has(i.key) && i.type === 'meta').forEach(i => {
      gap({ kind: 'meta', where: i.where, field: i.field }, { text: copy.meta[i.field] });
      copy.meta[i.field] = '';
    });
    await loadProject(copy);
    // Pages: each ticked part becomes a marked empty spot, on the copy's pages as shown.
    // Their prompts come first, in page order, then the cover's and the details'.
    const later = copy.aiGaps.splice(0);
    const byPage = {};
    noaiItems.filter(i => picked.has(i.key) && i.page != null).forEach(i => { (byPage[i.page] ||= []).push(i); });
    for (const [pi, list] of Object.entries(byPage)) {
      const pg = S.pages[pi];
      const { items } = noaiScanPage(contentEls()[pi]);
      list.forEach(i => {
        const el = items[i.k]?.el; if (!el || !el.isConnected) return; // inside a part already taken out
        const isPic = i.type === 'pic';
        const id = gap({ kind: isPic ? 'pic' : 'text', where: i.where, pageId: pg.id, tag: isPic ? 'p' : i.tag }, isPic ? { src: i.src } : { text: i.text });
        const ph = document.createElement('div');
        ph.className = 'ai-gap'; ph.dataset.gap = id; ph.setAttribute('contenteditable', 'false');
        ph.textContent = `Removed: ${isPic ? 'an AI-made picture' : 'AI-written words'}. Project › Fill the removed spots`;
        el.replaceWith(ph);
      });
    }
    copy.aiGaps.push(...later);
    S.aiGaps = copy.aiGaps;
    syncPagesFromDom();
    if (typeof syEnsureId === 'function') { syEnsureId(); markDirty(); }
    showTab('manuscript');
    busy(false);
    toast(`Copy made without ${copy.aiGaps.length} AI part${copy.aiGaps.length === 1 ? '' : 's'}. The original is ${synced ? 'still on your account, unchanged' : 'saved as a project file'}.`, 7000);
    if (copy.aiGaps.length) noaiOpenFill();
  } catch (e) { busy(false); console.error(e); toast('The copy was not made: ' + (e.message || e), 7000); }
}

// ---------- Filling the removed spots ----------
function aiGapCount() { return (S.aiGaps || []).length; }
function noaiUpdateMenu() {
  const n = aiGapCount(); const b = $('#noaiFillBtn');
  if (b) { b.hidden = !n; b.textContent = `Fill the removed spots (${n})`; }
}
function noaiOpenFill() {
  closeDlg('#dlgProject');
  noaiQueue = (S.aiGaps || []).map(g => g.id); noaiAt = 0;
  if (!noaiQueue.length) { toast('No removed spots left to fill.'); return; }
  noaiShowGap();
  openDlg('#dlgNoAiFill');
}
function noaiShowGap() {
  const g = (S.aiGaps || []).find(x => x.id === noaiQueue[noaiAt]);
  if (!g) { closeDlg('#dlgNoAiFill'); noaiUpdateMenu(); toast(aiGapCount() ? `${aiGapCount()} spot${aiGapCount() === 1 ? '' : 's'} left for later: Project › Fill the removed spots.` : 'Every removed spot is filled.'); return; }
  const pic = g.kind === 'pic' || g.kind === 'coverpic';
  const was = noaiWas[g.id];
  $('#noaiFillTitle').textContent = `${pic ? 'A picture' : 'Words'} removed from ${g.where === 'Cover' ? 'the cover' : g.kind === 'meta' ? 'the ' + g.where.toLowerCase() : g.where.toLowerCase()}`;
  $('#noaiFillStep').textContent = `${noaiAt + 1} of ${noaiQueue.length}`;
  $('#noaiFillWas').innerHTML = was ? `<details><summary>What was there (the AI-made version, for reference)</summary>${was.src ? `<img class="noai-thumb big" src="${esc(was.src)}" alt="">` : `<p>${esc(was.text)}</p>`}</details>` : '<p class="hint">What was there is in the original book.</p>';
  $('#noaiFillLabel').textContent = pic ? 'Words to put there instead (or choose your own picture)' : 'Your own words for this spot';
  $('#noaiFillText').value = '';
  $('#noaiFillPic').hidden = !pic;
  $('#noaiFillBack').disabled = noaiAt === 0;
  setTimeout(() => $('#noaiFillText').focus(), 30);
}
const noaiNext = () => { noaiAt++; noaiShowGap(); };
function noaiDone(id) { S.aiGaps = (S.aiGaps || []).filter(g => g.id !== id); delete noaiWas[id]; noaiQueue.splice(noaiAt, 1); }

// Puts words or a picture into a removed spot, or (content = null) takes the spot away.
async function noaiFill(content) {
  const g = (S.aiGaps || []).find(x => x.id === noaiQueue[noaiAt]); if (!g) return;
  const text = content?.text ?? '';
  if (content && !content.src && !text.trim()) { toast('Write something first, or press Leave it out.'); return; }
  snapshot('fill a removed spot');
  if (g.kind === 'meta') {
    S.meta[g.field] = content ? text.trim() : '';
    fillMetaForm();
  } else if (g.kind === 'pic' || g.kind === 'text') {
    const i = S.pages.findIndex(p => p.id === g.pageId);
    const ph = $(`#pages .ai-gap[data-gap="${g.id}"]`);
    if (ph) {
      if (!content) ph.remove();
      else if (content.src) { const im = document.createElement('img'); im.src = content.src; im.alt = ''; ph.replaceWith(im); }
      else {
        const tag = /^(h1|h2|h3|h4|blockquote)$/.test(g.tag) ? g.tag : 'p';
        const parts = text.trim().split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
        ph.replaceWith(...parts.map((t, k) => { const el = document.createElement(k === 0 ? tag : 'p'); el.textContent = t; return el; }));
      }
      syncPagesFromDom();
      if (i >= 0 && typeof reflow === 'function') setTimeout(() => reflow(i, true), 60);
    }
  } else if (typeof cv !== 'undefined' && cv) {
    await ensureCover();
    const box = cv.getObjects().find(o => o.role === 'aigap:' + g.id);
    if (box) cv.remove(box);
    const b = g.box || {};
    if (content?.src) {
      const img = await fabric.Image.fromURL(content.src).catch(() => null);
      if (img && img.width) { const s = Math.min(b.w / img.width, b.h / img.height) || 1; img.set({ left: b.left, top: b.top, originX: b.originX, originY: b.originY, angle: b.angle, scaleX: s, scaleY: s }); img.role = 'user'; cv.add(img); }
    } else if (content) {
      const st = { ...(g.style || {}) }; const role = st.role || 'user'; delete st.role;
      const t = new fabric.Textbox(text.trim(), { left: b.left, top: b.top, originX: b.originX, originY: b.originY, angle: b.angle, width: b.w, fontSize: 32, fontFamily: 'Nunito', fill: '#ffffff', ...st });
      t.role = role; cv.add(t);
    }
    cv.requestRenderAll(); syncCoverToState();
  }
  noaiDone(g.id);
  markDirty(); noaiUpdateMenu();
  noaiShowGap();
}

function wireNoAi() {
  $('#noaiBtn').onclick = noaiOpenReview;
  $('#noaiFillBtn').onclick = noaiOpenFill;
  $('#noaiList').addEventListener('change', noaiCount);
  $('#noaiList').addEventListener('click', e => {
    const b = e.target.closest('[data-noai-all]'); if (!b) return;
    const boxes = $$('input', b.closest('fieldset')); const all = boxes.every(c => c.checked);
    boxes.forEach(c => { c.checked = !all; }); b.textContent = all ? 'Tick all' : 'Untick all'; noaiCount();
  });
  $('#noaiMake').onclick = noaiMakeCopy;
  $('#noaiFillPut').onclick = () => noaiFill({ text: $('#noaiFillText').value });
  $('#noaiFillPic').onclick = () => pickImage(src => noaiFill({ src }));
  $('#noaiFillOut').onclick = () => noaiFill(null);
  $('#noaiFillLater').onclick = noaiNext;
  $('#noaiFillBack').onclick = () => { if (noaiAt > 0) { noaiAt--; noaiShowGap(); } };
  $('#noaiFillText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#noaiFillPut').click(); } });
  $('#projMenuBtn').addEventListener('click', noaiUpdateMenu);
}

/* ---------- App shell ---------- */
function fillPubSelects() {
  for (const id of ['#pub', '#pub2']) $(id).replaceChildren(...Object.entries(PUBLISHERS).map(([k, p]) => new Option(p.name, k)));
}
function fillTrimSelect() {
  const P = PUBLISHERS[S.pub]; const list = P.trims.includes(S.trim) ? P.trims : [S.trim, ...P.trims];
  $('#trim').replaceChildren(...list.map(t => new Option(TRIM_LABEL(t) + (P.trims.includes(t) ? '' : ' (not offered)'), t)));
  $('#trim').value = S.trim;
}
function refreshUI() {
  $('#pub').value = S.pub; $('#pub2').value = S.pub; fillTrimSelect();
  $('#paper').value = S.paper; $('#ink').value = S.ink; $('#bleed').checked = S.bleed;
  refreshInspector(); renderPubCard(); updateStatus();
}
function refreshAll() { refreshUI(); }
function updateStatus() {
  const g = coverGeom(); $('#sbPages').textContent = pageCount(); $('#sbTrim').textContent = `${g.w} × ${g.h} in`;
  $('#sbSpine').textContent = fmtIn(g.sp); $('#sbCover').textContent = `${g.W.toFixed(3)} × ${g.H.toFixed(3)} in`;
  const e = lastIssues.filter(i => i.sev === 'error').length;
  $('#sbCheck').innerHTML = lastIssues.length || e ? `<span class="chip ${e ? 'error' : 'ok'}">${e ? e + ' to fix' : 'Ready'}</span>` : '';
  if (cv) updateCoverSpecs();
}

let currentTab = 'manuscript';
// Back returns to the step you came from; Next goes to the following step.
const STEPS = [['manuscript', 'Interior'], ['cover', 'Cover'], ['details', 'Book details'], ['publish', 'Check & export']];
const tabTrail = [];
function updateStepButtons() {
  const i = STEPS.findIndex(s => s[0] === currentTab); const next = STEPS[i + 1];
  $('#navNext').hidden = i < 0 || !next; if (i >= 0 && next) $('#navNext').textContent = `Next: ${next[1]} →`;
  const prev = tabTrail[tabTrail.length - 1];
  const prevName = prev === 'gridbooks' ? 'Grid books' : prev === 'players' ? 'Player puzzles' : STEPS.find(s => s[0] === prev)?.[1];
  $('#navBack').hidden = !prev; if (prev) $('#navBack').textContent = `← Back to ${prevName}`;
}
function showTab(name, { back = false } = {}) {
  if (name === currentTab && !$('#view-' + name).hidden && name !== 'publish') return;
  if (name !== currentTab && !back) { tabTrail.push(currentTab); if (tabTrail.length > 20) tabTrail.shift(); }
  currentTab = name;
  updateStepButtons();
  $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false'));
  ['manuscript', 'cover', 'details', 'publish', 'gridbooks', 'players'].forEach(v => $('#view-' + v).hidden = v !== name);
  if (name === 'gridbooks' && typeof gaGridBooks === 'function') gaGridBooks();
  if (name === 'players' && typeof ppView === 'function') { syncPagesFromDom(); ppView(); }
  if (name === 'cover') ensureCover().then(() => { sizeCoverCanvas(); cv.calcOffset(); }).catch(() => { });
  if (name === 'publish') { syncPagesFromDom(); renderPubCard(); runChecks(); }
  if (name === 'manuscript') requestAnimationFrame(checkAllOverflow);
  try { if (location.hash !== '#' + name) location.hash = name; } catch (e) { }
}

function fillMetaForm() {
  $$('[data-meta]').forEach(el => { el.value = S.meta[el.dataset.meta] ?? ''; });
  updateMetaCounts();
}
function updateMetaCounts() {
  const P = PUBLISHERS[S.pub];
  const d = S.meta.description.length; const dc = $('#descCount'); dc.textContent = `${d} / ${P.descMax}`; dc.classList.toggle('over', d > P.descMax);
  const k = lines(S.meta.keywords).length; const kc = $('#kwCount'); kc.textContent = `${k} / ${P.keywords} keywords`; kc.classList.toggle('over', k > P.keywords);
  const c = lines(S.meta.categories).length; const cc = $('#catCount'); cc.textContent = `${c} / ${P.categories} categories`; cc.classList.toggle('over', c > P.categories);
}

function onSpecChange(fn) {
  return e => { applyLog = null; syncPagesFromDom(); fn(e); renderPages(); refreshUI(); onGeometryChanged(); markDirty(); lastIssues = []; updateStatus(); };
}

// Returns a promise that settles once the cover has finished loading too.
function loadProject(data) {
  const base = blankProject();
  S = { ...base, ...data, meta: { ...base.meta, ...(data.meta || {}) }, margins: { ...base.margins, ...(data.margins || {}) }, body: { ...base.body, ...(data.body || {}) }, folio: { ...base.folio, ...(data.folio || {}) }, counters: { ...base.counters, ...(data.counters || {}) } };
  if (!TRIMS[S.trim]) S.trim = PUBLISHERS[S.pub]?.defaultTrim || '8.5x11';
  if (!PUBLISHERS[S.pub]) S.pub = 'kdp';
  // A book keeps its own theme list only once it has one (edited here, or a new
  // book started from one); older books use the default list unchanged.
  if (Array.isArray(data.puzzleThemes)) S.puzzleThemes = cloneThemes(data.puzzleThemes); else delete S.puzzleThemes;
  themeSeed = S.puzzleThemes || null;
  curPage = 0; undoStack = []; lastIssues = [];
  renderPages(); refreshUI(); fillMetaForm();
  let cover = Promise.resolve();
  if (cv) { const json = S.cover; cover = json ? loadCoverJSON(json, S.coverGeom).then(() => { lastGeom = coverGeom(); }) : autoDesignCover(); }
  markDirty();
  return cover;
}

/* Sample book: realistic example content, generated fresh */
function sampleProject() {
  const p = blankProject();
  p.meta = { ...p.meta, title: 'Weekend Brain Teasers', subtitle: 'Sudoku, Word Search & Mazes for Adults', author: 'Sample Author', imprint: 'Sample Press', pubDate: new Date().toISOString().slice(0, 10), price: '9.99', copyright: 'Sample Author',
    description: 'Example book. Replace this text with your own description.\n\nA relaxing mix of 3 puzzle types in a large 8.5 × 11 format: sudoku from easy to hard, themed word searches and hand-drawn-style mazes, with full solutions at the back.',
    blurb: 'Example blurb. Unplug and unwind with a mix of sudoku, word searches and mazes, printed large and clear. Full solutions are at the back of the book.',
    keywords: 'sudoku for adults\nword search large print\nmaze puzzle book\nbrain games\nlogic puzzles\nactivity book for adults\ngift for puzzle lovers', categories: 'GAM007000 Games & Activities / Puzzles' };
  p.body = { font: 'Nunito', size: 12, lh: 1.35 };
  S = p; curPage = 0;
  return p;
}
async function buildSample() {
  sampleProject(); S.pages = [{ id: uid(), html: '<h1 class="center">How to play</h1><h3>Sudoku</h3><p>Fill every row, column and 3 × 3 box with the digits 1 to 9. Each digit appears once in each row, column and box.</p><h3>Word search</h3><p>Find each word in the list. Words run across, down and diagonally.</p><h3>Mazes</h3><p>Start at the gap at the top and find your way to the gap at the bottom.</p><p>Solutions for every puzzle are at the back of the book.</p>' }];
  renderPages(); refreshUI(); fillMetaForm();
  curPage = 0;
  await generatePuzzles('sudoku', { count: 2, perPage: 1, answers: true, newPages: true, diff: 'easy' });
  curPage = S.pages.length - 2;
  await generatePuzzles('wordsearch', { count: 2, perPage: 1, answers: true, newPages: true, wsSize: 15, wsDir: 'medium', lists: SAMPLE_LISTS });
  curPage = S.pages.length - 2;
  await generatePuzzles('maze', { count: 1, perPage: 1, answers: true, newPages: true, mzSize: 18, mzShape: 'square' });
  insertFrontMatter(true);
  renderPages(); refreshUI(); fillMetaForm(); setActivePage(0, false);
  setTimeout(reflowAnswers, 80);
  if (cv) await autoDesignCover();
  undoStack = []; markDirty();
}

function wireShell() {
  fillPubSelects();
  $$('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $('#navBack').onclick = () => { const prev = tabTrail.pop(); if (prev) showTab(prev, { back: true }); };
  $('#navNext').onclick = () => { const i = STEPS.findIndex(s => s[0] === currentTab); if (STEPS[i + 1]) showTab(STEPS[i + 1][0]); };
  updateStepButtons();
  const setPub = v => { S.pub = v; if (!PUBLISHERS[v].trims.includes(S.trim)) toast(`${PUBLISHERS[v].short} does not offer ${TRIM_LABEL(S.trim)}. Apply specs to switch to the nearest size.`, 5000); updateMetaCounts(); };
  $('#pub').onchange = onSpecChange(e => setPub(e.target.value));
  $('#pub2').onchange = onSpecChange(e => setPub(e.target.value));
  $('#trim').onchange = onSpecChange(e => { S.trim = e.target.value; });
  $('#paper').onchange = onSpecChange(e => { S.paper = e.target.value; if (S.paper === 'color') { S.ink = 'color'; } });
  $('#ink').onchange = onSpecChange(e => { S.ink = e.target.value; if (S.ink === 'bw' && S.paper === 'color') S.paper = 'white'; });
  $('#bleed').onchange = onSpecChange(e => { S.bleed = e.target.checked; });
  $('#applyPub').onclick = applyPublisher; $('#applyPub2').onclick = applyPublisher;
  $('#runCheck').onclick = () => runChecks();
  $('#expPacket').onclick = exportPacket; $('#expInterior').onclick = exportInterior; $('#expCover').onclick = exportCover;
  $('#expMeta').onclick = async () => (await mayExport('metadata')) && saveFile(slug(S.meta.title) + '-metadata.txt', metadataText());
  $('#addFront').onclick = () => { snapshot('front matter'); insertFrontMatter(false); showTab('manuscript'); };
  $$('[data-meta]').forEach(el => el.addEventListener('input', () => { S.meta[el.dataset.meta] = el.value; updateMetaCounts(); markDirty(); }));
  // Project menu
  $('#projMenuBtn').onclick = () => { $('#projNewConfirm').hidden = true; openDlg('#dlgProject'); };
  $('#projSave').onclick = () => { syncPagesFromDom(); syncCoverToState(); saveFile(slug(S.meta.title) + '-project.json', JSON.stringify(S)); };
  $('#projOpen').onclick = () => { const f = $('#fileProj'); f.value = ''; f.onchange = async () => { try { const d = JSON.parse(await f.files[0].text()); if (!d.pages) throw new Error('not a project file'); delete d.syncId; closeDlg('#dlgProject'); loadProject(d); toast('Opened ' + (d.meta?.title || 'project')); } catch (e) { toast('That file is not a Puzzle Book Studio project'); } }; f.click(); };
  $('#projSample').onclick = async () => { closeDlg('#dlgProject'); busy('Building the sample book'); await buildSample(); busy(false); showTab('manuscript'); };
  $('#projNew').onclick = () => { $('#projNewConfirm').hidden = false; };
  $('#projNewYes').onclick = () => { closeDlg('#dlgProject'); loadProject(blankProject()); if (cv) autoDesignCover(); toast('Started a blank book'); };
}

async function init() {
  wireShell(); wireEditor(); wirePuzzles(); wireImport(); wireCover(); wireWriting(); wireNoAi();
  if (typeof wirePlayerPuzzles === 'function') wirePlayerPuzzles();
  const saved = await idbGet('current');
  const restored = !!(saved && saved.pages && saved.pages.length);
  if (restored) { loadProject(saved); $('#sbSave').textContent = 'Restored from this browser'; }
  else { busy('Building the sample book'); await buildSample(); busy(false); $('#sbSave').textContent = 'Sample book loaded. Open Project to start your own.'; }
  // Grid Admin build: fetch this account's books, open the newest on a new device (sync.js).
  if (typeof syStart === 'function') syStart({ restored });
  const h = (location.hash || '').slice(1); if (['cover', 'details', 'publish'].includes(h) || (['gridbooks', 'players'].includes(h) && !$(`[data-tab=${h}]`).hidden)) showTab(h);
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (['manuscript', 'cover', 'details', 'publish', 'gridbooks', 'players'].includes(t) && t !== currentTab) { const back = tabTrail[tabTrail.length - 1] === t; if (back) tabTrail.pop(); showTab(t, { back }); } });
  document.fonts && document.fonts.ready.then(() => checkAllOverflow());
}
// init() runs from auth.js once Grid Admin says this account may publish
// (or straight away in the stand-alone build).

/* ---------- Sync and the Book Studio app (Grid Admin build only) ----------
   Every book is kept on the signed-in account (server/src/studio-sync.js), so
   it opens on any computer, phone or the Book Studio app with the same email:
   - a change is saved in this browser first (core.js markDirty), then sent to
     the account a few seconds later (syChanged → syPush);
   - each book has an id (S.syncId) and the account counts its saves (rev).
     A save says which rev it started from. If another device saved first,
     the two sets of changes are merged into the same book (syMerge): every
     app and device always works on one file, never a copy;
   - when Book Studio opens or comes back into view it asks for the list and
     opens a newer version from another device, unless this one has changes
     of its own still to send;
   - with no connection the book keeps saving here and syncs when it is back.
   It also installs Book Studio as an app (manifest.webmanifest, sw.js, the
   Windows app in desktop-book-studio/) and opens offline once installed. */
const SY_REVS = 'bs-sync-revs', SY_SIGS = 'bs-sync-sigs', SY_ME = 'bs-me', SY_OWNER = 'bs-owner';
const SY_WAIT_MS = 6000, SY_CHECK_GAP_MS = 45_000;
const SY_WINDOWS = 'https://github.com/bltaylorjr/fantastical-logic-grid/releases/download/book-studio-desktop/Book-Studio-Setup.exe';
let syTimer = null, syBusy = false, syAgain = false, syList = [], syListAt = 0, syStopped = '', syReady = false, syOffline = false;

const syRead = (key) => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; } };
const syWrite = (key, id, v) => { try { const m = syRead(key); if (v == null) delete m[id]; else m[id] = v; localStorage.setItem(key, JSON.stringify(m)); } catch (e) { /* private window */ } };
const syRev = (id) => Number(syRead(SY_REVS)[id]) || 0;
const sySig = (id) => syRead(SY_SIGS)[id] || '';
// A short fingerprint of a book's saved JSON, to tell whether it changed since it was last synced.
function sySign(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return text.length + ':' + (h >>> 0).toString(36);
}
const syNewId = () => 'bs-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : uid() + uid());
function syEnsureId() { if (!/^bs-[\w-]{6,40}$/.test(S.syncId || '')) S.syncId = syNewId(); return S.syncId; }
const syInApp = () => !!window.__FLG_BOOK_STUDIO_DESKTOP__ || matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
function syDevice() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Browser';
  return window.__FLG_BOOK_STUDIO_DESKTOP__ ? `${os} app` : os;
}
const syNetDown = (e) => e instanceof TypeError || e?.code === 'offline' || !navigator.onLine;
const syTime = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function syShow(text, kind = '') {
  const el = $('#sbSync'); el.hidden = !text; el.textContent = text; el.dataset.kind = kind;
  $('#syStatus').textContent = text;
}
function syCurrent() { syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState(); return JSON.stringify(S); }
const syPending = (snap) => !!S.syncId && sySign(snap) !== sySig(S.syncId);

/* core.js calls this after every save in this browser, with the saved JSON. */
function syChanged(snap) {
  if (!syReady) return;
  if (!S.syncId) { syEnsureId(); markDirty(); return; } // saved again with its id
  if (!syPending(snap)) return;
  if (syStopped === sySign(snap)) return; // refused as it is (too big): wait for a change
  syShow(syOffline ? 'Offline: saved here, syncs when you are back online' : 'Changes not synced yet', 'wait');
  clearTimeout(syTimer); syTimer = setTimeout(syPush, SY_WAIT_MS);
}

async function syPush() {
  clearTimeout(syTimer);
  if (!syReady || !gaMe) return;
  if (syBusy) { syAgain = true; return; }
  syEnsureId();
  const snap = syCurrent();
  if (!syPending(snap)) { syShowSynced(); return; }
  const id = S.syncId, sig = sySign(snap);
  syBusy = true; syShow('Syncing…', 'wait');
  try {
    const r = await adminApi(`studio/books/${id}`, { method: 'POST', body: { project: JSON.parse(snap), baseRev: syRev(id), device: syDevice() } });
    syWrite(SY_REVS, id, r.book.rev); syWrite(SY_SIGS, id, sig);
    await sySetBase(id, snap);
    syOffline = false; syStopped = '';
    syRemember(r.book);
    syShowSynced();
  } catch (e) {
    if (e.code === 'changed') { syBusy = false; await syMergeTheirs(); return; }
    if (syNetDown(e)) { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); }
    else if (e.status === 413) { syStopped = sig; syShow(e.message, 'bad'); toast(e.message, 8000); }
    else if (e.status === 403) { syShow('Not synced: this account has no publishing access.', 'bad'); gaShowGate('denied', e.message); }
    else if (e.status !== 401) syShow('Not synced yet. Trying again soon.', 'bad');
    if (!syStopped && e.status !== 401 && e.status !== 403) syTimer = setTimeout(syPush, syOffline ? 60_000 : 30_000);
  } finally { syBusy = false; }
  if (syAgain) { syAgain = false; syPush(); }
}

// The book as it was last synced on this device: the common starting point
// for merging when another device saved first.
const sySetBase = (id, snap) => idbPut('sync-base:' + id, JSON.parse(snap));
const syGetBase = (id) => idbGet('sync-base:' + id);
const syEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Three-way merge of whole books. A setting or page changed only on this
   device keeps this device's version; one changed only on the other device
   keeps theirs; one changed on both keeps this device's (the newest edit).
   Pages are matched by id: added pages are kept where they were added,
   deleted pages stay deleted unless the other device changed them. */
function syMerge(base, mine, theirs) {
  base = base || {};
  const out = {};
  const keys = new Set([...Object.keys(theirs), ...Object.keys(mine)]);
  for (const k of keys) {
    if (k === 'pages') continue;
    const b = base[k], m = mine[k], t = theirs[k];
    const objects = [b, m, t].every((v) => v == null || (typeof v === 'object' && !Array.isArray(v)));
    if (objects && (m || t) && k !== 'cover' && k !== 'coverGeom') {
      const o = {};
      for (const kk of new Set([...Object.keys(t || {}), ...Object.keys(m || {})])) {
        const bv = (b || {})[kk], mv = (m || {})[kk], tv = (t || {})[kk];
        const v = syEq(mv, bv) ? tv : mv;
        if (v !== undefined) o[kk] = v;
      }
      out[k] = o;
    } else {
      const v = syEq(m, b) ? t : m;
      if (v !== undefined) out[k] = v;
    }
  }
  const bp = new Map((base.pages || []).map((p) => [p.id, p]));
  const mp = new Map((mine.pages || []).map((p) => [p.id, p]));
  const tp = new Map((theirs.pages || []).map((p) => [p.id, p]));
  const pages = [];
  for (const t of theirs.pages || []) {
    const m = mp.get(t.id), b = bp.get(t.id);
    if (m) pages.push(syEq(m, b) ? t : m);
    else if (!b || !syEq(t, b)) pages.push(t); // new there, or changed there after this device deleted it
  }
  // Pages only on this device: new here, or deleted there but changed here.
  (mine.pages || []).forEach((m, i) => {
    if (tp.has(m.id)) return;
    const b = bp.get(m.id);
    if (b && syEq(m, b)) return; // deleted there, untouched here
    const prev = (mine.pages || []).slice(0, i).reverse().find((p) => pages.some((q) => q.id === p.id));
    const at = prev ? pages.findIndex((q) => q.id === prev.id) + 1 : 0;
    pages.splice(at, 0, m);
  });
  out.pages = pages.length ? pages : (mine.pages || theirs.pages || []);
  out.syncId = mine.syncId || theirs.syncId;
  return out;
}

// Another device saved this book first: fetch theirs, merge both sets of
// changes into the same book, and save that as the next version.
let syMerges = 0;
async function syMergeTheirs() {
  const id = S.syncId;
  if (++syMerges > 3) { syMerges = 0; syShow('Not synced yet. Trying again soon.', 'bad'); syTimer = setTimeout(syPush, 30_000); return; }
  try {
    const r = await adminApi(`studio/books/${id}`);
    const mine = JSON.parse(syCurrent());
    const merged = syMerge(await syGetBase(id), mine, { ...r.project, syncId: id });
    syWrite(SY_REVS, id, r.book.rev);
    await sySetBase(id, JSON.stringify({ ...r.project, syncId: id }));
    if (syEq(merged, { ...r.project, syncId: id })) {
      // Nothing of this device's is missing there: just take their version.
      loadProject(merged); syWrite(SY_SIGS, id, sySign(syCurrent())); syRemember(r.book); syShowSynced(); syMerges = 0; return;
    }
    if (!syEq(merged, mine)) {
      const at = curPage;
      loadProject(merged);
      if (at > 0 && at < S.pages.length) setActivePage(at);
      toast(`"${S.meta.title || 'This book'}" was also changed on ${r.book.device || 'another device'}. Both sets of changes are now in this book.`, 8000);
    }
    markDirty();
    await syPush();
  } catch (e) {
    syMerges = 0;
    if (syNetDown(e)) { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); }
    else syShow('Not synced yet. Trying again soon.', 'bad');
    syTimer = setTimeout(syPush, 30_000);
    return;
  }
  syMerges = 0;
}

function syShowSynced() { syShow(`Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'ok'); }
function syRemember(b) {
  const i = syList.findIndex(x => x.id === b.id);
  if (i >= 0) syList[i] = { ...syList[i], ...b }; else syList.unshift(b);
  syRenderList();
}

/* The account's books, and a newer version of this one from another device. */
async function syCheck({ force = false } = {}) {
  if (!syReady || !gaMe || syBusy) return;
  if (!force && Date.now() - syListAt < SY_CHECK_GAP_MS) return;
  syListAt = Date.now();
  let list;
  try { list = (await adminApi('studio/books')).books; } catch (e) {
    if (syNetDown(e)) { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); }
    return;
  }
  if (syOffline) { syOffline = false; await gaRecheck(); }
  syList = list; syRenderList();
  const snap = syCurrent();
  const mine = S.syncId && list.find(b => b.id === S.syncId);
  const pending = syPending(snap);
  if (mine && mine.rev > syRev(S.syncId) && !pending) { await syOpen(mine.id, { why: `Updated with the changes from ${mine.device || 'another device'}` }); return; }
  if (S.syncId && !mine && syRev(S.syncId) > 0) {
    // Deleted from the account on another device: it stays here, and syncs again
    // as a new book only if it is changed.
    syWrite(SY_REVS, S.syncId, null); syWrite(SY_SIGS, S.syncId, sySign(snap));
    syShow('This book was removed from your account on another device. It is still here; edit it to sync it again.', 'wait');
    return;
  }
  if (pending) syPush(); else syShowSynced();
}

async function syOpen(id, { why } = {}) {
  if (syPending(syCurrent())) await syPush();
  busy('Opening the book from your account');
  try {
    const r = await adminApi(`studio/books/${id}`);
    const project = { ...r.project, syncId: id };
    syWrite(SY_REVS, id, r.book.rev);
    // Wait for the cover to load before taking the fingerprint: read too early,
    // the canvas still holds the old cover, so the book looks changed and is
    // sent straight back, and the other device's next save becomes a copy.
    await loadProject(project);
    syWrite(SY_SIGS, id, sySign(syCurrent()));
    await sySetBase(id, syCurrent());
    syRemember(r.book);
    syShowSynced();
    toast(why || `Opened "${r.book.title}"`, 5000);
  } catch (e) {
    toast(syNetDown(e) ? 'You are offline. Books from your account open when you are back online.' : (e.message || 'That book did not open.'), 6000);
  } finally { busy(false); }
}

async function syDelete(id) {
  const b = syList.find(x => x.id === id);
  const here = id === S.syncId;
  if (!confirm(`Remove "${b?.title || 'this book'}" from your account? It disappears from your other devices.${here ? ' It stays open on this device.' : ''}`)) return;
  try {
    await adminApi(`studio/books/${id}/delete`, { method: 'POST', body: {} });
    syList = syList.filter(x => x.id !== id); syRenderList();
    syWrite(SY_REVS, id, null);
    if (here) { syWrite(SY_SIGS, id, sySign(syCurrent())); syShow('Removed from your account. Edit it to sync it again.', 'wait'); } else syWrite(SY_SIGS, id, null);
    toast('Removed from your account.');
  } catch (e) { toast(syNetDown(e) ? 'You are offline. Try again when you are back online.' : (e.message || 'That did not work.'), 6000); }
}

function syRenderList() {
  const ul = $('#syList'); if (!ul) return;
  if (!syList.length) { ul.innerHTML = '<li class="hint">No books on your account yet. This one is added as soon as you change it.</li>'; return; }
  ul.innerHTML = syList.map(b => `<li class="sy-item${b.id === S.syncId ? ' here' : ''}">
    <div class="sy-meta"><b>${esc(b.title)}</b><small class="hint">${b.id === S.syncId ? 'Open now · ' : ''}Saved ${esc(syTime(b.updatedAt))}${b.device ? ' on ' + esc(b.device) : ''} · ${(b.size / 1e6).toFixed(b.size < 1e6 ? 2 : 1)} MB</small></div>
    <span class="sy-acts">${b.id === S.syncId ? '' : `<button class="btn" type="button" data-sy-open="${esc(b.id)}">Open</button>`}<button class="btn ghost" type="button" data-sy-del="${esc(b.id)}">Remove</button></span>
  </li>`).join('');
  for (const el of ul.querySelectorAll('[data-sy-open]')) el.onclick = () => { closeDlg('#dlgProject'); syOpen(el.dataset.syOpen); };
  for (const el of ul.querySelectorAll('[data-sy-del]')) el.onclick = () => syDelete(el.dataset.syDel);
}

/* main.js calls this once the studio is open. */
async function syStart({ restored }) {
  $('#syBox').hidden = false;
  // One browser, two people: the book open here belongs to whoever last
  // signed in. It is set aside for them (and comes back when they sign in
  // again), so it is never synced to someone else's account.
  let owner = ''; try { owner = localStorage.getItem(SY_OWNER) || ''; } catch (e) { /* private window */ }
  if (restored && owner && owner !== gaMe.email) {
    await idbPut('current:' + owner, JSON.parse(syCurrent()));
    const theirs = await idbGet('current:' + gaMe.email);
    if (theirs && theirs.pages && theirs.pages.length) loadProject(theirs);
    else { loadProject(blankProject()); restored = false; }
  }
  try { localStorage.setItem(SY_OWNER, gaMe.email); } catch (e) { /* private window */ }
  $('#syNow').onclick = async () => { await syPush(); await syCheck({ force: true }); };
  $('#projMenuBtn').addEventListener('click', () => { syRenderList(); syCheck(); });
  addEventListener('online', () => { syOffline = false; syCheck({ force: true }); });
  addEventListener('offline', () => { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (syPending(syCurrent())) syPush(); } else syCheck();
  });
  addEventListener('focus', () => syCheck());
  // A book from before sync gets its id now, kept in this browser too.
  const fresh = !S.syncId;
  syEnsureId();
  if (fresh) await idbPut('current', JSON.parse(JSON.stringify(S)));
  syReady = true;
  if (!restored) {
    // A first visit on this device: the sample book is not synced unless it is
    // changed, and the newest book on the account opens instead.
    syWrite(SY_SIGS, S.syncId, sySign(syCurrent()));
    await syCheck({ force: true });
    if (syList.length) await syOpen(syList[0].id, { why: `Opened "${syList[0].title}" from your account` });
    return;
  }
  await syCheck({ force: true });
}

/* ---------- Signing in with no connection ---------- */
// After a normal sign-in the account's access is remembered on this device,
// so an installed Book Studio opens offline (for someone who ticked "Keep me
// signed in"). The server still checks every sync and export.
function gaRememberMe() { try { localStorage.setItem(SY_ME, JSON.stringify({ email: gaMe.email, role: gaMe.role, canPublish: !!gaMe.canPublish })); } catch (e) { /* private window */ } }
function gaOfflineMe() {
  try { const me = JSON.parse(localStorage.getItem(SY_ME) || 'null'); return me && me.canPublish && gaSession?.email && me.email === gaSession.email ? me : null; } catch (e) { return null; }
}
// Back online after opening offline: ask the server again.
async function gaRecheck() {
  try {
    const me = await adminApi('me');
    gaMe = me; gaRememberMe();
    if (!me.canPublish) gaShowGate('denied');
  } catch (e) { if (e.status === 403 || e.code === 'not_admin') gaShowGate('denied', e.message); }
}

/* ---------- Get the app ---------- */
let syInstallPrompt = null;
function syAppWire() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); syInstallPrompt = e; $('#appInstall').hidden = false; $('#appInstallNote').hidden = true; });
  addEventListener('appinstalled', () => { syInstallPrompt = null; $('#appInstall').hidden = true; toast('Book Studio is installed. Open it from your apps.', 6000); });
  $('#getApp').hidden = syInApp();
  $('#getApp').onclick = () => {
    const ua = navigator.userAgent, ios = /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    $('#appWin').hidden = !/Windows/.test(ua);
    $('#appIos').hidden = !ios;
    $('#appSafari').hidden = ios || !(/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg|Firefox/.test(ua));
    $('#appInstall').hidden = !syInstallPrompt;
    $('#appInstallNote').hidden = !!syInstallPrompt || ios || !$('#appSafari').hidden;
    openDlg('#dlgApp');
  };
  $('#appInstall').onclick = async () => {
    if (!syInstallPrompt) return;
    syInstallPrompt.prompt();
    await syInstallPrompt.userChoice.catch(() => null);
    syInstallPrompt = null; $('#appInstall').hidden = true; closeDlg('#dlgApp');
  };
  $('#appWinLink').href = SY_WINDOWS;
  for (const b of $$('#dlgApp [data-close]')) b.onclick = () => closeDlg('#dlgApp');
}
syAppWire();

/* ---------- Player puzzles: approved puzzles players sent in ----------
   Grid Admin build only (auth.js shows the tab). Lists every approved player
   puzzle (GET /admin/v1/studio/player-puzzles, server/src/studio-player-puzzles.js):
   Puzzle Wizard puzzles and storylines in the Approved or Published section of
   Grid Admin's Puzzle submissions page. For each one:
   - Add to book: its puzzle page goes after the current page, its answer key
     at the back of the book (or right after it), drawn like a Grid books page;
   - Download: the puzzle and answer key as a PDF;
   - Print: the same PDF, in the browser's print window.
   The website's Book maker (web/js/book-maker.js, in a hidden frame) builds
   each puzzle with the game's engine (a wizard puzzle again from the author's
   entry and seed, so it is the puzzle they made) and draws it with the game's
   print layout. A puzzle built here is kept with the entry, so every book
   prints the same one.
   Author credit: a player puzzle's page can show "Puzzle by <screen name>" at
   the foot of the page (editor.js buildPageNode), switched on or off for each
   puzzle (Current page, on the right) and for the whole book (S.playerCredits).
   Players who chose to stay anonymous are never credited.
   Publications: once the submission packet or the interior PDF is saved
   (publish.js), ppRecordExport() sends the player puzzles in the book, and
   the server counts each once per book (exporting it again does not). */
let ppData = null;          // { items, siteUrl }
let ppFrame = null, ppReady = null, ppReq = 0;
const ppWaiting = new Map();
const ppBuilt = new Map();  // id -> { item, css, pdf }
const ppPicked = new Set();
let ppQuery = { q: '', game: '', use: '' };

const PP_GAMES = { fantastical: 'The Fantastical Logic Grid', ninetimesnine: 'NINETIMESNINE' };
const PP_LEVELS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };

// The player puzzle ids in this book (each counted once).
function ppBookIds() {
  return [...new Set(S.pages.map(p => p.player && Number(p.player.id)).filter(n => Number.isInteger(n) && n > 0))];
}
const ppCreditsOn = () => S.playerCredits !== false;

/* ---------- the Book maker frame ---------- */
function ppOnMessage(e) {
  if (!ppData || !ppFrame || e.source !== ppFrame.contentWindow || !e.data) return;
  let origin; try { origin = new URL(ppData.siteUrl).origin; } catch (x) { return; }
  if (e.origin !== origin) return;
  const m = e.data;
  if (m.type === 'flg-book-ready') { ppReady && ppReady.resolve(); return; }
  const w = ppWaiting.get(m.req);
  if (w) { ppWaiting.delete(m.req); w(m); }
}
function ppMount() {
  if (ppFrame) return;
  window.addEventListener('message', ppOnMessage);
  let resolve; ppReady = new Promise(r => { resolve = r; }); ppReady.resolve = resolve;
  ppFrame = document.createElement('iframe');
  ppFrame.title = 'Puzzle maker'; ppFrame.className = 'bk-frame'; ppFrame.hidden = true;
  ppFrame.src = `${ppData.siteUrl}/book-maker/`;
  $('#ppFrames').appendChild(ppFrame);
}
async function ppAsk(msg) {
  ppMount();
  await Promise.race([ppReady, new Promise((_, no) => setTimeout(() => no(new Error('The website did not answer. Check that it is online, then try again.')), 30000))]);
  const id = `pp${++ppReq}`;
  const m = await new Promise((resolve, reject) => {
    ppWaiting.set(id, resolve);
    setTimeout(() => { if (ppWaiting.delete(id)) reject(new Error('Building the puzzle took too long. Try again.')); }, 180000);
    ppFrame.contentWindow.postMessage({ ...msg, req: id }, new URL(ppData.siteUrl).origin);
  });
  if (m.type === 'flg-book-error') throw new Error(m.message);
  return m;
}

// The puzzle, built and drawn (once per visit).
async function ppBuild(it) {
  if (ppBuilt.has(it.id)) return ppBuilt.get(it.id);
  const m = await ppAsk({ type: 'flg-book-player', entry: it.puzzle ? null : it.entry, seed: it.seed, puzzle: it.puzzle, credit: it.credit });
  const out = { item: m.item, css: m.css, pdf: m.pdf };
  ppBuilt.set(it.id, out);
  // Keep the wizard puzzle just built, so every book prints this same one.
  if (m.puzzle && !it.puzzle) {
    it.puzzle = m.puzzle;
    adminApi(`studio/player-puzzles/${it.id}/puzzle`, { method: 'POST', body: { puzzle: m.puzzle } }).catch(() => {});
  }
  return out;
}

/* ---------- the page ---------- */
async function ppView({ reload = false } = {}) {
  const body = $('#ppBody');
  if (!ppData || reload) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    try { ppData = await adminApi('studio/player-puzzles'); }
    catch (e) { body.textContent = e.message || 'Player puzzles did not load. Check your connection and try again.'; return; }
  }
  $('#ppCredits').checked = ppCreditsOn();
  ppRender();
}
function ppStatus(it) {
  if (!it.puzzle && !it.entry) return 'not-built';
  return 'ok';
}
function ppRender() {
  const q = ppQuery.q.toLowerCase();
  const inBook = new Set(ppBookIds());
  const list = ppData.items.filter(it => (!ppQuery.game || it.game === ppQuery.game)
    && (!ppQuery.use || (ppQuery.use === 'new' ? !it.books : ppQuery.use === 'book' ? inBook.has(it.id) : it.books > 0))
    && (!q || [it.title, it.player, it.credit, String(it.id)].some(v => String(v || '').toLowerCase().includes(q))));
  const ready = list.filter(it => ppStatus(it) === 'ok');
  for (const id of [...ppPicked]) if (!ready.some(it => it.id === id)) ppPicked.delete(id);
  $('#ppCount').textContent = `${list.length} of ${ppData.items.length} approved player puzzle${ppData.items.length === 1 ? '' : 's'}`;
  $('#ppAddPicked').disabled = !ppPicked.size;
  $('#ppAddPicked').textContent = ppPicked.size ? `Add ${ppPicked.size} to the book` : 'Add ticked to the book';
  $('#ppBody').innerHTML = list.length ? `<ul class="pp-list">${list.map(it => {
    const ok = ppStatus(it) === 'ok';
    const level = PP_LEVELS[it.level] || it.level || '';
    const by = it.credit ? `by <b>${esc(it.credit)}</b>` : it.anonymous ? 'The author chose no credit' : 'by a player';
    const used = it.books ? `In ${it.books} book${it.books === 1 ? '' : 's'}${it.exports > it.books ? ` (${it.exports} exports)` : ''}` : 'Not in a book yet';
    return `<li class="pp-item${inBook.has(it.id) ? ' here' : ''}">
      <label class="pp-pick"><input type="checkbox" data-pp-pick="${it.id}"${ppPicked.has(it.id) ? ' checked' : ''}${ok ? '' : ' disabled'} aria-label="Tick ${esc(it.title)}"></label>
      <div class="pp-meta">
        <b class="pp-title">${esc(it.title)}</b>
        <span class="muted">${esc(PP_GAMES[it.game] || it.game)}${level ? ` · ${esc(level)}` : ''} · ${it.kind === 'storyline' ? 'Storyline' : 'Puzzle Wizard'} · #${it.id}</span>
        <span>${by}</span>
        <span class="pp-tags"><span class="chip ${it.books ? 'ok' : ''}">${used}</span>${it.status === 'published' ? '<span class="chip">Published</span>' : ''}${inBook.has(it.id) ? '<span class="chip ok">In this book</span>' : ''}</span>
        ${ok ? '' : '<span class="hint">No puzzle yet: build it in Grid Admin under Storyline submissions first.</span>'}
      </div>
      <div class="pp-acts">
        <button class="btn primary" type="button" data-pp-add="${it.id}"${ok ? '' : ' disabled'}>Add to book</button>
        <button class="btn" type="button" data-pp-pdf="${it.id}"${ok ? '' : ' disabled'}>Download</button>
        <button class="btn" type="button" data-pp-print="${it.id}"${ok ? '' : ' disabled'}>Print</button>
      </div>
    </li>`;
  }).join('')}</ul>` : `<p class="muted">${ppData.items.length ? 'Nothing matches. Clear the search to see them all.' : 'No approved player puzzles yet. Approve them in Grid Admin under Puzzle submissions.'}</p>`;
}

/* ---------- adding to the book ---------- */
function ppAddCss(css) {
  const clean = cleanGridCss(css);
  const games = (clean.match(/\.bk-g-[\w-]+/) || [])[0];
  if (!clean || (games && (S.gridCss || '').includes(games + ' '))) return;
  S.gridCss = cleanGridCss(((S.gridCss || '') + '\n' + clean).trim());
  applyGridCss();
}
// One player puzzle as editor pages: its puzzle page(s) and its answer key page.
function ppPages(it, built) {
  const x = built.item; const g = esc(x.game);
  const head = `${esc(x.gameName)}${x.level ? ` · ${esc(x.level)}` : ''}`;
  const parts = String(x.page || '').split('<div class="bk-break"></div>').filter(Boolean);
  const player = { id: it.id, credit: it.credit || '', title: String(it.title || '').slice(0, 120) };
  const pages = parts.map((part, k) => ({
    id: uid(), grid: 'puzzle', player: { ...player },
    html: gridPageHtml({ kind: 'puzzle', head: head + (parts.length > 1 ? ` (${k + 1} of ${parts.length})` : ''), body: `<div class="bk-fit bk-g-${g}">${part}</div>` })
  }));
  const key = x.key ? {
    id: uid(), grid: 'key', playerKey: it.id,
    html: gridPageHtml({ kind: 'key', head: `Answer · ${esc(it.title)}`, body: `<div class="bk-key"><p class="bk-keyh">${esc(it.title)}</p><div class="bk-room"><div class="bk-fit bk-g-${g}">${x.key}</div></div></div>` })
  } : null;
  return { pages, key };
}
async function ppAdd(ids) {
  const items = ids.map(id => ppData.items.find(it => it.id === id)).filter(Boolean);
  if (!items.length) return;
  const where = $('#ppKeys').value;
  const made = [];
  try {
    for (let k = 0; k < items.length; k++) {
      busy(`Building “${items[k].title}” (${k + 1} of ${items.length})`, (k + 0.5) / items.length);
      made.push([items[k], await ppBuild(items[k])]);
    }
  } catch (e) { busy(false); toast(e.message || 'That puzzle could not be built.', 7000); return; }
  busy(false);
  snapshot('player puzzles');
  syncPagesFromDom();
  let at = clamp(curPage, 0, S.pages.length - 1) + 1;
  const first = at;
  for (const [it, built] of made) {
    ppAddCss(built.css);
    const { pages, key } = ppPages(it, built);
    S.pages.splice(at, 0, ...pages); at += pages.length;
    if (key && where === 'after') { S.pages.splice(at, 0, key); at += 1; }
    else if (key && where === 'back') S.pages.push(key);
  }
  renderPages(); refreshAll(); setActivePage(first, false); markDirty();
  showTab('manuscript');
  setTimeout(() => setActivePage(first, true), 60);
  toast(`Added ${made.length} player puzzle${made.length === 1 ? '' : 's'}${where === 'none' ? '' : where === 'after' ? ', each with its answer key after it' : ', with the answer keys at the back'}.`, 5000);
  made.forEach(([it]) => ppPicked.delete(it.id));
}

/* ---------- publications ---------- */
async function ppRecordExport(kind) {
  syncPagesFromDom();
  const puzzles = ppBookIds(); if (!puzzles.length) return;
  const book = typeof syEnsureId === 'function' ? syEnsureId() : '';
  try {
    const r = await adminApi('studio/player-puzzles/published', { method: 'POST', body: { kind, book, title: S.meta.title || 'Untitled', platform: PUBLISHERS[S.pub].name, puzzles } });
    if (r.counted) {
      toast(`${r.counted} player puzzle${r.counted === 1 ? '' : 's'} counted as published in this book.`, 5000);
      ppData = null; // counts changed: load again next time
    }
  } catch (e) { /* the export is saved; the count catches up the next time it is exported */ }
}

/* ---------- download and print ---------- */
async function ppPdf(id) {
  const it = ppData.items.find(x => x.id === id); if (!it) return null;
  busy(`Building “${it.title}”`, 0.4);
  try { const b = await ppBuild(it); busy(false); return { it, blob: new Blob([b.pdf], { type: 'application/pdf' }) }; }
  catch (e) { busy(false); toast(e.message || 'That puzzle could not be built.', 7000); return null; }
}
async function ppDownload(id) {
  const r = await ppPdf(id); if (!r) return;
  await saveFile(`${slug(r.it.title)}-puzzle.pdf`, r.blob);
}
async function ppPrint(id) {
  const r = await ppPdf(id); if (!r) return;
  const url = URL.createObjectURL(r.blob);
  const f = document.createElement('iframe');
  f.title = 'Printable puzzle'; f.className = 'pp-print';
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(url, '_blank', 'noopener'); } };
  f.src = url; document.body.appendChild(f);
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
}

function wirePlayerPuzzles() {
  $('#ppSearch').onsubmit = e => { e.preventDefault(); ppQuery = { q: $('#ppQ').value.trim(), game: $('#ppGame').value, use: $('#ppUse').value }; if (ppData) ppRender(); };
  $('#ppGame').onchange = $('#ppUse').onchange = () => $('#ppSearch').requestSubmit();
  $('#ppReload').onclick = () => { ppBuilt.clear(); ppView({ reload: true }); };
  $('#ppCredits').onchange = e => { syncPagesFromDom(); S.playerCredits = e.target.checked; renderPages(); refreshAll(); markDirty(); toast(e.target.checked ? 'Author credit shows on player puzzle pages (where it is on for the puzzle).' : 'Author credit is off for every player puzzle in this book.'); };
  $('#ppAddPicked').onclick = () => ppAdd([...ppPicked]);
  $('#ppBody').onclick = e => {
    const b = e.target.closest('button, input'); if (!b || b.disabled) return;
    if (b.dataset.ppPick) { const id = +b.dataset.ppPick; b.checked ? ppPicked.add(id) : ppPicked.delete(id); $('#ppAddPicked').disabled = !ppPicked.size; $('#ppAddPicked').textContent = ppPicked.size ? `Add ${ppPicked.size} to the book` : 'Add ticked to the book'; return; }
    if (b.dataset.ppAdd) ppAdd([+b.dataset.ppAdd]);
    else if (b.dataset.ppPdf) ppDownload(+b.dataset.ppPdf);
    else if (b.dataset.ppPrint) ppPrint(+b.dataset.ppPrint);
  };
}

/* ---------- Sign-in for Book Studio ----------
   Book Studio has its own sign-in screen and shares the dashboard's session
   (admin/admin.js keeps it under flg-admin-session, in sessionStorage or,
   with "Keep me signed in", in localStorage), so signing in here also signs
   in to Grid Admin and the other way round.
   - Email and password: the game's Firebase accounts. Someone the owner has
     invited can create their password here; their email must be confirmed
     before the server says anything about their access.
   - Face ID, fingerprint or Windows Hello: passkeys, through the dashboard's
     own module (admin/passkeys.js) and server routes.
   The server decides who may publish: GET /admin/v1/me says canPublish, and
   every export checks in with POST /admin/v1/publishing/export first (logged
   in the audit log). */
const GA_SESSION_KEY = 'flg-admin-session';
const GA_SKIP_KEY = 'flg-admin-passkey-skip';
const GA_IDLE_MS = 60 * 60_000;
const GA_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const GA_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const GA_MIN_PASSWORD = 8;
let gaSession = null, gaMe = null, gaLastActive = Date.now(), gaFirebaseKey = null, gaPasskeys = null;

function gaLoad() { try { return JSON.parse(sessionStorage.getItem(GA_SESSION_KEY) || localStorage.getItem(GA_SESSION_KEY) || 'null'); } catch (e) { return null; } }
function gaSave() {
  if (!gaSession) return;
  try {
    gaSession.seen = gaLastActive; const keep = !!gaSession.keep;
    (keep ? localStorage : sessionStorage).setItem(GA_SESSION_KEY, JSON.stringify(gaSession));
    (keep ? sessionStorage : localStorage).removeItem(GA_SESSION_KEY);
  } catch (e) { /* private window */ }
}
function gaClear() { try { sessionStorage.removeItem(GA_SESSION_KEY); localStorage.removeItem(GA_SESSION_KEY); } catch (e) { /* ignore */ } }
const gaErr = (code, message, status) => Object.assign(new Error(message), { code, status });

async function gaFirebase(path, body) {
  if (!gaFirebaseKey) {
    gaFirebaseKey = (await fetch('/admin/v1/client-config').then(r => r.json()).catch(() => ({}))).firebaseApiKey;
    if (!gaFirebaseKey) throw gaErr('not_set_up', 'Password sign-in is not set up yet. Ask the owner to add the FIREBASE_WEB_API_KEY secret.');
  }
  const res = await fetch(`${GA_AUTH_URL}/${path}?key=${encodeURIComponent(gaFirebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.error?.message || `HTTP_${res.status}`).split(/[\s:]/)[0];
    const words = {
      INVALID_LOGIN_CREDENTIALS: 'That email and password do not match.', INVALID_PASSWORD: 'That email and password do not match.', EMAIL_NOT_FOUND: 'That email and password do not match.',
      EMAIL_EXISTS: 'This email already has a password. Sign in, or use "Forgot password?" to choose a new one.',
      WEAK_PASSWORD: `Choose a longer password (at least ${GA_MIN_PASSWORD} characters).`,
      OPERATION_NOT_ALLOWED: 'Creating a password is switched off for this sign-in system. Ask the owner.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes and try again.', USER_DISABLED: 'This account is switched off.', INVALID_EMAIL: 'Enter a valid email address.',
    };
    throw gaErr(code, words[code] || 'That did not work. Please try again.');
  }
  return data;
}
const gaFirebaseSession = (d, keep) => ({ mode: 'firebase', email: d.email, idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + Number(d.expiresIn || 3600) * 1000, keep });

async function gaBearer() {
  if (!gaSession) throw gaErr('sign_in', 'Please sign in.');
  if (gaSession.mode === 'token' || gaSession.mode === 'passkey') return gaSession.key;
  if (gaSession.idToken && Date.now() < gaSession.exp - 60_000) return gaSession.idToken;
  if (!gaFirebaseKey) gaFirebaseKey = (await fetch('/admin/v1/client-config').then(r => r.json())).firebaseApiKey;
  const res = await fetch(`${GA_TOKEN_URL}?key=${encodeURIComponent(gaFirebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: gaSession.refreshToken }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw gaErr('sign_in', 'Please sign in again.', 401);
  gaSession.idToken = d.id_token; gaSession.refreshToken = d.refresh_token || gaSession.refreshToken;
  gaSession.exp = Date.now() + Number(d.expires_in || 3600) * 1000; gaSave();
  return gaSession.idToken;
}
async function adminApi(path, { method = 'GET', body } = {}) {
  if (gaSession && Date.now() - gaLastActive > GA_IDLE_MS) { gaLock('Locked after 1 hour without use. Sign in again to keep working.'); throw gaErr('sign_in', 'Signed out.', 401); }
  const res = await fetch(`/admin/v1/${path}`, { method, headers: { Authorization: `Bearer ${await gaBearer()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = gaErr(data.error || `http_${res.status}`, data.message || `Request failed (${res.status}).`, res.status);
    if (res.status === 401) gaLock(data.message || 'Please sign in again.');
    throw err;
  }
  return data;
}

/* ---------- Face ID and fingerprint (the dashboard's passkeys module) ---------- */
async function gaPk() {
  if (!gaPasskeys) {
    gaPasskeys = await import('/admin/passkeys.js');
    gaPasskeys.usePasskeyHelpers({ api: adminApi, me: () => gaMe });
  }
  return gaPasskeys;
}
const gaPkSupported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
async function gaPkReady() {
  if (!gaPkSupported()) return false;
  try { return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
}
function gaPkMine() { try { return JSON.parse(localStorage.getItem('flg-admin-passkey') || 'null'); } catch (e) { return null; } }
function gaPkSkipped(email) { try { return JSON.parse(localStorage.getItem(GA_SKIP_KEY) || 'null') === email; } catch (e) { return false; } }
function gaPkSkip(email) { try { localStorage.setItem(GA_SKIP_KEY, JSON.stringify(email)); } catch (e) { /* private window */ } }
const gaPkOnHere = () => !!gaMe && gaPkMine()?.email === gaMe.email;

async function gaSetUpPasskey() {
  const pk = await gaPk();
  await pk.setUpThisDevice();
}

/* ---------- The sign-in screen ---------- */
const GA_PANES = ['signInForm', 'createForm', 'forgotForm', 'verifyBox', 'offerBox', 'deniedBox'];
function gaPane(name, { title, text, focus } = {}) {
  $('#gate').hidden = false; $('#app').hidden = true;
  for (const id of GA_PANES) $('#' + id).hidden = id !== name;
  gaError('');
  const words = {
    signInForm: ['Sign in to Book Studio', 'Use the email the owner added for you in Grid Admin.'],
    createForm: ['Create your password', `Use the email the owner added for you. Choose at least ${GA_MIN_PASSWORD} characters.`],
    forgotForm: ['Choose a new password', 'Enter your email and we will send you a link to choose a new password.'],
    verifyBox: ['Confirm your email', ''],
    offerBox: ['Sign in faster next time?', 'This device can sign you in to Book Studio with Face ID, your fingerprint or Windows Hello instead of your password.'],
    deniedBox: ['No publishing access', 'Your account is signed in but cannot publish books. Ask the owner to switch on publishing for you under Admins.'],
  }[name];
  $('#gateTitle').textContent = title || words[0];
  $('#gateText').textContent = text ?? words[1];
  $('#gateText').hidden = !$('#gateText').textContent;
  if (name === 'signInForm') gaShowPasskeyButton();
  const f = focus && $(focus);
  if (f) setTimeout(() => f.focus(), 0);
}
function gaError(message) { const e = $('#gateError'); e.textContent = message || ''; e.hidden = !message; }
async function gaShowPasskeyButton() {
  const box = $('#pkSignInBox');
  box.hidden = !gaPkSupported() || !(gaPkMine() || (await gaPkReady()));
}
function gaShowGate(kind, message) {
  if (kind === 'denied') { gaPane('deniedBox', message ? { text: message } : {}); $('#gateBack').hidden = !(gaMe && gaMe.role !== 'publisher'); return; }
  gaPane('signInForm', { text: message, focus: '#siEmail' });
  if (gaSession?.email && gaSession.email.includes('@') && !$('#siEmail').value) $('#siEmail').value = gaSession.email;
}
function gaLock(message) { gaShowGate('sign_in', message); }

// Runs a form's work with its button busy, and shows any error in the card.
async function gaBusy(button, work) {
  const label = button.textContent; button.disabled = true; button.textContent = 'One moment…'; gaError('');
  try { return await work(); } catch (e) {
    if (e.code !== 'cancelled') gaError(e.message || 'That did not work. Please try again.');
    return undefined;
  } finally { button.disabled = false; button.textContent = label; }
}

// After any sign-in: ask the server who this is, then open the studio.
async function gaEnter({ fresh = false } = {}) {
  try { gaMe = await adminApi('me'); } catch (e) {
    // No connection: an installed Book Studio still opens for the account that
    // last signed in here (sync.js), and syncs once it is back online.
    const offline = typeof gaOfflineMe === 'function' && syNetDown(e) && gaOfflineMe();
    if (offline) { gaMe = offline; syOffline = true; gaOpen(); syShow('Offline: saved here, syncs when you are back online', 'off'); return; }
    if (e.code === 'verify_email') { gaVerifyPane(); return; }
    if (e.code === 'not_admin') { gaMe = null; gaShowGate('denied', `${gaSession?.email || 'This account'} has not been given Book Studio access. Ask the owner to add this email under Admins in Grid Admin.`); return; }
    if (e.status === 403) { gaShowGate('denied', e.message); return; }
    gaShowGate('sign_in', e.code === 'sign_in' ? undefined : e.message); return;
  }
  if (!gaMe.canPublish) { gaShowGate('denied'); return; }
  if (typeof gaRememberMe === 'function') gaRememberMe();
  // Just signed in with a password on a device with Face ID or a fingerprint reader.
  if (fresh && gaSession.mode === 'firebase' && !gaPkOnHere() && !gaPkSkipped(gaMe.email) && (await gaPkReady())) { gaPane('offerBox', { focus: '#pkOfferYes' }); return; }
  gaOpen();
}
let gaOpened = false, gaOpenedAs = '';
function gaOpen() {
  $('#gate').hidden = true; $('#app').hidden = false;
  $('#whoEmail').textContent = gaMe.email; $('#backToAdmin').hidden = gaMe.role === 'publisher';
  $('[data-tab=gridbooks]').hidden = false; $('[data-tab=players]').hidden = false;
  gaRefreshPkButton();
  // Someone else signed in on this page: start again, so their books load (sync.js).
  if (gaOpened && gaOpenedAs !== gaMe.email) { location.reload(); return; }
  if (!gaOpened) { gaOpened = true; gaOpenedAs = gaMe.email; init(); }
}
async function gaRefreshPkButton() {
  $('#pkSetUp').hidden = !gaMe || !gaMe.email.includes('@') || gaPkOnHere() || !(await gaPkReady());
}
function gaVerifyPane() {
  gaPane('verifyBox', { text: `We sent a link to ${gaSession?.email || 'your email'}. Open it to confirm your address, then come back here and press Continue.` , focus: '#verifyDone' });
}

/* ---------- Grid books: the dashboard's Books and covers, inside Book Studio ---------- */
const GA_ROLES = { publisher: 0.5, viewer: 1, moderator: 2, admin: 3, owner: 4 };
let gaBooks = null;
async function gaGridBooks() {
  try {
    if (!gaBooks) gaBooks = await import('/admin/books.js');
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    await gaBooks.booksView({
      api: adminApi, esc,
      // Anyone who may publish books makes, saves and publishes them here.
      can: (role) => (role === 'admin' && gaMe?.canPublish) || (GA_ROLES[gaMe?.role] || 0) >= (GA_ROLES[role] || 9),
      ask: async ({ title, text, fields }) => {
        if (!fields) return confirm(`${title}\n\n${text || ''}`.trim());
        const out = {};
        for (const f of fields) { const v = prompt(`${title}\n${f.label}`, f.value || ''); if (v === null) return null; out[f.name] = v; }
        return out;
      },
      toast: (m) => toast(m, 5000),
      when: (t) => new Date(t).toLocaleString(),
      openInStudio: (book) => importGridBook(book),
      // Make it from a topic: the publishers to choose from, and the whole path to a submission file.
      publishers: Object.entries(PUBLISHERS).map(([id, p]) => ({ id, name: p.name, pages: (trim, paper) => ({ min: p.minPages, max: p.maxPagesFor ? p.maxPagesFor(trim, paper) : p.maxPages }) })),
      makeSubmission: (book, pub) => submitGridBook(book, pub),
    });
  } catch (e) {
    $('#books-body').textContent = e.message || 'Grid books did not load. Check your connection and try again.';
  }
}

/* Every export asks the server first. Returns false (and says why) when refused. */
async function checkInExport(kind) {
  try {
    await adminApi('publishing/export', { method: 'POST', body: { kind, title: S.meta.title || 'Untitled', platform: PUBLISHERS[S.pub].name, pages: pageCount() } });
    return true;
  } catch (e) {
    busy(false);
    if (e.status === 403) { gaShowGate('denied', e.message); return false; }
    if (e.status === 401 || e.code === 'sign_in') return false;
    toast(e.message || 'Could not reach Grid Admin. Check your connection and try again.', 6000); return false;
  }
}

function gaSignOut() {
  if (gaSession?.mode === 'passkey') fetch('/admin/v1/session/end', { method: 'POST', headers: { Authorization: `Bearer ${gaSession.key}` }, keepalive: true }).catch(() => {});
  const email = gaSession?.email;
  gaSession = null; gaMe = null; gaClear();
  $('#siPassword').value = '';
  if (email && email.includes('@')) $('#siEmail').value = email;
  gaShowGate('sign_in', 'You are signed out.');
}

function gaWire() {
  const keep = () => $('#siKeep').checked;
  $('#signInForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#siEmail').value.trim(), password = $('#siPassword').value;
    await gaBusy(e.submitter || $('#siSubmit'), async () => {
      const d = await gaFirebase('accounts:signInWithPassword', { email, password, returnSecureToken: true });
      gaSession = gaFirebaseSession(d, keep()); gaLastActive = Date.now(); gaSave();
      $('#siPassword').value = '';
      await gaEnter({ fresh: true });
    });
  };
  $('#pkSignIn').onclick = (e) => gaBusy(e.currentTarget, async () => {
    const d = await (await gaPk()).passkeySignIn();
    gaSession = { mode: 'passkey', key: d.token, email: d.email, exp: d.expiresAt, keep: keep() }; gaLastActive = Date.now(); gaSave();
    await gaEnter();
  }).finally(gaShowPasskeyButton);
  $('#toCreate').onclick = () => { $('#cfEmail').value = $('#siEmail').value; gaPane('createForm', { focus: $('#cfEmail').value ? '#cfPassword' : '#cfEmail' }); };
  $('#toForgot').onclick = () => { $('#fgEmail').value = $('#siEmail').value; gaPane('forgotForm', { focus: '#fgEmail' }); };
  // Cancel: back to the sign-in screen. An account still waiting for its
  // email to be confirmed is signed out, so nothing half-done is kept.
  for (const b of document.querySelectorAll('[data-gate-back]')) b.onclick = () => {
    if (gaSession && !gaMe) { gaSession = null; gaClear(); }
    gaPane('signInForm', { focus: '#siEmail' });
  };

  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#cfEmail').value.trim(), password = $('#cfPassword').value;
    if (password.length < GA_MIN_PASSWORD) { gaError(`Choose a longer password (at least ${GA_MIN_PASSWORD} characters).`); $('#cfPassword').focus(); return; }
    if (password !== $('#cfConfirm').value) { gaError('The two passwords are not the same.'); $('#cfConfirm').focus(); return; }
    await gaBusy(e.submitter || $('#cfSubmit'), async () => {
      const d = await gaFirebase('accounts:signUp', { email, password, returnSecureToken: true });
      gaSession = gaFirebaseSession(d, keep()); gaLastActive = Date.now(); gaSave();
      await gaFirebase('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: d.idToken });
      $('#cfPassword').value = ''; $('#cfConfirm').value = ''; $('#siEmail').value = email;
      gaVerifyPane();
    });
  };
  $('#forgotForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#fgEmail').value.trim();
    await gaBusy(e.submitter || $('#fgSubmit'), async () => {
      // Said the same way whether or not the email has an account.
      try { await gaFirebase('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); } catch (err) { if (err.code === 'not_set_up' || err.code === 'INVALID_EMAIL' || err.code === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw err; }
      $('#siEmail').value = email;
      gaPane('signInForm', { text: `If ${email} has an account, a link to choose a new password is on its way. Then sign in here.`, focus: '#siPassword' });
    });
  };
  $('#verifyResend').onclick = (e) => gaBusy(e.currentTarget, async () => {
    await gaFirebase('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: await gaBearer() });
    toast('Link sent. Check your email.');
  });
  // The token only says the email is confirmed once it is refreshed.
  $('#verifyDone').onclick = (e) => gaBusy(e.currentTarget, async () => {
    if (!gaSession) { gaShowGate('sign_in'); return; }
    gaSession.exp = 0; await gaBearer();
    await gaEnter({ fresh: true });
    if (!$('#verifyBox').hidden) gaError('Your email is not confirmed yet. Open the link in the email, then press Continue.');
  });
  $('#pkOfferYes').onclick = (e) => gaBusy(e.currentTarget, async () => {
    await gaSetUpPasskey();
    toast('Set up. Next time, sign in with Face ID or fingerprint.');
    gaOpen();
  });
  $('#pkOfferNo').onclick = () => { gaPkSkip(gaMe?.email || ''); toast('You can turn it on later with the Face ID button at the top.'); gaOpen(); };
  $('#pkSetUp').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await gaSetUpPasskey(); toast('Set up. Next time, sign in with Face ID or fingerprint.'); } catch (err) {
      if (err.code !== 'cancelled') toast(err.message || 'Face ID or fingerprint did not work. Please try again.', 7000);
    } finally { b.disabled = false; gaRefreshPkButton(); }
  };
  $('#gateOther').onclick = () => gaSignOut();
  $('#signOutBtn').onclick = gaSignOut;
}

async function gaStart() {
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { const was = gaLastActive; gaLastActive = Date.now(); if (gaSession && gaLastActive - was > 30_000) gaSave(); }, { passive: true });
  setInterval(() => { if (gaSession && Date.now() - gaLastActive > GA_IDLE_MS) gaLock('Locked after 1 hour without use. Sign in again to keep working.'); }, 60_000);
  gaWire();
  gaSession = gaLoad();
  if (gaSession?.seen) gaLastActive = gaSession.seen;
  $('#siKeep').checked = !!gaSession?.keep;
  if (!gaSession || Date.now() - gaLastActive > GA_IDLE_MS) { gaShowGate('sign_in'); return; }
  await gaEnter();
}
gaStart();
