// Screen-name rules and the word check used for names and for the text of
// puzzles shared in races. The check folds look-alike spellings (sh1t, $hit,
// shiiit, s.h.i.t) before matching, so most dodges are caught. It is a basic
// filter, not a moderator: a player can still change or remove their name.

export const NAME_MIN = 3;
export const NAME_MAX = 20;
const NAME_CHARS = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

// Words that are never allowed anywhere inside a name, even joined to others.
const ALWAYS = [
  'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard',
  'asshole', 'arsehole', 'wank', 'twat', 'prick', 'jizz', 'cum', 'porn', 'sex', 'penis', 'vagina',
  'boob', 'tits', 'nigg', 'niga', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink',
  'tranny', 'dyke', 'paki', 'coon', 'wetback', 'kkk', 'molest', 'pedo', 'paedo', 'incest', 'anal',
  'dildo', 'bollock', 'bugger', 'skank', 'nutsack', 'scrotum', 'testicle', 'goddam', 'motherf',
];
// Short words that are only refused as a whole word, so names such as
// "Scunthorpe", "Classic" or "Grape" stay allowed.
const WHOLE = ['ass', 'arse', 'hoe', 'hoes', 'tit', 'fap', 'homo', 'jap', 'gook', 'crap', 'piss', 'poop', 'turd'];
// Words that would let someone pretend to speak for the game.
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'support', 'official', 'staff', 'system', 'thelogicgrid', 'logicgrid', 'fantasticallogicgrid', 'anthropic', 'claude', 'guest', 'anonymous', 'null', 'undefined', 'you'];
// Parts of ordinary words that contain a blocked word (class, cumin, document).
const SAFE = ['class', 'pass', 'mass', 'bass', 'grass', 'brass', 'glass', 'assist', 'assess', 'asset', 'cassie', 'compass',
  'cumin', 'cumul', 'cucumber', 'document', 'circum', 'scum', 'accum', 'dickens', 'dickinson', 'cockpit', 'cocktail', 'peacock', 'shuttlecock', 'hancock', 'woodcock', 'babcock',
  'scunthorpe', 'sussex', 'essex', 'middlesex', 'sextant', 'sextet', 'analy', 'canal', 'banal', 'anale', 'kitsch', 'titan', 'title', 'titmouse', 'shitake', 'shiitake', 'therapist', 'grape', 'drape', 'scrap', 'trap', 'wrap', 'rapid', 'rapt', 'rapp', 'rapier', 'parapet', 'therap',
  'spice', 'spicy', 'despicable', 'chinking', 'pakistan', 'raccoon', 'cocoon', 'tycoon', 'fagin', 'cocker', 'pedometer', 'pedal', 'pedestal', 'pediatric', 'encyclopedia', 'torpedo', 'expedite', 'speedo', 'boobook', 'homonym', 'homogen'];

const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '£': 'l' };

function fold(text) {
  return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[0-9@$!|+€£]/g, (c) => LEET[c] || c);
}
const squeeze = (s) => s.replace(/(.)\1+/g, '$1');

// True when the text has a blocked word. Names are also checked with their
// words joined ("s.h.i.t", "big_shit") and for the short whole words; puzzle
// text (strict = false) is checked one word at a time, so ordinary sentences
// such as "the cat's hit" never trip it. extra: more words to refuse, from the
// admin dashboard's blocked_words setting.
export function hasBlockedWords(text, { strict = true, extra = [] } = {}) {
  const folded = fold(text);
  const tokens = folded.split(/[^a-z]+/).filter(Boolean);
  if (strict && tokens.some((t) => WHOLE.includes(t) || WHOLE.includes(squeeze(t)))) return true;
  const runs = strict ? [folded.replace(/[^a-z]+/g, '')] : tokens;
  return runs.some((run) => {
    for (const safe of SAFE) run = run.split(safe).join('~');
    return ALWAYS.some((w) => run.includes(w) || squeeze(run).includes(w)) || extra.some((w) => run.includes(w) || squeeze(run).includes(w));
  });
}

// The key two names must not share. Look-alike digits count as letters, so
// "Sky_Fox", "sky fox" and "SKYF0X" are the same name.
export function nameKey(name) { return fold(name).replace(/[^a-z0-9]+/g, ''); }

export function cleanName(raw) { return String(raw ?? '').normalize('NFKC').trim().replace(/\s+/g, ' '); }

// Returns null when the name is fine, or { code, message } for the player.
export function checkName(raw, { extra = [] } = {}) {
  const name = cleanName(raw);
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { code: 'name_length', message: `Use ${NAME_MIN} to ${NAME_MAX} characters.` };
  if (!NAME_CHARS.test(name)) return { code: 'name_chars', message: 'Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number.' };
  const key = nameKey(name);
  if (key.length < NAME_MIN) return { code: 'name_length', message: `Use at least ${NAME_MIN} letters or numbers.` };
  if (/^\d+$/.test(name.replace(/[ _.-]/g, ''))) return { code: 'name_digits', message: 'Include at least one letter.' };
  if (RESERVED.some((r) => key === r || key.startsWith(r) && r.length >= 5)) return { code: 'name_reserved', message: 'That name is kept for the game itself. Please choose another.' };
  if (hasBlockedWords(name, { extra })) return { code: 'name_blocked', message: 'That name is not allowed. Please choose a friendly one.' };
  return null;
}
