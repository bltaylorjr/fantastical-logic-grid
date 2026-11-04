// Printable pages for a kit game: blank or with the player's marks, Letter or
// A4, an answer key on its own page, and the step-by-step solution. The game
// draws its own board (def.printBoard). Returns HTML; the host prints it.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function printableHtml(game, def, { marks = false, paper = 'letter', answers = true, steps = false } = {}) {
  const p = game.p;
  const values = marks ? p.givens.map((d, i) => d || game.v[i] || 0) : p.givens.slice();
  const title = p.story?.title && !p.picture ? p.story.title : def.name;
  let html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: ${paper === 'a4' ? 'A4' : 'letter'}; margin: 14mm; }
    body { font-family: "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif; color: #000; margin: 0; }
    h1 { font-size: 20pt; margin: 0 0 2mm; } h2 { font-size: 14pt; margin: 0 0 3mm; }
    .meta { font-size: 10pt; margin: 0 0 3mm; color: #333; } .intro { font-size: 11pt; max-width: 160mm; margin: 0 0 4mm; }
    ul { margin: 0 0 5mm; padding-left: 5mm; font-size: 10pt; }
    table { border-collapse: collapse; margin: 0 auto; }
    .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
    ol.steps { font-size: 9.5pt; columns: 2; column-gap: 8mm; padding-left: 6mm; } ol.steps li { break-inside: avoid; margin-bottom: 1.5mm; }
    ${def.printCss}
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style><body>`;
  html += `<section class="page"><h1>${esc(title)}</h1><p class="meta">${esc(def.name)} · ${esc(p.difficulty.name)} · ${esc(def.sizeLabel(p.size))}${game.daily ? ` · Daily ${esc(game.daily)}` : ''}</p>`;
  if (p.story?.intro) html += `<p class="intro">${esc(p.story.intro)}</p>`;
  html += `<ul>${p.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>${def.printBoard(p, values, { answers: false })}</section>`;
  if (answers) html += `<section class="page"><h2>Answer key</h2>${def.printBoard(p, p.solution, { answers: true })}${p.story?.ending ? `<p class="intro" style="margin-top:5mm">${esc(p.story.ending)}</p>` : ''}</section>`;
  if (steps) html += `<section class="page"><h2>Step by step</h2><ol class="steps">${p.solvePath.map((s) => `<li><b>${esc(s.techniqueName)}.</b> ${esc(s.why)}</li>`).join('')}</ol></section>`;
  return `${html}</body></html>`;
}

export function printHtml(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 80);
}
