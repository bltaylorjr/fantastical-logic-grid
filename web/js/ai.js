// AI-generated pictures and natural voices.
//
// Pictures and voice clips come from the OpenAI API using the player's own API
// key (Settings > AI pictures and voice). Each result is saved on this device
// by story id, so a story's pictures are made once. Without a key, or offline,
// the game keeps its built-in art and uses the computer's own voices.
import * as store from './store.js';
import { CLOUD_URL } from './cloud-config.js';
import { genderOf } from './gender.js';
import { feature, models } from './remote-config.js';

const API = 'https://api.openai.com/v1';
const pending = new Map();

const STYLE = 'Warm storybook illustration, painterly, soft cinematic light, rich color, no text, no letters, no words, no logos, family friendly.';
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
};

export const aiReady = (settings) => !!(settings.aiKey && settings.aiKey.trim().length > 20);

async function cached(key, make) {
  const hit = await store.getMedia(key).catch(() => null);
  if (hit) return hit;
  if (pending.has(key)) return pending.get(key);
  const p = make().then(async (blob) => { await store.putMedia(key, blob).catch(() => {}); pending.delete(key); return blob; }, (e) => { pending.delete(key); throw e; });
  pending.set(key, p);
  return p;
}

async function apiError(res) {
  let msg = `${res.status}`;
  try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* keep status */ }
  if (res.status === 401) msg = 'The API key was not accepted. Check it in Settings.';
  if (res.status === 429) msg = 'The AI service says the limit or credit has run out for now.';
  return new Error(msg);
}

async function generateImage(settings, prompt, size) {
  const res = await fetch(`${API}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.aiKey.trim()}` },
    body: JSON.stringify({ model: models().image, prompt, size, quality: models().imageQuality, n: 1 }),
  });
  if (!res.ok) throw await apiError(res);
  const json = await res.json();
  const item = json.data && json.data[0];
  if (item && item.b64_json) {
    const bin = atob(item.b64_json);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }
  if (item && item.url) return (await fetch(item.url)).blob();
  throw new Error('The AI service returned no picture.');
}

// The topic's own setting and mood when the engine gives one (a Halloween
// party, a locked-room mystery); older saved puzzles use the theme's.
const settingOf = (puzzle) => (puzzle.art && puzzle.art.setting
  ? `${puzzle.art.setting}${puzzle.art.mood ? `, with a ${puzzle.art.mood} mood` : ''}`
  : THEME_SETTING[puzzle.theme.id] || puzzle.theme.name);
const storyKey = (puzzle) => (puzzle.story && puzzle.story.id) || puzzle.id;

export function sceneImage(settings, puzzle) {
  const setting = settingOf(puzzle);
  const prompt = `${STYLE} Wide establishing shot of ${setting}. Scene from this story: ${puzzle.story.paragraphs[0]} ${puzzle.story.paragraphs.slice(1, -1).join(' ')} Show the place and mood only, with small distant figures, no faces in close-up.`;
  return cached(`${storyKey(puzzle)}|scene`, () => generateImage(settings, prompt, '1536x1024'));
}

export function portraitImage(settings, puzzle, name) {
  const setting = settingOf(puzzle);
  const role = (puzzle.cast && puzzle.cast.one) || 'character';
  const g = genderOf(name);
  const prompt = `${STYLE} Head-and-shoulders portrait of a friendly ${g === 'f' ? 'woman' : 'man'}, a ${role} named ${name}, in ${setting}, looking at the viewer, plain softly lit background, centered, one person only.`;
  return cached(`${puzzle.theme.id}|${(puzzle.topic && puzzle.topic.id) || ''}|${role}|${name}|${g}|portrait`, () => generateImage(settings, prompt, '1024x1024'));
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------
let current = null;

function hashOf(text) { let h = 7; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// Characters get a voice that matches their portrait: a woman's voice for
// Clara, a man's for Hugo (see gender.js).
function voiceFor(who, seed, female, male) {
  const pool = genderOf(who) === 'f' ? female : male;
  return pool[seed % pool.length];
}

async function ttsBlob(settings, text, voice, style) {
  const res = await fetch(`${API}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.aiKey.trim()}` },
    body: JSON.stringify({ model: models().openaiVoice, voice, input: text, instructions: style, response_format: 'mp3' }),
  });
  if (!res.ok) throw await apiError(res);
  return res.blob();
}

// Google Gemini text-to-speech (free tier available). Returns raw 16-bit PCM,
// which is wrapped in a WAV header so the browser can play it.
const GEMINI_F = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Callirrhoe'];
const GEMINI_M = ['Puck', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel'];
const AI_F = ['nova', 'shimmer', 'sage', 'coral']; // alloy sounds neither, so it is left out
const AI_M = ['ballad', 'echo', 'onyx', 'verse'];
export const geminiReady = (settings) => !!(settings.geminiKey && settings.geminiKey.trim().length > 20);

function pcmToWav(bytes, rate = 24000) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, bytes.length, true);
  return new Blob([header, bytes], { type: 'audio/wav' });
}

// Only the words to say are sent; spoken style comes from the voice choice, so
// no direction text can be read out.
async function geminiTts(settings, text, voice) {
  const model = models().geminiVoice;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey.trim() },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: 'en-US', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* keep status */ }
    if (res.status === 400 && /key/i.test(msg)) msg = 'The Google key was not accepted. Check it in Settings.';
    if (res.status === 429) msg = 'The free daily voice limit is used up for now.';
    throw new Error(msg);
  }
  const json = await res.json();
  const part = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts.find((p) => p.inlineData);
  if (!part) throw new Error('Google returned no audio.');
  const bin = atob(part.inlineData.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const rate = Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000;
  return /wav|mpeg|mp3|ogg/.test(part.inlineData.mimeType || '') ? new Blob([bytes], { type: part.inlineData.mimeType }) : pcmToWav(bytes, rate);
}

export async function testGeminiKey(settings) {
  await geminiTts(settings, 'Hello.', 'Kore');
  return true;
}

// Pick the most natural American English voice the computer has. Windows 11
// and Edge include "Natural" voices such as Aria, Jenny, Guy and Ava.
function deviceVoice(seed, narrator, who = '') {
  const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
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
const KOKORO_NARRATOR = 'am_michael'; // American male
// American English voices only, best rated first. Men's voices are fewer, so
// each also has a slightly different pace to tell speakers apart.
const KOKORO_F = ['af_heart', 'af_bella', 'af_nicole', 'af_aoede'];
const KOKORO_M = ['am_fenrir', 'am_puck', 'am_michael:1.06', 'am_fenrir:0.95', 'am_puck:1.05'];
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
async function kokoroTts(text, voice, speed = 1) {
  const { wav } = await kokoro({ type: 'speak', text, voice, speed });
  return new Blob([wav], { type: 'audio/wav' });
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
// Spoken forms for things voices tend to stumble on: times, ranges, symbols,
// abbreviations and all-caps words. Punctuation is kept so voices pause there.
const SPOKEN = [
  [/\b(\d{1,2}):00\s*([AP])\.?M\.?\b/g, '$1 $2M'],
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
  let t = cleanSpeech(text);
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
const cloudVoicesReady = (settings) => !!CLOUD_URL && feature('voices') && settings.serverVoices !== false && Date.now() > cloudOffUntil;
async function cloudTts(text, voice) {
  const res = await fetch(`${CLOUD_URL}/v1/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) });
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

function voicePlan(settings, puzzle, who) {
  const seed = hashOf(`${puzzle.theme.id}:${who}`);
  const narr = who === 'narrator';
  // The player's own Google key comes first; otherwise the game's free
  // server voices, unless the player chose a specific other service.
  if (!geminiReady(settings) && ['kokoro', 'gemini'].includes(settings.voiceProvider || 'kokoro') && cloudVoicesReady(settings)) {
    const voice = narr ? 'Charon' : voiceFor(who, seed, GEMINI_F, GEMINI_M);
    return { seed, kind: 'cloud', gap: 80, key: `g2|${voice}`, make: (t) => cloudTts(t, voice) };
  }
  const ready = {
    kokoro: kokoroReady(settings) || kokoroLoading(),
    gemini: geminiReady(settings),
    openai: aiReady(settings) && settings.aiVoice,
  };
  const order = [settings.voiceProvider || 'gemini', 'kokoro', 'gemini', 'openai'];
  if (settings.voiceProvider === 'device') return { seed, kind: 'device' };
  const kind = order.find((k) => ready[k]);
  if (kind === 'kokoro') {
    const [voice, pace] = (narr ? KOKORO_NARRATOR : voiceFor(who, seed, KOKORO_F, KOKORO_M)).split(':');
    const speed = narr ? 0.94 : Number(pace || 1);
    return { seed, kind, gap: 220, key: `k2|${voice}|${speed}`, make: (t) => kokoroTts(t, voice, speed) };
  }
  if (kind === 'gemini') {
    const voice = narr ? 'Charon' : voiceFor(who, seed, GEMINI_F, GEMINI_M); // Charon: male, steady
    return { seed, kind, gap: 80, key: `g2|${voice}`, make: (t) => geminiTts(settings, t, voice) };
  }
  if (kind === 'openai') {
    const style = narr
      ? `Warm male storyteller reading a ${puzzle.theme.name.toLowerCase()} story aloud, unhurried, gentle suspense.`
      : `A character in a ${puzzle.theme.name.toLowerCase()} story telling a detective what they saw. Natural, conversational, a little ${['nervous', 'cheerful', 'serious', 'proud', 'secretive'][seed % 5]}.`;
    const accent = ' Speak in a natural General American accent. Enunciate clearly, keep a relaxed, even pace, and pause briefly at commas and full stops. Say names and times naturally.';
    const voice = narr ? 'ash' : voiceFor(who, seed, AI_F, AI_M); // ash: American male
    return { seed, kind, gap: 80, key: `o2|${voice}|${hashOf(style)}`, make: (t) => ttsBlob(settings, t, voice, style + accent) };
  }
  return { seed, kind: 'device' };
}
const clip = (plan, text) => cached(`voice|${plan.key}|${hashOf(text)}|${text.length}`, () => plan.make(text));

// Start making the first clip early (for example when a puzzle opens), so
// pressing Read aloud plays at once.
export function warmVoice(settings, puzzle, who, text) {
  const plan = voicePlan(settings, puzzle, who);
  if (plan.kind === 'device') return;
  const first = speechChunks(speechText(text))[0];
  if (first) clip(plan, first).catch(() => {});
}

function playBlob(blob, volume, token) {
  return new Promise((resolve, reject) => {
    if (token !== speakToken) { resolve(false); return; }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    current = audio;
    const done = (ok) => { URL.revokeObjectURL(url); if (current === audio) current = null; resolve(ok); };
    audio.onended = () => done(true);
    // Browsers fire 'pause' just before 'ended' when a clip finishes, so only
    // a pause before the end means the player stopped it.
    audio.onpause = () => { if (!audio.ended) done(false); };
    audio.play().catch((e) => { URL.revokeObjectURL(url); reject(e); });
  });
}
function speakDevice(text, seed, who, volume, token) {
  if (!window.speechSynthesis || token !== speakToken) return Promise.resolve(false);
  const v = deviceVoice(seed, who === 'narrator', who);
  // One utterance per sentence gives a natural pause between sentences.
  const parts = text.split(/(?<=[.!?]["”’)]?)\s+/).filter(Boolean);
  return new Promise((resolve) => {
    // Some browsers never report the end of speech; don't wait forever.
    const timer = setTimeout(() => resolve(token === speakToken), 4000 + text.length * 120);
    const end = () => { clearTimeout(timer); resolve(token === speakToken); };
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (v) u.voice = v;
      u.lang = (v && v.lang) || 'en-US';
      u.rate = who === 'narrator' ? 0.92 : 0.97;
      u.pitch = who === 'narrator' ? 1 : 0.94 + (seed % 5) * 0.03;
      u.volume = volume;
      if (i === parts.length - 1) u.onend = u.onerror = end;
      speechSynthesis.speak(u);
    });
    if (!parts.length) end();
  });
}

// who: a character's name, or 'narrator'. Resolves when speech ends.
export async function speak(settings, puzzle, who, text, { volume = 1 } = {}) {
  stopSpeaking();
  await say(settings, puzzle, who, text, volume, speakToken);
}

// Several speakers in turn, for example every clue told by its witness.
// lines: [{ who, text }]. onLine(i) is called as each line starts, and with
// -1 at the end. Resolves true when every line was spoken, false if stopped.
export async function speakLines(settings, puzzle, lines, { volume = 1, onLine } = {}) {
  stopSpeaking();
  const token = speakToken;
  for (let i = 0; i < lines.length; i++) {
    if (token !== speakToken) return false;
    if (onLine) onLine(i);
    if (!(await say(settings, puzzle, lines[i].who, lines[i].text, volume, token))) break;
  }
  const finished = token === speakToken;
  if (onLine) onLine(-1);
  return finished;
}

// Speaks one text with one voice. If a natural voice fails partway, the rest
// is read by the next voice that works, so no words are skipped.
// Resolves true when the whole text was spoken, false if stopped.
async function say(settings, puzzle, who, text, volume, token) {
  const clean = speechText(text);
  const plan = voicePlan(settings, puzzle, who);
  if (plan.kind === 'device') return speakDevice(clean, plan.seed, who, volume, token);
  if (plan.kind === 'kokoro' && kokoroLoading()) {
    try { await kokoroDownload(); } catch (e) { return speakDevice(clean, plan.seed, who, volume, token); }
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
      if (plan.kind === 'cloud') return say({ ...settings, serverVoices: false }, puzzle, who, rest(i), volume, token);
      console.warn('Natural voice unavailable, using device voice:', e.message);
      return speakDevice(rest(i), plan.seed, who, volume, token);
    }
    try {
      if (!(await playBlob(blob, volume, token))) return false;
      // A short breath between sentences, as a reader would take.
      if (plan.gap && i < parts.length - 1) await new Promise((r) => setTimeout(r, plan.gap));
    } catch (e) {
      if (token !== speakToken || (e && e.name === 'NotAllowedError')) return false;
      console.warn('Voice clip did not play, using device voice:', e && e.message);
      return speakDevice(rest(i), plan.seed, who, volume, token);
    }
  }
  return token === speakToken;
}

// Quick check from Settings: one tiny request that lists models.
export async function testKey(settings) {
  const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${settings.aiKey.trim()}` } });
  if (!res.ok) throw await apiError(res);
  return true;
}

// ---------- AI story writer ----------
// Drafts new story parts from the player's idea. Only the idea, the theme and
// a few example parts are sent. The game checks every draft with the engine's
// story-part rules, and the player approves each one before it is used.
const PART_HELP = {
  openings: 'an opening sentence that sets the scene. It must use {n} (or {N} at the start of the sentence) for how many people there are, and {many} for what they are called (the cast word).',
  incidents: 'an event: what happened. Give "name" (1 to 3 words, used in the title "The <adjective> <name>"), "text" (one or two sentences) and "prize" (the thing at stake, like "the golden key").',
  mishaps: 'one or two sentences saying why the facts got mixed up, so only the clues can be trusted.',
  endings: 'an ending shown when the puzzle is solved. It must include {Fact} (the answer, already a full clause like "Mia has the red hat") and may use {winner} (that person) and {prize}.',
};

function storyPrompt(theme, kind, idea, examples) {
  return [
    `You write short story parts for "The Fantastical Logic Grid", a family-friendly logic puzzle game. Theme: ${theme.name} (${theme.description}). The cast are called "${theme.cast.many}".`,
    `Write 4 different options for ${PART_HELP[kind]}`,
    'Rules: friendly for all ages; no numbers or head counts in words or digits (the game fills in {n}); no names of people; use only the fill-ins named above, in curly brackets; 6 to 28 words each; end with a full stop or exclamation mark.',
    `Examples from the game: ${JSON.stringify(examples)}`,
    `The player's idea: "${String(idea).slice(0, 200)}"`,
    kind === 'incidents' ? 'Reply with JSON only: {"parts":[{"name":"...","text":"...","prize":"..."}]}' : 'Reply with JSON only: {"parts":["...","..."]}',
  ].join('\n');
}

async function openaiModel(settings) {
  const { story } = models();
  if (story && !/gemini/.test(story)) return story;
  try {
    const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${settings.aiKey.trim()}` } });
    if (res.ok) {
      const ids = (await res.json()).data.map((m) => m.id).filter((id) => /^gpt-[\d.]+o?-mini$/.test(id)).sort((a, b) => parseFloat(b.slice(4)) - parseFloat(a.slice(4)));
      if (ids.length) return ids[0];
    }
  } catch (e) { /* use the default */ }
  return 'gpt-4o-mini';
}

export const storyWriterReady = (settings) => geminiReady(settings) || aiReady(settings);

export async function draftStoryParts(settings, theme, kind, idea, examples) {
  const prompt = storyPrompt(theme, kind, idea, examples);
  let text;
  if (geminiReady(settings)) {
    const model = /gemini/.test(models().story) ? models().story : 'gemini-flash-latest';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey.trim() },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 1 } }),
    });
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  } else if (aiReady(settings)) {
    const res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.aiKey.trim()}` },
      body: JSON.stringify({ model: await openaiModel(settings), messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
    });
    if (!res.ok) throw await apiError(res);
    text = (await res.json()).choices?.[0]?.message?.content || '';
  } else throw new Error('Add a Google Gemini or OpenAI key in Settings first.');
  let parts;
  try { parts = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()).parts; } catch (e) { throw new Error('The AI reply could not be read. Try again.'); }
  if (!Array.isArray(parts)) throw new Error('The AI reply had no story parts. Try again.');
  return parts.slice(0, 6);
}
