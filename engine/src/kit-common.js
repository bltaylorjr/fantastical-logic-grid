// Shared pieces for the newer number and picture games (Cage Math, Sum Cross,
// Picture Grid): fingerprints, picking a candidate by toughness, cell names,
// and the short story lines that open and close each puzzle.
import { hashString, makeRng } from './rng.js';

export const KIT_LEVELS = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
export const KIT_LEVEL_NAMES = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };

export const cellName = (cols, c) => `row ${Math.floor(c / cols) + 1}, column ${(c % cols) + 1}`;
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const clamp01 = (t) => Math.max(0, Math.min(1, Number.isFinite(+t) ? +t : 0.5));

// A short fingerprint of a puzzle. Players keep a list of the ones they have
// played, so free play never gives the same puzzle twice.
export const fingerprint = (game, text) => `${game}:${hashString(text).toString(36)}${hashString(`${text}|2`).toString(36)}`;

// Several proven candidates, sorted by score: the toughness target (0 gentlest,
// 1 toughest) picks one by its place in that order.
export function pickByToughness(cands, t) {
  const sorted = cands.slice().sort((a, b) => a.score - b.score);
  return sorted[Math.min(sorted.length - 1, Math.round(clamp01(t) * (sorted.length - 1)))];
}

// Bits for small sets of numbers 1..9.
export const bit = (d) => 1 << (d - 1);
export const bitCount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
export const bitsOf = (m) => { const out = []; for (let d = 1; m; d++, m >>= 1) if (m & 1) out.push(d); return out; };
export const onlyBit = (m) => (m && !(m & (m - 1)) ? Math.log2(m) + 1 : 0);
// "a 7", "an 8".
export const aNum = (d) => (d === 8 || d === 11 || d === 18 ? `an ${d}` : `a ${d}`);
export const listAnd = (xs) => (xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const listOr = (xs) => (xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

// Story lines: a title, an opening line and an ending, from small word lists,
// different for each game. Seeded, so the daily puzzle tells everyone the same story.
const STORY = {
  cm: {
    places: ['Harbor', 'Lantern', 'Copper', 'Orchard', 'Clocktower', 'Glasshouse', 'Saltmarsh', 'Ember', 'Juniper', 'Mapmaker\'s', 'Old Mill', 'Quarry', 'Weaver\'s', 'Signal', 'Lighthouse', 'Market', 'Ferry', 'Granary', 'Observatory', 'Riverside'],
    things: ['Vault', 'Strongroom', 'Safe', 'Lockbox', 'Cellar', 'Treasury', 'Coffer', 'Chest'],
    intros: [
      'The {place} {thing} has a lock in every cage. Each one opens only when its numbers make the target.',
      'Someone changed the combination on the {place} {thing}. The cages still remember their totals.',
      'The keeper of the {place} {thing} left a grid of sums and products, and no key.',
      'Every cage of the {place} {thing} hums until its numbers add, multiply or divide to the mark.',
    ],
    endings: [
      'The last cage clicks, and the {place} {thing} swings open.',
      'Every lock agrees at once. The {place} {thing} is yours.',
      'The tumblers fall into place. The {place} {thing} gives up its secret.',
    ],
  },
  sc: {
    places: ['Starlight', 'Cobble', 'Meadow', 'Ironworks', 'Canal', 'Pinewood', 'Harbor', 'Quill', 'Foundry', 'Signal', 'Orchard', 'Bramble', 'Hilltop', 'Marina', 'Clockwork', 'Lantern', 'Willow', 'Granite', 'Seaside', 'Thistle'],
    things: ['Crossing', 'Junction', 'Switchyard', 'Crossroads', 'Viaduct', 'Interchange', 'Square', 'Gate'],
    intros: [
      'The signals at {place} {thing} only turn green when every line adds up.',
      'At {place} {thing} each run of track carries a total. No number rides the same run twice.',
      'The night ledger for {place} {thing} lost its numbers. The totals are all that is left.',
      'Trains wait at {place} {thing} until every across and every down is balanced.',
    ],
    endings: [
      'Every signal turns green. {place} {thing} is moving again.',
      'The ledger balances to the last digit. {place} {thing} is clear.',
      'The last total fits. The trains roll out of {place} {thing}.',
    ],
  },
};

export function kitStory(game, seed, used = []) {
  const s = STORY[game];
  if (!s) return null;
  const seen = new Set(used);
  let pick = null;
  for (let i = 0; i < 40 && !pick; i++) {
    const r = makeRng(`${seed}:story:${i}`);
    const place = r.pick(s.places), thing = r.pick(s.things);
    const id = `${game}-${place}-${thing}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(id) && i < 39) continue;
    const fill = (t) => t.replaceAll('{place}', place).replaceAll('{thing}', thing);
    pick = { id, title: `The ${place} ${thing}`.replace(/^The The /, 'The '), intro: fill(r.pick(s.intros)), ending: fill(r.pick(s.endings)) };
  }
  return pick;
}
