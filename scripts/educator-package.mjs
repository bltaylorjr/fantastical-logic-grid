// Builds one educator puzzle package (the website's Educators page, server/src/educators.js)
// as printable PDFs, with the game's own puzzle engine:
//   puzzles.pdf      a cover page, then each puzzle: story at the grade's
//                    reading level, clues, the blank grid and the questions
//   answer-keys.pdf  the answers (and, if asked, the worked solution), unless
//                    the educator chose keys after each puzzle or no keys
// Usage: node scripts/educator-package.mjs <job.json | - for stdin> <out dir>
//   job.json: one build from POST /admin/v1/educators/claim plus usedStories.
// Writes <out dir>/manifest.json: { files, storyIds, puzzles, title }.
// The PDFs are printed by Chromium through Playwright (free, open source):
// set FLG_PDF_HTML_ONLY=1 to write only the HTML pages (tests, previews).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { esc, gridTable } from './worksheet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(join(root, 'engine', 'src', 'index.js')).href);
const classroom = await import(pathToFileURL(join(root, 'engine', 'src', 'classroom.js')).href);
const classroomBuild = await import(pathToFileURL(join(root, 'engine', 'src', 'classroom-build.js')).href);
const { generatePuzzle, TIERS } = engine;
const { bandOf, gradeById, PAPERS } = classroom;
const { packagePlan, gradeStory } = classroomBuild;

const font = (file) => {
  const f = join(root, 'node_modules', '@fontsource', 'atkinson-hyperlegible', 'files', file);
  return existsSync(f) ? `url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format('woff2')` : null;
};
const FONTS = [['400', 'atkinson-hyperlegible-latin-400-normal.woff2'], ['700', 'atkinson-hyperlegible-latin-700-normal.woff2']]
  .map(([w, f]) => [w, font(f)]).filter(([, src]) => src)
  .map(([w, src]) => `@font-face{font-family:"Atkinson Hyperlegible";font-weight:${w};src:${src}}`).join('');

export const css = (large) => `${FONTS}
*{box-sizing:border-box}
html{font-family:"Atkinson Hyperlegible",Arial,Helvetica,sans-serif;font-size:${large ? '14pt' : '11pt'};line-height:1.45;color:#111}
body{margin:0}
h1{font-size:1.7em;margin:0 0 .2em;line-height:1.15}
h2{font-size:1.15em;margin:1em 0 .35em;border-bottom:1.5px solid #222;padding-bottom:2px}
p{margin:0 0 .55em}
.page{break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.meta{color:#444;font-size:.85em;margin-bottom:.6em}
.name-line{margin:.4em 0 .8em;font-size:.95em}
ol{margin:0 0 .6em;padding-left:1.6em}
ol li{margin:0 0 .3em}
.qs li{margin-bottom:1em}
.line{display:block;border-bottom:1px solid #777;height:1.4em;width:70%}
.help{font-size:.85em;color:#333}
.keep{break-inside:avoid;page-break-inside:avoid}
.lgrid{border-collapse:collapse;margin:.3em 0 .8em;font-size:${large ? '.78em' : '.8em'}}
.lgrid th,.lgrid td{padding:0;text-align:center;vertical-align:middle}
.lgrid td{width:${large ? '0.8cm' : '0.66cm'};height:${large ? '0.8cm' : '0.66cm'};border:1px solid #555}
.lgrid .corner{border:0}
.lgrid .cat{padding:3px 5px;font-weight:700;background:#eee;border:1px solid #555}
.lgrid thead .item{height:6.6em;vertical-align:bottom;padding:3px 1px;border:1px solid #555}
.lgrid thead .item span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-weight:400}
.lgrid .side span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}
.lgrid tbody .item{text-align:right;padding:0 6px;white-space:nowrap;font-weight:400;border:1px solid #555}
.lgrid td.l{border-left:2.5px solid #111}
.lgrid tr.t>*{border-top:2.5px solid #111}
.cover h1{font-size:2.1em;margin-top:1.2em}
.cover .brand{font-weight:700;letter-spacing:.04em;color:#5B3CC4;text-transform:uppercase;font-size:.85em}
.cover table,.key table{border-collapse:collapse;margin:.4em 0 .8em;width:100%}
.cover th,.cover td,.key th,.key td{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top}
.cover thead th,.key thead th{background:#eee}
.box{border:1.5px solid #5B3CC4;border-radius:6px;padding:.6em .8em;margin:.8em 0}
.steps li{font-size:.9em}
.small{font-size:.8em;color:#444}
`;

const orderNames = (p) => p.categories.slice(1).map((c) => c.name).join(', ');

function puzzlePage(p, i, req, band) {
  const level = TIERS[p.difficulty.id].name;
  const story = gradeStory(p, band);
  return `<section class="page">
<p class="meta">Puzzle ${i + 1} · ${esc(level)} · ${esc(p.theme.id === 'custom' ? p.theme.name : `${p.theme.name}${p.topic ? ` (${p.topic.name})` : ''}`)} · ${p.categories.length} categories × ${p.categories[0].items.length} items</p>
<h1>${esc(p.title)}</h1>
${req.nameLine ? '<p class="name-line">Name: ______________________________ &nbsp; Date: ______________</p>' : ''}
${story.map((t) => `<p>${esc(t)}</p>`).join('\n')}
<h2>Clues</h2>
<ol class="clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
<div class="keep"><h2>The grid</h2>
<p class="help">Mark X where two things cannot go together and O where they do. One O in a row means the rest of that row is X.</p>
${gridTable(p)}</div>
<div class="keep"><h2>Questions</h2>
<ol class="qs">${p.questions.map((q) => `<li>${esc(q.text)}<span class="line"></span></li>`).join('')}</ol></div>
</section>`;
}

function keyPage(p, i, req) {
  const steps = req.solutions ? `<h2>Worked solution</h2>
<ol class="steps">${p.solvePath.map((s) => `<li>${esc(s.explanation)}</li>`).join('')}</ol>` : '';
  return `<section class="page key">
<p class="meta">Answer key · Puzzle ${i + 1}</p>
<h1>${esc(p.title)}</h1>
<table><thead><tr>${p.answerKey.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${p.answerKey.rows.map((r) => `<tr>${r.map((v, j) => (j ? `<td>${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`)).join('')}</tr>`).join('')}</tbody></table>
<h2>Questions</h2>
<ol>${p.answerKey.questions.map((q) => `<li>${esc(q.question)} <strong>${esc(q.answer)}</strong></li>`).join('')}</ol>
<p>${esc(p.story.ending)}</p>
${steps}
</section>`;
}

function cover(job, puzzles, req, band, keysWhere) {
  const grade = gradeById(job.grade);
  const title = req.title || `Logic grid puzzles for ${grade ? grade.name : 'your class'}`;
  return `<section class="page cover">
<p class="brand">The Fantastical Logic Grid</p>
<h1>${esc(title)}</h1>
<p class="meta">Prepared for ${esc(job.name)}, ${esc(job.school)} · ${esc(grade ? grade.name : '')} · ${puzzles.length} ${puzzles.length === 1 ? 'puzzle' : 'puzzles'} · ${esc(PAPERS[req.paper])}</p>
<div class="box"><p><strong>How to use these puzzles</strong></p>
<ol>
<li>Read the story together and point out the categories along the top and side of the grid.</li>
<li>Each clue rules pairs out (X) or matches them (O). Every row and column ends with exactly one O.</li>
<li>When the grid is full, answer the questions. Every puzzle has exactly one answer, reachable without guessing.</li>
<li>${keysWhere}</li>
</ol>
<p class="small">${esc(band.about)}</p></div>
<table><thead><tr><th scope="col">#</th><th scope="col">Puzzle</th><th scope="col">Level</th><th scope="col">Categories</th></tr></thead>
<tbody>${puzzles.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.title)}</td><td>${esc(TIERS[p.difficulty.id].name)}</td><td>${esc(orderNames(p))}</td></tr>`).join('')}</tbody></table>
<p class="small">Free for classroom use by ${esc(job.school)}. You may print and copy these pages for your own students. Please do not sell them or post them online. © ${new Date().getFullYear()} Bobby Taylor, The Fantastical Logic Grid · thelogicgrid.com</p>
</section>`;
}

const doc = (title, body, large) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css(large)}</style></head><body>${body}</body></html>`;

export function buildPackage(job) {
  const req = job.request;
  const band = bandOf(job.grade);
  const used = [...(job.usedStories || [])];
  const plan = packagePlan({ ...req, grade: job.grade, count: job.count || req.count }, `edu-${job.ref}`, used);
  const puzzles = [];
  for (const o of plan) {
    const p = generatePuzzle({ ...o, usedStories: used });
    used.push(p.story.id);
    puzzles.push(p);
  }
  const keysWhere = { separate: 'The answer keys are in a separate file, so you can keep them back.', after: 'Each answer key follows its puzzle on its own page.', none: 'This package has no answer keys.' }[req.keys];
  const large = req.largePrint;
  const title = req.title || `Logic grid puzzles (${gradeById(job.grade)?.name || ''})`;
  const pages = puzzles.map((p, i) => puzzlePage(p, i, req, band) + (req.keys === 'after' ? keyPage(p, i, req) : '')).join('\n');
  const files = [{ name: 'puzzles', title, html: doc(title, cover(job, puzzles, req, band, keysWhere) + pages, large) }];
  if (req.keys === 'separate') files.push({ name: 'answer-keys', title: `${title}: answer keys`, html: doc(`${title}: answer keys`, puzzles.map((p, i) => keyPage(p, i, req)).join('\n'), false) });
  return { title, puzzles, files, storyIds: puzzles.map((p) => p.story.id), paper: req.paper };
}

export async function printPdfs(pkg, outDir) {
  mkdirSync(outDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const out = [];
  try {
    const page = await browser.newPage();
    for (const f of pkg.files) {
      await page.setContent(f.html, { waitUntil: 'load' });
      const file = join(outDir, `${f.name}.pdf`);
      await page.pdf({ path: file, format: pkg.paper === 'a4' ? 'A4' : 'Letter', margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' }, printBackground: true,
        displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#555;font-family:Arial,sans-serif">${esc(f.title)} · thelogicgrid.com · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` });
      out.push(file);
    }
  } finally { await browser.close(); }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [jobFile, outDir] = process.argv.slice(2);
  if (!jobFile || !outDir) { console.error('Usage: node scripts/educator-package.mjs <job.json | - for stdin> <out dir>'); process.exit(2); }
  const job = JSON.parse(readFileSync(jobFile === '-' ? 0 : jobFile, 'utf8'));
  const t0 = Date.now();
  const pkg = buildPackage(job);
  mkdirSync(outDir, { recursive: true });
  let files;
  if (process.env.FLG_PDF_HTML_ONLY === '1') {
    files = pkg.files.map((f) => { const p = join(outDir, `${f.name}.html`); writeFileSync(p, f.html); return p; });
  } else {
    files = await printPdfs(pkg, outDir);
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ title: pkg.title, files, storyIds: pkg.storyIds, puzzles: pkg.puzzles.length }));
  console.log(`Built ${pkg.puzzles.length} puzzles in ${Math.round((Date.now() - t0) / 1000)} s.`);
}
