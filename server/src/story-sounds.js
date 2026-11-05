// Sounds sent with a Puzzle Wizard puzzle (web/js/wizard-page.js). Only
// common sound formats are kept, checked by their first bytes, never by the
// name or type the browser gave; each is small enough for one D1 row.
//
// Pictures go with story-images.js; both are shown to the team in Storyline
// submissions (admin/story-submissions.js).
export const MAX_SOUND_BYTES = 700_000;
export const MAX_SUBMISSION_SOUNDS = 2;
const MIMES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm' };
const PURPOSES = new Set(['solved', 'music', 'effect', 'other']);

const at = (b, list, i = 0) => list.every((x, k) => b[i + k] === x);
// What the first bytes say the sound is, or null.
export function sniffSound(b) {
  if (at(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (at(b, [0x4f, 0x67, 0x67, 0x53])) return 'ogg';
  if (at(b, [0x52, 0x49, 0x46, 0x46]) && at(b, [0x57, 0x41, 0x56, 0x45], 8)) return 'wav';
  if (at(b, [0x66, 0x74, 0x79, 0x70], 4)) return 'm4a';
  if (at(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  return null;
}

// Checks a sound sent as { dataUrl, name, purpose, use, credit, creditAs }.
// Returns { value } or { error }.
export function checkSound(s) {
  if (!s || typeof s !== 'object' || typeof s.dataUrl !== 'string') return { error: 'No sound was sent.' };
  const m = s.dataUrl.match(/^data:[\w/.+-]*(?:;[\w=.+-]+)*;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) return { error: 'That sound could not be read. Try an MP3, M4A, OGG or WAV.' };
  const bytes = Math.floor((m[1].length * 3) / 4) - (m[1].endsWith('==') ? 2 : m[1].endsWith('=') ? 1 : 0);
  if (bytes > MAX_SOUND_BYTES) return { error: 'That sound is too big. Try a shorter clip.' };
  let head;
  try { head = Uint8Array.from(atob(m[1].slice(0, 24)), (c) => c.charCodeAt(0)); } catch (e) { return { error: 'That sound could not be read.' }; }
  const kind = sniffSound(head);
  if (!kind) return { error: 'That sound could not be read. Try an MP3, M4A, OGG or WAV.' };
  const name = typeof s.name === 'string' ? s.name.replace(/[\u0000-\u001f\u007f<>"]/g, '').trim().slice(0, 80) || null : null;
  return { value: { mime: MIMES[kind], data: m[1], bytes, name, purpose: PURPOSES.has(s.purpose) ? s.purpose : 'other', use: s.use === true, credit: s.use === true && s.credit === true, creditAs: s.creditAs === 'real' ? 'real' : 'screen' } };
}

export async function saveSubmissionSounds(env, submissionId, sounds, now = Date.now()) {
  if (!sounds.length) return;
  await env.DB.batch(sounds.map((s) => env.DB.prepare(`INSERT INTO story_submission_sounds (submission_id, name, mime, data, bytes, purpose, use_ok, credit, credit_as, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(submissionId, s.name, s.mime, s.data, s.bytes, s.purpose, s.use ? 1 : 0, s.credit ? 1 : 0, s.creditAs, now)));
}

// The sounds with one entry, as data URLs, for the admin's entry view.
export async function submissionSounds(env, submissionId) {
  const { results } = await env.DB.prepare('SELECT id, name, mime, data, bytes, purpose, use_ok, credit, credit_as FROM story_submission_sounds WHERE submission_id = ?1 ORDER BY id').bind(Number(submissionId)).all();
  return results.map((r) => ({ id: r.id, name: r.name, bytes: r.bytes, purpose: r.purpose, use: !!r.use_ok, credit: !!r.credit, creditAs: r.credit_as, src: `data:${r.mime};base64,${r.data}` }));
}

export async function deleteSubmissionSounds(env, submissionId) {
  await env.DB.prepare('DELETE FROM story_submission_sounds WHERE submission_id = ?1').bind(Number(submissionId)).run();
}
