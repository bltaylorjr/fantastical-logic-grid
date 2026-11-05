// Books (server/src/books.js): print puzzle books for publishing, from every
// game, with their covers.
//
// - A book is one game or a mix of games ("sections": game, level, size,
//   story theme and how many). Puzzles are made by the website's Book maker
//   (web/js/book-maker.js), shown here in a frame: the same engines and print
//   layouts as the games themselves. Puzzles already in any book are never
//   made again (the server keeps every fingerprint), and every puzzle's words
//   go through the trademark and copyright watch list before it is kept.
// - The interior: title page, copyright page, contents, how to play each
//   game, the puzzles (numbered), the answer keys (at the back or after each
//   puzzle, one or two to a page), and blank pages to reach the printer's
//   minimum and an even count. Page sizes, gutter and outside margins follow
//   the usual print-on-demand rules (Amazon KDP: the gutter grows with the
//   page count). Print it and choose Save as PDF for the print file.
// - The cover: one full wrap (back, spine, front) with bleed, the spine width
//   from the page count and paper, a space left for the barcode, from cover
//   templates for every game (each draws that game's own puzzle picture; a
//   mix shows several). Change colors and words, save your own templates, and
//   print the cover or download it as SVG.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let h = null;          // helpers from admin.js
let data = null;       // { books, templates, used, trims, siteUrl }
let book = null;       // the book being edited
let games = [];        // from the Book maker: [{ id, name, levels, themes }]
let frame = null, coverFrame = null, ready = null, coverReady = null;
let req = 0;
const waiting = new Map();
let busy = false;

// ---------- sizes and print rules ----------

export const TRIM = { '6x9': [6, 9], '7x10': [7, 10], '8x10': [8, 10], '8.25x11': [8.25, 11], '8.5x11': [8.5, 11] };
const TRIM_NAMES = { '6x9': '6 × 9 in (most popular for puzzle books)', '7x10': '7 × 10 in', '8x10': '8 × 10 in', '8.25x11': '8.25 × 11 in', '8.5x11': '8.5 × 11 in (Letter, large print)' };
// Paper thickness per page, inches (Amazon KDP's figures).
export const PAPER = { white: 0.002252, cream: 0.0025 };
export const BLEED = 0.125;
export const MIN_PAGES = 24;
// The inside margin (gutter) grows with the page count (KDP's table).
export const gutterFor = (pages) => (pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875);
export const spineFor = (pages, paper) => +(pages * (PAPER[paper] || PAPER.white)).toFixed(4);
// Spine words only on books with more than 79 pages (narrower spines cannot hold them safely).
export const spineTextOk = (pages) => pages > 79;
const OUT = 0.375, TOP = 0.5, BOTTOM = 0.65;

// ---------- talking to the Book maker ----------

function onMessage(e) {
  if (!data || e.origin !== new URL(data.siteUrl).origin || !e.data) return;
  const m = e.data;
  if (m.type === 'flg-book-ready') { if (e.source === frame?.contentWindow) ready?.resolve(); if (e.source === coverFrame?.contentWindow) coverReady?.resolve(); return; }
  if (m.type === 'flg-book-games') { waiting.get('games')?.(m); waiting.delete('games'); return; }
  if (m.type === 'flg-book-progress') { const p = $('#bk-progress'); if (p) p.textContent = `${m.done} of ${m.count} made…`; return; }
  const w = waiting.get(m.req);
  if (w) { waiting.delete(m.req); w(m); }
}
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); p.resolve = resolve; return p; };
function send(win, msg, key) {
  return new Promise((resolve) => {
    waiting.set(key, resolve);
    win.postMessage(msg, new URL(data.siteUrl).origin);
  });
}
async function maker() {
  await Promise.race([ready, new Promise((_, no) => setTimeout(() => no(new Error('The website did not answer. Check that it is online, then open this page again.')), 30000))]);
  return frame.contentWindow;
}
async function ask(msg) {
  const win = await maker();
  const id = `r${++req}`;
  const m = await send(win, { ...msg, req: id }, id);
  if (m.type === 'flg-book-error') throw new Error(m.message);
  return m;
}

// ---------- the interior ----------

const LEVEL_ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'master', 'mensa', 'theorist'];
const gameName = (id) => games.find((g) => g.id === id)?.name || id;

// Mix: one from each section in turn; together: section after section.
function ordered(b) {
  const bySection = new Map();
  for (const p of b.puzzles) { if (!bySection.has(p.section)) bySection.set(p.section, []); bySection.get(p.section).push(p); }
  if (b.settings.order !== 'mixed') return [...bySection.keys()].sort((x, y) => x - y).flatMap((k) => bySection.get(k));
  const lists = [...bySection.keys()].sort((x, y) => x - y).map((k) => bySection.get(k).slice());
  const out = [];
  while (lists.some((l) => l.length)) for (const l of lists) if (l.length) out.push(l.shift());
  return out;
}

const fontCss = `@font-face { font-family: "Atkinson Hyperlegible"; src: url(../fonts/atkinson-400.woff2) format("woff2"); font-weight: 400; }
@font-face { font-family: "Atkinson Hyperlegible"; src: url(../fonts/atkinson-700.woff2) format("woff2"); font-weight: 700; }
@font-face { font-family: "Cinzel"; src: url(../fonts/cinzel-700.woff2) format("woff2"); font-weight: 700; }`;

// The book as pages: each { kind, head, body, front, half }.
export function layout(b) {
  const e = h.esc;
  const list = ordered(b);
  const pages = [];
  const year = new Date().getFullYear();
  const author = b.author || 'Bobby Taylor';
  pages.push({ kind: 'title', front: true, body: `<div class="bk-title"><p class="bk-brand">The Logic Grid</p><h1>${e(b.title)}</h1>${b.subtitle ? `<p class="bk-sub">${e(b.subtitle)}</p>` : ''}${b.volume > 1 || b.settings.showVolume ? `<p class="bk-vol">Volume ${b.volume}</p>` : ''}<p class="bk-author">${e(author)}</p></div>` });
  const gameIds = [...new Set(list.map((p) => p.game))];
  const notices = gameIds.includes('cw') ? '<p>Crossword answers and clues are drawn from WordNet 3.0, Copyright 2006 by Princeton University, used under its license.</p>' : '';
  pages.push({ kind: 'copyright', front: true, body: `<div class="bk-copy"><p><b>${e(b.title)}</b>${b.subtitle ? `<br>${e(b.subtitle)}` : ''}</p>
    <p>Copyright © ${year} ${e(author)}. All rights reserved.</p>
    <p>No part of this book may be copied, stored or shared in any form without written permission from the copyright owner, except for brief quotations in reviews.</p>
    <p>The Logic Grid™ and The Fantastical Logic Grid™ are trademarks of ${e(author)}.</p>
    ${b.settings.isbn ? `<p>ISBN ${e(b.settings.isbn)}</p>` : ''}
    <p>${b.edition > 1 ? `Edition ${b.edition}. ` : 'First edition. '}${b.volume ? `Volume ${b.volume}.` : ''}</p>
    <p>Every puzzle in this book is new, has exactly one answer, and can be solved by logic alone. More puzzles every day at thelogicgrid.com.</p>${notices}</div>` });
  // Contents: filled in once the page numbers are known.
  const contentsAt = b.settings.contents === false ? -1 : pages.length;
  if (contentsAt >= 0) pages.push({ kind: 'contents', front: true, body: '' });
  const howAt = new Map();
  if (b.settings.howto !== false) {
    // Up to three games' rules on a page.
    for (let k = 0; k < gameIds.length; k += 3) {
      const group = gameIds.slice(k, k + 3);
      for (const g of group) howAt.set(g, pages.length + 1);
      pages.push({ kind: 'howto', fitAll: true, body: group.map((g) => {
        const first = list.find((p) => p.game === g);
        return `<div class="bk-how"><h2>How to play ${e(gameName(g))}</h2><ul>${(first.rules || []).map((r) => `<li>${e(r)}</li>`).join('')}</ul></div>`;
      }).join('') + `<p class="bk-muted">Every puzzle has exactly one answer. The answers are ${b.settings.keys === 'each' ? 'after each puzzle' : 'at the back of the book'}.</p>` });
    }
  }
  const numbered = list.map((p, k) => ({ ...p, n: k + 1 }));
  const startAt = new Map();
  const keyPage = (p) => `<div class="bk-key"><p class="bk-keyh">Puzzle ${p.n}: ${e(p.title)}</p><div class="bk-room"><div class="bk-fit bk-g-${e(p.game)}">${p.key}</div></div></div>`;
  for (const p of numbered) {
    startAt.set(p.n, pages.length + 1);
    const parts = String(p.page).split('<div class="bk-break"></div>');
    parts.forEach((part, k) => pages.push({ kind: 'puzzle', head: `Puzzle ${p.n}${parts.length > 1 ? ` (${k + 1} of ${parts.length})` : ''} · ${e(p.gameName)} · ${e(p.level)}`, body: `<div class="bk-fit bk-g-${e(p.game)}">${part}</div>` }));
    if (b.settings.keys === 'each') pages.push({ kind: 'key', head: `Answer · Puzzle ${p.n}`, body: keyPage(p), keys: 1 });
  }
  let answersAt = -1;
  if (b.settings.keys !== 'each') {
    answersAt = pages.length + 1;
    pages.push({ kind: 'answers', body: '<div class="bk-title"><h1>Answers</h1></div>' });
    const per = b.settings.keysPerPage === 2 ? 2 : 1;
    for (let k = 0; k < numbered.length; k += per) {
      const group = numbered.slice(k, k + per);
      pages.push({ kind: 'key', head: `Answers · Puzzle ${group[0].n}${group.length > 1 ? `–${group[group.length - 1].n}` : ''}`, body: group.map(keyPage).join(''), keys: group.length });
    }
  }
  // Blank pages for notes: at least the printer's minimum, and an even count.
  while (pages.length < MIN_PAGES || pages.length % 2) pages.push({ kind: 'notes', body: '<div class="bk-notes"><h2>Notes</h2></div>' });
  if (contentsAt >= 0) {
    // Runs of puzzles from the same game and level read as one line.
    const runs = [];
    for (const p of numbered) {
      const last = runs[runs.length - 1];
      if (last && last.game === p.game && last.level === p.level && last.to === p.n - 1) last.to = p.n;
      else runs.push({ game: p.game, gameName: p.gameName, level: p.level, from: p.n, to: p.n });
    }
    const line = (label, page) => `<li><span>${label}</span><span class="bk-dots"></span><span>${page}</span></li>`;
    const lines = [
      ...[...howAt].map(([g, at]) => line(`How to play ${e(gameName(g))}`, at)),
      ...runs.map((r) => line(`${r.from === r.to ? `Puzzle ${r.from}` : `Puzzles ${r.from}–${r.to}`}: ${e(r.gameName)}, ${e(r.level)}`, startAt.get(r.from))),
      ...(answersAt > 0 ? [line('Answers', answersAt)] : []),
    ];
    pages[contentsAt].body = `<div class="bk-contents"><h2>Contents</h2><ol>${lines.join('')}</ol></div>`;
    pages[contentsAt].fitAll = true;
  }
  return pages;
}

export function interiorCss(b, pageCount) {
  const [W, H] = TRIM[b.trim];
  const G = gutterFor(pageCount);
  const inner = (H - TOP - BOTTOM).toFixed(3);
  const games = Object.values(b.css || {}).join('\n');
  return `${fontCss}
@page { size: ${W}in ${H}in; margin: ${TOP}in ${OUT}in ${BOTTOM}in ${OUT}in;
  @bottom-center { content: counter(page); font: 9pt "Atkinson Hyperlegible", sans-serif; } }
@page :right { margin-left: ${G}in; margin-right: ${OUT}in; }
@page :left { margin-left: ${OUT}in; margin-right: ${G}in; }
@page front { @bottom-center { content: none; } }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font: 10.5pt/1.35 "Atkinson Hyperlegible", "Segoe UI", sans-serif; }
.bk-page { position: relative; height: ${inner}in; overflow: hidden; break-after: page; }
.bk-page:last-child { break-after: auto; }
.bk-page.bk-front { page: front; }
.bk-head { height: 0.3in; font-size: 8.5pt; color: #333; border-bottom: 0.5pt solid #999; margin-bottom: 0.1in; }
.bk-room { position: absolute; left: 0; right: 0; bottom: 0; top: 0; overflow: hidden; }
.bk-page.has-head > .bk-room { top: 0.4in; }
.bk-fit { margin: 0 auto; }
.bk-fit table { margin-left: auto; margin-right: auto; }
.bk-key { position: relative; height: calc(100% / var(--keys, 1)); }
.bk-key .bk-room { top: 0.3in; }
.bk-keyh { margin: 0; font-weight: 700; font-size: 10pt; }
.bk-title { text-align: center; padding-top: 1.6in; }
.bk-title h1 { font: 700 26pt/1.15 "Cinzel", Georgia, serif; margin: 0 0 .2in; }
.bk-brand { letter-spacing: .2em; text-transform: uppercase; font-size: 9pt; margin: 0 0 .3in; }
.bk-sub { font-size: 13pt; margin: 0 0 .15in; } .bk-vol { font-size: 12pt; font-weight: 700; } .bk-author { margin-top: .6in; font-size: 12pt; }
.bk-copy { position: absolute; bottom: 0; font-size: 8.5pt; } .bk-copy p { margin: 0 0 6pt; }
.bk-contents h2, .bk-how h2, .bk-notes h2 { font: 700 15pt "Cinzel", Georgia, serif; margin: 0 0 .15in; }
.bk-contents ol { list-style: none; padding: 0; margin: 0; }
.bk-contents li { display: flex; gap: 4pt; margin: 0 0 4pt; } .bk-dots { flex: 1; border-bottom: 0.6pt dotted #555; margin-bottom: 3pt; }
.bk-how { margin-bottom: .25in; } .bk-how ul { padding-left: 14pt; } .bk-how li { margin-bottom: 4pt; } .bk-muted { color: #444; font-size: 9pt; }
.bk-notes { height: 100%; background: repeating-linear-gradient(#fff 0 0.33in, #bbb 0.33in calc(0.33in + 0.5pt)); }
.bk-notes h2 { background: #fff; }
@media screen {
  body.bk-shown { background: #e9ebf1; padding: 16px 0; }
  .bk-page { width: ${(W - OUT - G).toFixed(3)}in; margin: 0 auto 16px; background: #fff; box-shadow: 0 0 0 ${OUT}in #fff, 0 2px 12px rgba(0,0,0,.25); outline: 1px dashed #c8cbd6; }
}
@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
${games}`;
}

export function interiorHtml(b) {
  const pages = layout(b);
  const html = pages.map((p) => {
    const cls = ['bk-page', p.front ? 'bk-front' : '', p.head ? 'has-head' : ''].filter(Boolean).join(' ');
    if (p.kind === 'puzzle') return `<section class="${cls}"><div class="bk-head">${p.head}</div><div class="bk-room">${p.body}</div></section>`;
    if (p.kind === 'key') return `<section class="${cls}" style="--keys:${p.keys}"><div class="bk-head">${p.head}</div><div class="bk-room">${p.body}</div></section>`;
    if (p.fitAll) return `<section class="${cls}"><div class="bk-room"><div class="bk-fit">${p.body}</div></div></section>`;
    return `<section class="${cls}">${p.body}</section>`;
  }).join('');
  return { html, pages: pages.length, css: interiorCss(b, pages.length) };
}

// ---------- covers ----------

const PT = 72; // points to the inch
// Each game's own little puzzle picture, drawn in a box at (x, y) of size s.
export function motif(game, x, y, s, c) {
  const n = 5, q = s / n;
  const cells = (fn) => { let o = ''; for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) o += fn(r, k, x + k * q, y + r * q); return o; };
  const grid = (stroke = c.ink, w = s / 90) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${c.paper}" stroke="${stroke}" stroke-width="${w * 2}"/>${[...Array(n - 1)].map((_, i) => `<line x1="${x + (i + 1) * q}" y1="${y}" x2="${x + (i + 1) * q}" y2="${y + s}" stroke="${stroke}" stroke-width="${w}"/><line x1="${x}" y1="${y + (i + 1) * q}" x2="${x + s}" y2="${y + (i + 1) * q}" stroke="${stroke}" stroke-width="${w}"/>`).join('')}`;
  const txt = (tx, ty, t, size, fill = c.ink, weight = 700) => `<text x="${tx}" y="${ty}" font-family="Atkinson Hyperlegible, sans-serif" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  const star = (cx, cy, r, fill) => { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`); } return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`; };
  switch (game) {
    case 'flg': return grid() + cells((r, k, cx, cy) => (r === k ? `<circle cx="${cx + q / 2}" cy="${cy + q / 2}" r="${q * 0.3}" fill="none" stroke="${c.accent}" stroke-width="${q / 9}"/>` : (r + k) % 2 ? `<path d="M${cx + q * 0.28} ${cy + q * 0.28}L${cx + q * 0.72} ${cy + q * 0.72}M${cx + q * 0.72} ${cy + q * 0.28}L${cx + q * 0.28} ${cy + q * 0.72}" stroke="${c.ink}" stroke-width="${q / 12}"/>` : ''));
    case 'np': { const d = [5, 3, '', '', 7, 6, '', 1, 9, '', '', 9, 8, '', 6, 8, '', '', 6, 3, 4, '', 8, '', 1]; return grid() + cells((r, k, cx, cy) => (d[r * n + k] ? txt(cx + q / 2, cy + q / 2, d[r * n + k], q * 0.55, (r + k) % 3 ? c.ink : c.accent) : '')); }
    case 'cm': return grid() + `<rect x="${x + q * 0.12}" y="${y + q * 0.12}" width="${q * 1.76}" height="${q * 0.76}" fill="none" stroke="${c.accent}" stroke-width="${q / 14}" stroke-dasharray="${q / 8} ${q / 10}"/>${txt(x + q * 0.45, y + q * 0.3, '7+', q * 0.28)}<rect x="${x + q * 2.12}" y="${y + q * 1.12}" width="${q * 0.76}" height="${q * 1.76}" fill="none" stroke="${c.accent}" stroke-width="${q / 14}" stroke-dasharray="${q / 8} ${q / 10}"/>${txt(x + q * 2.45, y + q * 1.3, '12×', q * 0.26)}` + cells((r, k, cx, cy) => ((r * 7 + k * 3) % 4 === 0 ? txt(cx + q / 2, cy + q * 0.6, ((r + k) % 5) + 1, q * 0.45) : ''));
    case 'sc': return cells((r, k, cx, cy) => { const black = r === 0 || k === 0 || (r + k) % 4 === 0; return `<rect x="${cx}" y="${cy}" width="${q}" height="${q}" fill="${black ? c.ink : c.paper}" stroke="${c.ink}" stroke-width="${q / 30}"/>${black && (r || k) ? `<line x1="${cx}" y1="${cy}" x2="${cx + q}" y2="${cy + q}" stroke="${c.paper}" stroke-width="${q / 30}"/>${txt(cx + q * 0.7, cy + q * 0.3, (r * 3 + k * 5) % 17 + 3, q * 0.24, c.paper)}` : ''}${!black && (r * k) % 3 === 1 ? txt(cx + q / 2, cy + q / 2, (r + k) % 9 + 1, q * 0.5, c.accent) : ''}`; });
    case 'pg': { const heart = ['01010', '11111', '11111', '01110', '00100']; return grid() + cells((r, k, cx, cy) => (heart[r][k] === '1' ? `<rect x="${cx + q * 0.06}" y="${cy + q * 0.06}" width="${q * 0.88}" height="${q * 0.88}" fill="${c.accent}"/>` : '')); }
    case 'ml': return grid() + cells((r, k, cx, cy) => `${k < n - 1 && (r + k) % 2 ? txt(cx + q, cy + q / 2, (r * k) % 2 ? '‹' : '›', q * 0.5, c.accent) : ''}${(r * 2 + k) % 5 === 0 ? txt(cx + q / 2, cy + q / 2, (r + k) % 5 + 1, q * 0.45) : ''}`);
    case 'sk': { const g = s * 0.8, gx = x + s * 0.1, gy = y + s * 0.1, gq = g / 4; let o = `<rect x="${gx}" y="${gy}" width="${g}" height="${g}" fill="${c.paper}" stroke="${c.ink}" stroke-width="${s / 45}"/>`; for (let i = 0; i < 4; i++) { o += txt(gx + gq * (i + 0.5), y + s * 0.05, [2, 1, 3, 2][i], s * 0.07, c.accent) + txt(gx + gq * (i + 0.5), gy + gq * ([3, 1, 2, 0][i] + 0.6), '', 1); o += `<rect x="${gx + gq * (i + 0.2)}" y="${gy + g - gq * (i + 1) * 0.9}" width="${gq * 0.6}" height="${gq * (i + 1) * 0.9}" fill="${c.ink}" opacity="${0.35 + i * 0.15}"/>`; } return o; }
    case 'sf': return grid() + cells((r, k, cx, cy) => ((r * 2 + k) % 5 === 1 ? star(cx + q / 2, cy + q / 2, q * 0.38, c.accent) : ''));
    case 'll': { let o = ''; for (let r = 0; r <= 4; r++) for (let k = 0; k <= 4; k++) o += `<circle cx="${x + k * s / 4}" cy="${y + r * s / 4}" r="${s / 60}" fill="${c.ink}"/>`; const u = s / 4; return `<rect x="${x - s * 0.05}" y="${y - s * 0.05}" width="${s * 1.1}" height="${s * 1.1}" fill="${c.paper}"/>${o}<path d="M${x + u} ${y}H${x + 3 * u}V${y + u}H${x + 4 * u}V${y + 3 * u}H${x + 2 * u}V${y + 4 * u}H${x}V${y + 2 * u}H${x + u}Z" fill="none" stroke="${c.accent}" stroke-width="${s / 30}" stroke-linejoin="round"/>${txt(x + u * 1.5, y + u * 0.5, 3, s * 0.08)}${txt(x + u * 2.5, y + u * 2.5, 1, s * 0.08)}`; }
    case 'ib': { const isl = [[0.15, 0.15, 2], [0.85, 0.15, 3], [0.85, 0.85, 2], [0.15, 0.85, 1], [0.5, 0.5, 4]]; const P = (a) => [x + a[0] * s, y + a[1] * s]; let o = `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${c.paper}"/>`; for (const [a, b2, two] of [[0, 1, 1], [1, 2, 0], [0, 4, 0], [4, 2, 1], [3, 4, 0]]) { const [x1, y1] = P(isl[a]), [x2, y2] = P(isl[b2]); o += two ? `<line x1="${x1}" y1="${y1 - s / 40}" x2="${x2}" y2="${y2 - s / 40}" stroke="${c.ink}" stroke-width="${s / 70}"/><line x1="${x1}" y1="${y1 + s / 40}" x2="${x2}" y2="${y2 + s / 40}" stroke="${c.ink}" stroke-width="${s / 70}"/>` : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.ink}" stroke-width="${s / 70}"/>`; } for (const a of isl) { const [cx, cy] = P(a); o += `<circle cx="${cx}" cy="${cy}" r="${s * 0.1}" fill="${c.paper}" stroke="${c.accent}" stroke-width="${s / 50}"/>${txt(cx, cy, a[2], s * 0.1)}`; } return o; }
    case 'cw': { const blk = ['00010', '00000', '01010', '00000', '01000']; const letters = ['CAT A', 'OPERA', 'D T R', 'ELBOW', 'S EYE']; return cells((r, k, cx, cy) => `<rect x="${cx}" y="${cy}" width="${q}" height="${q}" fill="${blk[r][k] === '1' ? c.ink : c.paper}" stroke="${c.ink}" stroke-width="${q / 25}"/>${blk[r][k] === '1' || letters[r][k] === ' ' ? '' : txt(cx + q / 2, cy + q * 0.56, letters[r][k], q * 0.5, (r + k) % 3 ? c.ink : c.accent)}`); }
    default: return grid();
  }
}

// Words in SVG, wrapped to a width (a fair guess at the font's letter width).
function svgText(x, y, words, { size, width, font = 'Atkinson Hyperlegible, sans-serif', weight = 400, fill, anchor = 'middle', lead = 1.2, maxLines = 6 }) {
  const per = Math.max(4, Math.floor(width / (size * (font.startsWith('Cinzel') ? 0.72 : 0.52))));
  const lines = [];
  for (const para of String(words || '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > per && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
  }
  return { svg: lines.slice(0, maxLines).map((l, i) => `<text x="${x}" y="${y + i * size * lead}" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="hanging">${h.esc(l)}</text>`).join(''), height: Math.min(lines.length, maxLines) * size * lead };
}

const seeded = (s) => { let a = 0; for (const ch of String(s)) a = (a * 31 + ch.charCodeAt(0)) >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };

// The built-in cover templates. Each draws the whole wrap in points.
export const COVER_TEMPLATES = [
  { id: 'classic', name: 'Classic frame', colors: { bg: '#1F3A5F', accent: '#F5C451', ink: '#1F3A5F', paper: '#FFFFFF', text: '#FFFFFF' }, note: 'A framed front with the puzzle picture in the middle' },
  { id: 'band', name: 'Bold band', colors: { bg: '#B23A48', accent: '#FFD166', ink: '#222222', paper: '#FFFFFF', text: '#FFFFFF' }, note: 'A wide band across the front for the title' },
  { id: 'night', name: 'Night sky', colors: { bg: '#0C1445', accent: '#F5C451', ink: '#0C1445', paper: '#F4F1E8', text: '#FFFFFF' }, note: 'Deep blue with stars, a title in capitals' },
  { id: 'pattern', name: 'Puzzle pattern', colors: { bg: '#2F8F83', accent: '#FF8C42', ink: '#1B3B36', paper: '#FFFFFF', text: '#1B3B36' }, note: 'The puzzle pictures repeated, with a white title card' },
  { id: 'minimal', name: 'Clean and simple', colors: { bg: '#FAFAF7', accent: '#5B3CC4', ink: '#121626', paper: '#FFFFFF', text: '#121626' }, note: 'Light paper, big type, one small picture' },
  { id: 'bright', name: 'Bright blocks', colors: { bg: '#FFFFFF', accent: '#5B3CC4', ink: '#121626', paper: '#FFFFFF', text: '#121626' }, note: 'Colored squares with every game\'s picture: made for mixed books' },
];
const BLOCK_COLORS = ['#F94144', '#F3722C', '#F9C74F', '#90BE6D', '#43AA8B', '#577590', '#9B5DE5', '#F15BB5'];

export function coverDims(b, pages) {
  const [W, H] = TRIM[b.trim];
  const spine = spineFor(pages, b.paper);
  return { W, H, spine, total: [2 * BLEED + 2 * W + spine, 2 * BLEED + H] };
}

export function coverSvg(b, pages, { guides = false } = {}) {
  const d = b.cover || {};
  const tpl = COVER_TEMPLATES.find((t) => t.id === d.template) || COVER_TEMPLATES[0];
  const c = { ...tpl.colors, ...(d.colors || {}) };
  const { W, H, spine, total } = coverDims(b, pages);
  const TW = total[0] * PT, TH = total[1] * PT, bl = BLEED * PT, w = W * PT, hh = H * PT, sp = spine * PT;
  const backX = bl, spineX = bl + w, frontX = bl + w + sp;
  const safe = 0.25 * PT;
  const gamesIn = [...new Set((b.puzzles || []).map((p) => p.game))];
  const motifs = d.motif && d.motif !== 'auto' ? [d.motif] : gamesIn.length ? gamesIn : ['flg'];
  const count = (b.puzzles || []).length;
  const fx = frontX + w / 2;
  let o = `<rect width="${TW}" height="${TH}" fill="${c.bg}"/>`;
  const rand = seeded(`${b.title}|${tpl.id}`);
  const title = (y, size, fill, width = w - 2 * safe - 20) => svgText(fx, y, b.title, { size, width, font: 'Cinzel, Georgia, serif', weight: 700, fill, maxLines: 3 });
  // Front.
  if (tpl.id === 'classic') {
    o += `<rect x="${frontX + safe}" y="${bl + safe}" width="${w - 2 * safe}" height="${hh - 2 * safe}" fill="none" stroke="${c.accent}" stroke-width="3"/>`;
    const t = title(bl + hh * 0.1, w * 0.1, c.text);
    o += t.svg;
    const s = w * 0.45;
    motifs.slice(0, 4).forEach((g, i, a) => {
      const ss = a.length > 1 ? s * 0.55 : s;
      const row = a.length > 1 ? Math.floor(i / 2) : 0, inRow = a.length > 1 ? Math.min(2, a.length - row * 2) : 1, col = a.length > 1 ? i % 2 : 0;
      const left = fx - (inRow * ss + (inRow - 1) * ss * 0.16) / 2;
      o += motif(g, left + col * ss * 1.16, bl + hh * 0.42 + row * ss * 1.16, ss, c);
    });
  } else if (tpl.id === 'band') {
    o += `<rect x="${frontX}" y="${bl + hh * 0.52}" width="${w + bl}" height="${hh * 0.3}" fill="${c.accent}"/>`;
    const t = svgText(fx, bl + hh * 0.56, b.title, { size: w * 0.095, width: w - 2 * safe, font: 'Cinzel, Georgia, serif', weight: 700, fill: c.ink, maxLines: 3 });
    o += t.svg;
    const s = w * 0.2;
    motifs.slice(0, 3).forEach((g, i, a) => { o += motif(g, fx - (a.length * s * 1.15) / 2 + i * s * 1.15, bl + hh * 0.18, s, c); });
  } else if (tpl.id === 'night') {
    for (let i = 0; i < 140; i++) { const sx = rand() * TW, sy = rand() * TH, r = rand() * 1.6 + 0.3; o += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(2)}" fill="#FFFFFF" opacity="${(0.35 + rand() * 0.6).toFixed(2)}"/>`; }
    const t = svgText(fx, bl + hh * 0.12, b.title.toUpperCase(), { size: w * 0.085, width: w - 2 * safe, font: 'Cinzel, Georgia, serif', weight: 700, fill: c.accent, maxLines: 3 });
    o += t.svg;
    const s = w * 0.42;
    o += `<circle cx="${fx}" cy="${bl + hh * 0.6}" r="${s * 0.72}" fill="${c.accent}" opacity="0.1"/>`;
    o += motif(motifs[0], fx - s / 2, bl + hh * 0.6 - s / 2, s, c);
  } else if (tpl.id === 'pattern') {
    const s = w * 0.17;
    let k = 0;
    for (let yy = -s / 2; yy < TH; yy += s * 1.35) for (let xx = frontX - s; xx < TW; xx += s * 1.35) { o += `<g opacity="0.35">${motif(motifs[k++ % motifs.length], xx, yy, s, c)}</g>`; }
    o += `<rect x="${frontX + safe + 8}" y="${bl + hh * 0.3}" width="${w - 2 * safe - 16}" height="${hh * 0.36}" rx="14" fill="${c.paper}"/>`;
    o += svgText(fx, bl + hh * 0.34, b.title, { size: w * 0.085, width: w - 2 * safe - 40, font: 'Cinzel, Georgia, serif', weight: 700, fill: c.text, maxLines: 3 }).svg;
  } else if (tpl.id === 'minimal') {
    o += `<line x1="${frontX + safe + 10}" y1="${bl + hh * 0.36}" x2="${frontX + w - safe - 10}" y2="${bl + hh * 0.36}" stroke="${c.accent}" stroke-width="2"/>`;
    o += svgText(frontX + safe + 10, bl + hh * 0.12, b.title, { size: w * 0.11, width: w - 2 * safe - 20, font: 'Cinzel, Georgia, serif', weight: 700, fill: c.text, anchor: 'start', maxLines: 3 }).svg;
    o += motif(motifs[0], frontX + w - safe - w * 0.3, bl + hh * 0.62, w * 0.26, c);
  } else if (tpl.id === 'bright') {
    const cols = 3, s = (w - 2 * safe) / cols;
    let k = 0;
    for (let r = 0; r < 3; r++) for (let q = 0; q < cols; q++) {
      const bx = frontX + safe + q * s, by = bl + hh * 0.42 + r * s * 0.86;
      if (by + s * 0.8 > bl + hh - safe - 40) continue;
      o += `<rect x="${bx + 3}" y="${by}" width="${s - 6}" height="${s * 0.8}" rx="10" fill="${BLOCK_COLORS[k % BLOCK_COLORS.length]}"/>`;
      o += motif(motifs[k % motifs.length], bx + s * 0.22, by + s * 0.1, s * 0.56, { ...c, accent: '#121626' });
      k++;
    }
    o += svgText(fx, bl + hh * 0.08, b.title, { size: w * 0.095, width: w - 2 * safe, font: 'Cinzel, Georgia, serif', weight: 700, fill: c.text, maxLines: 3 }).svg;
  }
  // Subtitle, volume and author on every front.
  const textOn = ['band', 'pattern', 'minimal', 'bright'].includes(tpl.id) ? c.text : c.text;
  const subY = { classic: 0.3, band: 0.72, night: 0.32, pattern: 0.54, minimal: 0.4, bright: 0.3 }[tpl.id];
  const subFill = tpl.id === 'band' ? c.ink : tpl.id === 'night' ? '#FFFFFF' : textOn;
  if (b.subtitle) o += svgText(tpl.id === 'minimal' ? frontX + safe + 10 : fx, bl + hh * subY, b.subtitle, { size: w * 0.042, width: w - 2 * safe - 30, fill: subFill, anchor: tpl.id === 'minimal' ? 'start' : 'middle', maxLines: 2 }).svg;
  if (d.tagline) o += svgText(fx, bl + hh * (tpl.id === 'band' ? 0.86 : 0.88) - w * 0.04, d.tagline, { size: w * 0.034, width: w - 2 * safe - 30, fill: tpl.id === 'night' ? '#FFFFFF' : tpl.id === 'band' ? c.text : textOn, maxLines: 2 }).svg;
  const vol = b.volume > 1 || b.settings?.showVolume ? `Volume ${b.volume}` : '';
  const foot = [vol, b.author || 'Bobby Taylor'].filter(Boolean).join('  ·  ');
  o += `<text x="${fx}" y="${bl + hh - safe - 14}" font-family="Atkinson Hyperlegible, sans-serif" font-size="${w * 0.04}" font-weight="700" fill="${tpl.id === 'night' ? '#FFFFFF' : tpl.id === 'band' ? c.text : textOn}" text-anchor="middle">${h.esc(foot)}</text>`;
  // Spine.
  o += `<rect x="${spineX}" y="0" width="${sp}" height="${TH}" fill="${tpl.id === 'minimal' || tpl.id === 'bright' ? c.accent : c.bg}"/>`;
  if (spineTextOk(pages) && d.spineText !== false) {
    const sz = Math.min(sp * 0.5, 16);
    const words = `${b.title}${vol ? ` · ${vol}` : ''}`;
    o += `<text transform="translate(${spineX + sp / 2} ${TH / 2}) rotate(90)" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="${sz}" fill="${tpl.id === 'minimal' || tpl.id === 'bright' ? '#FFFFFF' : c.text === c.ink ? c.text : tpl.id === 'night' ? c.accent : c.text}" text-anchor="middle" dominant-baseline="central">${h.esc(words)}</text>`;
  }
  // Back: the blurb, what is inside, and room for the barcode.
  const backFill = tpl.id === 'night' ? '#FFFFFF' : tpl.id === 'band' || tpl.id === 'classic' ? c.text : c.text;
  if (tpl.id === 'pattern' || tpl.id === 'bright') o += `<rect x="${backX + safe}" y="${bl + safe}" width="${w - 2 * safe}" height="${hh * 0.62}" rx="14" fill="${c.paper}" opacity="${tpl.id === 'pattern' ? 0.94 : 1}"/>`;
  const bx = backX + safe + 18, bw = w - 2 * safe - 36;
  const backTextFill = tpl.id === 'pattern' || tpl.id === 'bright' ? c.ink : backFill;
  const blurb = svgText(bx, bl + safe + 22, d.blurb || defaultBlurb(b), { size: 12, width: bw, fill: backTextFill, anchor: 'start', lead: 1.35, maxLines: 14 });
  o += blurb.svg;
  const bullets = (d.bullets || defaultBullets(b, count)).filter(Boolean).slice(0, 6);
  let by2 = bl + safe + 22 + blurb.height + 14;
  for (const line of bullets) { const t = svgText(bx + 14, by2, line, { size: 11, width: bw - 14, fill: backTextFill, anchor: 'start', maxLines: 2 }); o += `<circle cx="${bx + 4}" cy="${by2 + 6}" r="3" fill="${c.accent}"/>${t.svg}`; by2 += t.height + 6; }
  o += `<text x="${bx}" y="${bl + hh - safe - 14}" font-family="Atkinson Hyperlegible, sans-serif" font-size="10" fill="${tpl.id === 'night' || tpl.id === 'classic' || tpl.id === 'band' ? '#FFFFFF' : c.ink}">thelogicgrid.com</text>`;
  if (d.barcode !== false) {
    // Amazon KDP prints its barcode here when the box is left empty: 2 × 1.2 in, white.
    const bw2 = 2 * PT, bh2 = 1.2 * PT;
    o += `<rect x="${backX + w - safe - bw2}" y="${bl + hh - safe - bh2}" width="${bw2}" height="${bh2}" fill="#FFFFFF"/>`;
    if (guides) o += `<text x="${backX + w - safe - bw2 / 2}" y="${bl + hh - safe - bh2 / 2}" font-size="9" fill="#888" text-anchor="middle" font-family="sans-serif">Barcode area</text>`;
  }
  if (guides) {
    const g = (x, y, ww, hh2, col) => `<rect x="${x}" y="${y}" width="${ww}" height="${hh2}" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="6 4"/>`;
    o += g(bl, bl, TW - 2 * bl, TH - 2 * bl, '#00A3FF') + g(backX + safe, bl + safe, w - 2 * safe, hh - 2 * safe, '#FF3B6B') + g(frontX + safe, bl + safe, w - 2 * safe, hh - 2 * safe, '#FF3B6B');
    o += `<line x1="${spineX}" y1="0" x2="${spineX}" y2="${TH}" stroke="#00A3FF" stroke-width="1"/><line x1="${frontX}" y1="0" x2="${frontX}" y2="${TH}" stroke="#00A3FF" stroke-width="1"/>`;
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${total[0]}in" height="${total[1]}in" viewBox="0 0 ${TW.toFixed(2)} ${TH.toFixed(2)}">${o}</svg>`, total, spine };
}

function defaultBlurb(b) {
  const names = [...new Set((b.puzzles || []).map((p) => p.gameName))];
  const what = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'logic puzzles';
  return `Brand-new puzzles from The Logic Grid: ${what}. Every puzzle has exactly one answer and can be solved by logic alone, with no guessing.`;
}
function defaultBullets(b, count) {
  const levels = [...new Set((b.puzzles || []).map((p) => p.level))];
  return [`${count} puzzles, never published before`, levels.length ? `Levels: ${levels.join(', ')}` : '', 'How to play pages and every answer at the back', 'Large, clear print'];
}

// ---------- the page ----------

function sectionRow(s, i) {
  const e = h.esc;
  const g = games.find((x) => x.id === s.game) || games[0];
  const levels = g ? g.levels : [];
  const level = levels.find((l) => l.id === s.difficulty) || levels[0];
  const sizes = level?.sizes || [];
  return `<li class="bk-sec" data-sec="${i}">
    <div class="row">
      <div class="field"><label for="bk-g-${i}">Game</label><select id="bk-g-${i}" data-f="game">${games.map((x) => `<option value="${e(x.id)}"${x.id === s.game ? ' selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="bk-l-${i}">Level</label><select id="bk-l-${i}" data-f="difficulty">${levels.map((l) => `<option value="${e(l.id)}"${l.id === level?.id ? ' selected' : ''}>${e(l.name)}</option>`).join('')}</select></div>
      ${sizes.length ? `<div class="field"><label for="bk-s-${i}">Size</label><select id="bk-s-${i}" data-f="size">${sizes.map((n) => `<option value="${n}"${Number(s.size) === n ? ' selected' : ''}>${n}×${n}</option>`).join('')}</select></div>` : ''}
      ${g?.themes?.length ? `<div class="field"><label for="bk-t-${i}">Story theme</label><select id="bk-t-${i}" data-f="theme">${g.themes.map((t) => `<option value="${e(t.id)}"${t.id === (s.theme || 'surprise') ? ' selected' : ''}>${e(t.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="bk-c-${i}">Puzzles</label><input id="bk-c-${i}" data-f="count" type="number" min="1" max="200" value="${Number(s.count) || 10}"></div>
      <button class="btn small danger" type="button" data-act="del-sec" aria-label="Remove this section">Remove</button>
    </div>
  </li>`;
}

function puzzleList() {
  const e = h.esc;
  if (!book.puzzles.length) return '<p class="muted">No puzzles yet. Set up the sections above, then choose Make the puzzles.</p>';
  const list = ordered(book);
  const checks = list.filter((p) => p.scan !== 'clear').length;
  return `<p>${list.length} puzzles${checks ? ` · <span class="badge warn">${checks} to look at</span>` : ' · <span class="badge ok">Scan: all clear</span>'}</p>
    <ol class="bk-puzzles">${list.map((p, k) => `<li data-fp="${e(p.fp)}"><b>${k + 1}. ${e(p.title)}</b> <span class="muted">${e(p.gameName)} · ${e(p.level)} · ${e(p.size || '')}</span>
      ${p.scan === 'clear' ? '<span class="badge ok">Clear</span>' : `<span class="badge ${p.scan === 'problem' ? 'bad' : 'warn'}">${p.scan === 'problem' ? 'Problem' : 'Check'}</span> <span class="muted">${(p.findings || []).map((f) => `${e(f.term)} (${e(f.type)})`).join(', ')}</span>`}
      ${book.status === 'draft' && h.can('admin') ? '<button class="btn small" type="button" data-act="replace">Replace</button> <button class="btn small link" type="button" data-act="remove">Remove</button>' : ''}</li>`).join('')}</ol>`;
}

function templateCards() {
  const e = h.esc;
  const sample = { ...book, puzzles: book.puzzles.length ? book.puzzles : [{ game: 'flg' }], cover: null };
  const mine = (data.templates || []).map((t) => ({ id: `t${t.id}`, name: t.name, own: t, colors: t.design.colors, base: t.design.template }));
  return [...COVER_TEMPLATES.map((t) => ({ ...t, base: t.id })), ...mine].map((t) => {
    const pick = book.cover?.saved ? book.cover.saved === t.id : !t.own && (book.cover?.template || 'classic') === t.id;
    const { svg } = coverSvg({ ...sample, cover: { template: t.base, colors: t.colors, ...(t.own ? t.own.design : {}) } }, 120);
    return `<li><button type="button" class="bk-tpl${pick ? ' on' : ''}" data-tpl="${e(t.id)}" aria-pressed="${pick}"><span class="bk-thumb">${svg}</span><b>${e(t.name)}</b>${t.note ? `<small>${e(t.note)}</small>` : t.own ? '<small>Your template</small>' : ''}</button>${t.own && h.can('admin') ? `<button type="button" class="btn small link" data-del-tpl="${t.own.id}">Delete</button>` : ''}</li>`;
  }).join('');
}

function render() {
  const e = h.esc;
  const root = $('#books-body');
  if (!book) {
    root.innerHTML = `<section class="card"><div class="row"><p class="grow">${data.used} puzzles are already in books, so none of them will be made again.</p>${h.can('admin') ? '<button class="btn primary" type="button" id="bk-new">New book</button>' : ''}</div>
      ${data.books.length ? `<table class="table"><thead><tr><th>Book</th><th>Trim</th><th>Puzzles</th><th>Pages</th><th>Status</th><th>Changed</th><th></th></tr></thead><tbody>${data.books.map((b) => `<tr><td><b>${e(b.title)}</b>${b.subtitle ? `<br><span class="muted">${e(b.subtitle)}</span>` : ''}<br><span class="muted">Volume ${b.volume}, edition ${b.edition}</span></td><td>${e(b.trim)} in</td><td>${b.puzzles}</td><td>${b.pages}</td><td><span class="badge ${b.status === 'published' ? 'ok' : 'warn'}">${b.status === 'published' ? 'Published' : 'Draft'}</span></td><td>${h.when(b.updatedAt)}</td><td><button class="btn small" type="button" data-open="${e(b.id)}">Open</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No books yet.</p>'}</section>`;
    return;
  }
  const locked = book.status === 'published' || !h.can('admin');
  const pages = book.pagesShown || book.pages || 0;
  const dims = coverDims(book, Math.max(pages, MIN_PAGES));
  root.innerHTML = `
    <p><button class="btn small link" type="button" id="bk-back">← All books</button></p>
    ${book.status === 'published' ? '<p class="note">This book is published. Its puzzles stay taken for good. To change it, make a new edition (New book, then the same title with the next edition number).</p>' : ''}
    <section class="card stack" aria-labelledby="bk-h-details"><h2 id="bk-h-details">1. The book</h2>
      <fieldset class="bk-fs"${locked ? ' disabled' : ''}>
      <div class="row">
        <div class="field grow"><label for="bk-title">Title</label><input id="bk-title" data-b="title" maxlength="120" value="${e(book.title)}"></div>
        <div class="field grow"><label for="bk-subtitle">Subtitle</label><input id="bk-subtitle" data-b="subtitle" maxlength="160" value="${e(book.subtitle)}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="bk-volume">Volume</label><input id="bk-volume" data-b="volume" type="number" min="1" max="999" value="${e(book.volume)}"></div>
        <div class="field"><label for="bk-edition">Edition</label><input id="bk-edition" data-b="edition" type="number" min="1" max="99" value="${e(book.edition)}"></div>
        <div class="field grow"><label for="bk-author">Author</label><input id="bk-author" data-b="author" maxlength="120" value="${e(book.author)}"></div>
        <div class="field"><label for="bk-isbn">ISBN (optional)</label><input id="bk-isbn" data-s="isbn" maxlength="20" value="${e(book.settings.isbn || '')}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="bk-trim">Trim size</label><select id="bk-trim" data-b="trim">${Object.keys(TRIM).map((t) => `<option value="${t}"${t === book.trim ? ' selected' : ''}>${TRIM_NAMES[t]}</option>`).join('')}</select></div>
        <div class="field"><label for="bk-paper">Paper</label><select id="bk-paper" data-b="paper"><option value="white"${book.paper === 'white' ? ' selected' : ''}>White</option><option value="cream"${book.paper === 'cream' ? ' selected' : ''}>Cream</option></select></div>
        <div class="field"><label for="bk-keys">Answer keys</label><select id="bk-keys" data-s="keys"><option value="back"${book.settings.keys !== 'each' ? ' selected' : ''}>At the back</option><option value="each"${book.settings.keys === 'each' ? ' selected' : ''}>After each puzzle</option></select></div>
        <div class="field"><label for="bk-kpp">Keys on a page</label><select id="bk-kpp" data-s="keysPerPage"><option value="1"${book.settings.keysPerPage !== 2 ? ' selected' : ''}>One</option><option value="2"${book.settings.keysPerPage === 2 ? ' selected' : ''}>Two</option></select></div>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" data-s="contents"${book.settings.contents !== false ? ' checked' : ''}> Contents page</label>
        <label class="check"><input type="checkbox" data-s="howto"${book.settings.howto !== false ? ' checked' : ''}> How to play pages</label>
        <label class="check"><input type="checkbox" data-s="showVolume"${book.settings.showVolume ? ' checked' : ''}> Show "Volume 1" on the first volume</label>
      </div>
      </fieldset>
    </section>

    <section class="card stack" aria-labelledby="bk-h-puzzles"><h2 id="bk-h-puzzles">2. The puzzles</h2>
      <fieldset class="bk-fs"${locked ? ' disabled' : ''}>
      <div class="row">
        <div class="field"><label for="bk-kind">Book</label><select id="bk-kind" data-s="kind"><option value="one"${book.settings.kind !== 'mix' ? ' selected' : ''}>One game</option><option value="mix"${book.settings.kind === 'mix' ? ' selected' : ''}>Different puzzles (a mix of games)</option></select></div>
        <div class="field"><label for="bk-order">Order</label><select id="bk-order" data-s="order"><option value="together"${book.settings.order !== 'mixed' ? ' selected' : ''}>Section by section</option><option value="mixed"${book.settings.order === 'mixed' ? ' selected' : ''}>Mixed together (one from each section in turn)</option></select></div>
      </div>
      <p class="muted">${book.settings.kind === 'mix' ? 'Add a section for each game (and level) you want in the book.' : 'One game: add sections for each level, easiest first.'}</p>
      <ol class="bk-secs">${book.settings.sections.map(sectionRow).join('')}</ol>
      <div class="row"><button class="btn small" type="button" id="bk-add-sec">Add a section</button>
        <button class="btn primary" type="button" id="bk-make"${busy ? ' disabled' : ''}>${book.puzzles.length ? 'Make the puzzles again' : 'Make the puzzles'}</button>
        <span id="bk-progress" class="muted" role="status"></span></div>
      </fieldset>
      <div id="bk-list">${puzzleList()}</div>
    </section>

    <section class="card stack" aria-labelledby="bk-h-interior"><h2 id="bk-h-interior">3. Inside the book</h2>
      <p class="muted" id="bk-pages">${book.puzzles.length ? `${pages || '…'} pages · gutter ${gutterFor(pages || MIN_PAGES)} in, outside margins ${OUT} in, no bleed.` : 'Make the puzzles to see the pages.'} Print and choose <b>Save as PDF</b> (paper size: the trim size, margins: default, headers and footers off) for the file you upload.</p>
      <div class="row"><button class="btn" type="button" id="bk-preview"${book.puzzles.length ? '' : ' disabled'}>Show the pages</button><button class="btn primary" type="button" id="bk-print"${book.puzzles.length ? '' : ' disabled'}>Print the inside</button></div>
    </section>

    <section class="card stack" aria-labelledby="bk-h-cover"><h2 id="bk-h-cover">4. The cover</h2>
      <p class="muted">Full wrap with ${BLEED} in bleed: ${dims.total[0].toFixed(3)} × ${dims.total[1].toFixed(3)} in. Spine ${dims.spine.toFixed(3)} in for ${Math.max(pages, MIN_PAGES)} pages on ${e(book.paper)} paper.${spineTextOk(pages) ? '' : ' Spine words need more than 79 pages, so the spine stays plain.'}</p>
      <ul class="bk-tpls">${templateCards()}</ul>
      <fieldset class="bk-fs"${locked ? ' disabled' : ''}>
      <div class="row">
        ${['bg', 'accent', 'text', 'ink', 'paper'].map((k) => `<div class="field"><label for="bk-col-${k}">${{ bg: 'Background', accent: 'Accent', text: 'Title words', ink: 'Puzzle lines', paper: 'Puzzle paper' }[k]}</label><input id="bk-col-${k}" type="color" data-col="${k}" value="${e(coverColors()[k])}"></div>`).join('')}
        <div class="field"><label for="bk-motif">Puzzle picture</label><select id="bk-motif" data-c="motif"><option value="auto">The book's own games</option>${games.map((g) => `<option value="${e(g.id)}"${book.cover.motif === g.id ? ' selected' : ''}>${e(g.name)}</option>`).join('')}</select></div>
      </div>
      <div class="row"><div class="field grow"><label for="bk-tag">Front line (optional)</label><input id="bk-tag" data-c="tagline" maxlength="120" value="${e(book.cover.tagline || '')}"></div></div>
      <div class="field"><label for="bk-blurb">Back cover words</label><textarea id="bk-blurb" data-c="blurb" rows="4" maxlength="900" placeholder="${e(defaultBlurb(book))}">${e(book.cover.blurb || '')}</textarea></div>
      <div class="field"><label for="bk-bullets">Back cover points (one a line)</label><textarea id="bk-bullets" data-c="bullets" rows="4" maxlength="600" placeholder="${e(defaultBullets(book, book.puzzles.length).filter(Boolean).join('\n'))}">${e((book.cover.bullets || []).join('\n'))}</textarea></div>
      <div class="row">
        <label class="check"><input type="checkbox" data-c="barcode"${book.cover.barcode !== false ? ' checked' : ''}> Leave the barcode area clear (2 × 1.2 in, back cover)</label>
        <label class="check"><input type="checkbox" data-c="spineText"${book.cover.spineText !== false ? ' checked' : ''}> Words on the spine</label>
        <label class="check"><input type="checkbox" id="bk-guides" checked> Show trim, spine and safe-area lines in the preview</label>
      </div>
      </fieldset>
      <div class="bk-cover-box" id="bk-cover-box"></div>
      <div class="row"><button class="btn primary" type="button" id="bk-print-cover">Print the cover</button><button class="btn" type="button" id="bk-svg">Download the cover (SVG)</button>${h.can('admin') ? '<button class="btn" type="button" id="bk-save-tpl">Save as a template</button>' : ''}</div>
    </section>

    <div class="row bk-bar">
      ${book.status === 'draft' && h.can('admin') ? `<button class="btn primary" type="button" id="bk-save">Save the book</button>${book.id ? '<button class="btn" type="button" id="bk-publish">Mark as published</button><button class="btn danger" type="button" id="bk-delete">Delete this draft</button>' : ''}` : ''}
      <span class="muted" id="bk-state" role="status">${book.dirty ? 'Changes not saved yet.' : book.id ? 'Saved.' : ''}</span>
    </div>`;
  mountFrames();
  drawCover();
}

const coverColors = () => {
  const tpl = COVER_TEMPLATES.find((t) => t.id === (book.cover.template || 'classic')) || COVER_TEMPLATES[0];
  return { ...tpl.colors, ...(book.cover.colors || {}) };
};

// The two frames (the Book maker, and the cover on its own page) live outside the re-drawn markup.
function mountFrames() {
  const src = `${data.siteUrl}/book-maker/`;
  if (!frame) {
    frame = document.createElement('iframe');
    frame.title = 'The pages of the book';
    frame.className = 'bk-frame';
    frame.hidden = true;
    ready = deferred();
    frame.src = src;
    $('#books-frames').append(frame);
  }
  if (!coverFrame) {
    coverFrame = document.createElement('iframe');
    coverFrame.title = 'The cover, ready to print';
    coverFrame.className = 'bk-frame bk-cover-frame';
    coverFrame.hidden = true;
    coverReady = deferred();
    coverFrame.src = src;
    $('#books-frames').append(coverFrame);
  }
}

let coverTimer = null;
function drawCover() {
  const box = $('#bk-cover-box');
  if (!box) return;
  const pages = Math.max(book.pagesShown || book.pages || 0, MIN_PAGES);
  const { svg } = coverSvg(book, pages, { guides: $('#bk-guides')?.checked !== false });
  // An <img> of the SVG keeps the dashboard's strict page rules (no inline styles).
  box.innerHTML = `<img alt="Cover preview: back, spine and front" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
}

const changed = () => { book.dirty = true; const s = $('#bk-state'); if (s) s.textContent = 'Changes not saved yet.'; };

function blankBook() {
  return {
    id: null, title: 'Logic Puzzles', subtitle: 'Brand-new puzzles for curious minds', volume: 1, edition: 1, author: 'Bobby Taylor', trim: '6x9', paper: 'white', status: 'draft', pages: 0,
    settings: { kind: 'one', order: 'together', keys: 'back', keysPerPage: 1, contents: true, howto: true, sections: [{ game: games[0]?.id || 'flg', difficulty: 'easy', theme: 'surprise', count: 20 }] },
    cover: { template: 'classic', barcode: true, spineText: true }, css: {}, puzzles: [],
  };
}

async function openBook(id) {
  const { book: b } = await h.api(`books/${id}`);
  book = { ...b, settings: { sections: [], ...b.settings }, cover: b.cover || {}, css: b.css || {}, puzzles: b.puzzles.map((p) => ({ fp: p.fp, game: p.game, title: p.title, story: p.story, scan: p.scan, ...(p.content || {}) })) };
  render();
}

async function makePuzzles(onlySection = null, replaceFp = null) {
  if (busy) return;
  busy = true;
  const progress = () => $('#bk-progress');
  try {
    const { used } = await h.api('books/used');
    const avoid = new Set(used.filter((u) => u.book !== book.id).map((u) => u.fp));
    const stories = used.map((u) => u.story).filter(Boolean);
    const keep = replaceFp ? book.puzzles.filter((p) => p.fp !== replaceFp) : onlySection == null ? [] : book.puzzles.filter((p) => p.section !== onlySection);
    for (const p of keep) { avoid.add(p.fp); if (p.story) stories.push(p.story); }
    if (replaceFp) avoid.add(replaceFp);
    const made = [];
    const secs = book.settings.sections.map((s, i) => [s, i]).filter(([, i]) => onlySection == null || i === onlySection);
    for (const [s, i] of secs) {
      const count = replaceFp ? 1 : Math.max(1, Math.min(200, Number(s.count) || 1));
      if (progress()) progress().textContent = `Making ${gameName(s.game)}…`;
      const r = await ask({ type: 'flg-book-make', game: s.game, difficulty: s.difficulty, size: s.size, theme: s.theme, count, avoid: [...avoid], usedStories: stories.slice(-500), seed: `${book.title}-${book.volume}-${book.edition}-${i}-${Date.now().toString(36)}` });
      if (r.css) book.css[s.game] = r.css;
      for (const it of r.items) { avoid.add(it.fp); if (it.story) stories.push(it.story); made.push({ ...it, section: i }); }
    }
    if (progress()) progress().textContent = 'Checking every puzzle for trademarks and protected names…';
    const scan = await h.api('books/scan', { method: 'POST', body: { items: made.map((p) => ({ fp: p.fp, title: p.title, text: p.text })) } });
    const byFp = new Map(scan.results.map((x) => [x.fp, x]));
    for (const p of made) { const x = byFp.get(p.fp); p.scan = x?.verdict || 'clear'; p.findings = x?.findings || []; delete p.text; }
    if (replaceFp) {
      const at = book.puzzles.findIndex((p) => p.fp === replaceFp);
      const old = book.puzzles[at];
      book.puzzles.splice(at, 1, { ...made[0], section: old.section });
    } else book.puzzles = [...keep, ...made];
    book.pagesShown = 0;
    changed();
    h.toast(`${made.length} new puzzle${made.length === 1 ? '' : 's'} made.`);
  } catch (e) {
    h.toast(e.message);
  } finally {
    busy = false;
    render();
    if (book.puzzles.length) showInterior(false);
  }
}

async function showInterior(visible = true) {
  const { html, css, pages } = interiorHtml(book);
  const win = await maker();
  const id = `r${++req}`;
  const m = await send(win, { type: 'flg-book-show', req: id, html, css }, id);
  // The page count can change the gutter: draw once more with the real count.
  const real = m.pages || pages;
  if (gutterFor(real) !== gutterFor(pages)) await send(win, { type: 'flg-book-show', req: `${id}b`, html, css: interiorCss(book, real) }, `${id}b`);
  book.pagesShown = real;
  book.pages = real;
  frame.hidden = !visible && frame.hidden;
  if (visible) { frame.hidden = false; frame.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  const p = $('#bk-pages');
  if (p) p.innerHTML = `${real} pages · gutter ${gutterFor(real)} in, outside margins ${OUT} in, no bleed. Print and choose <b>Save as PDF</b> (paper size: the trim size, margins: default, headers and footers off) for the file you upload.`;
  drawCover();
  return real;
}

async function printCover() {
  const pages = Math.max(book.pagesShown || book.pages || (await showInterior(false)), MIN_PAGES);
  const { svg, total } = coverSvg(book, pages);
  await Promise.race([coverReady, new Promise((_, no) => setTimeout(() => no(new Error('The website did not answer.')), 30000))]);
  const css = `${fontCss}\n@page { size: ${total[0]}in ${total[1]}in; margin: 0; }\nhtml, body { margin: 0; padding: 0; } svg { display: block; width: ${total[0]}in; height: ${total[1]}in; }\n@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
  const id = `r${++req}`;
  await send(coverFrame.contentWindow, { type: 'flg-book-show', req: id, html: svg, css }, id);
  coverFrame.contentWindow.postMessage({ type: 'flg-book-print' }, new URL(data.siteUrl).origin);
}

function bookBody() {
  return {
    id: book.id || undefined, title: book.title, subtitle: book.subtitle, volume: book.volume, edition: book.edition, author: book.author, trim: book.trim, paper: book.paper,
    pages: book.pagesShown || book.pages || 0, settings: book.settings, cover: book.cover, css: book.css,
    puzzles: ordered(book).map((p) => ({ fp: p.fp, game: p.game, title: p.title, story: p.story || '', scan: p.scan === 'clear' ? 'clear' : 'check',
      content: { gameName: p.gameName, level: p.level, size: p.size, rules: p.rules, page: p.page, key: p.key, section: p.section, findings: p.findings || [] } })),
  };
}

function wire() {
  const root = $('#books-body');
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'bk-new') { await loadGames(); book = blankBook(); render(); return; }
    if (t.dataset.open) { await loadGames(); await openBook(t.dataset.open); return; }
    if (t.id === 'bk-back') { if (book.dirty && !confirm('Leave without saving? Unsaved puzzles are lost.')) return; book = null; if (frame) frame.hidden = true; await reload(); return; }
    if (t.id === 'bk-add-sec') { const last = book.settings.sections[book.settings.sections.length - 1]; book.settings.sections.push({ ...(last || {}), game: book.settings.kind === 'mix' ? (games.find((g) => !book.settings.sections.some((s) => s.game === g.id)) || games[0]).id : last?.game || games[0].id, count: last?.count || 10 }); changed(); render(); return; }
    if (t.dataset.act === 'del-sec') { const i = Number(t.closest('[data-sec]').dataset.sec); book.settings.sections.splice(i, 1); book.puzzles = book.puzzles.filter((p) => p.section !== i).map((p) => ({ ...p, section: p.section > i ? p.section - 1 : p.section })); changed(); render(); return; }
    if (t.id === 'bk-make') { if (book.puzzles.length && !confirm('Make every puzzle again? The ones in the list now are dropped.')) return; await makePuzzles(); return; }
    if (t.dataset.act === 'replace') { await makePuzzles(null, t.closest('[data-fp]').dataset.fp); return; }
    if (t.dataset.act === 'remove') { const fp = t.closest('[data-fp]').dataset.fp; book.puzzles = book.puzzles.filter((p) => p.fp !== fp); book.pagesShown = 0; changed(); render(); return; }
    if (t.id === 'bk-preview') { try { await showInterior(true); } catch (err) { h.toast(err.message); } return; }
    if (t.id === 'bk-print') { try { await showInterior(true); frame.contentWindow.postMessage({ type: 'flg-book-print' }, new URL(data.siteUrl).origin); } catch (err) { h.toast(err.message); } return; }
    if (t.dataset.tpl) {
      const id = t.dataset.tpl;
      if (id.startsWith('t')) { const own = data.templates.find((x) => `t${x.id}` === id); book.cover = { ...book.cover, ...own.design, saved: id }; } else book.cover = { ...book.cover, template: id, colors: undefined, saved: undefined };
      changed(); render(); return;
    }
    if (t.dataset.delTpl) { if (!confirm('Delete this cover template?')) return; await h.api(`book-templates/${t.dataset.delTpl}/delete`, { method: 'POST' }); await reloadTemplates(); render(); return; }
    if (t.id === 'bk-print-cover') { try { await printCover(); } catch (err) { h.toast(err.message); } return; }
    if (t.id === 'bk-svg') {
      const { svg } = coverSvg(book, Math.max(book.pagesShown || book.pages || 0, MIN_PAGES));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      a.download = `${book.title.replace(/[^\w -]+/g, '').trim() || 'cover'} cover.svg`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    if (t.id === 'bk-save-tpl') {
      const v = await h.ask({ title: 'Save as a cover template', fields: [{ name: 'name', label: 'Template name', value: `${COVER_TEMPLATES.find((x) => x.id === book.cover.template)?.name || 'My'} ${new Date().getFullYear()}` }], ok: 'Save', check: (x) => (x.name.trim().length < 2 ? 'Give it a name.' : '') });
      if (!v) return;
      const { template, colors, motif: mo, barcode, spineText, tagline } = book.cover;
      await h.api('book-templates', { method: 'POST', body: { name: v.name.trim(), design: { template: template || 'classic', colors: colors || coverColors(), motif: mo, barcode, spineText, tagline } } });
      await reloadTemplates(); h.toast('Template saved.'); render(); return;
    }
    if (t.id === 'bk-save') {
      try {
        if (!book.pagesShown && book.puzzles.length) await showInterior(false);
        const r = await h.api('books', { method: 'POST', body: bookBody() });
        book.id = r.id; book.dirty = false; h.toast('Book saved. Its puzzles are now taken: no other book will use them.'); render();
      } catch (err) { h.toast(err.message); }
      return;
    }
    if (t.id === 'bk-publish') {
      if (book.dirty) { h.toast('Save the book first.'); return; }
      if (book.puzzles.some((p) => p.scan !== 'clear') && !confirm('Some puzzles were flagged by the scan. Publish anyway?')) return;
      if (!confirm('Mark this book as published? It can no longer change, and its puzzles are never used again.')) return;
      await h.api(`books/${book.id}/publish`, { method: 'POST' }); book.status = 'published'; h.toast('Marked as published.'); render(); return;
    }
    if (t.id === 'bk-delete') { if (!confirm('Delete this draft? Its puzzles become free to use again.')) return; await h.api(`books/${book.id}/delete`, { method: 'POST' }); book = null; await reload(); }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!book) return;
    if (el.id === 'bk-guides') { drawCover(); return; }
    const sec = el.closest('[data-sec]');
    if (sec && el.dataset.f) {
      const s = book.settings.sections[Number(sec.dataset.sec)];
      s[el.dataset.f] = el.type === 'number' || el.dataset.f === 'size' ? Number(el.value) : el.value;
      if (el.dataset.f === 'game') { const g = games.find((x) => x.id === s.game); s.difficulty = g.levels[0]?.id; s.size = g.levels[0]?.sizes?.[0]; s.theme = 'surprise'; render(); }
      if (el.dataset.f === 'difficulty') { const lv = games.find((x) => x.id === s.game)?.levels.find((l) => l.id === s.difficulty); s.size = lv?.sizes?.[0]; render(); }
      changed(); return;
    }
    if (el.dataset.b) { book[el.dataset.b] = el.type === 'number' ? Number(el.value) : el.value; book.pagesShown = 0; changed(); if (['trim', 'paper'].includes(el.dataset.b)) render(); else drawCover(); return; }
    if (el.dataset.s) { book.settings[el.dataset.s] = el.type === 'checkbox' ? el.checked : el.dataset.s === 'keysPerPage' ? Number(el.value) : el.value; book.pagesShown = 0; changed(); if (el.dataset.s === 'kind' || el.dataset.s === 'order') render(); return; }
    if (el.dataset.col) { book.cover.colors = { ...coverColors(), [el.dataset.col]: el.value }; book.cover.saved = undefined; changed(); drawCover(); return; }
    if (el.dataset.c) {
      const k = el.dataset.c;
      book.cover[k] = el.type === 'checkbox' ? el.checked : k === 'bullets' ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : el.value;
      changed(); drawCover();
    }
  });
  root.addEventListener('input', (e) => {
    if (!book || !(e.target.dataset.c || e.target.dataset.b) || e.target.type === 'checkbox') return;
    clearTimeout(coverTimer);
    coverTimer = setTimeout(() => e.target.dispatchEvent(new Event('change', { bubbles: true })), 350);
  });
}

async function loadGames() {
  if (games.length) return;
  mountFrames();
  const win = await maker();
  const m = await send(win, { type: 'flg-book-games' }, 'games');
  games = m.games || [];
}
async function reloadTemplates() { const d = await h.api('books'); data.templates = d.templates; }
async function reload() { data = await h.api('books'); render(); }

let wired = false;
export async function booksView(helpers) {
  h = helpers;
  data = await h.api('books');
  if (!wired) { wired = true; addEventListener('message', onMessage); wire(); }
  mountFrames();
  render();
}

// The book being edited (for the dashboard's tests).
export const currentBook = () => book;
