// Website: customize thelogicgrid.com (server/src/site-design.js; the options
// are web/js/site-design.js, copied here as site-design.js).
// - Every option is one click: a dropdown, or a box for words.
// - Options are in categories you open one at a time; each shows how many
//   choices differ from the original design.
// - The preview shows the real website with your draft applied, live. Nothing
//   changes for visitors until Publish.
// - Undo and Redo (also Ctrl+Z and Ctrl+Shift+Z), Reset for one option or a
//   whole category, Discard draft, and every earlier published version can
//   come back as a draft.
import { CATEGORIES, OPTIONS, PREVIEW_PAGES, defaults, normalize, changes } from './site-design.js';

const $ = (s, el = document) => el.querySelector(s);
// Every word from the design is escaped before it goes into the page.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let h = null; // helpers from admin.js
let view = null; // the last GET /admin/v1/site-design
let current = defaults(); // the design shown in the preview (draft or live)
let undo = [];
let redo = [];
let saveTimer = null;
let saving = Promise.resolve();
let previewPage = 'hub';
let look = 'light';
let size = 'desktop';
let openCat = CATEGORIES[0].id;
const UNDO_MAX = 100;

const same = (a, b) => JSON.stringify(changes(a)) === JSON.stringify(changes(b));
const live = () => normalize(view?.published?.design || {});
const editable = () => h.can('admin');
const siteOrigin = () => { try { return new URL(view.siteUrl).origin; } catch (e) { return ''; } };

export function initWebsite(helpers) {
  h = helpers;
  addEventListener('message', (e) => {
    if (!view || e.origin !== siteOrigin() || !e.data || e.data.type !== 'flg-design-ready') return;
    sendPreview();
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !$('#web-body') || $('[data-view="website"]').hidden) return;
    if (e.target.closest('input[type=text], textarea')) return; // the box's own undo
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
  });
}

export async function websiteView() {
  view = await h.api('site-design');
  current = normalize(view.draft ? view.draft.design : view.published?.design || {});
  undo = [];
  redo = [];
  render();
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
  return `<details class="web-cat" data-cat="${c.id}"${c.id === openCat ? ' open' : ''}>
    <summary><span>${esc(c.name)}</span> <span class="badge${n ? ' warn' : ''}" data-cat-count="${c.id}">${n ? `${n} changed` : 'Original'}</span></summary>
    ${c.help ? `<p class="help">${esc(c.help)}</p>` : ''}
    ${c.options.map(optionRow).join('')}
    ${editable() ? `<p><button class="btn small" type="button" data-reset-cat="${c.id}">Put this group back to the original</button></p>` : ''}
  </details>`;
}

function statusHtml() {
  const draft = !same(current, live());
  const pending = Object.keys(changes(current)).length;
  return `<div class="web-status" role="toolbar" aria-label="Website design">
    <p class="web-state" id="web-state">${draft ? '<span class="badge warn">Draft</span> Not live yet. Visitors see the published design until you press Publish.' : '<span class="badge ok">Live</span> The preview shows what visitors see.'}
      <span class="muted">${pending ? `${pending} choice${pending === 1 ? '' : 's'} differ from the original design.` : 'Original design.'}</span> <span class="muted" id="web-saved" aria-live="polite"></span></p>
    <div class="row">
      <button class="btn small" type="button" id="web-undo"${undo.length && editable() ? '' : ' disabled'}>Undo</button>
      <button class="btn small" type="button" id="web-redo"${redo.length && editable() ? '' : ' disabled'}>Redo</button>
      <button class="btn small" type="button" id="web-discard"${draft && editable() ? '' : ' disabled'}>Discard draft</button>
      <button class="btn small primary" type="button" id="web-publish"${draft && editable() ? '' : ' disabled'}>Publish</button>
    </div>
  </div>`;
}

function previewHtml() {
  const path = (PREVIEW_PAGES.find((p) => p[0] === previewPage) || PREVIEW_PAGES[0])[2];
  return `<div class="web-preview">
    <div class="row web-preview-bar">
      <div class="field inline"><label for="web-page">Page</label><select id="web-page">${PREVIEW_PAGES.map(([id, label]) => `<option value="${id}"${id === previewPage ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field inline"><label for="web-look">Look</label><select id="web-look"><option value="light"${look === 'light' ? ' selected' : ''}>Light</option><option value="dark"${look === 'dark' ? ' selected' : ''}>Dark</option></select></div>
      <div class="field inline"><label for="web-size">Size</label><select id="web-size"><option value="desktop"${size === 'desktop' ? ' selected' : ''}>Computer</option><option value="phone"${size === 'phone' ? ' selected' : ''}>Phone</option></select></div>
    </div>
    <div class="web-frame-box${size === 'phone' ? ' phone' : ''}"><iframe id="web-frame" title="Preview of the website with your draft" src="${esc(`${view.siteUrl}/${path}?design-preview`)}" loading="lazy"></iframe></div>
    <p class="muted web-preview-note">The preview takes no clicks. Changes to the page itself (text and pictures inside the games, daily puzzles) are made in their own sections.</p>
  </div>`;
}

function historyHtml() {
  if (!view.history.length) return '<div class="card"><h2>Published versions</h2><p class="muted">Nothing published from here yet. The website shows the original design.</p></div>';
  const rows = view.history.map((v, i) => [
    `${i === 0 ? '<span class="badge ok">Live</span> ' : ''}${h.when(v.at)}`, esc(v.by || ''), `${v.changes} change${v.changes === 1 ? '' : 's'}`,
    editable() ? `<button class="btn small" type="button" data-restore="${v.id}">Bring back as a draft</button>` : '',
  ]);
  return `<div class="card"><h2>Published versions</h2><p class="muted">The last ${view.history.length} designs you published. Bringing one back puts it in the draft; it goes live only when you publish.</p>
    ${h.table([{ label: 'Published' }, { label: 'By' }, { label: 'Choices' }, { label: '' }], rows)}</div>`;
}

function render() {
  $('#web-body').innerHTML = `
    ${editable() ? '' : '<p class="note">You can look at the website settings. Changing them needs the admin role.</p>'}
    ${statusHtml()}
    <div class="web-layout">
      <div class="web-controls">${CATEGORIES.map(categoryHtml).join('')}</div>
      ${previewHtml()}
    </div>
    <p class="muted">${view.rebuildsAtOnce ? 'Publish rebuilds the website at once; the new look shows within about 5 minutes.' : 'Published changes show after the next website build (every night just after 8 pm Eastern, or run Publish web version in GitHub Actions to show them sooner).'}</p>
    ${historyHtml()}`;
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
}

function sendPreview() {
  const frame = $('#web-frame');
  if (!frame || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'flg-design', design: changes(current), look }, siteOrigin());
}

function turnPreviewTo(page) {
  if (!page || page === 'any' || page === previewPage) return;
  previewPage = page;
  const path = PREVIEW_PAGES.find((p) => p[0] === page)[2];
  $('#web-page').value = page;
  $('#web-frame').src = `${view.siteUrl}/${path}?design-preview`;
}

// ---------- changing ----------
function setDesign(next, { keepUndo = false, from } = {}) {
  const n = normalize(next);
  if (same(n, current)) return;
  if (!keepUndo) { undo.push(current); if (undo.length > UNDO_MAX) undo.shift(); redo = []; }
  current = n;
  refreshMarks();
  sendPreview();
  if (from) turnPreviewTo(CATEGORIES.find((c) => c.options.some((o) => o.key === from))?.page);
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  $('#web-saved').textContent = 'Saving draft…';
  saveTimer = setTimeout(() => {
    saving = saving.then(async () => {
      try {
        if (same(current, live())) await h.api('site-design/discard', { method: 'POST', body: {} });
        else await h.api('site-design/draft', { method: 'POST', body: { design: changes(current) } });
        const s = $('#web-saved');
        if (s) s.textContent = same(current, live()) ? '' : 'Draft saved.';
      } catch (e) {
        const s = $('#web-saved');
        if (s) s.textContent = `The draft could not be saved: ${e.message}`;
      }
    });
  }, 600);
}

function doUndo() {
  if (!undo.length || !editable()) return;
  redo.push(current);
  current = undo.pop();
  refreshMarks(); sendPreview(); scheduleSave();
  h.toast('Undone.');
}
function doRedo() {
  if (!redo.length || !editable()) return;
  undo.push(current);
  current = redo.pop();
  refreshMarks(); sendPreview(); scheduleSave();
  h.toast('Redone.');
}

export function initWebsiteEvents() {
  const body = $('#web-body');
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'web-page') { previewPage = PREVIEW_PAGES.some((p) => p[0] === t.value) ? t.value : 'hub'; $('#web-frame').src = `${view.siteUrl}/${PREVIEW_PAGES.find((p) => p[0] === t.value)[2]}?design-preview`; return; }
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
  body.addEventListener('toggle', (e) => { if (e.target.matches('details.web-cat') && e.target.open) openCat = e.target.dataset.cat; }, true);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !editable()) return;
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
      const n = Object.keys(changes(current)).length;
      if (!(await h.ask({ title: 'Publish this design?', text: `Visitors to thelogicgrid.com will see it${view.rebuildsAtOnce ? ' within about 5 minutes' : ' after the next website build'}. ${n} choice${n === 1 ? '' : 's'} differ from the original design. You can bring back the current design later from Published versions.`, ok: 'Publish' }))) return;
      clearTimeout(saveTimer);
      await saving;
      await h.act(b, async () => {
        const r = await h.api('site-design/publish', { method: 'POST', body: { design: changes(current) } });
        h.toast(r.rebuilding ? 'Published. The website is rebuilding and shows it within about 5 minutes.' : 'Published. It shows after the next website build.');
      });
      await websiteView();
      return;
    }
    if (b.dataset.restore) {
      await h.act(b, async () => {
        const r = await h.api(`site-design/restore/${b.dataset.restore}`, { method: 'POST', body: {} });
        undo.push(current);
        current = normalize(r.draft.design);
        redo = [];
        refreshMarks(); sendPreview();
      }, 'That version is in the draft. Publish to make it live.');
    }
  });
}
