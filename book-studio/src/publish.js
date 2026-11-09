/* ---------- Preflight, one-click publisher fixes, export ---------- */
let lastIssues = [], applyLog = null;

function isbnValid(s) {
  const d = String(s || '').replace(/[^0-9X]/gi, '');
  if (d.length === 13) { let sum = 0; for (let i = 0; i < 12; i++) sum += +d[i] * (i % 2 ? 3 : 1); return (10 - sum % 10) % 10 === +d[12]; }
  if (d.length === 10) { let sum = 0; for (let i = 0; i < 10; i++) { const v = d[i].toUpperCase() === 'X' ? 10 : +d[i]; sum += v * (10 - i); } return sum % 11 === 0; }
  return false;
}
const lines = s => String(s || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
function nearestTrim(list) { const { w, h } = trimWH(); let best = list[0], bd = 1e9; list.forEach(t => { const [a, b] = TRIMS[t]; const d = Math.abs(a - w) + Math.abs(b - h); if (d < bd) { bd = d; best = t; } }); return best; }
function pageIsBlank(p) { const d = document.createElement('div'); d.innerHTML = p.html; return !d.textContent.trim() && !d.querySelector('img,table,.puzzle') && !p.bg; }

function smallTextCount() {
  const minPx = 7 * IN / 72 - 0.05; let n = 0;
  contentEls().forEach(c => $$('*', c).forEach(el => { if (el.closest('.pz-caption') || !el.childNodes.length) return; const hasText = [...el.childNodes].some(t => t.nodeType === 3 && t.nodeValue.trim()); if (hasText && parseFloat(getComputedStyle(el).fontSize) < minPx) n++; }));
  return n;
}
function fixSmallText() { const minPx = 7 * IN / 72; contentEls().forEach(c => $$('*', c).forEach(el => { if ([...el.childNodes].some(t => t.nodeType === 3 && t.nodeValue.trim()) && parseFloat(getComputedStyle(el).fontSize) < minPx - 0.05) el.style.fontSize = '7pt'; })); syncPagesFromDom(); }
function lowResImages() { let n = 0, worst = 999; contentEls().forEach(c => $$('img', c).forEach(img => { if (img.closest('.puzzle')) return; const d = imageDpi(img); if (d && d < 290) { n++; worst = Math.min(worst, d); } })); return { n, worst }; }
function textQualityCount() { let n = 0; contentEls().forEach(c => { const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const t = w.currentNode; if (t.parentElement.closest('.puzzle')) continue; const v = t.nodeValue; n += (v.match(/["']/g) || []).length + (v.match(/ {2,}/g) || []).length + (v.match(/--/g) || []).length; } }); return n; }
function hasColor() {
  let color = false; contentEls().forEach(c => $$('[style]', c).forEach(el => { const col = el.style.color || el.style.backgroundColor; if (col) { const m = col.match(/\d+/g); if (m && m.length >= 3 && (Math.abs(m[0] - m[1]) > 12 || Math.abs(m[1] - m[2]) > 12)) color = true; } }));
  return color || $$('#pages .content img').length > 0 || S.pages.some(p => p.bg);
}

async function runChecks(opts = {}) {
  syncPagesFromDom(); const P = PUBLISHERS[S.pub]; const n = pageCount(); const out = [];
  const add = (sev, id, msg, sub, fix, act) => out.push({ sev, id, msg, sub, fix, act });
  const toDetails = { label: 'Edit details', fn: () => showTab('details') };
  if (!S.meta.title.trim()) add('error', 'title', 'The book has no title', 'Add one in Book details. It is used on the cover, title page and metadata.', null, toDetails);
  if (!S.meta.author.trim()) add('error', 'author', 'No author name', 'Add the author or pen name in Book details.', null, toDetails);
  if (!P.trims.includes(S.trim)) add('error', 'trim', `${P.short} does not print ${TRIM_LABEL(S.trim)}`, `Switch to a supported size, such as ${TRIM_LABEL(nearestTrim(P.trims))}.`, () => { S.trim = nearestTrim(P.trims); });
  const maxP = P.maxPagesFor ? P.maxPagesFor(S.trim, S.paper) : P.maxPages;
  if (n < P.minPages) add('error', 'minpages', `${n} pages is below the ${P.minPages}-page minimum`, `${P.short} needs at least ${P.minPages} pages. The fix adds ${P.minPages - n} blank "Notes" pages at the end; replace them with more puzzles if you like.`, () => padPages(P.minPages));
  if (n > maxP) add('error', 'maxpages', `${n} pages is over the ${maxP}-page maximum`, 'Split the book into volumes or use a larger trim size.');
  if (P.evenPages && n % 2) add('error', 'even', 'Page count must be even', `${P.short} requires an even number of pages.`, () => padPages(n + 1));
  if (P.lastPageBlank && !pageIsBlank(S.pages[n - 1])) add('error', 'lastblank', 'The last page must be blank', `${P.short} requires a blank final page.`, () => { S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); if (P.evenPages && S.pages.length % 2) S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); });
  if (!P.evenPages && n % 2) add('info', 'odd', 'Odd page count', 'Printers add a blank page at the end. Nothing to do unless you want to fill it.');
  const mm = P.minMargins(n, S.bleed); const low = Object.keys(mm).filter(k => S.margins[k] + 1e-6 < mm[k]);
  if (low.length) add('error', 'margins', `Margins too small: ${low.join(', ')}`, `${P.short} minimum for ${n} pages: inside ${mm.inside} in, outside ${mm.outside} in, top and bottom ${mm.top} in.`, () => { S.margins = P.margins(pageCount(), S.bleed); });
  const over = $$('#pages .page.overflow').length; if (over) add('error', 'overflow', `${over} page${over > 1 ? 's have' : ' has'} content cut off at the bottom`, 'Reflow moves the extra content onto following pages.', () => 'reflow');
  const lr = lowResImages(); if (lr.n) add('warn', 'dpi', `${lr.n} image${lr.n > 1 ? 's' : ''} below 300 DPI (lowest ${lr.worst} DPI)`, 'They may print blurry. Use a higher-resolution file or make the image smaller on the page.');
  const st = smallTextCount(); if (st) add('warn', 'smalltext', `${st} text item${st > 1 ? 's are' : ' is'} smaller than ${P.minFontPt} pt`, 'Print guidelines ask for at least 7 pt so text stays readable.', () => fixSmallText());
  const bgPages = S.pages.filter(p => p.bg).length;
  if (bgPages && !S.bleed) add('warn', 'bleed-off', `${bgPages} page${bgPages > 1 ? 's have' : ' has'} edge-to-edge art but bleed is off`, 'Without bleed, a thin white edge can appear after trimming.', () => { S.bleed = true; });
  if (S.bleed && !bgPages) add('info', 'bleed-unused', 'Bleed is on but nothing reaches the page edge', 'That is fine. Turn bleed off if you prefer smaller outside margins.');
  if (S.ink === 'bw' && hasColor()) add('info', 'gray', 'Color content in a black-and-white interior', 'Pages are converted to grayscale when you export, so check that colored text and images still read well.');
  const blanks = S.pages.slice(0, -1).filter(pageIsBlank).length; if (blanks) add('info', 'blanks', `${blanks} blank page${blanks > 1 ? 's' : ''} inside the book`, 'Fine for spacing or notes pages; delete them if they are accidental.');
  if (!S.folio.on) add('info', 'folio', 'Page numbers are off', 'Puzzle books usually number pages so readers can find answers.', () => { S.folio.on = true; });
  if (S.meta.title && !S.pages.some(p => p.front === 'title')) add('info', 'front', 'No title page or copyright page', 'The fix inserts both at the front using your book details.', () => insertFrontMatter(true));
  const tq = textQualityCount(); if (tq) add('info', 'text', `${tq} typography fix${tq > 1 ? 'es' : ''} available`, 'Straight quotes, double hyphens and double spaces. Auto-edit converts them.', () => autoEditText({ quotes: true, dashes: true, ellipsis: true, spaces: true }));
  // Metadata
  if (P.isbnRequired && !S.meta.isbn.trim()) add('error', 'isbn', `${P.short} requires your own ISBN`, 'Buy one from your national ISBN agency (Bowker in the US) and add it in Book details.', null, toDetails);
  if (S.meta.isbn.trim() && !isbnValid(S.meta.isbn)) add('error', 'isbn-bad', 'The ISBN is not valid', 'Check the digits; the last one is a check digit.', null, toDetails);
  const dl = S.meta.description.length; if (!dl) add('warn', 'desc', 'No book description', 'Retailers show this on your product page.', null, toDetails);
  if (dl > P.descMax) add('error', 'desc-long', `Description is ${dl} characters`, `${P.short} allows ${P.descMax}.`, null, toDetails);
  const kw = lines(S.meta.keywords); if (!kw.length) add('warn', 'kw', 'No keywords', `Add up to ${P.keywords} search keywords.`, null, toDetails);
  if (kw.length > P.keywords) add('warn', 'kw-many', `${kw.length} keywords; ${P.short} uses ${P.keywords}`, 'Extra keywords are dropped from the metadata sheet.', () => { S.meta.keywords = kw.slice(0, P.keywords).join('\n'); fillMetaForm(); });
  const cats = lines(S.meta.categories); if (cats.length > P.categories) add('warn', 'cats', `${cats.length} categories; ${P.short} accepts ${P.categories}`, 'Keep the most specific ones.', null, toDetails);
  // Cover
  if (opts.cover !== false) { try { await ensureCover(); coverIssues().forEach(i => out.push(i)); } catch (e) { add('warn', 'cover-load', 'Cover could not be checked', e.message); } }
  const rank = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.sev] - rank[b.sev]);
  lastIssues = out; renderIssues(); updateStatus();
  return out;
}

function padPages(target) {
  // Notes pages go before the answer key so solutions stay at the back
  while (S.pages.length < target) {
    const ansIdx = S.pages.findIndex(p => p.answers);
    const pg = { id: uid(), html: '<h2 class="center">Notes</h2><p><br></p>', notes: true };
    if (ansIdx >= 0) S.pages.splice(ansIdx, 0, pg); else S.pages.push(pg);
  }
}

function insertFrontMatter(quiet) {
  syncPagesFromDom(); const m = S.meta; const year = (m.pubDate || '').slice(0, 4) || new Date().getFullYear();
  S.pages = S.pages.filter(p => p.front !== 'title' && p.front !== 'copyright');
  const title = `<div style="height:2.2in"></div><h1 class="center" style="font-size:2.6em">${esc(m.title || 'Untitled')}</h1>${m.subtitle ? `<h2 class="center" style="font-weight:400">${esc(m.subtitle)}</h2>` : ''}<div style="height:.6in"></div><p class="center" style="font-size:1.25em">${esc(m.author || '')}</p>${m.imprint ? `<div style="height:2in"></div><p class="center">${esc(m.imprint)}</p>` : ''}`;
  const copy = `<div style="height:4.5in"></div><p style="font-size:9pt">Copyright © ${year} ${esc(m.copyright || m.author || '')}. All rights reserved.</p><p style="font-size:9pt">No part of this book may be reproduced in any form without written permission from the publisher, except for brief quotations in reviews.</p>${m.isbn ? `<p style="font-size:9pt">ISBN ${esc(m.isbn)}</p>` : ''}${m.edition ? `<p style="font-size:9pt">${esc(m.edition)}</p>` : ''}${m.imprint ? `<p style="font-size:9pt">Published by ${esc(m.imprint)}</p>` : ''}`;
  S.pages.unshift({ id: uid(), html: title, front: 'title', noFolio: true }, { id: uid(), html: copy, front: 'copyright', noFolio: true });
  if (!quiet) { renderPages(); refreshAll(); markDirty(); toast('Added a title page and a copyright page at the front'); }
}

async function applyIssueFix(issue) {
  snapshot('fix: ' + issue.msg); syncPagesFromDom();
  const r = issue.fix(); if (r && r.then) await r;
  if (r === 'reflow') { reflow(0, true); reflowAnswers(); }
  renderPages(); refreshUI(); onGeometryChanged(); markDirty();
  await nextFrame(); await runChecks();
}

/* One click: apply a publisher's specs and fix everything fixable */
async function applyPublisher() {
  const P = PUBLISHERS[S.pub]; const log = [];
  busy(`Applying ${P.name} specs`, 0.1); await nextFrame();
  snapshot('apply ' + P.short); syncPagesFromDom();
  if (!P.trims.includes(S.trim)) { const t = nearestTrim(P.trims); log.push(`Trim size changed to ${TRIM_LABEL(t)}`); S.trim = t; }
  if (S.pages.some(p => p.bg) && !S.bleed) { S.bleed = true; log.push('Bleed turned on for edge-to-edge pages'); }
  S.margins = P.margins(pageCount(), S.bleed); renderPages(); await nextFrame();
  busy('Fixing text and layout', 0.3);
  const ed = autoEditText({ quotes: true, dashes: true, ellipsis: true, spaces: true }); if (ed) log.push(`Auto-edited text (${ed} fixes)`);
  if (smallTextCount()) { fixSmallText(); log.push('Raised text below 7 pt to 7 pt'); }
  if (S.meta.title && !S.pages.some(p => p.front === 'title')) { insertFrontMatter(true); log.push('Added title and copyright pages'); }
  renderPages(); await nextFrame();
  if ($$('#pages .page.overflow').length) { const a = reflow(0, true); reflowAnswers(); log.push(`Reflowed overflowing pages${a ? ` (+${a} pages)` : ''}`); }
  busy('Checking page count', 0.55);
  if (pageCount() < P.minPages) { log.push(`Added ${P.minPages - pageCount()} Notes pages to reach the ${P.minPages}-page minimum`); padPages(P.minPages); }
  if (P.lastPageBlank && !pageIsBlank(S.pages[pageCount() - 1])) { S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); log.push('Added a blank last page'); }
  if (P.evenPages && pageCount() % 2) { S.pages.push({ id: uid(), html: '<p><br></p>', noFolio: true }); log.push('Added a page to make the count even'); }
  // gutter depends on page count, so set margins again
  const m2 = P.margins(pageCount(), S.bleed); S.margins = m2;
  log.push(`Margins set: inside ${m2.inside} in, outside ${m2.outside} in, top/bottom ${m2.top} in`);
  if (!S.folio.on) { S.folio.on = true; log.push('Page numbers turned on'); }
  const kw = lines(S.meta.keywords); if (kw.length > P.keywords) { S.meta.keywords = kw.slice(0, P.keywords).join('\n'); log.push(`Keywords trimmed to ${P.keywords}`); }
  renderPages(); refreshUI(); await nextFrame();
  if ($$('#pages .page.overflow').length) { reflow(0, true); reflowAnswers(); }
  busy('Updating cover', 0.75);
  try {
    await ensureCover(); onGeometryChanged();
    const sp = cv.getObjects().filter(o => o.role === 'spine');
    if (sp.length && pageCount() < P.spineTextMinPages) { sp.forEach(o => cv.remove(o)); log.push('Removed spine text (book is too thin)'); }
    if (!sp.length && pageCount() >= P.spineTextMinPages && S.meta.title) { addSpineText(); log.push('Added spine text'); }
    log.push(`Cover resized to ${coverGeom().W.toFixed(3)} × ${coverGeom().H.toFixed(3)} in with a ${fmtIn(spineIn())} spine`);
    cv.requestRenderAll();
  } catch (e) { log.push('Cover could not be updated: ' + e.message); }
  busy('Running checks', 0.9);
  markDirty(); await runChecks();
  busy(false);
  showTab('publish');
  applyLog = { pub: P.name, log }; renderIssues();
}

function renderIssues() {
  const box = $('#issues'); const sum = $('#checkSummary');
  const c = { error: 0, warn: 0, info: 0 }; lastIssues.forEach(i => c[i.sev]++);
  const errs = c.error;
  const applied = applyLog ? `<div class="card" style="flex-basis:100%"><h3>Applied ${esc(applyLog.pub)} specs</h3><ul class="plain">${applyLog.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="hint">${errs ? `${errs > 1 ? errs + ' items still need' : '1 item still needs'} you. They are listed below.` : 'Everything required is in place. Download the submission packet when you are ready.'}</p></div>` : '';
  sum.innerHTML = applied + `<span class="chip ${c.error ? 'error' : 'ok'}">${c.error ? c.error + ' must fix' : 'Ready to submit'}</span><span class="chip warn">${c.warn} warnings</span><span class="chip info">${c.info} notes</span>` + (lastIssues.some(i => i.fix) ? '<button class="btn" id="fixAll">Fix all automatically</button>' : '');
  if (!lastIssues.length) { box.innerHTML = '<div class="issue"><span class="chip ok">OK</span><div class="txt">No problems found for this publisher.</div><span></span></div>'; return; }
  box.innerHTML = '';
  lastIssues.forEach(i => {
    const row = document.createElement('div'); row.className = 'issue';
    row.innerHTML = `<span class="chip ${i.sev}">${i.sev === 'error' ? 'Must fix' : i.sev === 'warn' ? 'Warning' : 'Note'}</span><div class="txt">${esc(i.msg)}<small>${esc(i.sub || '')}</small></div><span></span>`;
    const slot = row.lastElementChild;
    if (i.fix) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Fix'; b.onclick = () => applyIssueFix(i); slot.appendChild(b); }
    else if (i.act) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = i.act.label; b.onclick = i.act.fn; slot.appendChild(b); }
    box.appendChild(row);
  });
  const fa = $('#fixAll'); if (fa) fa.onclick = async () => { snapshot('fix all'); for (const i of lastIssues.filter(x => x.fix)) { const r = i.fix(); if (r && r.then) await r; if (r === 'reflow') { reflow(0, true); reflowAnswers(); } renderPages(); await nextFrame(); } refreshUI(); onGeometryChanged(); markDirty(); await runChecks(); toast('Applied all automatic fixes'); };
}

/* ---------- Export ---------- */
function grayscaleCanvas(c) {
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height); const a = d.data;
  for (let i = 0; i < a.length; i += 4) { const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = y; }
  ctx.putImageData(d, 0, 0);
}
async function renderPageCanvas(i, dpi) {
  const host = $('#renderHost'); host.innerHTML = ''; applyBookVars(host);
  const { w, h } = trimWH(); const b = bleedIn(); const bi = bleedInsideIn(); const recto = i % 2 === 0;
  const sheet = document.createElement('div');
  const SW = w + b + bi, SH = h + 2 * b;
  Object.assign(sheet.style, { width: SW * IN + 'px', height: SH * IN + 'px', position: 'relative', background: '#fff', overflow: 'hidden' });
  const node = buildPageNode(i, true); node.style.position = 'absolute'; node.style.left = (recto ? bi : b) * IN + 'px'; node.style.top = b * IN + 'px'; node.style.boxShadow = 'none';
  sheet.appendChild(node); host.appendChild(sheet);
  await nextFrame(); fitGridBlocks(sheet);
  const canvas = await html2canvas(sheet, { scale: dpi / IN, backgroundColor: '#ffffff', logging: false, useCORS: true });
  if (S.ink === 'bw') grayscaleCanvas(canvas);
  host.innerHTML = '';
  return { canvas, SW, SH };
}
async function buildInteriorPDF(dpi) {
  await loadLibs('jspdf', 'html2canvas'); syncPagesFromDom();
  try { await document.fonts.ready; await ensureFonts([S.body.font, 'Courier Prime']); } catch (e) { }
  const { jsPDF } = window.jspdf; let pdf = null;
  for (let i = 0; i < S.pages.length; i++) {
    busy(`Rendering interior page ${i + 1} of ${S.pages.length}`, i / S.pages.length);
    const { canvas, SW, SH } = await renderPageCanvas(i, dpi);
    const orient = SW > SH ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ unit: 'in', format: [SW, SH], orientation: orient, compress: true });
    else pdf.addPage([SW, SH], orient);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, SW, SH, undefined, 'FAST');
    canvas.width = canvas.height = 0;
  }
  setPdfInfo(pdf, 'Interior');
  return pdf.output('blob');
}
async function buildCoverPDF(dpi) {
  await loadLibs('jspdf'); busy('Rendering cover', 0.5); const g = coverGeom();
  const url = await renderCoverDataURL(dpi); const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'in', format: [g.W, g.H], orientation: 'landscape', compress: true });
  pdf.addImage(url, 'JPEG', 0, 0, g.W, g.H, undefined, 'FAST'); setPdfInfo(pdf, 'Cover');
  return { blob: pdf.output('blob'), url };
}
async function buildFrontCoverJPG(dpi) {
  const g = coverGeom(); const full = await renderCoverDataURL(dpi);
  const img = await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = full; });
  const k = img.naturalWidth / g.W; const c = document.createElement('canvas'); c.width = Math.round(g.w * k); c.height = Math.round(g.h * k);
  c.getContext('2d').drawImage(img, g.frontX * k, g.b * k, g.w * k, g.h * k, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}
function setPdfInfo(pdf, part) { pdf.setProperties({ title: `${S.meta.title || 'Untitled'} - ${part}`, author: S.meta.author || '', subject: S.meta.subtitle || '', keywords: lines(S.meta.keywords).join(', '), creator: 'Puzzle Book Studio' }); }

function metadataObject() {
  const P = PUBLISHERS[S.pub]; const g = coverGeom(); const m = S.meta;
  return {
    publisher_platform: P.name, generated: new Date().toISOString(),
    title: m.title, subtitle: m.subtitle, author: m.author, contributors: m.contributors, series: m.series, series_number: m.seriesNo, edition: m.edition,
    imprint: m.imprint, isbn: m.isbn, publication_date: m.pubDate, language: m.language, list_price_usd: m.price, audience: m.audience, copyright_holder: m.copyright || m.author,
    description: m.description, back_cover_blurb: m.blurb, keywords: lines(m.keywords).slice(0, P.keywords), categories: lines(m.categories).slice(0, P.categories),
    print: { binding: 'Paperback (perfect bound)', trim_in: `${g.w} x ${g.h}`, interior_ink: S.ink === 'bw' ? 'Black & white' : 'Color', paper: S.paper, bleed: S.bleed, page_count: pageCount(), spine_width_in: +g.sp.toFixed(4), full_cover_in: `${g.W.toFixed(3)} x ${g.H.toFixed(3)}`, margins_in: S.margins }
  };
}
function metadataText() {
  const o = metadataObject(); const p = o.print; const P = PUBLISHERS[S.pub];
  const L = [`${o.title || 'Untitled'}${o.subtitle ? ': ' + o.subtitle : ''}`, `Metadata sheet for ${P.name}`, '='.repeat(60), '',
    `Title:            ${o.title}`, `Subtitle:         ${o.subtitle}`, `Author:           ${o.author}`, `Contributors:     ${o.contributors}`, `Series:           ${o.series}${o.series_number ? ' #' + o.series_number : ''}`,
    `Edition:          ${o.edition}`, `Imprint:          ${o.imprint}`, `ISBN:             ${o.isbn || (P.isbnRequired ? 'REQUIRED: add your ISBN' : 'Use the free ISBN offered by ' + P.short)}`, `Publication date: ${o.publication_date}`,
    `Language:         ${o.language}`, `List price (USD): ${o.list_price_usd}`, `Audience:         ${o.audience}`, `Copyright:        ${o.copyright_holder}`, '',
    'DESCRIPTION', '-'.repeat(60), o.description, '', 'KEYWORDS', '-'.repeat(60), ...o.keywords.map((k, i) => `${i + 1}. ${k}`), '', 'CATEGORIES', '-'.repeat(60), ...o.categories, '',
    'PRINT SPECIFICATIONS', '-'.repeat(60), `Binding:      ${p.binding}`, `Trim size:    ${p.trim_in} in`, `Interior:     ${p.interior_ink} on ${p.paper} paper`, `Bleed:        ${p.bleed ? 'Yes (0.125 in)' : 'No'}`,
    `Page count:   ${p.page_count}`, `Spine width:  ${p.spine_width_in} in`, `Full cover:   ${p.full_cover_in} in (including 0.125 in bleed)`,
    `Margins:      top ${p.margins_in.top}, bottom ${p.margins_in.bottom}, inside ${p.margins_in.inside}, outside ${p.margins_in.outside} in`];
  return L.join('\n');
}
function checklistText(files) {
  const P = PUBLISHERS[S.pub]; const errs = lastIssues.filter(i => i.sev === 'error');
  return [`${P.name} submission checklist`, '='.repeat(60), '',
    'Files in this packet:', ...files.map(f => '  - ' + f), '',
    'Steps:', `  1. Sign in at ${P.links.submit || P.links.guide || 'your printer\'s site'} and start a new paperback.`,
    '  2. Copy title, author, description, keywords and categories from metadata.txt.',
    `  3. Choose trim ${coverGeom().w} x ${coverGeom().h} in, ${S.ink === 'bw' ? 'black & white' : 'color'} interior on ${S.paper} paper, bleed ${S.bleed ? 'ON' : 'OFF'}.`,
    '  4. Upload the interior PDF, then the cover PDF.', '  5. Open the online previewer and look at every page.', '  6. Order a printed proof before you publish.', '',
    'Publisher notes:', ...P.notes.map(n => '  - ' + n), '',
    errs.length ? 'OPEN ISSUES (fix before submitting):' : 'Preflight: no blocking issues.', ...errs.map(e => '  - ' + e.msg + '. ' + (e.sub || '')), '',
    P.links.cover ? `Confirm the cover size with the official calculator: ${P.links.cover}` : 'Confirm the cover size with the printer\'s cover template tool.'
  ].join('\n');
}
function reportText() {
  const P = PUBLISHERS[S.pub];
  return [`Preflight report: ${S.meta.title || 'Untitled'} for ${P.name}`, `Generated ${new Date().toLocaleString()}`, '',
    ...(lastIssues.length ? lastIssues.map(i => `[${i.sev === 'error' ? 'MUST FIX' : i.sev === 'warn' ? 'WARNING' : 'NOTE'}] ${i.msg}\n    ${i.sub || ''}`) : ['No problems found.']), '',
    'Spec values follow the project publisher spec sheet (2026-11-05). Some numbers are safe defaults where the publisher does not publish one; confirm in the publisher\'s calculator.'].join('\n');
}

// In Grid Admin, every export checks in first (auth.js); the stand-alone build has no check.
const mayExport = async (kind) => (typeof checkInExport === 'function' ? checkInExport(kind) : true);
async function exportPacket() {
  if (!(await mayExport('packet'))) return;
  allowCancel();
  const dpi = +$('#dpi').value; const base = slug(S.meta.title) + '-' + slug(PUBLISHERS[S.pub].short);
  try {
    busy('Checking the book', 0.02); await runChecks();
    await loadLibs('jszip');
    const interior = await buildInteriorPDF(dpi);
    const cover = await buildCoverPDF(dpi);
    busy('Preparing front cover image', 0.92); const front = await buildFrontCoverJPG(Math.min(dpi, 300));
    busy('Packing the submission packet', 0.96);
    syncPagesFromDom(); syncCoverToState();
    const files = [`${base}-interior.pdf`, `${base}-cover.pdf`, `${base}-front-cover.jpg`, 'metadata.txt', 'metadata.json', 'preflight-report.txt', 'SUBMISSION-CHECKLIST.txt', `${base}-project.json`];
    const zip = new JSZip(); const dir = zip.folder(base + '-packet');
    dir.file(files[0], interior); dir.file(files[1], cover.blob); dir.file(files[2], front);
    dir.file('metadata.txt', metadataText()); dir.file('metadata.json', JSON.stringify(metadataObject(), null, 2));
    dir.file('preflight-report.txt', reportText()); dir.file('SUBMISSION-CHECKLIST.txt', checklistText(files));
    dir.file(files[7], JSON.stringify(S));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    busy('Saving', 1); busy(false);
    if ((await saveFile(base + '-submission-packet.zip', blob)) && typeof ppRecordExport === 'function') ppRecordExport('packet');
  } catch (e) { exportFailed(e); }
}
// Cancel on the progress card ends an export quietly; anything else is reported.
function exportFailed(e) {
  busy(false);
  if (e && e.code === 'cancelled') { toast('Export cancelled. Nothing was saved.'); return; }
  console.error(e); toast('Export failed: ' + ((e && e.message) || e), 7000);
}
async function exportInterior() { if (!(await mayExport('interior'))) return; allowCancel(); try { const b = await buildInteriorPDF(+$('#dpi').value); busy('Saving', 1); busy(false); if ((await saveFile(slug(S.meta.title) + '-interior.pdf', b)) && typeof ppRecordExport === 'function') ppRecordExport('interior'); } catch (e) { exportFailed(e); } }
async function exportCover() { if (!(await mayExport('cover'))) return; allowCancel(); try { const { blob } = await buildCoverPDF(+$('#dpi').value); busy('Saving', 1); busy(false); await saveFile(slug(S.meta.title) + '-cover.pdf', blob); } catch (e) { exportFailed(e); } }

function renderPubCard() {
  const P = PUBLISHERS[S.pub]; const g = coverGeom(); const n = pageCount(); const rec = P.margins(n, S.bleed);
  $('#pubSpecs').innerHTML = `<dt>Trim sizes</dt><dd>${P.trims.length} supported</dd><dt>Page count</dt><dd>${P.minPages}–${P.maxPagesFor ? P.maxPagesFor(S.trim, S.paper) : P.maxPages}</dd><dt>Bleed</dt><dd>0.125 in ${P.bleedRule === 'all' ? '(all sides)' : '(outside, top, bottom)'}</dd><dt>Gutter at ${n} pp</dt><dd>${gutterFrom(P.gutter, n)} in min</dd><dt>Recommended margins</dt><dd>${rec.inside} / ${rec.outside} / ${rec.top} in</dd><dt>Spine</dt><dd>${fmtIn(g.sp)}</dd><dt>Spine text from</dt><dd>${P.spineTextMinPages} pages</dd><dt>ISBN</dt><dd>${P.isbnRequired ? 'required' : 'optional'}</dd><dt>Images</dt><dd>${P.minDpi} DPI min</dd>`;
  $('#pubNotes').innerHTML = P.notes.map(n => `<li>${esc(n)}</li>`).join('');
  const L = P.links; $('#pubLinks').innerHTML = [L.guide && `<a href="${L.guide}" target="_blank" rel="noopener">Print guidelines</a>`, L.cover && `<a href="${L.cover}" target="_blank" rel="noopener">Cover calculator</a>`, L.submit && `<a href="${L.submit}" target="_blank" rel="noopener">Submit</a>`].filter(Boolean).join(' · ');
}
