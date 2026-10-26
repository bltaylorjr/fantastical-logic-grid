// The Story workshop, now in the admin dashboard: admins write story parts
// (or approve drafts from the AI story writer) that every player's new
// stories use. Every part is checked by the engine's rules first, so a story
// part only changes the words, never the logic.
//
// The AI writer uses the GEMINI_API_KEY Worker secret on Google's free tier.
// Only the idea, the theme and a few of the game's own example parts are sent.
import { THEMES } from '../../engine/src/themes.js';
import { STORYLINES } from '../../engine/src/storylines.js';
import { getTopics, storyKey } from '../../engine/src/topics.js';
import { checkStoryPart, partKey, PART_KINDS } from '../../engine/src/story.js';
import { characterNamesFor, namesCharacter } from './characters.js';

export const KIND_NAMES = { openings: 'Opening: where everyone is', incidents: 'Event: what happened', mishaps: 'Mix-up: why the facts got scrambled', endings: 'Ending: shown when the puzzle is solved' };
export const TIPS = {
  openings: 'Use {n} for how many there are ({N} at the start of a sentence) and {many} for who they are. Example: "{N} {many} met at the old pier at sunset."',
  incidents: 'Say what happened in a sentence or two, then give it a short name and say what is at stake. Example: "The golden key vanished from the captain\'s desk."',
  mishaps: 'Say why the facts got mixed up, so only the clues can be trusted. Example: "The parrot repeated everything, but always in the wrong order."',
  endings: 'Include {Fact} for the answer; you can use {winner} and {prize} too. Example: "{Fact}, so {winner} found {prize} in the crow\'s nest!"',
};
const PART_HELP = {
  openings: 'an opening sentence that sets the scene. It must use {n} (or {N} at the start of the sentence) for how many people there are, and {many} for what they are called (the cast word).',
  incidents: 'an event: what happened. Give "name" (1 to 3 words, used in the title "The <adjective> <name>"), "text" (one or two sentences) and "prize" (the thing at stake, like "the golden key").',
  mishaps: 'one or two sentences saying why the facts got mixed up, so only the clues can be trusted.',
  endings: 'an ending shown when the puzzle is solved. It must include {Fact} (the answer, already a full clause like "Mia has the red hat") and may use {winner} (that person) and {prize}.',
};

// Every story key ("theme" for a theme's classic topic, "theme/topic"
// otherwise) with its name and the facts the AI writer needs.
const STORIES = new Map(THEMES.flatMap((t) => getTopics(t.id).map((p) => {
  const key = storyKey(t, p);
  return [key, { key, name: `${t.name}: ${p.name}`, theme: t, topic: p }];
})));

export function workshopOptions() {
  return {
    stories: [...STORIES.values()].map((s) => ({ key: s.key, name: s.name })),
    kinds: Object.keys(PART_KINDS).map((k) => ({ id: k, name: KIND_NAMES[k], tip: TIPS[k] })),
  };
}

export function checkPart(key, kind, value) {
  if (!STORIES.has(key) || !PART_KINDS[kind]) return { ok: false, errors: ['Unknown story or part.'] };
  return checkStoryPart(kind, value);
}

export async function addPart(env, key, kind, value, source) {
  const res = checkPart(key, kind, value);
  if (!res.ok) return res;
  // A story must never name one of the cast, and published characters can be cast.
  const who = namesCharacter(typeof value === 'string' ? value : Object.values(value || {}).join(' '), await characterNamesFor(env, key.split('/')[0]));
  if (who) return { ok: false, errors: [`It names the character ${who}, who can be in these puzzles. Stories never name the cast.`] };
  const id = `${key}|${kind}|${partKey(kind, value)}`;
  const now = new Date().toISOString();
  const r = await env.DB.prepare(`INSERT INTO parts (key, theme, kind, value, source, status, submitted, reviewed) VALUES (?1, ?2, ?3, ?4, ?5, 'approved', ?6, ?7)
    ON CONFLICT (key) DO UPDATE SET status = 'approved', reviewed = excluded.reviewed`)
    .bind(id, key, kind, JSON.stringify(value), source === 'ai' ? 'ai' : 'admin', now.slice(0, 10), now).run();
  return { ok: true, key: id, changed: r.meta?.changes || 0 };
}

function prompt(story, kind, idea) {
  const { theme, topic } = story;
  const cast = topic.cast || theme.cast;
  const examples = ((topic.story && topic.story[kind]) || STORYLINES[theme.id][kind]).slice().sort(() => Math.random() - 0.5).slice(0, 4);
  return [
    `You write short story parts for "The Fantastical Logic Grid", a family-friendly logic puzzle game. Theme: ${story.name} (${topic.description || theme.description}). The cast are called "${cast.many}".`,
    `Write 4 different options for ${PART_HELP[kind]}`,
    'Rules: friendly for all ages; no numbers or head counts in words or digits (the game fills in {n}); no names of people; use only the fill-ins named above, in curly brackets; 6 to 28 words each; end with a full stop or exclamation mark.',
    `Examples from the game: ${JSON.stringify(examples)}`,
    `The idea: "${String(idea).slice(0, 200)}"`,
    kind === 'incidents' ? 'Reply with JSON only: {"parts":[{"name":"...","text":"...","prize":"..."}]}' : 'Reply with JSON only: {"parts":["...","..."]}',
  ].join('\n');
}

// Returns { drafts: [{ value, ok, errors }] } or { error }.
export async function draftParts(env, model, key, kind, idea) {
  const story = STORIES.get(key);
  if (!story || !PART_KINDS[kind]) return { error: 'Unknown story or part.' };
  if (!env.GEMINI_API_KEY) return { error: 'The AI writer needs the GEMINI_API_KEY Cloudflare secret.' };
  if (!String(idea || '').trim()) return { error: 'Describe an idea first.' };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt(story, kind, idea) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 1 } }),
  });
  if (!res.ok) return { error: res.status === 429 ? 'Google\'s free limit is used up for now. Try again later.' : 'The AI writer did not answer. Try again.' };
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parts;
  try { parts = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()).parts; } catch (e) { return { error: 'The AI reply could not be read. Try again.' }; }
  if (!Array.isArray(parts)) return { error: 'The AI reply had no story parts. Try again.' };
  return { drafts: parts.slice(0, 6).map((value) => ({ value, ...checkStoryPart(kind, value) })) };
}
