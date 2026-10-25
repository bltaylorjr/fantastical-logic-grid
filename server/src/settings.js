// Settings the admin dashboard can change without a deploy, and the public
// game config built from them.
//
//   GET /v1/config   announcements, switched-off themes, which shared
//                    features are on, defaults for new players and the AI
//                    models the game asks for, for every copy (no sign-in)
//
// Values live in the D1 table `settings` (JSON). A missing row means the
// default below. Each Worker copy keeps them for CACHE_MS, so a change reaches
// every player within about a minute.
import { THEMES } from '../../engine/src/themes.js';
import { json } from './http.js';

const CACHE_MS = 30_000;
const THEME_IDS = THEMES.map((t) => t.id);

// type: bool, int (with min/max), choice (one of options), model (an AI
// model name), themes (list of theme ids) or words.
export const SETTINGS = {
  tts_enabled: { type: 'bool', default: true, group: 'Voices', label: 'Free server voices', help: 'Off: players use their own key or the offline Kokoro voices.' },
  daily_tts_cap: {
    type: 'int', min: 0, max: 1000, default: (env) => Number(env.DAILY_TTS_CAP) || 300, group: 'Voices', label: 'New voice clips a day',
    help: 'Protects the free Gemini quota. Above Google\'s free daily limit Google refuses requests (it never bills on the free tier). Cached clips do not count.',
  },
  races_enabled: { type: 'bool', default: true, group: 'Play', label: 'Races', help: 'Off: nobody can start, find or join a race. Players already in one can still finish.' },
  scores_enabled: { type: 'bool', default: true, group: 'Play', label: 'Solo scores', help: 'Off: solo solves stop counting for the scoreboard. Race points still count.' },
  names_enabled: { type: 'bool', default: true, group: 'Play', label: 'New and changed screen names', help: 'Off: players keep their names but cannot choose new ones.' },
  disabled_themes: { type: 'themes', default: [], group: 'Play', label: 'Themes switched off', help: 'Hidden from the theme picker and never picked by Surprise me.' },
  learning_enabled: { type: 'bool', default: true, group: 'Learning', label: 'Accept shared play summaries', help: 'Off: anonymous summaries from players are dropped.' },
  story_sharing_enabled: { type: 'bool', default: true, group: 'Learning', label: 'Accept shared story parts', help: 'Off: players cannot send story parts for review.' },
  error_reports_enabled: { type: 'bool', default: true, group: 'Upkeep', label: 'Accept error reports', help: 'Off: error reports from the apps are dropped.' },
  blocked_words: { type: 'words', default: [], group: 'Moderation', label: 'Extra blocked words in screen names', help: 'Added to the built-in word filter. Letters only, 3 to 30 each.' },
  // Starting values in the game's Settings. A player's own choice always wins;
  // these apply to every player who has not changed that setting.
  default_share_learning: { type: 'bool', default: true, group: 'Player defaults', label: 'Learn from everyone', help: 'On: players share anonymous play summaries unless they turn it off. They are told the first time.' },
  default_report_errors: { type: 'bool', default: true, group: 'Player defaults', label: 'Send anonymous error reports', help: 'On: the apps send error reports unless the player turns it off.' },
  default_server_voices: { type: 'bool', default: true, group: 'Player defaults', label: 'Free natural voices from the server', help: 'On: players hear the server voices unless they turn them off.' },
  default_voice_source: {
    type: 'choice', default: 'kokoro', group: 'Player defaults', label: 'Voices on the player\'s device', help: 'Used when server voices are off or run out. Both are free and need no key.',
    options: [{ value: 'kokoro', label: 'Natural voices (Kokoro, one-time 90 MB download)' }, { value: 'device', label: 'The device\'s built-in voices' }],
  },
  // Which AI models the game asks for when a player adds their own key. Change
  // one here when a provider retires a model; no new release is needed.
  image_model: { type: 'model', default: 'gpt-image-2.5-flare', group: 'AI models', label: 'OpenAI picture model', help: 'For painted scenes and portraits.' },
  image_quality: {
    type: 'choice', default: 'medium', group: 'AI models', label: 'OpenAI picture quality', help: 'Higher quality costs the player more per picture.',
    options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
  },
  openai_voice_model: { type: 'model', default: 'gpt-4o-mini-tts', group: 'AI models', label: 'OpenAI voice model', help: 'For voices when a player uses their OpenAI key.' },
  gemini_voice_model: { type: 'model', default: 'gemini-3.8-flash-tts', group: 'AI models', label: 'Gemini voice model', help: 'For voices when a player uses their Google key.' },
  story_model: { type: 'model', default: '', blank: true, group: 'AI models', label: 'Story writer model', help: 'For the Story workshop\'s AI writer. Leave empty to use each provider\'s standard model.' },
};

let cache = { at: 0, values: null };

export function clearSettingsCache() { cache = { at: 0, values: null }; }

const defaultOf = (env, key) => { const d = SETTINGS[key].default; return typeof d === 'function' ? d(env) : d; };

export async function getSettings(env, now = Date.now()) {
  if (!cache.values || now - cache.at > CACHE_MS) {
    const values = {};
    try {
      const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
      for (const r of results) if (SETTINGS[r.key]) { try { values[r.key] = JSON.parse(r.value); } catch (e) { /* default */ } }
    } catch (e) { /* table not made yet: defaults */ }
    cache = { at: now, values };
  }
  return Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, k in cache.values ? cache.values[k] : defaultOf(env, k)]));
}

export const getSetting = async (env, key) => (await getSettings(env))[key];

// Returns { value } with the cleaned value, or { error } for the admin.
export function checkSetting(key, value) {
  const s = SETTINGS[key];
  if (!s) return { error: 'Unknown setting.' };
  if (s.type === 'bool') return typeof value === 'boolean' ? { value } : { error: 'Use on or off.' };
  if (s.type === 'int') {
    return Number.isInteger(value) && value >= s.min && value <= s.max ? { value } : { error: `Use a whole number from ${s.min} to ${s.max}.` };
  }
  if (s.type === 'choice') return s.options.some((o) => o.value === value) ? { value } : { error: 'Pick one of the options.' };
  if (s.type === 'model') {
    const v = typeof value === 'string' ? value.trim() : null;
    if (v === '' && s.blank) return { value: v };
    return v && /^[a-z0-9][a-z0-9.:_-]{1,79}$/i.test(v) ? { value: v } : { error: 'Use a model name such as gpt-4o-mini-tts: letters, numbers, dots and dashes.' };
  }
  if (!Array.isArray(value)) return { error: 'Use a list.' };
  if (s.type === 'themes') {
    const list = [...new Set(value)];
    if (list.some((t) => !THEME_IDS.includes(t))) return { error: 'Unknown theme.' };
    if (list.length >= THEME_IDS.length) return { error: 'Keep at least one theme on.' };
    return { value: list };
  }
  const words = [...new Set(value.map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
  if (words.length > 200 || words.some((w) => !/^[a-z]{3,30}$/.test(w))) return { error: 'Use up to 200 words of 3 to 30 letters.' };
  return { value: words };
}

export async function saveSetting(env, key, value, by) {
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, JSON.stringify(value), Date.now(), by).run();
  clearSettingsCache();
}

export const themeList = () => THEMES.map((t) => ({ id: t.id, name: t.name }));

export async function activeAnnouncements(env, now = Date.now()) {
  try {
    const { results } = await env.DB.prepare(`SELECT id, text, level, starts_at, ends_at FROM announcements
      WHERE starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1) ORDER BY starts_at DESC LIMIT 3`).bind(now).all();
    return results.map((a) => ({ id: a.id, text: a.text, level: a.level, endsAt: a.ends_at }));
  } catch (e) {
    return [];
  }
}

export async function publicConfig(req, env) {
  const s = await getSettings(env);
  return json(req, env, {
    announcements: await activeAnnouncements(env),
    disabledThemes: s.disabled_themes,
    features: {
      races: s.races_enabled, scores: s.scores_enabled, names: s.names_enabled, voices: s.tts_enabled,
      storySharing: s.story_sharing_enabled, learning: s.learning_enabled, errorReports: s.error_reports_enabled,
    },
    defaults: { shareLearning: s.default_share_learning, reportErrors: s.default_report_errors, serverVoices: s.default_server_voices, voiceProvider: s.default_voice_source },
    models: { image: s.image_model, imageQuality: s.image_quality, openaiVoice: s.openai_voice_model, geminiVoice: s.gemini_voice_model, story: s.story_model },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
