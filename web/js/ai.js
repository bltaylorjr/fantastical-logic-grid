// AI-generated pictures and natural voices.
//
// Both come from the game's own server (server/src/pictures.js and learn.js),
// on free allowances, as chosen in the admin dashboard: pictures from
// Cloudflare Workers AI and voices from Google Gemini, with the free Kokoro
// voices on this device and then the device's own voices as fallbacks. No
// keys are kept in the game. Each result is saved on this device by story id,
// so a story's pictures are made once. Offline, the game keeps its built-in
// art.
import * as store from './store.js';
import { CLOUD_URL } from './cloud-config.js';
import { genderOf } from './gender.js';
import { profileOf, MOOD_PACE, MOOD_PITCH, moodPace } from './castbook.js';
import { feature } from './remote-config.js';
import * as i18n from './i18n.js';
import { characterOf, narratorOf } from './cast.js';

const pending = new Map();
const THEME_SETTING = {
  mystery: 'a stormy old English manor house at night, candlelight, a classic detective mystery',
  action: 'a sleek spy thriller city at dusk, neon reflections',
  adventure: 'a jungle expedition camp near ancient ruins, golden hour',
  holiday: 'a cozy snowy village during the winter holidays, warm windows',
  occasion: 'a festive party with balloons, bunting and a cake',
  fantasy: 'a magical castle under a starry sky, glowing runes',
  scifi: 'a space station orbiting a ringed planet',
  sports: 'a floodlit stadium on championship night',
  cooking: 'a bustling restaurant kitchen with copper pots and steam',
  pets: 'a sunny park with a pet show tent',
  town: 'a cheerful small-town main street with shops, a church and a park',
  parks: 'a grand national park with snowy peaks, pine forest and a lake',
  travel: 'a sunny tropical vacation spot with palm trees, a beach and a plane overhead',
  wonders: 'famous world landmarks at golden hour, towers, domes and bridges',
  music: 'an outdoor concert stage at dusk with bright lights, instruments and a cheering crowd',
  nautical: 'sailboats racing on a sparkling bay with a lighthouse, colorful flags and gulls',
  farm: 'a sunny family farm with a red barn, a silo, green fields and animals in the pasture',
  science: 'a bright science lab with bubbling beakers, a microscope and colorful experiments',
  math: 'a chalkboard classroom covered in equations, shapes and number puzzles, warm lamplight',
  biology: 'a lush nature field station by a pond with butterflies, frogs, microscopes and field notebooks',
  chemistry: 'a gleaming chemistry lab with colorful flasks, flame tests and a periodic table on the wall',
  astronomy: 'a dark hilltop at night with telescopes, a glowing Milky Way, planets and a crescent moon',
  paradox: 'a surreal dreamscape of impossible staircases, floating doors and melting clocks under morphing gradient skies',
  seasons: 'a mountain valley shown through the four seasons, autumn leaves, winter snow, spring blossoms and a sunny summer lake',
};

// The server adds the picture style; this says what to paint.
export const picturesReady = (settings) => !!CLOUD_URL && feature('pictures') && settings.aiPictures !== 'none';

// A clip spoken by a stand-in voice (blob.standIn) is not kept, so the
// character's own voice is used once it has downloaded.
async function cached(key, make) {
  const hit = await store.getMedia(key).catch(() => null);
  if (hit) return hit;
  if (pending.has(key)) return pending.get(key);
  const p = make().then(async (blob) => { if (!blob.standIn) await store.putMedia(key, blob).catch(() => {}); pending.delete(key); return blob; }, (e) => { pending.delete(key); throw e; });
  pending.set(key, p);
  return p;
}

// Each kind rests on its own: scenes switched off must not stop the faces.
const picturesOffUntil = {};
async function serverPicture(prompt, kind) {
  if (Date.now() < (picturesOffUntil[kind] || 0)) throw new Error('AI pictures are resting for now.');
  const res = await fetch(`${CLOUD_URL}/v1/picture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, kind }) });
  if (!res.ok) {
    // Used up for today, switched off or not set up: try again in a few hours.
    picturesOffUntil[kind] = Date.now() + (res.status === 429 || res.status === 503 ? 3 * 3600_000 : 600_000);
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (e) { /* keep status */ }
    throw new Error(msg);
  }
  return res.blob();
}

// The topic's own setting and mood when the engine gives one (a Halloween
// party, a locked-room mystery); older saved puzzles use the theme's.
const settingOf = (puzzle) => (puzzle.art && puzzle.art.setting
  ? `${puzzle.art.setting}${puzzle.art.mood ? `, with a ${puzzle.art.mood} mood` : ''}`
  : THEME_SETTING[puzzle.theme.id] || puzzle.theme.name);
const storyKey = (puzzle) => (puzzle.story && puzzle.story.id) || puzzle.id;

export function sceneImage(settings, puzzle) {
  const setting = settingOf(puzzle);
  const prompt = `Wide establishing shot of ${setting}. Scene from this story: ${puzzle.story.paragraphs[0]} ${puzzle.story.paragraphs.slice(1, -1).join(' ')} Show the place and mood only, with small distant figures, no faces in close-up.`;
  return cached(`${storyKey(puzzle)}|scene`, () => serverPicture(prompt, 'scene'));
}

export function portraitImage(settings, puzzle, name) {
  const setting = settingOf(puzzle);
  const role = (puzzle.cast && puzzle.cast.one) || 'character';
  const g = genderOf(name);
  // The face shows their personality: a grumpy chef frowns, a cheerful one beams.
  const who = profileOf(name);
  const prompt = `Head-and-shoulders portrait of a ${who.label.toLowerCase()} ${g === 'f' ? 'woman' : 'man'} who ${who.about}, a ${role} named ${name}, in ${setting}, looking at the viewer, an expression that shows their personality, plain softly lit background, centered, one person only.`;
  return cached(`${puzzle.theme.id}|${(puzzle.topic && puzzle.topic.id) || ''}|${role}|${name}|${g}|${who.personality}|portrait`, () => serverPicture(prompt, 'portrait'));
}

// An AI portrait painted for one of the game's own characters in the admin
// dashboard (cast.js). It comes from the game's server and is kept on this
// device; c.portrait is a path on the server that changes when it is repainted.
export function characterImage(c) {
  if (!CLOUD_URL || !c || !/^\/v1\/characters\/[\w-]+\/portrait\?v=[\w-]+$/.test(c.portrait || '')) return Promise.reject(new Error('No AI portrait.'));
  return cached(`character|${c.portrait}`, async () => {
    const res = await fetch(`${CLOUD_URL}${c.portrait}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.blob();
  });
}

// A lifelike photo of whoever is speaking, for the talking faces
// (talking-face.js). The same character has the same face in every story, so
// it is painted once for everyone (the server keeps it) and once per device.
// Animal casts have no photo.
const AGES = ['in their twenties', 'in their thirties', 'in their forties', 'in their fifties', 'in their sixties', 'in their seventies'];
export const facesReady = () => !!CLOUD_URL && feature('talkingFaces');
export function faceImage(puzzle, who) {
  if (!facesReady()) return Promise.reject(new Error('Talking faces are off.'));
  const own = who === 'narrator' ? narratorOf(puzzle) : characterOf(puzzle, who);
  let prompt;
  if (own) {
    prompt = `A ${own.gender === 'f' ? 'woman' : 'man'} named ${own.name}${own.look ? `, ${own.look}` : ''}${own.role ? `, a ${own.role}` : ''}, with a friendly closed-mouth expression.`;
  } else if (who === 'narrator') {
    prompt = 'A warm, friendly storyteller, a man in his fifties with kind eyes and a neat beard, with a gentle closed-mouth smile.';
  } else {
    if (puzzle.theme.id === 'pets' && /pet|animal|dog|cat/i.test(`${puzzle.cast && puzzle.cast.many}`)) return Promise.reject(new Error('Animals have no photo.'));
    const p = profileOf(who);
    const first = String(who).split(/\s+/)[0];
    const age = AGES[hashOf(`age:${first}`) % AGES.length].replace('their', p.gender === 'f' ? 'her' : 'his');
    prompt = `A ${p.gender === 'f' ? 'woman' : 'man'} ${age} named ${first}, whose personality is ${p.label.toLowerCase()}: someone who ${p.about}. A closed-mouth expression that suits them.`;
  }
  return cached(`face|${hashOf(prompt)}|${prompt.length}`, () => serverPicture(prompt, 'face'));
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------
let current = null;

// Who is speaking, for the talking faces: listener({ who, blob, audio, mood })
// as a natural-voice clip starts, ({ who, device: true, mood }) when a device
// voice starts, ({ who, gesture, mood }) as a line with a gesture begins, and
// ({ who, done: true }) when it ends or is stopped.
let onSpeech = null;
export const listenToSpeech = (fn) => { onSpeech = fn; };
const tell = (e) => { try { if (onSpeech) onSpeech(e); } catch (err) { /* talking faces are optional */ } };

function hashOf(text) { let h = 7; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// Each character has their own voice, chosen to suit their personality and
// matching their portrait: a woman's voice for Clara, a man's for Hugo (see
// castbook.js and gender.js).

// Pick the most natural American English voice the computer has. Windows 11
// and Edge include "Natural" voices such as Aria, Jenny, Guy and Ava.
function deviceVoice(seed, narrator, who = '') {
  const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  if (!i18n.isEnglish()) {
    // The player's language: any voice for it, natural ones first.
    const base = i18n.speechTag().split('-')[0].toLowerCase();
    const mine = voices.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').split('-')[0] === base);
    const nat = mine.filter((v) => /natural|neural|online|premium|enhanced/i.test(v.name));
    const pick = nat.length ? nat : mine;
    return pick.length ? pick[seed % pick.length] : null;
  }
  const us = voices.filter((v) => /^en[-_]US/i.test(v.lang || ''));
  let pool = us.length ? us : voices.filter((v) => /^en/i.test(v.lang || ''));
  const natural = pool.filter((v) => /natural|neural|online|premium|enhanced/i.test(v.name));
  if (natural.length) pool = natural;
  if (narrator) {
    // American male storytellers (Windows Natural voices, then macOS).
    const storyteller = pool.find((v) => /\b(guy|andrew|brian|christopher|eric|davis|roger|steffan|tony|jason|alex|aaron|fred)\b/i.test(v.name));
    if (storyteller) return storyteller;
  }
  const female = /\b(aria|jenny|ava|emma|michelle|ana|samantha|zira|susan|allison|nancy|sara|jane|libby|sonia|victoria|joanna|salli|kendra|kimberly|ivy|amber|ashley|monica|elizabeth|cora|jessa|ellie|serena|ruth|danielle|google us english)\b/i;
  const sub = narrator ? [] : genderOf(who) === 'f' ? pool.filter((v) => female.test(v.name)) : pool.filter((v) => !female.test(v.name));
  if (sub.length) pool = sub;
  return pool.length ? pool[seed % pool.length] : null;
}

// Free natural voices that run on this computer (Kokoro, Apache-2.0). The
// model downloads once from Hugging Face (about 90 MB) and then works offline.
// Each character's Kokoro voice and pace come from castbook.js.
const KOKORO_NARRATOR = 'am_michael'; // American male
let kWorker = null;
let kSeq = 0;
const kCalls = new Map();
let kProgress = null;
function kokoro(msg, transfer) {
  if (!kWorker) {
    kWorker = new Worker(new URL('../kokoro-worker.js', import.meta.url), { type: 'module' });
    kWorker.onmessage = ({ data }) => {
      if (data.type === 'progress') { if (kProgress) kProgress(data); return; }
      const call = kCalls.get(data.id);
      if (!call) return;
      kCalls.delete(data.id);
      if (data.ok) call.resolve(data); else call.reject(new Error(data.error || 'Voice failed'));
    };
    kWorker.onerror = (e) => { for (const c of kCalls.values()) c.reject(new Error(e.message || 'Voice worker failed')); kCalls.clear(); kWorker = null; };
  }
  const id = ++kSeq;
  return new Promise((resolve, reject) => { kCalls.set(id, { resolve, reject }); kWorker.postMessage({ ...msg, id }, transfer || []); });
}
export const kokoroReady = (settings) => !!settings.kokoroReady;
// Download (first time) and load the model, once, however many callers ask.
// onProgress gets 0..1. While it runs, speech waits for it rather than
// falling back to the computer's robotic voices.
let kLoad = null;
let kShare = 0;
const kListeners = new Set();
export const kokoroLoading = () => !!kLoad;
export const kokoroProgress = () => kShare;
export function kokoroDownload(onProgress) {
  if (onProgress) kListeners.add(onProgress);
  if (!kLoad) {
    const files = new Map();
    kProgress = (p) => {
      if (p.file && p.total) files.set(p.file, [p.loaded || 0, p.total]);
      let done = 0, all = 0;
      for (const [l, t] of files.values()) { done += l; all += t; }
      if (all) { kShare = Math.min(1, done / all); for (const f of kListeners) f(kShare); }
    };
    kLoad = kokoro({ type: 'load' }).then(() => true).finally(() => { kProgress = null; kLoad = null; kListeners.clear(); });
  }
  return kLoad;
}
// Voices that don't ship with the game download once; until then (or
// offline) the stand-in voice speaks.
async function kokoroTts(text, voice, speed = 1, standIn = voice) {
  const { wav, voice: used } = await kokoro({ type: 'speak', text, voice, speed, standIn });
  const blob = new Blob([wav], { type: 'audio/wav' });
  if (used && used !== voice) blob.standIn = true;
  return blob;
}

// What gets spoken: plain sentences only. Stage directions, bracketed notes,
// markdown and emoji are removed so no voice reads them out.
export function cleanSpeech(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]|\{[^}]*\}|<[^>]*>/g, ' ')
    .replace(/\((?:clue|note|aside|pause|whisper|sigh|laughs?|beat)[^)]*\)/gi, ' ')
    .replace(/^\s*(?:note|narrator|stage direction)s?\s*:\s*/gim, '')
    .replace(/[*_#`~|>]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}
// Clock times as English words: '9:45 PM' -> 'nine forty-five PM', '10:00 PM'
// -> 'ten PM'. Some voices (Kokoro among them) read '10:00' as 'ten zero zero'.
// Other languages keep the digits, minus a ':00', since the words are English.
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = { 2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty' };
export function clockWords(h, m, ap) {
  h = Number(h); m = Number(m);
  let w = h < 20 ? ONES[h] : `twenty${h > 20 ? `-${ONES[h - 20]}` : ''}`;
  if (m === 0) w += ap ? '' : h > 12 ? ' hundred' : " o'clock";
  else if (m < 10) w += ` oh ${ONES[m]}`;
  else if (m < 20) w += ` ${ONES[m]}`;
  else w += ` ${TENS[Math.floor(m / 10)]}${m % 10 ? `-${ONES[m % 10]}` : ''}`;
  return ap ? `${w} ${ap.toUpperCase()}M` : w;
}
const CLOCK = /\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*([AaPp])(?:\.[Mm](?:\.(?!\s+[A-Z]|\s*$))?|[Mm]\b))?/g;
function sayTimes(t) {
  if (i18n.isEnglish()) return t.replace(CLOCK, (_, h, m, ap) => clockWords(h, m, ap));
  return t.replace(/\b(\d{1,2}):00\s*([AP])\.?M\.?\b/g, '$1 $2M');
}

// Spoken forms for things voices tend to stumble on: times, ranges, symbols,
// abbreviations and all-caps words. Punctuation is kept so voices pause there.
const SPOKEN = [
  [/\b([AP])\.M\.(?=\s+[A-Z]|\s*$)/g, '$1M.'],
  [/\b([AP])\.M\./g, '$1M'],
  [/(\d)\s*[-–]\s*(\d)/g, '$1 to $2'],
  [/\s*[—–]\s*|\s+-\s+/g, ', '],
  [/\.{3}|…/g, '. '],
  [/\s*&\s*/g, ' and '],
  [/(\d)\s*%/g, '$1 percent'],
  [/(\d)\s*[x×]\s*(\d)/g, '$1 by $2'],
  [/#\s?(\d)/g, 'number $1'],
  [/\bMr\.\s/g, 'Mister '],
  [/\bMrs\.\s/g, 'Missus '],
  [/\bMs\.\s/g, 'Miz '],
  [/\bDr\.\s(?=[A-Z])/g, 'Doctor '],
  [/\bSt\.\s(?=[A-Z])/g, 'Saint '],
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\betc\./gi, 'and so on.'],
  [/\bvs\.?\s/gi, 'versus '],
  [/\b(\w+)\/(\w+)\b/g, '$1 or $2'],
  [/\b(?!(?:AM|PM|TV|DJ|OK|UK|USA|UFO|DNA|VIP|CEO|SOS|FBI|CIA)\b)([A-Z])([A-Z]{2,})\b/g, (m, a, b) => a + b.toLowerCase()],
  [/\(([^)]*)\)/g, ', $1,'],
  [/,\s*([.,!?;:])/g, '$1'],
  [/\s{2,}/g, ' '],
];
export function speechText(text) {
  let t = sayTimes(cleanSpeech(text));
  for (const [re, to] of SPOKEN) t = t.replace(re, to);
  return t.trim();
}

// Short first piece so speech starts fast, then larger pieces.
export function speechChunks(text) {
  const sentences = text.split(/(?<=[.!?]["”’)]?)\s+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  let buf = '';
  for (const s of sentences) {
    const limit = out.length ? 260 : 30;
    if (buf && buf.length >= limit) { out.push(buf); buf = s; } else if (buf && buf.length + s.length > 260) { out.push(buf); buf = s; } else buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) out.push(buf);
  return out;
}

export function stopSpeaking() {
  speakToken++;
  tell({ who: null, done: true });
  if (current) { try { current.pause(); } catch (e) { /* ignore */ } current = null; }
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
}
let speakToken = 0;

// The service that will speak, with its voice and a clip maker. Falls back
// from the chosen service to the others that are set up, then the device.
// Free natural voices from the game's own service (server/src/learn.js), for
// players without a Google key. When the day's free clips run out, speech
// moves to the Kokoro voices on this device until tomorrow.
let cloudOffUntil = 0;
const cloudVoicesReady = () => !!CLOUD_URL && feature('voices') && Date.now() > cloudOffUntil;
async function cloudTts(text, voice, mood) {
  const res = await fetch(`${CLOUD_URL}/v1/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, lang: i18n.speechTag(), ...(mood ? { mood } : {}) }) });
  if (!res.ok) {
    // Used up for today (or not set up): rest until the next day, or an hour on other errors.
    cloudOffUntil = Date.now() + (res.status === 429 || res.status === 503 ? 3600 * 1000 * 6 : 3600 * 1000);
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (e) { /* keep status */ }
    const err = new Error(msg);
    err.fallback = 'kokoro';
    throw err;
  }
  return res.blob();
}

// The admin dashboard picks where voices come from (settings.voiceProvider):
// 'server' tries the server's voices (Gemini, then Google Cloud Chirp 3 HD),
// then Kokoro, then the device;
// 'kokoro' starts with Kokoro; 'device' uses only the device's own voices.
function voicePlan(settings, puzzle, who) {
  // The game's own characters (cast.js) keep the voices chosen for them, in
  // every theme, and one of them may tell the story instead of the narrator.
  const own = who === 'narrator' ? narratorOf(puzzle) : characterOf(puzzle, who);
  if (own) return ownVoicePlan(settings, own);
  const seed = hashOf(`${puzzle.theme.id}:${who}`);
  const narr = who === 'narrator';
  const source = settings.voiceProvider || 'server';
  if (source === 'device') return { seed, kind: 'device' };
  // In another language: Gemini's voices speak it; Kokoro's are English only,
  // so the device's own voice for that language reads instead.
  const other = !i18n.isEnglish();
  if (source === 'server' && !settings.noServerVoices && cloudVoicesReady()) {
    const voice = narr ? 'Charon' : profileOf(who).voice.gemini; // Charon: male, steady
    return { seed, kind: 'cloud', gap: 80, voice, key: `g2|${voice}`, make: (t) => cloudTts(t, voice) };
  }
  if (!other && (kokoroReady(settings) || kokoroLoading())) {
    const v = narr ? { kokoro: KOKORO_NARRATOR, pace: 0.94, standIn: KOKORO_NARRATOR } : profileOf(who).voice;
    return { seed, kind: 'kokoro', gap: 220, voice: v.kokoro, pace: v.pace, standIn: v.standIn, key: `k3|${v.kokoro}|${v.pace}`, make: (t) => kokoroTts(t, v.kokoro, v.pace, v.standIn) };
  }
  return { seed, kind: 'device' };
}
function ownVoicePlan(settings, c) {
  const seed = hashOf(`character:${c.id}`);
  const v = c.voice || {};
  const source = settings.voiceProvider || 'server';
  const device = { seed, kind: 'device', speaker: c.name };
  if (source === 'device') return device;
  if (source === 'server' && !settings.noServerVoices && cloudVoicesReady() && GEMINI_F.concat(GEMINI_M, ['Charon']).includes(v.gemini)) {
    return { seed, kind: 'cloud', gap: 80, speaker: c.name, voice: v.gemini, key: `g2|${v.gemini}`, make: (t) => cloudTts(t, v.gemini) };
  }
  if (i18n.isEnglish() && (kokoroReady(settings) || kokoroLoading()) && /^a[fm]_[a-z]+$/.test(v.kokoro || '')) {
    const speed = Math.min(1.2, Math.max(0.8, Number(v.speed) || 1));
    return { seed, kind: 'kokoro', gap: 220, speaker: c.name, voice: v.kokoro, pace: speed, key: `k2|${v.kokoro}|${speed}`, make: (t) => kokoroTts(t, v.kokoro, speed) };
  }
  return device;
}
// Which voice would speak right now: 'cloud', 'kokoro' or 'device'.
export const voiceKind = (settings, puzzle, who = 'narrator') => voicePlan(settings, puzzle, who).kind;
// The mood colors the voice: the server's voices are told how to say it, and
// the device's voices (Kokoro and the device's own) speed up or slow down.
function moodPlan(plan, mood) {
  if (!mood || mood === 'calm') return plan;
  if (plan.kind === 'cloud') return { ...plan, key: `${plan.key}|${mood}`, make: (t) => cloudTts(t, plan.voice, mood) };
  if (plan.kind === 'kokoro' && MOOD_PACE[mood]) {
    const pace = moodPace(plan.pace, mood);
    return { ...plan, key: `${plan.key}|${pace}`, make: (t) => kokoroTts(t, plan.voice, pace, plan.standIn || plan.voice) };
  }
  return plan;
}
const clip = (plan, text) => cached(`voice|${plan.key}|${hashOf(text)}|${text.length}`, () => plan.make(text));

// Start making the first clip early (for example when a puzzle opens), so
// pressing Read aloud plays at once.
export function warmVoice(settings, puzzle, who, text) {
  const plan = voicePlan(settings, puzzle, who);
  if (plan.kind === 'device' || !i18n.isEnglish()) return;
  const first = speechChunks(speechText(text))[0];
  if (first) clip(plan, first).catch(() => {});
}

function playBlob(blob, volume, token, who, mood = '') {
  return new Promise((resolve, reject) => {
    if (token !== speakToken) { resolve(false); return; }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    current = audio;
    tell({ who, blob, audio, mood });
    const done = (ok) => { URL.revokeObjectURL(url); if (current === audio) current = null; tell({ who, done: true }); resolve(ok); };
    audio.onended = () => done(true);
    // Browsers fire 'pause' just before 'ended' when a clip finishes, so only
    // a pause before the end means the player stopped it.
    audio.onpause = () => { if (!audio.ended) done(false); };
    audio.play().catch((e) => { URL.revokeObjectURL(url); tell({ who, done: true }); reject(e); });
  });
}
function speakDevice(text, seed, who, volume, token, face = who, mood = '') {
  if (!window.speechSynthesis || token !== speakToken) return Promise.resolve(false);
  const v = deviceVoice(seed, who === 'narrator', who);
  tell({ who: face, device: true, mood });
  // One utterance per sentence gives a natural pause between sentences.
  const parts = text.split(/(?<=[.!?]["”’)]?)\s+/).filter(Boolean);
  return new Promise((resolve) => {
    // Some browsers never report the end of speech; don't wait forever.
    const timer = setTimeout(() => resolve(token === speakToken), 4000 + text.length * 120);
    const end = () => { clearTimeout(timer); tell({ who: face, done: true }); resolve(token === speakToken); };
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (v) u.voice = v;
      u.lang = (v && v.lang) || i18n.speechTag();
      const own = who === 'narrator' ? null : profileOf(who).voice;
      u.rate = (own ? own.rate : 0.92) * (MOOD_PACE[mood] || 1);
      u.pitch = (own ? own.pitch : 1) * (MOOD_PITCH[mood] || 1);
      u.volume = volume;
      if (i === parts.length - 1) u.onend = u.onerror = end;
      speechSynthesis.speak(u);
    });
    if (!parts.length) end();
  });
}

// who: a character's name, or 'narrator'. Resolves when speech ends.
// mood: how they say it (castbook.js MOODS), for the voice and the face;
// gesture: 'shrug', 'nod' or 'shake' as they start.
export async function speak(settings, puzzle, who, text, { volume = 1, mood = '', gesture = '' } = {}) {
  stopSpeaking();
  await say(settings, puzzle, who, text, volume, speakToken, mood, gesture);
}

// Several speakers in turn, for example every clue told by its witness.
// lines: [{ who, text, mood? }]. onLine(i) is called as each line starts, and with
// -1 at the end. Resolves true when every line was spoken, false if stopped.
export async function speakLines(settings, puzzle, lines, { volume = 1, onLine } = {}) {
  stopSpeaking();
  const token = speakToken;
  for (let i = 0; i < lines.length; i++) {
    if (token !== speakToken) return false;
    if (onLine) onLine(i);
    if (!(await say(settings, puzzle, lines[i].who, lines[i].text, volume, token, lines[i].mood || '', lines[i].gesture || ''))) break;
  }
  const finished = token === speakToken;
  if (onLine) onLine(-1);
  return finished;
}

// Speaks one text with one voice. If a natural voice fails partway, the rest
// is read by the next voice that works, so no words are skipped.
// Resolves true when the whole text was spoken, false if stopped.
async function say(settings, puzzle, who, text, volume, token, mood = '', gesture = '') {
  let clean = speechText(text);
  if (!i18n.isEnglish()) {
    clean = speechText(await i18n.t(clean));
    if (token !== speakToken) return false;
  }
  const plan = moodPlan(voicePlan(settings, puzzle, who), mood);
  const speaker = plan.speaker || who;
  if (gesture) tell({ who, gesture, mood });
  if (plan.kind === 'device') return speakDevice(clean, plan.seed, speaker, volume, token, who, mood);
  if (plan.kind === 'kokoro' && kokoroLoading()) {
    try { await kokoroDownload(); } catch (e) { return speakDevice(clean, plan.seed, speaker, volume, token, who, mood); }
    if (token !== speakToken) return false;
  }
  const parts = speechChunks(clean);
  // Make the next piece while the current one plays.
  const jobs = parts.map(() => null);
  const job = (i) => { if (i < parts.length && !jobs[i]) { jobs[i] = clip(plan, parts[i]); jobs[i].catch(() => {}); } return jobs[i]; };
  const rest = (i) => parts.slice(i).join(' ');
  for (let i = 0; i < parts.length; i++) {
    if (token !== speakToken) return false;
    let blob;
    try {
      blob = await job(i);
      job(i + 1);
    } catch (e) {
      if (token !== speakToken) return false;
      if (plan.kind === 'cloud') return say({ ...settings, noServerVoices: true }, puzzle, who, rest(i), volume, token, mood);
      console.warn('Natural voice unavailable, using device voice:', e.message);
      return speakDevice(rest(i), plan.seed, speaker, volume, token, who, mood);
    }
    try {
      if (!(await playBlob(blob, volume, token, who, mood))) return false;
      // A short breath between sentences, as a reader would take.
      if (plan.gap && i < parts.length - 1) await new Promise((r) => setTimeout(r, plan.gap));
    } catch (e) {
      if (token !== speakToken || (e && e.name === 'NotAllowedError')) return false;
      console.warn('Voice clip did not play, using device voice:', e && e.message);
      return speakDevice(rest(i), plan.seed, speaker, volume, token, who, mood);
    }
  }
  return token === speakToken;
}
