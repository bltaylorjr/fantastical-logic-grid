// Puzzle details on ideas and problems, and telling a player when what they
// sent has been addressed.
//
// Puzzle details: an idea or problem sent while a puzzle is open carries
// that puzzle's own details, so the team can open the same story and clues
// (a player asked why a song-request story ended on "who ordered the
// Tacos?"). Only the puzzle: story id, title, theme, topic, difficulty,
// seed, size, engine version and the clue texts. Never the player's marks,
// notes, name or device.
//
// Addressed: an admin marks an idea or problem addressed with a short, plain
// note of what was done (admin.js) and the version. If the player ticked "Let
// the team reply to me" (the only case where the message is linked to an
// account), the note goes to their Messages as a reply from the team. The
// email for "Email me an update" is replies.js releaseUpdate.
import { cleanText } from './feedback.js';

const CLUES_MAX = 40;

const word = (v, max = 40) => (typeof v === 'string' && /^[\w .,'&:/|()!?-]{1,200}$/.test(v) ? v.trim().slice(0, max) : null);

// The puzzle details the game sent, checked and trimmed, as JSON text (or
// null when there are none or they make no sense).
export function cleanPuzzle(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {
    storyId: typeof p.storyId === 'string' && /^[\w/|.-]{1,200}$/.test(p.storyId) ? p.storyId : null,
    title: word(p.title, 80),
    theme: word(p.theme, 24),
    topic: word(p.topic, 24),
    tier: word(p.tier, 12),
    seed: typeof p.seed === 'string' && /^[\w.:-]{1,60}$/.test(p.seed) ? p.seed : null,
    size: typeof p.size === 'string' && /^\d{1,2}x\d{1,2}$/.test(p.size) ? p.size : null,
    engine: word(p.engine, 12),
    daily: p.daily === true || undefined,
    clues: Array.isArray(p.clues) ? p.clues.slice(0, CLUES_MAX).map((c) => cleanText(c).slice(0, 300)).filter(Boolean) : [],
  };
  if (!out.storyId && !out.theme && !out.clues.length) return null;
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return JSON.stringify(out);
}

export function parsePuzzle(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// The words the player reads in Messages.
export function fixMessage(kind, note, version) {
  const what = kind === 'idea' ? 'idea' : 'problem report';
  return `Good news: we've addressed your ${what}${version ? ` in version ${version}` : ''}. What we did: ${note}\n\nThank you for helping make the game better!`;
}

// The team's note as the "Email me an update" email carries it (replies.js
// releaseUpdate), with the version when there is one.
export const updateNote = (note, version) => (version ? `${note} (in version ${version})` : note);

// After an idea or problem is marked addressed (admin.js): if the player
// linked it to their account with "Let the team reply to me", the note goes
// to that conversation in Messages (teamReply, messages.js). emailed: an
// update email is already on its way (replies.js), so no separate "new
// message" notice. Returns 'sent', 'not_linked', 'none' or a refusal code.
export async function tellPlayer(env, id, who, teamReply, emailed, now = Date.now()) {
  const f = await env.DB.prepare('SELECT kind, note, fixed_in AS fixedIn, conversation_id AS conv FROM feedback WHERE id = ?1').bind(id).first();
  if (!f || !f.note) return 'none';
  if (!f.conv) return 'not_linked';
  try {
    await teamReply(env, f.conv, { text: fixMessage(f.kind, f.note, f.fixedIn), done: true, email: emailed ? false : undefined }, who, now);
    return 'sent';
  } catch (e) { return e.error || 'error'; }
}
