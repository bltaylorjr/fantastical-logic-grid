// Book publishing: make a print puzzle book (KDP paperback) from the game's own
// engine, design its cover, check it against KDP's rules, and keep every book
// and its puzzles in the books database (server/src/books.js) so no puzzle is
// ever printed twice and each one is scanned for trademark and copyright
// problems. Starts from the settings Volume 1 was made with.
//
// Everything is made in the browser: puzzles in books-worker.js, pages by
// book-layout.js. "Print or save as PDF" uses the browser's own print, with the
// page size set to the book's trim size.
import * as L from './book-layout.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const STORE = 'flgBookSettings';
const PRESETS = 'flgBookPresets';

let h = null; // helpers from admin.js
let S = null; // the settings being edited
let E = null; // the engine (describeOptions, TIERS)
let shown = false;
let built = null; // { puzzles, example, interior, overflow: [], fit: {} }
let stale = false;
let worker = null;
let selKey = null;
let snap = null; // settings when a field got focus, for undo
const past = [];
const future = [];
let renderTimer = 0;
let books = [];
let openBook = null;

// ---------------------------------------------------------------- settings

const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function set(o, path, v) {
  const keys = path.split('.');
  let x = o;
  keys.slice(0, -1).forEach((k, i) => { if (x[k] == null || typeof x[k] !== 'object') x[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}; x = x[k]; });
  const last = keys[keys.length - 1];
  if (v === null || v === '') { if (Array.isArray(x)) x[last] = ''; else delete x[last]; } else x[last] = v;
}
function load() {
  try { const raw = localStorage.getItem(STORE); if (raw) return L.normalize(JSON.parse(raw)); } catch (e) { /* fall back */ }
  return L.defaults();
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {
    if (S.cover.image) h.toast('The cover picture is too big to keep on this device. It stays until you close the page; Download settings keeps it.');
  }
}
const presets = () => { try { return JSON.parse(localStorage.getItem(PRESETS) || '{}'); } catch (e) { return {}; } };

function remember(before) {
  past.push(before);
  if (past.length > 60) past.shift();
  future.length = 0;
  undoButtons();
}
function undoButtons() {
  if (!$('#bk-undo')) return;
  $('#bk-undo').disabled = !past.length;
  $('#bk-redo').disabled = !future.length;
}
function restore(json) {
  const before = JSON.stringify(S);
  S = L.normalize(JSON.parse(json));
  save();
  renderPanel();
  if (built && JSON.stringify(S.puzzles) !== built.settingsAt) markStale();
  else if (built && stale && JSON.stringify(S.puzzles) === built.settingsAt) { stale = false; $('#bk-build-card').classList.remove('bk-stale'); }
  void before;
  refreshAll();
}

// ---------------------------------------------------------------- fields

const e = (s) => h.esc(s);
const idOf = (path) => `bk-${path.replace(/[^\w]/g, '-')}`;
function field(type, path, label, o = {}) {
  const id = idOf(path);
  const v = get(S, path);
  const help = o.help ? `<span class="muted">${o.help}</span>` : '';
  const attrs = `id="${id}" data-path="${path}" data-type="${type}"`;
  if (type === 'check') return `<label class="check"><input type="checkbox" ${attrs}${v ? ' checked' : ''}> ${e(label)}</label>${help}`;
  if (type === 'select') return `<div class="field"><label for="${id}">${e(label)}</label><select ${attrs}>${o.options.map(([k, l]) => `<option value="${e(k)}"${String(k) === String(v ?? '') ? ' selected' : ''}>${e(l)}</option>`).join('')}</select>${help}</div>`;
  if (type === 'textarea') return `<div class="field"><label for="${id}">${e(label)}</label><textarea ${attrs} rows="${o.rows || 3}">${e(v ?? '')}</textarea>${help}</div>`;
  if (type === 'color') return `<label for="${id}">${e(label)}</label><input type="color" ${attrs} value="${e(v || '#000000')}">`;
  const num = type === 'number' || type === 'range';
  return `<div class="field${o.grow ? ' grow' : ''}"><label for="${id}">${e(label)}${type === 'range' ? ` <output id="${id}-out">${e(v)}</output>` : ''}</label><input type="${type}" ${attrs} value="${e(v ?? '')}"${num ? ` step="${o.step ?? 1}" min="${o.min ?? 0}" max="${o.max ?? 9999}"` : ''}${o.max && !num ? ` maxlength="${o.max}"` : ''} autocomplete="off">${help}</div>`;
}
const fontOptions = L.FONTS.map(([v, l]) => [v, l]);

function colorsEditor(base) {
  return `<div class="bk-colors">${Object.entries(L.ELEMENTS).map(([g, def]) => `<h3>${e(def.label)}</h3>${def.items.map(([k, label]) => field('color', `${base}.${g}.${k}`, label)).join('')}`).join('')}</div>`;
}

// ---------------------------------------------------------------- the panel

function levelRows() {
  return L.LEVELS.map(([id, name]) => {
    const t = E.TIERS[id];
    const opts = (lo, hi) => [['', 'Usual'], ...Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, String(lo + i)])];
    return `<tr><th scope="row">${e(name)}</th>
<td>${field('number', `puzzles.counts.${id}`, 'Puzzles', { min: 0, max: 200 }).replace('class="field"', 'class="field inline"')}</td>
<td>${field('select', `puzzles.sizes.${id}.categories`, 'Categories', { options: opts(t.categories[0], t.categories[1]) })}</td>
<td>${field('select', `puzzles.sizes.${id}.items`, 'Items', { options: opts(t.items[0], t.items[1]) })}</td></tr>`;
  }).join('');
}

function themePicker() {
  const themes = E.describeOptions().themes.filter((t) => t.id !== 'stories' && t.id !== 'random');
  return `<div class="row"><button class="btn small" type="button" id="bk-themes-all">All themes</button><button class="btn small" type="button" id="bk-themes-none">None</button><button class="btn small" type="button" id="bk-themes-vol1">Volume 1 themes</button></div>
<p class="muted">Puzzles take turns through the checked themes, in this order. Open a theme to choose its topics (categories); none checked means any topic.</p>
<div class="bk-themes">${themes.map((t) => {
    const on = S.puzzles.themes.includes(t.id);
    const picked = S.puzzles.topics[t.id] || [];
    const topics = (t.topics || []).filter((x) => x.id !== 'any');
    return `<label class="check"><input type="checkbox" data-theme="${e(t.id)}"${on ? ' checked' : ''}> ${e(t.name)}</label>
${topics.length ? `<details${picked.length ? ' open' : ''}><summary>${e(t.name)} topics ${picked.length ? `(${picked.length} chosen)` : '(any)'}</summary><div class="bk-topics">${topics.map((x) => `<label class="check"><input type="checkbox" data-topic="${e(t.id)}|${e(x.id)}"${picked.includes(x.id) ? ' checked' : ''}> ${e(x.name)}</label>`).join('')}</div></details>` : ''}`;
  }).join('')}</div>`;
}

function renderPanel() {
  const trims = L.TRIMS.map((t) => [t.id, `${t.label}${t.large ? ' · large trim' : ''}`]);
  const pre = presets();
  $('#bk-panel').innerHTML = `
<details class="card" open><summary>1. Book details</summary><div class="stack">
${field('text', 'book.title', 'Title', { max: 200 })}
<div class="row">${field('text', 'book.subtitle', 'Subtitle', { grow: true })}${field('text', 'book.volume', 'Volume', { grow: true })}</div>
${field('text', 'book.tagline', 'Line under the title', { help: 'Empty: “40 story logic puzzles from Easy to Expert”, from the puzzles.' })}
<div class="row">${field('text', 'book.brand', 'Brand line', { grow: true })}${field('text', 'book.website', 'Website', { grow: true })}</div>
<div class="row">${field('text', 'book.author', 'Author', { grow: true })}${field('text', 'book.owner', 'Copyright owner', { grow: true })}</div>
<div class="row">${field('number', 'book.year', 'Year', { min: 2000, max: 2100 })}${field('text', 'book.edition', 'Edition', { grow: true })}</div>
<div class="row">${field('text', 'book.imprint', 'Publisher (imprint)', { grow: true, help: 'Optional. KDP lists “Independently published” when empty.' })}${field('text', 'book.isbn', 'Your own ISBN', { grow: true, help: 'Leave empty to use KDP’s free ISBN.' })}</div>
${field('check', 'book.allowCopies', 'Let buyers photocopy puzzles for personal or classroom use')}
${field('check', 'book.trademarks', 'Show the ™ notices')}
${field('textarea', 'book.copyrightExtra', 'More for the copyright page', { rows: 2 })}
</div></details>

<details class="card"><summary>2. Print format (KDP paperback)</summary><div class="stack">
${field('select', 'format.trim', 'Trim size', { options: trims })}
<div class="row">${field('select', 'format.ink', 'Interior ink', { options: Object.entries(L.INKS) })}${field('select', 'format.paper', 'Paper', { options: Object.entries(L.PAPERS) })}</div>
${field('check', 'format.bleed', 'Bleed (color or pictures to the edge of the page)')}
<p class="muted">Margins in inches. KDP needs at least 0.375" inside up to 150 pages (more for thicker books) and 0.25" elsewhere (0.375" with bleed).</p>
<div class="row">${['inside', 'outside', 'top', 'bottom'].map((k) => field('number', `format.margins.${k}`, k[0].toUpperCase() + k.slice(1), { step: 0.05, min: 0.25, max: 2 })).join('')}</div>
${field('check', 'format.pageNumbers', 'Page numbers')}
${field('select', 'format.folio', 'Page number position', { options: [['outside', 'Outside corner'], ['center', 'Center']] })}
</div></details>

<details class="card"><summary>3. Puzzles</summary><div class="stack">
<table class="bk-levels"><thead><tr><th>Level</th><th>How many</th><th>Categories</th><th>Items each</th></tr></thead><tbody>${levelRows()}</tbody></table>
<p class="muted">The two highest levels can take up to a minute each to make.</p>
<div class="row">${field('number', 'puzzles.questions', 'Story questions per puzzle', { min: 1, max: 6 })}${field('select', 'puzzles.order', 'Order', { options: [['level', 'Easiest first, grouped by level'], ['mixed', 'Mixed levels']] })}</div>
${field('text', 'puzzles.seed', 'Seed', { help: 'The same seed and settings always make the same puzzles. Volume 1 used “book1”.' })}
${field('check', 'puzzles.skipUsed', 'Leave out every puzzle already in a published book (books database)')}
${field('check', 'puzzles.includeDrafts', 'Also leave out puzzles in draft books')}
<h3>Themes and topics</h3>${themePicker()}
</div></details>

<details class="card"><summary>4. Pages</summary><div class="stack">
<div class="bk-themes">${[['title', 'Title page'], ['copyright', 'Copyright page'], ['contents', 'Contents'], ['howto', 'How to solve'], ['example', 'Worked example (2 pages)'], ['levels', 'The levels'], ['thanks', 'Thanks page at the end']].map(([k, l]) => field('check', `pages.${k}`, l)).join('')}</div>
${field('select', 'pages.layout', 'Puzzle layout', { options: [['spread', 'Two facing pages: story and clues left, big grid right (Volume 1)'], ['single', 'One page: story, clues and a smaller grid']] })}
<div class="bk-themes">${[['story', 'Story'], ['questions', 'Story questions'], ['chart', 'Answer chart under the grid'], ['runningHeads', 'Running heads'], ['levelDots', 'Level dots']].map(([k, l]) => field('check', `pages.${k}`, l)).join('')}</div>
<div class="row">${field('select', 'pages.keys', 'Answer keys', { options: [['end', 'At the back'], ['after', 'After each puzzle'], ['none', 'None']] })}${field('select', 'pages.keysPerPage', 'Keys per page', { options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] })}</div>
${field('check', 'pages.keyGrid', 'Show the solved grid in each key')}
${field('check', 'pages.keySteps', 'Show the step-by-step solution in each key')}
${field('number', 'pages.notesPages', 'Notes pages at the end', { min: 0, max: 20 })}
<h3>Words on the pages</h3>
<p class="muted">Write these in your own words to keep them yours. Blank line = new paragraph, “## ” = heading, “- ” = list item, **bold**, *italic*, {keys} = the answer keys’ page.</p>
${field('textarea', 'pages.howtoText', 'How to solve', { rows: 10 })}
${field('textarea', 'pages.levelsIntro', 'The levels: opening line', { rows: 2 })}
${field('text', 'pages.levelsTip', 'The levels: tip')}
${field('text', 'pages.thanksTitle', 'Thanks page heading')}
${field('textarea', 'pages.thanksText', 'Thanks page words', { rows: 2 })}
</div></details>

<details class="card"><summary>5. Colors, fonts and sizes</summary><div class="stack">
<div class="row"><div class="field"><label for="bk-color-preset">Color set</label><select id="bk-color-preset"><option value="">Choose…</option>${Object.entries(L.COLOR_PRESETS).map(([k, [l]]) => `<option value="${k}">${e(l)}</option>`).join('')}</select></div></div>
${S.format.ink === 'bw' ? '<p class="note">The book is black and white, so every color prints as gray. Choose Standard or Premium color under Print format to print in color.</p>' : ''}
<div class="row">${field('select', 'style.fonts.heading', 'Headings font', { options: fontOptions })}${field('select', 'style.fonts.body', 'Text font', { options: fontOptions })}${field('select', 'style.fonts.grid', 'Grid and table font', { options: fontOptions })}</div>
<p class="muted">The built-in fonts look the same on every computer. Others must be installed on the computer that prints.</p>
<div class="row">${field('number', 'style.sizes.body', 'Text size (pt)', { step: 0.5, min: 7, max: 16 })}${field('number', 'style.sizes.title', 'Puzzle title size (pt)', { step: 1, min: 12, max: 40 })}${field('number', 'style.sizes.grid', 'Grid labels (pt)', { step: 0.5, min: 6, max: 14 })}</div>
<p class="muted">Colors for every page. Give one page its own colors from its preview.</p>
${colorsEditor('style.colors')}
</div></details>

<details class="card"><summary>6. Cover designer</summary><div class="stack">
<div class="row">${field('select', 'cover.layout', 'Layout', { options: [['band', 'Title band'], ['centered', 'Centered'], ['minimal', 'Minimal']] })}${field('select', 'cover.finish', 'Finish (choose on KDP)', { options: [['matte', 'Matte'], ['glossy', 'Glossy']] })}</div>
${field('check', 'cover.guides', 'Show bleed and spine guides (never printed)')}
<h3>Front</h3>
${field('text', 'cover.front.title', 'Title', { help: 'Empty: the book title.' })}
${field('text', 'cover.front.subtitle', 'Subtitle', { help: 'Empty: subtitle and volume.' })}
<div class="row">${field('text', 'cover.front.brand', 'Brand line', { grow: true })}${field('text', 'cover.front.author', 'Author line', { grow: true })}</div>
<div class="row">${field('text', 'cover.front.badge', 'Badge', { grow: true })}${field('text', 'cover.front.footer', 'Bottom line', { grow: true })}</div>
${field('range', 'cover.titleSize', 'Title size (pt)', { min: 28, max: 90 })}
<h3>Back</h3>
${field('text', 'cover.back.heading', 'Heading')}
${field('textarea', 'cover.back.blurb', 'Description', { rows: 4 })}
${field('textarea', 'cover.back.bullets', 'Points (one per line)', { rows: 4 })}
${field('text', 'cover.back.footer', 'Bottom line')}
${field('check', 'cover.back.barcode', 'Leave space for KDP’s barcode')}
<h3>Spine</h3>
${field('check', 'cover.spine.show', 'Spine text (books over 79 pages)')}
${field('text', 'cover.spine.text', 'Spine text', { help: 'Empty: title and volume.' })}
<div class="bk-colors">${field('color', 'cover.spine.color', 'Spine text color')}</div>
<h3>Background and colors</h3>
<div class="bk-colors">${field('color', 'cover.bg', 'Background')}${field('color', 'cover.bg2', 'Second color (gradient)')}${field('color', 'cover.titleColor', 'Title')}${field('color', 'cover.textColor', 'Text')}${field('color', 'cover.accent', 'Accent (brand, badge)')}${field('color', 'cover.motifColor', 'Pattern')}</div>
${field('check', 'cover.gradient', 'Gradient background')}
<div class="row">${field('select', 'cover.motif', 'Pattern', { options: [['grid', 'Logic grid'], ['dots', 'Dots'], ['none', 'None']] })}${field('range', 'cover.motifOpacity', 'Pattern strength (%)', { min: 0, max: 60 })}</div>
<div class="row">${field('select', 'cover.headingFont', 'Title font', { options: fontOptions })}${field('select', 'cover.bodyFont', 'Text font', { options: fontOptions })}</div>
<h3>Picture</h3>
<div class="field"><label for="bk-cv-file">Add a picture (your own artwork or a licensed image)</label><input type="file" id="bk-cv-file" accept="image/png,image/jpeg,image/webp"></div>
${S.cover.image ? `<div class="row"><button class="btn small danger" type="button" id="bk-cv-remove">Remove the picture</button></div><p id="bk-cv-dpi" class="muted"></p>` : ''}
<div class="row">${field('select', 'cover.imagePlace', 'Where', { options: [['front', 'Front cover'], ['full', 'Whole cover']] })}${field('select', 'cover.imageFit', 'Fit', { options: [['cover', 'Fill'], ['contain', 'Whole picture']] })}${field('range', 'cover.imageOpacity', 'Strength (%)', { min: 10, max: 100 })}</div>
${field('number', 'cover.pageCount', 'Page count for the spine before the book is built', { min: 24, max: 828 })}
</div></details>

<details class="card"><summary>7. KDP listing and price</summary><div class="stack">
${field('textarea', 'listing.description', 'Book description (up to 4,000 characters)', { rows: 5 })}<span class="muted" id="bk-desc-count"></span>
<div class="stack">${[0, 1, 2, 3, 4, 5, 6].map((i) => field('text', `listing.keywords.${i}`, `Keyword ${i + 1}`, { max: 50 })).join('')}</div>
${[0, 1, 2].map((i) => field('text', `listing.categories.${i}`, `Category ${i + 1}`)).join('')}
<div class="row">${field('number', 'listing.price', 'List price, Amazon.com (USD)', { step: 0.01, min: 0.99, max: 250 })}${field('select', 'listing.isbnChoice', 'ISBN', { options: [['free', 'Free KDP ISBN'], ['own', 'My own ISBN']] })}</div>
${field('check', 'listing.expanded', 'Expanded Distribution (bookstores and libraries)')}
<h3>KDP’s AI questions</h3>
${[['text', 'Text'], ['images', 'Images'], ['translations', 'Translations']].map(([k, l]) => field('select', `listing.ai.${k}`, l, { options: [['none', 'No AI-generated content'], ['some', 'Some AI-generated content'], ['most', 'Mostly AI-generated'], ['unsure', 'Not decided yet']] })).join('')}
<div class="row"><button class="btn small" type="button" id="bk-copy-desc">Copy description</button><button class="btn small" type="button" id="bk-copy-keys">Copy keywords</button></div>
</div></details>

<details class="card"><summary>Saved settings</summary><div class="stack">
<div class="row"><div class="field grow"><label for="bk-preset">Saved settings on this device</label><select id="bk-preset"><option value="">Choose…</option>${Object.keys(pre).map((k) => `<option>${e(k)}</option>`).join('')}</select></div><button class="btn small" type="button" id="bk-preset-load">Use</button><button class="btn small danger" type="button" id="bk-preset-del">Delete</button></div>
<div class="row"><button class="btn small" type="button" id="bk-preset-save">Save these settings as…</button><button class="btn small" type="button" id="bk-download">Download settings</button><label class="btn small" for="bk-upload">Load a settings file</label><input type="file" id="bk-upload" accept="application/json,.json" hidden></div>
<button class="btn small danger" type="button" id="bk-reset">Back to Volume 1 settings</button>
</div></details>`;
  // Ranges show their number.
  $$('#bk-panel input[type=range]').forEach((r) => { const o = $(`#${r.id}-out`); if (o) r.addEventListener('input', () => { o.textContent = r.value; }); });
  descCount();
  coverDpi();
}

// ---------------------------------------------------------------- changes

function valueOf(el) {
  const t = el.dataset.type;
  if (t === 'check') return el.checked;
  if (t === 'number' || t === 'range') return el.value === '' ? null : Number(el.value);
  if (t === 'select' && /^(\d+)$/.test(el.value) && /sizes|keysPerPage/.test(el.dataset.path)) return Number(el.value);
  return el.value;
}
function changed(path, { history = false } = {}) {
  if (history && snap) { remember(snap); snap = null; }
  save();
  if (path.startsWith('puzzles.')) { markStale(); return; }
  if (path === 'format.ink') renderPanelKeep();
  if (path.startsWith('listing.')) { descCount(); money(); return; }
  if (path.startsWith('cover.')) { renderCover(); return; }
  scheduleRender();
}
function renderPanelKeep() {
  const open = $$('#bk-panel details').map((d) => d.open);
  const y = scrollY;
  renderPanel();
  $$('#bk-panel details').forEach((d, i) => { d.open = open[i] ?? d.open; });
  scrollTo(0, y);
}
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { if (built && !stale) renderBook(); renderCover(); money(); }, 250);
}
function markStale() {
  if (!built) return;
  stale = true;
  $('#bk-build-card')?.classList.add('bk-stale');
  $('#bk-status').textContent = 'Puzzle settings changed. Press Make the book to make it again with them.';
}

function wirePanel() {
  const panel = $('#bk-panel');
  panel.addEventListener('focusin', (ev) => { if (ev.target.dataset?.path) snap = JSON.stringify(S); });
  panel.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el.dataset.path || el.dataset.type === 'check' || el.dataset.type === 'select') return;
    set(S, el.dataset.path, valueOf(el));
    changed(el.dataset.path);
  });
  panel.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.path) {
      if (!snap) snap = JSON.stringify(S);
      set(S, el.dataset.path, valueOf(el));
      changed(el.dataset.path, { history: true });
      snap = null;
      return;
    }
    if (el.dataset.theme) {
      remember(JSON.stringify(S));
      const id = el.dataset.theme;
      S.puzzles.themes = el.checked ? [...S.puzzles.themes.filter((t) => t !== id), id] : S.puzzles.themes.filter((t) => t !== id);
      changed('puzzles.themes');
      return;
    }
    if (el.dataset.topic) {
      remember(JSON.stringify(S));
      const [theme, topic] = el.dataset.topic.split('|');
      const list = new Set(S.puzzles.topics[theme] || []);
      if (el.checked) list.add(topic); else list.delete(topic);
      if (list.size) S.puzzles.topics[theme] = [...list]; else delete S.puzzles.topics[theme];
      if (list.size && !S.puzzles.themes.includes(theme)) { S.puzzles.themes.push(theme); $(`[data-theme="${theme}"]`).checked = true; }
      changed('puzzles.topics');
      const sum = el.closest('details')?.querySelector('summary');
      if (sum) sum.textContent = sum.textContent.replace(/\(.*\)$/, list.size ? `(${list.size} chosen)` : '(any)');
      return;
    }
    if (el.id === 'bk-color-preset' && el.value) {
      remember(JSON.stringify(S));
      S.style.colors = JSON.parse(JSON.stringify(L.COLOR_PRESETS[el.value][1]));
      save();
      renderPanelKeep();
      scheduleRender();
      h.toast(`${L.COLOR_PRESETS[el.value][0]} colors on every page.`);
      return;
    }
    if (el.id === 'bk-cv-file' && el.files[0]) {
      const f = el.files[0];
      if (f.size > 8_000_000) { h.toast('That picture is over 8 MB. Use a smaller file.'); return; }
      const r = new FileReader();
      r.onload = () => { remember(JSON.stringify(S)); S.cover.image = r.result; save(); renderPanelKeep(); renderCover(); };
      r.readAsDataURL(f);
      return;
    }
    if (el.id === 'bk-upload' && el.files[0]) {
      el.files[0].text().then((t) => {
        try { const v = L.normalize(JSON.parse(t)); remember(JSON.stringify(S)); restore(JSON.stringify(v)); h.toast('Settings loaded.'); } catch (err) { h.toast('That file is not a book settings file.'); }
      });
    }
  });
  panel.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const themes = () => E.describeOptions().themes.filter((t) => t.id !== 'stories' && t.id !== 'random').map((t) => t.id);
    if (b.id === 'bk-themes-all' || b.id === 'bk-themes-none' || b.id === 'bk-themes-vol1') {
      remember(JSON.stringify(S));
      S.puzzles.themes = b.id === 'bk-themes-all' ? [...new Set([...S.puzzles.themes, ...themes()])] : b.id === 'bk-themes-none' ? [] : [...L.DEFAULTS.puzzles.themes];
      if (b.id !== 'bk-themes-all') S.puzzles.topics = {};
      changed('puzzles.themes');
      renderPanelKeep();
    }
    if (b.id === 'bk-cv-remove') { remember(JSON.stringify(S)); S.cover.image = ''; save(); renderPanelKeep(); renderCover(); }
    if (b.id === 'bk-copy-desc') copy(S.listing.description || S.cover.back.blurb, 'Description copied.');
    if (b.id === 'bk-copy-keys') copy(S.listing.keywords.filter(Boolean).join('\n'), 'Keywords copied, one per line.');
    if (b.id === 'bk-reset') {
      const ok = await h.ask({ title: 'Back to Volume 1 settings?', text: 'Every setting goes back to how Volume 1 was made. You can undo this.', ok: 'Reset', danger: true });
      if (ok) { remember(JSON.stringify(S)); restore(JSON.stringify(L.defaults())); }
    }
    if (b.id === 'bk-download') download(`book-settings-${(S.book.title + ' ' + S.book.volume).replace(/\W+/g, '-').toLowerCase()}.json`, JSON.stringify(S, null, 2), 'application/json');
    if (b.id === 'bk-preset-save') {
      const v = await h.ask({ title: 'Save these settings', fields: [{ name: 'name', label: 'Name', value: `${S.book.title} ${S.book.volume}`.trim() }], ok: 'Save', check: (x) => (x.name.trim() ? '' : 'Give them a name.') });
      if (v) {
        const p = presets();
        p[v.name.trim()] = { ...S, cover: { ...S.cover, image: '' } };
        try { localStorage.setItem(PRESETS, JSON.stringify(p)); h.toast('Saved on this device.'); renderPanelKeep(); } catch (err) { h.toast('This device has no room left for saved settings. Use Download settings.'); }
      }
    }
    if (b.id === 'bk-preset-load' && $('#bk-preset').value) { remember(JSON.stringify(S)); restore(JSON.stringify(presets()[$('#bk-preset').value])); h.toast('Settings loaded.'); }
    if (b.id === 'bk-preset-del' && $('#bk-preset').value) {
      const p = presets(); delete p[$('#bk-preset').value];
      localStorage.setItem(PRESETS, JSON.stringify(p)); renderPanelKeep();
    }
  });
}

function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => h.toast(msg), () => h.toast('Could not copy here. Select the text and copy it instead.'));
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function descCount() {
  const el = $('#bk-desc-count');
  if (el) el.textContent = `${(S.listing.description || '').length.toLocaleString()} of 4,000 characters${S.listing.description ? '' : ' (empty: the back-cover description is used when you copy)'}`;
}
function coverDpi() {
  const el = $('#bk-cv-dpi');
  if (!el || !S.cover.image) return;
  const img = new Image();
  img.onload = () => {
    const g = L.coverGeometry(S, pageCount());
    const w = S.cover.imagePlace === 'full' ? g.w : g.trim.w + L.BLEED;
    const dpi = Math.round(img.naturalWidth / w);
    el.textContent = `${img.naturalWidth} × ${img.naturalHeight} pixels: about ${dpi} dots per inch on the cover. ${dpi >= 300 ? 'Sharp enough for print.' : 'KDP asks for 300; this may print blurry.'}`;
    el.className = dpi >= 300 ? 'muted' : 'error';
  };
  img.src = S.cover.image;
}

// ---------------------------------------------------------------- build

async function build(button) {
  if (worker) { worker.terminate(); worker = null; }
  if (!S.puzzles.themes.length) { h.toast('Check at least one theme under Puzzles.'); return; }
  const total = L.puzzleJobs(S).jobs.length;
  if (!total) { h.toast('Choose how many puzzles under Puzzles.'); return; }
  button.disabled = true;
  const bar = $('#bk-progress');
  bar.hidden = false; bar.max = total; bar.value = 0;
  let used = { stories: [], fingerprints: [] };
  if (S.puzzles.skipUsed) {
    try { used = await h.api(`books/used${S.puzzles.includeDrafts ? '?drafts=1' : ''}`); } catch (err) {
      h.toast('Could not read the books database, so used puzzles are not left out this time.');
    }
  }
  $('#bk-status').textContent = `Making ${total} puzzles${used.stories.length ? `, leaving out ${used.stories.length} already in books` : ''}…`;
  worker = new Worker('/admin/books-worker.js', { type: 'module' });
  worker.onmessage = async (ev) => {
    const m = ev.data;
    if (m.type === 'progress') { bar.value = m.i; $('#bk-status').textContent = `Made ${m.i} of ${m.n}: ${m.title}`; return; }
    worker.terminate(); worker = null; button.disabled = false; bar.hidden = true;
    if (m.type === 'done') stale = false;
    if (m.type === 'error') { $('#bk-status').textContent = m.message; h.toast(m.message); return; }
    built = { puzzles: m.puzzles, example: m.example, settingsAt: JSON.stringify(S.puzzles) };
    stale = false;
    $('#bk-build-card').classList.remove('bk-stale');
    await renderBook();
    renderCover();
    h.announce(`Book made: ${built.interior.pages.length} pages.`);
  };
  worker.onerror = (err) => { button.disabled = false; bar.hidden = true; $('#bk-status').textContent = `The puzzle maker stopped: ${err.message || 'unknown error'}.`; worker = null; };
  worker.postMessage({ settings: S, used });
}

async function renderBook() {
  if (!built || worker) return; // a new book is being made; it renders when done
  built.interior = L.buildInterior(built.puzzles, built.example, S);
  // Measure at full size off screen; that copy is also what prints.
  const root = printRoot();
  root.innerHTML = L.interiorMarkup(built.interior, S);
  L.applyDataCss(root);
  await document.fonts.ready;
  built.fit = {};
  built.overflow = [];
  for (const sec of $$('.bk-page', root)) {
    const inner = $('.bk-inner', sec);
    const over = () => inner.scrollHeight > inner.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1;
    if (over()) { inner.classList.add('bk-tight'); built.fit[sec.dataset.key] = 'bk-tight'; }
    if (over()) { inner.classList.replace('bk-tight', 'bk-tighter'); built.fit[sec.dataset.key] = 'bk-tighter'; }
    if (over()) built.overflow.push(Number(sec.dataset.n));
  }
  renderThumbs();
  renderChecks();
  money();
  $('#bk-print-btn').disabled = false;
  $('#bk-save-btn').disabled = false;
  $('#bk-status').textContent = `${built.puzzles.length} puzzles, ${built.interior.pages.length} pages. Answer keys start on page ${built.interior.keysStart || '–'}.`;
}

function printRoot() {
  let root = $('#bk-print');
  if (!root) { root = document.createElement('div'); root.id = 'bk-print'; document.body.append(root); }
  return root;
}

function renderThumbs() {
  const wrap = $('#bk-thumbs');
  const zoom = Number($('#bk-zoom').value);
  const g = L.geometry(S);
  wrap.style.setProperty('--thumb', `${Math.round(g.pageW * 96 * zoom) + 4}px`);
  const kindName = { clues: 'clue pages', grid: 'grid pages', keys: 'answer key pages', puzzle: 'puzzle pages', notes: 'notes pages' };
  wrap.innerHTML = built.interior.pages.map((p) => {
    const own = S.style.pages[p.key]?.mode || '';
    return `<div class="bk-thumb${built.overflow.includes(p.n) ? ' bk-over' : ''}${selKey === p.key ? ' bk-sel' : ''}" data-key="${e(p.key)}">
<div class="bk-frame"><div class="bk-zoomed" data-css="--zoom:${zoom}"><div class="${L.bookClass(S)}" data-css="${e(L.bookVars(S))}">${L.pageMarkup(p)}</div></div></div>
<div class="bk-cap"><span>p. ${p.n} · ${e(p.label)}${built.overflow.includes(p.n) ? ' · <b class="error">runs over</b>' : ''}</span>
<select aria-label="Colors for page ${p.n}" data-page-mode="${e(p.key)}"><option value="">Book colors</option><option value="bw"${own === 'bw' ? ' selected' : ''}>Black and white</option><option value="custom"${own === 'custom' ? ' selected' : ''}>Own colors…</option></select></div>
${own === 'custom' && selKey === p.key ? `<div class="card stack"><b>Page ${p.n} colors</b>${colorsEditor(`style.pages.${p.key}.colors`)}${kindName[p.kind] ? `<button class="btn small" type="button" data-same-kind="${e(p.key)}">Use these colors on all ${kindName[p.kind]}</button>` : ''}<button class="btn small" type="button" data-page-done>Done</button></div>` : ''}
</div>`;
  }).join('');
  L.applyDataCss(wrap);
  for (const [key, cls] of Object.entries(built.fit)) $(`.bk-thumb[data-key="${CSS.escape(key)}"] .bk-inner`, wrap)?.classList.add(cls);
  $('#bk-thumbs-card').hidden = false;
}

function wireThumbs() {
  const wrap = $('#bk-thumbs');
  wrap.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.pageMode !== undefined) {
      remember(JSON.stringify(S));
      const key = el.dataset.pageMode;
      if (!el.value) delete S.style.pages[key];
      else S.style.pages[key] = { mode: el.value, colors: S.style.pages[key]?.colors || JSON.parse(JSON.stringify(S.style.colors)) };
      selKey = el.value === 'custom' ? key : null;
      save();
      renderBook();
      return;
    }
    if (el.dataset.path) { remember(JSON.stringify(S)); set(S, el.dataset.path, el.value); save(); scheduleRender(); }
  });
  wrap.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b?.dataset.pageDone !== undefined) { selKey = null; renderThumbs(); return; }
    if (b?.dataset.sameKind) {
      remember(JSON.stringify(S));
      const from = built.interior.pages.find((p) => p.key === b.dataset.sameKind);
      for (const p of built.interior.pages) if (p.kind === from.kind) S.style.pages[p.key] = JSON.parse(JSON.stringify(S.style.pages[from.key]));
      save(); renderBook();
      h.toast('Done. Every page of that kind now has these colors.');
      return;
    }
    const thumb = ev.target.closest('.bk-thumb');
    if (thumb && !ev.target.closest('select, .card') && S.style.pages[thumb.dataset.key]?.mode === 'custom') { selKey = thumb.dataset.key; renderThumbs(); }
  });
}

function renderChecks() {
  const list = built ? L.kdpChecks(S, built.interior, { overflow: built.overflow, measured: true }) : [];
  const cover = L.coverChecks(S, pageCount());
  $('#bk-checks').innerHTML = [...list, ...cover].map((c) => `<li class="${c.level}">${e(c.text)}</li>`).join('');
}

const pageCount = () => (built?.interior ? built.interior.pages.length : Number(S.cover.pageCount) || 108);

function money() {
  const n = pageCount();
  const cost = L.printingCost(S, n);
  const r = L.royalty(Number(S.listing.price), cost, S.listing.expanded);
  const min = L.minimumPrice(cost, S.listing.expanded);
  const usd = (v) => (v == null ? 'Check KDP' : `$${v.toFixed(2)}`);
  $('#bk-money').innerHTML = h.tile('Pages', h.fmt(n), built ? '' : 'estimate until built')
    + h.tile('Printing cost', usd(cost), `${L.isLarge(S) ? 'large' : 'regular'} trim, ${L.INKS[S.format.ink].toLowerCase()}`)
    + h.tile('You earn per sale', r ? usd(r.amazon) : 'Check KDP', r ? `${Math.round(r.rate * 100)}% of $${Number(S.listing.price).toFixed(2)}, less printing` : '')
    + (S.listing.expanded ? h.tile('Expanded Distribution', r ? usd(r.expanded) : '–', '40% less printing') : '')
    + h.tile('Lowest price KDP allows', usd(min), 'Amazon.com');
}

// ---------------------------------------------------------------- printing

let pageSheet = null;
function setPageSize(w, hgt) {
  if (!pageSheet) { pageSheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet]; }
  pageSheet.replaceSync(`@page { size: ${w}in ${hgt}in; margin: 0; }`);
}
function print(html, w, hgt, title) {
  const root = printRoot();
  if (html !== null) { root.innerHTML = html; L.applyDataCss(root); }
  setPageSize(w, hgt);
  const old = document.title;
  document.title = title;
  document.documentElement.classList.add('bk-printing');
  const done = () => {
    document.documentElement.classList.remove('bk-printing');
    document.title = old;
    removeEventListener('afterprint', done);
    if (html !== null && built) renderBook(); // put the interior back for the next print
  };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
const fileTitle = (what) => `${S.book.title} ${S.book.volume} ${what}`.replace(/[^\w ]+/g, '').trim();

// ---------------------------------------------------------------- cover

function renderCover() {
  const frame = $('#bk-cover');
  if (!frame) return;
  const g = L.coverGeometry(S, pageCount());
  const fit = Math.min(1, (frame.clientWidth - 24) / (g.pageW * 96)) || 0.4;
  frame.innerHTML = `<div class="bk-zoomed" data-css="--zoom:${fit.toFixed(4)}">${L.coverMarkup(S, pageCount())}</div>`;
  L.applyDataCss(frame);
  $('#bk-cover-size').textContent = `${g.w.toFixed(3)}" × ${g.h.toFixed(3)}" with bleed · spine ${g.spine.toFixed(3)}" (${pageCount()} pages)`;
  renderChecks();
  coverDpi();
}

// ---------------------------------------------------------------- books database

const VERDICT = { clear: ['ok', 'Clear'], check: ['warn', 'Check'], problem: ['bad', 'Problem'] };
const verdictBadge = (v) => (v ? `<span class="badge ${VERDICT[v][0]}">${VERDICT[v][1]}</span>` : '<span class="badge">Not scanned</span>');
const STATUS = { draft: 'Draft', published: 'Published', retired: 'Retired' };

async function loadBooks() {
  try {
    books = (await h.api('books')).books;
  } catch (err) {
    $('#bk-db').innerHTML = `<p class="error">${e(err.message)}</p>`;
    return;
  }
  renderBooks();
}

function renderBooks() {
  const parents = books.filter((b) => b.status !== 'draft');
  $('#bk-parent').innerHTML = `<option value="">A new book</option>${parents.map((b) => `<option value="${b.id}">Updated edition of ${e([b.title, b.volume, b.edition].filter(Boolean).join(' · '))}</option>`).join('')}`;
  $('#bk-db').innerHTML = books.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Book</th><th>Status</th><th>Pages</th><th>Puzzles</th><th>Scan</th><th>Made</th><th></th></tr></thead><tbody>
${books.map((b) => `<tr><td><b>${e(b.title)}</b><br><small class="muted">${e([b.volume, b.edition, b.trim, b.ink && L.INKS[b.ink]].filter(Boolean).join(' · '))}</small></td><td>${STATUS[b.status] || e(b.status)}</td><td>${h.fmt(b.pages)}</td><td>${h.fmt(b.puzzles)}</td>
<td>${verdictBadge(b.ipVerdict)}${b.problems ? ` <small>${b.problems} problem</small>` : ''}${b.checks ? ` <small>${b.checks} to check</small>` : ''}</td><td>${h.when(b.createdAt)}<br><small class="muted">${e(b.createdBy || '')}</small></td>
<td><button class="btn small" type="button" data-book-open="${b.id}">Open</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No books yet. Make a book above, then save it here. Save Volume 1 first (the starting settings make it again exactly), as Published, so later books never reuse its puzzles.</p>';
}

async function showBook(id) {
  const d = await h.api(`books/${id}`);
  openBook = d;
  const b = d.book;
  const finding = (f) => `<div class="bk-finding"><b>${e(f.term)}</b> <small class="muted">(${e(f.field)}, ${e(f.source)})</small> – ${e(f.why)}${f.link ? ` <a href="${e(f.link)}" target="_blank" rel="noopener">Check</a>` : ''}</div>`;
  $('#bk-book').hidden = false;
  $('#bk-book').innerHTML = `<div class="row"><h3>${e(b.title)} ${e([b.volume, b.edition].filter(Boolean).join(' · '))}</h3></div>
<dl class="bk-kv"><dt>Status</dt><dd>${STATUS[b.status]}</dd><dt>Series</dt><dd>${e(b.series || '–')}</dd><dt>Pages</dt><dd>${h.fmt(b.pages)}</dd><dt>ISBN</dt><dd>${e(b.isbn || 'KDP’s free ISBN')}</dd>
<dt>Made</dt><dd>${h.when(b.createdAt)} by ${e(b.createdBy || '')}</dd><dt>Published</dt><dd>${h.when(b.publishedAt)}</dd><dt>Last scan</dt><dd>${h.when(b.ipScanAt)} ${verdictBadge(b.ipVerdict)}</dd>
${b.parentId ? `<dt>Updates</dt><dd>book ${b.parentId}</dd>` : ''}${d.laterEditions.length ? `<dt>Later editions</dt><dd>${d.laterEditions.map((x) => e([x.title, x.volume, x.edition].filter(Boolean).join(' · '))).join(', ')}</dd>` : ''}
${b.notes ? `<dt>Notes</dt><dd>${e(b.notes)}</dd>` : ''}</dl>
<div class="row">
<button class="btn small primary" type="button" data-book-scan="${b.id}">Scan every puzzle</button>
${b.status !== 'published' ? `<button class="btn small" type="button" data-book-status="published">Mark published</button>` : ''}
${b.status === 'published' ? `<button class="btn small" type="button" data-book-status="retired">Mark retired</button>` : ''}
<button class="btn small" type="button" data-book-edit>Change details</button>
${d.settings ? '<button class="btn small" type="button" data-book-settings>Use its settings</button>' : ''}
${b.status === 'draft' ? `<button class="btn small danger" type="button" data-book-delete>Delete draft</button>` : ''}
<button class="btn small" type="button" data-book-close>Close</button></div>
<p class="muted">The scan checks each puzzle’s words against a list of trademarks, protected characters and real places, and asks the AI reviewer when it is set up. It is a screening aid, not legal clearance.</p>
<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Puzzle</th><th>Level</th><th>Theme</th><th>Scan</th></tr></thead><tbody>
${d.puzzles.map((p) => `<tr><td>${p.position}</td><td><b>${e(p.title)}</b><br><small class="muted">${e(p.storyId)}</small></td><td>${e(p.tier)}<br><small class="muted">${e(p.size)}</small></td><td>${e(p.theme)}${p.topic ? `<br><small class="muted">${e(p.topic)}</small>` : ''}</td>
<td>${verdictBadge(p.ipVerdict)}${(p.ipScan?.findings || []).map(finding).join('')}${p.ipScan?.notes?.length && p.position === 1 ? `<div class="bk-finding muted">${e(p.ipScan.notes.join(' '))}</div>` : ''}</td></tr>`).join('')}
</tbody></table></div>`;
  $('#bk-book').scrollIntoView({ block: 'start' });
}

async function saveBook(button) {
  if (!built || stale) { h.toast('Make the book first, with the current settings.'); return; }
  const parentId = Number($('#bk-parent').value) || null;
  const parent = books.find((b) => b.id === parentId);
  const body = {
    title: S.book.title, volume: S.book.volume, edition: S.book.edition, series: $('#bk-series').value.trim() || parent?.series || S.book.title,
    status: $('#bk-save-status').value, parentId, isbn: S.book.isbn, pages: built.interior.pages.length, trim: S.format.trim, ink: S.format.ink,
    notes: $('#bk-notes').value.trim(), settings: { ...S, cover: { ...S.cover, image: '' } },
    puzzles: built.puzzles.map((p, i) => L.puzzleRecord(p, i + 1)),
  };
  await h.act(button, async () => {
    const r = await h.api('books', { method: 'POST', body });
    if (r.draftOverlap?.length) h.toast(`Saved. ${r.draftOverlap.length} puzzles are also in draft books.`);
    await loadBooks();
    $('#bk-scan-status').textContent = 'Saved. Scanning every puzzle for trademark and copyright problems…';
    try {
      const s = await h.api(`books/${r.id}/scan`, { method: 'POST' });
      $('#bk-scan-status').textContent = `Scan done: ${s.counts.clear} clear, ${s.counts.check} to check, ${s.counts.problem} problems.${s.notes.length ? ` ${s.notes.join(' ')}` : ''}`;
    } catch (err) { $('#bk-scan-status').textContent = `Saved, but the scan did not finish: ${err.message} Open the book and press Scan every puzzle.`; }
    await loadBooks();
    await showBook(r.id);
  }, 'Book saved in the books database.');
}

function wireDb() {
  $('#bk-save-btn').onclick = (ev) => saveBook(ev.currentTarget);
  $('#bk-dbcard').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.bookOpen) { await h.act(b, () => showBook(Number(b.dataset.bookOpen))); return; }
    const id = openBook?.book.id;
    if (!id) return;
    if (b.dataset.bookScan) {
      await h.act(b, async () => {
        b.textContent = 'Scanning…';
        const s = await h.api(`books/${id}/scan`, { method: 'POST' });
        h.toast(`Scan done: ${s.counts.clear} clear, ${s.counts.check} to check, ${s.counts.problem} problems.`);
        await loadBooks(); await showBook(id);
      });
      return;
    }
    if (b.dataset.bookStatus) {
      await h.act(b, async () => { await h.api(`books/${id}`, { method: 'POST', body: { status: b.dataset.bookStatus } }); await loadBooks(); await showBook(id); }, `Marked ${STATUS[b.dataset.bookStatus].toLowerCase()}.`);
      return;
    }
    if (b.dataset.bookEdit !== undefined) {
      const x = openBook.book;
      const v = await h.ask({ title: 'Change book details', fields: [
        { name: 'title', label: 'Title', value: x.title }, { name: 'volume', label: 'Volume', value: x.volume || '' }, { name: 'edition', label: 'Edition', value: x.edition || '' },
        { name: 'series', label: 'Series', value: x.series || '' }, { name: 'isbn', label: 'ISBN', value: x.isbn || '' }, { name: 'notes', label: 'Notes', type: 'textarea', value: x.notes || '' }], ok: 'Save' });
      if (v) await h.act(b, async () => { await h.api(`books/${id}`, { method: 'POST', body: v }); await loadBooks(); await showBook(id); }, 'Saved.');
      return;
    }
    if (b.dataset.bookSettings !== undefined) { remember(JSON.stringify(S)); restore(JSON.stringify(L.normalize(openBook.settings))); h.toast('Its settings are loaded. Make the book to see it (used puzzles are left out, so the puzzles will be new).'); return; }
    if (b.dataset.bookDelete !== undefined) {
      const ok = await h.ask({ title: 'Delete this draft?', text: 'The draft and its puzzle list are removed. Its puzzles can be used again.', ok: 'Delete', danger: true });
      if (ok) await h.act(b, async () => { await h.api(`books/${id}/delete`, { method: 'POST' }); $('#bk-book').hidden = true; openBook = null; await loadBooks(); }, 'Draft deleted.');
      return;
    }
    if (b.dataset.bookClose !== undefined) { $('#bk-book').hidden = true; openBook = null; }
  });
}

// ---------------------------------------------------------------- view

function shell() {
  $('#bk-root').innerHTML = `
<div class="row bk-toolbar"><button class="btn small" type="button" id="bk-undo" disabled>Undo</button><button class="btn small" type="button" id="bk-redo" disabled>Redo</button>
<span class="muted">Changes are kept on this device as you go.</span></div>
<div class="bk-layout">
  <div class="bk-panel stack" id="bk-panel"></div>
  <div class="stack">
    <section class="card stack" id="bk-build-card" aria-labelledby="bk-build-h"><h2 id="bk-build-h">Make and print</h2>
      <div class="row"><button class="btn primary" type="button" id="bk-build">Make the book</button><button class="btn" type="button" id="bk-print-btn" disabled>Print or save interior as PDF</button><button class="btn" type="button" id="bk-cover-btn">Print or save cover as PDF</button></div>
      <progress id="bk-progress" class="bk-progress" hidden></progress>
      <p id="bk-status" class="muted" role="status">Press Make the book. The starting settings make Volume 1 again, exactly.</p>
      <p class="muted">To save a PDF: choose <b>Save as PDF</b> as the printer, Margins <b>None</b>, and turn on <b>Background graphics</b>. The page size is set for you.</p>
      <div class="tiles" id="bk-money"></div>
      <h3>KDP checks</h3><ul class="bk-checks" id="bk-checks"></ul>
    </section>
    <section class="card stack" id="bk-thumbs-card" hidden aria-labelledby="bk-pages-h"><div class="row"><h2 id="bk-pages-h">Pages</h2>
      <div class="field inline"><label for="bk-zoom">Size</label><select id="bk-zoom"><option value="0.18">Small</option><option value="0.28" selected>Medium</option><option value="0.45">Large</option><option value="0.7">Very large</option></select></div></div>
      <p class="muted">Each page can use the book’s colors, black and white, or its own colors (choose Own colors, then change them under the page).</p>
      <div class="bk-thumbs" id="bk-thumbs"></div></section>
    <section class="card stack" aria-labelledby="bk-cover-h"><h2 id="bk-cover-h">Cover</h2><p class="muted" id="bk-cover-size"></p>
      <p class="muted">Pink dashes: trim line (everything outside is cut off). Blue dashes: the spine. Keep words at least 0.25" inside the trim line.</p>
      <div class="bk-cover-frame" id="bk-cover"></div></section>
    <section class="card stack" id="bk-dbcard" aria-labelledby="bk-db-h"><h2 id="bk-db-h">Books database</h2>
      <p class="muted">Every saved book keeps a list of its puzzles. New books leave those puzzles out, so no puzzle is printed twice, and an updated edition always gets new puzzles. Each puzzle is scanned for trademark and copyright problems when a book is saved.</p>
      <div class="row"><div class="field"><label for="bk-parent">This book is</label><select id="bk-parent"><option value="">A new book</option></select></div>
      <div class="field"><label for="bk-save-status">Status</label><select id="bk-save-status"><option value="draft">Draft</option><option value="published">Published</option></select></div>
      <div class="field grow"><label for="bk-series">Series</label><input id="bk-series" placeholder="Empty: the book title, or the earlier edition’s series"></div></div>
      <div class="field"><label for="bk-notes">Notes</label><input id="bk-notes" maxlength="2000"></div>
      <div class="row"><button class="btn primary" type="button" id="bk-save-btn" disabled>Save this book in the database</button></div>
      <p id="bk-scan-status" class="muted" role="status"></p>
      <div id="bk-db"><p class="muted">Loading…</p></div>
      <div id="bk-book" class="card stack" hidden></div></section>
  </div>
</div>`;
  renderPanel();
  wirePanel();
  wireThumbs();
  wireDb();
  $('#bk-build').onclick = (ev) => build(ev.currentTarget);
  $('#bk-print-btn').onclick = () => {
    if (!built) return;
    const g = L.geometry(S);
    if (stale) h.toast('Printing the book as last made. Make it again to use the new puzzle settings.');
    print(null, g.pageW, g.pageH, fileTitle('interior'));
  };
  $('#bk-cover-btn').onclick = () => {
    const g = L.coverGeometry(S, pageCount());
    const html = L.coverMarkup({ ...S, cover: { ...S.cover, guides: false } }, pageCount());
    print(html, g.pageW, g.pageH, fileTitle('cover'));
  };
  $('#bk-zoom').onchange = () => built && renderThumbs();
  $('#bk-undo').onclick = () => { if (!past.length) return; future.push(JSON.stringify(S)); restore(past.pop()); undoButtons(); };
  $('#bk-redo').onclick = () => { if (!future.length) return; past.push(JSON.stringify(S)); restore(future.pop()); undoButtons(); };
  addEventListener('resize', () => { clearTimeout(renderTimer); renderTimer = setTimeout(renderCover, 200); });
}

function refreshAll() {
  if (built && !stale) renderBook(); else renderChecks();
  renderCover();
  money();
}

export async function booksView(helpers) {
  h = helpers;
  if (!shown) {
    S = load();
    E = await import('./engine/index.js');
    shell();
    shown = true;
    refreshAll();
  } else renderCover();
  loadBooks();
}
