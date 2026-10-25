// Story workshop: players add their own story parts (or approve drafts from
// the AI story writer). Every part is checked by the engine's rules before it
// joins the mix; see learn.js for how parts reach new stories.
import { THEMES, STORYLINES, checkStoryPart, getTopics, storyKey } from '../engine/index.js';
import * as learn from './learn.js';
import * as ai from './ai.js';
import * as store from './store.js';
import * as share from './share.js';
import { esc } from './grid.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const KIND_NAMES = { openings: 'Opening', incidents: 'Event', mishaps: 'Mix-up', endings: 'Ending' };
const TIPS = {
  openings: 'Use {n} for how many there are ({N} at the start of a sentence) and {many} for who they are. Example: "{N} {many} met at the old pier at sunset."',
  incidents: 'Say what happened in a sentence or two, then give it a short name and say what is at stake. Example: "The golden key vanished from the captain\'s desk."',
  mishaps: 'Say why the facts got mixed up, so only the clues can be trusted. Example: "The parrot repeated everything, but always in the wrong order."',
  endings: 'Include {Fact} for the answer; you can use {winner} and {prize} too. Example: "{Fact}, so {winner} found {prize} in the crow\'s nest!"',
};

const kind = () => $('input[name=wskind]:checked').value;
const theme = () => THEMES.find((t) => t.id === $('#ws-theme').value) || THEMES[0];
// Parts belong to one topic (its story key, e.g. "holiday/halloween"; the
// theme id for its classic topic), so they only join stories they fit.
const topic = () => getTopics(theme().id).find((t) => t.id === $('#ws-topic').value) || getTopics(theme().id)[0];
const key = () => storyKey(theme(), topic());
// What the AI story writer is told about the setting.
const setting = () => ({ name: `${theme().name}: ${topic().name}`, description: topic().description, cast: topic().cast || theme().cast });
const examples = (k) => (topic().story && topic().story[k]) || STORYLINES[theme().id][k];
function keyName(k) {
  const [th, tp] = k.split('/');
  const t = THEMES.find((x) => x.id === th);
  if (!t) return k;
  const topics = getTopics(th);
  const p = tp ? topics.find((x) => x.id === tp) : topics.find((x) => !x.story);
  return p ? `${t.name}: ${p.name}` : t.name;
}
function fillTopics(topicId) {
  $('#ws-topic').innerHTML = getTopics(theme().id).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  if (topicId && getTopics(theme().id).some((t) => t.id === topicId)) $('#ws-topic').value = topicId;
}
const sample = (list, n) => list.slice().sort(() => Math.random() - 0.5).slice(0, n);
let drafts = [];

function showKind() {
  const k = kind();
  $('#ws-tip').textContent = TIPS[k];
  $('#ws-name-row').hidden = k !== 'incidents';
  $('#ws-prize-row').hidden = k !== 'incidents';
  $('#ws-errors').textContent = '';
}

function readPart() {
  const text = $('#ws-text').value.trim();
  return kind() === 'incidents' ? { name: $('#ws-name').value.trim(), text, prize: $('#ws-prize').value.trim() } : text;
}

const partText = (k, v) => (k === 'incidents' ? `${v.name}: ${v.text} (at stake: ${v.prize})` : v);

async function renderMine() {
  const mine = await learn.listParts();
  $('#ws-mine').innerHTML = mine.length
    ? mine.map((p) => `<li><span>${esc(partText(p.kind, p.value))}<small>${esc(keyName(p.theme))} · ${KIND_NAMES[p.kind]}${p.source === 'ai' ? ' · drafted with AI' : ''}</small></span>
      <button class="btn quiet small" type="button" data-remove="${esc(p.theme)}|${p.kind}|${p.key}">Remove</button></li>`).join('')
    : '<li><span class="help">None yet.</span></li>';
}

function renderDrafts() {
  const k = kind();
  $('#ws-drafts').innerHTML = drafts.map((d, i) => {
    const res = checkStoryPart(k, d);
    return `<li><span>${esc(partText(k, d))}${res.ok ? '' : `<small>Can't be used: ${esc(res.errors[0])}</small>`}</span>
      ${res.ok ? `<button class="btn small" type="button" data-draft="${i}">Add</button>` : ''}</li>`;
  }).join('');
}

async function add(value, source) {
  const res = await learn.addPart(key(), kind(), value, source);
  if (!res.ok) { $('#ws-errors').innerHTML = res.errors.map(esc).join('<br>'); return false; }
  $('#ws-errors').textContent = '';
  $('#ws-status').textContent = 'Added. It will appear in new stories.';
  if (share.available() && $('#ws-share').checked) {
    share.sharePart(key(), kind(), value, source).then(
      () => { $('#ws-status').textContent = 'Added, and sent to the editor to share with everyone.'; },
      () => { $('#ws-status').textContent = 'Added. It could not be sent to the editor right now.'; },
    );
  }
  await renderMine();
  window.share?.soon();
  return true;
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  $('#ws-theme').innerHTML = THEMES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  fillTopics();
  $('#ws-theme').addEventListener('change', () => { fillTopics(); drafts = []; renderDrafts(); });
  $('#ws-topic').addEventListener('change', () => { drafts = []; renderDrafts(); });
  $$('input[name=wskind]').forEach((r) => r.addEventListener('change', () => { drafts = []; renderDrafts(); showKind(); }));
  $('#ws-add').onclick = async () => {
    if (await add(readPart(), 'mine')) { $('#ws-text').value = ''; $('#ws-name').value = ''; $('#ws-prize').value = ''; }
  };
  $('#ws-ai').onclick = async () => {
    const settings = store.loadSettings();
    const out = $('#ws-ai-status');
    if (!ai.storyWriterReady(settings)) { out.textContent = 'Add a Google Gemini or OpenAI key in Settings first.'; return; }
    const idea = $('#ws-idea').value.trim();
    if (!idea) { out.textContent = 'Describe your idea first.'; return; }
    out.textContent = 'Drafting…';
    $('#ws-ai').disabled = true;
    try {
      drafts = await ai.draftStoryParts(settings, setting(), kind(), idea, sample(examples(kind()), 3));
      out.textContent = drafts.length ? 'Pick the ones you like.' : 'No drafts came back. Try again.';
      renderDrafts();
    } catch (e) {
      out.textContent = `The AI writer could not help: ${e.message}`;
    } finally { $('#ws-ai').disabled = false; }
  };
  $('#ws-drafts').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-draft]');
    if (!b) return;
    if (await add(drafts[+b.dataset.draft], 'ai')) { b.disabled = true; b.textContent = 'Added'; }
  });
  $('#ws-mine').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-remove]');
    if (!b) return;
    const [th, k, key] = b.dataset.remove.split('|');
    await learn.removePart(th, k, key);
    await renderMine();
  });
}

export async function open({ theme: themeId, topic: topicId } = {}) {
  wire();
  if (themeId) { $('#ws-theme').value = themeId; fillTopics(topicId); }
  showKind();
  $('#ws-status').textContent = '';
  await renderMine();
  const dlg = $('#dlg-workshop');
  if (!dlg.open) dlg.showModal();
  $('#ws-theme').focus();
}
