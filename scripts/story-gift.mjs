// One storyline gift (server/src/story-gifts.js): a puzzle told with exactly
// the player's approved storyline, as a saved puzzle for their account and a
// PDF with the puzzle and its answer key. Run by scripts/story-gifts.py.
//
//   node scripts/story-gift.mjs <job.json> <out dir>
//
// Writes <out dir>/puzzle.pdf and <out dir>/manifest.json:
// { title, credit, save (the saved-puzzle JSON, as text), files: [pdf path] }.
// With --no-pdf (the tests), only the manifest and the saved puzzle.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { esc, gridTable } from './worksheet.mjs';
import { doc } from './educator-package.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { generatePuzzle, TIERS, getTopics } = await import(pathToFileURL(join(root, 'engine', 'src', 'index.js')).href);

// The same as the game's own estimate (web/js/app.js), for the saved puzzle.
const MINUTES_PER_CELL = { basic: 0.12, easy: 0.16, medium: 0.22, hard: 0.3, expert: 0.36, mensa: 0.42 };

export function buildGift(job, now = Date.now()) {
  const { theme, parts, force } = job;
  const topic = job.topic || getTopics(theme).find((t) => !t.story)?.id;
  const one = (v) => [v];
  const puzzle = generatePuzzle({
    theme, topic, difficulty: job.difficulty || 'medium', seed: `gift-${job.id}`,
    storyParts: { [theme]: { openings: one(parts.openings), incidents: one(parts.incidents), mishaps: one(parts.mishaps), endings: one(parts.endings) } },
    forceStory: force,
  });
  const K = puzzle.categories.length, N = puzzle.categories[0].items.length;
  const save = {
    id: randomUUID(), name: puzzle.title, storyId: puzzle.story.id, puzzle,
    marks: {}, ticked: [], answers: {}, undo: [], redo: [],
    hintsUsed: 0, checksUsed: 0, elapsedMs: 0, mistakes: 0,
    expectedMs: (K * (K - 1) / 2) * N * N * (MINUTES_PER_CELL[puzzle.difficulty.id] || 0.2) * 60000,
    focus: null, view: 'grid', solved: false, revealed: false, completedAt: null, coach: false,
    created: now, lastPlayed: now, percent: 0, gift: true,
  };
  return { puzzle, save };
}

function pages(p) {
  const level = TIERS[p.difficulty.id].name;
  const credit = p.story.credit ? `<p class="small">Storyline by <strong>${esc(p.story.credit)}</strong>. Thank you!</p>` : '';
  return `<section class="page">
<p class="meta">${esc(level)} · ${esc(p.theme.name)} · ${p.categories.length} categories × ${p.categories[0].items.length} items</p>
<h1>${esc(p.title)}</h1>
${credit}
${p.story.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('\n')}
<h2>Clues</h2>
<ol class="clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
<div class="keep"><h2>The grid</h2>
<p class="help">Mark X where two things cannot go together and O where they do. One O in a row means the rest of that row is X.</p>
${gridTable(p)}</div>
<div class="keep"><h2>Questions</h2>
<ol class="qs">${p.questions.map((q) => `<li>${esc(q.text)}<span class="line"></span></li>`).join('')}</ol></div>
</section>
<section class="page key">
<p class="meta">Answer key</p>
<h1>${esc(p.title)}</h1>
<table><thead><tr>${p.answerKey.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${p.answerKey.rows.map((r) => `<tr>${r.map((v, j) => (j ? `<td>${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`)).join('')}</tr>`).join('')}</tbody></table>
<h2>Questions</h2>
<ol>${p.answerKey.questions.map((q) => `<li>${esc(q.question)} <strong>${esc(q.answer)}</strong></li>`).join('')}</ol>
<p>${esc(p.story.ending)}</p>
<p class="small">© ${new Date().getFullYear()} Bobby Taylor, The Fantastical Logic Grid · thelogicgrid.com${p.story.credit ? ` · Storyline by ${esc(p.story.credit)}` : ''}</p>
</section>`;
}

async function printPdf(p, file) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(doc(p.title, pages(p), false), { waitUntil: 'load' });
    await page.pdf({ path: file, format: 'Letter', margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' }, printBackground: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#555;font-family:Arial,sans-serif">${esc(p.title)} · thelogicgrid.com · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` });
  } finally { await browser.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [jobFile, outDir, flag] = process.argv.slice(2);
  if (!jobFile || !outDir) { console.error('Usage: node scripts/story-gift.mjs <job.json> <out dir> [--no-pdf]'); process.exit(2); }
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  const { puzzle, save } = buildGift(job);
  mkdirSync(outDir, { recursive: true });
  const files = [];
  if (flag !== '--no-pdf') {
    const slug = puzzle.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'puzzle';
    const file = join(outDir, `${slug}.pdf`);
    await printPdf(puzzle, file);
    files.push(file);
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ title: puzzle.title, credit: puzzle.story.credit || null, difficulty: TIERS[puzzle.difficulty.id].name, theme: puzzle.theme.name, save: JSON.stringify(save), files }));
}
