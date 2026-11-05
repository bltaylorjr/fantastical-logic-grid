// Print layout: black-and-white safe puzzle pages, and the answer key on its own page.
import { esc, puzzleIndex } from './grid.js';
import { settle } from './i18n.js';

// Page width in points, minus margins, for sizing grid cells.
const PAGE_WIDTH_PT = { letter: 612 - 72, A4: 595 - 72 };

function gridTable(puzzle, ix, stateOf, cellPt) {
  const { byId, N } = ix;
  const cols = puzzle.grid.columns.map((id) => byId[id]);
  const rows = puzzle.grid.rows.map((id) => byId[id]);
  let h = `<table class="pg" style="--pcell:${cellPt}pt"><thead><tr><th colspan="2"></th>${cols.map((c) => `<th class="cath" colspan="${N}">${esc(c.name)}</th>`).join('')}</tr>`;
  h += `<tr><th colspan="2"></th>${cols.map((c) => c.items.map((it) => `<th class="colh"><div>${esc(it.label)}</div></th>`).join('')).join('')}</tr></thead><tbody>`;
  rows.forEach((rc, ri) => {
    const nBlocks = cols.length - ri;
    rc.items.forEach((it, i) => {
      h += `<tr>${i === 0 ? `<th class="rcat" rowspan="${N}">${esc(rc.name)}</th>` : ''}<th class="rowh">${esc(it.label)}</th>`;
      for (let b = 0; b < cols.length; b++) {
        if (b >= nBlocks) { h += `<td class="gap" colspan="${N}"></td>`; continue; }
        cols[b].items.forEach((ct, j) => {
          const s = stateOf(ix.key(it.id, ct.id));
          const sym = s === 'O' ? '<span class="po" role="img" aria-label="confirmed"></span>' : s ? '<span aria-label="ruled out">✕</span>' : '';
          h += `<td class="c${j === N - 1 ? ' bR' : ''}${i === N - 1 ? ' bB' : ''}">${sym}</td>`;
        });
      }
      h += '</tr>';
    });
  });
  return `${h}</tbody></table>`;
}

// The puzzle's own pages (story, grid, clues, questions), and its answer key
// page. Shared by single puzzles and printable packs (buildPack).
function puzzleParts(puzzle, options) {
  const ix = puzzleIndex(puzzle);
  const { N, K } = ix;
  const longest = Math.max(...puzzle.categories.flatMap((c) => c.items.map((i) => i.label.length)));
  const labelPt = Math.min(140, 14 + longest * 5.2);
  const cols = (K - 1) * N;
  const cellPt = Math.max(11, Math.min(26, Math.floor((PAGE_WIDTH_PT[options.paper] - labelPt - 18) / cols)));
  const marks = options.marks || new Map();
  const state = (k) => (options.withMarks ? (marks.get(k) === 'A' ? 'X' : marks.get(k) || '') : '');
  const meta = `${esc(puzzle.theme.name)} · ${esc(puzzle.difficulty.name)} · ${K} categories, ${N} items each · ${puzzle.clues.length} clues`;
  const label = options.label ? `${esc(options.label)}: ` : '';
  const head = (suffix = '') => `<h1>${label}${esc(puzzle.title)}${suffix}</h1><p class="pmeta">${meta} · <span translate="no">© The Fantastical Logic Grid, thelogicgrid.com</span></p>`;

  const story = `<h2>The story</h2>${puzzle.story.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}`;
  const grid = gridTable(puzzle, ix, state, cellPt);
  const clues = `<h2>Clues</h2><ol>${puzzle.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>`;
  const myNotes = (options.myNotes || '').trim() ? `<h2>My notes</h2><p class="pnotes" translate="no">${esc(options.myNotes.trim())}</p>` : '';
  // One short line at the bottom of the puzzle, only once support asks are on (support.js).
  const supportLine = options.supportLine ? `<p class="psupport" translate="no">${esc(options.supportLine)}</p>` : '';
  const questions = `<h2>Questions</h2><ol>${puzzle.questions.map((q) => `<li>${esc(q.text)} <span class="qline"></span></li>`).join('')}</ol>${myNotes}${supportLine}`;

  // Small puzzles fit on one page; otherwise the grid goes on page 1 and the clues on page 2.
  const gridHeightPt = (K - 1) * N * cellPt + labelPt;
  const fitsOnePage = gridHeightPt + puzzle.clues.length * 16 + puzzle.story.paragraphs.length * 40 < 620;
  const pages = fitsOnePage
    ? `<section class="pp">${head()}${story}${grid}${clues}${questions}</section>`
    : `<section class="pp">${head()}${story}${grid}</section><section class="pp">${head(' (continued)')}${clues}${questions}</section>`;

  const solvedState = (k) => {
    const [a, b] = k.split('|');
    const match = puzzle.solution.some((row) => Object.values(row).includes(a) && Object.values(row).includes(b));
    return match ? 'O' : '';
  };
  const table = `<table class="ptab"><thead><tr>${puzzle.answerKey.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${puzzle.answerKey.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const answers = `<h2>Questions</h2><ol>${puzzle.answerKey.questions.map((q) => `<li>${esc(q.question)} <b>${esc(q.answer)}</b></li>`).join('')}</ol>`;
  const steps = options.steps ? `<h2>Step by step</h2><ol class="psteps">${puzzle.solvePath.map((s) => `<li>${esc(s.explanation)}</li>`).join('')}</ol>` : '';
  const key = `<section class="pp"><h1>${label}Answer key</h1><p class="pmeta">${esc(puzzle.title)} · ${meta}</p>${gridTable(puzzle, ix, solvedState, cellPt)}<h2>Solution</h2>${table}${answers}<h2>How it ends</h2><p>${esc(puzzle.story.ending)}</p>${steps}</section>`;
  return { pages, key };
}

// options: { withMarks, answerKey, steps, paper, marks: Map, myNotes, supportLine }
export function buildPrint(puzzle, options) {
  const { pages, key } = puzzleParts(puzzle, options);
  return options.answerKey ? pages + key : pages;
}

// Several blank puzzles in one print: a contents page, then each puzzle
// ("Puzzle 1", "Puzzle 2"...), then the answer keys together at the back
// (keys: 'end'), each right after its puzzle ('each') or none ('none').
// options: { paper, keys, title, note, supportLine }
export function buildPack(puzzles, options) {
  const keys = options.keys || 'end';
  const parts = puzzles.map((p, i) => puzzleParts(p, { paper: options.paper, supportLine: options.supportLine, label: `Puzzle ${i + 1}` }));
  const list = puzzles.map((p) => `<li>${esc(p.title)} <span class="pmeta">${esc(p.theme.name)} · ${esc(p.difficulty.name)}</span></li>`).join('');
  const where = keys === 'end' ? 'The answer keys are at the back.' : keys === 'each' ? 'Each answer key follows its puzzle.' : '';
  const cover = `<section class="pp pcover"><h1>${esc(options.title || 'Puzzle pack')}</h1><p class="pmeta"><span translate="no">© The Fantastical Logic Grid, thelogicgrid.com</span></p>${options.note ? `<p>${esc(options.note)}</p>` : ''}<h2>In this pack</h2><ol>${list}</ol>${where ? `<p>${where}</p>` : ''}</section>`;
  const body = parts.map((x) => x.pages + (keys === 'each' ? x.key : '')).join('');
  return cover + body + (keys === 'end' ? parts.map((x) => x.key).join('') : '');
}

// Fills the print area with ready-made pages, sets the page size and
// document title, and prints (or, with `pdf`, saves a PDF on the desktop app).
export async function printPages(html, { title, paper, pdf } = {}) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  // In another language, wait for the page's translations first.
  await settle(root);
  let pageStyle = document.getElementById('page-style');
  if (!pageStyle) { pageStyle = document.createElement('style'); pageStyle.id = 'page-style'; document.head.append(pageStyle); }
  pageStyle.textContent = `@page { size: ${paper === 'A4' ? 'A4' : 'letter'}; margin: 0.5in; }`;
  const oldTitle = document.title;
  document.title = title;
  const restore = () => { document.title = oldTitle; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  if (pdf) return pdf().finally(restore);
  window.print();
  setTimeout(restore, 1000);
}

export const printPuzzle = (puzzle, options, { pdf } = {}) => printPages(buildPrint(puzzle, options), { title: puzzle.title, paper: options.paper, pdf });
