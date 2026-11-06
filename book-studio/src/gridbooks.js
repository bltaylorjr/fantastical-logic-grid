/* ---------- Grid books: books made from the game's own puzzles ----------
   The Grid books tab (Grid Admin build, auth.js) runs the dashboard's Books
   and covers (admin/books.js): the Book maker, saved books, cover templates
   and Mark as published. "Open in the editor" there hands a book to
   importGridBook(), which turns its pages into editor pages:
   - title, copyright, notes and other text pages stay editable;
   - puzzles, answer keys, contents and how-to-play pages are fixed blocks,
     shrunk to fit the page (each game's print styles come with the book);
   - the cover comes in as one picture on the cover canvas, to keep or redo. */

// Scripts, frames, forms and event attributes never come in; Book Studio's
// page policy (script-src 'self') is the second line.
const GRID_DROP = 'script,iframe,frame,object,embed,applet,link,meta,base,style,form,input,button,select,textarea,template,noscript,foreignObject,portal';
function sanitizeGridHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html');
  $$(GRID_DROP, doc).forEach(e => e.remove());
  $$('*', doc.body).forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase(); const v = a.value.replace(/[\u0000- \u007f-\u009f]/g, '');
      if (n.startsWith('on') || n === 'contenteditable' || n === 'srcdoc' || n === 'formaction' || n === 'action') el.removeAttribute(a.name);
      else if (/(^|:)href$|^src$|^xlink:href$/.test(n) && !/^(#|data:image\/(png|jpe?g|gif|webp);|https?:)/i.test(v)) el.removeAttribute(a.name);
      else if (n === 'style' && /url\s*\(|expression\s*\(/i.test(v)) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}
// Each game's print styles, already scoped to .bk-g-<game>: no outside fetches.
function cleanGridCss(css) {
  return String(css || '').replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/url\s*\([^)]*\)/gi, 'none').replace(/<\/?style/gi, '').slice(0, 400_000);
}
function applyGridCss() {
  let el = $('#gridBookCss');
  const css = S.gridCss || '';
  if (!css) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'gridBookCss'; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

// One page of a Grid book (from admin/books.js layout()) as editor HTML.
function gridPageHtml(pg) {
  const body = sanitizeGridHTML(pg.body || '');
  const head = pg.head ? `<div class="bk-head" contenteditable="false">${sanitizeGridHTML(pg.head)}</div>` : '';
  const block = (inner) => `<div class="grid-room"><div class="grid-block" contenteditable="false">${inner}</div></div>`;
  if (pg.kind === 'key') {
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
    const keys = $$('.bk-key', doc.body).map(k => {
      const h = k.querySelector('.bk-keyh'); const fit = k.querySelector('.bk-fit');
      return `<div class="grid-key">${h ? `<p class="bk-keyh">${h.innerHTML}</p>` : ''}${block(fit ? fit.outerHTML : '')}</div>`;
    });
    return `<div class="grid-page">${head}${keys.join('')}</div>`;
  }
  if (pg.kind === 'puzzle' || pg.fitAll) return `<div class="grid-page">${head}${block(pg.kind === 'puzzle' ? body : `<div class="bk-fit">${body}</div>`)}</div>`;
  return `<div class="grid-page grid-text">${head}${body}</div>`;
}

// Shrink each fixed block to its room (also before each page is drawn for export).
function fitGridBlocks(root) {
  $$('.grid-room > .grid-block', root).forEach(b => {
    const room = b.parentElement; b.style.transform = '';
    const w = room.clientWidth, h = room.clientHeight;
    const fit = b.firstElementChild;
    const cw = Math.max(b.scrollWidth, fit ? fit.scrollWidth : 0), ch = b.scrollHeight;
    if (!w || !h || !cw || !ch) return;
    const s = Math.min(1, w / cw, h / ch);
    if (s < 0.999) b.style.transform = `scale(${s.toFixed(4)})`;
  });
}

// A book from the Grid books tab: { title, subtitle, author, trim, paper, isbn,
// pages: [{ kind, head, body, front, fitAll }], css, coverSvg }.
async function importGridBook(g) {
  const p = blankProject();
  p.pub = S.pub || 'kdp';
  const trim = String(g.trim || '6x9');
  p.trim = TRIMS[trim] ? trim : (PUBLISHERS[p.pub].defaultTrim || '6x9');
  p.paper = g.paper === 'cream' ? 'cream' : 'white';
  p.meta = { ...p.meta, title: String(g.title || '').slice(0, 200), subtitle: String(g.subtitle || '').slice(0, 200), author: String(g.author || '').slice(0, 120), copyright: String(g.author || '').slice(0, 120), isbn: String(g.isbn || '').slice(0, 20), pubDate: new Date().toISOString().slice(0, 10) };
  p.gridCss = cleanGridCss(g.css);
  p.gridBook = String(g.id || '');
  p.pages = (g.pages || []).map(pg => ({ id: uid(), html: gridPageHtml(pg), grid: pg.kind, noFolio: !!pg.front, ...(pg.kind === 'answers' ? { answers: true } : {}) }));
  if (!p.pages.length) p.pages = [{ id: uid(), html: '<p><br></p>' }];
  p.cover = null;
  loadProject(p);
  showTab('manuscript');
  if (g.coverSvg) {
    try { await ensureCover(); await placeGridCover(g.coverSvg); } catch (e) { toast('The cover did not come in. Use Auto-design cover on the Cover tab.', 6000); }
  }
  markDirty();
  toast(`Opened “${p.meta.title || 'the book'}” from Grid books. Pick a publisher and press Apply specs.`, 6000);
}
async function placeGridCover(svg) {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svg).replace(/<script[\s\S]*?<\/script>/gi, ''));
  const img = await new Promise((res, rej) => fabric.Image.fromURL(url, (o) => (o && o.width ? res(o) : rej(new Error('no image')))));
  const g = coverGeom();
  cv.clear(); cv.backgroundColor = '#ffffff';
  img.set({ left: 0, top: 0, scaleX: (g.W * IN) / img.width, scaleY: (g.H * IN) / img.height, selectable: false, evented: false });
  img.role = 'bg';
  cv.add(img); cv.requestRenderAll(); syncCoverToState();
}
