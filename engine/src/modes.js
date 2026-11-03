// Lab modes: two new ways to play the story logic grid, for the owner's
// review only (the setup screen shows them with ?lab=1 or a FLG_LAB=1 build).
//
//   timeline  Timeline Case: a whodunit. Suspects, places, an object and the
//             clock times in a logbook. Clues lean on time order (before,
//             right after, an hour before, between, first and last). The
//             crime's time is told in the story; the ending names the culprit
//             from the solved grid.
//   seating   Seating Plan: guests round one table, seats numbered clockwise.
//             Clues: sits next to, directly across from, two seats to the
//             left of, does not sit next to. Seats wrap round (the last seat
//             is next to Seat 1), and the solver reasons with that.
//
// Nothing here runs unless generatePuzzle gets mode 'timeline' or 'seating':
// with no mode (the default) every puzzle is byte-for-byte what it was before
// (test/mode-off-check.js proves it). The new clue types live in clues.js,
// solver.js and language.js, and no tier ever weights them.
//
// All story frames below are original writing for the game.
import { makeRng } from './rng.js';
import { TIERS } from './tiers.js';
import { clock, plural } from './themes.js';
import { orderItems } from './order.js';
import { cap, joinList } from './language.js';
import { countWords } from './story-parts.js';

export const LAB_MODES = {
  timeline: { id: 'timeline', name: 'Timeline Case', summary: 'A whodunit told by the clock: before, right after, between, first and last.' },
  seating: { id: 'seating', name: 'Seating Plan', summary: 'Guests round one table: next to, across from, two seats to the left.' },
};

export const isLabMode = (mode) => typeof mode === 'string' && Object.prototype.hasOwnProperty.call(LAB_MODES, mode);

// Names for the new clue types (the standard CLUE_TYPES list is left alone,
// so the setup screen's clue type list does not change).
export const MODE_CLUE_TYPES = {
  next: 'Right after',
  between: 'Between',
  first: 'First',
  last: 'Last',
  nextTo: 'Sits next to',
  across: 'Directly across',
  left2: 'Two seats to the left',
  notNext: 'Not next to',
};

// ---------------------------------------------------------------------------
// Story frames. Slots: {n} number word, {many}/{one} cast words, {time} the
// crime's time (timeline) or {seat} the goal seat (seating), {thing} the
// stolen or left item. Endings also get {culprit}, {place}, {object}, {extra}
// (timeline) or {winner}, {left}, {right}, {across} and the frame's own
// category items by id (seating).

const TIMELINE_FRAMES = [
  {
    id: 'gala', name: 'The Lantern Gala',
    setting: 'a small-town art gallery lit by paper lanterns at night', mood: 'elegant, hushed, suspicious',
    names: ['Ansel', 'Bettina', 'Corwin', 'Delphine', 'Emrys', 'Florence', 'Gideon', 'Harriet', 'Ignatius', 'Juniper'],
    thing: 'the silver hare statuette',
    titles: ['The Silver Hare Affair', 'The Lantern Gala Theft'],
    openings: [
      'The Harrowgate Gallery held its Lantern Gala, and {n} guests drifted between the rooms with glasses in hand.',
      'Rain tapped on the skylights while {n} {many} admired the paintings at the Harrowgate Gallery\'s Lantern Gala.',
    ],
    crime: 'At {time}, {thing} vanished from its plinth, and the lights flickered for a moment.',
    log: 'The coat-check attendant kept a careful notebook, noting each guest once as they passed her desk.',
    endings: [
      'The notebook does not lie. {culprit} {where} at {time}, the very moment {thing} vanished, with the {object} close at hand. The hare was found wrapped in a scarf, and {culprit} admitted to "borrowing" it for luck.',
      'At {time} only one guest was near the plinth: {culprit}, slipping away from the {place} with the {object}. The silver hare went back on its stand before the speeches began.',
    ],
    place: { name: 'Room', noun: 'room', pos: 'was in the {x}', neg: 'was not in the {x}', items: ['East Wing', 'Sculpture Court', 'Print Room', 'Balcony', 'Cloakroom', 'Tea Salon', 'Studio', 'Archive'] },
    object: { name: 'Object', noun: 'object', pos: 'carried the {x}', neg: 'did not carry the {x}', items: ['Opera Glasses', 'Umbrella', 'Sketchbook', 'Hand Fan', 'Walking Stick', 'Tote Bag', 'Camera', 'Programme'] },
    extra: { name: 'Drink', noun: 'drink', pos: 'was drinking {x}', neg: 'was not drinking {x}', items: ['Sparkling Water', 'Elderflower', 'Iced Tea', 'Ginger Beer', 'Lemonade', 'Cola', 'Hot Cocoa', 'Rose Tea'] },
    time: { start: 18 * 60, step: 30 },
  },
  {
    id: 'sleeper', name: 'The Overnight Sleeper',
    setting: 'a vintage night train crossing snowy hills, lamps glowing in each carriage', mood: 'cozy, tense, rattling',
    names: ['Albin', 'Beatrix', 'Casimir', 'Dorothea', 'Evander', 'Fenella', 'Godfrey', 'Henrietta', 'Isidore', 'Josephine'],
    thing: 'the sealed blue envelope',
    titles: ['The Blue Envelope', 'Trouble on the Sleeper'],
    openings: [
      'The overnight sleeper rattled north through the snow, carrying {n} {many} who all claimed they had slept soundly.',
      'Somewhere between two silent stations, the night train slowed, and {n} passengers stepped out of their berths.',
    ],
    crime: 'At {time}, {thing} was taken from the guard\'s desk.',
    log: 'The conductor punched each ticket once on his rounds, and every punch is stamped with the time.',
    endings: [
      'The ticket punches tell it plainly. {culprit} {where} at {time}, when {thing} disappeared, and the {object} gave them away. The envelope held nothing but a birthday card for the conductor.',
      '{culprit} was the only passenger who {where} at {time}. With the {object} tucked under one arm, they had hidden {thing} until the morning. No harm done: it was a surprise for the driver.',
    ],
    place: { name: 'Carriage', noun: 'carriage', pos: 'was in the {x}', neg: 'was not in the {x}', items: ['Dining Car', 'Observation Deck', 'Baggage Van', 'Lounge Car', 'Galley', 'Corridor', 'Sleeper Berth', 'Vestibule'] },
    object: { name: 'Belonging', noun: 'belonging', pos: 'had the {x}', neg: 'did not have the {x}', items: ['Hat Box', 'Thermos', 'Crossword', 'Knitting Bag', 'Pocket Torch', 'Travel Clock', 'Map Case', 'Wool Blanket'] },
    extra: { name: 'Destination', noun: 'destination', pos: 'was going to {x}', neg: 'was not going to {x}', items: ['Ashby', 'Bramford', 'Calder', 'Dunmore', 'Elmstead', 'Fallowfield', 'Greystone', 'Hartwell'] },
    time: { start: 22 * 60, step: 30 },
  },
  {
    id: 'lighthouse', name: 'The Keeper\'s Logbook',
    setting: 'a storm-bound island inn beside a tall lighthouse, waves crashing below', mood: 'stormy, candlelit, wary',
    names: ['Arlo', 'Briony', 'Cedric', 'Dulcie', 'Edmund', 'Freya', 'Garrick', 'Hester', 'Ivo', 'Jessamy'],
    thing: 'the brass lamp key',
    titles: ['The Missing Lamp Key', 'A Storm at Gull Rock'],
    openings: [
      'A storm cut Gull Rock off from the mainland, and {n} {many} waited it out at the little inn below the lighthouse.',
      'The ferry could not cross in the gale, so {n} travelers spent the night at the inn on Gull Rock.',
    ],
    crime: 'At {time}, {thing} went missing, and the great lamp could not be wound.',
    log: 'The keeper writes in his logbook on every round, and he noted each guest once, each at a different time.',
    endings: [
      'The logbook settles it. At {time} {culprit} {where} with the {object}, and {thing} was found in their coat pocket. They only wanted a look at the lamp room.',
      'Only {culprit} was near the lamp at {time}, coming from the {place} with the {object}. {Thing} was back on its hook before the next ship passed.',
    ],
    place: { name: 'Spot', noun: 'spot', pos: 'was at the {x}', neg: 'was not at the {x}', items: ['Boathouse', 'Fireside', 'Lamp Stairs', 'Pantry', 'Porch', 'Reading Nook', 'Sea Wall', 'Workshop'] },
    object: { name: 'Item', noun: 'item', pos: 'held the {x}', neg: 'did not hold the {x}', items: ['Oil Lamp', 'Rope Coil', 'Spyglass', 'Tin Mug', 'Oilskin Hat', 'Sea Chart', 'Fiddle', 'Bucket'] },
    extra: { name: 'Boot', noun: 'boots', pos: 'wore the {x} boots', neg: 'did not wear the {x} boots', items: ['Black', 'Brown', 'Green', 'Grey', 'Navy', 'Red', 'White', 'Yellow'] },
    time: { start: 18 * 60, step: 60 },
  },
  {
    id: 'bakeoff', name: 'The Midnight Bake-Off',
    setting: 'a warm village bakery after closing, flour in the air and ovens glowing', mood: 'warm, busy, mischievous',
    names: ['Agatha', 'Barnaby', 'Celeste', 'Desmond', 'Eloise', 'Ferdinand', 'Ginevra', 'Horace', 'Imogen', 'Jolyon'],
    thing: 'the prize recipe card',
    titles: ['The Prize Recipe Puzzle', 'Flour on the Floor'],
    openings: [
      'The village held its first Midnight Bake-Off, and {n} bakers worked late into the night at Crumb & Kettle.',
      'Ovens hummed at Crumb & Kettle as {n} {many} raced to finish their bakes before the judges arrived.',
    ],
    crime: 'At {time}, {thing} was swiped from the judges\' table.',
    log: 'The oven timer sheet shows each baker once, when they set their timer, and no two at the same time.',
    endings: [
      'The timer sheet gives it away: {culprit} {where} at {time}, with the {object} in hand, when {thing} went missing. It turned up inside a mixing bowl, a little sticky but readable.',
      'At {time} only {culprit} was near the judges\' table, coming from the {place} with the {object}. {Thing} was returned with an apology and a fresh scone.',
    ],
    place: { name: 'Station', noun: 'station', pos: 'was at the {x}', neg: 'was not at the {x}', items: ['Bread Oven', 'Cooling Racks', 'Flour Bins', 'Front Counter', 'Icing Bench', 'Larder', 'Sink', 'Mixer'] },
    object: { name: 'Tool', noun: 'tool', pos: 'used the {x}', neg: 'did not use the {x}', items: ['Rolling Pin', 'Whisk', 'Piping Bag', 'Spatula', 'Sieve', 'Pastry Brush', 'Scales', 'Cake Tin'] },
    extra: { name: 'Bake', noun: 'bake', pos: 'baked the {x}', neg: 'did not bake the {x}', items: ['Babka', 'Brioche', 'Eclairs', 'Focaccia', 'Lemon Tart', 'Pretzels', 'Scones', 'Strudel'] },
    time: { start: 20 * 60, step: 30 },
  },
  {
    id: 'eclipse', name: 'The Eclipse Party',
    setting: 'a hilltop observatory under a clear night sky, telescopes pointed at the moon', mood: 'starry, quiet, curious',
    names: ['Alaric', 'Bryony', 'Cosmo', 'Daphne', 'Elio', 'Fern', 'Gulliver', 'Hazel', 'Iona', 'Jareth'],
    thing: 'the hand-drawn star chart',
    titles: ['The Star Chart Mystery', 'Shadows at the Observatory'],
    openings: [
      'On the night of the eclipse, {n} {many} climbed the hill to the old observatory to watch the moon turn red.',
      'The old observatory opened its dome for the eclipse, and {n} stargazers crowded in with blankets and flasks.',
    ],
    crime: 'At {time}, just as the moon went dark, {thing} was cut from its frame.',
    log: 'Everyone signed the visitor book once during the night, and each signature has its own time beside it.',
    endings: [
      'The visitor book points one way. {culprit} {where} at {time}, the moment {thing} was taken, with the {object} nearby. They had rolled it up to copy the stars at home and meant to bring it back.',
      'At {time}, while the moon was dark, only {culprit} was beside the frame, fresh from the {place} with the {object}. {Thing} was found safe in a telescope case.',
    ],
    place: { name: 'Spot', noun: 'spot', pos: 'was at the {x}', neg: 'was not at the {x}', items: ['Dome', 'Map Room', 'Roof Deck', 'Library', 'Cocoa Stand', 'Gift Shop', 'Lens Store', 'Stairwell'] },
    object: { name: 'Item', noun: 'item', pos: 'brought the {x}', neg: 'did not bring the {x}', items: ['Binoculars', 'Red Torch', 'Notebook', 'Flask', 'Picnic Rug', 'Star Wheel', 'Camera', 'Compass'] },
    extra: { name: 'Planet', noun: 'favorite planet', pos: 'loves {x}', neg: 'does not love {x}', items: ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'] },
    time: { start: 21 * 60, step: 30 },
  },
];

const SEATING_FRAMES = [
  {
    id: 'harvest', name: 'The Harvest Supper',
    setting: 'a round oak table in a farmhouse kitchen, set for a harvest supper by candlelight', mood: 'warm, golden, friendly',
    names: ['Alma', 'Boris', 'Cecily', 'Dexter', 'Esme', 'Fabian', 'Gilda', 'Hollis', 'Ingrid', 'Jules'],
    thing: 'a thank-you note tucked under a plate',
    titles: ['The Harvest Supper', 'A Note Under the Plate'],
    openings: [
      'After the last field was cut, {n} {many} gathered round the old oak table at Brookfield Farm for the harvest supper.',
      'The farmhouse kitchen smelled of bread and apples as {n} neighbors took their places round one round table.',
    ],
    incident: 'When the plates were cleared, someone found {thing} at {seat}, signed only with a drawing of a wheat sheaf.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The note was theirs: a thank-you to everyone who helped bring the harvest in.',
      'It was {winner} in {seat}. Between {left} and {right}, they had quietly written the note to thank the whole table for a good year.',
    ],
    seat: { name: 'Seat', noun: 'seat', pos: 'sat in {x}', neg: 'did not sit in {x}' },
    cats: [
      { id: 'dish', name: 'Dish', noun: 'dish', pos: 'brought the {x}', neg: 'did not bring the {x}', items: ['Apple Crumble', 'Corn Bread', 'Pumpkin Soup', 'Roast Squash', 'Bean Stew', 'Potato Bake', 'Berry Pie', 'Herb Salad'] },
      { id: 'drink', name: 'Drink', noun: 'drink', pos: 'poured {x}', neg: 'did not pour {x}', items: ['Cider', 'Cordial', 'Ginger Tea', 'Milk', 'Lemonade', 'Mint Tea', 'Plum Juice', 'Water'] },
      { id: 'job', name: 'Job', noun: 'job on the farm', pos: 'looks after the {x}', neg: 'does not look after the {x}', items: ['Barn', 'Beehives', 'Chickens', 'Garden', 'Goats', 'Orchard', 'Tractor', 'Well'] },
    ],
  },
  {
    id: 'reunion', name: 'The Class Reunion',
    setting: 'a round banquet table in a hotel ballroom with old school photos on the wall', mood: 'cheerful, nostalgic, chatty',
    names: ['Anouk', 'Bastian', 'Coralie', 'Dario', 'Elodie', 'Florian', 'Greer', 'Hamish', 'Ines', 'Joaquin'],
    thing: 'an unsigned speech card',
    titles: ['The Unsigned Speech', 'Ten Years On'],
    openings: [
      'Ten years after they left school, {n} old classmates met again round one round table in the Linden Hotel ballroom.',
      'The reunion committee set a single round table for {n} {many} who had not seen each other in years.',
    ],
    incident: 'Before dessert, a waiter found {thing} at {seat}: a funny, kind toast to the whole class, with no name on it.',
    endings: [
      '{winner} sat in {seat}, between {left} on their left and {right} on their right. They stood up, a little pink, and read the toast out loud.',
      'The card belonged to {winner} in {seat}. {left} and {right} cheered as they finally gave the speech.',
    ],
    seat: { name: 'Seat', noun: 'seat', pos: 'sat in {x}', neg: 'did not sit in {x}' },
    cats: [
      { id: 'career', name: 'Career', noun: 'job', pos: 'works as a {x}', neg: 'does not work as a {x}', items: ['Architect', 'Baker', 'Chemist', 'Dentist', 'Florist', 'Pilot', 'Teacher', 'Vet'] },
      { id: 'dessert', name: 'Dessert', noun: 'dessert', pos: 'ordered the {x}', neg: 'did not order the {x}', items: ['Cheesecake', 'Fruit Tart', 'Ice Cream', 'Mousse', 'Pavlova', 'Sorbet', 'Sponge Cake', 'Trifle'] },
      { id: 'club', name: 'School Club', noun: 'school club', pos: 'was in the {x} club', neg: 'was not in the {x} club', items: ['Art', 'Chess', 'Choir', 'Drama', 'Hiking', 'Robotics', 'Science', 'Yearbook'] },
    ],
  },
  {
    id: 'puzzlers', name: 'The Puzzle Society',
    setting: 'a round table in a wood-paneled club room, covered in puzzle books and teacups', mood: 'clever, cozy, quiet',
    names: ['Ambrose', 'Blythe', 'Crispin', 'Dagny', 'Eben', 'Fleur', 'Gaspard', 'Honora', 'Ike', 'Jocasta'],
    thing: 'a puzzle with every square already filled in',
    titles: ['The Finished Puzzle', 'Tea at the Puzzle Society'],
    openings: [
      'The Puzzle Society meets every Thursday, and tonight {n} {many} sat round their famous round table.',
      'Teacups clinked as {n} members of the Puzzle Society took their usual chairs round the round table.',
    ],
    incident: 'Halfway through the evening, the chair spotted {thing} at {seat}, solved in record time.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. They shrugged and said it was an easy one.',
      'The record-breaker was {winner}, in {seat}. {left} asked for a rematch, and {right} poured more tea.',
    ],
    seat: { name: 'Chair', noun: 'chair', pos: 'sat in {x}', neg: 'did not sit in {x}' },
    cats: [
      { id: 'tea', name: 'Tea', noun: 'tea', pos: 'drank {x}', neg: 'did not drink {x}', items: ['Assam', 'Chamomile', 'Darjeeling', 'Earl Grey', 'Green Tea', 'Jasmine', 'Peppermint', 'Rooibos'] },
      { id: 'puzzle', name: 'Favorite Puzzle', noun: 'favorite puzzle', pos: 'loves {x}', neg: 'does not love {x}', items: ['Anagrams', 'Cryptics', 'Jigsaws', 'Logic Grids', 'Mazes', 'Riddles', 'Tangrams', 'Word Search'] },
      { id: 'pen', name: 'Pen', noun: 'pen color', pos: 'writes in {x} ink', neg: 'does not write in {x} ink', items: ['Black', 'Blue', 'Brown', 'Green', 'Orange', 'Purple', 'Red', 'Silver'] },
    ],
  },
  {
    id: 'captain', name: 'The Captain\'s Table',
    setting: 'a round table in a ship\'s dining saloon, portholes showing a calm night sea', mood: 'grand, gently rocking, festive',
    names: ['Alastair', 'Belinda', 'Cyrus', 'Delia', 'Ewan', 'Faye', 'Gustav', 'Hilde', 'Ivor', 'Jemima'],
    thing: 'a small brass compass left beside a napkin',
    titles: ['The Captain\'s Table', 'The Brass Compass'],
    openings: [
      'On the last night of the voyage, {n} {many} were invited to dine at the captain\'s round table.',
      'The ship\'s band played softly as {n} passengers found their place cards round the captain\'s table.',
    ],
    incident: 'After the toast, the purser found {thing} at {seat}, engraved with the words "for the captain".',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The compass was their gift to the captain, who wore it proudly ashore.',
      'It was {winner}, in {seat}. {left} and {right} had no idea they had brought a present for the captain.',
    ],
    seat: { name: 'Seat', noun: 'seat', pos: 'sat in {x}', neg: 'did not sit in {x}' },
    cats: [
      { id: 'starter', name: 'Starter', noun: 'starter', pos: 'chose the {x}', neg: 'did not choose the {x}', items: ['Crab Cakes', 'Garden Salad', 'Melon', 'Mushroom Soup', 'Oysters', 'Pate', 'Prawn Cocktail', 'Tomato Tart'] },
      { id: 'cabin', name: 'Deck', noun: 'deck', pos: 'sleeps on the {x} Deck', neg: 'does not sleep on the {x} Deck', items: ['Aurora', 'Bay', 'Coral', 'Dolphin', 'Harbor', 'Lagoon', 'Mariner', 'Starlight'] },
      { id: 'pastime', name: 'Pastime', noun: 'pastime on board', pos: 'enjoyed {x}', neg: 'did not enjoy {x}', items: ['Dancing', 'Fishing', 'Painting', 'Quoits', 'Reading', 'Sketching', 'Stargazing', 'Swimming'] },
    ],
  },
];

export const LAB_FRAMES = { timeline: TIMELINE_FRAMES, seating: SEATING_FRAMES };

// ---------------------------------------------------------------------------
// Sizes and tiers. Each mode keeps every tier's grading (advanced steps,
// what-if chains, score), with its own clue types. The new clue types are
// reasoned at the advanced level, so Basic and Easy may use that level here
// (a Basic Timeline Case still only needs "read it and carry it").

const SIZES = {
  // [categories, items] per tier
  timeline: { basic: [4, 4], easy: [4, 4], medium: [4, 5], hard: [4, 5], expert: [5, 5], mensa: [5, 6], theorist: [5, 7] },
  seating: { basic: [3, 5], easy: [3, 6], medium: [4, 6], hard: [4, 6], expert: [4, 6], mensa: [5, 7], theorist: [5, 8] },
};
const LIMITS = { timeline: { categories: [4, 5], items: [4, 8] }, seating: { categories: [3, 5], items: [5, 8] } };

const WEIGHTS = {
  timeline: {
    basic: { is: 1.5, not: 3, neither: 1, less: 2, next: 3, first: 1.5, last: 1.5 },
    easy: { is: 1, not: 3, neither: 1.5, either: 1.5, less: 3, next: 3, between: 2, first: 1, last: 1 },
    medium: { is: 0.5, not: 3, neither: 1.5, either: 2, less: 3, next: 3, between: 2.5, diff: 1.5, first: 0.7, last: 0.7 },
    hard: { is: 0.3, not: 2.5, neither: 1.5, either: 2, pairs: 1, allDiff: 1, less: 3, next: 3, between: 2.5, diff: 2, first: 0.5, last: 0.5 },
    expert: { is: 0.2, not: 2.5, neither: 1.5, either: 2, pairs: 1.5, allDiff: 1, less: 3, next: 3, between: 2.5, diff: 2, first: 0.4, last: 0.4, ifthen: 1.2 },
    mensa: { is: 0.1, not: 2, neither: 1.5, either: 2, pairs: 2, allDiff: 1, less: 3, next: 3, between: 3, diff: 2.5, first: 0.3, last: 0.3, ifthen: 1.5 },
    theorist: { is: 0.1, not: 1.5, neither: 1.5, either: 2, pairs: 2, allDiff: 1, less: 3, next: 3, between: 3, diff: 3, first: 0.2, last: 0.2, ifthen: 2 },
  },
  seating: {
    basic: { is: 2, not: 3, neither: 1, nextTo: 3, across: 2, notNext: 1 },
    easy: { is: 1.5, not: 3, neither: 1.5, either: 1.5, nextTo: 3, across: 2, left2: 2, notNext: 1.5 },
    medium: { is: 0.7, not: 3, neither: 1.5, either: 2, nextTo: 3, across: 2, left2: 2.5, notNext: 2 },
    hard: { is: 0.4, not: 2.5, neither: 1.5, either: 2, pairs: 1, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2 },
    expert: { is: 0.3, not: 2.5, neither: 1.5, either: 2, pairs: 1.5, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2, ifthen: 1 },
    mensa: { is: 0.2, not: 2, neither: 1.5, either: 2, pairs: 2, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2.5, ifthen: 1.5 },
    theorist: { is: 0.1, not: 1.5, neither: 1.5, either: 2, pairs: 2, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2.5, ifthen: 2 },
  },
};
// Types tried for removal first go first; the mode's own clue types last, so
// they are the ones kept.
const REMOVE_FIRST = {
  timeline: ['is', 'not', 'neither', 'allDiff', 'either', 'pairs', 'ifthen', 'first', 'last', 'less', 'diff', 'between', 'next'],
  seating: ['is', 'not', 'neither', 'allDiff', 'either', 'pairs', 'ifthen', 'notNext', 'across', 'nextTo', 'left2'],
};

export function modeTier(mode, tierId) {
  const base = TIERS[tierId] || TIERS.easy;
  const size = SIZES[mode][base.id];
  return {
    ...base,
    summary: `${LAB_MODES[mode].name} (Lab), ${base.name}: ${LAB_MODES[mode].summary}`,
    categories: [size[0], size[0]], items: [size[1], size[1]], defaultSize: size,
    weights: { ...WEIGHTS[mode][base.id] },
    maxLevel: Math.max(2, base.maxLevel),
    removeFirst: REMOVE_FIRST[mode],
  };
}

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

// generator.js resolveOptions hands a lab-mode request here. Returns the same
// shape of options the generator uses, with the mode's tier, world and story.
export function resolveModeOptions(opts) {
  const mode = opts.mode;
  const seed = opts.seed != null ? String(opts.seed) : Math.floor(Math.random() * 2 ** 32).toString(36);
  const tier = modeTier(mode, opts.difficulty);
  const rng = makeRng(`${seed}|lab-${mode}|${tier.id}|${opts.topic || ''}|${opts.categories || ''}x${opts.items || ''}`);
  const frames = LAB_FRAMES[mode];
  const frame = frames.find((f) => f.id === opts.topic) || rng.pick(frames);
  const K = clamp(opts.categories || tier.defaultSize[0], LIMITS[mode].categories);
  const N = clamp(opts.items || tier.defaultSize[1], LIMITS[mode].items);
  const customSize = K !== tier.defaultSize[0] || N !== tier.defaultSize[1];
  let weights = { ...tier.weights };
  if (Array.isArray(opts.clueTypes) && opts.clueTypes.length) {
    const want = Object.fromEntries(opts.clueTypes.filter((t) => t in tier.weights).map((t) => [t, tier.weights[t]]));
    if (Object.keys(want).length) weights = want;
  }
  if (mode === 'seating' && N % 2) delete weights.across;
  const learn = opts.learning || {};
  const effort = clamp(Number(learn.effort) || 0, [-1, 1]);
  const themeId = mode === 'timeline' ? 'mystery' : 'occasion';
  const theme = { id: themeId, name: `${LAB_MODES[mode].name} (Lab)` };
  const topic = { id: frame.id, name: frame.name, description: LAB_MODES[mode].summary };
  const cast = mode === 'timeline' ? { one: 'suspect', many: 'suspects' } : { one: 'guest', many: 'guests' };
  const scenario = {
    theme, topic, cast, names: frame.names, art: { setting: frame.setting, mood: frame.mood },
    // finalize() asks the scenario for its story when it has its own writer.
    modeStory: (args) => (mode === 'timeline' ? timelineStory : seatingStory)({ ...args, frame, usedStories: opts.usedStories || [], mode }),
  };
  return {
    mode, frame, tier, seed, rng, theme, topic, scenario, K, N, customSize, weights,
    clueCount: opts.clueCount ? Math.max(1, Math.floor(opts.clueCount)) : null,
    questions: clamp(opts.questions ?? 3, [1, 6]), effort,
    customNames: opts.customNames, customTitle: opts.title, usedStories: opts.usedStories || [],
    timeLimitMs: opts.timeLimitMs ?? tier.timeLimitMs ?? 15000, maxAttempts: opts.maxAttempts ?? 60,
  };
}

const timeGap = (step) => (s) => {
  const m = s * step;
  return m % 60 === 0 ? plural(m / 60, 'hour', 'hours') : plural(m, 'minute', 'minutes');
};

// The model (categories and items) for one attempt; generator.js buildModel
// hands lab-mode options here.
export function buildModeModel(o) {
  const { rng, frame, K, N, mode } = o;
  let names = Array.isArray(o.customNames) ? [...new Set(o.customNames.map((s) => String(s).trim()).filter(Boolean))] : [];
  if (names.length < N) names = names.concat(rng.sample(frame.names.filter((n) => !names.includes(n)), N - names.length));
  else names = names.slice(0, N);
  names = orderItems(names);
  const cast = o.scenario.cast;
  const cats = [{ id: 'name', name: cap(cast.one), labels: names, pos: 'is {x}', neg: 'is not {x}', ordinal: null }];
  const named = (id, c) => ({ id, name: c.name, noun: c.noun, note: c.note, labels: orderItems(rng.sample(c.items, N)), pos: c.pos, neg: c.neg, ordinal: null });
  let clueCtx;
  if (mode === 'timeline') {
    cats.push(named('place', frame.place), named('object', frame.object));
    if (K >= 5) cats.push(named('extra', frame.extra));
    const { start, step } = frame.time;
    const values = Array.from({ length: N }, (_, i) => i * step);
    const gap = timeGap(step);
    cats.push({
      id: 'time', name: 'Time', noun: 'time in the log', labels: values.map(clock(start)), values,
      pos: 'was seen at {x}', neg: 'was not seen at {x}',
      note: `${frame.log} The times run from {low} to {high}, ${gap(1)} apart.`,
      ordinal: {
        less: 'was seen earlier than', more: 'was seen later than',
        lessBy: 'was seen {d} before', moreBy: 'was seen {d} after',
        gaps: Array.from({ length: N }, (_, d) => (d ? gap(d) : '')),
        next: 'was seen right after', prev: 'was seen right before',
        betweenA: 'was seen after', betweenB: 'but before',
        first: `was the first ${cast.one} in the log`, last: `was the last ${cast.one} in the log`,
      },
    });
    clueCtx = { time: cats.length - 1 };
  } else {
    for (const c of rng.shuffle(frame.cats).slice(0, K - 2)) cats.push(named(c.id, c));
    const s = frame.seat;
    const across = N % 2 === 0 ? ' "Directly across" means exactly halfway round the table.' : '';
    cats.push({
      id: 'seat', name: s.name, noun: s.noun, labels: Array.from({ length: N }, (_, i) => `${s.name} ${i + 1}`), values: Array.from({ length: N }, (_, i) => i + 1),
      pos: s.pos, neg: s.neg,
      note: `The ${N} ${s.name.toLowerCase()}s are numbered clockwise round one round table, so {high} is next to {low}. Everyone faces the middle, so the ${s.name.toLowerCase()} on a {one}'s left is the next one clockwise.${across}`,
      ordinal: {
        ring: true,
        nextTo: 'sat next to', across: 'sat directly across from', left2: `sat two ${s.name.toLowerCase()}s to the left of`, notNext: 'did not sit next to',
      },
    });
    clueCtx = { ring: cats.length - 1 };
  }
  const goalCat = cats.length - 1; // the crime's time, or the seat where the note was left
  return { K: cats.length, N, cats, cast, goal: { cat: goalCat }, ordinals: mode === 'timeline' ? [goalCat] : [], clueCtx };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const capFirst = (t) => t.replace(/(^\W*|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());

// Opening and ending choices not used before on this device, if any are left.
function pickParts(rng, frame, key, usedStories) {
  const used = new Set(usedStories);
  const combos = [];
  for (let t = 0; t < frame.titles.length; t++)
    for (let op = 0; op < frame.openings.length; op++)
      for (let e = 0; e < frame.endings.length; e++) combos.push({ t, o: op, e, id: `${key}|t${t}|o${op}|e${e}` });
  const fresh = combos.filter((c) => !used.has(c.id));
  return rng.pick(fresh.length ? fresh : combos);
}

function storyShell({ frame, mode, model, scene, goalLine, ending, pick, goalQuestion, winnerEntity, customTitle }) {
  const { cats } = model;
  const cast = model.cast;
  const names = cats[0].labels;
  const castLine = `The ${cast.many} are ${joinList(names)}.`;
  const task = `Use the clues to match each ${cast.one} with their ${joinList(cats.slice(1).map((c) => c.name.toLowerCase()))}.`;
  const notes = cats.slice(1).filter((c) => c.note).map((c) => capFirst(fill(c.note, { one: cast.one, many: cast.many, low: c.labels[0], high: c.labels.at(-1) })));
  let paragraphs = [scene, castLine, task, goalLine];
  const wordCount = countWords(paragraphs.join(' '));
  paragraphs = [...paragraphs.slice(0, -1), notes.join(' '), paragraphs.at(-1)];
  return {
    id: pick.id,
    title: customTitle || frame.titles[pick.t],
    paragraphs, text: paragraphs.join('\n\n'),
    goalQuestion, goalAnswer: { cat: 0, item: winnerEntity }, ending, notes, wordCount,
    parts: { t: String(pick.t), o: String(pick.o), e: String(pick.e), mode },
  };
}

function timelineStory({ rng, goal, model, L, customTitle, frame, usedStories, mode }) {
  const { N, cats, sol } = model;
  const pick = pickParts(rng, frame, `lab-timeline/${frame.id}`, usedStories);
  const tc = model.goal.cat;
  const e = sol[tc].indexOf(goal.item);
  const time = cats[tc].labels[goal.item];
  const of = (id) => { const c = cats.findIndex((x) => x.id === id); return c < 0 ? '' : cats[c].labels[sol[c][e]]; };
  const vars = { n: NUMBER_WORDS[N], many: model.cast.many, one: model.cast.one, time, thing: frame.thing, Thing: cap(frame.thing),
    culprit: cats[0].labels[e], place: of('place'), object: of('object'), extra: of('extra'),
    where: L.pos(cats.findIndex((x) => x.id === 'place') * N + sol[cats.findIndex((x) => x.id === 'place')][e]) };
  const scene = [frame.openings[pick.o], frame.crime].map((t) => capFirst(fill(t, vars))).join(' ');
  const goalLine = `Whoever was seen at ${time} is the one who took ${frame.thing}. Can you work out who it was, and where they were?`;
  return storyShell({ frame, mode, model, scene, goalLine, ending: capFirst(fill(frame.endings[pick.e], vars)), pick,
    goalQuestion: `Who ${L.pos(tc * N + goal.item)}?`, winnerEntity: e, customTitle });
}

function seatingStory({ rng, goal, model, L, customTitle, frame, usedStories, mode }) {
  const { N, cats, sol } = model;
  const pick = pickParts(rng, frame, `lab-seating/${frame.id}`, usedStories);
  const sc = model.goal.cat;
  const at = (v) => cats[0].labels[sol[sc].indexOf(((v % N) + N) % N)];
  const e = sol[sc].indexOf(goal.item);
  const seat = cats[sc].labels[goal.item];
  // Facing the middle, a guest's left is the next seat clockwise.
  const vars = { n: NUMBER_WORDS[N], many: model.cast.many, one: model.cast.one, seat, thing: frame.thing,
    winner: cats[0].labels[e], left: at(goal.item + 1), right: at(goal.item - 1), across: N % 2 ? '' : at(goal.item + N / 2) };
  const scene = [frame.openings[pick.o], frame.incident].map((t) => capFirst(fill(t, vars))).join(' ');
  const goalLine = `Whoever sat in ${seat} left ${frame.thing}. Can you work out who sat where?`;
  return storyShell({ frame, mode, model, scene, goalLine, ending: capFirst(fill(frame.endings[pick.e], vars)), pick,
    goalQuestion: `Who ${L.pos(sc * N + goal.item)}?`, winnerEntity: e, customTitle });
}
