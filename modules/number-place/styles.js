// Game styles: new ways to play a NINETIMESNINE (Number Place) puzzle, picked on the setup
// screen. Classic, the traditional game, is the default. Every style plays a
// fresh, proven puzzle (one answer, logic only); the style changes the rules
// around it. Each one tunes itself from the player's own records of that
// style, the same way the classic game tunes its toughness.
//
// The parts that need the solver (the rival's move, the Tidewater pools and
// ebb) run in the engine worker: engine-worker.js and number-place-styles.js.

export const STYLES = [
  {
    id: 'classic', name: 'NINETIMESNINE', short: 'Classic', note: 'Classic: the traditional game',
    about: 'Fill the grid at your own pace, with notes, hints and checks whenever you want them.',
  },
  {
    id: 'rival', name: 'NINETIMESNINE-Rival Grid', short: 'Rival Grid', note: 'Take turns against a rival',
    about: 'You and a computer rival take turns on one grid. Place a right number and the cell is yours; a wrong one costs you your turn. Notes are free. Whoever claims more cells wins.',
    tips: [
      'You and the rival take turns. Your move ends when you place a number.',
      'A right number claims the cell for you. A wrong one is taken back, and the rival moves.',
      'Notes never end your turn, so pencil in as much as you like before you commit.',
    ],
  },
  {
    id: 'chain', name: 'NINETIMESNINE-Chain Reaction', short: 'Chain Reaction', note: 'Link moves for combos',
    about: 'Place each number in the same row, column or box as your last one to grow a chain. Longer chains score more, and a number that was the only one possible scores double. A wrong number breaks the chain.',
    tips: [
      'Your next number links to the chain if it shares a row, column or box with the last one. Those cells are outlined.',
      'Each link scores the length of the chain. A forced number, the only one that fits, scores double.',
      'A wrong number breaks the chain, and there is no undo, so look before you place.',
    ],
  },
  {
    id: 'tide', name: 'NINETIMESNINE-Tidewater', short: 'Tidewater', note: 'Drain the flood to find clues',
    about: 'Pools of water hide some of the given numbers. Every right number drains the cells around it and brings hidden clues up. If logic ever runs dry, the tide ebbs on its own, so you never have to guess.',
    tips: [
      'Water hides some of the given numbers. You can still fill in a cell under water.',
      'A right number drains the eight cells around it. Work next to the water to bring clues up.',
      'If nothing can be worked out from what you can see, the tide ebbs by itself. You never need to guess.',
    ],
  },
  {
    id: 'glyph', name: 'NINETIMESNINE-Glyph Quest', short: 'Glyph Quest', note: 'Glyphs, powers and a map',
    about: 'The numbers become glyphs from a realm on your quest map. Finishing rows, columns and boxes earns powers: a Lantern lights up notes, a Compass points to your next move, and a Key opens a cell. Each solve takes you to the next realm.',
    tips: [
      'Each glyph stands for a number, and the rules are the same. The small number on each button is its key.',
      'Finish a row for a Lantern, a column for a Compass and a box for a Key.',
      'Lantern fills notes around the selected cell. Compass gives a hint. Key opens the selected cell.',
    ],
  },
];
export const STYLE_IDS = STYLES.map((s) => s.id);
export const styleOf = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

// Glyph Quest realms, in map order. Glyphs are common symbols every system
// font has; U+FE0E keeps the weather symbols as text, not emoji.
const T = '︎';
export const REALMS = [
  { id: 'library', name: 'The Elder Library', glyphs: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] },
  { id: 'tower', name: "The Scribe's Tower", glyphs: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'] },
  { id: 'caves', name: 'The Crystal Caves', glyphs: ['●', '▲', '■', '◆', `★${T}`, `♥${T}`, `♣${T}`, `♠${T}`, '✚'] },
  { id: 'meadow', name: 'The Moonlit Meadow', glyphs: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'λ'] },
  { id: 'harbor', name: 'The Sky Harbor', glyphs: [`☀${T}`, `☾${T}`, `☁${T}`, `☂${T}`, `❄${T}`, `⚓${T}`, `✈${T}`, `⚡${T}`, `☘${T}`] },
  { id: 'peaks', name: 'The Dragon Peaks', glyphs: ['Δ', 'Σ', 'Ω', 'Φ', 'Ψ', 'Λ', 'Π', 'Θ', 'Ξ'] },
];
export const POWERS = [
  { id: 'lantern', name: 'Lantern', from: 'row', note: 'Fill in notes for the row, column and box of the selected cell' },
  { id: 'compass', name: 'Compass', from: 'column', note: 'Show where to look next' },
  { id: 'key', name: 'Key', from: 'box', note: 'Open the selected cell' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mine = (plays, style, level) => plays.filter((r) => r.style === style && (!level || r.d === level));

// ---------- tuning from the player's records ----------

// Rival Grid: the rival's skill (0.15 to 0.95) at a level. It starts steady,
// gets sharper each time the player wins and eases off after each loss.
export function rivalSkill(plays, level) {
  let s = 0.45;
  for (const r of mine(plays, 'rival', level).slice(-10)) {
    if (r.outcome !== 'solved') s -= 0.08;
    else if (r.sr?.won) s += 0.05 + Math.min(0.05, Math.max(0, (r.sr.you - r.sr.rival) / 100));
    else if (!r.sr?.tie) s -= 0.06;
  }
  return clamp(s, 0.15, 0.95);
}
export const rivalName = (s) => (s < 0.35 ? 'Apprentice' : s < 0.6 ? 'Steady' : s < 0.8 ? 'Sharp' : 'Relentless');
// How the rival plays at a skill: how long it thinks, the techniques it knows
// and how often it misses a move it could have found.
export function rivalPlan(skill, size) {
  return {
    delay: (2400 - 1500 * skill) * (size === 9 ? 1 : 0.7),
    maxLevel: skill < 0.35 ? 1 : skill < 0.6 ? 2 : skill < 0.8 ? 3 : 5,
    miss: (1 - skill) * 0.45,
  };
}

// Chain Reaction: the chain to aim for, a little past the player's recent best.
export function chainGoal(plays, size) {
  const base = size === 4 ? 4 : size === 6 ? 6 : 8;
  const bests = mine(plays, 'chain').filter((r) => r.size === size && r.sr?.best).slice(-6).map((r) => r.sr.best);
  if (!bests.length) return base;
  return Math.max(base, Math.round((bests.reduce((a, b) => a + b, 0) / bests.length) * 1.15) + 1);
}

// Tidewater: how much of the grid starts under water, 0.2 to 0.8. Deeper
// after clean solves, shallower after a struggle.
export function tideDepth(plays, level) {
  let d = 0.4;
  for (const r of mine(plays, 'tide', level).slice(-8)) {
    if (r.outcome !== 'solved' || r.hints >= 3) d -= 0.08;
    else if (r.hints <= 1) d += 0.06;
  }
  return clamp(d, 0.2, 0.8);
}

// Glyph Quest: where the player is on the map, and the powers to start with.
// A player who struggled with the last two realms starts with a spare Key.
export function glyphStart(plays) {
  const all = mine(plays, 'glyph');
  const solved = all.filter((r) => r.outcome === 'solved').length;
  const lastTwo = all.slice(-2);
  const struggled = lastTwo.length === 2 && lastTwo.every((r) => r.outcome !== 'solved' || r.hints >= 3);
  return { realm: solved % REALMS.length, lap: Math.floor(solved / REALMS.length) + 1, powers: { lantern: 1, compass: 1, key: struggled ? 2 : 1 } };
}

// A short line for the setup screen about how the chosen style is tuned.
export function tuningNote(id, plays, level, size) {
  if (id === 'rival') { const s = rivalSkill(plays, level); return `Your rival: ${rivalName(s)}. It gets sharper when you win and eases off when you lose.`; }
  if (id === 'chain') return `Chain goal: ${chainGoal(plays, size)} in a row. It grows with your best chains.`;
  if (id === 'tide') return `About ${Math.round(tideDepth(plays, level) * 100)}% of the grid starts under water. Clean solves make the next flood deeper.`;
  if (id === 'glyph') { const g = glyphStart(plays); return `Next realm: ${REALMS[g.realm].name}${g.lap > 1 ? ` (lap ${g.lap})` : ''}.${g.powers.key > 1 ? ' You start with a spare Key.' : ''}`; }
  return '';
}

// ---------- saved games ----------

const int = (n, lo, hi, d = 0) => (Number.isInteger(n) && n >= lo && n <= hi ? n : d);

// The style's part of a saved game or file, rebuilt from checked fields only.
export function cleanStyle(g, N) {
  const style = STYLE_IDS.includes(g?.style) ? g.style : 'classic';
  const out = { style };
  const cell = (i) => int(i, 0, N * N - 1, -1);
  if (style === 'rival') {
    out.owner = Array.isArray(g.owner) && g.owner.length === N * N ? g.owner.map((o) => int(o, 0, 2)) : Array(N * N).fill(0);
    out.turn = g.turn === 'rival' ? 'rival' : 'you';
    out.rivalSkill = Number.isFinite(g.rivalSkill) ? clamp(g.rivalSkill, 0.15, 0.95) : 0.45;
    out.rivalLast = cell(g.rivalLast);
  } else if (style === 'chain') {
    const c = g.chain || {};
    out.chain = { last: cell(c.last), len: int(c.len, 0, 999), best: int(c.best, 0, 999), score: int(c.score, 0, 1e6), goal: int(c.goal, 1, 999, 8), links: int(c.links, 0, 999) };
  } else if (style === 'tide') {
    out.water = [...new Set((Array.isArray(g.water) ? g.water : []).filter((i) => cell(i) >= 0))];
    out.ebbs = int(g.ebbs, 0, 999);
    out.depth = Number.isFinite(g.depth) ? clamp(g.depth, 0, 1) : 0.4;
  } else if (style === 'glyph') {
    const pw = g.powers || {};
    out.realm = int(g.realm, 0, REALMS.length - 1);
    out.lap = int(g.lap, 1, 999, 1);
    out.powers = { lantern: int(pw.lantern, 0, 99), compass: int(pw.compass, 0, 99), key: int(pw.key, 0, 99) };
    out.used = int(g.used, 0, 999);
  }
  return out;
}
