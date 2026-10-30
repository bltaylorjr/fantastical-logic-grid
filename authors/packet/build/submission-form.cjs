const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, HeadingLevel, AlignmentType, BorderStyle, Footer, PageNumber, LevelFormat, PageBreak, CheckBox, VerticalAlign } = require('docx');

const W = 9360; // 6.5in content width
const INK = '1F2A44', MUTED = '5B6475', FILL = 'F4F6FA', LINE = 'C9D0DC', ACCENT = '7A3E9D';
const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
const p = (text, opts = {}) => new Paragraph({ spacing: { after: 100 }, ...opts.para, children: [new TextRun({ text, size: 21, color: opts.color || INK, ...opts.run })] });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, keepNext: true, children: [new TextRun({ text: t })] });
const note = (t) => p(t, { color: MUTED, run: { italics: true, size: 19 } });
const bullet = (t) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, size: 20, color: INK })] });

const labelCell = (t, w, hint) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders, shading: { fill: 'E8ECF3', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, verticalAlign: VerticalAlign.TOP,
  children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 19, color: INK })] }), ...(hint ? [new Paragraph({ children: [new TextRun({ text: hint, size: 16, color: MUTED, italics: true })] })] : [])] });
const blankCell = (w, lines = 1) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders, shading: { fill: FILL, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: Array.from({ length: lines }, () => new Paragraph({ children: [new TextRun({ text: '', size: 21 })] })) });
const headCell = (t, w) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders, shading: { fill: INK, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: 'FFFFFF', size: 19 })] })] });

// Label | answer rows
function fields(rows, labelW = 3000) {
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [labelW, W - labelW],
    rows: rows.map(([l, hint, lines]) => new TableRow({ cantSplit: true, children: [labelCell(l, labelW, hint), blankCell(W - labelW, lines || 1)] })) });
}
// Numbered list of blanks
function numbered(n, label, lines = 2) {
  const nw = 700;
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [nw, W - nw],
    rows: [new TableRow({ tableHeader: true, children: [headCell('#', nw), headCell(label, W - nw)] }),
      ...Array.from({ length: n }, (_, i) => new TableRow({ cantSplit: true, children: [labelCell(String(i + 1), nw), blankCell(W - nw, lines)] }))] });
}
function grid(cols, n) {
  const widths = cols.map((c) => c[1]);
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: cols.map(([t, w]) => headCell(t, w)) }),
      ...Array.from({ length: n }, (_, i) => new TableRow({ cantSplit: true, children: cols.map(([t, w], j) => (j === 0 && t === '#' ? labelCell(String(i + 1), w) : blankCell(w, 2))) }))] });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

const children = [];
children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'THE FANTASTICAL LOGIC GRID · AUTHOR PACKET', size: 18, bold: true, color: ACCENT, characterSpacing: 40 })] }));
children.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 120 }, children: [new TextRun({ text: 'Story Submission Form' })] }));
children.push(p('Type your answers in the shaded boxes. This form matches the standard submission file, authors/submissions/TEMPLATE.md, line for line. When you finish, copy each answer into the matching line of the template and upload it (Upload Guide, in the Author Packet PDF).'));
children.push(p('Before you start, read the Writing Guide. The rules in brief:', { run: { bold: true } }));
for (const t of [
  'Write every story part yourself, in your own words.',
  'Never name a category item or a cast name in any story part. It reads like a clue.',
  'Openings use {n} or {N} (how many) and {many} (the cast word). Leads use {x} (the answer item). Endings use {Fact}, and may use {winner} and {prize}.',
  'Keep each part to about 10 to 25 words; a whole story must stay under 150 words.',
  'History topics: real people, dates and places go only on the Fact card.',
]) children.push(bullet(t));

children.push(h1('1. About you'));
children.push(fields([['Author name'], ['GitHub username'], ['Date written'], ['Started from an AI draft?', 'List which parts you rewrote, or "none"', 2]]));
children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [new CheckBox({ checked: false, checkedState: { value: '2612', font: 'MS Gothic' }, uncheckedState: { value: '2610', font: 'MS Gothic' } }), new TextRun({ text: '  I wrote every story part in this form myself, in my own words.', size: 21, bold: true, color: INK })] }));

children.push(h1('2. Topic'));
children.push(fields([
  ['Theme', 'mystery, action, adventure, holiday, occasion, fantasy, scifi, sports, cooking, pets, town, parks, travel, wonders, music, nautical, farm or science'],
  ['Topic id', 'lowercase, numbers and dashes: snow-day'],
  ['Topic name', 'shown to players: Snow Day'],
  ['Description', 'one line', 2],
  ['Kind', 'fiction or history'],
  ['Cast word, one', 'neighbor'],
  ['Cast word, many', 'neighbors'],
  ['Cast names', 'at least 8 invented names, 10 is best, separated by commas', 2],
]));

children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { before: 0, after: 120 }, children: [new TextRun({ text: '3. Categories' })] }));
children.push(note('At least 5 categories, at least one numbered. Plain categories need exactly 8 items. Leads: at least 2 per category, each containing {x}. For a numbered category, fill in the Numbers rows instead of Items.'));
for (let i = 1; i <= 6; i++) {
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: i > 1, spacing: { before: 200, after: 80 }, keepNext: true, children: [new TextRun({ text: `Category ${i}${i === 6 ? ' (optional)' : ''}` })] }));
  children.push(fields([
    ['Category name', 'shown on the grid: Street'],
    ['Id', 'one lowercase word: street'],
    ['Type', 'plain, number or time'],
    ['Sentence', 'with {x}: lives on {x} Street'],
    ['Not sentence', 'with {x}: does not live on {x} Street'],
    ['Question word', 'optional: street'],
    ['Items (plain)', '8 items, separated by commas', 2],
    ['Numbers (number)', 'Start · Step · Unit (one, many) · Fewer phrase · More phrase', 2],
    ['Numbers (time)', 'Start time (9:00 AM) · Step minutes · Earlier phrase · Later phrase', 2],
    ['Lead 1', 'with {x}', 2],
    ['Lead 2', 'with {x}', 2],
  ]));
  children.push(gap());
}

children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { before: 0, after: 120 }, children: [new TextRun({ text: '4. Story parts' })] }));
children.push(h2('Title words (at least 6)'));
children.push(note('One word each. A title reads "The <word> <incident name>".'));
children.push(grid([['#', 700], ['Word', 3980], ['#', 700], ['Word', 3980]], 4));
children.push(h2('Openings (at least 6)'));
children.push(note('Example: {N} {many} gathered at the old pier before sunrise.'));
children.push(numbered(8, 'Opening'));
children.push(h2('Incidents (at least 6)'));
children.push(note('What is at stake. Name: a short title word. Prize: "the ..." Example: Lantern · The lighthouse lantern went dark in the storm. · the lantern rescue'));
children.push(grid([['#', 600], ['Name', 1800], ['Sentence', 4760], ['Prize', 2200]], 8));
children.push(h2('Mix-ups (at least 4)'));
children.push(note('Why the facts got scrambled. Example: The wind blew everyone’s notes into the drifts.'));
children.push(numbered(6, 'Mix-up'));
children.push(h2('Endings (at least 4)'));
children.push(note('Example: {Fact}, so {winner} is the one behind {prize}!'));
children.push(numbered(6, 'Ending'));

children.push(h1('5. Picture'));
children.push(fields([['Setting', 'a phrase for the scene picture', 2], ['Mood', 'a few words for color and music']]));

children.push(h1('6. Fact card (history topics only)'));
children.push(note('Your own words. Real names, dates and places belong here, never in the story parts.'));
children.push(fields([
  ['Event'], ['When'], ['Where'],
  ['What really happened', '2 to 4 sentences', 5],
  ['Source title'], ['Source link', 'https://'], ['Second source link', 'https://'], ['Date checked'],
]));

children.push(h1('7. Before you submit'));
for (const t of [
  'No story part names an item or a cast name.',
  'Every lead has {x}; every opening has {n} or {N} and {many}; every ending has {Fact}.',
  'Each item and cast name is used only once in the whole topic.',
  'History: every fact on the card matches a source you read.',
  'Copied every answer into TEMPLATE.md, saved as your-topic-id.md.',
]) children.push(new Paragraph({ spacing: { after: 80 }, children: [new CheckBox({ checked: false, checkedState: { value: '2612', font: 'MS Gothic' }, uncheckedState: { value: '2610', font: 'MS Gothic' } }), new TextRun({ text: '  ' + t, size: 20, color: INK })] }));

const doc = new Document({
  creator: 'The Fantastical Logic Grid', title: 'Story Submission Form',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 21, color: INK } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 52, bold: true, color: INK, font: 'Calibri' } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: ACCENT, font: 'Calibri' }, paragraph: { outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: INK, font: 'Calibri' }, paragraph: { outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Story Submission Form · page ', size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED })] })] }) },
    children,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(process.argv[2], b); console.log('ok'); });
