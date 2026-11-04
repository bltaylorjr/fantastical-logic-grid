// Stories for NINETIMESNINE. Each puzzle gets a short case: who needs the grid
// filled, why, and how it ends. A story id is made of its parts, and players
// pass the ids they have seen back as usedStories so no story repeats.
import { makeRng } from './rng.js';

// {n} is the grid size. Every theme reads well at 4, 6 or 9.
export const NP_STORY_THEMES = [
  {
    id: 'vault', name: 'The Vault', world: 'mystery',
    titles: ['The Locked Vault', 'The Banker\'s Riddle', 'Combination Unknown'],
    openings: [
      'The old bank\'s vault has a dial for every square of a {n}×{n} grid, and the night manager has forgotten the code.',
      'A safecracker left a half-finished grid scratched inside the vault door. Finish it and the door swings open.',
      'The vault only opens when every row, column and box of its keypad holds each number once.',
    ],
    stakes: ['The payroll is inside, and the workers are waiting.', 'The auditors arrive at dawn.', 'Someone swears the vault is empty. Only one way to know.'],
    endings: ['The last dial clicks, the bolts slide back, and the vault breathes out a cloud of old dust.', 'The door opens on a single envelope: "Well done. The real treasure was the logic."', 'The vault opens. The payroll is all there, every coin counted.'],
  },
  {
    id: 'garden', name: 'The Garden', world: 'parks',
    titles: ['The Planting Plan', 'Seeds in Order', 'The Gardener\'s Grid'],
    openings: [
      'The head gardener plants {n} kinds of seed in a square bed, never two alike in a row, a column or a patch.',
      'A storm scattered the seed labels across the {n}×{n} bed. A few survived where they were planted.',
      'The flower show judges want a bed where no two matching flowers share a line or a patch.',
    ],
    stakes: ['The show opens at noon.', 'Spring will not wait.', 'The bees are already circling.'],
    endings: ['Every seed goes in its place, and by summer the bed blooms in perfect stripes.', 'The judges walk the rows twice and award the gold ribbon.', 'The last seed is pressed into the soil just as the first rain falls.'],
  },
  {
    id: 'starship', name: 'The Starship', world: 'scifi',
    titles: ['Crew Rotation', 'The Navigation Lattice', 'Bridge Shift'],
    openings: [
      'The starship\'s navigation lattice scrambled during the jump. A {n}×{n} grid of beacons must be reset by hand.',
      'Each deck of the ship runs on a rotation where no crew number repeats in a line or a section.',
      'The ship\'s computer kept only part of the course grid after the solar flare.',
    ],
    stakes: ['The next jump window closes soon.', 'The captain is drumming her fingers on the console.', 'Without it, the ship drifts.'],
    endings: ['The lattice glows green from edge to edge, and the stars stretch into lines as the ship jumps.', 'The computer chirps "Course locked," and the whole bridge cheers.', 'Every beacon answers in order, and the ship turns for home.'],
  },
  {
    id: 'bakery', name: 'The Bakery', world: 'cooking',
    titles: ['The Baker\'s Dozen', 'Tray by Tray', 'Morning Rush'],
    openings: [
      'The bakery\'s cooling racks hold {n} kinds of pastry, and the owner insists no two match in a row, a column or a tray.',
      'The morning baker wrote the oven plan in flour on the counter, and the cat walked through it.',
      'A wedding order came in: a {n}×{n} display where no two matching cakes touch the same line.',
    ],
    stakes: ['The doors open at six.', 'The bride arrives in an hour.', 'The ovens are already hot.'],
    endings: ['The last tray slides in, the bell over the door rings, and the first customer gasps.', 'The display goes out perfect, and the bakery sells out by nine.', 'Every pastry is in place, and the whole street smells of butter.'],
  },
  {
    id: 'library', name: 'The Library', world: 'wonders',
    titles: ['The Shelving Puzzle', 'Lost Volumes', 'The Librarian\'s Code'],
    openings: [
      'The library\'s rare-books room shelves its {n} sets so no set repeats along a shelf, a column or a case.',
      'A visiting scholar knocked over a cart, and only some books stayed on their shelves.',
      'The founder\'s will says the books must stand so that no two volumes with the same number share a line.',
    ],
    stakes: ['The reading room opens tomorrow.', 'The scholar needs the right volume tonight.', 'The founder\'s portrait seems to be watching.'],
    endings: ['The last volume slides home, and a hidden panel behind the shelf clicks open.', 'Every book is back, and the scholar finds the page they crossed an ocean for.', 'The shelves stand in perfect order, just as the founder wanted.'],
  },
  {
    id: 'harbor', name: 'The Harbor', world: 'nautical',
    titles: ['The Harbor Lights', 'Signal Flags', 'Berth Assignments'],
    openings: [
      'The harbor master signals ships with a {n}×{n} wall of numbered flags, and the wind tore half of them away.',
      'Each berth in the harbor takes one ship of each class per row, column and dock.',
      'The lighthouse keeper\'s log lists the lamp pattern, but the ink ran in the rain.',
    ],
    stakes: ['A storm is coming in.', 'Three ships are waiting outside the breakwater.', 'The keeper\'s lamp must be lit by dusk.'],
    endings: ['The flags snap into place, and the ships glide in one by one.', 'The lamp pattern blazes out over the water, and every ship finds its berth.', 'The harbor settles for the night, every mooring filled.'],
  },
  {
    id: 'stage', name: 'The Concert', world: 'music',
    titles: ['The Seating Chart', 'Opening Night', 'The Conductor\'s Grid'],
    openings: [
      'The conductor seats {n} sections so no section repeats in a row, an aisle or a block.',
      'The program for opening night lists the order of every piece, but the printer smudged half of it.',
      'Each spotlight on the stage has a number, and no two in a line can match.',
    ],
    stakes: ['The curtain rises in twenty minutes.', 'The critics are taking their seats.', 'The orchestra is already tuning.'],
    endings: ['The house lights dim, the baton rises, and the first note fills the hall.', 'Every seat is set, and the standing ovation lasts four minutes.', 'The spotlights land on their marks, and the show begins.'],
  },
  {
    id: 'farm', name: 'The Farm', world: 'farm',
    titles: ['The Paddock Plan', 'Market Day', 'The Barn Rows'],
    openings: [
      'The farmer splits the field into a {n}×{n} grid, and no crop may repeat in a row, a column or a paddock.',
      'The market stall sorts its crates so no two matching crates sit in a line.',
      'A runaway goat rearranged the barn stalls overnight. A few animals stayed put.',
    ],
    stakes: ['Market opens at sunrise.', 'The goat is still loose.', 'Rain is forecast by the afternoon.'],
    endings: ['The last crate is stacked, and the stall is the busiest at the market.', 'Every animal is back in its stall, and the goat gets a stern look.', 'The field is planted and the rain arrives right on time.'],
  },
  {
    id: 'castle', name: 'The Castle', world: 'fantasy',
    titles: ['The Enchanted Tiles', 'The Wizard\'s Floor', 'The Throne Room Seal'],
    openings: [
      'The throne room floor is a {n}×{n} spell of runes, and only a complete pattern holds back the curse.',
      'A wizard\'s apprentice dropped the rune tiles. A few stuck where they fell.',
      'The castle gate opens for anyone who sets the sigils so none repeats in a row, a column or a ward.',
    ],
    stakes: ['The curse wakes at midnight.', 'The wizard will be home soon.', 'The royal guests are at the drawbridge.'],
    endings: ['The final rune flares gold, and the curse lifts like morning fog.', 'The tiles hum together, and the gate swings open with a sigh.', 'The wizard returns, sees the floor, and pretends it was easy.'],
  },
  {
    id: 'lab', name: 'The Laboratory', world: 'science',
    titles: ['The Sample Tray', 'The Experiment', 'Calibration Day'],
    openings: [
      'The lab\'s sample tray holds {n} compounds, and no two may share a row, a column or a rack.',
      'The centrifuge spun the labels off half the vials.',
      'The new instrument only calibrates when its {n}×{n} grid of sensors reads each value once per line.',
    ],
    stakes: ['The results are due to the journal tomorrow.', 'The samples warm up by the minute.', 'The professor is on the way down the hall.'],
    endings: ['Every vial is back in its slot, and the experiment runs without a hitch.', 'The instrument beeps once, steady and calibrated.', 'The results come back clean, and the paper is accepted.'],
  },
  {
    id: 'stadium', name: 'The Stadium', world: 'sports',
    titles: ['The Tournament Draw', 'Lane Assignments', 'The Playbook'],
    openings: [
      'The tournament draw puts {n} teams on each round so no team meets the same slot twice in a line.',
      'The swim meet assigns lanes so no swimmer repeats a lane across heats or sessions.',
      'The coach\'s playbook grid got soaked by a sports drink.',
    ],
    stakes: ['The first whistle is in ten minutes.', 'The fans are filling the stands.', 'The rival coach is watching closely.'],
    endings: ['The draw is posted, and the stadium roars as the first match begins.', 'Every lane is assigned, and the starting gun cracks.', 'The play is set, and the team runs out to win it.'],
  },
  {
    id: 'map', name: 'The Treasure Map', world: 'adventure',
    titles: ['X Marks the Grid', 'The Pirate\'s Square', 'The Lost Expedition'],
    openings: [
      'A pirate\'s map hides the treasure under a {n}×{n} grid of numbers, half of them washed away.',
      'The expedition\'s guidebook says the path is safe only on squares that complete the grid.',
      'An old captain\'s journal ends with a number square and the words "Finish it."',
    ],
    stakes: ['The tide is coming in.', 'A rival crew is one island behind.', 'The torch is burning low.'],
    endings: ['The last number lands, and the map lines up with the stones: dig here.', 'The path lights up square by square, and the chest is waiting at the end.', 'The journal\'s final page unfolds into a map home.'],
  },
];

export function npStoryIds() {
  return NP_STORY_THEMES.flatMap((t) => t.titles.flatMap((_, a) => t.openings.flatMap((__, b) => t.endings.map((___, c) => `${t.id}.${a}.${b}.${c}`))));
}

// A fresh story for this seed, skipping ids the player has already seen.
export function buildNpStory(seed, usedStories = [], size = 9, themeId = null) {
  const rng = makeRng(`${seed}:story`);
  const used = new Set(usedStories);
  const themes = themeId ? NP_STORY_THEMES.filter((t) => t.id === themeId) : NP_STORY_THEMES;
  let ids = rng.shuffle(themes.flatMap((t) => npStoryIds().filter((id) => id.startsWith(`${t.id}.`))));
  const fresh = ids.filter((id) => !used.has(id));
  if (fresh.length) ids = fresh; // when every story has been told, start over
  const id = ids[0];
  const [tid, a, b, c] = id.split('.');
  const t = NP_STORY_THEMES.find((x) => x.id === tid);
  const fill = (s) => s.replaceAll('{n}', String(size));
  return {
    id,
    theme: { id: t.id, name: t.name, world: t.world },
    title: t.titles[a],
    intro: `${fill(t.openings[b])} ${rng.pick(t.stakes)}`,
    ending: t.endings[c],
  };
}
