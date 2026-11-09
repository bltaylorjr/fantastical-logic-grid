// Amazon KDP (admin > Amazon KDP, server/src/kdp.js): one listing per book and
// format, kept here the way KDP's three setup tabs ask for it, so it can be
// checked before it is typed into KDP and copied across box by box. Then where
// it is on KDP (planning to live), the upload steps, and what it sold each
// month from KDP's royalty report. KDP has no API, so nothing here changes KDP.
import {
  FORMATS, INKS, TRIMS, STATUSES, LIMITS, AI_TEXT, AI_IMAGES, RATES_CHECKED,
  checkListing, printingCost, royalty, isLarge,
} from './kdp-calc.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let h = null; // helpers from admin.js
let data = null; // GET kdp
let cur = null; // the listing open in the editor: { id, bookId, format, status, asin, isbn, listing }
let saved = ''; // the open listing as last saved, to tell when there are changes
let sales = [];
let serverReview = null;

const KDP = {
  bookshelf: 'https://kdp.amazon.com/en_US/bookshelf',
  reports: 'https://kdp.amazon.com/en_US/reports-new',
  categories: 'https://kdp.amazon.com/en_US/help/topic/G200652170',
  keywords: 'https://kdp.amazon.com/en_US/help/topic/G201298500',
  ai: 'https://kdp.amazon.com/en_US/help/topic/G200672390',
  cost: 'https://kdp.amazon.com/en_US/help/topic/G201834340',
};
const STEPS = [
  ['interior', 'Interior PDF made in Book Studio (Export > Amazon KDP) and uploaded'],
  ['cover', 'Cover PDF (full wrap, spine from the page count) uploaded'],
  ['previewer', 'KDP’s print previewer shows no problems'],
  ['ai', 'AI-generated content questions answered on the Content tab'],
  ['proof', 'Proof copy ordered and checked page by page'],
  ['submit', 'Published on KDP (it goes to review, usually up to 72 hours)'],
  ['asin', 'Live on Amazon: ASIN entered above, page checked'],
  ['author', 'Added to the Author Central page'],
];
const STATUS_BADGE = { planning: '', draft: 'warn', review: 'warn', live: 'ok', unpublished: 'bad' };

const money = (v) => (v == null || Number.isNaN(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`);
const blank = () => ({
  id: null, bookId: null, format: 'paperback', status: 'planning', asin: '', isbn: '',
  listing: {
    title: '', subtitle: '', series: '', seriesNo: '', edition: '', author: 'Bobby Taylor', contributors: '', description: '',
    keywords: Array(LIMITS.keywords).fill(''), categories: Array(LIMITS.categories).fill(''), readingMin: '', readingMax: '',
    ai: { text: '', images: '', translations: '' }, print: { ink: 'black', trim: '8.5x11', paper: 'white', pages: 0, finish: 'matte', bleed: false },
    price: { usd: 0, expanded: false }, steps: {}, notes: '',
  },
});
const dirty = () => cur && JSON.stringify(read()) !== saved;
const canEdit = () => h.can('admin');

// ---------------------------------------------------------------- list
function listRows() {
  const e = h.esc;
  if (!data.listings.length) return `<tr><td colspan="6" class="muted">No listings yet.${canEdit() ? ' Press <b>New listing</b> to start one, or pick a Grid book to fill it in.' : ''}</td></tr>`;
  return data.listings.map((l) => `<tr${cur?.id === l.id ? ' aria-current="true"' : ''}>
    <td><button class="btn small" type="button" data-kdp-open="${e(l.id)}">Open</button></td>
    <td><b>${e(l.title)}</b><br><small class="muted">${e(FORMATS[l.format] || l.format)}${l.asin ? ` · ASIN ${e(l.asin)}` : ''} · changed ${h.when(l.updatedAt)}</small></td>
    <td><span class="badge ${STATUS_BADGE[l.status] || ''}">${e(STATUSES[l.status] || l.status)}</span><br>${l.ready ? '<small class="ok-text">Ready for KDP</small>' : `<small class="muted">${h.fmt(l.problems)} to fix</small>`}</td>
    <td>${l.money ? `${money(l.listing.price.usd)}<br><small class="muted">${money(l.money.amazon)} a copy</small>` : '—'}</td>
    <td>${h.fmt(l.units)}</td>
    <td>${money(l.royaltyCents / 100)}${l.lastMonth ? `<br><small class="muted">to ${e(l.lastMonth)}</small>` : ''}</td>
  </tr>`).join('');
}

function summary() {
  const live = data.listings.filter((l) => l.status === 'live').length;
  const units = data.listings.reduce((s, l) => s + l.units, 0);
  const total = data.listings.reduce((s, l) => s + l.royaltyCents, 0) / 100;
  const last = data.months[data.months.length - 1];
  $('#kdp-tiles').innerHTML = h.tile('Listings', h.fmt(data.listings.length), `${h.fmt(data.listings.filter((l) => l.ready).length)} ready for KDP`)
    + h.tile('Live on Amazon', h.fmt(live))
    + h.tile('Copies sold', h.fmt(units), 'from the months entered')
    + h.tile('Royalties', money(total), units ? `${money(total / units)} a copy on average` : '')
    + (last ? h.tile(`Royalties, ${last.month}`, money(last.royalty_cents / 100), `${h.fmt(last.units)} copies`) : '');
  $('#kdp-chart').innerHTML = data.months.length > 1
    ? h.bars('Royalties per month (USD)', data.months.map((m) => m.royalty_cents / 100), { labels: data.months.map((m) => m.month) })
    : '';
}

export async function kdpView(helpers, { arg } = {}) {
  h = helpers;
  data = await h.api('kdp');
  $('#kdp-new').hidden = !canEdit();
  summary();
  $('#kdp-rows').innerHTML = listRows();
  if (arg && arg !== cur?.id) await open(arg);
  else if (cur && !cur.id) render();
}

// ---------------------------------------------------------------- editor
const field = (id, label, value, { max, type = 'text', help = '', counter = false, copy = false, attrs = '' } = {}) => {
  const e = h.esc;
  return `<div class="field grow"><label for="${id}">${e(label)}</label>
    <div class="kdp-in">${type === 'textarea'
      ? `<textarea id="${id}" rows="8"${max ? ` data-max="${max}"` : ''} ${attrs}>${e(value)}</textarea>`
      : `<input id="${id}" type="${type}" value="${e(value)}" autocomplete="off"${max ? ` data-max="${max}"` : ''} ${attrs}>`}
    ${copy ? `<button class="btn small" type="button" data-kdp-copy="${id}" aria-label="Copy ${e(label)}">Copy</button>` : ''}</div>
    ${counter ? `<small class="muted kdp-count" data-for="${id}"></small>` : ''}${help ? `<small class="muted">${help}</small>` : ''}</div>`;
};
const select = (id, label, value, options, help = '') => `<div class="field grow"><label for="${id}">${h.esc(label)}</label><select id="${id}">${options.map(([v, l]) => `<option value="${h.esc(v)}"${v === value ? ' selected' : ''}>${h.esc(l)}</option>`).join('')}</select>${help ? `<small class="muted">${help}</small>` : ''}</div>`;
const group = (key, title, body, open = false) => `<details class="web-cat kdp-group" data-group="${key}"${open ? ' open' : ''}><summary><span>${title}</span><span class="web-count" data-group-state="${key}"></span></summary><div class="stack kdp-body">${body}</div></details>`;

function render() {
  const e = h.esc;
  const l = cur.listing;
  const books = [['', 'Not linked'], ...data.books.map((b) => [b.id, `${b.title}${b.subtitle ? `: ${b.subtitle}` : ''} (${b.trim.replace('x', ' × ')} in, ${b.pages} pages${b.status === 'published' ? ', published' : ''})`])];
  const linked = data.books.find((b) => b.id === cur.bookId);
  const aiOpts = (list) => [['', 'Not answered yet'], ...list];
  $('#kdp-editor').hidden = false;
  $('#kdp-editor').innerHTML = `
    <div class="head"><h2 id="kdp-ed-title">${cur.id ? e(l.title || 'Listing') : 'New listing'}</h2>
      <div class="row">${cur.asin ? `<a class="btn small" href="https://www.amazon.com/dp/${e(cur.asin)}" target="_blank" rel="noopener">Open on Amazon</a>` : ''}
      <a class="btn small" href="${KDP.bookshelf}" target="_blank" rel="noopener">KDP Bookshelf</a></div></div>
    <div id="kdp-check" aria-live="polite"></div>
    ${group('book', 'Book and status', `
      <div class="row">${select('kdp-book', 'Grid book (from Book Studio’s Grid books)', cur.bookId || '', books)}
        ${canEdit() ? '<button class="btn" type="button" id="kdp-fill">Fill in from the Grid book</button>' : ''}</div>
      ${linked ? `<p class="muted">Make the interior and cover PDFs in <a href="/admin/book-studio/#gridbooks">Book Studio</a>: open this book in the editor, choose Amazon KDP and export the submission packet.</p>` : ''}
      <div class="row">${select('kdp-format', 'Format', cur.format, Object.entries(FORMATS))}
        ${select('kdp-status', 'Where it is on KDP', cur.status, Object.entries(STATUSES))}</div>
      <div class="row">${field('kdp-asin', 'ASIN (once it is live)', cur.asin, { max: 10, attrs: 'spellcheck="false" placeholder="B0…"' })}
        ${field('kdp-isbn', 'ISBN (blank: KDP gives a free one)', cur.isbn, { max: 17, attrs: 'spellcheck="false" inputmode="numeric"' })}</div>
      ${cur.liveAt ? `<p class="muted">First went live ${h.when(cur.liveAt)}.</p>` : ''}`, !cur.id)}
    ${group('details', 'Details (KDP’s first tab)', `
      ${field('kdp-title', 'Title', l.title, { counter: true, copy: true })}
      ${field('kdp-subtitle', 'Subtitle', l.subtitle, { counter: true, copy: true, help: `Title and subtitle together: up to ${LIMITS.titleSubtitle} characters.` })}
      <div class="row">${field('kdp-series', 'Series (optional)', l.series, { copy: true })}${field('kdp-series-no', 'Number in series', l.seriesNo, { attrs: 'inputmode="numeric"' })}${field('kdp-edition', 'Edition number', l.edition, { attrs: 'inputmode="numeric"' })}</div>
      <div class="row">${field('kdp-author', 'Author', l.author, { copy: true })}${field('kdp-contributors', 'Contributors (optional)', l.contributors)}</div>
      ${field('kdp-desc', 'Description', l.description, { type: 'textarea', max: LIMITS.description, counter: true, copy: true, help: 'Plain text. KDP also takes simple formatting (bold, italics, lists) in its own box.' })}
      <div class="row">${field('kdp-age-min', 'Reading age, from (optional)', l.readingMin, { attrs: 'inputmode="numeric"' })}${field('kdp-age-max', 'to', l.readingMax, { attrs: 'inputmode="numeric"' })}</div>`)}
    ${group('keywords', 'Keywords and categories', `
      <p class="muted">Seven boxes of up to ${LIMITS.keyword} characters, words that shoppers type. Leave out words already in the title, claims like "bestseller" or "free", and other people’s brands. <a href="${KDP.keywords}" target="_blank" rel="noopener">KDP’s keyword rules</a></p>
      ${l.keywords.map((k, i) => field(`kdp-kw-${i}`, `Keyword ${i + 1}`, k, { counter: true, copy: true })).join('')}
      <p class="muted">Up to ${LIMITS.categories} categories, chosen in KDP’s picker; copy the path you chose here. <a href="${KDP.categories}" target="_blank" rel="noopener">Choosing categories</a></p>
      ${l.categories.map((c, i) => field(`kdp-cat-${i}`, `Category ${i + 1}`, c, { attrs: 'placeholder="Books > Humor & Entertainment > Puzzles & Games > Logic & Brain Teasers"' })).join('')}`)}
    ${group('ai', 'AI-generated content (KDP’s second tab)', `
      <p class="muted">KDP asks whether AI made any of the book’s words, pictures or translation, even if they were edited afterwards. Puzzles the game’s engine builds are not AI. Story parts drafted by the AI writer (Gemini) count as AI text, and AI theme pictures or portraits (Workers AI) count as AI images, on the cover too. <a href="${KDP.ai}" target="_blank" rel="noopener">KDP’s AI rules</a></p>
      ${select('kdp-ai-text', 'Text', l.ai.text, aiOpts(AI_TEXT))}
      ${select('kdp-ai-images', 'Images', l.ai.images, aiOpts(AI_IMAGES))}
      ${select('kdp-ai-tr', 'Translations', l.ai.translations, aiOpts(AI_TEXT))}`)}
    ${group('price', 'Print and price (KDP’s third tab)', `
      <div class="row">${select('kdp-ink', 'Ink', l.print.ink, Object.entries(INKS))}${select('kdp-trim', 'Trim size', l.print.trim, TRIMS.map((t) => [t, `${t.replace('x', ' × ')} in${isLarge(t) ? ' (large trim)' : ''}`]))}${select('kdp-paper', 'Paper', l.print.paper, [['white', 'White'], ['cream', 'Cream']])}</div>
      <div class="row">${field('kdp-pages', 'Page count', String(l.print.pages || ''), { type: 'number', attrs: 'min="24" max="828" step="2"' })}${select('kdp-finish', 'Cover finish', l.print.finish, [['matte', 'Matte'], ['glossy', 'Glossy']])}
        <label class="check"><input type="checkbox" id="kdp-bleed"${l.print.bleed ? ' checked' : ''}> Interior has bleed</label></div>
      <div class="row">${field('kdp-price', 'List price, Amazon.com (USD)', l.price.usd ? l.price.usd.toFixed(2) : '', { type: 'number', attrs: 'min="0" max="250" step="0.01" inputmode="decimal"' })}
        <label class="check"><input type="checkbox" id="kdp-expanded"${l.price.expanded ? ' checked' : ''}> Expanded Distribution (bookstores and libraries)</label></div>
      <div id="kdp-money" class="kdp-money" aria-live="polite"></div>
      <p class="muted">Amazon.com figures from <a href="${KDP.cost}" target="_blank" rel="noopener">KDP’s printing cost tables</a>, checked ${RATES_CHECKED}. KDP’s own calculator has the final word, and other marketplaces differ.</p>`)}
    ${group('steps', 'Upload steps', `<div class="stack">${STEPS.map(([k, t]) => `<label class="check"><input type="checkbox" data-kdp-step="${k}"${l.steps[k] ? ' checked' : ''}> ${e(t)}</label>`).join('')}</div>`)}
    ${group('sales', 'Sales by month', cur.id ? salesBody() : '<p class="muted">Save the listing first, then add each month from KDP’s royalty report.</p>')}
    ${group('notes', 'Notes', field('kdp-notes', 'Notes for you', l.notes, { type: 'textarea' }))}
    <p class="error" id="kdp-error" role="alert" hidden></p>
    <div class="row">${canEdit() ? `<button class="btn primary" type="button" id="kdp-save">Save</button>
      <button class="btn" type="button" id="kdp-discard">Discard changes</button>
      ${cur.id ? '<button class="btn danger" type="button" id="kdp-delete">Delete listing</button>' : ''}` : ''}
      <button class="btn" type="button" id="kdp-close">Close</button></div>`;
  if (!canEdit()) $$('#kdp-editor input, #kdp-editor select, #kdp-editor textarea').forEach((x) => { x.disabled = true; });
  update();
}

function salesBody() {
  const e = h.esc;
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const def = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  const max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const units = sales.reduce((s, r) => s + r.units, 0);
  const total = sales.reduce((s, r) => s + r.royalty_cents, 0) / 100;
  return `<p class="muted">From KDP’s <a href="${KDP.reports}" target="_blank" rel="noopener">Reports</a> (Royalties, by month, USD). Entering a month again replaces it.</p>
    ${canEdit() ? `<div class="row"><div class="field"><label for="kdp-s-month">Month</label><input id="kdp-s-month" type="month" value="${def}" max="${max}"></div>
      <div class="field"><label for="kdp-s-units">Copies sold</label><input id="kdp-s-units" type="number" min="0" step="1" inputmode="numeric"></div>
      <div class="field"><label for="kdp-s-royalty">Royalty (USD)</label><input id="kdp-s-royalty" type="number" step="0.01" inputmode="decimal"></div>
      <button class="btn" type="button" id="kdp-s-add">Add month</button></div>` : ''}
    ${sales.length ? `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Month</th><th scope="col">Copies</th><th scope="col">Royalty</th><th scope="col">A copy</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${sales.map((r) => `<tr><td>${e(r.month)}</td><td>${h.fmt(r.units)}</td><td>${money(r.royalty_cents / 100)}</td><td>${r.units ? money(r.royalty_cents / 100 / r.units) : '—'}</td>
        <td>${canEdit() ? `<button class="btn small danger" type="button" data-kdp-sale-del="${e(r.month)}">Delete</button>` : ''}</td></tr>`).join('')}
      <tr><th scope="row">All months</th><th>${h.fmt(units)}</th><th>${money(total)}</th><th>${units ? money(total / units) : '—'}</th><td><button class="btn small" type="button" id="kdp-s-csv">Download CSV</button></td></tr>
      </tbody></table></div>` : '<p class="muted">No months entered yet.</p>'}`;
}

// The form as a listing, the shape the server saves.
function read() {
  if (!$('#kdp-title')) return cur;
  const v = (id) => $(`#${id}`)?.value ?? '';
  return {
    id: cur.id, bookId: v('kdp-book') || null, format: v('kdp-format'), status: v('kdp-status'), asin: v('kdp-asin').trim(), isbn: v('kdp-isbn').trim(),
    listing: {
      title: v('kdp-title'), subtitle: v('kdp-subtitle'), series: v('kdp-series'), seriesNo: v('kdp-series-no'), edition: v('kdp-edition'),
      author: v('kdp-author'), contributors: v('kdp-contributors'), description: v('kdp-desc'),
      keywords: Array.from({ length: LIMITS.keywords }, (_, i) => v(`kdp-kw-${i}`)),
      categories: Array.from({ length: LIMITS.categories }, (_, i) => v(`kdp-cat-${i}`)),
      readingMin: v('kdp-age-min'), readingMax: v('kdp-age-max'),
      ai: { text: v('kdp-ai-text'), images: v('kdp-ai-images'), translations: v('kdp-ai-tr') },
      print: { ink: v('kdp-ink'), trim: v('kdp-trim'), paper: v('kdp-paper'), pages: Number(v('kdp-pages')) || 0, finish: v('kdp-finish'), bleed: !!$('#kdp-bleed')?.checked },
      price: { usd: Math.round((Number(v('kdp-price')) || 0) * 100) / 100, expanded: !!$('#kdp-expanded')?.checked },
      steps: Object.fromEntries($$('[data-kdp-step]').map((c) => [c.dataset.kdpStep, c.checked])),
      notes: v('kdp-notes'),
    },
  };
}

// Counters, the price box and the check, as you type.
function update() {
  const now = read();
  const l = now.listing;
  const both = l.title.trim().length + l.subtitle.trim().length;
  $$('.kdp-count').forEach((c) => {
    const id = c.dataset.for;
    const n = $(`#${id}`).value.length;
    const max = id === 'kdp-desc' ? LIMITS.description : id.startsWith('kdp-kw-') ? LIMITS.keyword : LIMITS.titleSubtitle;
    const shown = id === 'kdp-title' || id === 'kdp-subtitle' ? both : n;
    c.textContent = `${h.fmt(shown)} of ${h.fmt(max)}${id === 'kdp-title' || id === 'kdp-subtitle' ? ' (title and subtitle)' : ''}`;
    c.classList.toggle('bad-text', shown > max);
  });
  const pc = printingCost({ ...l.print, format: now.format });
  const box = $('#kdp-money');
  if (pc.error) box.innerHTML = `<p class="bad-text">${h.esc(pc.error)}</p>`;
  else {
    const r = royalty({ price: l.price.usd, cost: pc.cost, expanded: l.price.expanded });
    box.innerHTML = `<div><span>Printing cost</span><b>${money(pc.cost)}</b><small class="muted">${money(pc.fixed)} + ${pc.per ? `${pc.pages} × $${pc.per}` : 'nothing a page'}${pc.large ? ', large trim' : ''}</small></div>
      <div><span>Lowest list price</span><b>${money(r.min)}</b></div>
      <div><span>Royalty a copy on Amazon</span><b>${l.price.usd ? money(r.amazon) : '—'}</b><small class="muted">${Math.round(r.rate * 100)}% of the list price, less printing</small></div>
      ${l.price.expanded ? `<div><span>Royalty a copy, Expanded Distribution</span><b>${l.price.usd ? money(r.expanded) : '—'}</b><small class="muted">40%, less printing</small></div>` : ''}`;
  }
  const c = checkListing({ ...l, print: { ...l.print, format: now.format } });
  const changed = dirty();
  // Watch-list findings come from the server, for the words as last saved.
  const findings = !changed && serverReview ? serverReview.findings : [];
  const items = [...c.problems.map((p) => ['bad', p]), ...findings.map((f) => [f.serious ? 'bad' : 'warn', `${f.field}: "${f.term}" is on the trademark and copyright watch list. ${f.why}`]), ...c.tips.map((t) => ['', t])];
  const ready = !c.problems.length && !findings.some((f) => f.serious);
  $('#kdp-check').innerHTML = `<div class="note${ready ? ' ok' : ''}"><b>${ready ? 'Ready to type into KDP.' : `${h.fmt(c.problems.length + findings.filter((f) => f.serious).length)} to fix before KDP.`}</b>
    ${changed ? ' <span class="badge warn">Not saved</span>' : ''}${changed && cur.id ? ' <small class="muted">The trademark watch list runs again when you save.</small>' : ''}
    ${items.length ? `<ul>${items.map(([k, t]) => `<li${k ? ` class="${k}-text"` : ''}>${h.esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
  // Each group says whether it is done, so the next one to open is obvious.
  const state = {
    book: STATUSES[now.status],
    details: l.title && l.author && l.description ? 'Filled in' : 'To do',
    keywords: `${l.keywords.filter((k) => k.trim()).length} of ${LIMITS.keywords} keywords, ${l.categories.filter((k) => k.trim()).length} of ${LIMITS.categories} categories`,
    ai: ['text', 'images', 'translations'].every((k) => l.ai[k]) ? 'Answered' : 'To do',
    price: pc.error || !l.price.usd ? 'To do' : `${money(l.price.usd)}`,
    steps: `${Object.values(l.steps).filter(Boolean).length} of ${STEPS.length} done`,
    sales: cur.id ? `${h.fmt(sales.reduce((s, r) => s + r.units, 0))} copies` : '',
    notes: l.notes.trim() ? 'Has notes' : '',
  };
  for (const [k, v] of Object.entries(state)) { const el = $(`[data-group-state="${k}"]`); if (el) el.textContent = v; }
}

async function open(id) {
  if (dirty() && !(await h.ask({ title: 'Leave without saving?', text: 'Your changes to this listing will be lost.', ok: 'Leave', danger: true }))) return false;
  if (id) {
    const d = await h.api(`kdp/${id}`);
    cur = { ...d.listing };
    sales = d.sales;
    serverReview = d.review;
  } else { cur = blank(); sales = []; serverReview = null; }
  saved = JSON.stringify({ id: cur.id, bookId: cur.bookId, format: cur.format, status: cur.status, asin: cur.asin, isbn: cur.isbn, listing: cur.listing });
  render();
  saved = JSON.stringify(read()); // the form's own shape, so an untouched form is never "changed"
  update();
  $('#kdp-rows').innerHTML = listRows();
  $('#kdp-editor').scrollIntoView({ block: 'start' });
  $('#kdp-ed-title').focus?.();
  return true;
}

function fillFromBook() {
  const b = data.books.find((x) => x.id === $('#kdp-book').value);
  if (!b) { h.toast('Pick a Grid book first.'); return; }
  const set = (id, v) => { const el = $(`#${id}`); if (el && v != null && v !== '') el.value = v; };
  set('kdp-title', b.title);
  set('kdp-subtitle', b.subtitle);
  set('kdp-author', b.author);
  set('kdp-edition', b.edition > 1 ? String(b.edition) : '');
  set('kdp-series-no', b.volume ? String(b.volume) : '');
  if (TRIMS.includes(b.trim)) set('kdp-trim', b.trim);
  set('kdp-paper', b.paper);
  set('kdp-pages', b.pages ? String(b.pages) : '');
  update();
  h.toast('Filled in from the Grid book. Check it, then Save.');
}

async function save(b) {
  const err = $('#kdp-error');
  err.hidden = true;
  try {
    b.disabled = true;
    const body = read();
    const r = await h.api('kdp', { method: 'POST', body });
    h.toast('Saved.');
    cur.id = r.id;
    saved = JSON.stringify(read());
    data = await h.api('kdp');
    summary();
    history.replaceState(null, '', `#kdp/${r.id}`);
    cur = null;
    await open(r.id);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { b.disabled = false; }
}

async function refreshSales() {
  const [d, all] = await Promise.all([h.api(`kdp/${cur.id}`), h.api('kdp')]);
  sales = d.sales;
  data = all;
  $('[data-group="sales"] .kdp-body').innerHTML = salesBody();
  summary();
  $('#kdp-rows').innerHTML = listRows();
  update();
}

function csv() {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['Month', 'Copies sold', 'Royalty (USD)'], ...[...sales].reverse().map((r) => [r.month, r.units, (r.royalty_cents / 100).toFixed(2)])].map((r) => r.map(q).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv' }));
  a.download = `kdp-sales-${(read().listing.title || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initKdp(helpers, show) {
  h = helpers;
  addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  $('#kdp-new').onclick = () => { history.replaceState(null, '', '#kdp'); open(null); };
  $('#kdp-rows').onclick = (e) => {
    const b = e.target.closest('[data-kdp-open]');
    if (!b) return;
    open(b.dataset.kdpOpen).then((ok) => { if (ok) history.replaceState(null, '', `#kdp/${b.dataset.kdpOpen}`); });
  };
  const ed = $('#kdp-editor');
  ed.addEventListener('input', () => update());
  ed.addEventListener('change', () => update());
  // One group open at a time keeps the page short.
  ed.addEventListener('toggle', (e) => { if (e.target.matches?.('.kdp-group') && e.target.open) $$('.kdp-group[open]', ed).forEach((d) => { if (d !== e.target) d.open = false; }); }, true);
  ed.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.kdpCopy) {
      const v = $(`#${t.dataset.kdpCopy}`).value;
      navigator.clipboard?.writeText(v).then(() => h.toast('Copied. Paste it into the same box on KDP.'), () => h.toast('Select the words and copy them.'));
    } else if (t.id === 'kdp-fill') fillFromBook();
    else if (t.id === 'kdp-save') await save(t);
    else if (t.id === 'kdp-discard') {
      if (!dirty()) { h.toast('Nothing to discard.'); return; }
      const id = cur.id;
      saved = JSON.stringify(read()); // so open() does not ask
      if (id) await open(id); else { cur = null; ed.hidden = true; }
      h.toast('Changes discarded.');
    } else if (t.id === 'kdp-close') {
      if (dirty() && !(await h.ask({ title: 'Close without saving?', text: 'Your changes to this listing will be lost.', ok: 'Close', danger: true }))) return;
      cur = null; ed.hidden = true; ed.innerHTML = '';
      history.replaceState(null, '', '#kdp');
      $('#kdp-rows').innerHTML = listRows();
    } else if (t.id === 'kdp-delete') {
      if (!(await h.ask({ title: 'Delete this listing?', text: 'Its details and every month of sales entered here are deleted for good. Nothing changes on KDP or Amazon.', ok: 'Delete', danger: true }))) return;
      if (await h.act(t, () => h.api(`kdp/${cur.id}/delete`, { method: 'POST' }), 'Listing deleted.')) {
        cur = null; saved = ''; ed.hidden = true; ed.innerHTML = '';
        history.replaceState(null, '', '#kdp');
        show('kdp', { keepFocus: true });
      }
    } else if (t.id === 'kdp-s-add') {
      const body = { month: $('#kdp-s-month').value, units: $('#kdp-s-units').value, royalty: $('#kdp-s-royalty').value };
      if (body.units === '' || body.royalty === '') { h.toast('Enter the copies sold and the royalty.'); return; }
      if (await h.act(t, () => h.api(`kdp/${cur.id}/sales`, { method: 'POST', body: { ...body, units: Number(body.units), royalty: Number(body.royalty) } }), `${body.month} saved.`)) await refreshSales();
    } else if (t.dataset.kdpSaleDel) {
      const m = t.dataset.kdpSaleDel;
      if (!(await h.ask({ title: `Delete ${m}?`, text: 'You can enter the month again from KDP’s report.', ok: 'Delete', danger: true }))) return;
      if (await h.act(t, () => h.api(`kdp/${cur.id}/sales/${m}/delete`, { method: 'POST' }), `${m} deleted.`)) await refreshSales();
    } else if (t.id === 'kdp-s-csv') csv();
  });
}
