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
// They go in as a <style> element's textContent, which is never parsed as HTML.
function cleanGridCss(css) {
  return String(css || '').replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/url\s*\([^)]*\)/gi, 'none').slice(0, 400_000);
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
// The contents are laid out at the room's width, and wider when they must
// shrink, so a puzzle's story and clues rewrap into the space the shrinking
// makes instead of running off the page (as the Book maker's fitPages does).
function fitGridBlocks(root) {
  $$('.grid-room > .grid-block', root).forEach(b => {
    const room = b.parentElement; b.style.transform = ''; b.style.width = '';
    const w = room.clientWidth, h = room.clientHeight;
    const fit = b.firstElementChild;
    const size = () => [Math.max(b.scrollWidth, fit ? fit.scrollWidth : 0), b.scrollHeight];
    let [cw, ch] = size();
    if (!w || !h || !cw || !ch) return;
    let s = Math.min(1, w / cw, h / ch);
    for (let k = 0; k < 4 && s < 0.999; k++) {
      b.style.width = `${w / s}px`;
      [cw, ch] = size();
      const next = Math.max(0.1, Math.min(1, w / cw, h / ch));
      if (Math.abs(next - s) < 0.005) { s = Math.min(s, next); break; }
      s = next;
    }
    if (s < 0.999) {
      // Some boards grow with the space they get: measure once more at the final width.
      b.style.width = `${w / s}px`; [cw, ch] = size();
      s = Math.max(0.1, Math.min(s, w / cw, h / ch));
      b.style.width = `${w / s}px`; b.style.transform = `scale(${s.toFixed(4)})`;
    } else b.style.width = '';
  });
}

// A book from the Grid books tab: { title, subtitle, author, trim, paper, isbn,
// pages: [{ kind, head, body, front, fitAll }], css, coverSvg }.
async function importGridBook(g) {
  const p = blankProject();
  p.pub = PUBLISHERS[g.pub] ? g.pub : S.pub || 'kdp';
  const trim = String(g.trim || '6x9');
  p.trim = TRIMS[trim] ? trim : (PUBLISHERS[p.pub].defaultTrim || '6x9');
  p.paper = g.paper === 'cream' ? 'cream' : 'white';
  p.meta = { ...p.meta, title: String(g.title || '').slice(0, 200), subtitle: String(g.subtitle || '').slice(0, 200), author: String(g.author || '').slice(0, 120), copyright: String(g.author || '').slice(0, 120), isbn: String(g.isbn || '').slice(0, 20), pubDate: new Date().toISOString().slice(0, 10),
    ...(g.description ? { description: String(g.description).slice(0, 4000), blurb: String(g.description).slice(0, 4000) } : {}), ...(g.keywords ? { keywords: String(g.keywords).slice(0, 500) } : {}) };
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
  // Drawn as an image: an SVG shown as an <img> never runs scripts or loads anything.
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svg));
  const img = await new Promise((res, rej) => fabric.Image.fromURL(url, (o) => (o && o.width ? res(o) : rej(new Error('no image')))));
  const g = coverGeom();
  cv.clear(); cv.backgroundColor = '#ffffff';
  img.set({ left: 0, top: 0, scaleX: (g.W * IN) / img.width, scaleY: (g.H * IN) / img.height, selectable: false, evented: false });
  img.role = 'gridcover';
  cv.add(img); cv.requestRenderAll(); syncCoverToState();
}

/* Make the whole book for me (Grid books, Make it from a topic): open the
   book here, apply the publisher's specs, check every page and setting, and
   make the submission packet. Anything only the person can fix (an ISBN the
   publisher requires, say) stops it on the Publish tab with the list. */
async function submitGridBook(g, pub) {
  await importGridBook({ ...g, pub });
  await applyPublisher();
  const issues = await runChecks();
  const errors = issues.filter(i => i.sev === 'error');
  if (errors.length) {
    showTab('publish');
    toast(`Almost ready for ${PUBLISHERS[S.pub].short}: ${errors.length} thing${errors.length === 1 ? '' : 's'} to fix on the Publish tab, then Export the submission packet.`, 10000);
    return { ready: false, errors: errors.map(e => e.msg) };
  }
  await exportPacket();
  showTab('publish');
  return { ready: true };
}

