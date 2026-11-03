// Website: customize thelogicgrid.com (server/src/site-design.js; the options
// are web/js/site-design.js, copied here as site-design.js).
// - Every option is one click: a dropdown, or a box for words.
// - Options are in categories you open one at a time; each shows how many
//   choices differ from the original design.
// - The preview shows the real website with your draft applied, live. Nothing
//   changes for visitors until Publish.
// - Edit on the page: pick any element in the preview, change its words in
//   place (double-click), drag it somewhere else, move it up or down, or hide
//   it (web/js/design-preview.js does this inside the preview). Each change is
//   one step in the draft, listed under "Changes on this page".
// - Open in a new window: the same editor in its own big window. Both windows
//   stay in step (BroadcastChannel), and either can publish.
// - Undo and Redo (also Ctrl+Z and Ctrl+Shift+Z), Reset for one option or a
//   whole category, Discard draft, and every earlier published version can
//   come back as a draft.
import { CATEGORIES, OPTIONS, PREVIEW_PAGES, EDIT_MAX, EDIT_TEXT_MAX, defaults, normalize, changes, countChanges, describeEdit, optionFor } from './site-design.js';

const $ = (s, el = document) => el.querySelector(s);
// Every word from the design is escaped before it goes into the page.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
export const isEditorWindow = params.has('editor');
let h = null; // helpers from admin.js
let view = null; // the last GET /admin/v1/site-design
let current = defaults(); // the design shown in the preview (draft or live)
let undo = [];
let redo = [];
let saveTimer = null;
let saving = Promise.resolve();
let previewPage = PREVIEW_PAGES.some((p) => p[0] === params.get('page')) ? params.get('page') : 'hub';
let look = 'light';
let size = 'desktop';
let openCat = CATEGORIES[0].id;
let editMode = isEditorWindow; // the editor window opens ready to edit
let selection = null; // what is picked in the preview (from design-preview.js)
let framePage = null; // the preview page's key, e.g. "" or "how-to-play/"
const UNDO_MAX = 100;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('flg-site-design') : null;

const same = (a, b) => JSON.stringify(changes(a)) === JSON.stringify(changes(b));
const live = () => normalize(view?.published?.design || {});
const editable = () => h.can('admin');
const siteOrigin = () => { try { return new URL(view.siteUrl).origin; } catch (e) { return ''; } };
const frameWin = () => $('#web-frame')?.contentWindow || null;
const pagePath = (id) => (PREVIEW_PAGES.find((p) => p[0] === id) || PREVIEW_PAGES[0])[2];
const frameSrc = () => `${view.siteUrl}/${pagePath(previewPage)}?design-preview`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function initWebsite(helpers) {
  h = helpers;
  addEventListener('message', (e) => {
    if (!view || e.origin !== siteOrigin() || !e.data || e.source !== frameWin()) return;
    const d = e.data;
    if (d.type === 'flg-design-ready') { framePage = typeof d.key === 'string' ? d.key : null; selection = null; sendPreview(); renderEditPanel(); return; }
    if (d.type === 'flg-design-select') { selection = d.sel && typeof d.sel === 'object' ? d.sel : null; renderEditPanel(); return; }
    if (d.type === 'flg-design-op') { addStep(d.op); return; }
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !$('#web-body') || $('[data-view="website"]').hidden) return;
    if (e.target.closest('input[type=text], textarea')) return; // the box's own undo
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
  });
  // The other window (dashboard tab or editor window) changed the draft or published.
  if (channel) {
    channel.onmessage = (e) => {
      if (!view || !e.data) return;
      if (e.data.type === 'reload') { if (!$('[data-view="website"]').hidden) websiteView(); return; }
      // A window that just opened asks for the draft as it is now (the last change may not be saved yet).
      if (e.data.type === 'hello') { if (undo.length || redo.length) share(); return; }
      if (e.data.type !== 'design') return;
      const n = normalize(e.data.design);
      if (same(n, current)) return;
      undo.push(current); if (undo.length > UNDO_MAX) undo.shift();
      redo = [];
      current = n;
      refreshMarks();
      sendPreview();
    };
  }
  if (isEditorWindow) document.title = 'Website editor · The Logic Grid Admin';
}

const share = () => channel?.postMessage({ type: 'design', design: changes(current) });

export async function websiteView() {
  view = await h.api('site-design');
  current = normalize(view.draft ? view.draft.design : view.published?.design || {});
  undo = [];
  redo = [];
  selection = null;
  render();
  channel?.postMessage({ type: 'hello' });
}

// ---------- drawing ----------
function control(o) {
  const id = `web-${o.key}`;
  const v = current[o.key];
  const dis = editable() ? '' : ' disabled';
  if (o.type === 'select') {
    return `<select id="${id}" data-key="${o.key}"${dis}>${o.choices.map((c) => `<option value="${esc(c.value)}"${c.value === v ? ' selected' : ''}>${esc(c.label)}${c.value === o.default ? ' (original)' : ''}</option>`).join('')}</select>`;
  }
  const common = `id="${id}" data-key="${o.key}" maxlength="${o.max}"${dis} aria-describedby="${id}-count"`;
  const box = o.type === 'textarea' ? `<textarea ${common} rows="3">${esc(v)}</textarea>` : `<input type="text" ${common} value="${esc(v)}">`;
  return `${box}<span class="web-count muted" id="${id}-count">${v.length} of ${o.max} characters</span>`;
}

function optionRow(o) {
  const changed = current[o.key] !== o.default;
  return `<div class="web-opt${changed ? ' changed' : ''}" data-opt="${o.key}">
    <div class="field"><label for="web-${o.key}">${esc(o.label)}</label>${control(o)}</div>
    <button class="btn small link web-reset" type="button" data-reset="${o.key}"${changed && editable() ? '' : ' hidden'} aria-label="Put ${esc(o.label)} back to the original">Original</button>
  </div>`;
}

function categoryHtml(c) {
  const n = c.options.filter((o) => current[o.key] !== o.default).length;
  return `<details class="web-cat" data-cat="${c.id}"${c.id === openCat && !editMode ? ' open' : ''}>
    <summary><span>${esc(c.name)}</span> <span class="badge${n ? ' warn' : ''}" data-cat-count="${c.id}">${n ? `${n} changed` : 'Original'}</span></summary>
    ${c.help ? `<p class="help">${esc(c.help)}</p>` : ''}
    ${c.options.map(optionRow).join('')}
    ${editable() ? `<p><button class="btn small" type="button" data-reset-cat="${c.id}">Put this group back to the original</button></p>` : ''}
  </details>`;
}

function statusHtml() {
  const draft = !same(current, live());
  const pending = countChanges(current);
  return `<div class="web-status" role="toolbar" aria-label="Website design">
    <p class="web-state" id="web-state">${draft ? '<span class="badge warn">Draft</span> Not live yet. Visitors see the published design until you press Publish.' : '<span class="badge ok">Live</span> The preview shows what visitors see.'}
      <span class="muted">${pending ? `${plural(pending, 'change')} from the original design.` : 'Original design.'}</span> <span class="muted" id="web-saved" aria-live="polite"></span></p>
    <div class="row">
      <button class="btn small" type="button" id="web-undo"${undo.length && editable() ? '' : ' disabled'}>Undo</button>
      <button class="btn small" type="button" id="web-redo"${redo.length && editable() ? '' : ' disabled'}>Redo</button>
      <button class="btn small" type="button" id="web-discard"${draft && editable() ? '' : ' disabled'}>Discard draft</button>
      <button class="btn small primary" type="button" id="web-publish"${draft && editable() ? '' : ' disabled'}>Publish</button>
      ${isEditorWindow ? '<button class="btn small" type="button" id="web-close">Close window</button>' : ''}
    </div>
  </div>`;
}

function previewHtml() {
  return `<div class="web-preview">
    <div class="row web-preview-bar">
      <div class="web-mode" role="radiogroup" aria-label="What the preview does">
        <label><input type="radio" name="web-mode" value="preview"${editMode ? '' : ' checked'}><span>Preview</span></label>
        <label><input type="radio" name="web-mode" value="edit"${editMode ? ' checked' : ''}${editable() ? '' : ' disabled'}><span>Edit on the page</span></label>
      </div>
      <div class="field inline"><label for="web-page">Page</label><select id="web-page">${PREVIEW_PAGES.map(([id, label]) => `<option value="${id}"${id === previewPage ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field inline"><label for="web-look">Look</label><select id="web-look"><option value="light"${look === 'light' ? ' selected' : ''}>Light</option><option value="dark"${look === 'dark' ? ' selected' : ''}>Dark</option></select></div>
      <div class="field inline"><label for="web-size">Size</label><select id="web-size"><option value="desktop"${size === 'desktop' ? ' selected' : ''}>Computer</option><option value="phone"${size === 'phone' ? ' selected' : ''}>Phone</option></select></div>
      ${isEditorWindow ? '' : '<button class="btn small" type="button" id="web-popout">Open in a new window</button>'}
    </div>
    <div class="web-frame-box${size === 'phone' ? ' phone' : ''}"><iframe id="web-frame" title="Preview of the website with your draft" src="${esc(frameSrc())}" loading="lazy"></iframe></div>
    <p class="muted web-preview-note" id="web-preview-note">${noteText()}</p>
  </div>`;
}

const noteText = () => (editMode
  ? '<b>Click</b> anything to pick it, and click inside it to pick something smaller. <b>Drag</b> a picked element to move it; a gold line shows where it lands. <b>Double-click</b> words to change them, then press Enter (Esc cancels). Links and buttons do not open while you edit.'
  : 'The preview takes no clicks. Choose <b>Edit on the page</b> to change words and move things on the page itself. Text and pictures inside the games and the daily puzzles are changed in their own sections.');

// The editor panel: what is picked, and the changes made on the page shown.
function editPanelHtml() {
  if (!editMode) return '';
  return `<div class="card web-edit" id="web-edit">${selHtml()}${stepsHtml()}</div>`;
}

function selHtml() {
  const s = selection;
  if (!s) {
    return `<div id="web-sel"><h2>Picked element</h2><p class="muted">Nothing picked yet. Click anything in the preview.</p>
      <ul class="web-tips muted"><li>Drag a picked element to move it.</li><li>Double-click words to change them.</li><li>"↑ Bigger" picks the box around it, to move a whole card or section.</li></ul></div>`;
  }
  const stepsHere = stepsFor(s);
  const crumbs = s.crumbs.slice().reverse().map((name, i, all) => {
    const up = all.length - 1 - i;
    return up === 0 ? `<b aria-current="true">${esc(name)}</b>` : `<button class="btn small link" type="button" data-crumb="${up}">${esc(name)}</button>`;
  }).join('<span aria-hidden="true"> › </span>');
  const dis = editable() ? '' : ' disabled';
  const words = s.words
    ? `<div class="field"><label for="web-sel-words">Words</label><textarea id="web-sel-words" rows="3" maxlength="${s.key ? optionFor(s.key)?.max || EDIT_TEXT_MAX : EDIT_TEXT_MAX}"${dis}>${esc(s.words)}</textarea></div>
       <div class="row"><button class="btn small" type="button" data-cmd="words"${dis}>Use these words</button><button class="btn small" type="button" data-cmd="edit"${dis}>Edit on the page</button></div>
       ${s.key ? `<p class="help">These words are also in the options below (${esc(optionFor(s.key)?.label || '')}).</p>` : ''}`
    : '<p class="help">This element holds other elements. Pick the words inside it to change them.</p>';
  return `<div id="web-sel"><h2>Picked: ${esc(s.name)}</h2>
    <p class="web-crumbs">${crumbs}</p>
    ${words}
    <div class="row web-sel-actions">
      <button class="btn small" type="button" data-cmd="up"${s.up && editable() ? '' : ' disabled'}>Move up</button>
      <button class="btn small" type="button" data-cmd="down"${s.down && editable() ? '' : ' disabled'}>Move down</button>
      <button class="btn small" type="button" data-cmd="parent"${s.parent ? '' : ' disabled'}>↑ Bigger</button>
      <button class="btn small" type="button" data-cmd="hide"${dis}>Hide</button>
      <button class="btn small" type="button" data-cmd="deselect">Done</button>
    </div>
    ${stepsHere.length && editable() ? `<p><button class="btn small" type="button" id="web-sel-reset">Put this element back as built (${plural(stepsHere.length, 'change')})</button></p>` : ''}
  </div>`;
}

const stepsFor = (s) => current.edits.filter((e) => e.p === s.page && e.t === s.t);

function stepsHtml() {
  const here = framePage === null ? [] : current.edits.map((e, i) => [e, i]).filter(([e]) => e.p === framePage);
  const elsewhere = current.edits.length - here.length;
  const rows = here.map(([e, i]) => `<li><span>${esc(describeEdit(e))}</span>${editable() ? ` <button class="btn small link" type="button" data-remove-step="${i}" aria-label="Remove: ${esc(describeEdit(e))}">Remove</button>` : ''}</li>`).join('');
  return `<div id="web-steps"><h2>Changes on this page <span class="badge${here.length ? ' warn' : ''}">${here.length}</span></h2>
    ${here.length ? `<ol class="web-step-list">${rows}</ol>${editable() ? '<p><button class="btn small" type="button" id="web-steps-clear">Remove all changes on this page</button></p>' : ''}` : '<p class="muted">None yet. Hidden elements come back when you remove their change here.</p>'}
    ${elsewhere ? `<p class="muted">${plural(elsewhere, 'change')} on other pages. Pick a page above to see them.</p>` : ''}
    <p class="help">Up to ${EDIT_MAX} changes in all. If a page is rebuilt with different words, changes to elements that are no longer there are skipped, never put on the wrong element.</p></div>`;
}

function historyHtml() {
  if (!view.history.length) return '<div class="card"><h2>Published versions</h2><p class="muted">Nothing published from here yet. The website shows the original design.</p></div>';
  const rows = view.history.map((v, i) => [
    `${i === 0 ? '<span class="badge ok">Live</span> ' : ''}${h.when(v.at)}`, esc(v.by || ''), plural(v.changes, 'change'),
    editable() ? `<button class="btn small" type="button" data-restore="${v.id}">Bring back as a draft</button>` : '',
  ]);
  return `<div class="card"><h2>Published versions</h2><p class="muted">The last ${view.history.length} designs you published. Bringing one back puts it in the draft; it goes live only when you publish.</p>
    ${h.table([{ label: 'Published' }, { label: 'By' }, { label: 'Changes' }, { label: '' }], rows)}</div>`;
}

function render() {
  $('#web-body').innerHTML = `
    ${editable() ? '' : '<p class="note">You can look at the website settings. Changing them needs the admin role.</p>'}
    ${statusHtml()}
    <div class="web-layout${editMode ? ' editing' : ''}">
      <div class="web-controls"><div id="web-edit-box">${editPanelHtml()}</div>${editMode ? '<h2 class="web-opts-h">Options for every page</h2>' : ''}${CATEGORIES.map(categoryHtml).join('')}</div>
      ${previewHtml()}
    </div>
    <p class="muted">${view.rebuildsAtOnce ? 'Publish rebuilds the website at once; the new look shows within about 5 minutes.' : 'Published changes show after the next website build (every night just after 8 pm Eastern, or run Publish web version in GitHub Actions to show them sooner).'}</p>
    ${historyHtml()}`;
}

// The editor panel alone; it keeps typing in the words box.
function renderEditPanel() {
  const box = $('#web-edit-box');
  if (!box) return;
  if (!editMode) { box.innerHTML = ''; return; }
  const typing = document.activeElement?.id === 'web-sel-words';
  if (!$('#web-edit', box) || !typing) { box.innerHTML = editPanelHtml(); return; }
  $('#web-steps', box).outerHTML = stepsHtml();
}

// Small updates without redrawing (keeps focus and the preview frame).
function refreshMarks() {
  for (const o of OPTIONS) {
    const row = $(`[data-opt="${o.key}"]`);
    if (!row) continue;
    const changed = current[o.key] !== o.default;
    row.classList.toggle('changed', changed);
    $('[data-reset]', row).hidden = !(changed && editable());
    const el = $(`#web-${o.key}`);
    if (el && el.value !== current[o.key] && document.activeElement !== el) el.value = current[o.key];
    const count = $(`#web-${o.key}-count`);
    if (count) count.textContent = `${current[o.key].length} of ${o.max} characters`;
  }
  for (const c of CATEGORIES) {
    const n = c.options.filter((o) => current[o.key] !== o.default).length;
    const b = $(`[data-cat-count="${c.id}"]`);
    if (b) { b.textContent = n ? `${n} changed` : 'Original'; b.classList.toggle('warn', !!n); }
  }
  const status = $('.web-status');
  if (status) {
    const saved = $('#web-saved')?.textContent || '';
    status.outerHTML = statusHtml();
    $('#web-saved').textContent = saved;
  }
  renderEditPanel();
}

function sendPreview() {
  const w = frameWin();
  if (!w || !view) return;
  w.postMessage({ type: 'flg-design', design: changes(current), look, edit: editMode && editable() }, siteOrigin());
}
const tellFrame = (msg) => { const w = frameWin(); if (w && view) w.postMessage({ type: 'flg-design-cmd', ...msg }, siteOrigin()); };

function turnPreviewTo(page) {
  if (!page || page === 'any' || page === previewPage) return;
  previewPage = page;
  $('#web-page').value = page;
  loadFrame();
}
function loadFrame() {
  selection = null;
  framePage = null;
  renderEditPanel();
  $('#web-frame').src = frameSrc();
}

// ---------- changing ----------
function setDesign(next, { keepUndo = false, from } = {}) {
  const n = normalize(next);
  if (same(n, current)) { sendPreview(); return false; }
  if (!keepUndo) { undo.push(current); if (undo.length > UNDO_MAX) undo.shift(); redo = []; }
  current = n;
  refreshMarks();
  sendPreview();
  share();
  if (from && !editMode) turnPreviewTo(CATEGORIES.find((c) => c.options.some((o) => o.key === from))?.page);
  scheduleSave();
  return true;
}

// One change made on the page (design-preview.js): words, hide or move.
function addStep(op) {
  if (!op || typeof op !== 'object') return;
  if (!editable()) { h.toast('Changing the website needs the admin role.'); sendPreview(); return; }
  // Words that are also an option (marked data-design-text) change that option.
  if (op.op === 'text' && op.key) {
    const o = optionFor(op.key);
    if (o && o.type !== 'select') {
      const v = String(op.v || '').slice(0, o.max);
      if (setDesign({ ...current, [o.key]: v })) h.toast(String(op.v).length > o.max ? `${o.label}: kept to ${o.max} characters.` : `${o.label}: changed. Undo puts it back.`);
      return;
    }
  }
  const { key, ...step } = op; // eslint-disable-line no-unused-vars
  let list = current.edits.slice();
  // A new set of words, or hiding again, replaces the element's earlier one.
  if (step.op === 'text' || step.op === 'hide') list = list.filter((e) => !(e.op === step.op && e.p === step.p && e.t === step.t));
  list.push(step);
  if (list.length > EDIT_MAX) { h.toast(`That is more than ${EDIT_MAX} page changes. Remove some under "Changes on this page" first.`); sendPreview(); return; }
  if (!setDesign({ ...current, edits: list })) { h.toast('Nothing changed.'); return; }
  h.toast(step.op === 'move' ? 'Moved. Undo puts it back.' : step.op === 'hide' ? 'Hidden. Undo, or Remove under "Changes on this page", brings it back.' : 'Words changed. Undo puts them back.');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  const s = $('#web-saved');
  if (s) s.textContent = 'Saving draft…';
  saveTimer = setTimeout(() => {
    saving = saving.then(async () => {
      try {
        if (same(current, live())) await h.api('site-design/discard', { method: 'POST', body: {} });
        else await h.api('site-design/draft', { method: 'POST', body: { design: changes(current) } });
        const el = $('#web-saved');
        if (el) el.textContent = same(current, live()) ? '' : 'Draft saved.';
      } catch (e) {
        const el = $('#web-saved');
        if (el) el.textContent = `The draft could not be saved: ${e.message}`;
      }
    });
  }, 600);
}

function doUndo() {
  if (!undo.length || !editable()) return;
  redo.push(current);
  current = undo.pop();
  refreshMarks(); sendPreview(); share(); scheduleSave();
  h.toast('Undone.');
}
function doRedo() {
  if (!redo.length || !editable()) return;
  undo.push(current);
  current = redo.pop();
  refreshMarks(); sendPreview(); share(); scheduleSave();
  h.toast('Redone.');
}

function setEditMode(on) {
  editMode = on && editable();
  selection = null;
  $('.web-layout')?.classList.toggle('editing', editMode);
  const box = $('#web-edit-box');
  if (box) box.innerHTML = editPanelHtml();
  $('.web-opts-h')?.remove();
  if (editMode) box?.insertAdjacentHTML('afterend', '<h2 class="web-opts-h">Options for every page</h2>');
  $('#web-preview-note').innerHTML = noteText();
  sendPreview();
}

function popOut() {
  const url = `${location.pathname}?editor=1&page=${encodeURIComponent(previewPage)}#website`;
  const w = window.open(url, 'flg-site-editor', 'popup=yes,width=1440,height=920');
  if (!w) { h.toast('The browser blocked the new window. Allow pop-ups for the dashboard and try again.'); return; }
  w.focus();
  h.toast('The editor opened in a new window. Both windows stay in step.');
}

export function initWebsiteEvents() {
  const body = $('#web-body');
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'web-mode') { setEditMode(t.value === 'edit'); return; }
    if (t.id === 'web-page') { previewPage = PREVIEW_PAGES.some((p) => p[0] === t.value) ? t.value : 'hub'; loadFrame(); return; }
    if (t.id === 'web-look') { look = t.value === 'dark' ? 'dark' : 'light'; sendPreview(); return; }
    if (t.id === 'web-size') { size = t.value === 'phone' ? 'phone' : 'desktop'; $('.web-frame-box').classList.toggle('phone', size === 'phone'); return; }
    const key = t.dataset.key;
    if (key && editable()) setDesign({ ...current, [key]: t.value }, { from: key });
  });
  // Words show in the preview as you type; Undo keeps the whole edit as one step.
  let typingFrom = null;
  body.addEventListener('focusin', (e) => { if (e.target.matches('input[data-key], textarea[data-key]')) typingFrom = current; });
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches('input[data-key], textarea[data-key]') || !editable()) return;
    const was = typingFrom;
    setDesign({ ...current, [t.dataset.key]: t.value }, { keepUndo: true, from: t.dataset.key });
    if (was && !undo.includes(was)) { undo.push(was); redo = []; refreshMarks(); }
  });
  body.addEventListener('focusout', () => { typingFrom = null; });
  body.addEventListener('keydown', (e) => {
    // Ctrl+Enter in the words box uses the words.
    if (e.target.id === 'web-sel-words' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('[data-cmd="words"]')?.click(); }
  });
  body.addEventListener('toggle', (e) => { if (e.target.matches('details.web-cat') && e.target.open) openCat = e.target.dataset.cat; }, true);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'web-popout') { popOut(); return; }
    if (b.id === 'web-close') { window.close(); return; }
    if (b.dataset.crumb) { tellFrame({ cmd: 'crumb', n: Number(b.dataset.crumb) }); return; }
    if (b.dataset.cmd === 'parent' || b.dataset.cmd === 'deselect') { tellFrame({ cmd: b.dataset.cmd }); return; }
    if (!editable()) return;
    if (b.dataset.cmd === 'words') {
      const v = $('#web-sel-words')?.value || '';
      if (!v.trim()) { h.toast('Type some words first, or use Hide to take the element away.'); return; }
      tellFrame({ cmd: 'words', v });
      return;
    }
    if (b.dataset.cmd) { tellFrame({ cmd: b.dataset.cmd }); return; }
    if (b.id === 'web-sel-reset' && selection) {
      const s = selection;
      setDesign({ ...current, edits: current.edits.filter((x) => !(x.p === s.page && x.t === s.t)) });
      h.toast('Put back as built. Undo brings your changes back.');
      return;
    }
    if (b.dataset.removeStep) {
      const i = Number(b.dataset.removeStep);
      setDesign({ ...current, edits: current.edits.filter((x, j) => j !== i) });
      h.toast('Change removed. Undo brings it back.');
      return;
    }
    if (b.id === 'web-steps-clear') {
      if (!(await h.ask({ title: 'Remove all changes on this page?', text: 'Words, hidden and moved elements on this page go back as built. Options for every page stay. Undo can bring them back while this window is open.', ok: 'Remove them' }))) return;
      setDesign({ ...current, edits: current.edits.filter((x) => x.p !== framePage) });
      return;
    }
    if (b.dataset.reset) { const o = OPTIONS.find((x) => x.key === b.dataset.reset); setDesign({ ...current, [o.key]: o.default }, { from: o.key }); h.toast(`${o.label}: back to the original.`); return; }
    if (b.dataset.resetCat) {
      const c = CATEGORIES.find((x) => x.id === b.dataset.resetCat);
      setDesign({ ...current, ...Object.fromEntries(c.options.map((o) => [o.key, o.default])) }, { from: c.options[0].key });
      h.toast(`${c.name}: back to the original. Undo brings your choices back.`);
      return;
    }
    if (b.id === 'web-undo') return doUndo();
    if (b.id === 'web-redo') return doRedo();
    if (b.id === 'web-discard') {
      if (!(await h.ask({ title: 'Discard the draft?', text: 'The preview goes back to the published design. Undo can still bring your draft back while this page is open.', ok: 'Discard draft' }))) return;
      setDesign(live());
      return;
    }
    if (b.id === 'web-publish') {
      const n = countChanges(current);
      if (!(await h.ask({ title: 'Publish this design?', text: `Visitors to thelogicgrid.com will see it${view.rebuildsAtOnce ? ' within about 5 minutes' : ' after the next website build'}. ${plural(n, 'change')} from the original design. You can bring back the current design later from Published versions.`, ok: 'Publish' }))) return;
      clearTimeout(saveTimer);
      await saving;
      await h.act(b, async () => {
        const r = await h.api('site-design/publish', { method: 'POST', body: { design: changes(current) } });
        h.toast(r.rebuilding ? 'Published. The website is rebuilding and shows it within about 5 minutes.' : 'Published. It shows after the next website build.');
      });
      await websiteView();
      channel?.postMessage({ type: 'reload' });
      return;
    }
    if (b.dataset.restore) {
      await h.act(b, async () => {
        const r = await h.api(`site-design/restore/${b.dataset.restore}`, { method: 'POST', body: {} });
        undo.push(current);
        current = normalize(r.draft.design);
        redo = [];
        refreshMarks(); sendPreview(); share();
      }, 'That version is in the draft. Publish to make it live.');
    }
  });
}
