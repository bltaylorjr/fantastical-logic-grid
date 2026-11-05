// Theme sets for the Crossword game (crossword.js). Each set is a short list
// of everyday words that all truly belong to one group, so a puzzle note such
// as "each starred answer hides a farm animal" is always right. The engine
// finds dictionary phrases that hide, start with or end with these words; the
// tests check every word is a real answer in crossword-words.js.
//
// themes: the story themes (themes.js) whose puzzles may use this set, so a
// Farm Life story gets farm animals, a Music story gets instruments.
//
// kinds the set suits:
//   hidden  the word is spelled across the break between two words of the
//           answer (circled): fARM ANimal... e.g. "CHAMP AGNE"
//   starts  the answer's first word is one of the words (RED TAPE)
//   ends    the answer's last word is one of the words (COUCH POTATO)
export const THEME_SETS = [
  { id: 'farm', one: 'farm animal', many: 'farm animals', kinds: ['hidden', 'ends'],
    themes: ['farm', 'pets', 'seasons'],
    words: ['cow', 'pig', 'hen', 'ram', 'ewe', 'goat', 'horse', 'sheep', 'duck', 'mule', 'lamb', 'colt', 'mare', 'sow', 'boar', 'bull', 'calf', 'goose', 'llama', 'pony', 'foal', 'steer', 'rooster', 'chick', 'turkey', 'donkey', 'ox'] },
  { id: 'birds', one: 'bird', many: 'birds', kinds: ['hidden', 'ends', 'starts'],
    themes: ['parks', 'biology', 'farm', 'seasons', 'pets'],
    words: ['owl', 'emu', 'hen', 'wren', 'crow', 'lark', 'tern', 'swan', 'dove', 'kite', 'rook', 'finch', 'robin', 'raven', 'eagle', 'heron', 'stork', 'crane', 'egret', 'teal', 'jay', 'gull', 'hawk', 'kiwi', 'loon', 'ibis', 'rhea', 'parrot', 'pigeon', 'sparrow', 'swift', 'martin', 'canary', 'falcon', 'turkey', 'duck', 'goose'] },
  { id: 'fish', one: 'fish', many: 'fish', kinds: ['hidden', 'ends'],
    themes: ['nautical', 'cooking', 'biology'],
    words: ['eel', 'cod', 'carp', 'bass', 'sole', 'tuna', 'trout', 'perch', 'pike', 'ray', 'shad', 'ling', 'hake', 'salmon', 'smelt', 'shark', 'herring', 'mackerel', 'snapper', 'minnow', 'guppy', 'haddock', 'tarpon', 'marlin', 'halibut', 'sardine', 'anchovy', 'flounder'] },
  { id: 'colors', one: 'color', many: 'colors', kinds: ['starts', 'hidden'],
    themes: ['holiday', 'occasion', 'paradox', 'seasons', 'wonders'],
    words: ['red', 'tan', 'blue', 'gold', 'gray', 'pink', 'teal', 'navy', 'lime', 'plum', 'rust', 'amber', 'ivory', 'coral', 'olive', 'green', 'white', 'black', 'brown', 'peach', 'cyan', 'mauve', 'beige', 'khaki', 'indigo', 'violet', 'orange', 'yellow', 'purple', 'silver', 'maroon', 'scarlet', 'crimson'] },
  { id: 'metals', one: 'metal', many: 'metals', kinds: ['hidden', 'starts'],
    themes: ['science', 'wonders', 'action'],
    words: ['tin', 'iron', 'gold', 'lead', 'zinc', 'steel', 'brass', 'copper', 'nickel', 'silver', 'bronze', 'cobalt', 'chrome', 'pewter', 'platinum', 'titanium'] },
  { id: 'gems', one: 'gem', many: 'gems', kinds: ['hidden'],
    themes: ['mystery', 'action', 'fantasy', 'wonders'],
    words: ['opal', 'ruby', 'jade', 'onyx', 'pearl', 'agate', 'beryl', 'topaz', 'garnet', 'amber', 'diamond', 'emerald', 'sapphire', 'jasper', 'quartz', 'zircon', 'amethyst'] },
  { id: 'body', one: 'body part', many: 'body parts', kinds: ['hidden', 'starts'],
    themes: ['biology', 'sports', 'science'],
    words: ['arm', 'leg', 'ear', 'eye', 'lip', 'hip', 'toe', 'shin', 'knee', 'chin', 'hand', 'foot', 'neck', 'nose', 'heel', 'palm', 'rib', 'jaw', 'thumb', 'elbow', 'wrist', 'ankle', 'brow', 'cheek', 'thigh', 'chest', 'heart', 'lung', 'liver', 'spine', 'skull'] },
  { id: 'trees', one: 'tree', many: 'trees', kinds: ['hidden', 'ends'],
    themes: ['parks', 'seasons', 'farm', 'adventure'],
    words: ['oak', 'ash', 'elm', 'fir', 'yew', 'pine', 'palm', 'teak', 'beech', 'birch', 'maple', 'cedar', 'larch', 'alder', 'aspen', 'rowan', 'holly', 'spruce', 'willow', 'poplar', 'walnut', 'cherry', 'cypress', 'sequoia'] },
  { id: 'instruments', one: 'musical instrument', many: 'musical instruments', kinds: ['hidden', 'starts'],
    themes: ['music', 'occasion', 'holiday'],
    words: ['oboe', 'tuba', 'harp', 'horn', 'lute', 'drum', 'organ', 'piano', 'cello', 'flute', 'banjo', 'bugle', 'viola', 'sitar', 'fife', 'gong', 'lyre', 'violin', 'guitar', 'bassoon', 'trumpet', 'clarinet', 'trombone', 'cymbal', 'fiddle'] },
  { id: 'fruits', one: 'fruit', many: 'fruits', kinds: ['hidden', 'starts'],
    themes: ['cooking', 'farm', 'seasons', 'occasion'],
    words: ['fig', 'date', 'pear', 'lime', 'plum', 'kiwi', 'apple', 'lemon', 'mango', 'grape', 'melon', 'peach', 'guava', 'papaya', 'banana', 'cherry', 'orange', 'apricot', 'quince', 'olive'] },
  { id: 'vegetables', one: 'vegetable', many: 'vegetables', kinds: ['hidden', 'ends'],
    themes: ['cooking', 'farm', 'seasons'],
    words: ['pea', 'yam', 'kale', 'leek', 'corn', 'bean', 'okra', 'beet', 'chard', 'onion', 'potato', 'squash', 'carrot', 'radish', 'turnip', 'celery', 'pepper', 'tomato', 'lettuce', 'cabbage', 'spinach', 'parsnip', 'pumpkin'] },
  { id: 'weather', one: 'kind of weather', many: 'kinds of weather', kinds: ['hidden', 'starts'],
    themes: ['seasons', 'nautical', 'parks', 'adventure'],
    words: ['rain', 'snow', 'hail', 'wind', 'fog', 'sleet', 'mist', 'storm', 'gale', 'smog', 'frost', 'drizzle', 'thunder', 'blizzard', 'sunshine', 'haze'] },
  { id: 'sea', one: 'word from the sea', many: 'words from the sea', kinds: ['hidden', 'ends'],
    themes: ['nautical', 'travel', 'adventure'],
    words: ['bay', 'tide', 'wave', 'gulf', 'reef', 'port', 'ship', 'boat', 'sail', 'mast', 'keel', 'deck', 'oar', 'anchor', 'harbor', 'island', 'shore', 'coast', 'beach', 'ocean', 'lagoon', 'current'] },
  { id: 'space', one: 'space word', many: 'space words', kinds: ['hidden', 'starts', 'ends'],
    themes: ['astronomy', 'scifi', 'science'],
    words: ['sun', 'moon', 'star', 'mars', 'venus', 'earth', 'comet', 'nova', 'orbit', 'planet', 'galaxy', 'meteor', 'saturn', 'jupiter', 'nebula', 'rocket', 'eclipse', 'quasar', 'pulsar', 'asteroid'] },
  { id: 'sports', one: 'sport', many: 'sports', kinds: ['hidden', 'starts'],
    themes: ['sports', 'occasion', 'action'],
    words: ['golf', 'polo', 'judo', 'sumo', 'tennis', 'rugby', 'soccer', 'hockey', 'karate', 'boxing', 'diving', 'rowing', 'skiing', 'cricket', 'lacrosse', 'squash', 'track', 'bowling', 'fencing', 'archery', 'cycling', 'curling'] },
  { id: 'fantasy', one: 'fantasy creature', many: 'fantasy creatures', kinds: ['hidden', 'ends'],
    themes: ['fantasy', 'paradox', 'holiday'],
    words: ['elf', 'ogre', 'troll', 'gnome', 'giant', 'dragon', 'imp', 'pixie', 'dwarf', 'fairy', 'goblin', 'unicorn', 'griffin', 'phoenix', 'sprite', 'mermaid', 'centaur', 'genie', 'kraken'] },
  { id: 'clues', one: "detective's word", many: "detective's words", kinds: ['hidden', 'ends'],
    themes: ['mystery', 'action'],
    words: ['clue', 'alibi', 'motive', 'sleuth', 'suspect', 'witness', 'evidence', 'case', 'lead', 'proof', 'hunch', 'trail', 'print', 'tip', 'spy', 'agent', 'detective', 'mystery', 'secret', 'riddle'] },
  { id: 'math', one: 'math word', many: 'math words', kinds: ['hidden', 'ends', 'starts'],
    themes: ['math', 'science'],
    words: ['sum', 'add', 'odd', 'even', 'root', 'cube', 'sine', 'ratio', 'angle', 'prime', 'graph', 'digit', 'zero', 'line', 'point', 'plus', 'minus', 'square', 'circle', 'divide', 'factor', 'number', 'integer', 'fraction'] },
  { id: 'travel', one: 'travel word', many: 'travel words', kinds: ['hidden', 'ends'],
    themes: ['travel', 'adventure', 'town', 'wonders'],
    words: ['map', 'trip', 'tour', 'road', 'visa', 'hotel', 'inn', 'ticket', 'route', 'cruise', 'flight', 'luggage', 'suitcase', 'passport', 'journey', 'voyage', 'trek', 'train', 'plane', 'bus', 'taxi', 'car'] },
  { id: 'kitchen', one: 'kitchen word', many: 'kitchen words', kinds: ['hidden', 'starts', 'ends'],
    themes: ['cooking', 'holiday', 'occasion', 'town'],
    words: ['pie', 'stew', 'roast', 'bake', 'boil', 'grill', 'fry', 'dough', 'pan', 'pot', 'oven', 'stove', 'whisk', 'ladle', 'spoon', 'fork', 'knife', 'bowl', 'cake', 'bread', 'soup', 'salt', 'sugar', 'spice', 'butter'] },
  { id: 'pets', one: 'pet', many: 'pets', kinds: ['hidden', 'ends', 'starts'],
    themes: ['pets', 'town', 'occasion'],
    words: ['cat', 'dog', 'pup', 'kitten', 'puppy', 'rabbit', 'bunny', 'hamster', 'gerbil', 'ferret', 'parrot', 'canary', 'goldfish', 'turtle', 'pony', 'mouse', 'rat', 'newt', 'lizard', 'snake'] },
];

export const THEME_SET_IDS = THEME_SETS.map((s) => s.id);

// The notes shown above the clues: plain, and always true for the set and kind.
export function themeNote(set, kind) {
  const n = set.many;
  if (kind === 'hidden') return `The circled letters in each starred answer spell one of the ${n}, hidden across the gap between two words.`;
  if (kind === 'starts') return `Each starred answer begins with one of the ${n}.`;
  return `Each starred answer ends with one of the ${n}.`;
}
export function themeTitle(set, kind) {
  const n = set.many.replace(/^(words|kinds) /, (m) => m).replace(/\b\w/g, (c) => c.toUpperCase());
  if (kind === 'hidden') return `Hidden ${n}`;
  if (kind === 'starts') return `${n} First`;
  return `${n} Last`;
}
