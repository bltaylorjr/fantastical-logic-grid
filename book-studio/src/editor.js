/* ---------- Interior editor ---------- */
let zoom = 0.75, savedRange = null, selImg = null, selPuzzle = null;
let undoStack = [], lastStructAt = 0, lastTypeAt = 0;

function snapshot(label) {
  syncPagesFromDom();
  undoStack.push({ label, pages: JSON.parse(JSON.stringify(S.pages)), cur: curPage, at: Date.now() });
  if (undoStack.length > 25) undoStack.shift();
  lastStructAt = Date.now();
}
function undoStructural() {
  const h = undoStack.pop(); if (!h) return false;
  S.pages = h.pages; curPage = Math.min(h.cur, S.pages.length - 1); renderPages(); refreshAll(); toast('Undid: ' + h.label); return true;
}

function contentEls() { return $$('#pages .page .content'); }
function pageEl(i) { return $$('#pages .page')[i]; }
function isOverflow(c) { return c.scrollHeight > c.clientHeight + 2; }

function syncPagesFromDom() {
  const cs = contentEls();
  if (cs.length !== S.pages.length) return;
  cs.forEach((c, i) => {
    $$('.sel', c).forEach(e => e.classList.remove('sel'));
    // A Grid book block's shrink-to-fit scale is redone on every screen and export
    // (fitGridBlocks); saving it made a just-opened book look changed and sync again.
    S.pages[i].html = c.innerHTML.replace(/(<div class="grid-block" contenteditable="false") style="[^"]*"/g, '$1');
  });
}

function pageGeomPx(i) {
  const { w, h } = trimWH(); const m = S.margins; const recto = i % 2 === 0;
  return {
    w: w * IN, h: h * IN, top: m.top * IN, bottom: m.bottom * IN,
    left: (recto ? m.inside : m.outside) * IN, right: (recto ? m.outside : m.inside) * IN, recto
  };
}

function bleedInsideIn() { return S.bleed && PUBLISHERS[S.pub].bleedRule === 'all' ? 0.125 : 0; }
function placeBleed(el, recto, b) {
  const bi = bleedInsideIn() * IN;
  el.style.top = -b + 'px'; el.style.bottom = -b + 'px';
  if (recto) { el.style.left = -bi + 'px'; el.style.right = -b + 'px'; } else { el.style.left = -b + 'px'; el.style.right = -bi + 'px'; }
}
function buildPageNode(i, forExport) {
  const p = S.pages[i]; const g = pageGeomPx(i); const b = bleedIn() * IN;
  const el = document.createElement('div');
  el.className = 'page' + (g.recto ? ' recto' : ' verso');
  el.dataset.id = p.id;
  el.style.width = g.w + 'px'; el.style.height = g.h + 'px';
  // Background (extends into bleed on the outside, top and bottom edges)
  if (p.bg) {
    const bg = document.createElement('div'); bg.className = 'page-bg';
    placeBleed(bg, g.recto, b);
    bg.style.backgroundImage = `url("${p.bg}")`;
    el.appendChild(bg);
  }
  if (!forExport) {
    if (S.bleed) {
      const bl = document.createElement('div'); bl.className = 'bleedline';
      placeBleed(bl, g.recto, b);
      el.appendChild(bl);
    }
    const sl = document.createElement('div'); sl.className = 'safeline';
    Object.assign(sl.style, { top: g.top + 'px', bottom: g.bottom + 'px', left: g.left + 'px', right: g.right + 'px' });
    el.appendChild(sl);
    const tag = document.createElement('div'); tag.className = 'tag';
    tag.innerHTML = `<span>Page ${i + 1} · ${g.recto ? 'right' : 'left'}</span><span class="of" hidden>Content overflows: use Reflow</span>`;
    el.appendChild(tag);
  }
  const c = document.createElement('div'); c.className = 'content';
  if (!forExport) { c.contentEditable = 'true'; c.spellcheck = true; }
  Object.assign(c.style, { top: g.top + 'px', bottom: g.bottom + 'px', left: g.left + 'px', right: g.right + 'px' });
  c.innerHTML = p.html;
  el.appendChild(c);
  const num = i + 1;
  if (S.folio.on && num >= S.folio.start && !p.noFolio) {
    const f = document.createElement('div'); f.className = 'folio'; f.textContent = num;
    f.style.bottom = Math.max(g.bottom / 2 - 8, 8) + 'px';
    if (S.folio.pos === 'center') { f.style.left = '0'; f.style.right = '0'; f.style.textAlign = 'center'; }
    else if (g.recto) { f.style.right = g.right + 'px'; } else { f.style.left = g.left + 'px'; }
    el.appendChild(f);
  }
  // A player's puzzle (playerpuzzles.js): "Puzzle by <screen name>" at the foot
  // of the page, when it is on for this puzzle and for the book.
  const credit = pageCredit(p);
  if (credit) {
    const c = document.createElement('div'); c.className = 'page-credit'; c.textContent = credit;
    c.style.bottom = Math.max(g.bottom / 2 - 8, 8) + 'px';
    // Opposite the page number: centered, or on the outside edge when the number is centered.
    if (S.folio.on && S.folio.pos === 'center') { if (g.recto) c.style.right = g.right + 'px'; else c.style.left = g.left + 'px'; }
    else { c.style.left = g.left + 'px'; c.style.right = g.right + 'px'; c.style.textAlign = 'center'; }
    el.appendChild(c);
  }
  return el;
}
function pageCredit(p) {
  if (!p || !p.player || !p.player.credit || p.player.show === false || S.playerCredits === false) return '';
  return 'Puzzle by ' + String(p.player.credit).slice(0, 60);
}

function applyBookVars(root) {
  root.style.setProperty('--book-font', fontStack(S.body.font));
  root.style.setProperty('--book-size', S.body.size + 'pt');
  root.style.setProperty('--book-lh', S.body.lh);
}

function renderPages() {
  const host = $('#pages'); host.innerHTML = '';
  applyBookVars(host); applyGridCss();
  host.style.zoom = zoom;
  S.pages.forEach((p, i) => host.appendChild(buildPageNode(i)));
  setActivePage(clamp(curPage, 0, S.pages.length - 1), false);
  requestAnimationFrame(checkAllOverflow);
  renderPageList();
}

function checkAllOverflow() { fitGridBlocks($('#pages')); $$('#pages .page').forEach(checkPageOverflow); renderPageList(); }
function checkPageOverflow(pg) {
  const c = $('.content', pg); if (!c) return false;
  const o = isOverflow(c); pg.classList.toggle('overflow', o);
  const of = $('.tag .of', pg); if (of) of.hidden = !o;
  return o;
}

function pageLabel(p) {
  const d = document.createElement('div'); d.innerHTML = p.html;
  const h = d.querySelector('h1,h2,h3'); const pz = d.querySelector('.puzzle');
  if (h && h.textContent.trim()) return h.textContent.trim();
  if (pz) return pz.dataset.kind === 'sudoku' ? 'Sudoku' : pz.dataset.kind === 'wordsearch' ? 'Word search' : 'Maze';
  if (d.querySelector('img')) return 'Image';
  const t = d.textContent.trim(); return t ? t.slice(0, 40) : 'Blank';
}
function renderPageList() {
  const list = $('#pagelist'); const pgs = $$('#pages .page');
  list.innerHTML = `<div class="pagelist-head"><span>${S.pages.length} pages</span><button class="btn ghost" id="plAdd" title="Add page">+ Add</button></div>`;
  S.pages.forEach((p, i) => {
    const it = document.createElement('div'); it.className = 'pl-item' + (i === curPage ? ' active' : ''); it.tabIndex = 0;
    const lines = Math.min(6, Math.ceil((p.html || '').length / 200));
    const thumb = `<div class="pl-thumb">${Array.from({ length: lines }, (_, k) => `<i style="top:${7 + k * 6}px"></i>`).join('')}</div>`;
    const of = pgs[i] && pgs[i].classList.contains('overflow');
    it.innerHTML = `${thumb}<div class="pl-meta"><b>${i + 1}</b><span>${esc(pageLabel(p))}</span></div>${of ? '<i class="pl-flag" title="Overflowing"></i>' : ''}`;
    it.onclick = () => { setActivePage(i, true); };
    it.onkeydown = e => { if (e.key === 'Enter') setActivePage(i, true); };
    list.appendChild(it);
  });
  $('#plAdd').onclick = () => addPageAfter(curPage);
}

// The author credit switches show only on a player's puzzle page.
function refreshCreditTools() {
  const box = $('#pgCreditBox'); if (!box) return;
  const p = S.pages[curPage]; const pl = p && p.player;
  box.hidden = !pl;
  if (!pl) return;
  $('#pgCredit').checked = !!pl.credit && pl.show !== false; $('#pgCredit').disabled = !pl.credit;
  $('#pgCreditBook').checked = S.playerCredits !== false;
  $('#pgCreditName').textContent = pl.credit ? `“Puzzle by ${pl.credit}” at the foot of the page.` : 'The author chose to stay anonymous, so this puzzle has no credit.';
}
function setActivePage(i, scroll) {
  curPage = clamp(i, 0, S.pages.length - 1);
  $$('#pages .page').forEach((p, k) => p.classList.toggle('active', k === curPage));
  $$('#pagelist .pl-item').forEach((p, k) => p.classList.toggle('active', k === curPage));
  const p = S.pages[curPage]; if (p) $('#pgNoFolio').checked = !!p.noFolio;
  refreshCreditTools();
  if (scroll) { const el = pageEl(curPage); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}

function addPageAfter(i, html = '<p><br></p>', extra = {}) {
  snapshot('add page'); syncPagesFromDom();
  S.pages.splice(i + 1, 0, { id: uid(), html, ...extra });
  curPage = i + 1; renderPages(); setActivePage(curPage, true); refreshAll(); markDirty();
}

/* Reflow: move overflowing blocks onto the next page of the same text flow, adding pages as needed */
function splitTextBlock(el, c) {
  // Split a text-only block so that the first part fits. Returns the remainder element or null.
  if (![...el.childNodes].every(n => n.nodeType === 3 || (n.nodeType === 1 && ['B', 'I', 'EM', 'STRONG', 'SPAN', 'U', 'BR'].includes(n.tagName) && !n.children.length))) return null;
  const words = el.textContent.split(/(\s+)/);
  if (words.length < 6) return null;
  const orig = el.innerHTML;
  let lo = 0, hi = words.length, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.textContent = words.slice(0, mid).join('');
    if (!isOverflow(c)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 2) { el.innerHTML = orig; return null; }
  el.textContent = words.slice(0, best).join('').trimEnd();
  const rest = el.cloneNode(false); rest.textContent = words.slice(best).join('').trimStart();
  return rest;
}

function reflow(fromIdx = 0, quiet = false) {
  syncPagesFromDom();
  let added = 0, guard = 0;
  for (let i = fromIdx; i < S.pages.length && guard < 4000; i++, guard++) {
    const pg = pageEl(i); if (!pg) break;
    const c = $('.content', pg);
    if (!isOverflow(c)) continue;
    const moved = [];
    while (isOverflow(c) && c.childNodes.length > 1) {
      const last = c.lastChild; moved.unshift(last); last.remove();
      if (!isOverflow(c)) {
        // try to put back part of a long paragraph
        c.appendChild(last); moved.shift();
        const rest = splitTextBlock(last, c);
        if (rest) { moved.unshift(rest); } else { last.remove(); moved.unshift(last); }
        break;
      }
    }
    if (c.childNodes.length === 1 && isOverflow(c) && !moved.length) {
      const rest = splitTextBlock(c.firstChild, c); if (rest) moved.unshift(rest);
    }
    if (!moved.length) continue;
    S.pages[i].html = c.innerHTML;
    const flow = S.pages[i].flow || (S.pages[i].flow = uid());
    let next = S.pages[i + 1];
    if (!next || next.flow !== flow) {
      next = { id: uid(), html: '', flow };
      S.pages.splice(i + 1, 0, next); added++;
      const node = buildPageNode(i + 1); pg.after(node);
      // re-render geometry for following pages (recto/verso swap)
    }
    const nc = $('.content', pageEl(i + 1));
    const frag = document.createDocumentFragment(); moved.forEach(n => frag.appendChild(n));
    nc.insertBefore(frag, nc.firstChild);
    S.pages[i + 1].html = nc.innerHTML;
  }
  syncPagesFromDom();
  renderPages(); refreshAll(); markDirty();
  if (!quiet) toast(added ? `Reflowed text onto ${added} new page${added > 1 ? 's' : ''}` : 'Pages reflowed');
  return added;
}

/* ---------- Toolbar ---------- */
function saveSel() {
  const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); const c = r.commonAncestorContainer;
  const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
  if (host) savedRange = r.cloneRange();
}
function restoreSel() {
  if (!savedRange) return false;
  const c = savedRange.commonAncestorContainer; const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
  if (!host || !document.contains(host)) { savedRange = null; return false; }
  host.focus({ preventScroll: true });
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); return true;
}
function currentContent() { return $('.content', pageEl(curPage)); }
function insertHTMLAtCursor(html) {
  if (!restoreSel()) {
    const c = currentContent(); c.focus({ preventScroll: true });
    const r = document.createRange(); r.selectNodeContents(c); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  document.execCommand('insertHTML', false, html);
  afterEdit();
}
function exec(cmd, val = null) {
  if (cmd === 'undo' && lastStructAt > lastTypeAt && undoStack.length) { undoStructural(); return; }
  restoreSel();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, val);
  afterEdit();
}
function afterEdit() {
  lastTypeAt = Date.now();
  const pg = pageEl(curPage); if (pg) checkPageOverflow(pg);
  markDirty(); updateToolbarState();
}
function updateToolbarState() {
  ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'].forEach(c => {
    const b = $(`.tb[data-cmd="${c}"]`); if (b) { let on = false; try { on = document.queryCommandState(c); } catch (e) { } b.classList.toggle('on', on); }
  });
}
function applyFontSizePt(pt) {
  restoreSel(); document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '7');
  const c = currentContent();
  $$('#pages .content span, #pages .content font').forEach(el => {
    if (el.style.fontSize === 'xxx-large' || el.style.fontSize === '-webkit-xxx-large' || el.getAttribute('size') === '7') {
      el.removeAttribute('size'); el.style.fontSize = pt + 'pt';
    }
  });
  afterEdit();
}
function applyLineHeight(v) {
  restoreSel(); const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); const c = currentContent();
  [...c.children].filter(ch => r.intersectsNode(ch)).forEach(ch => ch.style.lineHeight = v);
  afterEdit();
}

function wireEditor() {
  const fam = $('#fontFam'), bf = $('#bodyFont');
  fam.innerHTML = '<option value="">Font</option>' + BOOK_FONTS.map(f => `<option value="${f}" style="font-family:${fontStack(f).replace(/"/g, "'")}">${f}</option>`).join('');
  bf.innerHTML = BOOK_FONTS.map(f => `<option value="${f}">${f}</option>`).join('');
  $('#fontSize').innerHTML = '<option value="">Size</option>' + [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72].map(s => `<option value="${s}">${s} pt</option>`).join('');

  $('#tb').addEventListener('mousedown', e => { if (e.target.closest('.tb') && !e.target.closest('input')) e.preventDefault(); });
  $$('.tb[data-cmd]').forEach(b => b.onclick = () => exec(b.dataset.cmd));
  fam.onchange = () => { if (fam.value) exec('fontName', fam.value); fam.value = ''; };
  $('#fontSize').onchange = e => { if (e.target.value) applyFontSizePt(+e.target.value); e.target.value = ''; };
  $('#blockFmt').onchange = e => { exec('formatBlock', e.target.value); };
  $('#lineH').onchange = e => { if (e.target.value) applyLineHeight(e.target.value); e.target.value = ''; };
  $('#foreColor').oninput = e => exec('foreColor', e.target.value);
  $('#hiliteColor').oninput = e => exec('hiliteColor', e.target.value);

  document.addEventListener('selectionchange', () => { saveSel(); updateToolbarState(); });
  const pagesEl = $('#pages');
  pagesEl.addEventListener('focusin', e => { const pg = e.target.closest('.page'); if (pg) setActivePage($$('#pages .page').indexOf(pg), false); });
  pagesEl.addEventListener('mousedown', e => { const pg = e.target.closest('.page'); if (pg) { const i = $$('#pages .page').indexOf(pg); if (i !== curPage) setActivePage(i, false); } });
  pagesEl.addEventListener('input', e => { lastTypeAt = Date.now(); const pg = e.target.closest('.page'); if (pg) checkPageOverflow(pg); markDirty(); });
  pagesEl.addEventListener('click', e => {
    $$('#pages .sel').forEach(x => x.classList.remove('sel'));
    selImg = null; selPuzzle = null;
    const img = e.target.closest('.content img'); const pz = e.target.closest('.content .puzzle') || e.target.closest('.content .grid-room');
    if (pz) { selPuzzle = pz; pz.classList.add('sel'); }
    else if (img) { selImg = img; img.classList.add('sel'); }
    showSelTools();
  });
  pagesEl.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && ((selPuzzle && selPuzzle.classList.contains('puzzle')) || selImg) && document.activeElement.closest('.content')) {
      e.preventDefault(); (selPuzzle || selImg).remove(); selPuzzle = selImg = null; showSelTools(); afterEdit();
    }
  });
  pagesEl.addEventListener('paste', e => {
    // Images pasted from the clipboard go in as data URLs; HTML is cleaned.
    const items = [...(e.clipboardData?.items || [])];
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault(); const f = imgItem.getAsFile();
      fileToDataURL(f).then(u => insertHTMLAtCursor(`<img src="${u}" alt="">`));
      return;
    }
    const html = e.clipboardData?.getData('text/html');
    if (html) { e.preventDefault(); insertHTMLAtCursor(sanitizeHTML(html)); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !$('#view-manuscript').hidden) { e.preventDefault(); openDlg('#dlgFind'); $('#findQ').focus(); }
  });

  $('#zoom').onchange = e => { zoom = +e.target.value; $('#pages').style.zoom = zoom; };
  $('#guidesBtn').onclick = () => { $('#desk').classList.toggle('hide-guides'); $('#guidesBtn').classList.toggle('on', !$('#desk').classList.contains('hide-guides')); };
  $('#guidesBtn').classList.add('on');
  $('#inspToggle').onclick = () => $('#workspace').classList.toggle('show-insp');
  $('#addPage').onclick = () => addPageAfter(curPage);
  $('#reflowBtn').onclick = () => { snapshot('reflow'); reflow(0); };
  $('#pgDup').onclick = () => { syncPagesFromDom(); const p = S.pages[curPage]; addPageAfter(curPage, p.html, { bg: p.bg, noFolio: p.noFolio }); };
  $('#pgDel').onclick = () => {
    if (S.pages.length <= 1) { toast('A book needs at least one page'); return; }
    snapshot('delete page'); S.pages.splice(curPage, 1); curPage = Math.max(0, curPage - 1); renderPages(); refreshAll(); markDirty();
    toast('Page deleted. Use Undo to bring it back.');
  };
  $('#pgUp').onclick = () => movePage(-1); $('#pgDown').onclick = () => movePage(1);
  $('#pgNoFolio').onchange = e => { syncPagesFromDom(); S.pages[curPage].noFolio = e.target.checked; renderPages(); markDirty(); };
  $('#pgBgImg').onclick = () => pickImage(async u => { syncPagesFromDom(); S.pages[curPage].bg = u; renderPages(); markDirty(); });
  $('#pgBgClear').onclick = () => { syncPagesFromDom(); delete S.pages[curPage].bg; renderPages(); markDirty(); };
  $('#insImage').onclick = () => pickImage(u => insertHTMLAtCursor(`<img src="${u}" alt="">`));
  $('#insTable').onclick = () => openDlg('#dlgTable');
  $('#tblGo').onclick = () => {
    const r = clamp(+$('#tblRows').value || 1, 1, 40), c = clamp(+$('#tblCols').value || 1, 1, 40), sq = $('#tblSquare').checked;
    const cw = sq ? `width:${Math.min(0.5, 5.5 / c).toFixed(3)}in;height:${Math.min(0.5, 5.5 / c).toFixed(3)}in;` : 'min-width:0.6in;';
    const html = `<table>${Array.from({ length: r }, () => `<tr>${Array.from({ length: c }, () => `<td style="${cw}">&nbsp;</td>`).join('')}</tr>`).join('')}</table><p><br></p>`;
    closeDlg('#dlgTable'); insertHTMLAtCursor(html);
  };

  // Inspector: margins, body text, folios
  const mIds = { mTop: 'top', mBottom: 'bottom', mInside: 'inside', mOutside: 'outside' };
  Object.entries(mIds).forEach(([id, k]) => $('#' + id).onchange = e => { syncPagesFromDom(); S.margins[k] = Math.max(0, +e.target.value || 0); renderPages(); refreshAll(); markDirty(); });
  $('#bodyFont').onchange = e => { S.body.font = e.target.value; applyBookVars($('#pages')); requestAnimationFrame(checkAllOverflow); markDirty(); };
  $('#bodySize').onchange = e => { S.body.size = clamp(+e.target.value || 12, 6, 36); applyBookVars($('#pages')); requestAnimationFrame(checkAllOverflow); markDirty(); };
  $('#bodyLh').onchange = e => { S.body.lh = clamp(+e.target.value || 1.3, 1, 3); applyBookVars($('#pages')); requestAnimationFrame(checkAllOverflow); markDirty(); };
  // Author credit on a player's puzzle page (playerpuzzles.js).
  $('#pgCredit').onchange = e => {
    syncPagesFromDom(); const p = S.pages[curPage]; if (!p || !p.player) return;
    // Every page of the same puzzle follows (a puzzle can take two pages).
    S.pages.forEach(q => { if (q.player && q.player.id === p.player.id) q.player.show = e.target.checked; });
    renderPages(); markDirty();
  };
  $('#pgCreditBook').onchange = e => { syncPagesFromDom(); S.playerCredits = e.target.checked; renderPages(); markDirty(); };
  $('#folioOn').onchange = e => { syncPagesFromDom(); S.folio.on = e.target.checked; renderPages(); markDirty(); };
  $('#folioPos').onchange = e => { syncPagesFromDom(); S.folio.pos = e.target.value; renderPages(); markDirty(); };
  $('#folioStart').onchange = e => { syncPagesFromDom(); S.folio.start = Math.max(1, +e.target.value || 1); renderPages(); markDirty(); };

  // Image tools
  $('#imgW').oninput = e => { if (selImg) { selImg.style.width = e.target.value + '%'; selImg.style.maxWidth = '100%'; afterEdit(); } };
  $$('[data-img]').forEach(b => b.onclick = () => imageAction(b.dataset.img));
  $('#cropGo').onclick = () => { closeDlg('#dlgCrop'); bakeImage({ crop: { t: +$('#crT').value || 0, b: +$('#crB').value || 0, l: +$('#crL').value || 0, r: +$('#crR').value || 0 } }); };
  $('#pzSize').oninput = e => { if (selPuzzle) { setPuzzleSize(selPuzzle, +e.target.value); afterEdit(); } };
  $('#pzDel').onclick = () => { if (selPuzzle) { selPuzzle.remove(); selPuzzle = null; showSelTools(); afterEdit(); } };
  $('#pzRegen').onclick = () => { if (selPuzzle) regeneratePuzzle(selPuzzle); };

  // Find & replace
  $('#findBtn').onclick = () => { openDlg('#dlgFind'); $('#findQ').focus(); };
  $('#findCount').onclick = () => { const n = findReplace(false); $('#findInfo').textContent = n + ' match' + (n === 1 ? '' : 'es') + ' in the book'; };
  $('#findAll').onclick = () => { snapshot('replace all'); const n = findReplace(true); $('#findInfo').textContent = 'Replaced ' + n + ' match' + (n === 1 ? '' : 'es'); markDirty(); };
  $('#cleanBtn').onclick = () => { $('#cleanInfo').textContent = ''; openDlg('#dlgClean'); };
  $('#cleanGo').onclick = () => {
    snapshot('auto-edit');
    const n = autoEditText({ quotes: $('#ceQuotes').checked, dashes: $('#ceDashes').checked, ellipsis: $('#ceEllipsis').checked, spaces: $('#ceSpaces').checked, empty: $('#ceEmpty').checked, fonts: $('#ceFonts').checked, heads: $('#ceHeads').checked });
    $('#cleanInfo').textContent = n ? `Made ${n} change${n > 1 ? 's' : ''}.` : 'Nothing needed changing.';
  };
}

function movePage(d) {
  const j = curPage + d; if (j < 0 || j >= S.pages.length) return;
  snapshot('move page'); syncPagesFromDom();
  const [p] = S.pages.splice(curPage, 1); S.pages.splice(j, 0, p); curPage = j; renderPages(); setActivePage(j, true); refreshAll(); markDirty();
}

function showSelTools() {
  // A Grid book puzzle (.grid-room) is a fixed block: it takes a theme, nothing else.
  const own = !!selPuzzle && selPuzzle.classList.contains('puzzle');
  $('#imgTools').hidden = !selImg; $('#pzTools').hidden = !own; showThemeTools();
  if (selImg) {
    const w = selImg.style.width ? parseFloat(selImg.style.width) : 100; $('#imgW').value = w;
    $('#imgBright').value = 100; $('#imgContrast').value = 100;
    const dpi = imageDpi(selImg); $('#imgDpi').textContent = dpi ? `Print resolution at this size: ${dpi} DPI${dpi < 300 ? ' (below the 300 DPI print standard)' : ''}` : '';
    if (window.innerWidth <= 1100) $('#workspace').classList.add('show-insp');
  }
  if (own) $('#pzSize').value = parseFloat(selPuzzle.dataset.size || 5);
  if (selPuzzle && window.innerWidth <= 1100) $('#workspace').classList.add('show-insp');
}
function imageDpi(img) {
  if (!img.naturalWidth) return 0;
  const wIn = img.offsetWidth / IN; return wIn ? Math.round(img.naturalWidth / wIn) : 0;
}
function imageAction(a) {
  if (a === 'pagebg' && selImg) { syncPagesFromDom(); S.pages[curPage].bg = selImg.src; selImg.remove(); selImg = null; syncPagesFromDom(); renderPages(); markDirty(); showSelTools(); return; }
  if (!selImg) return;
  if (a === 'delete') { selImg.remove(); selImg = null; showSelTools(); afterEdit(); return; }
  if (a === 'left' || a === 'right') { selImg.style.float = a; selImg.style.margin = a === 'left' ? '0 .15in .1in 0' : '0 0 .1in .15in'; selImg.style.width = selImg.style.width || '45%'; afterEdit(); return; }
  if (a === 'center') { selImg.style.float = ''; selImg.style.margin = ''; afterEdit(); return; }
  if (a === 'crop') { openDlg('#dlgCrop'); return; }
  if (a === 'rotate') return bakeImage({ rotate: 90 });
  if (a === 'flip') return bakeImage({ flip: true });
  if (a === 'gray') return bakeImage({ gray: true });
  if (a === 'apply') return bakeImage({ bright: +$('#imgBright').value, contrast: +$('#imgContrast').value });
}
function bakeImage(o) {
  const img = selImg; if (!img) return;
  const src = new Image(); src.onload = () => {
    let sw = src.naturalWidth, sh = src.naturalHeight, sx = 0, sy = 0;
    if (o.crop) { sx = sw * o.crop.l / 100; sy = sh * o.crop.t / 100; sw = sw * (1 - (o.crop.l + o.crop.r) / 100); sh = sh * (1 - (o.crop.t + o.crop.b) / 100); }
    const rot = o.rotate === 90; const cv = document.createElement('canvas');
    cv.width = rot ? sh : sw; cv.height = rot ? sw : sh; const ctx = cv.getContext('2d');
    const f = []; if (o.gray) f.push('grayscale(1)'); if (o.bright && o.bright !== 100) f.push(`brightness(${o.bright}%)`); if (o.contrast && o.contrast !== 100) f.push(`contrast(${o.contrast}%)`);
    ctx.filter = f.join(' ') || 'none';
    ctx.translate(cv.width / 2, cv.height / 2); if (rot) ctx.rotate(Math.PI / 2); if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    const jpeg = /^data:image\/jpe?g/.test(img.src);
    img.src = jpeg ? cv.toDataURL('image/jpeg', 0.93) : cv.toDataURL('image/png');
    afterEdit(); setTimeout(showSelTools, 50);
  };
  src.src = img.src;
}

function findReplace(doReplace) {
  const q = $('#findQ').value; if (!q) return 0;
  const r = $('#findR').value; const flags = $('#findCase').checked ? 'g' : 'gi';
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  let n = 0;
  contentEls().forEach(c => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.puzzle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(t => { const m = t.nodeValue.match(re); if (m) { n += m.length; if (doReplace) t.nodeValue = t.nodeValue.replace(re, r); } });
  });
  if (doReplace) { syncPagesFromDom(); checkAllOverflow(); }
  return n;
}

function titleCase(s) {
  const small = /^(a|an|and|as|at|but|by|for|in|nor|of|on|or|the|to|up|vs?)$/i;
  return s.replace(/\S+/g, (w, i) => (i > 0 && small.test(w)) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1));
}
function autoEditText(o) {
  let n = 0;
  contentEls().forEach(c => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.puzzle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(t => {
      let v = t.nodeValue; const before = v;
      if (o.spaces) v = v.replace(/[ \t ]{2,}/g, ' ');
      if (o.dashes) v = v.replace(/\s?---?\s?/g, '—');
      if (o.ellipsis) v = v.replace(/\.\s?\.\s?\./g, '…');
      if (o.quotes) {
        v = v.replace(/(^|[\s(\[{—-])"/g, '$1“').replace(/"/g, '”')
          .replace(/(^|[\s(\[{—-])'/g, '$1‘').replace(/'/g, '’');
      }
      if (v !== before) { t.nodeValue = v; n++; }
    });
    if (o.spaces) $$('p,h1,h2,h3,li', c).forEach(el => {
      const f = el.firstChild, l = el.lastChild;
      if (f && f.nodeType === 3 && /^\s+\S/.test(f.nodeValue)) { f.nodeValue = f.nodeValue.replace(/^\s+/, ''); n++; }
      if (l && l.nodeType === 3 && /\S\s+$/.test(l.nodeValue)) { l.nodeValue = l.nodeValue.replace(/\s+$/, ''); n++; }
    });
    if (o.empty) {
      const ps = $$('p', c).filter(p => !p.textContent.trim() && !p.querySelector('img,table,.puzzle,br+br'));
      // keep a single empty paragraph on otherwise empty pages so they stay editable
      ps.forEach(p => { if (c.children.length > 1 && p.previousElementSibling && (!p.previousElementSibling.textContent.trim() && p.previousElementSibling.tagName === 'P')) { p.remove(); n++; } });
    }
    if (o.fonts) $$('[style]', c).forEach(el => { if (el.closest('.puzzle')) return; if (el.style.fontFamily) { el.style.fontFamily = ''; n++; } });
    if (o.fonts) $$('font[face]', c).forEach(el => { el.removeAttribute('face'); n++; });
    if (o.heads) $$('h1,h2,h3', c).forEach(h => { if (h.children.length === 0) { const t = titleCase(h.textContent); if (t !== h.textContent) { h.textContent = t; n++; } } });
  });
  syncPagesFromDom(); checkAllOverflow(); markDirty();
  return n;
}

/* Sanitize imported/pasted HTML with an allowlist: keep structure and basic
   formatting; unwrap unknown elements; drop scripts, embeds, forms and every
   attribute or URL that is not plainly safe. Parsing with DOMParser is inert. */
const SAFE_TAGS = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'SPAN', 'DIV',
  'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
  'COLGROUP', 'COL', 'IMG', 'A', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'FIGURE', 'FIGCAPTION', 'SMALL', 'MARK']);
const DROP_TAGS = 'script,style,meta,link,base,iframe,frame,frameset,object,embed,applet,noscript,template,title,head,svg,math,form,input,button,select,textarea,video,audio,source,track,canvas,portal';
const SAFE_ATTRS = new Set(['style', 'src', 'href', 'alt', 'title', 'colspan', 'rowspan', 'align', 'width', 'height', 'start', 'type']);
const safeUrl = (v, img) => {
  const u = String(v).replace(/[\u0000- \u007f-\u009f]/g, '');
  return img ? /^(data:image\/(png|jpe?g|gif|webp|bmp);|blob:|https?:)/i.test(u) : /^(https?:|mailto:|#)/i.test(u);
};
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  $$(DROP_TAGS, doc).forEach(e => e.remove());
  // Deepest first, so unwrapping never skips a node.
  $$('*', doc.body).reverse().forEach(el => {
    if (!SAFE_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (!SAFE_ATTRS.has(n)) el.removeAttribute(a.name);
      else if ((n === 'src' || n === 'href') && !safeUrl(a.value, el.tagName === 'IMG')) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A') { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
    if (el.style) {
      ['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'margin', 'padding', 'background', 'background-color', 'background-image', 'font-family', 'font-size', 'line-height'].forEach(p => el.style.removeProperty(p));
      if (/url\s*\(|expression\s*\(/i.test(el.getAttribute('style') || '')) el.removeAttribute('style');
    }
  });
  $$('div,section,article,main,header,footer', doc.body).reverse().forEach(el => {
    if (!el.querySelector('p,div,h1,h2,h3,h4,ul,ol,table,img')) { const p = doc.createElement('p'); p.append(...el.childNodes); el.replaceWith(p); }
  });
  $$('h4,h5,h6', doc.body).forEach(h => { const n = doc.createElement('h3'); n.append(...h.childNodes); h.replaceWith(n); });
  return doc.body.innerHTML;
}

function refreshInspector() {
  $('#mTop').value = S.margins.top; $('#mBottom').value = S.margins.bottom; $('#mInside').value = S.margins.inside; $('#mOutside').value = S.margins.outside;
  const mm = PUBLISHERS[S.pub].minMargins(pageCount(), S.bleed);
  $('#marginHint').textContent = `${PUBLISHERS[S.pub].short} minimum for ${pageCount()} pages: inside ${mm.inside} in, outside ${mm.outside} in, top/bottom ${mm.top} in.`;
  $('#bodyFont').value = S.body.font; $('#bodySize').value = S.body.size; $('#bodyLh').value = S.body.lh;
  $('#folioOn').checked = S.folio.on; $('#folioPos').value = S.folio.pos; $('#folioStart').value = S.folio.start;
}

/* Dialog helpers */
function openDlg(sel) { const d = $(sel); if (!d.open) d.showModal(); }
function closeDlg(sel) { const d = $(sel); if (d.open) d.close(); }
document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });
