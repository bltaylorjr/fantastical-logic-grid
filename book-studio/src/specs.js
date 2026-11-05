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
