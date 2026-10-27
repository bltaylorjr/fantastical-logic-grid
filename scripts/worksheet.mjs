// Printable worksheet pieces shared by the website's Printables pages
// (seo.mjs) and the educator puzzle packages (educator-package.mjs).
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The classic staircase grid: the first category down the side against every
// other, then the last against the rest, and so on, ready to fill with X and O.
export const gridTable = (p) => {
  const cats = p.categories;
  const K = cats.length;
  const cols = cats.slice(1);
  const rowCats = [cats[0], ...cats.slice(2).reverse()];
  const span = (rc) => (rc === cats[0] ? cols.length : cats.indexOf(rc) - 1);
  const head = `<tr><td class="corner" colspan="2" rowspan="2"></td>${cols.map((c) => `<th scope="colgroup" colspan="${c.items.length}" class="cat">${esc(c.name)}</th>`).join('')}</tr>
<tr>${cols.map((c) => c.items.map((it) => `<th scope="col" class="item"><span>${esc(it.label)}</span></th>`).join('')).join('')}</tr>`;
  const body = rowCats.map((rc) => rc.items.map((it, r) => `<tr${r === 0 ? ' class="t"' : ''}>${r === 0 ? `<th scope="rowgroup" rowspan="${rc.items.length}" class="cat side"><span>${esc(rc.name)}</span></th>` : ''}<th scope="row" class="item">${esc(it.label)}</th>${cols.slice(0, span(rc)).map((c) => c.items.map((x, ci) => `<td${ci === 0 ? ' class="l"' : ''}></td>`).join('')).join('')}</tr>`).join('')).join('');
  return `<div class="table-wrap"><table class="lgrid" aria-label="Blank logic grid with ${K} categories"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
};
export const answerKey = (p) => `<section class="key"><h2>Answer key: ${esc(p.title)}</h2>
<div class="table-wrap"><table><thead><tr>${p.answerKey.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${p.answerKey.rows.map((r) => `<tr>${r.map((v, i) => i ? `<td>${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>
<ol>${p.answerKey.questions.map((q) => `<li>${esc(q.question)} <strong>${esc(q.answer)}</strong></li>`).join('')}</ol>
<p>${esc(p.story.ending)}</p></section>`;
