// The Characters section of the admin dashboard: make the game's own
// characters, review the ones players suggest, and publish them to every
// player (server/src/characters.js). Drawn faces use the same DiceBear styles
// and looks as the game (dicebear.js and looks.js are copies of the game's).
import { createAvatar, notionists, lorelei, openPeeps } from './dicebear.js';
import { LOOKS, BACKGROUNDS } from './looks.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DRAWN = { notionists, lorelei, openPeeps };
const STYLE_NAMES = { notionists: 'Sketchbook (drawn)', lorelei: 'Storybook (drawn)', openPeeps: 'Hand-drawn (drawn)', ai: 'AI painted (Workers AI, free daily allowance)' };
const ROLE_NAMES = { cast: 'One of the cast', narrator: 'Tells the story', both: 'Either: cast or storyteller' };
const STATUS = { published: ['ok', 'Published'], draft: ['', 'Draft'], suggested: ['warn', 'Suggested by a player'] };
const KOKORO_NAMES = { af_heart: 'Heart', af_bella: 'Bella', af_nicole: 'Nicole (soft)', af_aoede: 'Aoede', am_michael: 'Michael', am_fenrir: 'Fenrir', am_puck: 'Puck' };

let h = null; // helpers from admin.js
let data = null;
let editing = null; // the character in the editor, or null

export function face(c, size = 72) {
  if (c.style === 'ai' && c.portrait) return `<img class="ch-face" src="${c.portrait}" width="${size}" height="${size}" alt="">`;
  const style = DRAWN[c.style] ? c.style : 'notionists';
  try {
    const svg = createAvatar(DRAWN[style], { seed: c.seed || c.name || 'new', size, radius: 50, backgroundColor: BACKGROUNDS, backgroundType: ['solid'], ...LOOKS[style][c.gender === 'f' ? 'f' : 'm'] }).toString();
    return `<img class="ch-face" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" width="${size}" height="${size}" alt="">`;
  } catch (e) { return ''; }
}

const themeNames = (c) => (c.themes.length ? c.themes.map((t) => (data.options.themes.find((x) => x.id === t) || {}).name || t).join(', ') : 'Every theme');

function card(c) {
  const [cls, label] = STATUS[c.status] || ['', c.status];
  return `<li class="ch-card">${face(c, 64)}<div><p><b>${h.esc(c.name)}</b> <span class="badge ${cls}">${label}</span></p>
    <p class="muted">${h.esc(ROLE_NAMES[c.role])} · ${h.esc(themeNames(c))} · ${c.gender === 'f' ? 'woman' : 'man'}</p>
    <p>${h.esc(c.personality)}</p>${c.look ? `<p class="muted">Looks: ${h.esc(c.look)}</p>` : ''}${c.voiceStyle ? `<p class="muted">Voice asked for: ${h.esc(data.options.voiceStyles[c.voiceStyle] || c.voiceStyle)}</p>` : ''}
    <div class="row"><button class="btn small" type="button" data-ch-edit="${h.esc(c.id)}">${c.status === 'suggested' ? 'Review' : 'Edit'}</button></div></div></li>`;
}

function renderList() {
  const t = data.today;
  const mine = data.characters.filter((c) => c.status !== 'suggested');
  const ideas = data.characters.filter((c) => c.status === 'suggested');
  $('#ch-today').textContent = `Today: ${t.pictures} of ${t.pictureCap} AI pictures, ${t.drafts} of ${t.draftCap} AI line drafts, ${t.suggestions} of ${t.suggestionCap} player suggestions. ${mine.length} of ${data.options.limit} characters.${data.enabled ? '' : ' Characters are switched off in Settings, so players don\'t see them.'}`;
  $('#ch-list').innerHTML = mine.length ? mine.map(card).join('') : '<li class="muted">No characters yet. Press New character to make one.</li>';
  $('#ch-ideas').innerHTML = ideas.length ? ideas.map(card).join('') : `<li class="muted">${data.suggestions ? 'No suggestions waiting.' : 'Player suggestions are switched off in Settings.'}</li>`;
  h.setCount && h.setCount('#count-characters', ideas.length);
}

const blank = () => ({ id: '', name: '', gender: 'f', personality: '', look: '', role: 'cast', themes: [], style: 'notionists', seed: `new:${Math.random().toString(36).slice(2, 8)}`, voice: { gemini: 'Kore', kokoro: 'af_heart', speed: 1 }, lines: { clue: [], hint: [], solve: [] }, status: 'draft' });

function voiceOptions(kind, g, value) {
  const list = data.options.voices[kind][g];
  return list.map((v) => `<option value="${v}"${v === value ? ' selected' : ''}>${kind === 'kokoro' ? KOKORO_NAMES[v] || v : v}</option>`).join('');
}

function renderEditor(problems = []) {
  const c = editing;
  const box = $('#ch-editor');
  if (!c) { box.hidden = true; box.innerHTML = ''; return; }
  const o = data.options;
  box.hidden = false;
  box.innerHTML = `<form id="ch-form" class="stack" novalidate>
    <h2 tabindex="-1" id="ch-editor-h">${c.id ? `Edit ${h.esc(c.name)}` : 'New character'}${c.status === 'suggested' ? ' (suggested by a player)' : ''}</h2>
    ${c.status === 'suggested' ? '<p class="note">A player sent this from the game. Check every word, change anything you like, then press Save to make it a draft you can publish. Delete it if it does not fit.</p>' : ''}
    <div class="row">
      <div class="field grow"><label for="ch-name">Name (as players see it in the grid)</label><input id="ch-name" maxlength="16" autocomplete="off" value="${h.esc(c.name)}"></div>
      <fieldset class="field"><legend>Woman or man (face and voice both follow this)</legend>
        <label class="check"><input type="radio" name="ch-gender" value="f"${c.gender === 'f' ? ' checked' : ''}> Woman</label>
        <label class="check"><input type="radio" name="ch-gender" value="m"${c.gender === 'm' ? ' checked' : ''}> Man</label></fieldset>
    </div>
    <div class="field"><label for="ch-personality">Personality (used by the AI writer and painter, never shown to players)</label><textarea id="ch-personality" rows="2" maxlength="240">${h.esc(c.personality)}</textarea></div>
    <div class="row">
      <div class="field"><label for="ch-role">In puzzles</label><select id="ch-role">${o.roles.map((r) => `<option value="${r}"${r === c.role ? ' selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}</select></div>
    </div>
    <fieldset><legend>Themes (none ticked: every theme)</legend><div class="ch-themes">${o.themes.map((t) => `<label class="check"><input type="checkbox" name="ch-theme" value="${t.id}"${c.themes.includes(t.id) ? ' checked' : ''}> ${h.esc(t.name)}</label>`).join('')}</div></fieldset>

    <h3>Portrait</h3>
    <div class="row ch-portrait">
      <div id="ch-face">${face(c, 120)}</div>
      <div class="stack grow">
        <div class="field"><label for="ch-style">Style</label><select id="ch-style">${o.styles.map((s) => `<option value="${s}"${s === c.style ? ' selected' : ''}>${STYLE_NAMES[s]}</option>`).join('')}</select></div>
        <div class="row"><button class="btn small" type="button" id="ch-reroll">Try another face</button></div>
        <div class="field"><label for="ch-look">What the AI portrait should show</label><input id="ch-look" maxlength="200" autocomplete="off" value="${h.esc(c.look)}" placeholder="A blue sea captain's coat and a white beard"></div>
        <div class="row"><button class="btn small" type="button" id="ch-paint"${c.id ? '' : ' disabled'}>Paint the AI portrait</button><span class="muted">${c.id ? 'Uses one of today\'s free AI pictures. Save first so it uses your latest words.' : 'Save first, then paint.'}</span></div>
      </div>
    </div>

    <h3>Voice</h3>
    <p class="muted">The same voice in every puzzle. Server voices (Gemini, with the Chirp 3 HD backup) use the first list; players on the on-device Kokoro voices hear the second.</p>
    <div class="row">
      <div class="field"><label for="ch-gemini">Server voice</label><select id="ch-gemini">${voiceOptions('gemini', c.gender, c.voice.gemini)}</select></div>
      <div class="field"><label for="ch-kokoro">On-device voice (Kokoro)</label><select id="ch-kokoro">${voiceOptions('kokoro', c.gender, c.voice.kokoro)}</select></div>
      <div class="field"><label for="ch-speed">Speaking pace (0.8 slow to 1.2 quick)</label><input id="ch-speed" type="number" min="0.8" max="1.2" step="0.05" value="${c.voice.speed}"></div>
      <button class="btn small" type="button" id="ch-hear">Hear the server voice</button>
    </div>

    <h3>Lines</h3>
    <p class="muted">Short lines in their own voice, one per row, up to six each. They must not name grid items, places, objects or other people, or they would read like clues. No numbers.</p>
    ${Object.entries(o.lineKinds).map(([k, x]) => `<div class="field"><label for="ch-lines-${k}">${h.esc(x.name)} <span class="muted">(for example: ${h.esc(x.example)})</span></label><textarea id="ch-lines-${k}" rows="3">${h.esc((c.lines[k] || []).join('\n'))}</textarea></div>`).join('')}
    <div class="row">
      <div class="field grow"><label for="ch-idea">Direction for the AI writer (optional)</label><input id="ch-idea" maxlength="200" autocomplete="off" placeholder="Talks like an old sailor"></div>
      <button class="btn small" type="button" id="ch-draft"${c.id ? '' : ' disabled'}>Draft lines with AI</button>
    </div>
    <ul class="cards" id="ch-drafts"></ul>

    ${problems.length ? `<div class="note warn" role="alert"><p><b>Fix these before publishing:</b></p><ul>${problems.map((p) => `<li>${h.esc(p)}</li>`).join('')}</ul></div>` : ''}
    <p class="error" id="ch-error" role="alert" hidden></p>
    <div class="row">
      <button class="btn primary" type="submit">Save${c.status === 'published' ? ' (back to draft until published again)' : ' draft'}</button>
      ${c.id && c.status !== 'suggested' && h.can('admin') ? `<button class="btn" type="button" id="ch-publish">${c.status === 'published' ? 'Published' : 'Publish to every player'}</button>` : ''}
      ${c.status === 'published' && h.can('admin') ? '<button class="btn" type="button" id="ch-unpublish">Unpublish</button>' : ''}
      ${c.id && h.can('admin') ? '<button class="btn danger" type="button" id="ch-delete">Delete</button>' : ''}
      <button class="btn quiet" type="button" id="ch-close">Close</button>
    </div>
  </form>`;
  if (c.status === 'published') $('#ch-publish').disabled = true;
}

// What the form says now, for saving and for the face preview.
function formValue() {
  const v = (id) => $(id).value;
  const lines = {};
  for (const k of Object.keys(data.options.lineKinds)) lines[k] = v(`#ch-lines-${k}`).split('\n').map((x) => x.trim()).filter(Boolean);
  return {
    ...editing,
    name: v('#ch-name').trim(), gender: ($('input[name=ch-gender]:checked') || {}).value || editing.gender, personality: v('#ch-personality').trim(), look: v('#ch-look').trim(),
    role: v('#ch-role'), themes: $$('input[name=ch-theme]:checked').map((i) => i.value), style: v('#ch-style'),
    voice: { gemini: v('#ch-gemini'), kokoro: v('#ch-kokoro'), speed: Number(v('#ch-speed')) }, lines,
  };
}

function showError(message) { const e = $('#ch-error'); e.textContent = message; e.hidden = false; h.announce(message); }

async function open(id) {
  editing = id ? (await h.api(`characters/${encodeURIComponent(id)}`)).character : blank();
  renderEditor();
  $('#ch-editor-h').focus();
}

function wire() {
  const sec = $('[data-view="characters"]');
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'ch-new') { open(null); return; }
    if (t.dataset.chEdit) { await h.act(t, () => open(t.dataset.chEdit)); return; }
    if (!editing) return;
    if (t.id === 'ch-close') { editing = null; renderEditor(); return; }
    if (t.id === 'ch-reroll') {
      editing = { ...formValue(), seed: `${editing.name || 'new'}:${Math.random().toString(36).slice(2, 8)}` };
      if (editing.style === 'ai') editing.style = 'notionists';
      $('#ch-style').value = editing.style;
      $('#ch-face').innerHTML = face(editing, 120);
      return;
    }
    if (t.id === 'ch-paint') {
      await h.act(t, async () => {
        const r = await h.api(`characters/${encodeURIComponent(editing.id)}/portrait`, { method: 'POST', body: {} });
        editing = { ...formValue(), portrait: r.character.portrait, hasPortrait: true, style: 'ai', status: r.character.status };
        renderEditor();
        await refreshList();
      }, 'Portrait painted. Publish again for players to see it.').catch(() => {});
      return;
    }
    if (t.id === 'ch-hear') {
      const c = formValue();
      await h.act(t, async () => {
        const res = await fetch('/v1/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Hello, I'm ${c.name || 'your new character'}. ${c.lines.clue[0] || 'Here is what I noticed.'}`, voice: c.voice.gemini }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The server voices are not available right now.');
        const audio = new Audio(URL.createObjectURL(await res.blob()));
        await audio.play();
      });
      return;
    }
    if (t.id === 'ch-draft') {
      await h.act(t, async () => {
        const r = await h.api(`characters/${encodeURIComponent(editing.id)}/lines`, { method: 'POST', body: { idea: $('#ch-idea').value } });
        $('#ch-drafts').innerHTML = Object.entries(r.drafts).flatMap(([k, list]) => list.map((d) => `<li><p><span class="muted">${h.esc(data.options.lineKinds[k].name)}:</span> ${h.esc(d.text)}</p>${d.ok
          ? `<div class="row"><button class="btn small" type="button" data-ch-use="${k}" data-text="${h.esc(d.text)}">Use this line</button></div>` : `<p class="muted">Can't be used: ${h.esc(d.problem)}</p>`}</li>`)).join('') || '<li class="muted">No lines came back. Try again.</li>';
      }, 'Lines drafted. Nothing changes until you use and save them.');
      return;
    }
    if (t.dataset.chUse) {
      const box = $(`#ch-lines-${t.dataset.chUse}`);
      box.value = [box.value.trim(), t.dataset.text].filter(Boolean).join('\n');
      t.disabled = true;
      return;
    }
    if (t.id === 'ch-publish') {
      await h.act(t, async () => {
        try {
          const r = await h.api(`characters/${encodeURIComponent(editing.id)}/publish`, { method: 'POST', body: {} });
          editing = { ...editing, status: r.character.status, version: r.character.version };
        } catch (err) { showError(err.message); throw err; }
        renderEditor();
        await refreshList();
      }, 'Published. Players meet them in new puzzles within a few minutes.').catch(() => {});
      return;
    }
    if (t.id === 'ch-unpublish') {
      await h.act(t, async () => { await h.api(`characters/${encodeURIComponent(editing.id)}/unpublish`, { method: 'POST', body: {} }); editing.status = 'draft'; renderEditor(); await refreshList(); }, 'Unpublished. New puzzles no longer use them; puzzles already made keep them.');
      return;
    }
    if (t.id === 'ch-delete') {
      if (!confirm(`Delete ${editing.name || 'this character'}? Puzzles already made keep their copy.`)) return;
      await h.act(t, async () => { await h.api(`characters/${encodeURIComponent(editing.id)}/delete`, { method: 'POST', body: {} }); editing = null; renderEditor(); await refreshList(); }, 'Deleted.');
    }
  });
  sec.addEventListener('change', (e) => {
    if (!editing) return;
    if (e.target.name === 'ch-gender') {
      const g = e.target.value;
      const pick = (kind) => data.options.voices[kind][g][0];
      $('#ch-gemini').innerHTML = voiceOptions('gemini', g, pick('gemini'));
      $('#ch-kokoro').innerHTML = voiceOptions('kokoro', g, pick('kokoro'));
    }
    if (['ch-style', 'ch-gender'].includes(e.target.id) || e.target.name === 'ch-gender') $('#ch-face').innerHTML = face({ ...formValue(), portrait: editing.portrait }, 120);
  });
  sec.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ch-form') return;
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    const body = formValue();
    btn.disabled = true;
    try {
      const r = await h.api('characters/save', { method: 'POST', body });
      editing = { ...r.character, portrait: editing.portrait };
      renderEditor(r.problems);
      await refreshList();
      h.toast(r.problems.length ? 'Saved as a draft. Fix the problems shown before publishing.' : 'Saved as a draft.');
      h.announce('Saved.');
    } catch (err) { showError(err.message); } finally { if (btn.isConnected) btn.disabled = false; }
  });
}

async function refreshList() {
  data = await h.api('characters');
  renderList();
}

let wired = false;
// helpers: { api, esc, toast, announce, act, can, setCount }
export async function characterView(helpers) {
  h = helpers;
  if (!wired) { wired = true; wire(); }
  await refreshList();
}
