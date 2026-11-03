// The website's design on every page, and the admin dashboard's live preview
// and page editor.
//
// For visitors: applies the changes made in the dashboard's page editor (new
// words, hidden and moved elements), which the website build writes into the
// page as <script type="application/json" id="site-edits">.
//
// In the dashboard: the Website page shows a page of this site in a frame with
// ?design-preview and sends it the draft design; this applies it at once
// (colors, fonts, shapes, effects, words, page changes) without saving anything.
// With "Edit on the page" on, the frame also lets the admin pick any element,
// change its words in place, and drag it somewhere else; each change goes back
// to the dashboard as one step, and the dashboard saves the draft.
//
// Safety: only messages from the dashboard's own address (the game's Worker)
// are read, and while previewing the page takes no clicks, key presses or form
// sends, so a framed copy cannot be used to trick anyone into doing something.
import { CLOUD } from './cloud-config.js';
import { css, attributes, texts, applyEdits, pathOf, guardOf } from './site-design.js';

const root = document.documentElement;
const pageKey = () => root.dataset.page ?? location.pathname.replace(/^\/+/, '').replace(/(^|\/)index\.html$/, '$1');
const framed = window.top !== window.self;
const asked = new URLSearchParams(location.search).has('design-preview');
let admin = '';
try { admin = new URL(CLOUD.learnUrl || CLOUD.syncUrl).origin; } catch (e) { /* no Worker address: no preview */ }
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

if (framed && asked && (admin || local)) preview();
else visitor();

// ---------- visitors: the published page changes ----------
function visitor() {
  const data = document.getElementById('site-edits');
  const done = () => root.classList.add('edits-done');
  if (!data) { done(); return; }
  let steps = [];
  try { steps = JSON.parse(data.textContent); } catch (e) { /* a broken list changes nothing */ }
  const run = () => {
    try {
      const r = applyEdits(document, steps, pageKey());
      // Parts of a page drawn by its own scripts may come a little later: try those steps once more.
      if (r.missed.length) addEventListener('load', () => { try { applyEdits(document, r.missed, pageKey()); } catch (e) { /* skip */ } }, { once: true });
    } catch (e) { /* the page stays as built */ }
    done();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
}

// ---------- the dashboard's preview and page editor ----------
function preview() {
  const trusted = (origin) => origin === admin || (local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const target = local ? '*' : admin;
  const tell = (msg) => { try { parent.postMessage(msg, target); } catch (e) { /* none */ } };
  root.classList.add('design-preview', 'edits-done');

  let undoEdits = null;
  let editsKey = '';
  let lookKey = '';
  let steps = [];
  const origText = new WeakMap();
  let editMode = false;
  let sel = null;
  let hover = null;
  let editing = null;
  let press = null; // pointer down on the selected element: may become a drag
  let drag = null;

  // Runs fn on the page as it was built (page changes taken off), then puts them back.
  // Steps always name elements by their place in the page as built.
  // Words typed in place wait here until the dashboard sends the design back with them.
  const pending = new Map(); // element -> its words before the edit
  const withOriginal = (fn) => {
    if (undoEdits) undoEdits();
    const typed = [...pending.keys()].map((el) => [el, el.textContent]);
    for (const [el] of typed) el.textContent = origText.get(el) ?? el.textContent;
    try { return fn(); } finally {
      undoEdits = applyEdits(document, steps, pageKey(), { origText }).undo;
      for (const [el, t] of typed) el.textContent = t;
    }
  };
  const address = (el) => withOriginal(() => ({ t: pathOf(el), g: guardOf(el) }));

  const apply = (msg) => {
    const design = msg.design || {};
    let style = document.getElementById('site-design');
    if (!style) { style = document.createElement('style'); style.id = 'site-design'; document.head.append(style); }
    const nextCss = css(design);
    const attrs = attributes(design);
    const changedLook = JSON.stringify([nextCss, attrs]) !== lookKey;
    lookKey = JSON.stringify([nextCss, attrs]);
    style.textContent = nextCss;
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
    const words = texts(design);
    for (const el of document.querySelectorAll('[data-design-text]')) {
      const key = el.getAttribute('data-design-text');
      if (key in words && el.textContent !== words[key] && el !== editing?.el) el.textContent = words[key];
    }
    if (msg.look === 'light' || msg.look === 'dark') root.setAttribute('data-theme', msg.look);
    // The page changes: take the old ones off, put the new list on.
    const nextSteps = Array.isArray(design.edits) ? design.edits : [];
    const key = JSON.stringify(nextSteps.filter((s) => s && s.p === pageKey()));
    if (key !== editsKey && !editing) {
      if (undoEdits) undoEdits();
      for (const el of pending.keys()) el.textContent = origText.get(el) ?? el.textContent;
      pending.clear();
      steps = nextSteps;
      editsKey = key;
      undoEdits = applyEdits(document, steps, pageKey(), { origText }).undo;
    } else if (!editing) {
      // The dashboard did not keep the words (for example, no admin role): show the page as it was.
      for (const [el, before] of pending) el.textContent = before;
      pending.clear();
    }
    // Replay the opening animation so a changed choice shows straight away.
    if (changedLook && !editMode) for (const el of document.querySelectorAll('.hero, .card, .games')) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    setEditMode(!!msg.edit);
    if (sel && !sel.isConnected) select(null); else if (sel) report();
  };

  // ----- what the editor shows: hover and selection boxes, a label, the drop line
  const layer = document.createElement('div');
  layer.id = 'dz-layer';
  layer.setAttribute('aria-hidden', 'true');
  const box = (cls) => { const d = document.createElement('div'); d.className = cls; layer.append(d); return d; };
  const hoverBox = box('dz-box dz-hover');
  const selBox = box('dz-box dz-sel');
  const dropLine = box('dz-drop');
  const chip = box('dz-chip');
  const edStyle = document.createElement('style');
  edStyle.id = 'dz-style';
  edStyle.textContent = `
#dz-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}
#dz-layer .dz-box{position:fixed;display:none;border-radius:4px}
#dz-layer .dz-hover{outline:2px dashed #7C5CFF;outline-offset:1px}
#dz-layer .dz-sel{outline:3px solid #7C5CFF;outline-offset:1px;box-shadow:0 0 0 5px rgb(255 255 255 / .7)}
#dz-layer .dz-drop{position:fixed;display:none;background:#F5C451;box-shadow:0 0 0 2px #121729;border-radius:3px}
#dz-layer .dz-chip{position:fixed;display:none;gap:4px;align-items:center;background:#5B3CC4;color:#fff;border-radius:8px;padding:4px 4px 4px 10px;pointer-events:auto;box-shadow:0 4px 14px rgb(0 0 0 / .3);white-space:nowrap}
#dz-layer .dz-chip button{font:inherit;color:#121729;background:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer}
#dz-layer .dz-chip button:hover{background:#F5C451}
html.design-edit body, html.design-edit body *{cursor:default !important}
html.design-edit *::before, html.design-edit *::after{pointer-events:none !important}
html.design-edit [data-dz-sel]{cursor:grab !important;touch-action:none}
html.design-edit.dz-dragging, html.design-edit.dz-dragging *{cursor:grabbing !important;user-select:none !important}
html.design-edit [data-dz-sel][data-dz-dragged]{opacity:.45}
html.design-edit [contenteditable]{cursor:text !important;outline:3px solid #F5C451 !important;outline-offset:2px;background:rgb(245 196 81 / .12)}
html.design-edit [data-design-hidden]{display:none !important}`;

  const NAMES = { h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', p: 'Paragraph', a: 'Link', button: 'Button',
    img: 'Picture', svg: 'Picture', picture: 'Picture', section: 'Section', article: 'Card', li: 'List item', ul: 'List', ol: 'List', header: 'Header',
    footer: 'Footer', nav: 'Menu', main: 'Main area', span: 'Words', strong: 'Bold words', b: 'Bold words', em: 'Words', i: 'Words', small: 'Small words',
    label: 'Label', input: 'Box', form: 'Form', figure: 'Figure', figcaption: 'Caption', aside: 'Side box', details: 'Fold-out', summary: 'Fold-out title',
    table: 'Table', video: 'Video', blockquote: 'Quote', dl: 'List', dt: 'Term', dd: 'Description' };
  const nameOf = (el) => NAMES[el.localName] || (el.classList.contains('card') ? 'Card' : 'Box');
  const NOT_WORDS = new Set(['img', 'svg', 'input', 'textarea', 'select', 'video', 'iframe', 'canvas', 'picture']);
  const isWords = (el) => !!el && el.children.length === 0 && !NOT_WORDS.has(el.localName) && String(el.textContent).trim() !== '';
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript']);
  const shown = (el) => !SKIP.has(el.localName) && !el.hasAttribute('data-design-hidden') && getComputedStyle(el).display !== 'none';
  const sibling = (el, dir) => { let s = el; do { s = dir < 0 ? s.previousElementSibling : s.nextElementSibling; } while (s && !shown(s)); return s; };
  const pick = (t) => {
    let el = t && t.nodeType === 1 ? t : t?.parentElement;
    if (!el || layer.contains(el)) return null;
    while (el && el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg') el = el.parentElement; // a picture is one element
    return el && el !== document.body && el !== root && document.body.contains(el) ? el : null;
  };

  const place = (d, r, show) => {
    d.style.display = show ? 'block' : 'none';
    if (!show) return;
    d.style.left = `${r.left}px`; d.style.top = `${r.top}px`; d.style.width = `${Math.max(0, r.width)}px`; d.style.height = `${Math.max(0, r.height)}px`;
  };
  const draw = () => {
    if (!editMode) return;
    place(hoverBox, hover?.getBoundingClientRect(), !!hover && hover !== sel && !drag);
    const r = sel?.getBoundingClientRect();
    place(selBox, r, !!sel && !editing);
    if (sel && !editing && !drag) {
      chip.style.display = 'flex';
      const top = r.top > 40 ? r.top - 36 : Math.min(innerHeight - 36, r.bottom + 6);
      chip.style.top = `${Math.max(4, top)}px`;
      chip.style.left = `${Math.max(4, Math.min(innerWidth - chip.offsetWidth - 4, r.left))}px`;
    } else chip.style.display = 'none';
    requestAnimationFrame(draw);
  };

  function setEditMode(on) {
    if (on === editMode) return;
    editMode = on;
    root.classList.toggle('design-edit', on);
    if (on) {
      if (!edStyle.isConnected) document.head.append(edStyle);
      if (!layer.isConnected) root.append(layer); // outside <body>, so it is never part of the page
      requestAnimationFrame(draw);
    } else {
      if (editing) finishEdit(false);
      select(null);
      hover = null;
      layer.remove();
    }
  }

  function report() {
    if (!sel) { tell({ type: 'flg-design-select', sel: null }); return; }
    const where = address(sel);
    const crumbs = [];
    for (let n = sel; n && n !== document.body && crumbs.length < 6; n = n.parentElement) crumbs.push(nameOf(n));
    tell({ type: 'flg-design-select', sel: { ...where, page: pageKey(), name: nameOf(sel), words: isWords(sel) ? String(sel.textContent).replace(/\s+/g, ' ').trim() : '',
      key: sel.getAttribute('data-design-text') || '', crumbs, up: !!sibling(sel, -1), down: !!sibling(sel, 1), parent: sel.parentElement !== document.body } });
  }
  function select(el) {
    if (sel) sel.removeAttribute('data-dz-sel');
    sel = el;
    if (sel) sel.setAttribute('data-dz-sel', '');
    chip.innerHTML = '';
    if (sel) {
      const label = document.createElement('span');
      label.textContent = nameOf(sel);
      chip.append(label);
      const btn = (text, cmd) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.cmd = cmd; chip.append(b); };
      if (sel.parentElement !== document.body) btn('↑ Bigger', 'parent');
      if (isWords(sel)) btn('Edit words', 'edit');
    }
    report();
  }

  // ----- a step goes to the dashboard, which saves it and sends the design back
  const send = (op) => tell({ type: 'flg-design-op', op: { ...op, p: pageKey(), n: op.n || nameOf(sel) } });
  function move(el, to, at) {
    if (!to || to === el || el.contains(to)) return;
    const a = address(el);
    const b = address(to);
    send({ op: 'move', t: a.t, g: a.g, to: b.t, tg: b.g, at, n: nameOf(el) });
  }
  function hide(el) {
    const a = address(el);
    send({ op: 'hide', ...a, n: nameOf(el) });
    select(null);
  }

  // ----- words, changed in place
  function startEdit(el) {
    if (!isWords(el) || editing) return;
    const where = address(el);
    if (!origText.has(el)) origText.set(el, el.textContent);
    editing = { el, before: el.textContent, where, key: el.getAttribute('data-design-text') || '' };
    try { el.contentEditable = 'plaintext-only'; } catch (e) { /* older browsers */ }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.addEventListener('blur', () => finishEdit(true), { once: true });
    tell({ type: 'flg-design-editing', on: true });
  }
  function finishEdit(keep) {
    if (!editing) return;
    const { el, before, where, key } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    getSelection().removeAllRanges();
    const words = String(el.textContent).replace(/\s+/g, ' ').trim();
    if (!keep || !words || words === before.replace(/\s+/g, ' ').trim()) el.textContent = before;
    else {
      if (!key) pending.set(el, before);
      tell({ type: 'flg-design-op', op: { op: 'text', ...where, v: words, p: pageKey(), n: nameOf(el), key } });
    }
    tell({ type: 'flg-design-editing', on: false });
    report();
  }

  // ----- dragging an element to a new place
  function dropAt(x, y) {
    const t = document.elementFromPoint(x, y);
    let n = pick(t);
    if (!n) return null;
    // Over one of its own neighbours: change the order among them.
    let s = n;
    while (s && s !== document.body && s.parentElement !== drag.parentElement) s = s.parentElement;
    if (s && s !== document.body && s !== drag) n = s;
    else {
      while (n && n !== document.body && (drag.contains(n) || getComputedStyle(n).display.startsWith('inline'))) n = n.parentElement;
    }
    if (!n || n === document.body || n === drag || drag.contains(n) || !n.parentElement || n.parentElement === root) return null;
    const pd = getComputedStyle(n.parentElement);
    const across = (pd.display.includes('flex') && pd.flexDirection.startsWith('row')) || (pd.display.includes('grid') && pd.gridTemplateColumns.trim().split(/\s+/).length > 1) || getComputedStyle(n).display.startsWith('inline');
    const r = n.getBoundingClientRect();
    const at = across ? (x < r.left + r.width / 2 ? 'before' : 'after') : (y < r.top + r.height / 2 ? 'before' : 'after');
    if ((at === 'before' && sibling(drag, 1) === n) || (at === 'after' && sibling(drag, -1) === n)) return null; // where it already is
    return { n, at, across, r };
  }
  function showDrop(d) {
    if (!d) { dropLine.style.display = 'none'; return; }
    const { r, at, across } = d;
    dropLine.style.display = 'block';
    if (across) { dropLine.style.left = `${(at === 'before' ? r.left : r.right) - 2}px`; dropLine.style.top = `${r.top}px`; dropLine.style.width = '4px'; dropLine.style.height = `${r.height}px`; }
    else { dropLine.style.left = `${r.left}px`; dropLine.style.top = `${(at === 'before' ? r.top : r.bottom) - 2}px`; dropLine.style.width = `${r.width}px`; dropLine.style.height = '4px'; }
  }
  let scrollDir = 0;
  const autoScroll = () => { if (!drag || !scrollDir) return; scrollBy(0, scrollDir * 14); requestAnimationFrame(autoScroll); };

  // ----- events: the page itself takes none of them
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  for (const type of ['click', 'submit', 'auxclick', 'dragstart', 'contextmenu']) {
    addEventListener(type, (e) => {
      if (type === 'contextmenu' && !editMode) return;
      if (editing && editing.el.contains(e.target) && type === 'click') { e.stopPropagation(); return; }
      stop(e);
    }, true);
  }
  addEventListener('keydown', (e) => {
    if (editing) {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editing.el.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
      return;
    }
    stop(e);
    if (editMode && e.key === 'Escape') select(null);
  }, true);
  addEventListener('pointermove', (e) => {
    if (!editMode) return;
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      drag = sel;
      drag.setAttribute('data-dz-dragged', '');
      root.classList.add('dz-dragging');
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
    }
    if (drag) {
      e.preventDefault();
      press.drop = dropAt(e.clientX, e.clientY);
      showDrop(press.drop);
      const was = scrollDir;
      scrollDir = e.clientY < 48 ? -1 : e.clientY > innerHeight - 48 ? 1 : 0;
      if (scrollDir && !was) requestAnimationFrame(autoScroll);
      return;
    }
    if (!editing) hover = pick(e.target);
  }, true);
  addEventListener('pointerdown', (e) => {
    if (!editMode || e.button > 0) return;
    if (editing) { if (editing.el.contains(e.target)) { e.stopPropagation(); return; } editing.el.blur(); }
    const cmd = e.target.closest?.('#dz-layer button')?.dataset.cmd;
    stop(e);
    if (cmd) { command({ cmd }); return; }
    const el = pick(e.target);
    if (!el) { select(null); return; }
    // Inside the selected element: it stays selected so it can be dragged; a plain click picks the smaller element.
    if (sel && sel.contains(el)) press = { x: e.clientX, y: e.clientY, clickEl: el };
    else { select(el); press = { x: e.clientX, y: e.clientY }; }
  }, true);
  addEventListener('pointerup', (e) => {
    if (!editMode) return;
    if (drag) {
      e.preventDefault();
      const d = press?.drop;
      drag.removeAttribute('data-dz-dragged');
      root.classList.remove('dz-dragging');
      const moved = drag;
      drag = null;
      scrollDir = 0;
      showDrop(null);
      if (d) move(moved, d.n, d.at);
    } else if (press?.clickEl && press.clickEl !== sel) select(press.clickEl);
    press = null;
  }, true);
  addEventListener('pointercancel', () => { if (drag) { drag.removeAttribute('data-dz-dragged'); root.classList.remove('dz-dragging'); } drag = null; press = null; showDrop(null); }, true);
  addEventListener('dblclick', (e) => {
    if (!editMode) return;
    stop(e);
    const el = pick(e.target);
    if (el && isWords(el)) { if (el !== sel) select(el); startEdit(el); }
  }, true);

  // ----- buttons in the dashboard's editor panel
  function command(m) {
    if (!editMode) return;
    if (m.cmd === 'deselect') { if (editing) finishEdit(true); select(null); return; }
    if (!sel) return;
    if (m.cmd === 'parent' && sel.parentElement && sel.parentElement !== document.body) select(sel.parentElement);
    else if (m.cmd === 'crumb') { let n = sel; for (let i = 0; i < Number(m.n) && n.parentElement && n.parentElement !== document.body; i++) n = n.parentElement; select(n); }
    else if (m.cmd === 'edit') startEdit(sel);
    else if (m.cmd === 'up') move(sel, sibling(sel, -1), 'before');
    else if (m.cmd === 'down') move(sel, sibling(sel, 1), 'after');
    else if (m.cmd === 'hide') hide(sel);
    else if (m.cmd === 'words' && isWords(sel)) {
      const words = String(m.v || '').replace(/\s+/g, ' ').trim();
      if (!words) return;
      send({ op: 'text', ...address(sel), v: words, key: sel.getAttribute('data-design-text') || '' });
    } else if (m.cmd === 'show') sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  addEventListener('message', (e) => {
    if (!trusted(e.origin) || !e.data) return;
    if (e.data.type === 'flg-design') apply(e.data);
    else if (e.data.type === 'flg-design-cmd') command(e.data);
  });
  const hello = () => tell({ type: 'flg-design-ready', page: location.pathname, key: pageKey() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello); else hello();
}
