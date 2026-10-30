// The game's own characters: made in the admin dashboard's Character creator,
// or suggested by players with the game's "Suggest a character" questions and
// then reviewed there. A published character joins new puzzles as one of the
// cast or tells the story as its narrator, with its own portrait, voice and
// lines, in every theme or only the themes chosen for it.
//
//   GET  /v1/characters                   published characters for the game (no sign-in)
//   GET  /v1/characters/:id/portrait?v=   a published character's AI portrait (JPEG)
//   POST /v1/characters/suggest           a player's suggestion, waiting for review
//
// Admin routes (characterRoutes, wired into admin.js):
//   GET  /admin/v1/characters             every character, the choices and today's free use
//   GET  /admin/v1/characters/:id         one character, with its AI portrait
//   POST /admin/v1/characters/save        create or change one (it goes back to draft)
//   POST /admin/v1/characters/:id/portrait  paint its AI portrait (Workers AI, free)
//   POST /admin/v1/characters/:id/lines   draft its lines with a free Workers AI text model
//   POST /admin/v1/characters/:id/(publish|unpublish|delete)
//
// Characters never change the logic. A name is only a grid label, and before
// publishing the name and every line are checked against the game's story
// rules: no story part of an allowed theme may name the character, the name
// may not be or contain a grid item, and a line may not name any grid item or
// cast name (that would read like a clue). Names, lines, looks and
// personalities pass the word filter with the admin's blocked words too.
import { alert } from './alerts.js';
import { THEMES } from '../../engine/src/themes.js';
import { getTopics, buildScenario } from '../../engine/src/topics.js';
import { KNOWN_NAMES, genderOf } from '../../web/js/gender.js';
import { json, corsHeaders, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { hasBlockedWords } from './names.js';
import { bump } from './learn.js';

export const CHARACTER_LIMIT = 40;
const SUGGESTED_LIMIT = 200;
const THEME_IDS = THEMES.map((t) => t.id);
const STYLES = ['notionists', 'lorelei', 'openPeeps', 'ai'];
const ROLES = ['cast', 'narrator', 'both'];
// The same voice names the game and the server's /v1/tts use (Gemini, and the
// Chirp 3 HD backup), and the Kokoro voices that ship with the game.
export const VOICES = {
  gemini: { f: ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Callirrhoe'], m: ['Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel'] },
  kokoro: { f: ['af_heart', 'af_bella', 'af_nicole', 'af_aoede'], m: ['am_michael', 'am_fenrir', 'am_puck'] },
};
export const LINE_KINDS = {
  clue: { name: 'Before telling a clue', max: 6, example: 'Mark my words, friend:' },
  hint: { name: 'When the player asks for a hint', max: 6, example: 'Let me nudge you along.' },
  solve: { name: 'When the puzzle is solved', max: 6, example: 'Splendid work, I knew you had it in you!' },
};
// What a player can ask the voice to sound like; the creator picks voices to match.
export const VOICE_STYLES = {
  warm: { name: 'Warm and friendly', gemini: { f: 'Kore', m: 'Puck' }, kokoro: { f: 'af_heart', m: 'am_michael' }, speed: 1 },
  calm: { name: 'Calm and gentle', gemini: { f: 'Leda', m: 'Iapetus' }, kokoro: { f: 'af_nicole', m: 'am_michael' }, speed: 0.92 },
  lively: { name: 'Bright and lively', gemini: { f: 'Zephyr', m: 'Fenrir' }, kokoro: { f: 'af_bella', m: 'am_puck' }, speed: 1.08 },
  deep: { name: 'Deep and steady', gemini: { f: 'Callirrhoe', m: 'Charon' }, kokoro: { f: 'af_aoede', m: 'am_fenrir' }, speed: 0.95 },
  mysterious: { name: 'Mysterious', gemini: { f: 'Aoede', m: 'Umbriel' }, kokoro: { f: 'af_aoede', m: 'am_fenrir' }, speed: 0.9 },
};
const PUBLIC_CACHE_MS = 60_000;
const PORTRAIT_STYLE = 'Warm storybook illustration, painterly, soft cinematic light, rich color, no text, no letters, no words, no logos, family friendly.';

// ------------------------------------------------------------- checks
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, word) => new RegExp(`(^|[^\\w'-])${esc(word)}(?=$|'s\\b|[^\\w'-])`, 'i').test(text);
const clean = (v, max) => (typeof v === 'string' ? v.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>{}[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

// The words a theme's stories and grids use, for every topic: grid items, cast
// names and the text of every built-in story part.
const THEME_WORDS = new Map(THEMES.map((theme) => {
  const items = new Set();
  const names = new Set();
  const texts = [];
  for (const topic of getTopics(theme.id)) {
    const sc = buildScenario(theme, topic);
    for (const c of sc.categories) if (!c.ordinal) for (const x of c.items) items.add(x);
    for (const n of sc.names) names.add(n);
    const S = sc.story;
    texts.push(...S.adjs, ...S.openings, ...S.mishaps, ...S.endings, ...S.incidents.flatMap((i) => [i.name, i.text, i.prize]),
      ...Object.values(S.leads).flat());
  }
  return [theme.id, { items: [...items], names: [...names], text: texts.join(' \n ').replace(/\{\w+\}/g, ' ') }];
}));
const ALL_NAMES = [...new Set([...THEME_WORDS.values()].flatMap((w) => w.names))];

const themesOf = (c) => (c.themes && c.themes.length ? c.themes : THEME_IDS);

// Story parts added in the Story workshop or approved from players, for these themes.
async function addedPartsText(env, themes) {
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM parts WHERE status = 'approved'").all();
    return results.filter((r) => themes.includes(String(r.key).split(/[|/]/)[0])).map((r) => {
      try { const v = JSON.parse(r.value); return typeof v === 'string' ? v : Object.values(v).join(' '); } catch (e) { return ''; }
    }).join(' \n ').replace(/\{\w+\}/g, ' ');
  } catch (e) { return ''; }
}

// Problems that stop a character being published (or a player's suggestion
// being kept), as sentences for the admin. others: the other characters.
export async function storyRuleProblems(env, c, others = [], { extra = [] } = {}) {
  const out = [];
  const themes = themesOf(c);
  const added = await addedPartsText(env, themes);
  for (const t of themes) {
    const w = THEME_WORDS.get(t);
    const tname = THEMES.find((x) => x.id === t).name;
    const item = w.items.find((x) => x.toLowerCase() === c.name.toLowerCase() || has(x, c.name) || has(c.name, x));
    if (item) out.push(`In ${tname}, "${c.name}" is too close to the grid item "${item}", so clues would be confusing.`);
    if (has(w.text, c.name)) out.push(`A ${tname} story part already uses the word "${c.name}", so the story would name them. Pick another name or leave ${tname} out.`);
    for (const kind of Object.keys(LINE_KINDS)) {
      for (const line of c.lines[kind] || []) {
        const word = [...w.items, ...w.names].find((x) => x.length > 1 && has(line, x));
        if (word) out.push(`The line "${line}" names "${word}", which can be in a ${tname} grid, so it would read like a clue.`);
      }
    }
  }
  if (added && has(added, c.name)) out.push(`A story part added in the Story workshop uses the word "${c.name}".`);
  if (KNOWN_NAMES.has(c.name) && genderOf(c.name) !== c.gender) out.push(`"${c.name}" is already one of the game's ${genderOf(c.name) === 'f' ? 'women' : 'men'}, so a ${c.gender === 'f' ? 'woman' : 'man'} with that name would get the wrong voice or face somewhere. Pick another name.`);
  for (const o of others) {
    if (o.id === c.id) continue;
    if (o.name.toLowerCase() === c.name.toLowerCase()) out.push(`Another character is already called "${o.name}".`);
    for (const kind of Object.keys(LINE_KINDS)) for (const line of c.lines[kind] || []) if (has(line, o.name)) out.push(`The line "${line}" names the character ${o.name}.`);
  }
  for (const kind of Object.keys(LINE_KINDS)) for (const line of c.lines[kind] || []) {
    const n = ALL_NAMES.find((x) => has(line, x));
    if (n && !out.some((p) => p.includes(`"${line}"`))) out.push(`The line "${line}" names "${n}", one of the game's cast.`);
  }
  if ([c.name, c.personality, c.look, ...Object.values(c.lines).flat()].some((t) => t && hasBlockedWords(t, { strict: false, extra }))) out.push('Some words are not allowed in the game.');
  if (hasBlockedWords(c.name, { extra })) out.push('That name is not allowed in the game.');
  return [...new Set(out)];
}

// Cleans what the creator (or a player's questions) sent. Returns { value } or { error }.
export function checkCharacter(b, { player = false } = {}) {
  const name = clean(b.name, 20).replace(/(^|[ '-])(\p{Ll})/gu, (m, a, l) => a + l.toUpperCase());
  if (!/^\p{Lu}\p{Ll}+(?:[ '-]\p{Lu}?\p{Ll}+)?$/u.test(name) || name.length < 2 || name.length > 16) {
    return { error: 'Use a name of 2 to 16 letters, one or two words, such as "Mo" or "Captain Mo".' };
  }
  if (!['f', 'm'].includes(b.gender)) return { error: 'Choose a woman or a man, so the face and voice match.' };
  const personality = clean(b.personality, 240);
  if (personality.length < 3) return { error: 'Describe their personality in a few words.' };
  const look = clean(b.look, 200);
  const themes = Array.isArray(b.themes) ? [...new Set(b.themes.filter((t) => THEME_IDS.includes(t)))] : [];
  if (themes.length >= THEME_IDS.length) themes.length = 0;
  const role = ROLES.includes(b.role) ? b.role : 'cast';
  const style = STYLES.includes(b.style) ? b.style : 'notionists';
  const g = b.gender;
  const vs = VOICE_STYLES[b.voiceStyle] ? b.voiceStyle : '';
  const pick = vs ? VOICE_STYLES[vs] : VOICE_STYLES.warm;
  const v = b.voice && typeof b.voice === 'object' ? b.voice : {};
  const voice = {
    gemini: VOICES.gemini[g].includes(v.gemini) ? v.gemini : pick.gemini[g],
    kokoro: VOICES.kokoro[g].includes(v.kokoro) ? v.kokoro : pick.kokoro[g],
    speed: Number.isFinite(Number(v.speed)) && v.speed !== '' && v.speed != null ? Math.min(1.2, Math.max(0.8, Math.round(Number(v.speed) * 100) / 100)) : pick.speed,
  };
  const lines = {};
  for (const [kind, k] of Object.entries(LINE_KINDS)) {
    const list = Array.isArray(b.lines && b.lines[kind]) ? b.lines[kind] : [];
    lines[kind] = [...new Set(list.map((l) => clean(l, 120)).filter(Boolean))].slice(0, k.max);
    const bad = lines[kind].find((l) => l.length < 3 || /\d/.test(l));
    if (bad) return { error: `Lines need 3 to 120 characters and no numbers: "${bad}".` };
  }
  const seed = clean(b.seed, 40) || `${name}:${Math.random().toString(36).slice(2, 8)}`;
  return { value: { name, gender: g, personality, look, themes, role: player ? 'cast' : role, style: player ? 'notionists' : style, seed, voice, lines, voiceStyle: vs } };
}

const rowToCharacter = (r, { portrait = false } = {}) => ({
  id: r.id, name: r.name, gender: r.gender, personality: r.personality, look: r.look, role: r.role,
  themes: JSON.parse(r.themes), style: r.style, seed: r.seed, voice: JSON.parse(r.voice), lines: JSON.parse(r.lines),
  status: r.status, source: r.source, voiceStyle: r.voice_style, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by,
  hasPortrait: !!r.portrait_at, portraitAt: r.portrait_at || null,
  ...(portrait && r.portrait ? { portrait: `data:image/jpeg;base64,${toBase64(new Uint8Array(r.portrait))}` } : {}),
});

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const COLUMNS = 'id, name, gender, personality, look, role, themes, style, seed, voice, lines, portrait_at, status, source, voice_style, version, updated_at, updated_by';
async function listAll(env) {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM characters ORDER BY status = 'suggested', name`).all();
  return results.map((r) => rowToCharacter(r));
}
async function getOne(env, id, opts) {
  const r = await env.DB.prepare(`SELECT ${COLUMNS}${opts && opts.portrait ? ', portrait' : ''} FROM characters WHERE id = ?1`).bind(String(id)).first();
  return r ? rowToCharacter(r, opts) : null;
}

let publicCache = { at: 0, body: null };
export const clearCharacterCache = () => { publicCache = { at: 0, body: null }; };

// What the game needs: no personality text, looks or who changed it.
export async function publicCharacters(env, now = Date.now()) {
  const s = await getSettings(env);
  const body = (characters) => ({
    enabled: s.characters_enabled, suggestions: s.characters_enabled && s.character_suggest_enabled,
    castChance: s.character_cast_chance, narratorChance: s.character_narrator_chance, characters,
  });
  if (!s.characters_enabled) return body([]);
  if (!publicCache.body || now - publicCache.at >= PUBLIC_CACHE_MS) {
    let list = [];
    try {
      const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM characters WHERE status = 'published' ORDER BY name`).all();
      list = results.map((r) => rowToCharacter(r)).map((c) => ({
        id: c.id, name: c.name, gender: c.gender, role: c.role, themes: c.themes, style: c.style, seed: c.seed, voice: c.voice, lines: c.lines, version: c.version,
        ...(c.style === 'ai' && c.hasPortrait ? { portrait: `/v1/characters/${c.id}/portrait?v=${c.version}-${c.portraitAt}` } : {}),
      }));
    } catch (e) { list = []; }
    publicCache = { at: now, body: list };
  }
  return body(publicCache.body);
}

// ------------------------------------------------------------- AI helpers
// The test suite has no Workers AI: TEST_CHARACTERS=1 gives a stand-in.
function ai(env) {
  if (env.AI) return env.AI;
  if (env.TEST_CHARACTERS === '1') {
    return {
      run: async (model, input) => (input.prompt
        ? { image: btoa('\xff\xd8\xff\xe0test-portrait\xff\xd9') }
        : { response: JSON.stringify({ clue: ['Mark my words:', 'I saw this with my own eyes:'], hint: ['Let me nudge you along.'], solve: ['Splendid work, my friend!'] }) }),
    };
  }
  return null;
}

function portraitPrompt(c) {
  const who = c.gender === 'f' ? 'woman' : 'man';
  return `Head-and-shoulders portrait of a friendly ${who} named ${c.name}, ${c.personality}.${c.look ? ` ${c.look}.` : ''} Looking at the viewer, plain softly lit background, centered, one person only.`;
}

async function paintPortrait(env, c) {
  const s = await getSettings(env);
  const model = ai(env);
  if (!model) return { error: 'AI portraits need the Workers AI binding (wrangler.toml [ai]).' };
  if (s.daily_picture_cap <= 0 || !(await bump(env, 'pictures', s.daily_picture_cap))) return { error: 'Today\'s free AI pictures are used up. Try again tomorrow, or choose one of the drawn styles.' };
  let out;
  try { out = await model.run(s.picture_model, { prompt: `${PORTRAIT_STYLE} ${portraitPrompt(c)}`.slice(0, 2048), steps: 4 }); } catch (e) { return { error: 'Workers AI did not answer. Try again.' }; }
  const b64 = out && (out.image || out.images?.[0]);
  if (!b64) return { error: 'Workers AI did not send a picture. Try again.' };
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes };
}

function linesPrompt(c, idea) {
  const themes = themesOf(c).map((t) => THEMES.find((x) => x.id === t).name).join(', ');
  return [
    `You write short spoken lines for ${c.name}, a ${c.gender === 'f' ? 'woman' : 'man'} in "The Fantastical Logic Grid", a family-friendly logic puzzle game. Personality: ${c.personality}. They can appear in these themes: ${themes}.`,
    'Write lines in their own voice:',
    ...Object.entries(LINE_KINDS).map(([k, x]) => `- "${k}": 4 lines said ${x.name.toLowerCase()} (example: "${x.example}")${k === 'clue' ? '; the clue itself follows, so end with a colon' : ''}.`),
    'Rules: friendly for all ages; 3 to 15 words each; no numbers; no names of anyone or anything, no places, objects, foods, colors or times (the puzzle supplies all facts); never give advice about the answer.',
    idea ? `Extra direction from the game's team: "${String(idea).slice(0, 200)}"` : '',
    'Reply with JSON only: {"clue":["..."],"hint":["..."],"solve":["..."]}',
  ].filter(Boolean).join('\n');
}

// Returns { drafts: { clue: [{ text, ok, problem }], ... } } or { error }.
async function draftLines(env, c, idea) {
  const s = await getSettings(env);
  const model = ai(env);
  if (!model) return { error: 'The AI writer needs the Workers AI binding (wrangler.toml [ai]).' };
  if (s.character_draft_cap <= 0 || !(await bump(env, 'character_lines', s.character_draft_cap))) return { error: 'Today\'s free AI drafts for characters are used up. Try again tomorrow, or write the lines yourself.' };
  let out;
  try {
    out = await model.run(s.character_model, { messages: [{ role: 'user', content: linesPrompt(c, idea) }], max_tokens: 700, temperature: 0.9 });
  } catch (e) { return { error: 'Workers AI did not answer. Try again.' }; }
  const text = typeof out?.response === 'string' ? out.response : JSON.stringify(out?.response || '');
  let parsed;
  try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { return { error: 'The AI reply could not be read. Try again.' }; }
  const others = (await listAll(env)).filter((o) => o.id !== c.id && o.status === 'published');
  const drafts = {};
  for (const kind of Object.keys(LINE_KINDS)) {
    const list = Array.isArray(parsed[kind]) ? parsed[kind] : [];
    drafts[kind] = [];
    for (const raw of list.slice(0, 6)) {
      const t = clean(String(raw), 120);
      if (!t) continue;
      let problem = t.length < 3 || /\d/.test(t) ? 'Needs 3 to 120 characters and no numbers.' : '';
      if (!problem) problem = (await storyRuleProblems(env, { ...c, lines: { [kind]: [t] } }, others, { extra: s.blocked_words })).find((p) => p.includes(t) || p.startsWith('Some words')) || '';
      drafts[kind].push({ text: t, ok: !problem, problem });
    }
  }
  return { drafts };
}

// ------------------------------------------------------------- admin
export function characterOptions() {
  return {
    themes: THEMES.map((t) => ({ id: t.id, name: t.name })), styles: STYLES, roles: ROLES, voices: VOICES,
    voiceStyles: Object.fromEntries(Object.entries(VOICE_STYLES).map(([k, v]) => [k, v.name])),
    lineKinds: Object.fromEntries(Object.entries(LINE_KINDS).map(([k, v]) => [k, { name: v.name, max: v.max, example: v.example }])),
    limit: CHARACTER_LIMIT,
  };
}

// The admin routes, in admin.js's ROUTES shape. Refusal is admin.js's error.
export function characterRoutes(Refusal) {
  const need = async (env, id, opts) => {
    const c = await getOne(env, id, opts);
    if (!c) throw new Refusal(404, 'no_character', 'That character is gone.');
    return c;
  };
  const changed = (r) => { clearCharacterCache(); return r; };
  return [
    ['GET', /^characters$/, 'moderator', 'characters.view', async ({ env }) => {
      const s = await getSettings(env);
      const today = new Date().toISOString().slice(0, 10);
      const { results } = await env.DB.prepare("SELECT name, count FROM usage WHERE day = ?1 AND name IN ('pictures', 'character_lines', 'character_suggestions')").bind(today).all();
      const used = Object.fromEntries(results.map((r) => [r.name, r.count]));
      return {
        body: {
          options: characterOptions(), characters: await listAll(env),
          today: { pictures: used.pictures || 0, pictureCap: s.daily_picture_cap, drafts: used.character_lines || 0, draftCap: s.character_draft_cap, suggestions: used.character_suggestions || 0, suggestionCap: s.character_suggest_cap },
          enabled: s.characters_enabled, suggestions: s.character_suggest_enabled,
        },
      };
    }],
    ['GET', /^characters\/([\w-]{1,40})$/, 'moderator', 'characters.view', async ({ env, params }) => ({ body: { character: await need(env, params[0], { portrait: true }) } })],
    ['POST', /^characters\/save$/, 'moderator', 'characters.save', async ({ env, body, who, now }) => {
      const r = checkCharacter(body);
      if (r.error) throw new Refusal(400, 'bad_character', r.error);
      const c = r.value;
      const extra = (await getSettings(env)).blocked_words;
      if ([c.name, c.personality, c.look, ...Object.values(c.lines).flat()].some((t) => hasBlockedWords(t, { strict: false, extra })) || hasBlockedWords(c.name, { extra })) {
        throw new Refusal(400, 'blocked_words', 'Some words are not allowed in the game.');
      }
      let id = body.id ? String(body.id) : '';
      if (id) await need(env, id);
      else {
        const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM characters WHERE status != 'suggested'").first();
        if (n >= CHARACTER_LIMIT) throw new Refusal(400, 'too_many', `Up to ${CHARACTER_LIMIT} characters. Delete one first.`);
        id = slug(c.name) || 'character';
        for (let i = 2; await env.DB.prepare('SELECT 1 FROM characters WHERE id = ?1').bind(id).first(); i++) id = `${slug(c.name)}-${i}`;
      }
      // Saving a suggestion or a published character makes it a draft again,
      // so nothing new reaches players until it is published.
      await env.DB.prepare(`INSERT INTO characters (id, name, gender, personality, look, role, themes, style, seed, voice, lines, status, source, voice_style, updated_at, updated_by)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'draft', 'admin', ?12, ?13, ?14)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, gender = excluded.gender, personality = excluded.personality, look = excluded.look, role = excluded.role,
          themes = excluded.themes, style = excluded.style, seed = excluded.seed, voice = excluded.voice, lines = excluded.lines, status = 'draft',
          voice_style = excluded.voice_style, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .bind(id, c.name, c.gender, c.personality, c.look, c.role, JSON.stringify(c.themes), c.style, c.seed, JSON.stringify(c.voice), JSON.stringify(c.lines), c.voiceStyle, now, who.actor).run();
      const saved = await need(env, id);
      const problems = await storyRuleProblems(env, saved, (await listAll(env)).filter((o) => o.status === 'published'), { extra });
      return changed({ body: { character: saved, problems }, target: id });
    }],
    ['POST', /^characters\/([\w-]{1,40})\/portrait$/, 'moderator', 'characters.portrait', async ({ env, params, now }) => {
      const c = await need(env, params[0]);
      const r = await paintPortrait(env, c);
      if (r.error) throw new Refusal(400, 'portrait_failed', r.error);
      await env.DB.prepare("UPDATE characters SET portrait = ?1, portrait_at = ?2, status = CASE status WHEN 'published' THEN 'draft' ELSE status END WHERE id = ?3").bind(r.bytes, now, c.id).run();
      return changed({ body: { character: await need(env, c.id, { portrait: true }) }, target: c.id });
    }],
    ['POST', /^characters\/([\w-]{1,40})\/lines$/, 'moderator', 'characters.lines', async ({ env, params, body }) => {
      const c = await need(env, params[0]);
      const r = await draftLines(env, c, clean(body.idea, 200));
      if (r.error) throw new Refusal(400, 'draft_failed', r.error);
      return { body: r, target: c.id };
    }],
    ['POST', /^characters\/([\w-]{1,40})\/publish$/, 'admin', 'characters.publish', async ({ env, params, who, now }) => {
      const c = await need(env, params[0]);
      if (c.status === 'suggested') throw new Refusal(400, 'review_first', 'Open the suggestion, check it and press Save first.');
      if (c.style === 'ai' && !c.hasPortrait) throw new Refusal(400, 'no_portrait', 'Paint the AI portrait first, or choose a drawn style.');
      const problems = await storyRuleProblems(env, c, (await listAll(env)).filter((o) => o.status === 'published'), { extra: (await getSettings(env)).blocked_words });
      if (problems.length) throw new Refusal(400, 'story_rules', problems.join(' '));
      await env.DB.prepare("UPDATE characters SET status = 'published', version = version + 1, updated_at = ?1, updated_by = ?2 WHERE id = ?3").bind(now, who.actor, c.id).run();
      return changed({ body: { character: await need(env, c.id) }, target: c.id });
    }],
    ['POST', /^characters\/([\w-]{1,40})\/unpublish$/, 'admin', 'characters.unpublish', async ({ env, params, who, now }) => {
      const c = await need(env, params[0]);
      await env.DB.prepare("UPDATE characters SET status = 'draft', updated_at = ?1, updated_by = ?2 WHERE id = ?3 AND status = 'published'").bind(now, who.actor, c.id).run();
      return changed({ body: { character: await need(env, c.id) }, target: c.id });
    }],
    ['POST', /^characters\/([\w-]{1,40})\/delete$/, 'admin', 'characters.delete', async ({ env, params }) => {
      const c = await need(env, params[0]);
      await env.DB.prepare('DELETE FROM characters WHERE id = ?1').bind(c.id).run();
      return changed({ body: { ok: true }, target: c.id, detail: { name: c.name } });
    }],
  ];
}

// Published character names allowed in a theme, for the Story workshop's check.
export async function characterNamesFor(env, themeId) {
  try {
    const { results } = await env.DB.prepare("SELECT name, themes FROM characters WHERE status = 'published'").all();
    return results.filter((r) => { const t = JSON.parse(r.themes); return !t.length || t.includes(themeId); }).map((r) => r.name);
  } catch (e) { return []; }
}
export const namesCharacter = (text, names) => names.find((n) => has(String(text).replace(/\{\w+\}/g, ' '), n)) || null;

// ------------------------------------------------------------- public
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A player's answers to the game's Suggest a character questions. Kept as a
// suggestion for the creator; nothing reaches other players until an admin
// reviews, saves and publishes it.
async function postSuggestion(req, env, ctx) {
  let body;
  try { body = JSON.parse(await readText(req, 4_000)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  const s = await getSettings(env);
  if (!s.characters_enabled || !s.character_suggest_enabled) return json(req, env, { error: 'switched_off', message: 'Character suggestions are closed for now.' }, 503);
  const r = checkCharacter({ ...(body || {}), lines: {}, voice: null, seed: '' }, { player: true });
  if (r.error) return json(req, env, { error: 'bad_character', message: r.error }, 400);
  const c = r.value;
  if ([c.personality, c.look].some((t) => hasBlockedWords(t, { strict: false, extra: s.blocked_words })) || hasBlockedWords(c.name, { extra: s.blocked_words })) {
    return json(req, env, { error: 'blocked_words', message: 'Some of those words are not allowed in the game. Please change them.' }, 422);
  }
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM characters WHERE status = 'suggested'").first();
  if (n >= SUGGESTED_LIMIT || s.character_suggest_cap <= 0 || !(await bump(env, 'character_suggestions', s.character_suggest_cap))) {
    return json(req, env, { error: 'used_up', message: 'Lots of characters were suggested today. Please try again tomorrow.' }, 429, { 'Retry-After': '3600' });
  }
  let id = `idea-${slug(c.name)}-${Math.random().toString(36).slice(2, 7)}`;
  await env.DB.prepare(`INSERT INTO characters (id, name, gender, personality, look, role, themes, style, seed, voice, lines, status, source, voice_style, updated_at, updated_by)
    VALUES (?1, ?2, ?3, ?4, ?5, 'cast', ?6, 'notionists', ?7, ?8, '{"clue":[],"hint":[],"solve":[]}', 'suggested', 'player', ?9, ?10, 'a player')`)
    .bind(id, c.name, c.gender, c.personality, c.look, JSON.stringify(c.themes), c.seed, JSON.stringify(c.voice), c.voiceStyle, Date.now()).run();
  await alert(env, ctx, { category: 'approvals', title: 'A player suggested a character', body: `${c.name}: ${c.personality}`.slice(0, 200), link: 'characters' });
  return json(req, env, { ok: true }, 201);
}

const PORTRAIT_PATH = /^\/v1\/characters\/([\w-]{1,40})\/portrait$/;

// Returns a Response for this module's routes, or null for anything else.
export async function handleCharacters(req, env, url, ctx) {
  const path = url.pathname;
  if (path !== '/v1/characters' && !path.startsWith('/v1/characters/')) return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (path === '/v1/characters/suggest' && req.method === 'POST') {
    if (env.LIMIT_FEEDBACK && !(await env.LIMIT_FEEDBACK.limit({ key: `character|${(await sha256(`flg|${ip}`)).slice(0, 32)}` })).success) {
      return json(req, env, { error: 'slow_down', message: 'Please wait a minute before suggesting another character.' }, 429, { 'Retry-After': '60' });
    }
    return postSuggestion(req, env, ctx);
  }
  if (req.method !== 'GET') return json(req, env, { error: 'not_found' }, 404);
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  if (path === '/v1/characters') return json(req, env, await publicCharacters(env), 200, { 'Cache-Control': 'public, max-age=120' });
  const m = path.match(PORTRAIT_PATH);
  if (!m) return json(req, env, { error: 'not_found' }, 404);
  const r = await env.DB.prepare("SELECT portrait FROM characters WHERE id = ?1 AND status = 'published' AND style = 'ai' AND portrait IS NOT NULL").bind(m[1]).first();
  if (!r) return json(req, env, { error: 'not_found' }, 404);
  return new Response(r.portrait, { headers: { ...corsHeaders(req, env), 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}
