// The PDF for an approved storyline's thank-you email (server/FEEDBACK-EMAILS.md):
// the first puzzle made with the contributor's storyline, printable, then its
// answer key on its own page. Built by scripts/feedback-replies.py.
// Usage: node scripts/contributor-puzzle.mjs <puzzle.json> <out.pdf>
// Set FLG_PDF_HTML_ONLY=1 to write the HTML instead (tests, previews).
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, gridTable } from './worksheet.mjs';
import { css, printPdfs } from './educator-package.mjs';

const TIERS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };

export function contributorHtml(p) {
  const level = TIERS[p.difficulty?.id] || '';
  const theme = p.theme ? `${p.theme.name}${p.topic ? ` (${p.topic.name})` : ''}` : '';
  const key = p.answerKey;
  const puzzle = `<section class="page">
<p class="brand">The Fantastical Logic Grid · made with your storyline</p>
<p class="meta">${esc([level, theme, `${p.categories.length} categories × ${p.categories[0].items.length} items`].filter(Boolean).join(' · '))}</p>
<h1>${esc(p.title)}</h1>
${(p.story?.paragraphs || []).map((t) => `<p>${esc(t)}</p>`).join('\n')}
<h2>Clues</h2>
<ol class="clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>
<div class="keep"><h2>The grid</h2>
<p class="help">Mark X where two things cannot go together and O where they do. One O in a row means the rest of that row is X.</p>
${gridTable(p)}</div>
${(p.questions || []).length ? `<div class="keep"><h2>Questions</h2>
<ol class="qs">${p.questions.map((q) => `<li>${esc(q.text)}<span class="line"></span></li>`).join('')}</ol></div>` : ''}
</section>`;
  const answers = key ? `<section class="page key">
<p class="meta">Answer key</p>
<h1>${esc(p.title)}</h1>
<table><thead><tr>${key.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${key.rows.map((r) => `<tr>${r.map((v, j) => (j ? `<td>${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`)).join('')}</tr>`).join('')}</tbody></table>
${(key.questions || []).length ? `<h2>Questions</h2><ol>${key.questions.map((q) => `<li>${esc(q.question)} <strong>${esc(q.answer)}</strong></li>`).join('')}</ol>` : ''}
${p.story?.ending ? `<p>${esc(p.story.ending)}</p>` : ''}
</section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>${css(false)}
.brand{font-size:.85em;color:#6b5a2e;margin:0 0 .3em}
.key table{border-collapse:collapse;margin:.4em 0 1em}.key th,.key td{border:1px solid #555;padding:4px 8px;text-align:left}</style></head><body>${puzzle}${answers}</body></html>`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) { console.error('Usage: node scripts/contributor-puzzle.mjs <puzzle.json> <out.pdf>'); process.exit(2); }
  const data = JSON.parse(readFileSync(inFile, 'utf8'));
  const p = data && data.format === 'fantastical-logic-grid' ? data.save.puzzle : data;
  const html = contributorHtml(p);
  mkdirSync(dirname(outFile), { recursive: true });
  if (process.env.FLG_PDF_HTML_ONLY === '1') writeFileSync(outFile, html);
  else {
    const name = basename(outFile).replace(/\.pdf$/i, '');
    const [file] = await printPdfs({ paper: 'letter', files: [{ name, title: p.title, html }] }, dirname(outFile));
    if (file !== outFile) renameSync(file, outFile);
  }
}
