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
import { publicNews } from './messages.js';

const CACHE_MS = 30_000;
const THEME_IDS = THEMES.map((t) => t.id);
// Solve effects, in the order the game knows them (web/js/effects.js).
const CELEBRATIONS = ['confetti', 'fireworks', 'stars', 'balloons', 'sparkles', 'theme_emoji', 'bubbles', 'falling', 'shooting_stars', 'ribbons', 'light_rays', 'emoji_burst'];

// type: bool, int (with min/max), choice (one of options), model (an AI
// model name), url (an https link, or empty), themes (list of theme ids),
// words or days (YYYY-MM-DD dates).
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
  // ---- Characters (characters.js and the Characters section)
  characters_enabled: { type: 'bool', default: true, group: 'Characters', label: 'The game\'s own characters', help: 'Published characters from the Characters section join new puzzles as cast or narrator. Off: puzzles use only the built-in cast, and suggestions close.' },
  character_cast_chance: { type: 'int', min: 0, max: 100, default: 60, group: 'Characters', label: 'How often a new puzzle includes a character (percent)', help: 'When a character fits the theme. Players who type their own names always get those instead.' },
  character_narrator_chance: { type: 'int', min: 0, max: 100, default: 50, group: 'Characters', label: 'How often a character tells the story (percent)', help: 'Only for characters set as narrator, in their themes.' },
  character_model: { type: 'model', default: '@cf/meta/llama-3.1-8b-instruct-fast', group: 'Characters', label: 'Workers AI model that drafts character lines', help: 'Free on Workers AI\'s daily allowance, shared with AI pictures and translations. Change it here when Cloudflare retires a model.' },
  character_draft_cap: { type: 'int', min: 0, max: 200, default: 40, group: 'Characters', label: 'AI line drafts a day', help: 'Each press of Draft lines counts one. AI portraits count toward New AI pictures a day.' },
  character_suggest_enabled: { type: 'bool', default: true, group: 'Characters', label: 'Players can suggest characters', help: 'Menu > Suggest a character in the game asks a few questions. Suggestions wait in the Characters section and nobody sees them until you publish.' },
  character_suggest_cap: { type: 'int', min: 0, max: 500, default: 50, group: 'Characters', label: 'Character suggestions a day', help: 'For everyone together; each connection can also send only a few a minute.' },
  // ---- Play
  races_enabled: { type: 'bool', default: true, group: 'Play', label: 'Races', help: 'Off: nobody can start, find or join a race. Players already in one can still finish.' },
  scores_enabled: { type: 'bool', default: true, group: 'Play', label: 'Solo scores', help: 'Off: solo solves stop counting for the scoreboard. Race points still count.' },
  names_enabled: { type: 'bool', default: true, group: 'Play', label: 'New and changed screen names', help: 'Off: players keep their names but cannot choose new ones.' },
  names_need_approval: { type: 'bool', default: true, group: 'Play', label: 'New screen names wait for approval', help: 'On: other players see a name a player typed only after an admin approves it in Players or Screen names; until then it shows as "New player". Names from Suggest a name are approved automatically. The player always sees their own name. Off: names show straight away.' },
  challenges_enabled: { type: 'bool', default: true, group: 'Play', label: 'Challenge a friend links', help: 'After solving, players can share a link that opens the same puzzle for anyone, with their time to beat. No account needed. Off: no new links; links already shared still open.' },
  challenges_daily_cap: { type: 'int', min: 0, max: 5000, default: 500, group: 'Play', label: 'New challenge links a day', help: 'Keeps the database inside Cloudflare\'s free limits. Each link is kept for 60 days.' },
  daily_results_enabled: { type: 'bool', default: true, group: 'Play', label: 'Daily puzzle numbers for everyone', help: 'Shows how many played today\'s puzzle, how many solved it and the typical time, on the home screen and after solving. Only counts are kept. Off: the numbers are hidden.' },
  hand_picked_days: { type: 'days', default: [], group: 'Play', label: 'Hand-picked daily puzzles', help: 'Past daily puzzles to put first in the Hand-picked collection on the website and in the game, one date per line (like 2026-11-03), up to 30. The rest of the collection is the best-rated daily puzzles. Shows after the next website build (every night).' },
  daily_email_enabled: { type: 'bool', default: true, group: 'Play', label: 'Daily puzzle by email', help: 'Signed-in players with a confirmed email can get each day\'s puzzle by email, sent at about 7 am Eastern from noreply@thelogicgrid.com through Resend, or from the game\'s Gmail as a backup (server/DAILY-EMAIL.md). Every email has a one-click unsubscribe link. Off: no emails and no new sign-ups; the list is kept.' },
  daily_email_daily_cap: { type: 'int', min: 0, max: 450, default: 300, group: 'Play', label: 'Daily emails a day', help: 'The most people on the daily email list. New sign-ups stop at this number, so everyone on the list gets the email. Resend\'s free plan sends 100 a day, then Gmail (about 500 a day, shared with the other emails) takes over.' },
  disabled_themes: { type: 'themes', default: [], group: 'Play', label: 'Themes switched off', help: 'Hidden from the theme picker and never picked by Surprise me.' },
  // ---- Learning and stories
  learning_enabled: { type: 'bool', default: true, group: 'Learning', label: 'Learn from everyone', help: 'On: anonymous play summaries from players who keep "Learn from how I play" on tune puzzles, clue mix and story parts for all. Off: nothing is sent and summaries are dropped.' },
  story_sharing_enabled: { type: 'bool', default: true, group: 'Learning', label: 'Accept story parts from older apps', help: 'Older app versions can still send story parts for review. New ones are written in the Story workshop here.' },
  story_model: { type: 'model', default: 'gemini-flash-latest', group: 'Learning', label: 'Story workshop AI writer (Gemini model)', help: 'Drafts story parts in the Story workshop with the GEMINI_API_KEY secret, on Google\'s free tier.' },
  // ---- Ideas, problems and upkeep
  feedback_enabled: { type: 'bool', default: true, group: 'Ideas and problems', label: 'Idea and problem boxes', help: 'Off: the game hides its Ideas and problems boxes.' },
  feedback_replies_enabled: { type: 'bool', default: true, group: 'Ideas and problems', label: 'Thank-you emails', help: 'Signed-in players with a confirmed email can tick "Email me an update": a short no-reply note quoting what they wrote (a thank-you for an idea, or an apology and thank-you for a problem report), and a second one with your "What was done" note when you mark it addressed. Sent every 15 minutes from noreply@thelogicgrid.com through Resend, or from the game\'s Gmail as a backup (server/FEEDBACK-EMAILS.md). Off: no new notes, and waiting ones are dropped.' },
  feedback_reply_daily_cap: { type: 'int', min: 0, max: 400, default: 100, group: 'Ideas and problems', label: 'Thank-you emails a day', help: 'For everyone together. Resend\'s free plan sends 100 a day, then Gmail (about 500 a day, shared with the archive and summary emails) takes over. Each player gets at most one note a day for ideas and one for problems.' },
  // ---- Educators: free printable puzzle packages (educators.js)
  educators_enabled: { type: 'bool', default: true, group: 'Educators', label: 'Educator puzzle packages', help: 'The Educators page on thelogicgrid.com takes requests for free printable puzzle packages. The educator confirms their school email with a code, you approve or decline under Educator requests, and the PDFs are made and emailed to that address within about 10 minutes (server/EDUCATORS.md). Off: the page says requests are paused; approved packages still go out.' },
  educator_daily_cap: { type: 'int', min: 0, max: 200, default: 30, group: 'Educators', label: 'New educator requests a day', help: 'For everyone together. Each request sends a code email and, once approved, a package email (Resend 100 a day, then Gmail about 500 a day, shared with the other emails).' },
  educator_max_puzzles: { type: 'int', min: 1, max: 30, default: 30, group: 'Educators', label: 'Most puzzles in one package', help: 'The form offers 1 up to this number. Big packages of hard puzzles take a few minutes to make.' },
  educator_personal_email: { type: 'bool', default: false, group: 'Educators', label: 'Accept personal email addresses', help: 'Off: only school and organization addresses (Gmail, Outlook, Yahoo and similar are refused), so the code proves the person can read a school mailbox. On: homeschool educators and tutors can use a personal address; those requests are marked "Personal email" for you to check before approving.' },
  // ---- Messages
  messages_enabled: { type: 'bool', default: true, group: 'Messages', label: 'Messages between players and the team', help: 'Signed-in players can write to the team from Menu > Messages, ask for a reply on an idea or problem, and read the team\'s answers and news there. Answer them in Communication. Off: the game hides Messages and nothing new can be sent.' },
  message_emails_enabled: { type: 'bool', default: true, group: 'Messages', label: 'Email players when the team writes', help: 'Only players who turned it on in Messages, at most one a day each. The email says there is a new message in the game, never what it says. Counts toward Thank-you emails a day and needs Thank-you emails on.' },
  error_reports_enabled: { type: 'bool', default: true, group: 'Ideas and problems', label: 'Automatic error reports', help: 'Anonymous reports the apps send when something breaks. Off: nothing is sent.' },
  // ---- Alerts and reports
  alert_percent: { type: 'int', min: 50, max: 100, default: 80, group: 'Alerts and reports', label: 'Warn when a free allowance reaches (percent)', help: 'The dashboard shows a warning, and the health check opens a GitHub issue (which GitHub emails you), when a daily free allowance or the database passes this level.' },
  summary_email_enabled: { type: 'bool', default: true, group: 'Alerts and reports', label: 'Weekly summary email', help: 'Every Monday: new players, games, top themes, new ideas and problems, errors, puzzles that need attention and free-limit warnings. Sent from the game\'s Gmail with the same setup as the archive email (server/ARCHIVE.md).' },
  ratings_ai_enabled: { type: 'bool', default: true, group: 'Alerts and reports', label: 'AI summary of puzzle ratings', help: 'Ratings and insights: a few plain sentences on what is working and what to improve, written by a free Cloudflare Workers AI text model from the rating numbers only (never player text). Off: only the rule-based findings show.' },
  ratings_ai_daily_cap: { type: 'int', min: 0, max: 20, default: 3, group: 'Alerts and reports', label: 'AI rating summaries a day', help: 'Each one is kept for the day and shared by the dashboard, the nightly report and the emails. Shares Workers AI\'s free daily allowance with pictures and translations; a summary uses very little.' },
  ratings_model: { type: 'model', default: '@cf/meta/llama-3.1-8b-instruct-fast', group: 'Alerts and reports', label: 'Workers AI model for rating summaries', help: 'Change it here when Cloudflare retires a model.' },
  // ---- Support and premium: the game is free. These only add an optional
  // link out to a page the owner sets up elsewhere; nothing here takes
  // payments or locks any part of the game.
  support_link_enabled: { type: 'bool', default: false, group: 'Support and premium', label: 'Support the game link', help: 'On: the game\'s Menu shows "Support the game", which opens the page below in a new window. Needs a link below. Nothing in the game is locked either way.' },
  support_url: { type: 'url', default: '', group: 'Support and premium', label: 'Support page link', help: 'An https link to your tip, sponsor or membership page, such as a GitHub Sponsors, Ko-fi or Paddle page. Leave empty for none.' },
  support_asks_enabled: { type: 'bool', default: false, group: 'Support and premium', label: 'Support asks in the game', help: 'On (with the Support the game link on): a short thank-you after a player\'s 3rd, 10th and 25th solved puzzle, a note at a 7- and 30-day daily streak, a Supporters window, one line on printed puzzles and one line in the daily puzzle email. At most one ask a week per player, never during a puzzle or a race, never after a revealed solution, and "Don\'t ask again" stops them for good. Off: none of these show.' },
  supporter_badges_enabled: { type: 'bool', default: false, group: 'Support and premium', label: 'Show supporter badges', help: 'On: Bronze, Silver, Gold and Platinum supporter badges show next to names on the scoreboard. Off: no badges anywhere, even for people already added under Supporters. Leave off until you launch.' },
  premium_extras_enabled: { type: 'bool', default: false, group: 'Support and premium', label: 'Supporter extras', help: 'On: the themes ticked below open only for premium supporters, and the Get extras link shows. Off: every theme is open to everyone and nothing about extras shows in the game, so you can set them up before you launch.' },
  premium_themes: { type: 'themes', default: [], group: 'Support and premium', label: 'Supporter extra themes', help: 'Themes only premium supporters can pick (bonus themes or early access). Everyone else sees them marked "Supporter extra". None ticked: nothing is locked. The daily puzzle, races and shared puzzles stay open to everyone.' },
  tier_silver_from: { type: 'int', min: 1, max: 10000, default: 5, group: 'Support and premium', label: 'Silver supporter badge from (amount)', help: 'Badge tiers for payments that come in through a payment service: Bronze below this amount, Silver from it. In the payment\'s currency, whole units (5 means $5). A membership tier whose name says Bronze, Silver, Gold or Platinum gets that badge whatever the amount. People you add by hand get the tier you choose.' },
  tier_gold_from: { type: 'int', min: 1, max: 10000, default: 15, group: 'Support and premium', label: 'Gold supporter badge from (amount)', help: 'Gold from this amount. Keep it above the Silver amount.' },
  tier_platinum_from: { type: 'int', min: 1, max: 10000, default: 50, group: 'Support and premium', label: 'Platinum supporter badge from (amount)', help: 'Platinum from this amount. Keep it above the Gold amount.' },
  extras_url: { type: 'url', default: '', group: 'Support and premium', label: 'Get extras page link', help: 'Where a player goes to get the supporter extras: your membership or checkout page. Shown next to locked themes. Leave empty to hide the button.' },
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
  if (s.type === 'url') return checkUrl(value);
  if (!Array.isArray(value)) return { error: 'Use a list.' };
  if (s.type === 'themes') {
    const list = [...new Set(value)];
    if (list.some((t) => !THEME_IDS.includes(t))) return { error: 'Unknown theme.' };
    if (list.length >= THEME_IDS.length) return { error: 'Keep at least one theme on.' };
    return { value: list };
  }
  if (s.type === 'days') {
    const days = [...new Set(value.map((d) => String(d).trim()).filter(Boolean))];
    if (days.length > 30 || days.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) return { error: 'Use up to 30 dates like 2026-11-03, one per line.' };
    return { value: days.sort() };
  }
  const words = [...new Set(value.map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
  if (words.length > 200 || words.some((w) => !/^[a-z]{3,30}$/.test(w))) return { error: 'Use up to 200 words of 3 to 30 letters.' };
  return { value: words };
}

function checkUrl(value) {
  const v = typeof value === 'string' ? value.trim() : null;
  if (v === '') return { value: '' };
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' && !u.username && !u.password && v.length <= 300) return { value: u.href };
  } catch (e) { /* not a link */ }
  return { error: 'Use a full https:// link of up to 300 characters, or leave it empty.' };
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
      translate: s.translate_enabled, messages: s.messages_enabled, challenges: s.challenges_enabled, dailyResults: s.daily_results_enabled, dailyEmail: s.daily_email_enabled,
    },
    news: s.messages_enabled ? await publicNews(env) : [],
    // Chosen here for every player.
    game: { voiceSource: s.voice_source, readAloud: s.read_aloud, portraitStyle: s.portrait_style, confetti: s.confetti, aiPictures: s.ai_pictures,
      celebrations: CELEBRATIONS.filter((k) => s[k]), celebrateRandom: s.celebrate_random,
      supportUrl: s.support_link_enabled && s.support_url ? s.support_url : '',
      supportAsks: !!(s.support_asks_enabled && s.support_link_enabled && s.support_url),
      premiumThemes: s.premium_extras_enabled ? s.premium_themes : [], extrasUrl: s.premium_extras_enabled ? s.extras_url : '' },
    // Starting values; a player's own choice wins.
    defaults: { sound: s.default_sound, volume: s.default_volume, music: s.default_music, musicVolume: s.default_music_volume },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
