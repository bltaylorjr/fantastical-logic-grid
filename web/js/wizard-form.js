// Draws the Puzzle Wizard's questions (wizard-fields.js) and reads them back.
// Used by the step-by-step wizard (web/wizard/) and the editor on the check
// page (web/wizard/check/). The entry is plain data; every change calls
// onChange(entry) so the page can autosave and redraw the live storyline.
import { FIELDS, STEPS, FILES, CREDIT_AS, ORDERS, MAX_NAMES, MIN_NAMES, MAX_CATEGORIES, MIN_CATEGORIES, splitItems, cellName } from './wizard-fields.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;

// Which step an error or warning key belongs to (catName0 -> lists, file1 -> files...).
export function fieldOfKey(key) {
  if (/^cat(Name|Items|Phrase)\d+$/.test(key)) return 'categories';
  if (/^answer\d+$/.test(key)) return 'answer';
  if (/^file\d+$/.test(key)) return 'files';
  return key;
}
export function stepOfKey(game, key) {
  const f = fieldOfKey(key);
  return STEPS[game].find((s) => s.fields.includes(f))?.id || STEPS[game][0].id;
}

// The words above and below a control: label, help, example and how it is used.
function frame(game, key, inner, { guidance = true, id = `w-${key}` } = {}) {
  const f = FIELDS[game][key];
  const req = f.req ? ' <span class="w-req" aria-hidden="true">*</span><span class="sr-only">(required)</span>' : '';
  const label = ['radio', 'check', 'consent', 'categories', 'answer', 'givens', 'files', 'credit', 'list', 'cast'].includes(f.type)
    ? `<p class="w-label" id="${id}-l">${esc(f.label)}${req}</p>` : `<label class="w-label" for="${id}" id="${id}-l">${esc(f.label)}${req}</label>`;
  return `<div class="w-field" data-field="${key}" id="${id}-f">
    ${label}
    <p class="help w-guide" id="${id}-h"${guidance ? '' : ' hidden'}>${esc(f.help)}</p>
    ${inner}
    <p class="w-msg" data-msg-for="${key}" role="status"></p>
    <div class="w-guide"${guidance ? '' : ' hidden'}>
      <p class="w-ex"><span class="w-tag">Example</span> ${esc(f.example)}</p>
      <details class="w-use"><summary>How this is used in your puzzle</summary><p>${esc(f.use)}</p></details>
    </div>
  </div>`;
}

const textInput = (key, value, max, id = `w-${key}`) => `<input type="text" id="${id}" data-k="${key}" value="${esc(value)}" maxlength="${max || 200}" aria-describedby="${id}-h" autocomplete="off">`;

function control(game, key, entry, ctx) {
  const f = FIELDS[game][key];
  const v = entry[key];
  const id = `w-${key}`;
  switch (f.type) {
    case 'textarea':
      return `<textarea id="${id}" data-k="${key}" rows="4" maxlength="${f.max}" aria-describedby="${id}-h">${esc(v)}</textarea><p class="w-count" data-count-for="${key}">${String(v || '').length} of ${f.max} characters</p>`;
    case 'select':
      return `<select id="${id}" data-k="${key}" aria-describedby="${id}-h">${f.blank ? opt('', f.blank, v) : ''}${f.options.map(([o, l]) => opt(o, l, v)).join('')}</select>`;
    case 'theme':
      return `<select id="${id}" data-k="${key}" aria-describedby="${id}-h">${opt('', 'No preference', v)}${(ctx.themes || []).map((t) => opt(t.id, t.name, v)).join('')}</select>`;
    case 'radio':
      return `<div class="w-radios" role="radiogroup" aria-labelledby="${id}-l" aria-describedby="${id}-h">${f.options.map(([o, l]) => `<label class="radio"><input type="radio" name="${id}" data-k="${key}" value="${esc(o)}"${String(v) === String(o) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
    case 'check':
      return `<label class="check"><input type="checkbox" data-k="${key}"${v ? ' checked' : ''} aria-describedby="${id}-h"> <span>${esc(f.label)}</span></label>`;
    case 'consent':
      return `<label class="check w-consent"><input type="checkbox" data-k="consent"${v ? ' checked' : ''}> <span>${esc(f.help)}</span></label>`;
    case 'cast':
      return `<div class="w-pair"><div><label for="${id}-one">One</label><input type="text" id="${id}-one" data-k="cast.one" value="${esc(v?.one)}" maxlength="${f.max}" aria-describedby="${id}-h" autocomplete="off" placeholder="guest"></div>
        <div><label for="${id}-many">More than one</label><input type="text" id="${id}-many" data-k="cast.many" value="${esc(v?.many)}" maxlength="${f.max}" aria-describedby="${id}-h" autocomplete="off" placeholder="guests"></div></div>`;
    case 'list': {
      const list = Array.isArray(v) ? v : [];
      return `<ol class="w-list">${list.map((n, i) => `<li><label class="sr-only" for="${id}-${i}">Name ${i + 1}</label><input type="text" id="${id}-${i}" data-k="names.${i}" value="${esc(n)}" maxlength="${f.itemMax}" autocomplete="off">
        ${list.length > MIN_NAMES ? `<button class="btn quiet small" type="button" data-act="name-remove" data-i="${i}" aria-label="Remove name ${i + 1}${n ? `, ${esc(n)}` : ''}">Remove</button>` : ''}</li>`).join('')}</ol>
        <p class="w-count">${list.filter((x) => String(x).trim()).length} of ${MAX_NAMES} names</p>
        ${list.length < MAX_NAMES ? '<button class="btn small" type="button" data-act="name-add">Add a name</button>' : ''}`;
    }
    case 'categories': {
      const n = (entry.names || []).filter((x) => String(x).trim()).length;
      const cats = Array.isArray(v) ? v : [];
      return `${cats.map((c, i) => {
        const items = splitItems(c.items).map((x) => String(x).trim()).filter(Boolean);
        const itemsText = Array.isArray(c.items) ? c.items.filter((x) => String(x).trim()).join(', ') : c.items || '';
        return `<fieldset class="w-cat" data-cat="${i}"><legend>List ${i + 1}${c.name ? `: ${esc(c.name)}` : ''}</legend>
          <div class="w-sub" data-sub="catName${i}"><label for="${id}-${i}-name">List name</label><input type="text" id="${id}-${i}-name" data-k="categories.${i}.name" value="${esc(c.name)}" maxlength="30" autocomplete="off" placeholder="Room"><p class="w-msg" data-msg-for="catName${i}" role="status"></p></div>
          <div class="w-sub" data-sub="catItems${i}"><label for="${id}-${i}-items">Items, separated by commas</label><input type="text" id="${id}-${i}-items" data-k="categories.${i}.items" value="${esc(itemsText)}" maxlength="400" autocomplete="off" placeholder="Library, Kitchen, Garden, Attic">
            <p class="w-count">${items.length} ${items.length === 1 ? 'item' : 'items'}${n ? ` · you have ${n} names, so list ${n}` : ''}</p><p class="w-msg" data-msg-for="catItems${i}" role="status"></p></div>
          <div class="w-sub"><label for="${id}-${i}-order">Are the items in order?</label><select id="${id}-${i}-order" data-k="categories.${i}.order">${ORDERS.map(([o, l]) => opt(o, l, c.order || '')).join('')}</select>
            <p class="help w-guide"${ctx.guidance ? '' : ' hidden'}>For times, prices, ages or sizes, list the items first to last and choose the order. The wizard can then write clues like "arrived earlier than".</p></div>
          <details class="w-phrase"${c.pos ? ' open' : ''}><summary>Word the clues yourself (optional)</summary>
            <p class="help">How a clue says a match and a non-match. Leave both empty and the wizard words them for you.</p>
            <div class="w-pair"><div><label for="${id}-${i}-pos">A match</label><input type="text" id="${id}-${i}-pos" data-k="categories.${i}.pos" value="${esc(c.pos)}" maxlength="40" placeholder="was in the"></div>
            <div><label for="${id}-${i}-neg">Not a match</label><input type="text" id="${id}-${i}-neg" data-k="categories.${i}.neg" value="${esc(c.neg)}" maxlength="40" placeholder="was not in the"></div></div>
            <p class="w-msg" data-msg-for="catPhrase${i}" role="status"></p>
          </details>
          ${cats.length > MIN_CATEGORIES ? `<button class="btn quiet small" type="button" data-act="cat-remove" data-i="${i}">Remove list ${i + 1}</button>` : ''}
        </fieldset>`;
      }).join('')}${cats.length < MAX_CATEGORIES ? '<button class="btn small" type="button" data-act="cat-add">Add a list</button>' : ''}`;
    }
    case 'answer': {
      if (entry.answerMode === 'auto') return '<p class="help">The wizard will choose who has what when it builds your puzzle.</p>';
      const names = (entry.names || []).map((x) => String(x).trim()).filter(Boolean);
      const cats = (entry.categories || []).map((c) => ({ name: String(c.name || '').trim(), items: splitItems(c.items).map((x) => String(x).trim()).filter(Boolean) })).filter((c) => c.name && c.items.length);
      if (!names.length || !cats.length) return '<p class="help">Add the names and lists first; the answer key appears here.</p>';
      const a = entry.answer || {};
      return `<div class="w-table-wrap"><table class="w-answer"><caption class="sr-only">Answer key</caption><thead><tr><th scope="col">${esc(entry.cast?.one || 'Name')}</th>${cats.map((c) => `<th scope="col">${esc(c.name)}</th>`).join('')}</tr></thead>
        <tbody>${names.map((n, r) => `<tr><th scope="row">${esc(n)}</th>${cats.map((c, ci) => {
          const sel = a[n]?.[c.name] || '';
          const taken = names.some((m) => m !== n && a[m]?.[c.name] && a[m][c.name] === sel);
          return `<td><label class="sr-only" for="${id}-${r}-${ci}">${esc(c.name)} for ${esc(n)}</label><select id="${id}-${r}-${ci}" data-answer-name="${esc(n)}" data-answer-cat="${esc(c.name)}"${taken ? ' aria-invalid="true" class="w-dup"' : ''}>${opt('', 'Choose', sel)}${c.items.map((it) => opt(it, it, sel)).join('')}</select></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        ${cats.map((c, ci) => `<p class="w-msg" data-msg-for="answer${ci}" role="status"></p>`).join('')}
        <button class="btn small" type="button" data-act="answer-fill">Fill in the rest for me</button>`;
    }
    case 'givens': {
      if (entry.givensMode === 'auto') return '<p class="help">The wizard will make the starting numbers at the difficulty you chose.</p>';
      const N = Number(entry.size) || 9;
      const box = { 4: [2, 2], 6: [2, 3], 9: [3, 3] }[N];
      const g = entry.givens || [];
      let cells = '';
      for (let c = 0; c < N * N; c++) {
        const r = Math.floor(c / N); const k = c % N;
        const cls = [r % box[0] === 0 && r ? 'bt' : '', k % box[1] === 0 && k ? 'bl' : '', entry.diagonal && (r === k || r + k === N - 1) ? 'dg' : ''].filter(Boolean).join(' ');
        cells += `<input class="${cls}" type="text" inputmode="numeric" maxlength="1" data-cell="${c}" value="${g[c] || ''}" aria-label="${cellName(N, c)}" autocomplete="off">`;
      }
      return `<div class="w-givens n${N}" style="--n:${N}" role="group" aria-labelledby="${id}-l">${cells}</div>
        <p class="help"><span data-givens-count>${g.filter(Boolean).length}</span> starting numbers. Use the arrow keys to move; Backspace clears a cell.</p>
        <div class="w-onecheck" data-onecheck aria-live="polite"></div>
        <div class="row-inline"><button class="btn small" type="button" data-act="givens-clear">Clear the grid</button></div>`;
    }
    case 'files':
      return filesControl(entry, ctx);
    case 'credit': {
      const c = v || { as: 'screen', real: '' };
      return `<div class="w-radios" role="radiogroup" aria-labelledby="${id}-l">${CREDIT_AS.map(([o, l]) => `<label class="radio"><input type="radio" name="${id}" data-k="credit.as" value="${o}"${c.as === o ? ' checked' : ''}> ${esc(l)}${o === 'screen' && ctx.screenName ? ` (${esc(ctx.screenName)})` : ''}</label>`).join('')}</div>
        <div class="w-sub"${c.as === 'real' ? '' : ' hidden'} data-real><label for="${id}-real">Your real name</label><input type="text" id="${id}-real" data-k="credit.real" value="${esc(c.real)}" maxlength="60" autocomplete="name"></div>
        ${c.as === 'screen' && !ctx.screenName ? '<p class="help">Your screen name from the game is used. Not signed in? Your puzzle is credited to "a Logic Grid player" until you choose a name.</p>' : ''}`;
    }
    default:
      return textInput(key, v, f.max, id);
  }
}

function filesControl(entry, ctx) {
  const files = entry.files || [];
  const data = ctx.fileData || [];
  const card = (f, i) => {
    const kind = FILES[f.kind];
    const src = data[i]?.dataUrl || '';
    const preview = f.kind === 'image' ? (src ? `<img src="${esc(src)}" alt="${esc(f.name)}">` : '') : (src ? `<audio controls preload="none" src="${esc(src)}"></audio>` : '');
    return `<li class="w-file" data-file="${i}"><div class="w-file-head"><span class="w-file-kind">${f.kind === 'image' ? 'Picture' : 'Sound'}</span> <b>${esc(f.name)}</b></div>${preview}
      <label for="w-file-${i}-purpose">What it is for</label><select id="w-file-${i}-purpose" data-k="files.${i}.purpose">${kind.purposes.map(([o, l]) => opt(o, l, f.purpose)).join('')}</select>
      <label class="check"><input type="checkbox" data-k="files.${i}.use"${f.use ? ' checked' : ''}> <span>You may use this in my puzzle</span></label>
      <label class="check"><input type="checkbox" data-k="files.${i}.credit"${f.credit ? ' checked' : ''}${f.use ? '' : ' disabled'}> <span>Credit me for this ${f.kind === 'image' ? 'picture' : 'sound'}</span></label>
      <div class="w-radios" role="radiogroup" aria-label="Credit as"${f.use && f.credit ? '' : ' hidden'}>${[['screen', 'My screen name'], ['real', 'My real name']].map(([o, l]) => `<label class="radio"><input type="radio" name="w-file-${i}-as" data-k="files.${i}.creditAs" value="${o}"${f.creditAs === o ? ' checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="w-msg" data-msg-for="file${i}" role="status"></p>
      <button class="btn quiet small" type="button" data-act="file-remove" data-i="${i}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`;
  };
  const count = (k) => files.filter((f) => f.kind === k).length;
  return `<ul class="w-files">${files.map(card).join('')}</ul>
    <div class="w-file-add">${Object.entries(FILES).map(([k, d]) => `<div><label class="btn small${count(k) >= d.max ? ' w-off' : ''}" for="w-add-${k}">Add ${k === 'image' ? 'a picture' : 'a sound'}</label>
      <input class="sr-only" type="file" id="w-add-${k}" data-add-file="${k}" accept="${esc(ctx.accept?.[k] || d.accept)}"${count(k) >= d.max ? ' disabled' : ''}>
      <p class="help">${count(k)} of ${d.max} ${k === 'image' ? 'pictures' : 'sounds'}${k === 'sound' ? ' (MP3, M4A, OGG or WAV, up to 700 KB)' : ''}</p></div>`).join('')}</div>
    <p class="w-msg" data-msg-for="filesAdd" role="status"></p>`;
}

// Draws the fields of one step (or of every step, for the editor).
export function render(container, game, entry, { steps = null, guidance = true, ctx = {} } = {}) {
  const list = steps ? STEPS[game].filter((s) => steps.includes(s.id)) : STEPS[game];
  const c = { ...ctx, guidance };
  container.innerHTML = list.map((s) => `<section class="w-step" data-step="${s.id}" aria-labelledby="w-step-${s.id}">
    <h2 id="w-step-${s.id}">${esc(s.title)}</h2><p class="help w-intro">${esc(s.intro)}</p>
    ${s.fields.filter((k) => visible(game, k, entry)).map((k) => frame(game, k, control(game, k, entry, c), { guidance })).join('')}
  </section>`).join('');
}

// Redraws every field of the container except the one being typed in, so
// counts, the answer table and the items hints follow what is typed without
// moving the cursor.
export function refresh(container, game, entry, { guidance = true, ctx = {} } = {}) {
  const c = { ...ctx, guidance };
  for (const box of $$('.w-field', container)) {
    if (box.contains(document.activeElement)) continue;
    const key = box.dataset.field;
    const open = $$('details[open]', box).map((d) => d.className);
    const html = frame(game, key, control(game, key, entry, c), { guidance });
    box.insertAdjacentHTML('afterend', html);
    const fresh = box.nextElementSibling;
    box.remove();
    for (const cls of open) { const d = fresh.querySelector(`details.${cls.split(' ')[0]}`); if (d) d.open = true; }
  }
}

// Some fields only matter for some choices.
function visible(game, key, entry) {
  if (game === 'ninetimesnine' && key === 'level') return entry.givensMode === 'auto';
  return true;
}

// Puts the checker's words next to their fields. show: 'errors' | 'all'.
export function showMessages(container, result, { warnings = true } = {}) {
  for (const el of $$('[data-msg-for]', container)) { el.textContent = ''; el.className = 'w-msg'; }
  for (const el of $$('.w-field.invalid, .w-sub.invalid', container)) el.classList.remove('invalid');
  for (const el of $$('[aria-invalid="true"]:not(.w-dup)', container)) el.removeAttribute('aria-invalid');
  const put = (key, words, cls) => {
    const el = $(`[data-msg-for="${key}"]`, container);
    if (!el) return false;
    el.textContent = words;
    el.className = `w-msg ${cls}`;
    const box = el.closest('.w-sub') || el.closest('.w-field');
    if (cls === 'bad' && box) {
      box.classList.add('invalid');
      const input = $('input:not([type=radio]):not([type=checkbox]), select, textarea', box);
      if (input) input.setAttribute('aria-invalid', 'true');
    }
    return true;
  };
  for (const [k, w] of Object.entries(result.errors)) put(k, w, 'bad') || put(fieldOfKey(k), w, 'bad');
  if (warnings) for (const [k, w] of Object.entries(result.warnings)) { if (!result.errors[k]) put(k, w, 'tip') || put(fieldOfKey(k), w, 'tip'); }
}

// ---------------------------------------------------------------- reading changes
// Sets entry.<path> (like "categories.1.items" or "credit.as") from a control.
function setPath(entry, path, value) {
  const parts = path.split('.');
  let o = entry;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (o[p] == null) o[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[p];
  }
  const last = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
  o[last] = value;
}

// Wires a container: input events update the entry and call onChange(entry,
// { redraw }) — redraw is true when the form's shape changed (a list added,
// names changed the answer table) and the step should be drawn again.
export function wire(container, getEntry, onChange, { onAddFile, onRemoveFile } = {}) {
  const changed = (redraw = false) => onChange(getEntry(), { redraw });
  container.addEventListener('input', (e) => {
    const t = e.target;
    const entry = getEntry();
    if (t.dataset.cell !== undefined) {
      const N = Number(entry.size) || 9;
      const d = Number(String(t.value).replace(/\D/g, '').slice(-1));
      const val = d >= 1 && d <= N ? d : 0;
      t.value = val || '';
      entry.givens[Number(t.dataset.cell)] = val;
      changed(false);
      return;
    }
    if (!t.dataset.k || t.type === 'radio' || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    setPath(entry, t.dataset.k, t.value);
    const count = $(`[data-count-for="${t.dataset.k}"]`, container);
    if (count) count.textContent = `${t.value.length} of ${t.maxLength} characters`;
    // The counts beside the field being typed in (the rest are redrawn).
    if (/^categories\.\d+\.items$/.test(t.dataset.k)) {
      const n = (entry.names || []).filter((x) => String(x).trim()).length;
      const k = splitItems(t.value).map((x) => x.trim()).filter(Boolean).length;
      const c = $('.w-count', t.closest('.w-sub'));
      if (c) c.textContent = `${k} ${k === 1 ? 'item' : 'items'}${n ? ` · you have ${n} names, so list ${n}` : ''}`;
    }
    if (/^names\.\d+$/.test(t.dataset.k)) {
      const c = $('.w-count', t.closest('.w-field'));
      if (c) c.textContent = `${entry.names.filter((x) => String(x).trim()).length} of ${MAX_NAMES} names`;
    }
    // Names and list items change the answer table and the item counts.
    changed(/^(names|categories\.\d+\.(items|name))/.test(t.dataset.k) ? 'soft' : false);
  });
  container.addEventListener('change', (e) => {
    const t = e.target;
    const entry = getEntry();
    if (t.dataset.addFile) { onAddFile && onAddFile(t.dataset.addFile, [...t.files]); t.value = ''; return; }
    if (t.dataset.answerName) {
      entry.answer ||= {};
      entry.answer[t.dataset.answerName] ||= {};
      entry.answer[t.dataset.answerName][t.dataset.answerCat] = t.value;
      changed(true);
      return;
    }
    if (!t.dataset.k) return;
    if (t.type === 'checkbox') setPath(entry, t.dataset.k, t.checked);
    else if (t.type === 'radio') { if (t.checked) setPath(entry, t.dataset.k, t.value); } else if (t.tagName === 'SELECT') setPath(entry, t.dataset.k, t.value);
    else return;
    if (t.dataset.k === 'size') entry.givens = Array(Number(t.value) ** 2).fill(0);
    changed(/^(answerMode|givensMode|size|diagonal|credit\.as|files\.\d+\.(use|credit))$/.test(t.dataset.k));
  });
  container.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const entry = getEntry();
    const i = Number(b.dataset.i);
    const act = b.dataset.act;
    if (act === 'name-add' && entry.names.length < MAX_NAMES) { entry.names.push(''); for (const c of entry.categories) if (Array.isArray(c.items)) c.items.push(''); }
    else if (act === 'name-remove') { const gone = entry.names.splice(i, 1)[0]; if (entry.answer) delete entry.answer[gone]; }
    else if (act === 'cat-add' && entry.categories.length < MAX_CATEGORIES) entry.categories.push({ name: '', items: '', order: '', pos: '', neg: '' });
    else if (act === 'cat-remove') entry.categories.splice(i, 1);
    else if (act === 'file-remove') { onRemoveFile && onRemoveFile(i); return; }
    else if (act === 'givens-clear') entry.givens = entry.givens.map(() => 0);
    else if (act === 'answer-fill') fillAnswer(entry);
    else return;
    changed(true);
    // Keep the keyboard where the person was.
    const focus = act === 'name-add' ? `#w-names-${entry.names.length - 1}` : act === 'cat-add' ? `#w-categories-${entry.categories.length - 1}-name` : null;
    if (focus) setTimeout(() => $(focus, container)?.focus(), 0);
  });
  // Arrow keys move around the number grid.
  container.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.dataset.cell === undefined) return;
    const N = Number(getEntry().size) || 9;
    const c = Number(t.dataset.cell);
    const to = { ArrowLeft: c - 1, ArrowRight: c + 1, ArrowUp: c - N, ArrowDown: c + N }[e.key];
    if (to === undefined || to < 0 || to >= N * N) return;
    e.preventDefault();
    $(`[data-cell="${to}"]`, container)?.focus();
  });
}

// Gives every name an unused item in each list, keeping the author's picks.
export function fillAnswer(entry) {
  const names = (entry.names || []).map((x) => String(x).trim()).filter(Boolean);
  entry.answer ||= {};
  for (const c of entry.categories || []) {
    const name = String(c.name || '').trim();
    const items = splitItems(c.items).map((x) => String(x).trim()).filter(Boolean);
    if (!name || !items.length) continue;
    const used = new Set(names.map((n) => entry.answer[n]?.[name]).filter(Boolean));
    const free = items.filter((it) => !used.has(it));
    for (const n of names) {
      entry.answer[n] ||= {};
      if (!entry.answer[n][name] || !items.includes(entry.answer[n][name])) entry.answer[n][name] = free.shift() || '';
    }
  }
}
