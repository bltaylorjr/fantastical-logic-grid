// The Fantastical Logic Grid: app controller (setup, play, saves, hints, print).
// Only the light parts of the engine load on the page; the story library
// stays in the puzzle writer (worker.js). options.js is written by the build.
import { checkMarks, isSolved, checkAnswers } from '../engine/play.js';
import { OPTIONS } from '../engine/options.js';
import * as engine from './engine-client.js';
import * as store from './store.js';
import { createGrid, puzzleIndex, esc, STATE_WORDS } from './grid.js';
import { printPuzzle } from './print.js';
import { sceneSvg } from './art.js';
import * as sfx from './audio.js';
import * as ai from './ai.js';
import { portrait, characterFace, loadPortraits, portraitsReady } from './portraits.js';
import { sizesFor as tierSizes, tierChoicesHtml, themeGroupsHtml, sizeChoicesHtml, clueTypesHtml } from './setup-markup.js';
import * as characters from './characters.js';
import { characterOf, narratorOf, lineOf } from './cast.js';
import { profileOf, sayingOf } from './castbook.js';
import * as wake from './wakelock.js';
import * as updates from './updates.js';
import { celebrate as celebrateSolve } from './effects.js';
import * as learn from './learn.js';
import * as feedbackBox from './feedback.js';
import * as puzzleReport from './puzzle-report.js';
import * as messages from './messages.js';
import * as share from './share.js';
import * as numberPlace from './number-place.js';
import * as errorReports from './errors.js';
import * as campaign from './campaign.js';
import { countVisit } from './visit.js';
import { initAccounts, openAccount, onHome as accountsOnHome, signedIn } from './account-ui.js';
import * as competeUi from './compete-ui.js';
import * as remote from './remote-config.js';
import { socialLinks, socialHtml, DEFAULT_LINKS } from './social.js';
import * as perks from './perks.js';
import * as specialBadges from './special-badges.js';
import * as support from './support.js';
import { initPullRefresh } from './pull-refresh.js';
import * as daily from './daily.js';
import * as stats from './stats.js';
import { shareResult } from './share-result.js';
import * as challenge from './challenge.js';
import * as dailyResults from './daily-results.js';
import * as dailyEmail from './daily-email.js';
import * as printPack from './print-pack.js';
import * as puzzleMail from './puzzle-mail.js';
import * as editions from './editions.js';
import { onChange as onAccountChange } from './account.js';
import * as i18n from './i18n.js';
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as tutorial from './tutorial.js';
import * as license from './license.js';
import * as licenseDownload from './license-download.js';
import { addCloseButtons, closeDialog } from './dialog-close.js';

addCloseButtons();

errorReports.init();
campaign.init();
countVisit(signedIn());
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TIERS = Object.fromEntries(OPTIONS.difficulties.map((d) => [d.id, d]));
const TIER_IDS = OPTIONS.difficulties.map((d) => d.id);
const MINUTES_PER_CELL = { basic: 0.12, easy: 0.16, medium: 0.22, hard: 0.3, expert: 0.36, mensa: 0.42, theorist: 0.63 };
const USED_STORY_LIMIT = 5000;
const isDesktop = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
// The claude.ai preview build cannot print or download files, so those controls are hidden there.
const isPreview = !!document.querySelector('meta[name="flg-mode"][content="preview"]');
// The copy uploaded to game sites such as itch.io (dist/portal): it runs inside
// their frame, so it has no service worker or home-screen install, and the
// menu links to the full website instead.
const isPortal = !!document.querySelector('meta[name="flg-mode"][content="portal"]');

let settings = store.loadSettings();
let S = null; // the open game: { save, puzzle, ix, marks, grid, wrong, hint, ... }

// ====================================================================
// Small UI services: announcements, toasts, confirm dialogs, sound
// ====================================================================
// Both speak the player's language: the text is translated before it is shown.
let announceSeq = 0;
let statusSeq = 0;
function announce(text) {
  const el = $('#announcer');
  const n = ++announceSeq;
  el.textContent = '';
  i18n.t(text).then((t) => setTimeout(() => { if (n === announceSeq) el.textContent = t; }, 30));
}
function status(text) {
  const n = ++statusSeq;
  if (i18n.isEnglish()) { $('#status').textContent = text; return; }
  i18n.t(text).then((t) => { if (n === statusSeq) $('#status').textContent = t; });
}

function toast(text, action, { ms = 6000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>`;
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { close(); action.run(); };
    el.append(b);
  }
  const start = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', start);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', start);
  $('#toasts').append(el);
  start();
}

// check: optional { label, checked } for one extra choice; its checked is set on close.
function confirmDialog({ title, text, yes, no, check }) {
  const dlg = $('#dlg-confirm');
  $('#confirm-check-row').hidden = !check;
  if (check) { $('#confirm-check-label').textContent = check.label; $('#confirm-check').checked = !!check.checked; }
  $('#confirm-h').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-yes').textContent = yes;
  $('#confirm-no').textContent = no;
  const back = document.activeElement;
  return new Promise((resolve) => {
    const done = (v) => { if (check) check.checked = $('#confirm-check').checked; dlg.close(); resolve(v); back?.focus?.(); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
    $('#confirm-no').focus();
  });
}

// Every dialog's close (X) button closes it the way Escape does, and the welcome and the
// Introduction also close with a click on the dimmed page around them, so a
// first-visit window can never trap anyone (Escape closes dialogs too).
document.addEventListener('click', (e) => {
  const x = e.target.closest?.('dialog .dlg-x');
  if (x) { closeDialog(x.closest('dialog')); return; }
  const d = e.target;
  if (d instanceof HTMLDialogElement && d.open && d.hasAttribute('data-light-dismiss')) {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  }
});
function openDialog(dlg, focusEl) {
  const back = document.activeElement;
  dlg.addEventListener('close', () => back?.focus?.(), { once: true });
  dlg.showModal();
  focusEl?.focus();
}

function sound(kind) {
  if (!settings.sound || settings.silent || !remote.feature('soundEffects')) return;
  try { sfx.setVolumes({ sfx: settings.volume / 100, music: settings.musicVolume / 100 }); sfx.play(kind); } catch (e) { /* sound is optional */ }
}

// Silent mode hides scenes, portraits, sound, music and animation.
function applyMode() {
  document.documentElement.classList.toggle('silent', !!settings.silent);
  const btn = $('#sound-btn');
  btn.textContent = settings.sound ? 'Sound on' : 'Sound off';
  btn.setAttribute('aria-pressed', String(!!settings.sound));
  $$('input[name=playstyle]').forEach((r) => { r.checked = r.value === (settings.silent ? 'silent' : 'full'); });
  updateMusic();
}
function updateMusic() {
  const want = !!(S && settings.music && settings.sound && !settings.silent && remote.feature('music') && !$('#screen-play').hidden && !$('#dlg-video').open);
  try {
    if (want && !sfx.musicPlaying()) { sfx.setVolumes({ sfx: settings.volume / 100, music: settings.musicVolume / 100 }); sfx.startMusic(S.puzzle.theme.id); sfx.setMood((S.save.percent || 0) / 100); }
    else if (!want && sfx.musicPlaying()) sfx.stopMusic();
    else if (want) sfx.setVolumes({ sfx: settings.volume / 100, music: settings.musicVolume / 100 });
  } catch (e) { /* music is optional */ }
}
$('#sound-btn').onclick = () => {
  settings.sound = !settings.sound;
  if (!settings.sound) ai.stopSpeaking();
  store.saveSettings(settings);
  applyMode();
  if (settings.sound) sound('tick');
  status(settings.sound ? 'Sound on.' : 'Sound off.');
};

let themeSetByApp = !!document.documentElement.dataset.theme;
function applyColorTheme() {
  const t = settings.colorTheme;
  // Only clear a theme this app set, so a host page's own light/dark choice survives.
  if (t === 'system') { if (themeSetByApp) delete document.documentElement.dataset.theme; themeSetByApp = false; }
  else { document.documentElement.dataset.theme = t; themeSetByApp = true; }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  $('meta[name=theme-color]').setAttribute('content', bg || '#1F5FAD');
}

// ====================================================================
// Screens
// ====================================================================
// The backdrop and accents take the colors of the chosen theme's world.
function setWorld(id) { document.documentElement.dataset.world = id || 'random'; }

// The website's game page has a longer title for search results (scripts/seo.mjs).
const HOME_TITLE = document.title;
function showScreen(name) {
  $('#screen-home').hidden = name !== 'home';
  $('#screen-play').hidden = name !== 'play';
  $('#screen-learn').hidden = name !== 'learn';
  $('#screen-np').hidden = name !== 'np';
  if (name !== 'learn') tutorial.close();
  if (name !== 'np') numberPlace.leave();
  const scr = $(`#screen-${name}`);
  // The entrance animation plays on screen changes, not for the first screen
  // at start (it would hold back the first paint).
  if (document.documentElement.classList.contains('ready')) { scr.classList.remove('enter'); void scr.offsetWidth; scr.classList.add('enter'); }
  if (name !== 'np') setWorld(name === 'play' && S ? S.puzzle.theme.id : setup.theme);
  $('#skip-link').hidden = name !== 'play';
  $('#view-seg').hidden = name !== 'play';
  document.title = name === 'play' && S ? `${S.save.name} · The Fantastical Logic Grid` : name === 'learn' ? 'How to play · The Fantastical Logic Grid' : name === 'np' ? 'Number Place · The Fantastical Logic Grid' : HOME_TITLE;
  if (name === 'home') { closeGame(); renderSaved(); renderSuggestion(); renderDaily(); accountsOnHome(); competeUi.onHome(); setTimeout(offerUpdate, 500); }
  wake.setPlaying(name === 'play' && S && !S.save.solved);
  updateMusic();
}

async function goHome({ focusSaved = false } = {}) {
  await flushSave();
  showScreen('home');
  window.scrollTo(0, 0);
  const h = focusSaved ? $('#saved-h') : $('#setup-h');
  h.tabIndex = -1;
  h.focus();
}

// ====================================================================
// Setup screen
// ====================================================================
const setup = {
  tier: 'easy', theme: 'random', topic: 'any', size: null, custom: [4, 4],
};

const sizesFor = (tierId) => tierSizes(TIERS[tierId]);

function renderSetup() {
  const saved = store.loadSetupChoices();
  if (saved) Object.assign(setup, saved);
  if (!TIERS[setup.tier]) setup.tier = 'easy';

  $('#tier-choices').innerHTML = tierChoicesHtml(OPTIONS.difficulties, setup.tier);
  // Themes switched off in the admin dashboard are left out; supporter extras
  // show to everyone but open only for premium supporters.
  const off = remote.disabledThemes();
  const locked = lockedThemes();
  if (off.has(setup.theme) || locked.has(setup.theme)) { setup.theme = 'random'; setup.topic = 'any'; }
  $('#theme-choices').innerHTML = themeGroupsHtml(OPTIONS.themes.filter((t) => !off.has(t.id)), OPTIONS.themeGroups, setup.theme, locked);
  const extras = remote.extrasUrl();
  $('#extras-note').hidden = !locked.size;
  $('#extras-link').hidden = !extras;
  if (extras) $('#extras-link').href = extrasLink(extras);
  if (!$('input[name=theme]:checked')) $('input[name=theme]').checked = true;
  renderTopics();
  renderSizes();
  renderClueTypes();
  $('#cats').value = setup.custom[0];
  $('#items').value = setup.custom[1];

  $('#tier-choices').onchange = () => { setup.tier = $('input[name=tier]:checked').value; setup.size = null; renderSizes(); renderClueTypes(); updatePreview(); };
  $('#theme-choices').onchange = () => { setup.theme = $('input[name=theme]:checked').value; setup.topic = 'any'; renderTopics(); setWorld(setup.theme); updatePreview(); };
  $('#topic-choices').onchange = () => { setup.topic = $('input[name=topic]:checked').value; updatePreview(); };
  setWorld(setup.theme);
  $('#size-choices').onchange = () => { setup.size = $('input[name=size]:checked').value; $('#custom-size').hidden = setup.size !== 'custom'; updatePreview(); };
  $('#cats').oninput = $('#items').oninput = () => { setup.custom = [+$('#cats').value || 4, +$('#items').value || 4]; updatePreview(); };
  $('#clue-count').oninput = updatePreview;
  $('#setup').onsubmit = (e) => { e.preventDefault(); startGeneration(); };
  $('#style-choices').onchange = () => { settings.silent = $('input[name=playstyle]:checked').value === 'silent'; store.saveSettings(settings); applyMode(); };
  updatePreview();
}

// Supporter extra themes this player can't pick yet (none for premium supporters).
function lockedThemes() {
  return perks.isPremium() ? new Set() : remote.premiumThemes();
}
// The page where players get the extras. Hook for payment pages that need to
// know who is buying.
function extrasLink(url) { return url; }

// Topics narrow a theme, for example which holiday or which kind of mystery.
// "Surprise me" has none, so the picker hides.
function renderTopics() {
  const theme = OPTIONS.themes.find((t) => t.id === setup.theme);
  const topics = (theme && theme.topics) || [];
  $('#topic-field').hidden = topics.length < 2;
  if (!topics.some((t) => t.id === setup.topic)) setup.topic = 'any';
  $('#topic-choices').innerHTML = topics.map((t) => `
    <label class="choice"><input type="radio" name="topic" value="${esc(t.id)}"${t.id === setup.topic ? ' checked' : ''}>
    <span><b>${esc(t.name)}</b><small>${esc(t.description || '')}</small></span></label>`).join('');
}

function renderSizes() {
  const sizes = sizesFor(setup.tier);
  if (!setup.size || (setup.size !== 'custom' && !sizes.includes(setup.size))) setup.size = sizes[0];
  $('#size-choices').innerHTML = sizeChoicesHtml(sizes, setup.size);
  $('#custom-size').hidden = setup.size !== 'custom';
}

function renderClueTypes() {
  const tierTypes = TIERS[setup.tier].clueTypes;
  $('#clue-type-choices').innerHTML = clueTypesHtml(OPTIONS.clueTypes, tierTypes);
}

function currentSize() {
  if (setup.size === 'custom') {
    const clampN = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(+v) || d));
    return [clampN($('#cats').value, 3, 6, 4), clampN($('#items').value, 3, 8, 4)];
  }
  return setup.size.split('x').map(Number);
}

function updatePreview() {
  const [k, n] = currentSize();
  const cells = (k * (k - 1) / 2) * n * n;
  const mins = Math.max(5, Math.round((cells * MINUTES_PER_CELL[setup.tier]) / 5) * 5);
  const time = mins >= 60 ? `about ${Math.round(mins / 30) / 2} hours` : `about ${mins} minutes`;
  $('#preview').textContent = `A ${TIERS[setup.tier].name} puzzle with ${k} categories of ${n} items each, ${time}.`;
  const width = 200 + (k - 1) * n * 44;
  const warn = $('#size-warning');
  warn.hidden = width <= window.innerWidth - 32;
  warn.textContent = 'This size is best on a larger screen or printed. On this screen the grid will scroll inside its frame.';
  const t = TIERS[setup.tier];
  if (setup.size === 'custom' && (k < t.categories[0] || k > t.categories[1] || n < t.items[0] || n > t.items[1])) {
    $('#preview').textContent += ` That is outside the usual ${t.name} size, which is fine.`;
  }
  if (k >= 6 && n >= 7) $('#preview').textContent += ' Puzzles this big can take up to 20 seconds to write.';
  // A player-written story plays at the level and size its writer chose.
  if (setup.theme === 'stories') $('#preview').textContent = 'Player Stories play at the level and size their writer chose, with their own cast. Each story lists both under its name.';
}

function gatherOptions() {
  const [k, n] = currentSize();
  const o = { difficulty: setup.tier, theme: setup.theme, categories: k, items: n };
  if (setup.theme !== 'random' && setup.topic && setup.topic !== 'any') o.topic = setup.topic;
  const cc = parseInt($('#clue-count').value, 10);
  if (cc > 0) o.clueCount = cc;
  const q = parseInt($('#questions').value, 10);
  if (q >= 1 && q <= 6) o.questions = q;
  const names = $('#cast').value.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length) o.customNames = names;
  const title = $('#custom-title').value.trim();
  if (title) o.title = title;
  const types = $$('#clue-type-choices input:checked').map((i) => i.value);
  const tierTypes = TIERS[setup.tier].clueTypes;
  if (types.length && (types.length !== tierTypes.length || types.some((t) => !tierTypes.includes(t)))) o.clueTypes = types;
  return o;
}

// A story's id comes from the engine (puzzle.story.id). Older engine builds
// do not have one, so fall back to a fingerprint of the story text.
function storyIdOf(puzzle) {
  if (puzzle.story && puzzle.story.id) return String(puzzle.story.id);
  let h = 2166136261;
  for (const ch of puzzle.story.text || puzzle.story.paragraphs.join(' ')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `text-${(h >>> 0).toString(36)}`;
}

async function rememberStory(id) {
  const used = await store.getMeta('usedStories', []);
  if (!used.includes(id)) used.push(id);
  await store.setMeta('usedStories', used.slice(-USED_STORY_LIMIT));
}

// A new puzzle from the setup choices, with a story this player has never had.
// With `override` (a quick puzzle), the setup choices are neither read nor saved.
async function makePuzzle(override = null) {
  const options = override ? { ...override } : gatherOptions();
  if (!override) store.saveSetupChoices({ tier: setup.tier, theme: setup.theme, topic: setup.topic, size: setup.size, custom: currentSize() });
  const used = await store.getMeta('usedStories', []);
  const usedSet = new Set(used);
  // Learning only picks between puzzles the engine has fully checked.
  let tuned = {};
  if (settings.learn) { try { tuned = await learn.tuning(options.difficulty, { useShared: share.available() && remote.feature('learning') }); } catch (e) { tuned = {}; } }
  // Surprise me never picks a theme that is switched off, or a supporter extra
  // this player can't open.
  const off = new Set([...remote.disabledThemes(), ...lockedThemes()]);
  if (off.has(options.theme)) options.theme = 'random';
  // Surprise me is decided here when the game's own characters might join,
  // since they depend on the theme.
  if (options.theme === 'random' && (off.size || characters.anyFor())) {
    const allowed = OPTIONS.themes.filter((t) => !off.has(t.id));
    const weights = (tuned.learning && tuned.learning.themeWeights) || {};
    let r = Math.random() * allowed.reduce((sum, t) => sum + (Number(weights[t.id]) || 1), 0);
    options.theme = (allowed.find((t) => (r -= Number(weights[t.id]) || 1) < 0) || allowed[allowed.length - 1]).id;
  }
  // The game's own characters (made in the admin dashboard) may join the
  // cast or tell the story. Names the player typed always win.
  // Player Stories keep their writer's own cast, so no characters join.
  const picked = options.customNames || options.theme === 'random' || options.theme === 'stories' ? {} : characters.pick(options.theme, options.items);
  if (picked.cast && picked.cast.length) options.customNames = picked.cast.map((c) => c.name);
  let puzzle = null;
  // The engine skips used stories itself; the loop is a safety net.
  for (let i = 0; i < 4 && !puzzle; i++) {
    const p = await engine.generate({ ...tuned, ...options, usedStories: used });
    if (!usedSet.has(storyIdOf(p))) puzzle = p;
  }
  if (!puzzle) throw new Error('Every story we tried has already been used. Try another theme.');
  characters.attach(puzzle, picked);
  await rememberStory(storyIdOf(puzzle));
  return puzzle;
}

function setupSummary() {
  const [k, n] = currentSize();
  const theme = OPTIONS.themes.find((t) => t.id === setup.theme);
  if (setup.theme === 'stories') {
    const story = theme.topics.find((t) => t.id === setup.topic);
    return [theme.name, story && story.id !== 'any' ? story.name : 'Any story'].join(' · ');
  }
  return [TIERS[setup.tier].name, theme ? theme.name : 'Any theme', `${k} × ${n}`].join(' · ');
}

// A race puzzle: the host's own new puzzle, or one joined from the server.
async function openRace(puzzle, race) {
  const existing = await findRaceSave(race.code);
  if (existing) { openGame(existing); return existing; }
  await rememberStory(storyIdOf(puzzle));
  const save = newSave(puzzle);
  save.race = { code: race.code, finished: false };
  save.coach = false;
  await store.putSave(save);
  openGame(save, { fresh: true });
  return save;
}
async function findRaceSave(code) { return (await store.listSaves()).find((x) => x.race && x.race.code === code) || null; }

let generating = false;
async function startGeneration() {
  if (generating) return;
  generating = true;
  const btn = $('#gen-btn');
  const st = $('#gen-status');
  const err = $('#gen-error');
  err.hidden = true;
  btn.disabled = true;
  st.textContent = $('input[name=tier]:checked')?.value === 'theorist' ? 'Building a Theoretical Physicist puzzle… The engine is testing clue after clue until only one answer is possible. The best of the best take up to a minute.' : 'Writing your story… Large puzzles can take up to 20 seconds.';
  try {
    const puzzle = await makePuzzle();
    const save = newSave(puzzle);
    save.chosenTheme = setup.theme;
    await store.putSave(save);
    st.textContent = '';
    openGame(save, { fresh: true });
  } catch (e) {
    st.textContent = '';
    err.innerHTML = `<p><b>The story could not be written.</b> ${esc(e.message || e)}</p><p>Your choices are kept. You can try again, or pick a smaller size or more clue types.</p><button class="btn" type="button" id="retry-btn">Try again</button>`;
    err.hidden = false;
    $('#retry-btn').onclick = startGeneration;
  } finally {
    btn.disabled = false;
    generating = false;
  }
}

// A quick puzzle: a small Easy case in any theme, with no setup, so a first
// visit is playing within seconds (the market test's "Play now"). Coach tips
// show as on any Easy puzzle. Also opened by a link ending ?play=now.
const QUICK = { difficulty: 'easy', theme: 'random', categories: 3, items: 4 };
async function startQuick() {
  if (generating) return;
  generating = true;
  const btn = $('#quick-btn');
  const st = $('#quick-status');
  const err = $('#quick-error');
  err.hidden = true;
  btn.disabled = true;
  st.textContent = 'Writing a quick case for you…';
  try {
    const save = newSave(await makePuzzle(QUICK));
    save.quick = true;
    await store.putSave(save);
    st.textContent = '';
    openGame(save, { fresh: true });
  } catch (e) {
    st.textContent = '';
    err.innerHTML = `<p><b>The story could not be written.</b> ${esc(e.message || e)}</p><button class="btn" type="button" id="quick-retry">Try again</button>`;
    err.hidden = false;
    $('#quick-retry').onclick = startQuick;
  } finally {
    btn.disabled = false;
    generating = false;
  }
}
$('#quick-btn').onclick = startQuick;
// ?play=now in a link (ads, the website) starts a quick puzzle straight away.
// ?play=daily (the daily email) opens today's daily puzzle, or with &day= that day's.
// ?play=weekly[&week=] and ?play=special&id= (the puzzle emails) open those.
function handlePlayLink() {
  const url = new URL(location.href);
  const play = url.searchParams.get('play');
  if (play === 'weekly' || play === 'special') {
    const week = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('week') || '') ? url.searchParams.get('week') : null;
    const id = /^se-[\w-]{1,40}$/.test(url.searchParams.get('id') || '') ? url.searchParams.get('id') : null;
    for (const k of ['play', 'week', 'id']) url.searchParams.delete(k);
    try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (e) { /* framed preview */ }
    if (!daily.available() || isPreview || (play === 'special' && !id)) { startQuick(); return true; }
    (play === 'special' ? Promise.resolve(editions.specialKey(id)) : (week ? Promise.resolve(editions.weeklyKey(week)) : editions.weeklyLatest().then((l) => { if (!l) throw new Error('none'); return editions.weeklyKey(l.week); })))
      .then((key) => openEdition(key)).catch(() => startQuick());
    return true;
  }
  if (play !== 'now' && play !== 'daily') return false;
  // A Hand-picked link names its day: ?play=daily&day=2026-11-03.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : null;
  url.searchParams.delete('play');
  url.searchParams.delete('day');
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (e) { /* framed preview */ }
  if (play === 'daily' && daily.available() && !isPreview) {
    (day ? Promise.resolve(day) : daily.latest().then((l) => l.date)).then((d) => openDaily(d)).catch(() => startQuick());
  } else startQuick();
  return true;
}

function expectedMsFor(puzzle) {
  const K = puzzle.categories.length, N = puzzle.categories[0].items.length;
  return (K * (K - 1) / 2) * N * N * (MINUTES_PER_CELL[puzzle.difficulty.id] || 0.2) * 60000;
}

function newSave(puzzle) {
  const now = Date.now();
  return {
    id: (crypto.randomUUID && crypto.randomUUID()) || `s${now}${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')}`,
    name: puzzle.title,
    storyId: storyIdOf(puzzle),
    puzzle,
    marks: {}, ticked: [], answers: {},
    undo: [], redo: [],
    hintsUsed: 0, checksUsed: 0, elapsedMs: 0, mistakes: 0, expectedMs: expectedMsFor(puzzle),
    focus: null, view: 'grid',
    solved: false, revealed: false, completedAt: null,
    coach: settings.coach && ['basic', 'easy'].includes(puzzle.difficulty.id),
    created: now, lastPlayed: now, percent: 0,
  };
}

// ====================================================================
// Saved puzzles
// ====================================================================
async function renderSaved() {
  let saves = [];
  try { saves = await store.listSaves(); } catch (e) { $('#saved-empty').textContent = 'Saved puzzles could not be loaded on this device.'; }
  saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
  const last = saves.find((x) => !x.solved);
  $('#continue-btn').hidden = !last;
  // With nothing to continue, the quick puzzle is the main way in.
  $('#quick-btn').classList.toggle('primary', !last);
  if (last) {
    $('#continue-btn').dataset.id = last.id;
    $('#continue-name').textContent = `${last.name} · ${last.percent || 0}%`;
  }
  $('#saved-empty').hidden = saves.length > 0;
  $('#saved-empty').textContent = signedIn() ? 'Your puzzles save automatically and sync to your account. Start one and it will appear here.' : 'Your puzzles save automatically on this device. Start one and it will appear here.';
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('#saved-list').innerHTML = saves.map((s) => {
    const p = s.puzzle;
    const pct = s.solved ? 100 : s.percent || 0;
    const state = s.solved ? (s.revealed ? 'Solution revealed' : 'Solved') : `${pct}% complete`;
    return `<li class="saved-item" data-id="${s.id}">
      <h3 class="name">${esc(s.name)}</h3>
      <div class="info">${s.race ? `<span class="pill">Race ${esc(s.race.code)}</span> ` : ''}${s.daily ? `<span class="pill">Daily ${esc(daily.longDate(s.daily))}</span> ` : ''}${s.editionLabel ? `<span class="pill">${esc(s.editionLabel)}</span> ` : ''}${(s.myNotes || '').trim() ? '<span class="pill">Has notes</span> ' : ''}${esc(p.theme.name)} · ${esc(p.difficulty.name)} · ${p.categories.length} × ${p.categories[0].items.length} · ${state}<br>Last played ${esc(fmt.format(new Date(s.lastPlayed)))}</div>
      <div class="bar" role="img" aria-label="${state}"><i style="width:${pct}%"></i></div>
      <div class="row">
        <button class="btn primary small" type="button" data-do="resume">${s.solved ? 'Open' : 'Resume'}<span class="sr-only"> ${esc(s.name)}</span></button>
        <button class="btn small" type="button" data-do="rename">Rename<span class="sr-only"> ${esc(s.name)}</span></button>
        ${isPreview ? '' : `<button class="btn small" type="button" data-do="export">Save to file<span class="sr-only"> ${esc(s.name)}</span></button>`}
        <button class="btn small" type="button" data-do="delete">Delete<span class="sr-only"> ${esc(s.name)}</span></button>
      </div></li>`;
  }).join('');
}

$('#continue-btn').onclick = async () => {
  const save = await store.getSave($('#continue-btn').dataset.id);
  if (save) openGame(save);
};
$('#hero-new').onclick = () => { $('#setup-h').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('#setup-h').tabIndex = -1; $('#setup-h').focus({ preventScroll: true }); };

$('#saved-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-do]');
  if (!b) return;
  const li = b.closest('li');
  const id = li.dataset.id;
  const save = await store.getSave(id);
  if (!save) return;
  const act = b.dataset.do;
  if (act === 'resume') openGame(save);
  else if (act === 'export') exportSave(save);
  else if (act === 'rename') startRename(li, save);
  else if (act === 'delete') {
    const ok = await confirmDialog({ title: `Delete “${save.name}”?`, text: `This removes the puzzle and your progress from ${signedIn() ? 'all your devices' : 'this device'}. You can undo for 10 seconds.`, yes: 'Delete puzzle', no: 'Keep it' });
    if (!ok) return;
    if (!save.solved && settings.learn) { await learn.record(save, 'abandoned').catch(() => {}); share.soon(); }
    await store.deleteSave(id);
    await renderSaved();
    $('#saved-h').focus();
    toast(`Deleted “${save.name}”.`, { label: 'Undo', run: async () => { await store.putSave(save); await renderSaved(); announce(`Restored ${save.name}.`); } }, { ms: 10000 });
  }
});

function startRename(li, save) {
  const h = li.querySelector('.name');
  const form = document.createElement('form');
  form.className = 'field';
  form.innerHTML = `<label for="rn-${save.id}">New name</label><input id="rn-${save.id}" type="text" value="${esc(save.name)}"><div class="row"><button class="btn primary small">Save name</button><button class="btn small" type="button">Keep old name</button></div>`;
  h.replaceWith(form);
  const input = form.querySelector('input');
  input.focus();
  input.select();
  const finish = async (name) => {
    if (name && name !== save.name) { save.name = name; await store.putSave(save); announce(`Renamed to ${name}.`); }
    await renderSaved();
    $(`li[data-id="${save.id}"] [data-do=rename]`)?.focus();
  };
  form.onsubmit = (e) => { e.preventDefault(); finish(input.value.trim()); };
  form.querySelector('button[type=button]').onclick = () => finish(null);
  input.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportSave(save) {
  const safe = save.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'puzzle';
  download(`${safe}.flg.json`, JSON.stringify({ format: 'fantastical-logic-grid', version: 1, save }, null, 1));
  toast(`Saved “${save.name}” to a file in your downloads.`);
}

// Report a Problem (puzzle-report.js), in the footer under every screen. On a
// puzzle it starts as a Puzzle Problem with that puzzle and its picture;
// elsewhere as a Web Page Issue naming the screen.
const SCREEN_NAMES = { 'screen-home': 'Home screen', 'screen-play': 'Puzzle screen', 'screen-learn': 'How to play' };
$('#report-problem').onclick = () => {
  const screen = $$('main.screen').find((m) => !m.hidden);
  const where = SCREEN_NAMES[screen?.id] || screen?.id || 'Game';
  const onPuzzle = screen?.id === 'screen-play' && S && S.save;
  let image = '';
  if (onPuzzle) { try { image = sceneSvg(S.save.puzzle, 5, { animate: false }); } catch (e) { /* sent without it */ } }
  puzzleReport.open({ puzzle: onPuzzle ? S.save.puzzle : null, image, where: onPuzzle ? `${where}: ${S.save.name}` : where });
};

// The link in the "we fixed the puzzle you reported" email: the repaired
// puzzle joins Saved puzzles (once, however often the link is opened).
// The first puzzle built from the player's approved storyline (messages.js):
// put in Saved puzzles, ready to play, once per device.
async function keepStorylinePuzzle(puzzle, id) {
  if ((await store.listSaves()).some((x) => x.teamPuzzle === id)) return false;
  await rememberStory(storyIdOf(puzzle));
  const save = newSave(puzzle);
  save.teamPuzzle = id;
  await store.putSave(save);
  if (!$('#screen-home').hidden) await renderSaved();
  toast(`Your storyline was approved! Its puzzle “${save.name}” is in Saved puzzles.`, { label: 'Play it now', run: () => openGame(save) }, { ms: 10000 });
  return true;
}

async function addRepairedPuzzle(puzzle, tracking, error) {
  if (!puzzle) { toast(error || 'The repaired puzzle could not be opened.'); return; }
  let save = (await store.listSaves()).find((x) => x.repairOf && x.repairOf === tracking);
  if (!save) {
    await rememberStory(storyIdOf(puzzle));
    save = newSave(puzzle);
    save.name = `${puzzle.title} (repaired)`;
    save.repairOf = tracking || true;
    await store.putSave(save);
  }
  await renderSaved();
  toast(`Your repaired puzzle “${save.name}” is in Saved puzzles.`, { label: 'Play it now', run: () => openGame(save) });
}

$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let save;
    if (data && data.format === 'fantastical-logic-grid' && data.save && data.save.puzzle) save = { ...newSave(data.save.puzzle), ...data.save };
    else if (data && data.clues && data.grid && data.solution) save = newSave(data);
    else throw new Error('This file is not a Fantastical Logic Grid puzzle.');
    save.id = newSave(save.puzzle).id;
    save.lastPlayed = Date.now();
    await store.putSave(save);
    await rememberStory(save.storyId || storyIdOf(save.puzzle));
    await renderSaved();
    toast(`Opened “${save.name}”. It is now in your saved puzzles.`);
  } catch (err) {
    toast(`Could not open that file. ${err.message}`);
  }
};

// ====================================================================
// Play: open, render, marks, undo
// ====================================================================
function openGame(save, { fresh = false } = {}) {
  closeGame();
  campaign.played();
  const puzzle = save.puzzle;
  const ix = puzzleIndex(puzzle);
  S = {
    save, puzzle, ix,
    marks: new Map(Object.entries(save.marks || {})),
    wrong: new Set(),
    hint: null,
    dirty: false,
    started: performance.now(),
  };
  save.ticked = save.ticked || [];
  save.answers = save.answers || {};
  save.undo = save.undo || [];
  save.redo = save.redo || [];

  $('#p-title').textContent = save.name;
  const K = ix.K, N = ix.N;
  $('#p-meta').innerHTML = [...(save.daily ? [`Daily puzzle · ${daily.longDate(save.daily)}`] : []), ...(save.editionLabel ? [save.editionLabel] : []), puzzle.difficulty.name, puzzle.theme.name, ...(puzzle.topic && puzzle.topic.id !== 'any' ? [puzzle.topic.name] : []), `${K} categories × ${N} items`, `${puzzle.clues.length} clues`].map((t) => `<span class="pill">${esc(t)}</span>`).join('');
  const paras = puzzle.story.paragraphs;
  $('#p-story').innerHTML = paras.map((p, i) => `<p${i === paras.length - 1 ? ' class="goal"' : ''}>${esc(p)}</p>`).join('');
  characters.useFor(puzzle);
  const teller = narratorOf(puzzle);
  $('#told-by').hidden = !teller;
  $('#told-by').innerHTML = teller ? `<span class="told-face" data-who="${esc(teller.name)}">${characterFace(teller, { size: 40 })}</span> Told by <b>${esc(teller.name)}</b>` : '';
  $('#story').open = !fresh ? !save.storyRead : true;
  const notes = (puzzle.notes || []).filter((n) => !/Closest match/.test(n));
  $('#p-notes').hidden = !notes.length;
  $('#p-notes').innerHTML = notes.map(esc).join('<br>');

  S.witness = assignWitnesses(puzzle, ix);
  $('#clue-list').innerHTML = puzzle.clues.map((c) => `
    <li data-n="${c.number}"${save.ticked.includes(c.number) ? ' class="used"' : ''}><span class="num" aria-hidden="true">${c.number}</span>
    <label><input type="checkbox" data-n="${c.number}"${save.ticked.includes(c.number) ? ' checked' : ''} aria-label="Clue ${c.number}, used"><span><span class="txt">${esc(c.text)}</span><span class="from media">From ${esc(S.witness[c.number])}</span></span></label></li>`).join('');
  renderMedia();
  $('#q-list').innerHTML = puzzle.questions.map((q) => `
    <li><label for="q-${q.number}">${esc(q.text)}</label>
    <select id="q-${q.number}" data-n="${q.number}"><option value="">Choose an answer</option>${q.options.map((o) => `<option value="${o}"${save.answers[q.number] === o ? ' selected' : ''}>${esc(ix.label(o))}</option>`).join('')}</select>
    <span class="res" id="qr-${q.number}"></span></li>`).join('');
  $('#answer-result').textContent = '';
  updateNotesButton();

  S.grid = createGrid($('#gridframe'), puzzle, ix, {
    // Tapping an automatic X clears it (it never turns into an O).
    onCycle: (k) => { const cur = S.marks.get(k) || ''; setCell(k, cur === '' ? 'X' : cur === 'X' ? 'O' : ''); },
    onMark: (k, v) => setCell(k, v),
    onDescribeRow: describeRow,
    onFocus: (k) => { save.focus = k; },
  });
  paintAll();
  $$('input[name=view]').forEach((r) => { r.checked = r.value === (save.view || 'grid'); });
  setView(save.view || 'grid', false);
  $('#hintbox').hidden = true;
  $('#solved').hidden = true;
  updateHintCount();
  updateUndoButtons();
  updateProgress();
  showScreen('play');
  window.scrollTo(0, 0);

  competeUi.onGameOpen(save);
  if (save.solved) showSolved(false);
  if (fresh) {
    $('#p-title').setAttribute('tabindex', '-1');
    $('#p-title').focus();
    announce(`${save.name}. ${puzzle.difficulty.name}, ${puzzle.clues.length} clues. Read the story, then use the grid.`);
  } else {
    S.grid.focusKey(save.focus);
    announce(`Resumed: ${save.name}, ${save.solved ? 'solved' : `${save.percent || 0}% complete`}.`);
  }
  startTimer();
  updateCoach();
  updateMusic();
}

function closeGame() {
  $('#toasts').replaceChildren(); // toast actions belong to the game they came from
  if (!S) return;
  try { sfx.stopMusic(); ai.stopSpeaking(); } catch (e) { /* ignore */ }
  stopTimer();
  S.grid?.destroy();
  S = null;
}

function markList() {
  return [...S.marks].map(([k, m]) => { const [a, b] = k.split('|'); return { a, b, mark: m === 'O' ? 'O' : 'X' }; });
}

function paintAll() {
  for (const k of S.grid.cells.keys()) paintCell(k);
  if (S.save.view === 'list') renderList();
}
function paintCell(k) {
  const target = S.hint && S.hint.level >= 1 && S.hint.targets.has(k);
  S.grid.paint(k, S.marks.get(k) || '', { wrong: S.wrong.has(k), target });
}

// Every change is a list of { t: 'm' (mark) | 't' (clue tick) | 's' (progress,
// used by Start over), k, b (before), a (after) }.
function applyChanges(changes, dir) {
  for (const ch of changes) {
    const v = dir > 0 ? ch.a : ch.b;
    if (ch.t === 'm') {
      if (v) S.marks.set(ch.k, v); else S.marks.delete(ch.k);
      S.wrong.delete(ch.k);
      paintCell(ch.k);
    } else if (ch.t === 't') {
      const n = Number(ch.k);
      S.save.ticked = S.save.ticked.filter((x) => x !== n);
      if (v) S.save.ticked.push(n);
      const li = $(`#clue-list li[data-n="${n}"]`);
      li.classList.toggle('used', !!v);
      li.querySelector('input').checked = !!v;
    } else if (ch.t === 's') applyProgress(v);
  }
}

// An automatic X ('A') belongs to the O that placed it. When an O is cleared
// or changed, its automatic Xs go with it in the same undo step, unless another
// O still rules that cell out. Hand-placed Xs ('X') are never touched. Nothing
// extra is stored, so this works the same after save, resume and sync.
function dropOrphanAutoX(changes) {
  const gone = changes.filter((c) => c.t === 'm' && c.b === 'O' && c.a !== 'O');
  if (!gone.length) return changes;
  const after = new Map(S.marks);
  const touched = new Set();
  for (const c of changes) if (c.t === 'm') { touched.add(c.k); if (c.a) after.set(c.k, c.a); else after.delete(c.k); }
  for (const c of gone) {
    for (const m of lineMates(c.k)) {
      if (touched.has(m) || after.get(m) !== 'A') continue;
      if (lineMates(m).some((n) => after.get(n) === 'O')) continue;
      changes.push({ t: 'm', k: m, b: 'A', a: '' });
      touched.add(m);
      after.delete(m);
    }
  }
  return changes;
}

function commit(changes, label) {
  changes = dropOrphanAutoX(changes.filter((c) => (c.b || '') !== (c.a || '')));
  if (!changes.length) return false;
  applyChanges(changes, 1);
  S.save.undo.push({ label, changes });
  if (S.save.undo.length > 5000) S.save.undo.shift();
  S.save.redo = [];
  afterChange();
  return changes;
}

function afterChange() {
  if (S.hint) clearHint();
  if (S.save.view === 'list') renderList();
  updateUndoButtons();
  updateProgress();
  scheduleSave();
  checkSolved();
  updateCoach();
}

function undo() {
  const act = S.save.undo.pop();
  if (!act) { status('Nothing to undo.'); return; }
  applyChanges([...act.changes].reverse(), -1);
  S.save.redo.push(act);
  status(`Undid: ${act.label}.`);
  afterChange();
}
function redo() {
  const act = S.save.redo.pop();
  if (!act) { status('Nothing to redo.'); return; }
  applyChanges(act.changes, 1);
  S.save.undo.push(act);
  status(`Redid: ${act.label}.`);
  afterChange();
}
function updateUndoButtons() {
  $('[data-act=undo]').disabled = !S.save.undo.length;
  $('[data-act=redo]').disabled = !S.save.redo.length;
}

// "Try again", spoken by the narrator, when a player is on the last few
// decisions of a puzzle (a row's worth of cells or fewer left) and marks a
// cell that does not fit the solution. At most once every few seconds, and
// only while voices are on.
let lastTryAgain = 0;
function tryAgainNearEnd() {
  if (!S || S.save.solved || S.save.revealed || !voiceOn()) return;
  const left = [...S.grid.cells.keys()].filter((c) => !S.marks.get(c)).length;
  const lastDecisions = Math.max(3, S.puzzle.categories[0].items.length);
  if (left > lastDecisions || Date.now() - lastTryAgain < 4000) return;
  lastTryAgain = Date.now();
  status('Try again.');
  ai.speak(settings, S.puzzle, 'narrator', 'Try again.', { volume: settings.volume / 100 }).catch(() => {});
}

// Cells in the same sub-grid row and column as k (for auto-X).
function lineMates(k) {
  const [a, b] = k.split('|');
  const ca = S.ix.byId[a.split(':')[0]], cb = S.ix.byId[b.split(':')[0]];
  const out = [];
  for (const it of cb.items) if (it.id !== b) out.push(S.ix.key(a, it.id));
  for (const it of ca.items) if (it.id !== a) out.push(S.ix.key(it.id, b));
  return out;
}

function setCell(k, v) {
  if (!S) return;
  const before = S.marks.get(k) || '';
  if (before === v) return;
  const changes = [{ t: 'm', k, b: before, a: v }];
  let autoCount = 0;
  if (v === 'O' && settings.autoX) {
    for (const m of lineMates(k)) if (!S.marks.get(m)) { changes.push({ t: 'm', k: m, b: '', a: 'A' }); autoCount++; }
  }
  const [a, b] = k.split('|');
  const what = `${S.ix.label(a)} and ${S.ix.label(b)} ${v === 'O' ? 'confirmed' : v ? 'ruled out' : 'cleared'}`;
  const done = commit(changes, what) || [];
  const autoGone = done.filter((c) => c.b === 'A' && c.a === '' && c.k !== k).length;
  let wrongNow = false;
  if (v) {
    const [mk] = checkMarks(S.puzzle, [{ a, b, mark: v === 'O' ? 'O' : 'X' }]);
    // A wrong O counts as a mistake for learning (an X is often a step on the
    // way to an O, so wrong Xs count only when Check or a hint finds them).
    if (mk && v === 'O' && !S.save.solved) S.save.mistakes = (S.save.mistakes || 0) + 1;
    if (mk && settings.instant) { S.wrong.add(k); paintCell(k); wrongNow = true; }
  }
  // A wrong mark near the end, or a finished grid that is not the answer.
  if (v && (checkMarks(S.puzzle, [{ a, b, mark: v === 'O' ? 'O' : 'X' }])[0] || (!S.save.solved && ![...S.grid.cells.keys()].some((c) => !S.marks.get(c))))) tryAgainNearEnd();
  sound(wrongNow ? 'error' : v === 'O' ? 'O' : v ? 'X' : 'clear');
  const td = S.grid.cells.get(k);
  announce(`${td ? `${S.ix.label(td.dataset.row)}, ${S.ix.label(td.dataset.col)}` : what}, ${STATE_WORDS[v]}${wrongNow ? ', conflicts with the solution' : ''}${autoCount ? `. Also ruled out ${autoCount} other cell${autoCount > 1 ? 's' : ''}` : ''}${autoGone ? `. Also removed ${autoGone} automatic X${autoGone > 1 ? 's' : ''}` : ''}.`);
}

function describeRow(rowItem) {
  const parts = [];
  const rowCat = rowItem.split(':')[0];
  for (const c of S.ix.cats) {
    if (c.id === rowCat) continue;
    const states = c.items.map((it) => ({ it, s: S.marks.get(S.ix.key(rowItem, it.id)) || '' }));
    const o = states.find((x) => x.s === 'O');
    if (o) parts.push(`${c.name}: ${o.it.label} confirmed`);
    else {
      const out = states.filter((x) => x.s).map((x) => x.it.label);
      parts.push(`${c.name}: ${out.length ? `${out.join(', ')} ruled out` : 'nothing marked'}`);
    }
  }
  announce(`${S.ix.label(rowItem)}. ${parts.join('. ')}.`);
}

function updateProgress() {
  const { K, N } = S.ix;
  const total = (K * (K - 1) / 2) * N * N;
  const pct = Math.round((S.marks.size / total) * 100);
  S.save.percent = pct;
  let done = 0;
  const newDone = new Set();
  for (const blk of S.puzzle.grid.blocks) {
    const rc = S.ix.byId[blk.row], cc = S.ix.byId[blk.column];
    let os = 0;
    for (const r of rc.items) for (const c of cc.items) if (S.marks.get(S.ix.key(r.id, c.id)) === 'O') os++;
    if (os === N) {
      done++;
      const id = `${blk.row}|${blk.column}`;
      if (S.doneBlocks && !S.doneBlocks.has(id)) { celebrateBlock(rc, cc); }
      newDone.add(id);
    }
  }
  S.doneBlocks = newDone;
  revealScene(done / S.puzzle.grid.blocks.length);
  try { sfx.setMood(pct / 100); } catch (e) { /* ignore */ }
  $('#progress').textContent = `${pct}% filled · ${done} of ${S.puzzle.grid.blocks.length} sections done`;
  $('#progress-fill').style.width = `${pct}%`;
}

// ---- list view: one select per row of each sub-grid, sharing the same marks ----
function setView(view, focus = true) {
  S.save.view = view;
  $('#gridframe').hidden = view !== 'grid';
  $('#listview').hidden = view !== 'list';
  if (view === 'list') renderList();
  if (focus && view === 'grid') S.grid.focusKey(S.save.focus);
  scheduleSave();
}
function renderList() {
  const lv = $('#listview');
  const active = document.activeElement && lv.contains(document.activeElement) ? document.activeElement.id : null;
  lv.innerHTML = S.puzzle.grid.blocks.map((blk, bi) => {
    const rc = S.ix.byId[blk.row], cc = S.ix.byId[blk.column];
    return `<fieldset><legend>${esc(rc.name)} and ${esc(cc.name)}</legend>${rc.items.map((r, ri) => {
      const o = cc.items.find((c) => S.marks.get(S.ix.key(r.id, c.id)) === 'O');
      const id = `lv-${bi}-${ri}`;
      return `<div class="lv-row"><label for="${id}">${esc(r.label)}</label><select id="${id}" data-row="${r.id}" data-cat="${cc.id}"><option value="">Not decided</option>${cc.items.map((c) => {
        const s = S.marks.get(S.ix.key(r.id, c.id));
        return `<option value="${c.id}"${o && o.id === c.id ? ' selected' : ''}>${esc(c.label)}${s === 'X' || s === 'A' ? ' (ruled out)' : ''}</option>`;
      }).join('')}</select></div>`;
    }).join('')}</fieldset>`;
  }).join('');
  if (active) $(`#${active}`)?.focus();
}
$('#listview').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel) return;
  const cat = S.ix.byId[sel.dataset.cat];
  const row = sel.dataset.row;
  const changes = [];
  for (const c of cat.items) {
    const k = S.ix.key(row, c.id);
    const cur = S.marks.get(k) || '';
    if (c.id === sel.value) changes.push({ t: 'm', k, b: cur, a: 'O' });
    else if (cur === 'O') changes.push({ t: 'm', k, b: cur, a: '' });
  }
  commit(changes, sel.value ? `${S.ix.label(row)} and ${S.ix.label(sel.value)} confirmed` : `${S.ix.label(row)} cleared`);
  announce(sel.value ? `${S.ix.label(row)}, ${S.ix.label(sel.value)}, confirmed.` : `${S.ix.label(row)}, ${cat.name} not decided.`);
});
$$('input[name=view]').forEach((r) => r.addEventListener('change', () => setView(r.value)));

// ---- the player's own notes ----
const NOTES_MAX = 5000;
function updateNotesCount() {
  const left = NOTES_MAX - $('#my-notes').value.length;
  $('#my-notes-count').textContent = left <= 500 ? (left ? `${left} characters left.` : 'Your notes are full.') : '';
}
function updateNotesButton() {
  const has = !!(S && (S.save.myNotes || '').trim());
  $('#notes-dot').hidden = !has;
  $('#notes-has').textContent = has ? ' (has notes)' : '';
}
function openNotes() {
  if (!S) return;
  $('#my-notes').value = S.save.myNotes || '';
  updateNotesCount();
  openDialog($('#dlg-notes'), $('#my-notes'));
}
$('#my-notes').addEventListener('input', () => {
  if (!S) return;
  S.save.myNotes = $('#my-notes').value;
  updateNotesCount();
  updateNotesButton();
  scheduleSave();
});
$('#notes-save').onclick = async () => {
  $('#dlg-notes').close();
  await flushSave({ manual: true });
  status('Notes saved.');
};
$('#notes-close').onclick = () => $('#dlg-notes').close();

// ---- clues and questions ----
$('#clue-list').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-n]');
  if (!cb) return;
  const n = +cb.dataset.n;
  commit([{ t: 't', k: String(n), b: cb.checked ? '' : 'y', a: cb.checked ? 'y' : '' }], `clue ${n} ${cb.checked ? 'ticked' : 'unticked'}`);
  sound('tick');
});
$('#q-list').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel) return;
  S.save.answers[sel.dataset.n] = sel.value;
  $(`#qr-${sel.dataset.n}`).textContent = '';
  scheduleSave();
});
$('#check-answers').onclick = () => {
  const res = checkAnswers(S.puzzle, S.save.answers);
  let right = 0;
  for (const r of res) {
    const el = $(`#qr-${r.number}`);
    const answered = !!S.save.answers[r.number];
    el.textContent = !answered ? 'No answer yet' : r.correct ? '✓ Correct' : '✗ Not this one';
    el.className = `res${answered && !r.correct ? ' bad' : ''}`;
    if (r.correct) right++;
  }
  $('#answer-result').textContent = `${right} of ${res.length} answers correct.`;
  sound(right === res.length ? 'solve' : 'error');
};
$('#story').addEventListener('toggle', () => { if (S && !$('#story').open) { S.save.storyRead = true; scheduleSave(); } });

// ====================================================================
// Hints, check, clear, reveal
// ====================================================================
function clearHint() {
  const old = S.hint;
  S.hint = null;
  $('#hintbox').hidden = true;
  $$('#clue-list li.hinted').forEach((li) => li.classList.remove('hinted'));
  if (old) for (const k of old.targets) paintCell(k);
}

function updateHintCount() {
  $('#hint-count').textContent = S.save.hintsUsed ? `(${S.save.hintsUsed})` : '';
  $('[data-act=hint]').setAttribute('aria-label', `Hint, ${S.save.hintsUsed} used`);
}

let hintBusy = false;
async function hint() {
  if (hintBusy || S.save.solved) return;
  if (S.hint && S.hint.level < 2) {
    S.hint.level++;
    S.save.hintsUsed++;
  } else if (!S.hint) {
    hintBusy = true;
    status('Finding a hint…');
    try {
      const res = await engine.hint(S.puzzle, markList());
      if (!S) return;
      const targets = new Set((res.marks || []).slice(0, 1).map((m) => S.ix.key(m.a, m.b)));
      S.hint = { res, level: 0, targets };
      if (res.kind === 'mistake') S.save.mistakes = (S.save.mistakes || 0) + 1;
      S.save.hintsUsed++;
      status('');
    } catch (e) {
      status(`No hint right now: ${e.message}`);
      return;
    } finally { hintBusy = false; }
  } else {
    // Already at the last level: show it again.
  }
  renderHint();
  updateHintCount();
  scheduleSave();
  sound('hint');
}

// Smarter hints teach the reasoning: the clue that cracks the next cell is
// quoted, the kind of reasoning is named, and the last step explains why,
// with a short lesson on that technique (and the chain for a what-if step).
const TECHNIQUE_LESSONS = {
  clue: 'Some clues say straight out that two things go together (an O) or do not (an X). Mark those first.',
  onlyOne: 'Each row and column of a grid section has exactly one O. Once you place it, every other cell in that row and column is an X.',
  lastLeft: 'When every cell but one in a row or column is an X, the one left must be the O.',
  crossGrid: 'Facts carry between grid sections. If A goes with B and B goes with C, then A goes with C. If A goes with B but B does not go with C, then A does not go with C either.',
  noShared: 'If two items have no option left that they could share, they cannot be a match.',
  ordering: 'A more-or-less clue puts things in order: the one that is more cannot have the smallest value, and the one that is less cannot have the largest.',
  gap: 'An exact gap, like "2 more than", only fits pairs of values that far apart. Rule out every value with no partner at that distance.',
  conditional: 'An if/then clue: whenever the "if" part is true, the "then" part must be true as well. Rule out anything that would break it.',
  whatIf: 'Try a cell as an O in your head and follow the clues. If that leads to something impossible, the cell must be an X.',
};
function hintLines(res, level) {
  const out = [];
  const clue = res.clue ? S.puzzle.clues.find((c) => c.number === res.clue) : null;
  out.push(`<p><b>Hint:</b> ${esc(res.levels[0])}${clue ? ` <q class="hint-clue">${esc(clue.text)}</q>` : ''}</p>`);
  if (res.kind === 'step' && res.techniqueName) out.push(`<p class="hint-tech"><span class="pill">${esc(res.techniqueName)}</span></p>`);
  if (level >= 1) out.push(`<p>${esc(res.levels[1])}</p>`);
  if (level >= 2) {
    out.push(`<p><b>Why:</b> ${esc(res.levels[2])}</p>`);
    if (res.chain && res.chain.length) out.push(`<details class="hint-chain"><summary>Follow the chain of reasoning</summary><ol>${res.chain.map((c) => `<li>${esc(c)}</li>`).join('')}</ol></details>`);
    const lesson = TECHNIQUE_LESSONS[res.technique];
    if (lesson) out.push(`<p class="hint-lesson"><b>How this works:</b> ${esc(lesson)}</p>`);
  }
  return out.join('');
}

function renderHint() {
  const { res, level } = S.hint;
  const box = $('#hintbox');
  // The admin dashboard's storyteller offers the first nudge; otherwise one
  // of the cast does, in their own way (castbook.js).
  const teller = level === 0 && res.kind !== 'done' ? narratorOf(S.puzzle) : null;
  const names = S.ix.cats[0].items.map((i) => i.label);
  const helper = level === 0 && res.kind !== 'done' && !settings.silent ? names[S.save.hintsUsed % names.length] : null;
  const told = teller && lineOf(teller, 'hint', S.save.hintsUsed);
  const [by, said] = told ? [teller.name, told] : helper ? [helper, lineOf(characterOf(S.puzzle, helper), 'hint', S.save.hintsUsed) || sayingOf(helper, 'hint', S.save.hintsUsed)] : [];
  const lines = (said ? `<p class="char-line"><b>${esc(by)}:</b> “${esc(said)}”</p>` : '') + hintLines(res, level);
  const more = level < 2 ? `<button class="btn small" type="button" id="hint-more">${level === 0 ? 'Which cell?' : 'Explain why'}</button>` : '';
  const apply = level === 2 && res.kind !== 'done' ? `<button class="btn small" type="button" id="hint-apply">${res.kind === 'mistake' ? 'Fix it for me' : 'Mark it for me'}</button>` : '';
  box.innerHTML = `${lines}<div class="row">${more}${apply}<button class="btn quiet small" type="button" id="hint-close">Close hint</button></div>`;
  box.hidden = false;
  $$('#clue-list li.hinted').forEach((li) => li.classList.remove('hinted'));
  if (res.clue) $(`#clue-list li[data-n="${res.clue}"]`)?.classList.add('hinted');
  for (const k of S.hint.targets) paintCell(k);
  const clue = level === 0 && res.clue ? S.puzzle.clues.find((c) => c.number === res.clue) : null;
  announce(level === 2 && TECHNIQUE_LESSONS[res.technique] ? `${res.levels[2]} ${TECHNIQUE_LESSONS[res.technique]}` : clue ? `${res.levels[0]} ${clue.text}` : res.levels[level]);
  $('#hint-more')?.addEventListener('click', hint);
  $('#hint-close').onclick = () => { clearHint(); S.grid.focusKey(S.save.focus); };
  $('#hint-apply')?.addEventListener('click', () => {
    const changes = res.kind === 'mistake'
      ? res.marks.slice(0, 1).map((m) => { const k = S.ix.key(m.a, m.b); return { t: 'm', k, b: S.marks.get(k) || '', a: '' }; })
      : res.marks.map((m) => { const k = S.ix.key(m.a, m.b); return { t: 'm', k, b: S.marks.get(k) || '', a: m.mark }; });
    const first = changes[0] && changes[0].k;
    commit(changes, res.kind === 'mistake' ? 'hint fix' : 'hint step');
    announce(res.kind === 'mistake' ? 'Removed the wrong mark.' : `Marked ${changes.length} cell${changes.length > 1 ? 's' : ''} from the hint.`);
    if (first) S.grid.focusKey(first);
  });
}

function check() {
  const bad = checkMarks(S.puzzle, markList());
  const old = S.wrong;
  S.wrong = new Set(bad.map((m) => S.ix.key(m.a, m.b)));
  for (const k of new Set([...old, ...S.wrong])) paintCell(k);
  S.save.checksUsed = (S.save.checksUsed || 0) + 1;
  S.save.mistakes = (S.save.mistakes || 0) + [...S.wrong].filter((k) => !old.has(k)).length;
  const msg = bad.length ? `${bad.length} mark${bad.length > 1 ? 's conflict' : ' conflicts'} with the solution. ${bad.length > 1 ? 'They are' : 'It is'} outlined with a warning sign.` : (S.marks.size ? 'No errors so far.' : 'No marks to check yet.');
  status(msg);
  sound(bad.length ? 'error' : 'tick');
  scheduleSave();
}

async function clearGrid() {
  if (!S.marks.size) { status('The grid is already empty.'); return; }
  const ok = await confirmDialog({ title: 'Clear the grid?', text: 'This removes every X and O. You can undo it.', yes: 'Clear grid', no: 'Keep my marks' });
  if (!ok) return;
  commit([...S.marks].map(([k, v]) => ({ t: 'm', k, b: v, a: '' })), 'clear grid');
  status('Grid cleared.');
  toast('Grid cleared.', { label: 'Undo', run: undo }, { ms: 10000 });
}

// Start over: one undoable step that clears marks, ticks and answers and, outside
// an active race, resets the timer, hints and checks. A restarted puzzle no
// longer earns scoreboard points, so starting over can't buy a faster score.
// In an active race the race clock, hints, checks and a reveal all stay.
const PROGRESS_KEYS = ['elapsedMs', 'hintsUsed', 'checksUsed', 'mistakes', 'revealed', 'solved', 'completedAt', 'scorePending', 'restarted', 'answers', 'myNotes'];
function progressOf(save) {
  const o = {};
  for (const key of PROGRESS_KEYS) o[key] = key === 'answers' ? { ...(save.answers || {}) } : save[key];
  return o;
}
function applyProgress(p) {
  for (const key of PROGRESS_KEYS) { if (p[key] === undefined) delete S.save[key]; else S.save[key] = key === 'answers' ? { ...p[key] } : p[key]; }
  for (const q of S.puzzle.questions) {
    $(`#q-${q.number}`).value = S.save.answers[q.number] || '';
    $(`#qr-${q.number}`).textContent = '';
  }
  $('#answer-result').textContent = '';
  S.started = performance.now();
  updateHintCount();
  updateNotesButton();
  renderTimer();
  queueMicrotask(syncSolvedView); // once the marks in the same step are back
}
function syncSolvedView() {
  if (!S) return;
  if (S.save.solved) {
    stopTimer();
    renderTimer();
    if ($('#solved').hidden) showSolved(false);
  } else {
    $('#solved').hidden = true;
    if (!timerId) startTimer();
  }
  wake.setPlaying(!S.save.solved);
}

async function startOver() {
  const s = S.save;
  const racing = !!(s.race && !s.race.finished);
  if (!S.marks.size && !s.ticked.length && !Object.values(s.answers).some(Boolean) && !s.elapsedMs && !s.hintsUsed && !s.checksUsed) {
    status('This puzzle is already at the start.');
    return;
  }
  const notes = (s.myNotes || '').trim() ? { label: 'Also clear my notes', checked: false } : null;
  const text = racing
    ? 'This removes every X and O, clue tick and answer. The race clock keeps running, and your hints and checks still count. You can undo it.'
    : `This removes every X and O, clue tick and answer, and resets the timer, hints and checks.${signedIn() && !s.race ? ' A restarted puzzle no longer earns scoreboard points.' : ''} Your notes stay unless you choose to clear them. You can undo it.`;
  const ok = await confirmDialog({ title: 'Start this puzzle over?', text, yes: 'Start over', no: 'Keep playing', check: notes });
  if (!ok || !S || S.save !== s) return;
  tickTimer();
  const before = progressOf(s);
  const after = racing
    ? { ...before, answers: {}, solved: false }
    : { ...before, elapsedMs: 0, hintsUsed: 0, checksUsed: 0, mistakes: 0, revealed: false, solved: false, completedAt: null, scorePending: undefined, restarted: true, answers: {} };
  if (notes && notes.checked) after.myNotes = '';
  clearHint();
  const old = S.wrong;
  S.wrong = new Set();
  for (const k of old) paintCell(k);
  commit([
    ...[...S.marks].map(([k, v]) => ({ t: 'm', k, b: v, a: '' })),
    ...s.ticked.map((n) => ({ t: 't', k: String(n), b: 'y', a: '' })),
    { t: 's', k: '', b: before, a: after },
  ], 'start over');
  sound('clear');
  status(racing ? 'Started over. The race clock is still running.' : 'Started over.');
  toast('Puzzle started over.', { label: 'Undo', run: undo }, { ms: 10000 });
}

async function reveal() {
  if (S.save.solved && !S.save.revealed) { status('This puzzle is already solved.'); return; }
  const raceNote = S.save.race && !S.save.race.finished ? ' In a race this counts as giving up.' : '';
  const ok = await confirmDialog({ title: 'Reveal the solution?', text: `Every cell will be filled in and this puzzle will no longer count as solved by you.${raceNote} You can undo for 10 seconds.`, yes: 'Reveal solution', no: 'Keep solving' });
  if (!ok) return;
  const wasRevealed = S.save.revealed;
  const changes = [];
  for (const k of S.grid.cells.keys()) {
    const [a, b] = k.split('|');
    const match = S.puzzle.solution.some((row) => { const v = Object.values(row); return v.includes(a) && v.includes(b); });
    changes.push({ t: 'm', k, b: S.marks.get(k) || '', a: match ? 'O' : 'X' });
  }
  S.save.revealed = true;
  commit(changes, 'reveal solution');
  toast('Solution revealed.', { label: 'Undo', run: () => { S.save.revealed = wasRevealed; S.save.solved = false; $('#solved').hidden = true; undo(); } }, { ms: 10000 });
}

// ====================================================================
// Solve, coach tips, timer
// ====================================================================
function checkSolved() {
  const solved = isSolved(S.puzzle, markList());
  if (solved && !S.save.solved) {
    S.save.solved = true;
    S.save.completedAt = Date.now();
    // The daily, weekly and special puzzles' answers are on the website, so they earn no scoreboard points.
    if (!S.save.race && !S.save.daily && !S.save.edition && !S.save.challenge && !S.save.revealed && !S.save.restarted) S.save.scorePending = true;
    tickTimer();
    recordSolve(S.save);
    if (!S.save.revealed) campaign.solved();
    if (settings.learn) learn.record(S.save, S.save.revealed ? 'revealed' : 'solved').then(() => share.soon(), () => {});
    stopTimer();
    showSolved(true);
    scheduleSave();
  } else if (!solved && S.save.solved) {
    S.save.solved = false;
    $('#solved').hidden = true;
    startTimer();
  }
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function showSolved(celebrate) {
  const save = S.save;
  wake.setPlaying(false);
  const tier = S.puzzle.difficulty.id;
  const i = TIER_IDS.indexOf(tier);
  $('#solved-h').textContent = save.revealed ? 'Solution revealed' : 'Case closed!';
  $('#ending').textContent = S.puzzle.story.ending;
  $('#solved-stats').innerHTML = [
    ['Time', fmtTime(save.elapsedMs)], ['Hints used', save.hintsUsed], ['Checks', save.checksUsed || 0],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  let next = tier;
  let tip;
  if (save.revealed || save.hintsUsed >= 5) {
    tip = i > 0 ? `Try another ${TIERS[tier].name} puzzle, or step down to ${TIERS[TIER_IDS[i - 1]].name} for a gentler one.` : `Try another ${TIERS[tier].name} puzzle.`;
  } else if (save.hintsUsed <= 1 && i < TIER_IDS.length - 1) {
    next = TIER_IDS[i + 1];
    tip = `Nicely done. Ready for ${TIERS[next].name}?`;
  } else tip = `Try another ${TIERS[tier].name} puzzle with a brand new story.`;
  $('#next-tip').textContent = tip;
  renderFeedback(save);
  renderSolvedExtras(save);
  $('#support-ask').hidden = true;
  $('#next-btn').textContent = next === tier ? `New ${TIERS[tier].name} puzzle` : `Try ${TIERS[next].name}`;
  $('#next-btn').onclick = () => {
    setup.tier = next;
    setup.size = null;
    store.saveSetupChoices({ ...setup, custom: setup.custom });
    renderSetup();
    goHome();
  };
  const res = $('#resolution');
  const winner = winnerOf(S.puzzle, S.ix);
  const bg = S.sceneUrl ? `<img class="bg" src="${S.sceneUrl}" alt="">` : sceneSvg(S.puzzle, 5, { animate: false });
  const face = S.portraitUrls && S.portraitUrls[winner] ? `<img src="${S.portraitUrls[winner]}" alt="">` : winner ? portrait(S.puzzle, winner, { size: 120, style: settings.portraitStyle }) : '';
  // A character from the admin dashboard cheers in their own words: the
  // winner if they are one, otherwise the one who told the story. If neither
  // has a cheer, the winner cheers in their personality's words (castbook.js).
  const admin = [characterOf(S.puzzle, winner), narratorOf(S.puzzle)].find((c) => lineOf(c, 'solve'));
  const plain = !admin && winner && !save.revealed && !settings.silent;
  const cheer = admin || (plain ? { name: winner } : null);
  const cheerLine = admin ? lineOf(admin, 'solve', S.save.hintsUsed + S.puzzle.clues.length) : plain ? sayingOf(winner, 'solve', save.hintsUsed + S.puzzle.clues.length) : null;
  res.innerHTML = `${bg}<div class="spot"></div>${winner ? `<div class="hero">${face}<b>${esc(winner)}</b></div>` : ''}${cheerLine ? `<p class="char-line cheer"><b>${esc(cheer.name)}:</b> “${esc(cheerLine)}”</p>` : ''}`;
  // The picture is hidden from screen readers, so the cheer is announced.
  if (celebrate && cheerLine && !settings.silent) setTimeout(() => announce(`${cheer.name} says: ${cheerLine}`), 800);
  if (celebrate && voiceOn()) {
    setTimeout(() => {
      if (!S || !S.save.solved) return;
      const said = [...(cheerLine ? [{ who: cheer.id && cheer.id === S.puzzle.narrator ? 'narrator' : cheer.name, text: cheerLine }] : []), { who: 'narrator', text: S.puzzle.story.ending }];
      ai.speakLines(settings, S.puzzle, said, { volume: settings.volume / 100 });
    }, 1200);
  }
  res.classList.remove('celebrate');
  if (celebrate) { void res.offsetWidth; res.classList.add('celebrate'); }
  $('#solved').hidden = false;
  reportResult(save);
  clearHint();
  $('#coach').hidden = true;
  if (celebrate) {
    sound('solve');
    const shown = save.revealed ? null : celebrateSolve(settings.celebrations, { random: settings.celebrateRandom, theme: S.puzzle.theme.id });
    $('#solved').dataset.effects = shown ? shown.join(' ') : '';
    $('#solved').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    $('#solved').focus({ preventScroll: true });
    announce(`${save.revealed ? 'Solution revealed.' : 'Solved!'} ${S.puzzle.story.ending}`);
  }
}

// Race results and scoreboard points. A revealed race waits until the undo
// window has passed, so an accidental reveal can still be taken back.
function reportResult(save) {
  const pairs = () => markList().filter((m) => m.mark === 'O').map((m) => [m.a, m.b]);
  const send = () => { if (S && S.save === save && save.solved) competeUi.onSolved(save, pairs()); };
  if (save.race && save.revealed && !save.race.finished) setTimeout(send, 11000);
  else send();
}

// "Rate this puzzle" after each puzzle: optional 1 to 5 stars (5 is
// excellent) and a quick feel. It never blocks anything. With "Learn from how
// I play" on it tunes the next puzzles and joins the anonymous ratings report
// (admin Ratings and insights); with it off the rating stays on this device.
async function renderFeedback(save) {
  const box = $('#feedback');
  const prev = await learn.ratingOf(save.storyId).catch(() => ({}));
  if (!S || S.save !== save) return;
  for (const r of $$('input[name=rating]', box)) r.checked = prev.rating === +r.value;
  for (const r of $$('input[name=feel]', box)) r.checked = prev.feel === r.value;
  $('#rating-clear').hidden = !prev.rating;
  $('#feedback-thanks').textContent = '';
}
async function saveRating(v) {
  await learn.rate(S.save, v, { keepLocal: !settings.learn }).catch(() => {});
  $('#feedback-thanks').textContent = settings.learn ? 'Thanks. Your next puzzles will use this.' : 'Thanks. This stays on your device, because Learn from how I play is off.';
  if (settings.learn) window.share?.soon();
}
$('#feedback').addEventListener('change', async (e) => {
  if (!S || !e.target.name) return;
  if (e.target.name === 'rating') $('#rating-clear').hidden = false;
  await saveRating(e.target.name === 'rating' ? { rating: +e.target.value } : { feel: e.target.value });
});
$('#rating-clear').onclick = async () => {
  if (!S) return;
  for (const r of $$('#feedback input[name=rating]')) r.checked = false;
  $('#rating-clear').hidden = true;
  $('#feedback .stars input')?.focus();
  await saveRating({ rating: null });
  $('#feedback-thanks').textContent = 'Rating cleared.';
};
$('#feedback-idea').onclick = () => feedbackBox.open(openDialog, { kind: 'idea', themes: OPTIONS.themes });

// Streak, new badges and Share my result on the solved panel.
async function renderSolvedExtras(save) {
  $('#share-result').hidden = !!save.revealed;
  $('#challenge-btn').hidden = !!save.revealed || !!save.race || !challenge.available();
  renderChallenge(save);
  $('#share-note').textContent = '';
  const box = $('#solved-badges');
  const fresh = (S && S.save === save && S.newBadges) || [];
  box.hidden = !fresh.length;
  box.innerHTML = fresh.length ? `<h3>New badge${fresh.length > 1 ? 's' : ''}</h3><ul class="badges">${fresh.map(badgeHtml).join('')}</ul>` : '';
  const line = $('#solved-streak');
  line.hidden = true;
  const nums = $('#solved-daily-numbers');
  nums.hidden = true;
  // Counted once: the mark is saved before the time is sent.
  let sent = null;
  if (save.daily && !save.dailySent) {
    save.dailySent = true;
    await flushSave({ manual: true });
    sent = dailyResults.finished(save.daily, save.elapsedMs, save.revealed);
  }
  if (save.daily) showDailyNumbers(save, sent);
  if (!save.daily || save.revealed) return;
  const st = daily.streak(await stats.solveLog().catch(() => []), save.daily);
  if (!S || S.save !== save) return;
  line.hidden = false;
  line.textContent = st.days.has(save.daily)
    ? (st.current > 1 ? `Daily streak: ${st.current} days in a row. Come back tomorrow for the next one.` : 'Your daily streak has started. Come back tomorrow for the next puzzle.')
    : 'This daily puzzle was finished after its day, so it does not add to your streak.';
}
// A gentle support ask on the solved panel (support.js), right after a fresh
// solve: never after a revealed answer or in a race, at most once a week.
async function renderSupportAsk(save) {
  const box = $('#support-ask');
  box.hidden = true;
  if (!support.on() || save.revealed || save.race) return;
  const log = await stats.solveLog().catch(() => []);
  if (!S || S.save !== save) return;
  const solvedCount = log.filter((x) => !x.revealed).length;
  let streak = 0;
  if (save.daily) {
    const st = daily.streak(log, save.daily);
    if (st.days.has(save.daily)) streak = st.current;
  }
  const ask = support.pick({ solvedCount, streak, revealed: save.revealed, race: !!save.race });
  if (!ask) return;
  $('#support-ask-text').textContent = ask.text;
  $('#support-ask-go').href = support.url();
  $('#support-ask-go').hidden = ask.kind === 'streak';
  $('#support-ask-how').hidden = ask.kind !== 'streak';
  box.dataset.kind = ask.kind;
  box.hidden = false;
}
const closeSupportAsk = () => { $('#support-ask').hidden = true; $('#next-btn').focus(); };
$('#support-ask-go').onclick = () => { campaign.supportPressed(); $('#support-ask').hidden = true; };
$('#support-ask-how').onclick = () => openSupporters();
$('#support-ask-later').onclick = closeSupportAsk;
$('#support-ask-never').onclick = () => {
  support.neverAgain();
  closeSupportAsk();
  toast('Got it. The game will not ask again.');
};
// The Supporters window: where the money goes, and the Support page link.
function openSupporters() {
  $('#supporters-text').textContent = support.TEXT.page;
  $('#supporters-go').href = support.url();
  openDialog($('#dlg-supporters'), $('#supporters-close'));
}
$('#supporters-close').onclick = () => $('#dlg-supporters').close();
$('#supporters-go').onclick = () => { campaign.supportPressed(); $('#dlg-supporters').close(); };

// Everyone's numbers for this daily puzzle, under the streak.
async function showDailyNumbers(save, sent) {
  // Wait for this solve to be counted (at most a few seconds), so it is in the numbers.
  if (sent) await Promise.race([sent, new Promise((r) => setTimeout(r, 4000))]);
  const st = await dailyResults.statsFor(save.daily);
  if (!st || !st.started || !S || S.save !== save) return;
  const quicker = save.revealed ? null : dailyResults.quickerThan(st, save.elapsedMs);
  const nums = $('#solved-daily-numbers');
  nums.textContent = `Everyone on this puzzle: ${dailyResults.summaryLine(st)}.${quicker !== null ? ` You were quicker than ${quicker}% of the other solvers.` : ''}`;
  nums.hidden = false;
}
function badgeHtml(b) {
  return `<li class="badge-item${b.at === null ? ' locked' : ''}"><span class="badge-mark" aria-hidden="true">${b.at === null ? '◇' : '◆'}</span><span><b>${esc(b.name)}</b><small>${esc(b.text)}${b.at ? ` Earned ${esc(new Date(b.at).toLocaleDateString())}.` : ''}</small></span>${b.at === null ? '<span class="sr-only">Not earned yet.</span>' : ''}</li>`;
}

$('#share-result').onclick = async () => {
  if (!S) return;
  const save = S.save;
  const p = S.puzzle;
  let streakNow = 0;
  if (save.daily) { try { streakNow = daily.streak(await stats.solveLog(), save.daily).current; } catch (e) { /* no streak */ } }
  const info = {
    title: save.name, tier: p.difficulty.name, theme: p.theme.name, size: `${p.categories.length} × ${p.categories[0].items.length}`,
    time: fmtTime(save.elapsedMs), hints: save.hintsUsed || 0, daily: save.daily ? daily.longDate(save.daily) : null, streak: streakNow,
  };
  const res = await shareResult(info);
  if (res.done === 'shared') $('#share-note').textContent = 'Shared.';
  else if (res.done === 'cancelled') $('#share-note').textContent = '';
  else openShareDialog(res, info);
};
// ====================================================================
// Challenge a friend: the same puzzle by link, with a time to beat
// ====================================================================
$('#challenge-btn').onclick = async () => {
  if (!S || !S.save.solved) return;
  const save = S.save;
  const btn = $('#challenge-btn');
  btn.disabled = true;
  $('#share-note').textContent = 'Making your challenge link…';
  try {
    // One link per solve, kept with the save so sharing again reuses it.
    if (!save.challengeLink) {
      save.challengeLink = (await challenge.create(S.puzzle, save.elapsedMs, save.hintsUsed)).url;
      scheduleSave();
    }
    const text = challenge.message({ title: save.name, time: fmtTime(save.elapsedMs), hints: save.hintsUsed || 0 });
    $('#share-note').textContent = '';
    if (navigator.share) {
      try { await navigator.share({ title: save.name, text, url: save.challengeLink }); $('#share-note').textContent = 'Challenge sent.'; return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    let copied = false;
    try { await navigator.clipboard.writeText(`${text} ${save.challengeLink}`); copied = true; } catch (e) { /* show it to copy */ }
    openShareDialog({ text: `${text} ${save.challengeLink}`, done: copied ? 'copied' : 'show' }, { title: save.name });
  } catch (e) {
    $('#share-note').textContent = e.message || 'The challenge link could not be made.';
  } finally {
    btn.disabled = false;
  }
};

// Both times on the solved panel of a puzzle opened from a challenge link.
async function renderChallenge(save) {
  const box = $('#challenge-result');
  box.hidden = true;
  const c = save.challenge;
  if (!c || !save.solved || save.revealed) return;
  // Counted once: the mark is saved before the result is sent, so reopening
  // the puzzle (even straight away) never counts it again.
  if (!c.sent) {
    c.sent = true;
    await flushSave({ manual: true });
    try { c.result = await challenge.sendResult(c.code, save.elapsedMs, save.hintsUsed); scheduleSave(); } catch (e) { c.result = null; }
  }
  if (!S || S.save !== save) return;
  const won = save.elapsedMs < c.theirMs;
  const r = c.result;
  box.innerHTML = `<h3>${won ? 'You beat your friend\'s time!' : 'Your friend was quicker this time.'}</h3>
    <p>Your time: <b>${fmtTime(save.elapsedMs)}</b>. Your friend's time: <b>${fmtTime(c.theirMs)}</b>.</p>
    ${r && r.plays > 1 ? `<p>${r.beat} of ${r.plays} players who took this challenge beat your friend's time.</p>` : ''}
    <p class="help">Press Challenge a friend to send this puzzle on with your own time.</p>`;
  box.hidden = false;
}

// ?challenge=CODE: open that puzzle (once; the same link later resumes it).
function handleChallengeLink() {
  const code = challenge.linkCode();
  if (!code) return false;
  (async () => {
    const existing = (await store.listSaves()).find((x) => x.challenge && x.challenge.code === code);
    if (existing) { openGame(existing); return; }
    if (!CLOUD_URL) { toast('Challenge links need the internet version of the game.'); return; }
    try {
      const c = await challenge.load(code);
      await rememberStory(storyIdOf(c.puzzle));
      const save = newSave(c.puzzle);
      save.challenge = { code, theirMs: c.elapsedMs, theirHints: c.hints || 0 };
      await store.putSave(save);
      openGame(save, { fresh: true });
      toast(`A friend solved this puzzle in ${fmtTime(c.elapsedMs)}. Can you beat that time?`, null, { ms: 9000 });
    } catch (e) {
      toast(e.message || 'That challenge could not be opened.', null, { ms: 9000 });
    }
  })();
  return true;
}

function openShareDialog(res, info) {
  $('#share-text').value = res.text || '';
  $('#share-status').textContent = res.done === 'copied' ? 'The message is copied. Paste it anywhere.' : '';
  const img = $('#share-img'), dl = $('#share-download');
  if (img.src) URL.revokeObjectURL(img.src);
  if (res.blob) { img.src = URL.createObjectURL(res.blob); dl.href = img.src; }
  img.hidden = !res.blob;
  dl.hidden = !res.blob || isDesktop;
  dl.download = `${(info.title || 'result').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'result'}.png`;
  openDialog($('#dlg-share'), $('#share-copy'));
}
$('#share-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#share-text').value); $('#share-status').textContent = 'Copied. Paste it anywhere.'; }
  catch (e) { $('#share-text').select(); $('#share-status').textContent = 'Press Ctrl+C (or Command+C) to copy the selected message.'; }
};
$('#share-close').onclick = () => $('#dlg-share').close();

// ====================================================================
// Daily puzzle
// ====================================================================
let dailyLatest = null;
async function renderDaily() {
  const box = $('#daily-today');
  $('#daily-section').hidden = isPreview || !daily.available();
  $('[data-cmd=daily]').hidden = $('#daily-section').hidden;
  if ($('#daily-section').hidden) return;
  let l;
  try { l = await daily.latest(); } catch (e) {
    box.innerHTML = `<p class="muted">Today's puzzle could not be loaded${navigator.onLine === false ? ' while offline' : ''}. Try again later.</p><button class="btn small" type="button" id="daily-retry">Try again</button>`;
    $('#daily-retry').onclick = renderDaily;
    return;
  }
  dailyLatest = l;
  const log = await stats.solveLog().catch(() => []);
  const st = daily.streak(log, l.date);
  const saves = await store.listSaves().catch(() => []);
  const todays = saves.find((x) => x.daily === l.date);
  const sl = $('#daily-streak');
  sl.hidden = !st.current && !st.best;
  sl.innerHTML = `<b>${st.current}</b> day streak${st.best > st.current ? ` · best ${st.best}` : ''}`;
  const state = todays ? (todays.solved ? (todays.revealed ? 'Solution revealed' : 'Solved today') : `${todays.percent || 0}% done`) : '';
  box.innerHTML = `<p class="daily-title"><b>${esc(l.title)}</b></p>
    <p class="daily-meta"><span class="pill">${esc(daily.longDate(l.date))}</span> <span class="pill">${esc(l.difficultyName)}</span> <span class="pill">${esc(l.themeName)}</span> <span class="pill">${l.categories} × ${l.items}</span>${state ? ` <span class="pill">${esc(state)}</span>` : ''}</p>
    ${l.offline ? '<p class="help">Offline: showing the last daily puzzle this device saw.</p>' : ''}
    <p class="daily-numbers muted" id="daily-numbers" hidden></p>
    <button class="btn primary" type="button" data-daily="${esc(l.date)}">${todays ? (todays.solved ? "Open today's puzzle" : "Continue today's puzzle") : "Play today's puzzle"}</button>
    <div class="daily-email" id="daily-email" hidden></div>`;
  renderDailyEmail();
  if (!l.offline) dailyResults.statsFor(l.date).then((st) => {
    const el = $('#daily-numbers');
    if (!st || !el || dailyLatest !== l) return;
    el.textContent = dailyResults.summaryLine(st);
    el.hidden = !el.textContent;
  });
  renderPicks(saves);
  renderEditions(saves);
  const earlier = (l.days || []).filter((d) => d < l.date).slice(0, 7);
  $('#daily-earlier').hidden = !earlier.length;
  $('#daily-list').innerHTML = earlier.map((d) => {
    const sv = saves.find((x) => x.daily === d);
    return `<li><button class="btn quiet small" type="button" data-daily="${esc(d)}">${esc(daily.longDate(d))}</button>${sv ? ` <span class="muted">${sv.solved ? (st.days.has(d) ? 'solved' : 'finished') : `${sv.percent || 0}% done`}</span>` : ''}</li>`;
  }).join('');
}
// Hand-picked: the best-rated daily puzzles and ones the team picked
// (daily/picks.json from the website build). They never add to a streak.
async function renderPicks(saves) {
  const box = $('#daily-picks');
  const list = await daily.picks();
  box.hidden = !list.length;
  if (!list.length) return;
  $('#daily-picks-list').innerHTML = list.map((x) => {
    const sv = saves.find((s) => s.daily === x.date);
    const why = x.hand ? 'picked by the team' : `rated ${x.average} of 5`;
    return `<li><button class="btn quiet small" type="button" data-daily="${esc(x.date)}">${esc(x.title)}</button> <span class="muted">${esc(x.difficultyName)} · ${esc(x.themeName)} · ${esc(why)}${sv ? (sv.solved ? ' · finished' : ` · ${sv.percent || 0}% done`) : ''}</span></li>`;
  }).join('');
}

// The puzzle of the week and special editions, under the daily puzzle, and
// the Puzzle emails invite (anyone can sign up, no account needed).
async function renderEditions(saves) {
  const [w, list] = await Promise.all([editions.weeklyLatest(), editions.specials()]);
  // Built with text nodes: titles and dates come from the website's files.
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pill = (text) => el('span', 'pill', text);
  const editionButton = (key, cls, text) => { const b = el('button', cls, text); b.type = 'button'; b.dataset.edition = key; return b; };
  const box = $('#weekly-box');
  box.hidden = !w;
  box.replaceChildren();
  if (w) {
    const key = editions.weeklyKey(w.week);
    const sv = saves.find((x) => x.edition === key);
    const title = el('p', 'daily-title');
    title.append(el('b', null, w.title));
    const meta = el('p', 'daily-meta');
    const pills = [`Week of ${daily.longDate(w.week)}`, w.difficultyName, w.themeName, `${Number(w.categories) || 0} × ${Number(w.items) || 0}`];
    if (sv) pills.push(sv.solved ? 'Finished' : `${Number(sv.percent) || 0}% done`);
    pills.forEach((t, i) => { if (i) meta.append(' '); meta.append(pill(t)); });
    box.append(el('h3', null, 'Puzzle of the week'), title, meta,
      editionButton(key, 'btn', sv ? (sv.solved ? 'Open the puzzle of the week' : 'Continue the puzzle of the week') : 'Play the puzzle of the week'));
  }
  $('#specials-box').hidden = !list.length;
  $('#specials-list').replaceChildren(...list.map((x) => {
    const key = editions.specialKey(x.id);
    const sv = saves.find((s) => s.edition === key);
    const li = el('li');
    li.append(editionButton(key, 'btn quiet small', x.editionTitle), ' ',
      el('span', 'muted', `${daily.longDate(x.date)} · ${x.difficultyName} · ${x.themeName}${sv ? (sv.solved ? ' · finished' : ` · ${Number(sv.percent) || 0}% done`) : ''}`));
    return li;
  }));
  $('#mail-invite').hidden = isPortal || !puzzleMail.available();
  $('#mail-invite-btn').textContent = remote.feature('weeklyMail') ? 'Get the weekly puzzle by email' : 'Get special edition puzzles by email';
}
$('#mail-invite-btn').onclick = () => puzzleMail.open(openDialog);

// A puzzle the team made for this player (Messages > Puzzles for you): opened
// once as a saved puzzle, then continued from Saved puzzles like any other.
async function openTeamPuzzle(puzzle, id) {
  const existing = (await store.listSaves()).find((x) => x.teamPuzzle === id);
  if (existing) { openGame(existing); return; }
  await rememberStory(storyIdOf(puzzle));
  const save = newSave(puzzle);
  save.teamPuzzle = id;
  await store.putSave(save);
  openGame(save, { fresh: true });
}

async function openEdition(key, btn) {
  const existing = (await store.listSaves()).find((x) => x.edition === key);
  if (existing) { openGame(existing); return; }
  if (btn) btn.disabled = true;
  try {
    const { puzzle, label } = await editions.puzzleFor(key);
    await rememberStory(storyIdOf(puzzle));
    const save = newSave(puzzle);
    save.edition = key;
    save.editionLabel = label;
    await store.putSave(save);
    openGame(save, { fresh: true });
  } catch (e) {
    toast(`That puzzle could not be opened. ${e.message || ''}`.trim(), { label: 'Try again', run: () => openEdition(key) });
  } finally { if (btn) btn.disabled = false; }
}

// The daily email switch under today's puzzle: signed-in players with a
// confirmed email can get each day's puzzle in their inbox.
async function renderDailyEmail() {
  const box = $('#daily-email');
  if (!box) return;
  if (isPortal || !dailyEmail.available()) { box.hidden = true; return; }
  if (!signedIn()) {
    box.innerHTML = '<button class="btn quiet small" type="button" id="daily-email-signin">Get each day\'s puzzle by email</button> <span class="help">Free, with a sign-in.</span>';
    box.hidden = false;
    $('#daily-email-signin').onclick = () => openAccount();
    return;
  }
  const st = await dailyEmail.status();
  if (!st || !$('#daily-email')) { box.hidden = true; return; }
  box.innerHTML = st.verified || st.on
    ? `<label class="check"><input type="checkbox" id="daily-email-on"${st.on ? ' checked' : ''}> Email me each day's puzzle</label> <span class="help" id="daily-email-note" aria-live="polite"></span>`
    : '<p class="help">To get each day\'s puzzle by email, first confirm your email address with the link we sent when you made your account.</p>';
  box.hidden = false;
  const cb = $('#daily-email-on');
  if (!cb) return;
  cb.onchange = async () => {
    const note = $('#daily-email-note');
    cb.disabled = true;
    try {
      const r = await dailyEmail.set(cb.checked);
      cb.checked = r.on;
      note.textContent = r.on ? 'Done. It arrives at about 7 am Eastern, with a one-click unsubscribe link.' : 'Done. No more daily emails.';
    } catch (e) {
      cb.checked = !cb.checked;
      note.textContent = navigator.onLine === false ? 'You seem to be offline.' : e.message;
    } finally {
      cb.disabled = false;
    }
  };
}
onAccountChange(() => renderDailyEmail());

$('#daily-section').addEventListener('click', (e) => {
  const b = e.target.closest('[data-daily]');
  if (b) openDaily(b.dataset.daily, b);
  const ed = e.target.closest('[data-edition]');
  if (ed) openEdition(ed.dataset.edition, ed);
});
async function openDaily(date, btn) {
  const existing = (await store.listSaves()).find((x) => x.daily === date);
  if (existing) { openGame(existing); return; }
  if (btn) btn.disabled = true;
  try {
    const puzzle = await daily.puzzleFor(date);
    await rememberStory(storyIdOf(puzzle));
    const save = newSave(puzzle);
    save.daily = date;
    await store.putSave(save);
    dailyResults.started(date);
    openGame(save, { fresh: true });
  } catch (e) {
    toast(`The daily puzzle could not be opened. ${e.message || ''}`.trim(), { label: 'Try again', run: () => openDaily(date) });
  } finally { if (btn) btn.disabled = false; }
}
async function openTodaysDaily() {
  try { const l = dailyLatest || await daily.latest(); openDaily(l.date); }
  catch (e) { toast("Today's puzzle could not be loaded. Try again later."); }
}

// ====================================================================
// My stats and badges
// ====================================================================
async function openStats() {
  openDialog($('#dlg-stats'), $('#stats-close'));
  await renderStats();
}
async function renderStats() {
  const body = $('#stats-body');
  let sm;
  try { sm = await stats.summary(dailyLatest ? dailyLatest.date : daily.utcDay()); } catch (e) { body.innerHTML = '<p>Your stats could not be loaded on this device.</p>'; return; }
  const themeName = (id) => (OPTIONS.themes.find((t) => t.id === id) || {}).name || id;
  const hours = sm.totalMs / 3600000;
  const earned = sm.badges.filter((b) => b.at);
  body.innerHTML = `
    <dl class="solved-stats stats-tiles">
      <div><dt>Puzzles solved</dt><dd>${sm.solved}</dd></div>
      <div><dt>Without hints</dt><dd>${sm.noHints}</dd></div>
      <div><dt>Daily streak</dt><dd>${sm.streak.current}</dd></div>
      <div><dt>Best streak</dt><dd>${sm.streak.best}</dd></div>
      <div><dt>Last 30 days</dt><dd>${sm.last30}</dd></div>
      <div><dt>Time solving</dt><dd>${hours >= 1 ? `${Math.round(hours * 10) / 10} h` : `${Math.round(sm.totalMs / 60000)} min`}</dd></div>
    </dl>
    ${sm.solved ? '' : '<p>Solve a puzzle and your stats start here.</p>'}
    ${sm.byTier.length ? `<h3>By difficulty</h3><div class="table-wrap"><table class="stats-table"><thead><tr><th scope="col">Level</th><th scope="col">Solved</th><th scope="col">Best time</th><th scope="col">Average time</th><th scope="col">Average hints</th></tr></thead><tbody>
      ${sm.byTier.map((t) => `<tr><th scope="row">${esc((TIERS[t.tier] || {}).name || t.tier)}</th><td>${t.solved}</td><td>${fmtTime(t.bestMs)}</td><td>${fmtTime(t.avgMs)}</td><td>${Math.round(t.avgHints * 10) / 10}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${sm.themes.length ? `<h3>Favorite themes</h3><p>${sm.themes.slice(0, 5).map(([id, n]) => `${esc(themeName(id))} (${n})`).join(', ')}</p>` : ''}
    ${sm.revealed ? `<p class="help">${sm.revealed} puzzle${sm.revealed > 1 ? 's' : ''} ended with the solution revealed; those don't count above.</p>` : ''}
    ${specialBadgesHtml()}
    <h3>Badges <span class="muted">${earned.length} of ${sm.badges.length}</span></h3>
    <ul class="badges">${[...earned, ...sm.badges.filter((b) => !b.at)].map(badgeHtml).join('')}</ul>`;
}
$('#stats-close').onclick = () => $('#dlg-stats').close();

// Special badges from the team (special-badges.js): given by hand, like
// Tester, or earned at a milestone the team sets. Earned ones first, then the
// milestones still to reach with how far along the player is.
function specialBadgesHtml() {
  const have = specialBadges.earned();
  const next = specialBadges.goals();
  if (!have.length && !next.length) return '';
  const item = (b, locked) => `<li class="badge-item special${locked ? ' locked' : ''}"><span class="badge-mark badge-emoji" aria-hidden="true">${esc(b.icon)}</span><span><b>${esc(b.name)}</b><small>${esc(b.description)}${b.at ? ` Earned ${esc(new Date(b.at).toLocaleDateString())}.` : ''}${locked && b.need ? ` ${b.have} of ${b.need} so far.` : ''}</small>${locked && b.need ? `<progress max="${b.need}" value="${b.have}" aria-label="${esc(`${b.name}: ${b.have} of ${b.need}`)}"></progress>` : ''}</span>${locked ? '<span class="sr-only">Not earned yet.</span>' : ''}</li>`;
  return `<h3>Special badges${have.length ? ` <span class="muted">${have.length}</span>` : ''}</h3>
    <ul class="badges">${have.map((b) => item(b, false)).join('')}${next.map((b) => item(b, true)).join('')}</ul>`;
}

let coachBusy = false;
async function updateCoach() {
  const box = $('#coach');
  if (!S || !S.save.coach || S.save.solved || S.marks.size >= 4) {
    if (S && S.save.coach && S.marks.size >= 4) endCoach();
    box.hidden = true;
    return;
  }
  if (coachBusy) return;
  coachBusy = true;
  try {
    const res = await engine.hint(S.puzzle, markList());
    if (!S || !S.save.coach) return;
    if (res.kind === 'step' && res.marks.length) {
      const m = res.marks[0];
      $('#coach-text').innerHTML = `<b>Tip:</b> ${esc(res.levels[2])} So mark <b>${m.mark}</b> where ${esc(S.ix.label(m.a))} meets ${esc(S.ix.label(m.b))}.`;
    } else if (res.kind === 'mistake') {
      $('#coach-text').innerHTML = `<b>Tip:</b> ${esc(res.levels[1])} Undo (Ctrl+Z) takes back the last mark.`;
    }
    box.hidden = false;
  } catch (e) { box.hidden = true; } finally { coachBusy = false; }
}
function endCoach() {
  S.save.coach = false;
  settings.coach = false;
  store.saveSettings(settings);
  $('#coach').hidden = true;
  scheduleSave();
}
$('#coach-skip').onclick = () => { endCoach(); S.grid.focusKey(S.save.focus); };

let timerId = null;
function startTimer() {
  stopTimer();
  if (!S || S.save.solved) { renderTimer(); return; }
  S.started = performance.now();
  timerId = setInterval(tickTimer, 1000);
  renderTimer();
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function tickTimer() {
  if (!S) return;
  const now = performance.now();
  if (!document.hidden) S.save.elapsedMs += now - S.started;
  S.started = now;
  renderTimer();
}
function renderTimer() {
  $('#timer').hidden = !settings.showTimer;
  if (S) $('#timer').textContent = `Time ${fmtTime(S.save.elapsedMs)}`;
}
document.addEventListener('visibilitychange', () => { if (S && timerId) { if (document.hidden) tickTimer(); else S.started = performance.now(); } if (document.hidden) flushSave(); });

// ====================================================================
// Autosave
// ====================================================================
let saveTimer = null;
let retryTimer = null;
function scheduleSave() {
  if (!S) return;
  S.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}
async function flushSave({ manual = false } = {}) {
  clearTimeout(saveTimer);
  if (!S || (!S.dirty && !manual)) return;
  const save = S.save;
  save.marks = Object.fromEntries(S.marks);
  save.lastPlayed = Date.now();
  try {
    await store.putSave(save);
    if (S && S.save === save) S.dirty = false;
    clearTimeout(retryTimer);
    $('#saveind').textContent = 'Saved';
    if (manual) status('Saved on this device.');
  } catch (e) {
    $('#saveind').textContent = '';
    showError('Could not save your progress. Retrying in 5 seconds. Your marks are still here.');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => flushSave(), 5000);
  }
}
function showError(text) {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.className = 'sr-only';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 8000);
  status(text);
}
window.addEventListener('pagehide', () => flushSave());

// ====================================================================
// Multimedia: scene, cast, witness clues, section chimes, adaptive difficulty
// ====================================================================
// The admin dashboard's characters say their own lines before a clue; the
// rest of the cast lead in by their personality (castbook.js).
const sayingFor = (who, n) => lineOf(characterOf(S.puzzle, who), 'clue', n) || sayingOf(who, 'clue', n);
// Who a character is, for their cast button and speech bubble.
function aboutOf(name) {
  const own = characterOf(S.puzzle, name);
  if (own) return { label: 'Special guest', about: own.personality ? `${name}: ${own.personality}` : name };
  const p = profileOf(name);
  return { label: p.label, about: `${name} ${p.about}` };
}

// Each clue is told by one character, preferably one the clue is not about.
function assignWitnesses(puzzle, ix) {
  const names = ix.cats[0].items.map((i) => i.label);
  const out = {};
  const load = Object.fromEntries(names.map((n) => [n, 0]));
  for (const c of puzzle.clues) {
    const free = names.filter((n) => !c.text.includes(n));
    const pool = free.length ? free : names;
    const who = pool.reduce((best, n) => (load[n] < load[best] ? n : best), pool[(c.number - 1) % pool.length]);
    load[who]++;
    out[c.number] = who;
  }
  return out;
}

function winnerOf(puzzle, ix) {
  const q = puzzle.questions[0];
  return q && q.category === ix.cats[0].id ? ix.label(q.answer) : null;
}

function renderMedia() {
  const p = S.puzzle;
  S.sceneLayers = -1;
  $('#scene').innerHTML = sceneSvg(p, 0);
  const names = S.ix.cats[0].items.map((i) => i.label);
  const drawCastRow = () => {
  $('#cast-row').innerHTML = names.map((n) => {
    const count = Object.values(S.witness).filter((w) => w === n).length;
    const who = aboutOf(n);
    return `<button class="cast-btn" type="button" data-who="${esc(n)}" aria-pressed="false" title="${esc(who.about)}">${portrait(p, n, { style: settings.portraitStyle })}<span>${esc(n)}</span><small class="trait">${esc(who.label)}</small><small>${count} clue${count === 1 ? '' : 's'}</small></button>`;
  }).join('');
  };
  drawCastRow();
  // The DiceBear faces load after the first screen; if they are not here yet,
  // the game's own faces show and the row is drawn again when they arrive.
  if (!portraitsReady()) {
    const game = S;
    loadPortraits().then(() => {
      if (S !== game) return;
      // AI-painted faces (img) and pressed buttons carry over to the new row.
      const before = $$('#cast-row .cast-btn').map((b) => ({ img: b.querySelector('img'), pressed: b.getAttribute('aria-pressed') }));
      drawCastRow();
      $$('#cast-row .cast-btn').forEach((b, i) => {
        const was = before[i];
        if (!was) return;
        b.setAttribute('aria-pressed', was.pressed || 'false');
        if (was.img) b.querySelector('svg')?.replaceWith(was.img);
      });
      const teller = narratorOf(p);
      const told = $('#told-by .told-face');
      if (teller && told && !told.querySelector('img')) told.innerHTML = characterFace(teller, { size: 40 });
    }).catch(() => {});
  }
  $('#bubble').hidden = true;
  S.sceneUrl = null;
  S.portraitUrls = {};
  loadAiArt();
  loadCharacterArt();
  // Make the start of the story narration ahead of time so Read aloud plays at once.
  if (voiceOn()) ai.warmVoice(settings, p, 'narrator', p.story.paragraphs.join(' '));
}

const voiceOn = () => settings.sound && settings.readAloud && !settings.silent;

// Swap in AI pictures from the game's server when the admin dashboard has them
// on. Built-in art stays until they arrive, and whenever they can't be made.
async function loadAiArt() {
  if (isPreview || settings.silent || !ai.picturesReady(settings)) return;
  const game = S;
  const p = game.puzzle;
  const tag = document.createElement('span');
  tag.className = 'painting';
  tag.textContent = 'Painting the scene…';
  $('#scene').append(tag);
  try {
    const blob = await ai.sceneImage(settings, p);
    if (S !== game) return;
    game.sceneUrl = URL.createObjectURL(blob);
    $('#scene').innerHTML = `<div class="ai-scene"><img src="${game.sceneUrl}" alt=""><div class="veil">${'<i></i>'.repeat(5)}</div></div>`;
    game.sceneLayers = -1;
    updateProgress();
  } catch (e) {
    tag.remove();
    if (S === game) console.warn('AI picture not made:', e.message);
    return;
  }
  if (settings.aiPictures !== 'all') return;
  for (const btn of $$('#cast-row .cast-btn')) {
    const who = btn.dataset.who;
    if (characterOf(p, who)) continue; // keeps the face made for them
    try {
      const blob = await ai.portraitImage(settings, p, who);
      if (S !== game) return;
      game.portraitUrls[who] = URL.createObjectURL(blob);
      btn.querySelector('svg, img').outerHTML = `<img class="portrait-img" src="${game.portraitUrls[who]}" alt="">`;
    } catch (e) { if (S === game) console.warn('AI portrait not made:', e.message); return; }
  }
}

// AI portraits painted for the game's own characters in the admin dashboard.
// Their drawn face shows until the picture arrives, and whenever it can't.
async function loadCharacterArt() {
  if (isPreview || settings.silent) return;
  const game = S;
  for (const c of game.puzzle.characters || []) {
    if (!c.portrait) continue;
    try {
      const blob = await ai.characterImage(c);
      if (S !== game) return;
      const url = URL.createObjectURL(blob);
      if (c.inCast) {
        game.portraitUrls[c.name] = url;
        const btn = $(`#cast-row .cast-btn[data-who="${CSS.escape(c.name)}"]`);
        btn?.querySelector('svg, img')?.replaceWith(Object.assign(document.createElement('img'), { className: 'portrait-img', src: url, alt: '' }));
      } else {
        $('#told-by .told-face')?.replaceChildren(Object.assign(document.createElement('img'), { className: 'portrait-img', src: url, alt: '' }));
      }
    } catch (e) { /* the drawn face stays */ }
  }
}

function revealScene(fraction) {
  const n = Math.min(5, Math.ceil(fraction * 5 - 1e-9));
  const layers = $$('#scene .layer');
  layers.forEach((g, i) => g.classList.toggle('on', i < Math.max(n, 1)));
  $$('#scene .veil i').forEach((v, i) => v.classList.toggle('gone', i < Math.max(n, 1)));
  if (S.sceneLayers >= 0 && n > S.sceneLayers && !settings.silent) status('A new part of the scene appears.');
  S.sceneLayers = n;
}

function celebrateBlock(rc, cc) {
  sound('section');
  for (const r of rc.items) for (const c of cc.items) {
    const td = S.grid.cells.get(S.ix.key(r.id, c.id));
    if (td) { td.classList.remove('pulse'); void td.offsetWidth; td.classList.add('pulse'); }
  }
  announce(`${rc.name} and ${cc.name} section complete.`);
}

$('#cast-row').addEventListener('click', (e) => {
  const b = e.target.closest('.cast-btn');
  if (!b) return;
  const who = b.dataset.who;
  $$('#cast-row .cast-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const clues = S.puzzle.clues.filter((c) => S.witness[c.number] === who);
  $$('#clue-list li.spot').forEach((li) => li.classList.remove('spot'));
  clues.forEach((c) => $(`#clue-list li[data-n="${c.number}"]`)?.classList.add('spot'));
  const nothing = characterOf(S.puzzle, who) ? "I didn't see anything, I promise." : sayingOf(who, 'nothing', S.puzzle.clues.length);
  $('#bubble').innerHTML = `<p class="about">${esc(aboutOf(who).about)}.</p>` + (clues.length
    ? clues.map((c) => `<p><span class="who">${esc(who)}:</span> “${esc(sayingFor(who, c.number))} ${esc(c.text)}” <span class="muted">(clue ${c.number})</span></p>`).join('')
    : `<p><span class="who">${esc(who)}:</span> “${esc(nothing)}”</p>`);
  $('#bubble').hidden = false;
  sound('whoosh');
  if (voiceOn()) {
    const lines = clues.length ? clues.map((c) => `${sayingFor(who, c.number)} ${c.text}`).join(' ') : nothing;
    voiceWaitNote();
    ai.speak(settings, S.puzzle, who, lines, { volume: settings.volume / 100 });
  }
});

$('#read-story').addEventListener('click', () => {
  if (!S) return;
  if (!settings.sound) { status('Sound is off. Turn it on to hear the story.'); return; }
  voiceWaitNote();
  ai.speak(settings, S.puzzle, 'narrator', S.puzzle.story.paragraphs.join(' '), { volume: settings.volume / 100 });
});
// Every clue, in order, each told by its witness in their own voice. The clue
// being read is highlighted; pressing the button again stops.
function readCluesDone() {
  $$('#clue-list li.reading').forEach((li) => li.classList.remove('reading'));
  const b = $('#read-clues');
  b.setAttribute('aria-pressed', 'false');
  b.textContent = 'Read the clues aloud';
}
$('#read-clues').addEventListener('click', async () => {
  if (!S) return;
  const b = $('#read-clues');
  if (b.getAttribute('aria-pressed') === 'true') { ai.stopSpeaking(); readCluesDone(); return; }
  if (!settings.sound) { status('Sound is off. Turn it on to hear the clues.'); return; }
  const game = S;
  const lines = game.puzzle.clues.map((c) => ({ who: game.witness[c.number] || 'narrator', text: `Clue ${c.number}. ${c.text}` }));
  b.setAttribute('aria-pressed', 'true');
  b.textContent = 'Stop reading the clues';
  voiceWaitNote();
  await ai.speakLines(settings, game.puzzle, lines, {
    volume: settings.volume / 100,
    onLine: (i) => {
      if (S !== game) return;
      $$('#clue-list li.reading').forEach((li) => li.classList.remove('reading'));
      if (i >= 0) $(`#clue-list li[data-n="${game.puzzle.clues[i].number}"]`)?.classList.add('reading');
    },
  });
  readCluesDone();
});
// Natural voices are the default for all speech. On first launch they download
// in the background; later launches load them from the browser's cache early,
// so the first Read aloud starts promptly.
// While the Introduction plays, the voice engine waits: its download and
// start-up compete with the video and can make the narration stall.
let voicesHeld = false;
async function ensureNaturalVoices() {
  if ($('#dlg-video').open) { voicesHeld = true; return; }
  if (!['server', 'kokoro'].includes(settings.voiceProvider) || settings.silent || ai.kokoroLoading()) return;
  const first = !ai.kokoroReady(settings);
  if (first && (navigator.onLine === false || navigator.connection?.saveData)) return;
  if (first) toast('Getting the natural voices ready. This is a one-time download of about 90 MB.', null, { ms: 8000 });
  try {
    await ai.kokoroDownload();
    if (first) {
      settings.kokoroReady = true;
      store.saveSettings(settings);
      toast('Natural voices are ready.');
    }
  } catch (e) {
    console.warn('Natural voices not ready:', e.message);
    if (first) toast('The natural voices could not be downloaded yet. The game will try again next time.', { label: 'Try again', run: ensureNaturalVoices });
  }
}
function voiceWaitNote() {
  if (S && ai.kokoroLoading() && ai.voiceKind(settings, S.puzzle) === 'kokoro') status(`The natural voices are still getting ready (${Math.round(ai.kokoroProgress() * 100)}%). Speech starts when they are.`);
}

// Adaptive difficulty: suggest a level from the last few solves.
async function recordSolve(save) {
  const { K, N } = S.ix;
  // The stats page, daily streak and badges. First, because a new solve log
  // starts from the history below.
  let fresh = [];
  try { fresh = await stats.record(save); } catch (e) { /* stats are optional */ }
  const hist = await store.getMeta('history', []);
  hist.push({ tier: save.puzzle.difficulty.id, ms: save.elapsedMs, hints: save.hintsUsed, revealed: !!save.revealed, cells: (K * (K - 1) / 2) * N * N, at: Date.now() });
  await store.setMeta('history', hist.slice(-50));
  if (S && S.save === save) { S.newBadges = fresh; renderSolvedExtras(save); renderSupportAsk(save); }
  if (fresh.length) {
    sound('section');
    toast(fresh.length === 1 ? `Badge earned: ${fresh[0].name}` : `${fresh.length} badges earned: ${fresh.map((b) => b.name).join(', ')}`, { label: 'My badges', run: openStats });
  }
  // Special badges for milestones are checked on the server against the
  // synced solve log, so look again once this solve has had time to sync.
  setTimeout(() => specialBadges.refresh(), 20_000);
}

function suggestTier(hist) {
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  const i = TIER_IDS.indexOf(last.tier);
  const expectedMs = last.cells * MINUTES_PER_CELL[last.tier] * 60000;
  const recent = hist.slice(-3).filter((h) => h.tier === last.tier);
  if (last.revealed || last.hints >= 5) return { tier: TIER_IDS[Math.max(0, i - 1)], why: 'Your last puzzle needed a lot of help, so a gentler level may be more fun.' };
  if (last.hints <= 1 && last.ms <= expectedMs && i < TIER_IDS.length - 1) return { tier: TIER_IDS[i + 1], why: 'You solved your last puzzle quickly with little help.' };
  if (recent.length >= 2 && recent.every((h) => h.hints <= 2) && i < TIER_IDS.length - 1) return { tier: TIER_IDS[i + 1], why: 'You have solved several in a row at this level.' };
  return { tier: last.tier, why: 'This level looks like a good fit right now.' };
}

async function renderSuggestion() {
  $$('#tier-choices .suggest').forEach((el) => el.remove());
  let hist = [];
  try { hist = await store.getMeta('history', []); } catch (e) { return; }
  const s = suggestTier(hist);
  if (!s) return;
  const span = $(`#tier-choices input[value="${s.tier}"] + span`);
  if (span) span.insertAdjacentHTML('beforeend', `<small class="suggest"><strong>Suggested for you.</strong> ${esc(s.why)}</small>`);
}

// ====================================================================
// Print
// ====================================================================
function openPrint() {
  if (!S || isPreview) return;
  const dlg = $('#dlg-print');
  const paper = /^en-(US|CA)|es-(MX|US)|fil|-PH$/.test(navigator.language || '') ? 'letter' : 'A4';
  $$('input[name=ppaper]').forEach((r) => { r.checked = r.value === (S.save.paper || paper); });
  $('#p-steps-row').hidden = !['basic', 'easy'].includes(S.puzzle.difficulty.id);
  $('#p-steps').checked = false;
  $('#p-key').checked = false;
  $('#p-notes-row').hidden = !(S.save.myNotes || '').trim();
  $('#p-mynotes').checked = false;
  $('#print-pdf').hidden = !(window.desktop && window.desktop.savePdf);
  openDialog(dlg, $('input[name=pwhat]:checked'));
}
function printOptions() {
  return {
    withMarks: $('input[name=pwhat]:checked').value === 'progress',
    answerKey: $('#p-key').checked,
    steps: $('#p-key').checked && $('#p-steps').checked && !$('#p-steps-row').hidden,
    paper: $('input[name=ppaper]:checked').value,
    marks: S.marks,
    myNotes: $('#p-mynotes').checked && !$('#p-notes-row').hidden ? S.save.myNotes : '',
    supportLine: support.printLine(),
  };
}
$('#print-go').onclick = () => {
  const o = printOptions();
  S.save.paper = o.paper;
  $('#dlg-print').close();
  setTimeout(() => printPuzzle(S.puzzle, o), 50);
};
$('#print-pdf').onclick = () => {
  const o = printOptions();
  $('#dlg-print').close();
  printPuzzle(S.puzzle, o, { pdf: () => window.desktop.savePdf(S.puzzle.title, o.paper) });
};
$('#print-cancel').onclick = () => $('#dlg-print').close();

// Printable puzzle packs for signed-in players (print-pack.js): new puzzles
// from the same writer as New puzzle, so stories are never reused.
printPack.initPrintPack({
  openDialog, openAccount, signedIn, toast, newSave,
  makePuzzle: (o) => makePuzzle(o),
  putSave: (s) => store.putSave(s),
  refreshSaved: () => { if (!$('#screen-home').hidden) renderSaved(); },
  tiers: () => OPTIONS.difficulties,
  lastTier: () => setup.tier,
  themes: () => { const off = new Set([...remote.disabledThemes(), ...lockedThemes()]); return OPTIONS.themes.filter((t) => !off.has(t.id)); },
  supportLine: () => support.printLine(),
});

// ====================================================================
// Settings, help, menu, keyboard
// ====================================================================
// Choices that use the game's server show only when it is set up and the
// admin dashboard has not switched that feature off for everyone.
// The game's social pages under the home screen, as soon as a link is set in
// the admin dashboard (Settings and switches > Social links). Until the game's
// server answers (or with no server) it shows the page the game launched with.
function renderSocial() {
  const box = $('#home-social');
  if (!box) return;
  const set = remote.social();
  const list = socialLinks(set ? Object.fromEntries(set.map((s) => [s.id, s.url])) : DEFAULT_LINKS);
  box.innerHTML = list.length ? `<p class="muted small">Follow the game</p>${socialHtml(list)}` : '';
  box.hidden = !list.length;
}

function applyFeatures() {
  renderSocial();
  for (const el of $$('.needs-cloud')) el.hidden = !share.available() || (!!el.dataset.feature && !remote.feature(el.dataset.feature));
  $('#music-settings').hidden = !remote.feature('music');
  $('[data-cmd=feedback]').hidden = !feedbackBox.available();
  $('[data-cmd=mail]').hidden = isPortal || !puzzleMail.available();
  $('#mail-invite').hidden = isPortal || !puzzleMail.available();
  $('[data-cmd=suggest]').hidden = !characters.suggestionsOpen();
  $('[data-cmd=numberplace]').hidden = !numberPlace.enabled();
  $('[data-cmd=pack]').hidden = isPreview || !printPack.available();
  $('#feedback-idea').hidden = !feedbackBox.available();
  messages.configChanged();
  const support = remote.supportUrl();
  $('#support-link').hidden = !support;
  if (support) $('#support-link').href = support;
  competeUi.refreshMiniBoard();
}
applyFeatures();
share.init({
  onNotice: () => toast('The game now learns from everyone\'s puzzles. Your results are shared without your name or any personal details. Turn off "Learn from how I play" in Settings to stop.', { label: 'Settings', run: openSettings }, { ms: 12000 }),
});

function openSettings() {
  const f = $('#settings-form');
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') el.checked = settings[el.name] === el.value;
    else if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else if (el.type === 'range' || el.type === 'password' || el.type === 'text') el.value = settings[el.name] ?? '';
  }
  fillLanguages();
  openDialog($('#dlg-settings'), f.querySelector('input:checked') || f.querySelector('input'));
}
$('#settings-form').addEventListener('change', (e) => {
  const el = e.target;
  if (!el.name) return;
  settings[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.type === 'password' ? el.value.trim() : el.value;
  store.markChosen(settings, el.name);
  if (el.name === 'learn') { store.saveSettings(settings); share.refresh(true); }
  if (el.name === 'language') { settings.languageOffered = true; applyLanguage({ tapped: true }); }
  store.saveSettings(settings);
  applyColorTheme();
  applyMode();
  renderTimer();
  if (el.name === 'coach' && S && el.checked && !S.save.solved) { S.save.coach = true; updateCoach(); }
  if ((el.name === 'sound' && el.checked) || el.name === 'volume') sound('tick');
});

// ---- Language
function fillLanguages() {
  const sel = $('#language');
  if (!sel.options.length) sel.innerHTML = i18n.languages().map((l) => `<option value="${l.code}" lang="${i18n.tagOf(l.code)}">${esc(l.name === l.english ? l.name : `${l.name} (${l.english})`)}</option>`).join('');
  sel.value = i18n.known(settings.language) ? settings.language : i18n.DEFAULT;
  languageNote();
}
function languageNote() {
  const note = $('#language-note');
  if (!note) return;
  const other = settings.language && settings.language !== i18n.DEFAULT;
  const canServer = !!(CLOUD_URL && remote.feature('translate'));
  note.textContent = !other ? '' : canServer || ('Translator' in self)
    ? `The game is in ${i18n.nameOf(settings.language)}. Translations are kept on this device, so pages you have seen work offline.`
    : 'Translations are not available right now, so the game stays in English. Try again later.';
}
function applyLanguage({ tapped = false } = {}) {
  const code = i18n.known(settings.language) ? settings.language : i18n.DEFAULT;
  i18n.setLanguage(code, { tapped });
  languageNote();
}
function renderLangButton() {
  const btn = $('#lang-btn');
  btn.hidden = i18n.current() === i18n.DEFAULT;
  btn.setAttribute('aria-pressed', String(i18n.showingEnglish()));
  btn.textContent = i18n.showingEnglish() ? i18n.nameOf(i18n.current()) : 'English';
  btn.title = i18n.showingEnglish() ? `Back to ${i18n.nameOf(i18n.current())}` : 'Show the original English for now';
}
i18n.onChange(renderLangButton);
$('#lang-btn').onclick = () => { i18n.showEnglish(!i18n.showingEnglish()); renderLangButton(); };
// Players whose device is set to another language are offered it once.
function offerLanguage() {
  if (settings.languageOffered || settings.language !== i18n.DEFAULT) return;
  const mine = (navigator.language || '').toLowerCase();
  const base = mine.split('-')[0];
  if (!base || base === 'en') return;
  const code = i18n.languages().find((l) => l.code !== i18n.DEFAULT && (i18n.tagOf(l.code) === base || l.code === base));
  if (!code) return;
  settings.languageOffered = true;
  store.saveSettings(settings);
  toast(`Play in ${code.name}? The game can translate itself. You can change this any time in Settings > Language.`, {
    label: code.name, run: () => { settings.language = code.code; store.saveSettings(settings); applyLanguage({ tapped: true }); },
  }, { ms: 15000 });
}

function toggleMenu(open) {
  const menu = $('#app-menu');
  const btn = $('#menu-btn');
  open = open ?? menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button:not([hidden])').focus();
}
$('#menu-btn').onclick = () => toggleMenu();
$('#app-menu').addEventListener('keydown', (e) => {
  const items = $$('#app-menu [role=menuitem]:not([hidden])');
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); toggleMenu(false); $('#menu-btn').focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
  else if (e.key === 'Tab') toggleMenu(false);
});
document.addEventListener('pointerdown', (e) => { if (!$('#app-menu').hidden && !e.target.closest('#app-menu, #menu-btn')) toggleMenu(false); });
$('#app-menu').addEventListener('click', async (e) => {
  if (e.target.closest('#support-link')) {
    toggleMenu(false);
    // With support asks on, the menu opens the Supporters window first.
    if (support.on()) { e.preventDefault(); openSupporters(); } else campaign.supportPressed();
    return;
  }
  const b = e.target.closest('button[data-cmd]');
  if (!b) return;
  toggleMenu(false);
  // A dialog opened from the menu gives focus back to the Menu button, not a hidden item.
  $('#menu-btn').focus();
  const cmd = b.dataset.cmd;
  if (cmd === 'new') goHome();
  else if (cmd === 'saved') { await goHome({ focusSaved: true }); $('#saved-section').scrollIntoView(); }
  else if (cmd === 'settings') openSettings();
  else if (cmd === 'stats') openStats();
  else if (cmd === 'pack') printPack.open();
  else if (cmd === 'suggest') characters.openSuggest(openDialog, OPTIONS.themes.filter((t) => !remote.disabledThemes().has(t.id)));
  else if (cmd === 'daily') openTodaysDaily();
  else if (cmd === 'mail') puzzleMail.open(openDialog);
  else if (cmd === 'feedback') feedbackBox.open(openDialog, { themes: OPTIONS.themes });
  else if (cmd === 'messages') messages.open();
  else if (cmd === 'account') openAccount();
  else if (cmd === 'board') competeUi.openBoard();
  else if (cmd === 'install') installApp();
  else if (cmd === 'numberplace') openNumberPlace();
  else if (cmd === 'site') window.open(`${(CLOUD.siteUrl || 'https://thelogicgrid.com').replace(/\/+$/, '')}/?utm_source=portal&utm_medium=store&utm_campaign=portal`, '_blank', 'noopener');
});
$('#home-btn').onclick = () => goHome();

// Number Place: a separate numbers game on its own screen, with the game's look
// (web/js/number-place.js). It shares only anonymous play data, for learning.
async function openNumberPlace() {
  if (S) { await flushSave(); closeGame(); }
  showScreen('np');
  window.scrollTo(0, 0);
  await numberPlace.open({ celebrate: () => celebrateSolve(settings.celebrations, { random: settings.celebrateRandom }), setWorld });
}
$('#np-back').onclick = () => goHome();

// How to play: the step-by-step tutorial and the tips page (tutorial.js).
// The narrated video is the Introduction.
// The open puzzle is saved and closed first; the tutorial never saves.
async function openTutorial(opts = {}) {
  // A closing dialog hands focus back to its button when its close event
  // fires; wait for that, so the tutorial's own focus wins.
  await Promise.all([...document.querySelectorAll('dialog[open]')].map((d) => new Promise((r) => {
    d.addEventListener('close', () => setTimeout(r, 0), { once: true });
    d.close();
  })));
  await flushSave();
  closeGame();
  showScreen('learn');
  tutorial.open(opts);
}
tutorial.initTutorial({
  announce, status, sound, openVideo: () => openVideo(),
  hint: (puzzle, marks) => engine.hint(puzzle, marks),
  onExit: () => goHome(),
  onPlayBasic: async () => {
    await goHome();
    const basic = $('input[name=tier][value=basic]');
    if (basic && !basic.checked) basic.click();
    $('#gen-btn').scrollIntoView({ block: 'center' });
    $('#gen-btn').focus();
    status('Basic is chosen. Pick a theme if you like, then press Generate puzzle.');
  },
});
$('#home-learn').onclick = () => openTutorial();
$('#help-tutorial').onclick = () => openTutorial();
$('#help-tips').onclick = () => openTutorial({ tips: true });
$('#video-learn').onclick = () => openTutorial();
$('#help-intro').onclick = () => openVideo();
$('#welcome-learn').onclick = () => openTutorial({ lesson: 0 });
$('#help-btn').onclick = () => {
  const k = license.shownKey();
  $('#help-license').hidden = !k;
  $('#help-license-key').textContent = k;
  openDialog($('#dlg-help'), $('#help-close'));
};
$('#help-close').onclick = () => $('#dlg-help').close();

// The Introduction (narrated video): offered once on first launch, always at the top.
function openVideo() {
  if ($('#dlg-help').open) $('#dlg-help').close();
  // The Introduction has the floor: game speech and music stop while it plays,
  // and the whole video buffers ahead so the narration doesn't stall.
  try { ai.stopSpeaking(); } catch (e) { /* ignore */ }
  const v = $('#intro-video');
  v.preload = 'auto';
  openDialog($('#dlg-video'), v);
  updateMusic();
}
// The app bar (with How to play, the Introduction and the small scoreboard) stays at the top;
// its height keeps scrolled-to items from hiding under it.
const appbar = $('.appbar');
const setAppbarHeight = () => document.documentElement.style.setProperty('--appbar-h', `${appbar.offsetHeight}px`);
if (window.ResizeObserver) new ResizeObserver(setAppbarHeight).observe(appbar);
setAppbarHeight();
$('#howto-btn').onclick = () => openTutorial();
$('#intro-btn').onclick = openVideo;
$('#miniboard-open').onclick = () => competeUi.openBoard();
$('#video-close').onclick = () => $('#dlg-video').close();
$('#dlg-video').addEventListener('close', () => {
  $('#intro-video').pause();
  updateMusic();
  if (voicesHeld) { voicesHeld = false; afterLoad(ensureNaturalVoices, 1000); }
});
// If the picture or narration gets stuck while playing (a browser media hiccup
// after a slow moment), nudge the player on from where it stopped, then reload
// the video at that point if the nudge isn't enough.
{
  const v = $('#intro-video');
  let last = -1, still = 0;
  setInterval(() => {
    if (!$('#dlg-video').open || v.paused || v.ended || v.seeking) { last = -1; still = 0; return; }
    if (Math.abs(v.currentTime - last) > 0.05) { last = v.currentTime; still = 0; return; }
    still += 1;
    if (still === 3) v.currentTime = Math.min(v.currentTime + 0.05, v.duration || v.currentTime);
    else if (still === 8 && navigator.onLine !== false && (v.readyState >= 3 || v.networkState !== 2)) {
      const at = v.currentTime;
      v.addEventListener('loadedmetadata', () => { v.currentTime = at; v.play().catch(() => {}); }, { once: true });
      v.load();
      still = 0;
    }
  }, 1000);
}
function offerIntro() {
  if (settings.introOffered) return;
  settings.introOffered = true;
  store.saveSettings(settings);
  openDialog($('#dlg-welcome'), $('#welcome-learn'));
}
// Desktop updates: asked about on the home screen only, never mid-puzzle.
let pendingUpdate = null;
let shownUpdate = null;
function offerUpdate() {
  // A desktop update may show over the app key window, so a fix can always arrive.
  if (!pendingUpdate || $('#screen-home').hidden || document.querySelector('dialog[open]:not(#dlg-license)')) return;
  const u = pendingUpdate;
  pendingUpdate = null;
  shownUpdate = u;
  $('#update-text').textContent = u.kind === 'web'
    ? 'A new version of The Fantastical Logic Grid is ready.'
    : `Version ${u.version} of The Fantastical Logic Grid is available.${u.notes ? ` ${u.notes}` : ''}`;
  $('#update-install').textContent = u.kind === 'web' ? 'Reload now' : 'Install and restart';
  $('#update-status').textContent = '';
  openDialog($('#dlg-update'), $('#update-install'));
}
$('#update-later').onclick = () => $('#dlg-update').close();
$('#update-install').onclick = async () => {
  const bar = $('#update-progress');
  $('#update-install').disabled = true;
  $('#update-later').disabled = true;
  bar.hidden = false;
  if (shownUpdate && shownUpdate.kind === 'web') {
    webUpdateAccepted = true;
    $('#update-status').textContent = 'Reloading…';
    shownUpdate.worker.postMessage({ type: 'skip-waiting' });
    return;
  }
  $('#update-status').textContent = 'Downloading the update…';
  try {
    await updates.install((x) => { if (x == null) bar.removeAttribute('value'); else bar.value = x; });
  } catch (e) {
    $('#update-status').textContent = `The update could not be installed (${String(e.message || e).replace(/\.+$/, '')}). You can keep playing and try again next time.`;
    $('#update-install').disabled = false;
    $('#update-later').disabled = false;
    bar.hidden = true;
  }
};
async function checkUpdates() {
  if (!updates.available()) return;
  pendingUpdate = await updates.check();
  offerUpdate();
}

$('#welcome-skip').onclick = () => { $('#dlg-welcome').close(); startQuick(); };
$('#welcome-watch').onclick = () => { $('#dlg-welcome').close(); openVideo(); };
$('#back-saved').onclick = async () => { await goHome({ focusSaved: true }); $('#saved-section').scrollIntoView(); };

const ACTIONS = {
  undo, redo, hint, check,
  clear: clearGrid, restart: startOver, reveal,
  save: () => flushSave({ manual: true }),
  print: openPrint,
  notes: openNotes,
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && S && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act]();
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  // Browser autofill and some extensions send keydown events with no key.
  if (typeof e.key !== 'string') return;
  const k = e.key.toLowerCase();
  const typing = /^(input|select|textarea)$/i.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'radio';
  if (S && !$('#screen-play').hidden) {
    if (mod && k === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); flushSave({ manual: true }); return; }
    if (mod && k === 'p') { e.preventDefault(); openPrint(); return; }
    if (!mod && !e.altKey && !typing && settings.singleKeys) {
      if (k === 'h') { e.preventDefault(); hint(); return; }
      if (k === 'c') { e.preventDefault(); check(); return; }
      if (k === 'n') { e.preventDefault(); openNotes(); return; }
    }
  }
  if (!mod && !e.altKey && !typing && e.key === '?' && settings.singleKeys) { e.preventDefault(); $('#help-btn').click(); }
  if (e.key === 'Escape' && !$('#app-menu').hidden) { toggleMenu(false); $('#menu-btn').focus(); }
});

// ====================================================================
// Install (PWA) and offline
// ====================================================================
// The Install menu offers two things: an icon on the phone's home screen (the
// browser's own install prompt, or Share > Add to Home Screen steps on iPhone
// and iPad) and the Windows desktop app from the latest GitHub release.
const RELEASE_API = 'https://api.github.com/repos/bltaylorjr/fantastical-logic-grid/releases/latest';
const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isStandalone = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || navigator.standalone);
let installEvent = null;
if (!isDesktop && !isPortal) $('[data-cmd=install]').hidden = false;
$('[data-cmd=site]').hidden = !isPortal;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if ($('#dlg-install').open) renderInstall();
});
window.addEventListener('appinstalled', () => { campaign.installed(); installEvent = null; if ($('#dlg-install').open) renderInstall(); });

function renderInstall() {
  const standalone = isStandalone();
  const mobile = isIOS || isAndroid;
  $('#install-phone-done').hidden = !standalone;
  $('#install-phone-btn-row').hidden = standalone || !installEvent;
  $('#install-phone-btn').textContent = mobile ? 'Add to home screen' : 'Install in this browser';
  $('#install-ios').hidden = standalone || !isIOS;
  $('#install-android').hidden = standalone || !isAndroid || !!installEvent;
  $('#install-other').hidden = standalone || mobile;
  $('#install-here-note').hidden = standalone || mobile || !installEvent;
  $('#install-phone-h').textContent = mobile ? 'Add an icon to your home screen' : "Add an icon to your phone's home screen";
  // The desktop app is for Windows; on a phone it goes last, after the Android
  // app. The app key (when downloads need one) comes before the downloads.
  const end = $('#install-close').closest('.dlg-actions');
  const order = mobile ? ['#install-phone', '#install-key', '#install-apk', '#install-desktop'] : ['#install-key', '#install-desktop', '#install-apk', '#install-phone'];
  for (const id of order) end.parentNode.insertBefore($(id), end);
}

// Points the Windows button straight at the newest installer when GitHub
// answers; otherwise it opens the release page, where the installer is listed.
let installerLooked = false;
async function findInstaller() {
  if (installerLooked) return;
  installerLooked = true;
  try {
    const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name) && !/debug/i.test(a.name));
    if (apk) {
      $('#install-apk-btn').href = apk.browser_download_url;
      $('#install-apk-size').textContent = `Version ${version}, ${Math.round(apk.size / 1048576)} MB`;
      $('#install-apk').hidden = false;
    }
    const exe = (rel.assets || []).find((a) => /x64-setup\.exe$/i.test(a.name));
    if (!exe) return;
    $('#install-desktop-btn').href = exe.browser_download_url;
    $('#install-desktop-size').textContent = `Version ${version}, ${Math.round(exe.size / 1048576)} MB`;
  } catch (e) { /* the release page link still works */ }
}

function installApp() {
  renderInstall();
  findInstaller();
  licenseDownload.render();
  openDialog($('#dlg-install'), $('#install-h'));
}
$('#install-close').onclick = () => $('#dlg-install').close();
$('#install-desktop-btn').addEventListener('click', () => campaign.downloaded());
licenseDownload.init({ toast, openAccount: () => openAccount() });
$('#install-phone-btn').onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  if (choice.outcome === 'accepted') { $('#dlg-install').close(); toast('Installed. Open the game from its icon on your home screen, Start menu or dock.'); }
  else renderInstall();
};
// Offline support starts after the first screen: the first install downloads
// the whole game (about 1.4 MB), so it waits for the player's first tap or key,
// or 10 seconds after the page is idle, and never slows the first load.
if ('serviceWorker' in navigator && !isDesktop && !isPortal && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  let started = false;
  const start = () => { if (!started) { started = true; watchWebUpdates(); } };
  if (navigator.serviceWorker.controller) start();
  else { afterFirstUse(start); afterLoad(start, 10000); }
}

// Website updates: a new version installs in the background; the player is
// offered a reload on the home screen, never mid-puzzle.
let swReg = null;
async function watchWebUpdates() {
  let reg;
  try { reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { return; /* offline support is optional */ }
  if (!reg) return; // some browsers and privacy settings resolve without a registration
  swReg = reg;
  const waiting = () => {
    if (!reg.waiting || !navigator.serviceWorker.controller) return; // first install needs no reload
    pendingUpdate = { kind: 'web', worker: reg.waiting };
    offerUpdate();
  };
  waiting();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') waiting(); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && webUpdateAccepted) { reloading = true; location.reload(); } });
  const check = () => reg.update().catch(() => {});
  setInterval(check, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
let webUpdateAccepted = false;

// Pull down to refresh (touch screens): saves first, then reloads. If a new
// version of the website is waiting, the refresh brings it in.
async function refreshApp() {
  if (swReg && navigator.serviceWorker?.controller) {
    if (!swReg.waiting) await Promise.race([swReg.update().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    if (swReg.waiting) {
      webUpdateAccepted = true;
      swReg.waiting.postMessage({ type: 'skip-waiting' });
      setTimeout(() => location.reload(), 3000); // in case the new version is slow to take over
      return;
    }
  }
  location.reload();
}
initPullRefresh({ ignore: ['#grid-region', '#cellmenu', '#app-menu'], beforeReload: () => flushSave(), reload: refreshApp });

// ====================================================================
// Start
// ====================================================================
async function init() {
  if (isPreview) {
    document.documentElement.classList.add('preview');
    $$('[data-act=print]').forEach((b) => b.remove());
  }
  applyColorTheme();
  applyMode();
  applyLanguage();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyColorTheme);
  perks.init();
  renderSetup();
  characters.init({ onCharactersChanged: applyFeatures });
  remote.init({
    onThemesChanged: () => { if (!$('#screen-home').hidden) renderSetup(); },
    onConfigChanged: () => { settings = store.loadSettings(); applyFeatures(); applyMode(); languageNote(); },
  });
  perks.onChange(() => { if (!$('#screen-home').hidden) renderSetup(); });
  specialBadges.init();
  specialBadges.onChange((fresh) => {
    if (fresh.length && !(S && !S.save.solved)) {
      sound('section');
      toast(fresh.length === 1 ? `Special badge: ${fresh[0].icon} ${fresh[0].name}` : `${fresh.length} special badges: ${fresh.map((b) => `${b.icon} ${b.name}`).join(', ')}`, { label: 'My badges', run: openStats });
    }
    if ($('#dlg-stats').open) renderStats();
  });
  await renderSaved();
  renderSuggestion();
  renderDaily();
  store.requestPersistence();
  initAccounts({
    openDialog, toast, announce,
    // The open puzzle is never replaced underneath the player.
    isBusy: (kind, key) => kind === 'save' && !!S && S.save.id === key,
    onSavesChanged: () => { if (!$('#screen-home').hidden) renderSaved(); },
    onSettingsChanged: () => { settings = store.loadSettings(); applyColorTheme(); applyMode(); applyLanguage(); },
    // Idle sign-out (idle.js): save the open puzzle and go home; after the
    // player signs back in, open it again ('latest' = the newest unfinished one).
    leavePuzzle: async () => { const id = S ? S.save.id : null; if (S) await goHome(); else await flushSave(); return id; },
    resume: async (id) => {
      if (S || !id) return;
      const save = id === 'latest'
        ? (await store.listSaves().catch(() => [])).filter((v) => v && !v.solved).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0]
        : await store.getSave(id).catch(() => null);
      if (!save || save.solved || S) return;
      openGame(save);
      toast(`Welcome back. “${save.name}” is open where you left off.`);
    },
  }).catch(() => { /* accounts are optional */ });
  messages.init({ openDialog, openAccount, announce, playPuzzle: openTeamPuzzle, keepPuzzle: keepStorylinePuzzle, downloadPuzzle: (puzzle) => exportSave(newSave(puzzle)) });
  puzzleReport.init({ openDialog, openAccount, announce });
  puzzleReport.openRepaired(addRepairedPuzzle);
  competeUi.initCompete({
    openDialog, toast, announce, confirmDialog, openAccount, fmtTime, makePuzzle, setupSummary, openRace, findRaceSave,
    openSave: (save) => openGame(save),
    currentTier: () => setup.tier,
    usedStories: () => store.getMeta('usedStories', []),
    game: () => S,
    saveGame: () => scheduleSave(),
    getSetting: (k) => settings[k],
    setSetting: (k, v) => { settings[k] = v; store.saveSettings(settings); },
  });
  competeUi.handleRaceLink();
  window.addEventListener('resize', () => { if (!$('#screen-home').hidden) updatePreview(); });
  document.documentElement.classList.add('ready');
  setTimeout(checkUpdates, 4000);
  // The Windows and Android apps wait here for an app key that works (license.js).
  await license.gate({ announce });
  // thelogicgrid.com/?learn opens How to play straight away; a ?play=now link
  // goes straight into a puzzle; otherwise first-time players get the welcome.
  if (new URLSearchParams(location.search).has('learn')) { settings.introOffered = true; store.saveSettings(settings); openTutorial(); } else if (!handleChallengeLink() && !handlePlayLink()) offerIntro();
  offerLanguage();
  // Heavy extras wait until the first screen is drawn and the page is idle, so
  // they never slow the first load: the DiceBear faces (270 KB), then the
  // natural voices (a 90 MB download the first time, read from the browser's
  // cache after that). The faces and the first voice download also wait for
  // the player's first tap, click or key, so a visit that only looks (or a
  // speed test) never pulls them; a new puzzle loads the faces if needed.
  afterFirstUse(() => afterLoad(() => loadPortraits().catch(() => {}), 0));
  if (!isPreview) {
    if (settings.kokoroReady) afterLoad(ensureNaturalVoices, 1500);
    else afterFirstUse(() => afterLoad(ensureNaturalVoices, 8000));
  }
}
function afterFirstUse(fn) {
  const kinds = ['pointerdown', 'keydown'];
  const once = () => { kinds.forEach((k) => window.removeEventListener(k, once, true)); fn(); };
  kinds.forEach((k) => window.addEventListener(k, once, { capture: true, passive: true }));
}
function afterLoad(fn, delay) {
  const go = () => setTimeout(() => (window.requestIdleCallback || setTimeout)(fn, { timeout: 4000 }), delay);
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
init();

// For tests and debugging.
window.__flg = { get state() { return S; }, settings: () => settings, get tutorial() { return tutorial.state(); } };
