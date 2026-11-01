// The Puzzle Wizard's downloadable PDFs (pdf-lite.js): the puzzle pages and
// an answer key, for a logic grid (The Fantastical Logic Grid) or a number
// grid (NINETIMESNINE).
import { createPdf, wrapText, textWidth } from './pdf-lite.js';

const M = 48; // page margin, points

function footer(doc, credit) {
  const words = `${credit ? `Puzzle by ${credit}. ` : ''}Made with the Puzzle Wizard at thelogicgrid.com`;
  doc.text(M, doc.height - M + 14, words, { size: 8, gray: 0.35 });
}

// Starts a new page when fewer than `need` points are left; returns the top.
function room(doc, top, need, credit) {
  if (top + need <= doc.height - M) return top;
  footer(doc, credit);
  doc.page();
  return M;
}

// ---------------------------------------------------------------- logic grid
function flgGrid(doc, p, left, top, maxWidth) {
  const byId = Object.fromEntries(p.categories.map((c) => [c.id, c]));
  const cols = p.grid.columns.map((id) => byId[id]);
  const rows = p.grid.rows.map((id) => byId[id]);
  const N = cols[0].items.length;
  const labelW = Math.min(120, Math.max(...rows.flatMap((c) => c.items.map((i) => textWidth(i.label, 8))), 40) + 22);
  const headH = Math.min(110, Math.max(...cols.flatMap((c) => c.items.map((i) => textWidth(i.label, 8))), 30) + 20);
  const cell = Math.max(10, Math.min(20, Math.floor((maxWidth - labelW) / (cols.length * N))));
  const gx = left + labelW;
  const gy = top + headH;
  // Column headings: the list's name, then each item read upwards.
  cols.forEach((c, ci) => {
    const x0 = gx + ci * N * cell;
    doc.text(x0 + 2, top, c.name, { size: 8, bold: true });
    c.items.forEach((it, k) => doc.textUp(x0 + k * cell + (cell - 8) / 2, gy - 4, it.label, { size: 8 }));
  });
  // Row headings and the blocks (a staircase: fewer blocks on each lower band).
  rows.forEach((r, ri) => {
    const y0 = gy + ri * N * cell;
    doc.textUp(left, y0 + N * cell - 2, r.name, { size: 8, bold: true });
    r.items.forEach((it, k) => doc.text(left + 12, y0 + k * cell + (cell - 8) / 2, it.label, { size: 8 }));
    const blocks = cols.length - ri;
    for (let b = 0; b < blocks; b++) {
      const x0 = gx + b * N * cell;
      for (let i = 1; i < N; i++) {
        doc.line(x0 + i * cell, y0, x0 + i * cell, y0 + N * cell, { width: 0.4, gray: 0.45 });
        doc.line(x0, y0 + i * cell, x0 + N * cell, y0 + i * cell, { width: 0.4, gray: 0.45 });
      }
      doc.rect(x0, y0, N * cell, N * cell, { width: 1.2 });
    }
  });
  return gy + rows.length * N * cell + 16;
}

export function flgPdf(p, { paper = 'letter', credit = '' } = {}) {
  const doc = createPdf({ paper, title: p.title, author: credit });
  const width = doc.width - 2 * M;
  doc.page();
  let top = M;
  top = doc.paragraph(M, top, p.title, width, { size: 22, bold: true, lead: 1.15 }) + 2;
  doc.text(M, top, `The Fantastical Logic Grid · ${p.difficulty.name} · ${p.categories.length} lists of ${p.categories[0].items.length}`, { size: 9, gray: 0.35 });
  top += 20;
  for (const para of p.story.paragraphs) { top = room(doc, top, 30, credit); top = doc.paragraph(M, top, para, width, { size: 10.5 }) + 5; }
  top += 4;
  // The grid needs its whole height on one page.
  const N = p.categories[0].items.length;
  const gridH = 130 + p.grid.rows.length * N * 20;
  top = room(doc, top, Math.min(gridH, doc.height - 2 * M), credit);
  top = flgGrid(doc, p, M, top, width);
  top = room(doc, top, 60, credit);
  doc.text(M, top, 'Clues', { size: 13, bold: true });
  top += 20;
  for (const c of p.clues) {
    const lines = wrapText(c.text, 10.5, width - 22);
    top = room(doc, top, lines.length * 14 + 4, credit);
    doc.text(M, top, `${c.number}.`, { size: 10.5, bold: true });
    lines.forEach((l, i) => doc.text(M + 22, top + i * 14, l, { size: 10.5 }));
    top += lines.length * 14 + 4;
  }
  if (p.questions.length) {
    top = room(doc, top + 8, 60, credit);
    doc.text(M, top, 'Questions', { size: 13, bold: true });
    top += 20;
    for (const q of p.questions) {
      top = room(doc, top, 34, credit);
      top = doc.paragraph(M, top, `${q.number}. ${q.text}`, width, { size: 10.5 });
      doc.line(M + 22, top + 10, M + 260, top + 10, { width: 0.5, gray: 0.5 });
      top += 20;
    }
  }
  footer(doc, credit);
  // Answer key.
  doc.page();
  top = M;
  doc.text(M, top, 'Answer key', { size: 18, bold: true });
  top += 22;
  doc.text(M, top, p.title, { size: 10, gray: 0.35 });
  top += 22;
  const cols = p.answerKey.columns;
  const colW = width / cols.length;
  doc.rect(M, top, width, 20, { fill: 0.9, stroke: true });
  cols.forEach((c, i) => doc.text(M + i * colW + 4, top + 5, c, { size: 10, bold: true }));
  top += 20;
  for (const r of p.answerKey.rows) {
    doc.rect(M, top, width, 20, { width: 0.4 });
    r.forEach((v, i) => doc.text(M + i * colW + 4, top + 5, v, { size: 10 }));
    top += 20;
  }
  top += 16;
  if (p.answerKey.questions.length) {
    doc.text(M, top, 'Questions', { size: 12, bold: true });
    top += 18;
    for (const q of p.answerKey.questions) top = doc.paragraph(M, top, `${q.question} ${q.answer}`, width, { size: 10.5 }) + 2;
    top += 10;
  }
  doc.text(M, top, 'How it ends', { size: 12, bold: true });
  top = doc.paragraph(M, top + 18, p.story.ending, width, { size: 10.5 });
  footer(doc, credit);
  return doc.bytes();
}

// ---------------------------------------------------------------- number grid
function ntnGrid(doc, p, values, cx, top, side) {
  const N = p.size;
  const [br, bc] = p.box;
  const cell = side / N;
  const x0 = cx - side / 2;
  for (let i = 0; i < N * N; i++) if (p.evenCells && p.evenCells.includes(i)) doc.rect(x0 + (i % N) * cell, top + Math.floor(i / N) * cell, cell, cell, { fill: 0.85, stroke: false });
  if (p.variants.includes('diagonal')) {
    doc.line(x0, top, x0 + side, top + side, { width: 0.6, gray: 0.6 });
    doc.line(x0 + side, top, x0, top + side, { width: 0.6, gray: 0.6 });
  }
  for (let i = 1; i < N; i++) {
    doc.line(x0 + i * cell, top, x0 + i * cell, top + side, { width: i % bc ? 0.5 : 2, gray: i % bc ? 0.4 : 0 });
    doc.line(x0, top + i * cell, x0 + side, top + i * cell, { width: i % br ? 0.5 : 2, gray: i % br ? 0.4 : 0 });
  }
  doc.rect(x0, top, side, side, { width: 2.4 });
  const size = cell * 0.55;
  values.forEach((d, i) => {
    if (!d) return;
    const given = p.givens[i];
    doc.textCenter(x0 + (i % N) * cell + cell / 2, top + Math.floor(i / N) * cell + (cell - size) / 2 + size * 0.05, String(d), { size, bold: !!given, gray: given ? 0 : 0.35 });
  });
  return top + side;
}

export function ntnPdf(p, { paper = 'letter', credit = '' } = {}) {
  const doc = createPdf({ paper, title: p.story?.title || 'NINETIMESNINE', author: credit });
  const width = doc.width - 2 * M;
  const title = p.story?.title || 'NINETIMESNINE';
  doc.page();
  let top = M;
  top = doc.paragraph(M, top, title, width, { size: 22, bold: true, lead: 1.15 }) + 2;
  doc.text(M, top, `NINETIMESNINE · ${p.difficulty.name} · ${p.size} × ${p.size}`, { size: 9, gray: 0.35 });
  top += 20;
  if (p.story?.intro) top = doc.paragraph(M, top, p.story.intro, width, { size: 11 }) + 6;
  for (const r of p.rules) top = doc.paragraph(M + 10, top, `- ${r}`, width - 10, { size: 10 }) + 1;
  top += 14;
  const side = Math.min(width, doc.height - M - top - 30);
  ntnGrid(doc, p, p.givens, doc.width / 2, top, side);
  footer(doc, credit);
  doc.page();
  top = M;
  doc.text(M, top, 'Answer key', { size: 18, bold: true });
  top += 22;
  doc.text(M, top, title, { size: 10, gray: 0.35 });
  top += 26;
  top = ntnGrid(doc, p, p.solution, doc.width / 2, top, Math.min(width, 420)) + 20;
  if (p.story?.ending) { doc.text(M, top, 'How it ends', { size: 12, bold: true }); doc.paragraph(M, top + 18, p.story.ending, width, { size: 10.5 }); }
  footer(doc, credit);
  return doc.bytes();
}
