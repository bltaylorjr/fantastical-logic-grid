// Translations for players who choose another language than US English.
// Browsers that can translate on the device (Chrome's built-in translator) do
// it themselves; everyone else asks here. Cloudflare Workers AI translates on
// its free daily allowance (no key, never billed on the free plan), and every
// translation is kept in D1, so each text is translated once for all players.
//
//   POST /v1/translate   { to: 'es', texts: ['Hello', ...] }  ->  { texts: ['Hola', ...] }
//
// A text that can't be translated now (switched off, the day's cap used up,
// the service is busy) comes back as null and the game shows it in English.
// Kept texts not used for 180 days are removed by the daily cleanup.
import { json, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';

// The languages the translation model knows (ISO 639-1, or 639-2 where there
// is no short code). The game's language list is the same (web/js/i18n.js).
export const LANGUAGES = ['af', 'am', 'ar', 'ast', 'az', 'ba', 'be', 'bg', 'bn', 'br', 'bs', 'ca', 'ceb', 'cs', 'cy', 'da', 'de', 'el', 'es', 'et',
  'fa', 'ff', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gu', 'ha', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'ilo', 'is', 'it', 'ja', 'jv', 'ka',
  'kk', 'km', 'kn', 'ko', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mg', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'ns', 'oc', 'or', 'pa',
  'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'si', 'sk', 'sl', 'so', 'sq', 'sr', 'ss', 'su', 'sv', 'sw', 'ta', 'th', 'tl', 'tn', 'tr', 'uk', 'ur', 'uz',
  'vi', 'wo', 'xh', 'yi', 'yo', 'zh', 'zu'];
const MAX_TEXTS = 40;
const MAX_LEN = 1000;
const MAX_TOTAL = 12_000;
const AT_ONCE = 4;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Counts n new translations against today's cap; returns how many may go ahead.
async function take(env, n, cap, now) {
  const day = isoDay(now);
  const row = await env.DB.prepare("SELECT count FROM usage WHERE day = ?1 AND name = 'translate'").bind(day).first();
  const k = Math.max(0, Math.min(n, cap - ((row && row.count) || 0)));
  if (k) await env.DB.prepare("INSERT INTO usage (day, name, count) VALUES (?1, 'translate', ?2) ON CONFLICT(day, name) DO UPDATE SET count = count + ?2").bind(day, k).run();
  return k;
}

// The automated tests have no Workers AI: TEST_TRANSLATE=1 marks texts instead.
function model(env) {
  if (env.AI) return env.AI;
  if (env.TEST_TRANSLATE === '1') return { run: async (m, { text, target_lang: to }) => ({ translated_text: `[${to}] ${text}` }) };
  return null;
}

export async function translate(env, to, texts, now = Date.now()) {
  const s = await getSettings(env, now);
  const out = texts.map(() => null);
  if (!s.translate_enabled) return { texts: out, reason: 'switched_off' };
  const hashes = await Promise.all(texts.map((t) => sha256(t)));
  const unique = [...new Set(hashes)];
  const found = new Map();
  if (unique.length) {
    const { results } = await env.DB.prepare(`SELECT hash, text FROM translations WHERE lang = ?1 AND hash IN (${unique.map((_, i) => `?${i + 2}`).join(',')})`)
      .bind(to, ...unique).all();
    for (const r of results) found.set(r.hash, r.text);
  }
  const missing = unique.filter((h) => !found.has(h));
  const ai = model(env);
  let reason = null;
  if (missing.length && !ai) reason = 'not_set_up';
  else if (missing.length) {
    const allowed = await take(env, missing.length, s.daily_translate_cap, now);
    if (allowed < missing.length) reason = 'used_up';
    const jobs = missing.slice(0, allowed).map((h) => ({ h, text: texts[hashes.indexOf(h)] }));
    const made = [];
    for (let i = 0; i < jobs.length; i += AT_ONCE) {
      await Promise.all(jobs.slice(i, i + AT_ONCE).map(async ({ h, text }) => {
        try {
          const r = await ai.run(s.translate_model, { text, source_lang: 'en', target_lang: to });
          const t = r && typeof r.translated_text === 'string' ? r.translated_text.trim() : '';
          if (t && t.length <= MAX_LEN * 4) { found.set(h, t); made.push([h, t]); }
        } catch (e) { reason = 'service'; }
      }));
    }
    if (made.length) {
      const day = isoDay(now);
      await env.DB.batch(made.map(([h, t]) => env.DB.prepare('INSERT OR REPLACE INTO translations (lang, hash, text, day) VALUES (?1, ?2, ?3, ?4)').bind(to, h, t, day)));
    }
  }
  // Texts still in use keep their place: touched at most once a day.
  const used = unique.filter((h) => found.has(h) && !missing.includes(h));
  if (used.length) {
    await env.DB.prepare(`UPDATE translations SET day = ?1 WHERE lang = ?2 AND day < ?1 AND hash IN (${used.map((_, i) => `?${i + 3}`).join(',')})`)
      .bind(isoDay(now), to, ...used).run();
  }
  hashes.forEach((h, i) => { out[i] = found.get(h) ?? null; });
  return reason ? { texts: out, reason } : { texts: out };
}

// Returns a Response for this module's routes, or null for anything else.
export async function handleTranslate(req, env, url) {
  if (url.pathname !== '/v1/translate' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_TRANSLATE && !(await env.LIMIT_TRANSLATE.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
    return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '30' });
  }
  let body;
  try { body = JSON.parse(await readText(req, 64_000)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  const to = String(body?.to || '');
  const texts = Array.isArray(body?.texts) ? body.texts : null;
  if (!LANGUAGES.includes(to) || !texts || !texts.length || texts.length > MAX_TEXTS
    || texts.some((t) => typeof t !== 'string' || !t.trim() || t.length > MAX_LEN)
    || texts.reduce((n, t) => n + t.length, 0) > MAX_TOTAL) return json(req, env, { error: 'bad_request' }, 400);
  return json(req, env, await translate(env, to, texts.map((t) => t.trim())));
}
