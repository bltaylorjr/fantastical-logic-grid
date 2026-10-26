// Learning from every game, and free voices (part of the shared Cloudflare
// Worker; server/src/index.js routes here first through handleLearn).
//
//   POST /v1/learn/plays   anonymous summaries of finished puzzles (players can turn this off)
//   GET  /v1/learn/tuning  what every player's games taught: toughness per level,
//                          clue mix, theme lean, and approved story parts
//   POST /v1/learn/parts   a story part a player chose to share; waits for review
//   POST /v1/tts           Gemini voice clips for players without their own key,
//                          cached, rate limited and capped per day
//
// This data is never joined to player accounts.
// Nothing personal is stored. Rate limits use a one-way hash of the
// connection address that is kept only in memory by Cloudflare's limiter.
import { checkStoryPart, partKey, PART_KINDS } from '../../engine/src/story.js';
import { THEMES } from '../../engine/src/themes.js';
import { getTopics, storyKey } from '../../engine/src/topics.js';
import { TIER_ORDER, CLUE_TYPES } from '../../engine/src/tiers.js';
import { getSettings } from './settings.js';
import { readText } from './http.js';

// The edge-cache key of the tuning reply; the admin dashboard clears it after a review.
export const TUNING_CACHE_KEY = 'https://flg-cloud.internal/v1/learn/tuning';

const THEME_IDS = new Set(THEMES.map((t) => t.id));
// Story parts are kept per story key: a theme id (its classic topic) or "theme/topic".
const STORY_KEYS = new Set(THEMES.flatMap((t) => getTopics(t.id).map((p) => storyKey(t, p))));
const TIERS = new Set(TIER_ORDER);
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const OUTCOMES = new Set(['solved', 'revealed', 'abandoned']);
const FEELS = new Set(['easy', 'right', 'hard']);
const VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Callirrhoe', 'Enceladus', 'Iapetus', 'Umbriel']);
const TUNING_DAYS = 90;

const today = () => new Date().toISOString().slice(0, 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : d);

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The limiter key is a hash of the address, never the address itself.
async function limited(binding, req) {
  if (!binding) return false;
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await binding.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) });
  return !success;
}

async function bodyJson(req, maxBytes) {
  return JSON.parse(await readText(req, maxBytes));
}

// ---------- plays ----------
function cleanPlay(p) {
  if (!p || !TIERS.has(p.tier) || !THEME_IDS.has(p.theme) || !OUTCOMES.has(p.outcome)) return null;
  const clueTypes = {};
  for (const [t, c] of Object.entries(p.clueTypes || {})) if (CLUE_TYPES[t]) clueTypes[t] = num(c, 0, 60);
  const parts = {};
  for (const [k, v] of Object.entries(p.parts || {})) if (/^[toimle]$/.test(k) && /^[\w.]{1,16}$/.test(String(v))) parts[k] = String(v);
  return {
    platform: PLATFORMS.has(p.platform) ? p.platform : 'web',
    tier: p.tier, theme: p.theme,
    size: /^\d+x\d+$/.test(p.size || '') ? p.size : null,
    clueTypes: JSON.stringify(clueTypes), effort: num(p.effort, -1, 1), signal: num(p.signal, -1, 1),
    outcome: p.outcome, rating: Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5 ? p.rating : null,
    feel: FEELS.has(p.feel) ? p.feel : null, parts: JSON.stringify(parts),
    minutes: num(p.minutes, 0, 600, null), hints: Math.round(num(p.hints, 0, 999)), mistakes: Math.round(num(p.mistakes, 0, 999)),
  };
}

async function postPlays(req, env) {
  const body = await bodyJson(req, 64_000);
  // Switched off in the admin dashboard: accept and drop, so apps do not retry.
  if (!(await getSettings(env)).learning_enabled) return json({ saved: 0 });
  const rows = (Array.isArray(body.plays) ? body.plays : []).slice(0, 50).map(cleanPlay).filter(Boolean);
  if (!rows.length) return json({ saved: 0 });
  const day = today();
  const stmt = env.DB.prepare('INSERT INTO plays (day, platform, tier, theme, size, clue_types, effort, signal, outcome, rating, feel, parts, minutes, hints, mistakes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  await env.DB.batch(rows.map((r) => stmt.bind(day, r.platform, r.tier, r.theme, r.size, r.clueTypes, r.effort, r.signal, r.outcome, r.rating, r.feel, r.parts, r.minutes, r.hints, r.mistakes)));
  return json({ saved: rows.length });
}

// ---------- tuning ----------
// The same ideas as the app's on-device learning, over everyone's games, with
// gentler limits so no single group of players can pull puzzles too far.
export function computeTuning(plays, approved) {
  const byTier = {};
  const clueSum = {}, clueN = {};
  const themeSum = {}, themeN = {}, themeCount = {};
  for (const p of plays) {
    (byTier[p.tier] ||= []).push(clamp(p.effort + 0.35 * p.signal, -1, 1));
    themeCount[p.theme] = (themeCount[p.theme] || 0) + 1;
    if (!p.rating) continue;
    const d = (p.rating - 3) / 2;
    themeSum[p.theme] = (themeSum[p.theme] || 0) + d;
    themeN[p.theme] = (themeN[p.theme] || 0) + 1;
    let types = {};
    try { types = JSON.parse(p.clue_types || '{}'); } catch (e) { /* skip */ }
    const total = Object.values(types).reduce((s, x) => s + x, 0) || 1;
    for (const [t, c] of Object.entries(types)) {
      clueSum[t] = (clueSum[t] || 0) + d * (c / total);
      clueN[t] = (clueN[t] || 0) + c / total;
    }
  }
  const effort = {};
  for (const [tier, list] of Object.entries(byTier)) {
    if (list.length < 10) continue;
    effort[tier] = Math.round(clamp(list.reduce((s, x) => s + x, 0) / list.length, -0.6, 0.6) * 100) / 100;
  }
  const clueWeights = {};
  for (const t in clueSum) if (clueN[t] >= 10) clueWeights[t] = Math.round(clamp(1 + 0.5 * (clueSum[t] / clueN[t]), 0.75, 1.4) * 100) / 100;
  const themeWeights = {};
  const avgCount = plays.length / Math.max(1, Object.keys(themeCount).length);
  for (const t in themeCount) {
    if (themeCount[t] < 10) continue;
    const pop = Math.log2(1 + themeCount[t] / avgCount) - 1; // -1..~1
    const liked = themeN[t] >= 5 ? themeSum[t] / themeN[t] : 0;
    themeWeights[t] = Math.round(clamp(1 + 0.15 * pop + 0.4 * liked, 0.75, 1.5) * 100) / 100;
  }
  const parts = {};
  for (const row of approved) {
    let value;
    try { value = JSON.parse(row.value); } catch (e) { continue; }
    ((parts[row.theme] ||= {})[row.kind] ||= []).push(value);
  }
  return { games: plays.length, effort, clueWeights, themeWeights, parts, updated: new Date().toISOString() };
}

async function getTuning(req, env, ctx) {
  const cache = caches.default;
  const key = new Request(TUNING_CACHE_KEY);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  const since = new Date(Date.now() - TUNING_DAYS * 86400000).toISOString().slice(0, 10);
  const plays = (await env.DB.prepare('SELECT tier, theme, clue_types, effort, signal, rating FROM plays WHERE day >= ? ORDER BY rowid DESC LIMIT 50000').bind(since).all()).results;
  const approved = (await env.DB.prepare("SELECT theme, kind, value FROM parts WHERE status = 'approved' ORDER BY reviewed DESC LIMIT 2000").all()).results;
  const res = json(computeTuning(plays, approved), 200, { 'Cache-Control': 'public, max-age=900' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- story parts ----------
async function postPart(req, env) {
  const body = await bodyJson(req, 4_000);
  if (!(await getSettings(env)).story_sharing_enabled) return json({ ok: false, errors: ['Sharing story parts is switched off for now.'] }, 503);
  const { theme, kind, value } = body;
  if (!STORY_KEYS.has(theme) || !PART_KINDS[kind]) return json({ ok: false, errors: ['Unknown theme or part.'] }, 400);
  const check = checkStoryPart(kind, value);
  if (!check.ok) return json(check, 400);
  const key = `${theme}|${kind}|${partKey(kind, value)}`;
  await env.DB.prepare('INSERT OR IGNORE INTO parts (key, theme, kind, value, source, submitted) VALUES (?,?,?,?,?,?)')
    .bind(key, theme, kind, JSON.stringify(value), body.source === 'ai' ? 'ai' : 'mine', today()).run();
  return json({ ok: true, status: 'pending' });
}

// ---------- voices ----------
function pcmToWav(bytes, rate = 24000) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + bytes.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true);
  h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, bytes.length, true);
  const out = new Uint8Array(44 + bytes.length);
  out.set(new Uint8Array(h.buffer), 0);
  out.set(bytes, 44);
  return out;
}

// Counts one more use of `name` today; false once the day's cap is reached.
export async function bump(env, name, cap) {
  const day = today();
  const row = await env.DB.prepare('INSERT INTO usage (day, name, count) VALUES (?, ?, 1) ON CONFLICT(day, name) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count')
    .bind(day, name, cap).first();
  return !!row;
}

// Counts `n` more characters of Google Cloud voices this month; false when
// that would pass the month's cap (kept under Google's free 1M characters).
async function bumpChars(env, n, cap) {
  const month = today().slice(0, 7);
  const row = await env.DB.prepare('INSERT INTO usage (day, name, count) SELECT ?1, ?2, ?3 WHERE ?3 <= ?4 ON CONFLICT(day, name) DO UPDATE SET count = count + ?3 WHERE count + ?3 <= ?4 RETURNING count')
    .bind(month, 'gcloud_tts_chars', n, cap).first();
  return !!row;
}

// Gemini voice: base64 PCM (or WAV) inside a generateContent answer.
async function geminiTts(env, model, voice, text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: 'en-US', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  if (!res.ok) return { status: res.status };
  const j = await res.json();
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) return { status: 502 };
  const bytes = fromBase64(part.inlineData.data);
  const rate = Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000;
  return { wav: /wav/.test(part.inlineData.mimeType || '') ? bytes : pcmToWav(bytes, rate) };
}

// Google Cloud Text-to-Speech, Chirp 3 HD: the same voice names as Gemini,
// so a character sounds the same whichever one speaks. LINEAR16 comes back
// as a whole WAV file.
async function chirpTts(env, voice, text, lang) {
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GOOGLE_TTS_KEY },
    body: JSON.stringify({ input: { text }, voice: { languageCode: lang, name: `${lang}-Chirp3-HD-${voice}` }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 } }),
  });
  if (!res.ok) return { status: res.status };
  const j = await res.json();
  return j.audioContent ? { wav: fromBase64(j.audioContent) } : { status: 502 };
}

function fromBase64(data) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Gemini first (free, no billing). When it is off, used up or refuses, the
// Google Cloud Chirp 3 HD voices take over if GOOGLE_TTS_KEY is set, up to
// the month's character cap. After that the player's device uses Kokoro.
async function postTts(req, env, ctx, headers) {
  const settings = await getSettings(env);
  const gemini = !!env.GEMINI_API_KEY && settings.tts_enabled;
  const chirp = !!env.GOOGLE_TTS_KEY && settings.gcloud_tts_enabled;
  if (!gemini && !chirp) {
    return json({ error: env.GEMINI_API_KEY || env.GOOGLE_TTS_KEY ? 'The free voices are switched off for now.' : 'Voices are not set up on the server.', fallback: 'kokoro' }, 503, headers);
  }
  const body = await bodyJson(req, 2_000);
  const text = String(body.text || '').trim();
  const voice = VOICES.has(body.voice) ? body.voice : 'Charon';
  const lang = /^[a-z]{2,3}-[A-Z]{2}$/.test(body.lang || '') ? body.lang : 'en-US';
  if (!text || text.length > 400) return json({ error: 'Text must be 1 to 400 characters.' }, 400, headers);
  const model = settings.gemini_voice_model;
  const cache = caches.default;
  const keys = {
    gemini: new Request(`https://flg-cloud.internal/tts/${await sha256(`${model}|${voice}|${text}`)}`),
    chirp: new Request(`https://flg-cloud.internal/tts/${await sha256(`chirp3|${lang}|${voice}|${text}`)}`),
  };
  for (const k of [keys.gemini, keys.chirp]) {
    const hit = await cache.match(k);
    if (hit) return new Response(hit.body, { headers: { ...headers, 'Content-Type': 'audio/wav', 'X-Cache': 'hit' } });
  }
  let out = { status: 429 };
  let used = 'gemini';
  // Only new clips count toward the caps.
  if (gemini && settings.daily_tts_cap > 0 && (await bump(env, 'tts', settings.daily_tts_cap))) out = await geminiTts(env, model, voice, text);
  if (!out.wav && chirp && (await bumpChars(env, text.length, settings.gcloud_tts_month_cap))) {
    out = await chirpTts(env, voice, text, lang);
    used = 'chirp';
  }
  if (!out.wav) {
    const status = out.status === 429 ? 429 : 502;
    return json({ error: status === 429 ? 'The free voices are used up for today.' : 'The voice service did not answer.', fallback: 'kokoro' }, status, status === 429 ? { ...headers, 'Retry-After': '3600' } : headers);
  }
  ctx.waitUntil(cache.put(keys[used], new Response(out.wav, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=2592000' } })));
  return new Response(out.wav, { headers: { ...headers, 'Content-Type': 'audio/wav', 'X-Cache': 'miss', 'X-Voice': used } });
}

// ---------- admin ----------
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function admin(req, env, url) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
  const want = String(env.ADMIN_TOKEN || '').trim();
  if (want.length < 16 || !safeEqual(String(token || '').trim(), want)) return json({ error: 'Not allowed.' }, 401);
  if (url.pathname === '/admin/learn/parts' && req.method === 'GET') {
    const status = ['pending', 'approved', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const rows = (await env.DB.prepare('SELECT key, theme, kind, value, source, status, submitted FROM parts WHERE status = ? ORDER BY submitted DESC LIMIT 200').bind(status).all()).results;
    const stats = await env.DB.prepare('SELECT COUNT(*) AS games, COUNT(rating) AS rated FROM plays').first();
    const voices = await env.DB.prepare("SELECT count FROM usage WHERE day = ? AND name = 'tts'").bind(today()).first();
    const chars = await env.DB.prepare("SELECT count FROM usage WHERE day = ? AND name = 'gcloud_tts_chars'").bind(today().slice(0, 7)).first();
    const s = await getSettings(env);
    return json({ parts: rows.map((r) => ({ ...r, value: JSON.parse(r.value) })), stats: { ...stats, voicesToday: voices ? voices.count : 0, voiceCap: s.daily_tts_cap, cloudVoiceCharsThisMonth: chars ? chars.count : 0, cloudVoiceCharCap: s.gcloud_tts_month_cap } });
  }
  if (url.pathname === '/admin/learn/review' && req.method === 'POST') {
    const { key, status } = await bodyJson(req, 2_000);
    if (!['approved', 'rejected', 'pending'].includes(status)) return json({ error: 'Bad status.' }, 400);
    await env.DB.prepare('UPDATE parts SET status = ?, reviewed = ? WHERE key = ?').bind(status, new Date().toISOString(), String(key)).run();
    await caches.default.delete(new Request(TUNING_CACHE_KEY));
    return json({ ok: true });
  }
  return json({ error: 'Not found.' }, 404);
}

const ROUTES = /^\/(v1\/learn\/|v1\/tts$|admin\/learn)/;

// Returns a Response for this module's routes, or null for anything else.
export async function handleLearn(req, env, ctx, url = new URL(req.url)) {
  if (!ROUTES.test(url.pathname)) return null;
  const headers = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    if (url.pathname.startsWith('/admin/learn')) return await admin(req, env, url);
    if (url.pathname === '/v1/tts' && req.method === 'POST') {
      return (await limited(env.LIMIT_TTS, req)) ? json({ error: 'Slow down.', fallback: 'kokoro' }, 429, headers) : await postTts(req, env, ctx, headers);
    }
    let res;
    if (url.pathname === '/v1/learn/tuning' && req.method === 'GET') res = await getTuning(req, env, ctx);
    else if (url.pathname === '/v1/learn/plays' && req.method === 'POST') res = (await limited(env.LIMIT_PLAYS, req)) ? json({ error: 'Slow down.' }, 429) : await postPlays(req, env);
    else if (url.pathname === '/v1/learn/parts' && req.method === 'POST') res = (await limited(env.LIMIT_PARTS, req)) ? json({ error: 'Slow down.' }, 429) : await postPart(req, env);
    else res = json({ error: 'Not found.' }, 404);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    return out;
  } catch (e) {
    return json({ error: 'Bad request.' }, 400, headers);
  }
}
