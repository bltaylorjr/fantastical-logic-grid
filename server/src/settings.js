// Settings the admin dashboard can change without a deploy, and the public
// game config built from them.
//
//   GET /v1/config   announcements, switched-off themes and which shared
//                    features are on, for every copy of the game (no sign-in)
//
// Values live in the D1 table `settings` (JSON). A missing row means the
// default below. Each Worker copy keeps them for CACHE_MS, so a change reaches
// every player within about a minute.
import { THEMES } from '../../engine/src/themes.js';
import { json } from './http.js';

const CACHE_MS = 30_000;
const THEME_IDS = THEMES.map((t) => t.id);

// type: bool, int (with min/max), themes (list of theme ids) or words.
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
  archive_email_enabled: {
    type: 'bool', default: false, group: 'Backups', label: 'Weekly archive email',
    help: 'On: every Monday, old rows the game no longer needs are zipped and emailed (see Backups and archive). While on, the daily cleanup leaves those rows for the archive.',
  },
  archive_delete_enabled: {
    type: 'bool', default: false, group: 'Backups', label: 'Remove archived rows after the email is sent',
    help: 'Needs the weekly email on. Rows are removed only after Cloudflare accepts the email. Off: the email is a copy, nothing is removed and the same rows come again next week.',
  },
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
    features: { races: s.races_enabled, scores: s.scores_enabled, names: s.names_enabled, voices: s.tts_enabled, storySharing: s.story_sharing_enabled, learning: s.learning_enabled },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
