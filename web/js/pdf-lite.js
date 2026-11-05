// A small PDF writer with no dependencies, for the Puzzle Wizard's
// downloadable puzzles (wizard-pdf.js). It draws text in the two built-in
// PDF fonts (Helvetica and Helvetica Bold, so nothing is embedded), lines,
// boxes and rotated labels, on Letter or A4 pages.
//
// Coordinates are in points (72 to an inch) from the top-left corner of the
// page, like a web page; the writer turns them into PDF's bottom-left ones.
// Text is Latin-1 (WinAnsi): curly quotes, dashes and ellipses become their
// plain forms, and any other character outside Latin-1 becomes "?".

const PAPER = { letter: [612, 792], a4: [595.28, 841.89] };

// Character widths (thousandths of the font size) for codes 32 to 126,
// from the fonts' published metrics. Other Latin-1 letters use 556.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const PLAIN = { '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '•': '-', '×': 'x', '™': '(TM)' };
export function latin1(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    if (PLAIN[ch] !== undefined) { out += PLAIN[ch]; continue; }
    const c = ch.codePointAt(0);
    out += c >= 32 && c <= 255 && !(c >= 127 && c < 160) ? ch : (c === 9 ? ' ' : '?');
  }
  return out;
}
const escText = (s) => latin1(s).replace(/[\\()]/g, (m) => `\\${m}`);
const num = (n) => (Math.round(n * 100) / 100).toString();

export function textWidth(s, size, bold = false) {
  const w = bold ? W_BOLD : W_REG;
  let t = 0;
  for (const ch of latin1(s)) { const c = ch.charCodeAt(0); t += c >= 32 && c <= 126 ? w[c - 32] : 556; }
  return (t * size) / 1000;
}

// Splits text into lines no wider than maxWidth. Blank lines between
// paragraphs are kept as empty strings.
export function wrapText(s, size, maxWidth, bold = false) {
  const lines = [];
  for (const para of String(s ?? '').split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (let word of words) {
      // A single word wider than the line is broken.
      while (textWidth(word, size, bold) > maxWidth) {
        let k = word.length - 1;
        while (k > 1 && textWidth(word.slice(0, k), size, bold) > maxWidth) k--;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, k));
        word = word.slice(k);
      }
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) > maxWidth && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export function createPdf({ paper = 'letter', title = '', author = '' } = {}) {
  const [W, H] = PAPER[paper === 'a4' || paper === 'A4' ? 'a4' : 'letter'];
  const pages = [];
  let ops = null;
  const y = (v) => H - v;
  const doc = {
    width: W, height: H,
    page() { ops = []; pages.push(ops); return doc; },
    text(x, top, s, { size = 11, bold = false, gray = 0 } = {}) {
      ops.push(`${num(gray)} g BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y(top) - size * 0.8)} Td (${escText(s)}) Tj ET`);
      return doc;
    },
    // Text read from bottom to top, its left end at (x, bottom).
    textUp(x, bottom, s, { size = 9, bold = false } = {}) {
      ops.push(`0 g BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf 0 1 -1 0 ${num(x + size * 0.8)} ${num(y(bottom))} Tm (${escText(s)}) Tj ET`);
      return doc;
    },
    textCenter(cx, top, s, opts = {}) { return doc.text(cx - textWidth(s, opts.size || 11, opts.bold) / 2, top, s, opts); },
    line(x1, y1, x2, y2, { width = 0.5, gray = 0 } = {}) {
      ops.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(y(y1))} m ${num(x2)} ${num(y(y2))} l S`);
      return doc;
    },
    rect(x, top, w, h, { fill = null, stroke = true, width = 0.5 } = {}) {
      const path = `${num(x)} ${num(y(top + h))} ${num(w)} ${num(h)} re`;
      if (fill !== null) ops.push(`${num(fill)} g ${path} f`);
      if (stroke) ops.push(`0 G ${num(width)} w ${path} S`);
      return doc;
    },
    // Wrapped text from (x, top); returns the top of the next line below it.
    paragraph(x, top, s, maxWidth, { size = 11, bold = false, lead = 1.35, gray = 0 } = {}) {
      let t = top;
      for (const l of wrapText(s, size, maxWidth, bold)) { if (l) doc.text(x, t, l, { size, bold, gray }); t += size * lead; }
      return t;
    },
    // The finished file as bytes.
    bytes() {
      const objs = [];
      const add = (body) => { objs.push(body); return objs.length; };
      add('<< /Type /Catalog /Pages 2 0 R >>');
      add('PAGES');
      add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const kids = [];
      for (const p of pages) {
        const stream = p.join('\n');
        const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`));
      }
      objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
      const info = add(`<< /Title (${escText(title)}) /Author (${escText(author)}) /Creator (The Logic Grid Puzzle Wizard) /Producer (thelogicgrid.com) >>`);
      let out = '%PDF-1.4\n%âãÏÓ\n';
      const offsets = [];
      objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
      return bytes;
    },
  };
  return doc;
}
