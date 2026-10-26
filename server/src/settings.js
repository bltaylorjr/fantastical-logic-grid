// Settings the admin dashboard can change without a deploy, and the public
// game config built from them.
//
//   GET /v1/config   announcements, switched-off themes, which shared
//                    features are on, the sound, voice and picture choices
//                    made for every player, and starting values for the
//                    player's own sound settings, for every copy (no sign-in)
//
// Values live in the D1 table `settings` (JSON). A missing row means the
// default below. Each Worker copy keeps them for CACHE_MS, so a change reaches
// every player within about a minute.
import { THEMES } from '../../engine/src/themes.js';
import { json } from './http.js';

const CACHE_MS = 30_000;
const THEME_IDS = THEMES.map((t) => t.id);
// Solve effects, in the order the game knows them (web/js/effects.js).
const CELEBRATIONS = ['confetti', 'fireworks', 'stars', 'balloons', 'sparkles', 'theme_emoji', 'bubbles', 'falling', 'shooting_stars', 'ribbons', 'light_rays', 'emoji_burst'];

// type: bool, int (with min/max), choice (one of options), model (an AI
// model name), themes (list of theme ids) or words.
export const SETTINGS = {
  // ---- Sounds: the player can still turn their own effects and music off,
  // and the one-tap mute and Silent mode always work.
  sound_effects_enabled: { type: 'bool', default: true, group: 'Sounds', label: 'Sound effects', help: 'Off: no sound effects for anyone, and the player\'s switch is hidden.' },
  default_sound: { type: 'bool', default: true, group: 'Sounds', label: 'Sound effects start on', help: 'For every player who has not turned them off.' },
  default_volume: { type: 'int', min: 0, max: 100, default: 60, group: 'Sounds', label: 'Effects volume to start with (0 to 100)', help: 'Players can change their own volume.' },
  theme_music_enabled: { type: 'bool', default: true, group: 'Sounds', label: 'Theme music', help: 'Off: no theme music for anyone, and the player\'s switch is hidden.' },
  default_music: { type: 'bool', default: true, group: 'Sounds', label: 'Theme music starts on', help: 'For every player who has not turned it off.' },
  default_music_volume: { type: 'int', min: 0, max: 100, default: 40, group: 'Sounds', label: 'Music volume to start with (0 to 100)', help: 'Players can change their own volume.' },
  // ---- Voices
  read_aloud: { type: 'bool', default: true, group: 'Voices', label: 'Characters speak their clues', help: 'When a player selects a portrait. Off: only the Read aloud buttons speak.' },
  voice_source: {
    type: 'choice', default: 'server', group: 'Voices', label: 'Where voices come from', help: 'If the first choice is off or used up for the day, the game moves down the list on its own. All three are free.',
    options: [
      { value: 'server', label: 'Natural voices from the game\'s server (Gemini, then the backup Google Cloud voices if set up, then Kokoro, then the device)' },
      { value: 'kokoro', label: 'Natural voices on the player\'s device (Kokoro, one-time 90 MB download)' },
      { value: 'device', label: 'The device\'s built-in voices (more robotic, no download)' },
    ],
  },
  tts_enabled: { type: 'bool', default: true, group: 'Voices', label: 'Server voices (Google Gemini)', help: 'Uses the GEMINI_API_KEY Cloudflare secret on Google\'s free tier. Off: the backup server voices speak if set up, otherwise players hear the Kokoro voices.' },
  daily_tts_cap: {
    type: 'int', min: 0, max: 1000, default: (env) => Number(env.DAILY_TTS_CAP) || 300, group: 'Voices', label: 'New voice clips a day',
    help: 'Protects the free Gemini quota. Above Google\'s free daily limit Google refuses requests (it never bills on the free tier). Cached clips do not count.',
  },
  gemini_voice_model: { type: 'model', default: (env) => env.TTS_MODEL || 'gemini-3.8-flash-tts', group: 'Voices', label: 'Gemini voice model', help: 'Change it here when Google retires a model.' },
  gcloud_tts_enabled: { type: 'bool', default: true, group: 'Voices', label: 'Backup server voices (Google Cloud Chirp 3 HD)', help: 'Speaks when the Gemini voices are off or used up, with the same voice for each character. Only works once the GOOGLE_TTS_KEY Cloudflare secret is set. Off: players hear Kokoro instead.' },
  gcloud_tts_month_cap: {
    type: 'int', min: 0, max: 1000000, default: (env) => Number(env.GCLOUD_TTS_MONTH_CAP) || 900000, group: 'Voices', label: 'Backup voice characters a month',
    help: 'Google gives 1,000,000 Chirp 3 HD characters free each month and bills past that, so keep this under 1,000,000. The server stops at this number. Cached clips do not count.',
  },
  // ---- Pictures
  portrait_style: {
    type: 'choice', default: 'notionists', group: 'Pictures', label: 'Character portraits', help: 'Built into the game, free, and work offline.',
    options: [
      { value: 'notionists', label: 'Sketchbook (Notionists)' }, { value: 'lorelei', label: 'Storybook (Lorelei)' },
      { value: 'openPeeps', label: 'Hand-drawn (Open Peeps)' }, { value: 'builtin', label: 'Simple (built-in)' },
    ],
  },
  ai_pictures: {
    type: 'choice', default: 'scene', group: 'Pictures', label: 'AI pictures', help: 'Painted by Cloudflare Workers AI on its free daily allowance (no key, never billed on the free plan). Without them, or when the day\'s pictures run out, the built-in art shows.',
    options: [
      { value: 'none', label: 'None, use the built-in art' }, { value: 'scene', label: 'A painted scene for each story' },
      { value: 'all', label: 'Scene and character portraits (uses the allowance faster)' },
    ],
  },
  daily_picture_cap: { type: 'int', min: 0, max: 1000, default: 100, group: 'Pictures', label: 'New AI pictures a day', help: 'Keeps inside Workers AI\'s free daily allowance (about 150 pictures). Pictures already made are kept on each device.' },
  picture_model: { type: 'model', default: '@cf/black-forest-labs/flux-1-schnell', group: 'Pictures', label: 'Workers AI picture model', help: 'Change it here when Cloudflare retires a model.' },
  // ---- Celebrations: shown when a puzzle is solved (not after Reveal). Never
  // shown in Silent mode or when the device asks for reduced motion.
  confetti: { type: 'bool', default: true, group: 'Celebrations', label: 'Confetti', help: 'Paper pieces burst up from the middle of the screen.' },
  fireworks: { type: 'bool', default: false, group: 'Celebrations', label: 'Fireworks', help: 'Soft bursts of color across the screen. No flashing.' },
  stars: { type: 'bool', default: false, group: 'Celebrations', label: 'Stars', help: 'Gold stars shoot out from both sides.' },
  balloons: { type: 'bool', default: false, group: 'Celebrations', label: 'Balloons', help: 'Balloons float up from the bottom of the screen.' },
  sparkles: { type: 'bool', default: false, group: 'Celebrations', label: 'Sparkles', help: 'Small twinkling sparkles drift down.' },
  theme_emoji: { type: 'bool', default: false, group: 'Celebrations', label: 'Theme pictures', help: 'Little pictures that match the puzzle\'s theme, such as magnifying glasses for Mystery or paw prints for Pets.' },
  bubbles: { type: 'bool', default: false, group: 'Celebrations', label: 'Bubbles', help: 'Soft bubbles float up from the bottom of the screen.' },
  falling: { type: 'bool', default: false, group: 'Celebrations', label: 'Falling snow, leaves or petals', help: 'Matches the theme, such as snow for Holidays or leaves for National Parks. Other themes follow the season.' },
  shooting_stars: { type: 'bool', default: false, group: 'Celebrations', label: 'Shooting stars', help: 'A few stars glide across the top of the screen with a trail.' },
  ribbons: { type: 'bool', default: false, group: 'Celebrations', label: 'Ribbons', help: 'Curly streamers shoot up from the bottom corners.' },
  light_rays: { type: 'bool', default: false, group: 'Celebrations', label: 'Light rays', help: 'A soft golden glow with slowly turning rays that fades in and out. Never bright and never flashing.' },
  emoji_burst: { type: 'bool', default: false, group: 'Celebrations', label: 'Party emoji', help: 'Party pictures, such as party poppers, trophies and stars, burst from the sides.' },
  celebrate_random: { type: 'bool', default: false, group: 'Celebrations', label: 'Random', help: 'On: each solve shows one of the checked effects, picked at random. Off: every checked effect plays together.' },
  // ---- Languages
  translate_enabled: { type: 'bool', default: true, group: 'Languages', label: 'Translations for other languages', help: 'Players can choose any of 100 languages (US English is the default). Browsers that can translate on the device do it themselves; for everyone else Cloudflare Workers AI translates on its free daily allowance and each text is kept, so it is translated once for everyone. Off: only players whose browser translates on the device get other languages.' },
  daily_translate_cap: { type: 'int', min: 0, max: 20000, default: 3000, group: 'Languages', label: 'New translations a day', help: 'Texts sent to Workers AI each day (a menu label or a story sentence is one). Shares the free daily allowance with AI pictures. Texts already translated do not count.' },
  translate_model: { type: 'model', default: '@cf/meta/m2m100-1.2b', group: 'Languages', label: 'Workers AI translation model', help: 'Change it here when Cloudflare retires a model.' },
  // ---- Play
  races_enabled: { type: 'bool', default: true, group: 'Play', label: 'Races', help: 'Off: nobody can start, find or join a race. Players already in one can still finish.' },
  scores_enabled: { type: 'bool', default: true, group: 'Play', label: 'Solo scores', help: 'Off: solo solves stop counting for the scoreboard. Race points still count.' },
  names_enabled: { type: 'bool', default: true, group: 'Play', label: 'New and changed screen names', help: 'Off: players keep their names but cannot choose new ones.' },
  names_need_approval: { type: 'bool', default: true, group: 'Play', label: 'New screen names wait for approval', help: 'On: other players see a name a player typed only after an admin approves it in Players or Screen names; until then it shows as "New player". Names from Suggest a name are approved automatically. The player always sees their own name. Off: names show straight away.' },
  disabled_themes: { type: 'themes', default: [], group: 'Play', label: 'Themes switched off', help: 'Hidden from the theme picker and never picked by Surprise me.' },
  // ---- Learning and stories
  learning_enabled: { type: 'bool', default: true, group: 'Learning', label: 'Learn from everyone', help: 'On: anonymous play summaries from players who keep "Learn from how I play" on tune puzzles, clue mix and story parts for all. Off: nothing is sent and summaries are dropped.' },
  story_sharing_enabled: { type: 'bool', default: true, group: 'Learning', label: 'Accept story parts from older apps', help: 'Older app versions can still send story parts for review. New ones are written in the Story workshop here.' },
  story_model: { type: 'model', default: 'gemini-flash-latest', group: 'Learning', label: 'Story workshop AI writer (Gemini model)', help: 'Drafts story parts in the Story workshop with the GEMINI_API_KEY secret, on Google\'s free tier.' },
  // ---- Ideas, problems and upkeep
  feedback_enabled: { type: 'bool', default: true, group: 'Ideas and problems', label: 'Idea and problem boxes', help: 'Off: the game hides its Ideas and problems boxes.' },
  feedback_replies_enabled: { type: 'bool', default: true, group: 'Ideas and problems', label: 'Thank-you emails', help: 'Signed-in players with a confirmed email can ask for a short no-reply note: a thank-you for an idea, or an apology and thank-you for a problem report. Sent every 15 minutes from noreply@thelogicgrid.com through Resend, or from the game\'s Gmail as a backup (server/FEEDBACK-EMAILS.md). Off: no new notes, and waiting ones are dropped.' },
  feedback_reply_daily_cap: { type: 'int', min: 0, max: 400, default: 100, group: 'Ideas and problems', label: 'Thank-you emails a day', help: 'For everyone together. Resend\'s free plan sends 100 a day, then Gmail (about 500 a day, shared with the archive and summary emails) takes over. Each player gets at most one note a day for ideas and one for problems.' },
  error_reports_enabled: { type: 'bool', default: true, group: 'Ideas and problems', label: 'Automatic error reports', help: 'Anonymous reports the apps send when something breaks. Off: nothing is sent.' },
  // ---- Alerts and reports
  alert_percent: { type: 'int', min: 50, max: 100, default: 80, group: 'Alerts and reports', label: 'Warn when a free allowance reaches (percent)', help: 'The dashboard shows a warning, and the health check opens a GitHub issue (which GitHub emails you), when a daily free allowance or the database passes this level.' },
  summary_email_enabled: { type: 'bool', default: true, group: 'Alerts and reports', label: 'Weekly summary email', help: 'Every Monday: new players, games, top themes, new ideas and problems, errors, puzzles that need attention and free-limit warnings. Sent from the game\'s Gmail with the same setup as the archive email (server/ARCHIVE.md).' },
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
  if (s.type === 'choice') return s.options.some((o) => o.value === value) ? { value } : { error: 'Pick one of the options.' };
  if (s.type === 'model') {
    const v = typeof value === 'string' ? value.trim() : null;
    return v && /^@?[a-z0-9][a-z0-9.:_/-]{1,99}$/i.test(v) ? { value: v } : { error: 'Use a model name such as gemini-flash-latest: letters, numbers, dots, dashes and slashes.' };
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
      races: s.races_enabled, scores: s.scores_enabled, names: s.names_enabled, nameApproval: s.names_need_approval, voices: s.tts_enabled,
      storySharing: s.story_sharing_enabled, learning: s.learning_enabled, errorReports: s.error_reports_enabled,
      feedback: s.feedback_enabled, feedbackReplies: s.feedback_replies_enabled, soundEffects: s.sound_effects_enabled, music: s.theme_music_enabled, pictures: s.ai_pictures !== 'none',
      translate: s.translate_enabled,
    },
    // Chosen here for every player.
    game: { voiceSource: s.voice_source, readAloud: s.read_aloud, portraitStyle: s.portrait_style, confetti: s.confetti, aiPictures: s.ai_pictures,
      celebrations: CELEBRATIONS.filter((k) => s[k]), celebrateRandom: s.celebrate_random },
    // Starting values; a player's own choice wins.
    defaults: { sound: s.default_sound, volume: s.default_volume, music: s.default_music, musicVolume: s.default_music_volume },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
