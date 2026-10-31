// The Media library section of the admin dashboard: every sound and picture
// in the game, sorted into groups, to play and look at. It runs the game's own
// code (game-audio.js, game-art.js and game-effects.js are copies made by
// scripts/admin-media.mjs), so it sounds and looks exactly like the game.
// Only the Celebrations switches change anything, through the same setting
// the Settings section saves.
import { MOODS, play, startMusic, stopMusic, setMood, setVolumes } from './game-audio.js';
import { sceneSvg, portraitSvg } from './game-art.js';
import { EFFECTS, THEME_EMOJI, FALLING } from './game-effects.js';
import { createAvatar, notionists, lorelei, openPeeps } from './dicebear.js';
import { LOOKS, BACKGROUNDS } from './looks.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// The sounds players hear, in the order they usually meet them (web/js/app.js
// and tutorial.js call play() with these names).
const SOUNDS = [
  ['X', 'Mark a square with an X', 'A soft pencil scratch, twice.'],
  ['O', 'Mark a square with an O', 'One pencil stroke and a light chime.'],
  ['clear', 'Clear a square, or Start over', 'A short brush sound.'],
  ['tick', 'Tick off a clue', 'A quick paper flick. Also plays when a player turns sound on or moves the volume.'],
  ['hint', 'Ask for a hint', 'Two rising chimes.'],
  ['whoosh', 'A character speaks', 'A soft whoosh as the speech bubble opens.'],
  ['section', 'Finish part of the grid, or earn a badge', 'Three rising chimes.'],
  ['error', 'A wrong mark when checking, or a wrong tutorial answer', 'Two low, gentle notes.'],
  ['ok', 'A right tutorial answer', 'Two bright chimes.'],
  ['solve', 'Puzzle solved', 'A short happy tune.'],
];
const DRAWN = { notionists: ['Sketchbook', notionists], lorelei: ['Storybook', lorelei], openPeeps: ['Hand-drawn', openPeeps] };
const SAMPLE_NAMES = { f: ['Clara', 'Iris', 'Hazel', 'Greta', 'Ivy', 'Nadia'], m: ['Felix', 'Hugo', 'Jasper', 'Otis', 'Milo', 'Ezra'] };
const PET_NAMES = ['Biscuit', 'Pepper', 'Mochi', 'Rusty', 'Pickles', 'Noodle'];
// Two names from a list, moving along each time Show new faces is pressed.
const two = (list) => [list[(seed * 2) % list.length], list[(seed * 2 + 1) % list.length]];
const KOKORO_NAMES = { af_heart: 'Heart', af_bella: 'Bella', af_nicole: 'Nicole (soft)', af_aoede: 'Aoede', am_michael: 'Michael', am_fenrir: 'Fenrir', am_puck: 'Puck' };
const VOICE_LINE = 'Hello! I am one of the voices in The Fantastical Logic Grid. Here is a clue: the baker did not visit the old mill.';

let h = null; // helpers from admin.js
let data = null;
let tab = 'music';
let seed = 1;
let layers = 5;
let playingTheme = null;
let clip = null; // the server voice clip playing now
const clips = new Map(); // voice name -> object URL, so a second listen costs nothing

const volume = () => Number($('#media-volume').value) / 100;
const themeName = (id) => (data.themes.find((t) => t.id === id) || { name: id }).name;
const onOff = (on) => `<span class="badge ${on ? 'ok' : 'warn'}">${on ? 'On' : 'Off'}</span>`;

// A plain-words description of a theme's music, from its MOODS settings.
function describe(m) {
  const minor = m.scale.includes(3) && !m.scale.includes(4);
  const feel = m.scale.includes(6) ? 'dreamy, floating' : minor ? 'thoughtful, a little mysterious' : 'warm and bright';
  const pitch = m.root < 120 ? 'low' : m.root > 170 ? 'higher' : 'middle';
  const chimes = m.chime >= 0.38 ? 'more chimes' : 'fewer chimes';
  return `A ${feel} sound in a ${pitch} key. The chords change every ${m.chord} seconds, with ${chimes}.`;
}

function stopAll() {
  stopMusic();
  playingTheme = null;
  if (clip) { clip.pause(); clip = null; }
  try { speechSynthesis.cancel(); } catch (e) { /* no device voices */ }
  $$('#media-body [data-music][aria-pressed="true"]').forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Play'; });
}

// ------------------------------------------------------------- groups
const GROUPS = {
  music() {
    return `<p class="muted">Calm music made in the browser, one piece for each theme. It plays softly under the puzzle and opens up a little as the grid fills. Theme music for players: ${onOff(data.switches.themeMusic)} (<a href="#settings">Settings and switches</a>, group Sounds). Players can also turn it off or down in their own Settings.</p>
      <div class="row"><div class="field inline grow"><label for="media-mood">How full the grid is</label><input id="media-mood" type="range" min="0" max="100" value="0"><span id="media-mood-n">0%</span></div></div>
      <ul class="media-grid">${Object.entries(MOODS).map(([id, m]) => `<li class="card">
        <h3>${h.esc(themeName(id))}</h3><p class="muted">${h.esc(describe(m))}</p>
        <button type="button" class="btn small" data-music="${h.esc(id)}" aria-pressed="false" aria-label="Play ${h.esc(themeName(id))} music">Play</button></li>`).join('')}</ul>`;
  },
  sfx() {
    return `<p class="muted">Short sounds made in the browser. Every one has something to see too, so no player depends on sound. Sound effects for players: ${onOff(data.switches.soundEffects)} (<a href="#settings">Settings and switches</a>, group Sounds).</p>
      <ul class="media-grid">${SOUNDS.map(([k, name, what]) => `<li class="card"><h3>${h.esc(name)}</h3><p class="muted">${h.esc(what)}</p>
        <button type="button" class="btn small" data-sfx="${k}">Play</button></li>`).join('')}</ul>`;
  },
  voices() {
    const sv = data.serverVoices;
    const btn = (v) => `<button type="button" class="btn small" data-voice="${h.esc(v)}"${sv ? '' : ' disabled'}>${h.esc(v)}</button>`;
    let device = [];
    try { device = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); } catch (e) { /* none */ }
    return `<p class="muted">Where voices come from now: ${h.esc(data.switches.voiceSource)}. Server voices for players: ${onOff(data.switches.voices)} (<a href="#settings">Settings and switches</a>, group Voices).</p>
      <div class="card"><h2>Server voices (Gemini, with the Chirp 3 HD backup)</h2>
        <p class="muted">${sv ? `Each voice reads a short sample. The first listen to a voice uses one of the day's ${h.esc(data.switches.voiceCap)} free voice clips; after that the same clip is reused.` : 'The server voices are not set up yet (no GEMINI_API_KEY or GOOGLE_TTS_KEY secret), so these cannot play. See Connections and setup.'}</p>
        <h3>Women</h3><div class="row">${data.voices.gemini.f.map(btn).join('')}</div>
        <h3>Men</h3><div class="row">${data.voices.gemini.m.map(btn).join('')}</div></div>
      <div class="card"><h2>Voice styles</h2><p class="muted">The styles a player can ask for when they suggest a character, and the voices each one uses.</p>
        ${h.table(['Style', 'Woman', 'Man', 'Pace'], data.voiceStyles.map((s) => [h.esc(s.name), btn(s.gemini.f), btn(s.gemini.m), s.speed === 1 ? 'Normal' : s.speed < 1 ? 'Slower' : 'Quicker']), '', { csv: false })}</div>
      <div class="card"><h2>On-device voices (Kokoro)</h2><p class="muted">Used when the server voices are off or used up. They run on the player's own device after a one-time 90 MB download, so they can only be heard in the game: ${Object.values(KOKORO_NAMES).map(h.esc).join(', ')}.</p></div>
      <div class="card"><h2>This device's built-in voices</h2><p class="muted">The last choice, when nothing else can speak. Each device has its own; these are the ones on the device you are using now.</p>
        <div class="row">${device.length ? device.slice(0, 24).map((v, i) => `<button type="button" class="btn small" data-device-voice="${i}">${h.esc(v.name)}</button>`).join('') : '<span class="muted">This browser has no built-in English voices.</span>'}</div></div>`;
  },
  celebrations() {
    const edit = h.can('admin');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return `<p class="muted">What plays when a player solves a puzzle (never after Reveal, in Silent mode, or when their device asks for less motion). Tick an effect to turn it on for players; this is the same switch as in Settings and switches.${edit ? '' : ' Changing it needs the admin role.'}</p>
      ${still ? '<p class="note">This device asks for less motion, so the effects will not show here. Turn off "reduce motion" in your device settings to watch them.</p>' : ''}
      <div class="row"><div class="field inline"><label for="media-fx-theme">Theme for theme pictures and falling things</label><select id="media-fx-theme">${data.themes.map((t) => `<option value="${h.esc(t.id)}">${h.esc(t.name)}</option>`).join('')}</select></div>
        <button type="button" class="btn small primary" id="media-fx-mix">Play what players see now</button></div>
      <p class="muted">${h.esc(data.random.label)}: ${onOff(data.random.value)}. ${h.esc(data.random.help)}</p>
      <ul class="media-grid">${data.celebrations.map((c) => `<li class="card"><h3>${h.esc(c.label)}</h3><p class="muted">${h.esc(c.help)}</p>
        <div class="row"><button type="button" class="btn small" data-fx="${c.key}"${EFFECTS[c.key] ? '' : ' disabled'}>Play</button>
        <label class="check"><input type="checkbox" data-fx-on="${c.key}"${c.value ? ' checked' : ''}${edit ? '' : ' disabled'}> On for players</label></div></li>`).join('')}</ul>`;
  },
  scenes() {
    const puzzle = (id) => ({ theme: { id }, title: `media-${seed}`, story: { id: `media-${id}-${seed}` } });
    return `<p class="muted">The picture at the top of each puzzle. It starts as a plain background and gains a new layer each time the player finishes part of the grid. Each story gets its own arrangement. ${data.switches.aiPictures === 'none' ? 'AI pictures are off, so players always see these.' : 'When AI pictures are on, players see a painted scene instead once it is ready, and these whenever it is not.'}</p>
      <div class="row"><div class="field inline grow"><label for="media-layers">Parts of the grid finished</label><input id="media-layers" type="range" min="0" max="5" value="${layers}"><span id="media-layers-n">${layers} of 5</span></div>
        <button type="button" class="btn small" id="media-redraw">Show another story</button></div>
      <ul class="media-grid wide">${data.themes.map((t) => `<li class="card"><h3>${h.esc(t.name)}</h3><div class="media-scene">${sceneSvg(puzzle(t.id), layers)}</div></li>`).join('')}</ul>`;
  },
  faces() {
    const drawn = (style, g, i) => {
      try {
        const svg = createAvatar(DRAWN[style][1], { seed: `media:${seed}:${g}${i}`, size: 88, radius: 50, backgroundColor: BACKGROUNDS, backgroundType: ['solid'], ...LOOKS[style][g] }).toString();
        return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" width="88" height="88" alt="${g === 'f' ? 'A woman' : 'A man'}">`;
      } catch (e) { return ''; }
    };
    const own = (id, name, pets) => portraitSvg({ theme: { id }, cast: { many: pets ? 'pets' : 'people' } }, name, { size: 72 });
    const current = { builtin: 'Simple (built-in)', ...Object.fromEntries(Object.entries(DRAWN).map(([k, v]) => [k, v[0]])) }[data.switches.portraitStyle] || data.switches.portraitStyle;
    return `<p class="muted">The faces of the people in each story. Players see the style chosen in <a href="#settings">Settings and switches</a> (group Pictures); now: <b>${h.esc(current)}</b>. A woman's face always comes with a woman's voice, and a man's with a man's. Your own characters keep the face you give them in Characters.</p>
      <div class="row"><button type="button" class="btn small" id="media-redraw">Show new faces</button></div>
      ${Object.entries(DRAWN).map(([style, [name]]) => `<div class="card"><h2>${h.esc(name)}${style === data.switches.portraitStyle ? ' <span class="badge ok">Players see this</span>' : ''}</h2>
        <h3>Women</h3><div class="media-faces">${[0, 1, 2, 3].map((i) => drawn(style, 'f', i)).join('')}</div>
        <h3>Men</h3><div class="media-faces">${[0, 1, 2, 3].map((i) => drawn(style, 'm', i)).join('')}</div></div>`).join('')}
      <div class="card"><h2>Simple (built-in)${data.switches.portraitStyle === 'builtin' ? ' <span class="badge ok">Players see this</span>' : ''}</h2>
        <p class="muted">Drawn by the game itself, with a hat or prop for each theme. Animal stories in Pets get animal faces in every style.</p>
        <ul class="media-grid">${data.themes.map((t) => `<li class="card"><h3>${h.esc(t.name)}</h3><div class="media-faces">${[...two(SAMPLE_NAMES.f), ...two(SAMPLE_NAMES.m)].map((n) => own(t.id, n)).join('')}${t.id === 'pets' ? two(PET_NAMES).map((n) => own(t.id, n, true)).join('') : ''}</div></li>`).join('')}</ul></div>`;
  },
  pictures() {
    const row = (list) => `<span class="media-emoji">${list.map(h.esc).join(' ')}</span>`;
    // Seasons falls by topic: one picture from each topic's list.
    const bySeason = (id) => { const l = Object.entries(FALLING).filter(([k]) => k.startsWith(`${id}/`)).map(([, v]) => v[0]); return l.length ? l : null; };
    return `<p class="muted">Little pictures used by the Theme pictures and Falling snow, leaves or petals celebrations. Themes without their own falling pictures follow the season (snow in winter, blossom in spring, leaves in summer and autumn).</p>
      ${h.table(['Theme', 'Theme pictures', 'What falls'], data.themes.map((t) => [h.esc(t.name), row(THEME_EMOJI[t.id] || []), FALLING[t.id] ? row(FALLING[t.id]) : bySeason(t.id) ? row(bySeason(t.id)) : '<span class="muted">Follows the season</span>']), '', { csv: false })}`;
  },
};

function render() {
  $$('#media-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  if (tab !== 'music') stopAll();
  $('#media-body').innerHTML = GROUPS[tab]();
  if (tab === 'music' && playingTheme) $(`#media-body [data-music="${playingTheme}"]`)?.setAttribute('aria-pressed', 'true');
}

// ------------------------------------------------------------- actions
async function hear(voice, button) {
  await h.act(button, async () => {
    if (!clips.has(voice)) {
      const res = await fetch('/v1/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: VOICE_LINE, voice }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The server voices are not available right now.');
      clips.set(voice, URL.createObjectURL(await res.blob()));
    }
    if (clip) clip.pause();
    clip = new Audio(clips.get(voice));
    clip.volume = volume();
    await clip.play();
  });
}

function wire() {
  $('#media-tabs').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
    h.announce(`Showing ${b.textContent}.`);
  };
  $('#media-stop').onclick = () => { stopAll(); h.announce('Sound stopped.'); };
  $('#media-volume').oninput = () => {
    setVolumes({ sfx: volume(), music: volume() });
    if (clip) clip.volume = volume();
  };
  $('#media-body').oninput = (e) => {
    if (e.target.id === 'media-mood') { $('#media-mood-n').textContent = `${e.target.value}%`; setMood(Number(e.target.value) / 100); }
    if (e.target.id === 'media-layers') {
      layers = Number(e.target.value);
      $('#media-layers-n').textContent = `${layers} of 5`;
      $$('#media-body .scene-svg').forEach((svg) => $$('[data-layer]', svg).forEach((g) => { if (g.dataset.layer !== '0') g.classList.toggle('on', Number(g.dataset.layer) <= layers); }));
    }
  };
  $('#media-body').onchange = async (e) => {
    const c = e.target.closest('[data-fx-on]');
    if (!c) return;
    const ok = await h.act(c, () => h.api('settings', { method: 'POST', body: { key: c.dataset.fxOn, value: c.checked } }), `${c.checked ? 'On' : 'Off'} for players. They get it within about a minute.`);
    if (ok) data.celebrations.find((x) => x.key === c.dataset.fxOn).value = c.checked;
    else c.checked = !c.checked;
  };
  $('#media-body').onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const theme = () => ($('#media-fx-theme') || {}).value;
    if (t.dataset.music) {
      const id = t.dataset.music;
      const was = playingTheme === id;
      stopAll();
      if (was) { h.announce('Music stopped.'); return; }
      setVolumes({ sfx: volume(), music: volume() });
      startMusic(id);
      setMood(Number(($('#media-mood') || {}).value || 0) / 100);
      playingTheme = id;
      t.setAttribute('aria-pressed', 'true');
      t.textContent = 'Stop';
      h.announce(`${themeName(id)} music playing. It fades in over a few seconds.`);
    } else if (t.dataset.sfx) {
      setVolumes({ sfx: volume(), music: volume() });
      play(t.dataset.sfx);
    } else if (t.dataset.voice) {
      await hear(t.dataset.voice, t);
    } else if (t.dataset.deviceVoice) {
      const v = speechSynthesis.getVoices().filter((x) => /^en/i.test(x.lang))[Number(t.dataset.deviceVoice)];
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(VOICE_LINE);
      if (v) u.voice = v;
      u.volume = volume();
      speechSynthesis.speak(u);
    } else if (t.dataset.fx) {
      try { EFFECTS[t.dataset.fx]({ theme: theme() }); } catch (err) { /* an emoji this device cannot draw */ }
    } else if (t.id === 'media-fx-mix') {
      const on = data.celebrations.filter((c) => c.value && EFFECTS[c.key]).map((c) => c.key);
      if (!on.length) { h.toast('No celebration is on, so players see none.'); return; }
      const list = data.random.value ? [on[Math.floor(Math.random() * on.length)]] : on;
      for (const k of list) { try { EFFECTS[k]({ theme: theme() }); } catch (err) { /* skip */ } }
      h.announce(`Playing: ${list.map((k) => data.celebrations.find((c) => c.key === k).label).join(', ')}.`);
    } else if (t.id === 'media-redraw') {
      seed += 1;
      render();
      $('#media-redraw')?.focus();
    }
  };
  // Device voices can arrive after the page loads.
  try { speechSynthesis.addEventListener('voiceschanged', () => { if (tab === 'voices' && data) render(); }); } catch (e) { /* none */ }
  // Leaving the section stops the music.
  addEventListener('hashchange', () => { if (location.hash !== '#media') stopAll(); });
}

export async function mediaView(helpers) {
  if (!h) { h = helpers; wire(); }
  data = await h.api('media');
  render();
}
