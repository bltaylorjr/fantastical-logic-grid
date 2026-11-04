// Story beat pictures (server/src/story-images.js): pictures the game shows
// beside a story beat as the player finishes sections of the grid
// (web/js/director.js). Upload any picture the browser can open; it is
// shrunk and saved as WebP before it is sent (image-prep.js). Each picture
// belongs to a theme (or every theme) and a stage of the story (or any stage).
import { prepareImage, ACCEPT } from './image-prep.js';

const $ = (s, el = document) => el.querySelector(s);
const STAGE = { any: 'Any story beat', early: 'Early (after the first section)', middle: 'Middle (about halfway)', late: 'Late (before the last section)' };
const STAGE_SHORT = { any: 'Any stage', early: 'Early', middle: 'Middle', late: 'Late' };

let h = null;        // helpers from admin.js
let data = null;     // { images, themes, stages }
let ready = [];      // pictures chosen and shrunk, waiting to upload: { dataUrl, width, height, bytes, name, alt }
let filter = '';

const themeName = (id) => (data && data.themes.find((t) => t.id === id)?.name) || id;
const themeOptions = (value) => data.themes.map((t) => `<option value="${h.esc(t.id)}"${t.id === value ? ' selected' : ''}>${h.esc(t.name)}</option>`).join('');
const stageOptions = (value) => Object.entries(STAGE).map(([k, l]) => `<option value="${k}"${k === value ? ' selected' : ''}>${h.esc(l)}</option>`).join('');
const altFromName = (name) => String(name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

function readyList() {
  const e = h.esc;
  if (!ready.length) return '';
  return `<ul class="bi-grid">${ready.map((p, i) => `<li class="bi-card">
      <img src="${e(p.dataUrl)}" alt="">
      <p class="muted">${e(p.name)} · ${p.width} × ${p.height} · ${Math.round(p.bytes / 1024)} KB</p>
      <div class="field"><label for="bi-alt-${i}">What it shows</label><input id="bi-alt-${i}" data-bi-alt="${i}" maxlength="200" value="${e(p.alt)}" required></div>
      <button class="btn small link" type="button" data-bi-unready="${i}">Remove</button>
    </li>`).join('')}</ul>`;
}

function card(img) {
  const e = h.esc;
  return `<li class="bi-card">
    <img src="/v1/beat-images/${img.id}" alt="${e(img.alt)}" loading="lazy" width="${img.width || ''}" height="${img.height || ''}">
    <p><span class="badge">${e(themeName(img.theme))}</span> <span class="badge">${e(STAGE_SHORT[img.stage] || img.stage)}</span></p>
    <p>${e(img.alt)}</p>
    <p class="muted">#${img.id} · ${Math.round((img.bytes || 0) / 1024)} KB · ${h.when(img.createdAt)}${img.fromSubmission ? ` · from storyline submission #${img.fromSubmission}` : ''}</p>
    ${h.can('moderator') ? `<div class="row"><button class="btn small" type="button" data-bi-edit="${img.id}">Edit</button><button class="btn small danger" type="button" data-bi-delete="${img.id}">Delete</button></div>` : ''}
  </li>`;
}

function render() {
  const list = data.images.filter((i) => !filter || i.theme === filter);
  $('#bi-theme').innerHTML = themeOptions($('#bi-theme').value || 'default');
  $('#bi-stage').innerHTML = stageOptions($('#bi-stage').value || 'any');
  $('#bi-filter').innerHTML = `<option value="">All themes</option>${themeOptions(filter)}`;
  $('#bi-ready').innerHTML = readyList();
  $('#bi-send').hidden = !ready.length;
  $('#bi-send').textContent = ready.length === 1 ? 'Upload 1 picture' : `Upload ${ready.length} pictures`;
  $('#bi-total').textContent = `${data.images.length} ${data.images.length === 1 ? 'picture' : 'pictures'}${filter ? `, ${list.length} for ${themeName(filter)}` : ''}.`;
  $('#bi-list').innerHTML = list.length
    ? `<ul class="bi-grid">${list.map(card).join('')}</ul>`
    : `<p class="muted">${data.images.length ? 'No pictures for this theme yet.' : 'No story beat pictures yet. Story beats show text only until you add some.'}</p>`;
}

export async function beatImagesView(helpers) {
  h = helpers;
  data = await h.api('beat-images');
  render();
}

async function choose(files) {
  const status = $('#bi-status');
  const problems = [];
  let n = 0;
  for (const f of files) {
    n += 1;
    status.textContent = `Getting picture ${n} of ${files.length} ready…`;
    try {
      const p = await prepareImage(f, { maxSide: 1400, maxBytes: 850_000 });
      ready.push({ ...p, alt: altFromName(f.name) });
    } catch (err) {
      problems.push(`${f.name}: ${err.message}`);
    }
  }
  status.textContent = problems.length ? problems.join(' ') : `${ready.length} ready. Check what each one shows, then upload.`;
  render();
}

export function initBeatImages(helpers, show) {
  h = helpers;
  const file = $('#bi-file');
  file.accept = ACCEPT;
  file.onchange = async () => { const files = [...file.files]; file.value = ''; if (files.length) await choose(files); };
  // Drop pictures straight onto the upload area.
  const drop = $('#bi-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) await choose(files);
  });
  $('#bi-ready').addEventListener('input', (e) => {
    const i = e.target.dataset.biAlt;
    if (i !== undefined && ready[i]) ready[i].alt = e.target.value;
  });
  $('#bi-ready').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bi-unready]');
    if (!b) return;
    ready.splice(Number(b.dataset.biUnready), 1);
    render();
    $('#bi-file').focus();
  });
  $('#bi-send').onclick = async (e) => {
    const missing = ready.findIndex((p) => !p.alt.trim());
    if (missing >= 0) { h.toast('Say in a few words what each picture shows.'); $(`#bi-alt-${missing}`)?.focus(); return; }
    const theme = $('#bi-theme').value;
    const stage = $('#bi-stage').value;
    const sending = [...ready];
    const ok = await h.act(e.currentTarget, async () => {
      for (const p of sending) {
        await h.api('beat-images', { method: 'POST', body: { theme, stage, alt: p.alt, image: { dataUrl: p.dataUrl, width: p.width, height: p.height, name: p.name } } });
        ready.splice(ready.indexOf(p), 1);
      }
    }, sending.length === 1 ? 'Picture uploaded.' : `${sending.length} pictures uploaded.`);
    if (!ok) render();
    $('#bi-status').textContent = '';
    show('beat-images', { keepFocus: true });
  };
  $('#bi-filter').onchange = () => { filter = $('#bi-filter').value; render(); };
  $('#bi-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = Number(b.dataset.biEdit || b.dataset.biDelete);
    const img = data.images.find((i) => i.id === id);
    if (!img) return;
    if (b.dataset.biEdit) {
      const v = await h.ask({
        title: 'Edit story beat picture',
        fields: [
          { name: 'theme', label: 'Theme', type: 'select', value: img.theme, options: data.themes.map((t) => [t.id, t.name]) },
          { name: 'stage', label: 'When it shows', type: 'select', value: img.stage, options: Object.entries(STAGE) },
          { name: 'alt', label: 'What the picture shows (read out by screen readers)', value: img.alt },
        ],
        ok: 'Save',
        check: (x) => (x.alt.trim() ? '' : 'Say in a few words what the picture shows.'),
      });
      if (v && (await h.act(b, () => h.api(`beat-images/${id}/edit`, { method: 'POST', body: v }), 'Saved.'))) show('beat-images', { keepFocus: true });
    } else if (b.dataset.biDelete) {
      if (!(await h.ask({ title: 'Delete this picture?', text: 'Story beats stop showing it. Players who already have it on screen keep it until their next puzzle.', ok: 'Delete', danger: true }))) return;
      if (await h.act(b, () => h.api(`beat-images/${id}/delete`, { method: 'POST' }), 'Deleted.')) show('beat-images', { keepFocus: true });
    }
  });
}
