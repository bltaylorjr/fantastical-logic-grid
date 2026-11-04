// The trademark and copyright scanner for the Storyline Submission Database
// (admin > Storyline submissions > Scan). It helps the team spot entries that
// may use someone else's protected names or words before approving them. It
// is a screening aid, not legal clearance: a clear scan does not prove an
// entry is free to use.
//
// Three checks, each pointing to the field it found something in:
//   1. Watch list: well-known trademarks, brands and protected characters
//      (WATCH below), matched as whole words.
//   2. Copied entries: long runs of the same words as another submission
//      (8 words in a row), which can mean a story was copied or sent twice.
//   3. AI review (Gemini, the GEMINI_API_KEY secret): trademarks, protected
//      characters, franchise settings, and wording that looks copied from a
//      published book, film, song or game. Skipped, with a note, without the key.
// The verdict is clear (nothing found), check (worth a look) or problem
// (very likely protected material). Each finding has a search link for a
// person to confirm.

// Names a player's story must not borrow. type: trademark (a brand or
// product name) or character (a protected character, place or franchise).
// Generic words that are also marks ("Clue", "Apple") are left out, or listed
// only in forms that can only mean the mark.
const WATCH = [
  // Franchises and studios
  ['Disney', 'trademark'], ['Pixar', 'trademark'], ['Marvel', 'trademark'], ['DC Comics', 'trademark'], ['Lucasfilm', 'trademark'],
  ['Star Wars', 'character'], ['Jedi', 'character'], ['Sith', 'character'], ['Darth Vader', 'character'], ['Luke Skywalker', 'character'], ['Yoda', 'character'],
  ['Star Trek', 'character'], ['Harry Potter', 'character'], ['Hogwarts', 'character'], ['Hermione', 'character'], ['Dumbledore', 'character'], ['Voldemort', 'character'], ['Quidditch', 'character'], ['Muggle', 'character'],
  ['Middle-earth', 'character'], ['Gandalf', 'character'], ['Frodo', 'character'], ['Hobbit', 'character'],
  ['Hunger Games', 'character'], ['Katniss', 'character'], ['Game of Thrones', 'character'], ['Westeros', 'character'], ['Narnia', 'character'],
  ['Mickey Mouse', 'character'], ['Minnie Mouse', 'character'], ['Donald Duck', 'character'], ['Goofy', 'character'], ['Elsa', 'character', 'only with Frozen or Arendelle'], ['Arendelle', 'character'],
  ['Simba', 'character'], ['Moana', 'character'], ['Buzz Lightyear', 'character'], ['Woody', 'character', 'only as the Toy Story cowboy'], ['Shrek', 'character'], ['Minions', 'character'],
  ['Spider-Man', 'character'], ['Spiderman', 'character'], ['Iron Man', 'character'], ['Captain America', 'character'], ['Avengers', 'character'], ['Hulk', 'character'], ['Thor', 'character', 'only as the Marvel hero'], ['Wolverine', 'character'], ['X-Men', 'character'],
  ['Batman', 'character'], ['Superman', 'character'], ['Wonder Woman', 'character'], ['Gotham', 'character'], ['Joker', 'character', 'only as the Batman villain'], ['Krypton', 'character'],
  ['Scooby-Doo', 'character'], ['Scooby Doo', 'character'], ['SpongeBob', 'character'], ['Bikini Bottom', 'character'], ['Peppa Pig', 'character'], ['Paw Patrol', 'character'], ['Bluey', 'character'],
  ['Garfield', 'character'], ['Snoopy', 'character'], ['Peanuts', 'character', 'only as the comic strip'], ['Looney Tunes', 'character'], ['Bugs Bunny', 'character'], ['Tom and Jerry', 'character'], ['Hello Kitty', 'character'],
  ['Pokemon', 'character'], ['Pokémon', 'character'], ['Pikachu', 'character'], ['Super Mario', 'character'], ['Mario Bros', 'character'], ['Luigi', 'character'], ['Princess Peach', 'character'], ['Bowser', 'character'], ['Zelda', 'character'], ['Hyrule', 'character'],
  ['Sonic the Hedgehog', 'character'], ['Minecraft', 'trademark'], ['Creeper', 'character', 'only as the Minecraft monster'], ['Fortnite', 'trademark'], ['Roblox', 'trademark'], ['Among Us', 'trademark'], ['Pac-Man', 'character'], ['Tetris', 'trademark'],
  ['Transformers', 'character'], ['Optimus Prime', 'character'], ['Teenage Mutant Ninja Turtles', 'character'], ['Ghostbusters', 'character'], ['Jurassic Park', 'character'], ['Indiana Jones', 'character'], ['James Bond', 'character'], ['007', 'character'],
  ['Doctor Who', 'character'], ['TARDIS', 'character'], ['Dalek', 'character'], ['Stranger Things', 'character'], ['Hawkins Lab', 'character'], ['Willy Wonka', 'character'], ['Oompa Loompa', 'character'], ['Paddington', 'character'], ['Winnie the Pooh', 'character', 'the Disney versions are protected'],
  // Games of deduction (close to this game's own world)
  ['Cluedo', 'trademark'], ['Colonel Mustard', 'character'], ['Professor Plum', 'character'], ['Miss Scarlet', 'character'], ['Miss Scarlett', 'character'], ['Mrs. Peacock', 'character'], ['Mrs Peacock', 'character'], ['Reverend Green', 'character'], ['Mrs. White', 'character', 'only with other Cluedo names'],
  ['Monopoly', 'trademark'], ['Scrabble', 'trademark'], ['Wordle', 'trademark'], ['Sudoku', 'trademark', 'a registered mark in some countries; generic in the US'], ['Kakuro', 'trademark', 'a registered mark in some countries'],
  // Brands
  ['Lego', 'trademark'], ['Barbie', 'trademark'], ['Hot Wheels', 'trademark'], ['Nerf', 'trademark'], ['Play-Doh', 'trademark'], ['Rubik', 'trademark'], ['Coca-Cola', 'trademark'], ['Coke', 'trademark'], ['Pepsi', 'trademark'],
  ['McDonald\'s', 'trademark'], ['Starbucks', 'trademark'], ['Nike', 'trademark'], ['Adidas', 'trademark'], ['iPhone', 'trademark'], ['iPad', 'trademark'], ['Google', 'trademark'], ['YouTube', 'trademark'], ['TikTok', 'trademark'], ['Instagram', 'trademark'], ['Facebook', 'trademark'],
  ['Amazon', 'trademark', 'only as the company'], ['Netflix', 'trademark'], ['Nintendo', 'trademark'], ['PlayStation', 'trademark'], ['Xbox', 'trademark'], ['Oreo', 'trademark'], ['Skittles', 'trademark'], ['M&M\'s', 'trademark'], ['Kleenex', 'trademark'], ['Jell-O', 'trademark'],
  ['Velcro', 'trademark'], ['Frisbee', 'trademark'], ['Jacuzzi', 'trademark'], ['Popsicle', 'trademark'], ['Band-Aid', 'trademark'], ['Post-it', 'trademark'], ['Ferrari', 'trademark'], ['Tesla', 'trademark', 'only as the company'], ['NASCAR', 'trademark'], ['NFL', 'trademark'], ['NBA', 'trademark'], ['Super Bowl', 'trademark'], ['Olympics', 'trademark'], ['Olympic', 'trademark'],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WATCH_RE = WATCH.map(([term, type, note]) => ({ term, type, note: note || '', re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}(?=$|[^\\p{L}\\p{N}])`, 'iu') }));

// Search links a person can use to confirm a finding.
// The USPTO search page takes the words typed in (it has no stable link for a search).
const markSearch = () => 'https://tmsearch.uspto.gov/';
const phraseSearch = (text) => `https://www.google.com/search?q=${encodeURIComponent(`"${text}"`)}`;

// The fields worth scanning, as [label, words], from the form copy.
const SKIP = new Set(['Entry', 'Consent', 'Reward', 'Tone', 'Level of difficulty', 'Puzzle', 'Characters', 'Theme']);
export const scanFields = (copy) => copy.filter(([label, value]) => !SKIP.has(label) && String(value || '').trim());

// 1. Watch list.
export function watchListFindings(fields) {
  const out = [];
  const seen = new Set();
  for (const [label, value] of fields) {
    for (const w of WATCH_RE) {
      if (seen.has(w.term.toLowerCase()) || !w.re.test(value)) continue;
      seen.add(w.term.toLowerCase());
      out.push({
        type: w.type, term: w.term, field: label, source: 'watch list',
        why: `${w.type === 'character' ? 'A protected character, place or franchise name' : 'A trademark or brand name'}${w.note ? ` (${w.note})` : ''}.`,
        link: markSearch(w.term), serious: !w.note,
      });
    }
  }
  return out;
}

// 2. Copied entries: 8 words in a row shared with another submission.
const words = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
const SHINGLE = 8;
function shingles(text) {
  const w = words(text);
  const out = new Map();
  for (let i = 0; i + SHINGLE <= w.length; i++) { const k = w.slice(i, i + SHINGLE).join(' '); if (!out.has(k)) out.set(k, i); }
  return out;
}
export function duplicateFindings(text, others) {
  const mine = shingles(text);
  if (!mine.size) return [];
  const out = [];
  for (const o of others) {
    const theirs = shingles(o.text);
    let shared = 0;
    let sample = '';
    for (const k of mine.keys()) if (theirs.has(k)) { shared += 1; sample = sample || k; }
    if (!shared) continue;
    const share = shared / mine.size;
    out.push({
      type: 'duplicate', term: `Entry #${o.id}`, field: 'Whole entry', source: 'copied-entry check', otherId: o.id,
      why: `${Math.round(share * 100)}% of this entry's 8-word runs also appear in entry #${o.id}, for example "${sample}".`,
      serious: share >= 0.5,
    });
  }
  return out.sort((a, b) => b.serious - a.serious).slice(0, 5);
}

// 3. AI review.
async function aiFindings(env, model, fields) {
  if (!env.GEMINI_API_KEY) return { note: 'AI review skipped: it needs the GEMINI_API_KEY Cloudflare secret. The watch list and copied-entry checks still ran.' };
  const prompt = `You screen player-written story submissions for a family logic puzzle game for intellectual property problems, before the team uses them.
Look for: (1) trademarks and brand names; (2) protected characters, places, creatures or settings from books, films, TV, comics or games; (3) wording that looks copied from a published work (book passages, song lyrics, poems, famous film lines) rather than written by the player.
Public domain material (for example Sherlock Holmes stories before 1928, fairy tales, Greek myths, Shakespeare) and ordinary words are fine: do not flag them. Generic genre ideas (a haunted house, a detective, a dragon) are fine.
For each finding give the field label, the exact words, what it may belong to, and how sure you are ("likely" or "possible").
Return only JSON: {"findings":[{"field":"","words":"","type":"trademark|character|copyright","owner":"","why":"","certainty":"likely|possible"}],"summary":"one plain sentence"}
Submission fields:
${JSON.stringify(Object.fromEntries(fields.map(([k, v], i) => [`${k}${fields.findIndex(([k2]) => k2 === k) !== i ? ` (${i})` : ''}`, String(v).slice(0, 2000)])))}`;
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
    });
  } catch (e) { return { note: 'AI review did not answer. The watch list and copied-entry checks still ran; scan again later for the AI review.' }; }
  if (!res.ok) return { note: res.status === 429 ? 'AI review skipped: Google\'s free limit is used up for now. Scan again later.' : 'AI review did not answer. Scan again later for the AI review.' };
  try {
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const out = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    const findings = (Array.isArray(out.findings) ? out.findings : []).slice(0, 12).map((f) => {
      const type = ['trademark', 'character', 'copyright'].includes(f.type) ? f.type : 'copyright';
      const term = String(f.words || '').slice(0, 200);
      return {
        type, term, field: String(f.field || '').replace(/ \(\d+\)$/, '').slice(0, 60), source: 'AI review',
        why: `${String(f.why || '').slice(0, 300)}${f.owner ? ` (may belong to ${String(f.owner).slice(0, 80)})` : ''}`,
        link: type === 'copyright' ? phraseSearch(term.split(/\s+/).slice(0, 12).join(' ')) : markSearch(term), serious: f.certainty === 'likely',
      };
    }).filter((f) => f.term);
    return { findings, summary: String(out.summary || '').slice(0, 300) };
  } catch (e) { return { note: 'The AI review could not be read. Scan again.' }; }
}

// Scans one entry. others: [{ id, text }] of other submissions to compare.
// Returns { verdict, findings, summary, notes, at }.
export async function scanEntry(env, { model, copy, text, others = [], now = Date.now() }) {
  const fields = scanFields(copy);
  const ai = await aiFindings(env, model, fields);
  const findings = [...watchListFindings(fields), ...duplicateFindings(text, others), ...(ai.findings || [])];
  // The same words found twice (watch list and AI) are shown once, keeping the surer one.
  const seen = new Map();
  for (const f of findings) {
    const k = `${f.type === 'duplicate' ? f.term : f.term.toLowerCase()}`;
    const had = seen.get(k);
    if (!had || (f.serious && !had.serious)) seen.set(k, f);
  }
  const list = [...seen.values()];
  const verdict = list.some((f) => f.serious) ? 'problem' : list.length ? 'check' : 'clear';
  return {
    verdict, findings: list, at: now, ai: !!ai.findings,
    summary: ai.summary || (verdict === 'clear' ? 'Nothing found.' : `${list.length} ${list.length === 1 ? 'thing' : 'things'} to look at.`),
    notes: ai.note ? [ai.note] : [],
  };
}
