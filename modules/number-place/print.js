// Printable pages for a NINETIMESNINE puzzle: blank or with the player's
// numbers, Letter or A4, an answer key on its own page, and the step-by-step
// solution for the smaller levels. Returns HTML; the host prints it.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cellName = (N, c) => `row ${Math.floor(c / N) + 1}, column ${(c % N) + 1}`;

function table(p, values, given) {
  const N = Number(p.size), br = Number(p.box[0]), bc = Number(p.box[1]);
  let rows = '';
  for (let r = 0; r < N; r++) {
    rows += '<tr>';
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const cls = [r % br === 0 ? 'bt' : '', c % bc === 0 ? 'bl' : '', p.evenCells.includes(i) ? 'even' : '', given[i] ? 'g' : 'p'].join(' ');
      rows += `<td class="${cls}">${Number(values[i]) || ''}</td>`;
    }
    rows += '</tr>';
  }
  return `<table class="${p.variants.includes('diagonal') ? 'diag' : ''} n${N}">${rows}</table>`;
}

export function printableHtml(game, { marks = false, paper = 'letter', answers = true, steps = false } = {}) {
  const p = game.p;
  const values = marks ? p.givens.map((d, i) => d || game.v[i] || 0) : p.givens;
  const title = p.story?.title || 'NINETIMESNINE';
  let html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: ${paper === 'a4' ? 'A4' : 'letter'}; margin: 16mm; }
    body { font-family: "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif; color: #000; margin: 0; }
    h1 { font-size: 20pt; margin: 0 0 2mm; } h2 { font-size: 14pt; margin: 0 0 3mm; }
    .meta { font-size: 10pt; margin: 0 0 3mm; color: #333; } .intro { font-size: 11pt; max-width: 160mm; margin: 0 0 4mm; }
    ul { margin: 0 0 5mm; padding-left: 5mm; font-size: 10pt; }
    table { border-collapse: collapse; border: 0.9mm solid #000; margin: 0 auto; }
    td { border: 0.25mm solid #666; text-align: center; font-weight: 700; }
    table.n9 td { width: 17mm; height: 17mm; font-size: 18pt; } table.n6 td { width: 22mm; height: 22mm; font-size: 22pt; } table.n4 td { width: 28mm; height: 28mm; font-size: 26pt; }
    td.bt { border-top: 0.9mm solid #000; } td.bl { border-left: 0.9mm solid #000; } td.even { background: #d9d9d9; } td.p { color: #444; font-weight: 400; }
    table.diag { background: linear-gradient(to bottom right, transparent calc(50% - .3mm), #aaa, transparent calc(50% + .3mm)), linear-gradient(to bottom left, transparent calc(50% - .3mm), #aaa, transparent calc(50% + .3mm)); }
    .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
    ol.steps { font-size: 10pt; columns: 2; column-gap: 8mm; padding-left: 6mm; } ol.steps li { break-inside: avoid; margin-bottom: 1.5mm; }
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style><body>`;
  html += `<section class="page"><h1>${esc(title)}</h1><p class="meta">NINETIMESNINE · ${esc(p.difficulty.name)} · ${Number(p.size)}×${Number(p.size)}${game.daily ? ` · Daily ${esc(game.daily)}` : ''}</p>`;
  if (p.story?.intro) html += `<p class="intro">${esc(p.story.intro)}</p>`;
  html += `<ul>${p.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>${table(p, values, p.givens)}</section>`;
  if (answers) html += `<section class="page"><h2>Answer key</h2>${table(p, p.solution, p.givens)}${p.story?.ending ? `<p class="intro" style="margin-top:5mm">${esc(p.story.ending)}</p>` : ''}</section>`;
  if (steps) {
    const items = p.solvePath.map((s) => `<li>${esc(s.why)}${s.place ? ` <b>${Number(s.place[1])} at ${cellName(p.size, s.place[0])}.</b>` : ''}</li>`).join('');
    html += `<section class="page"><h2>Step by step</h2><ol class="steps">${items}</ol></section>`;
  }
  return `${html}</body></html>`;
}

export function printHtml(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 80);
}
