// Whether a character is a woman or a man. The portrait and the voice both ask
// here, so a character never looks like one and sounds like the other.
// Every name in every theme and topic is listed (scripts/test-gender.mjs
// checks); names a player types in get a steady guess from how they end.
const FEMALE = new Set(`
  Ada Clara Edith Greta Iris
  Dash Echo Ivy
  Amara Cora Elsa Gemma Isla
  Annie Carly Ella Gwen
  Alice Chloe Emma Hannah Julia
  Brynn Delphine Elowen Hazel Isolde Juniper
  Astra Electra Gaia Helix Juno
  Bella Dina Fatima Holly Jada
  Bea Dolores Freya Harriet Indira
  Abby Cassie Eva Grace
  Comet Nova Spark Zephyr
  Anne Esme Morgan
  Bluebell Clover Dewdrop Fern
  Brienne Elaine Rowena
  Lena Marta Nadia Opal Paige
  Willa Tessa Rosa Nell Maren
  Bianca Daphne Leila Mina Rhea
  Celeste Flora Imani Noor Vera
`.trim().split(/\s+/));
const MALE = new Set(`
  Basil Dorian Felix Hugo Jasper
  Ace Blaze Cobra Falcon Ghost Hawk Jett
  Bruno Diego Finn Hector Jonah
  Ben Danny Frank Henry Jack
  Brian David George Isaac Kevin
  Alaric Cassius Fenwick Galen
  Bix Cosmo Dax Flux Ion
  Andre Carlos Eli Grant Ivan
  Antonio Chen Emile Gus Jules
  Bo Dylan Fred Harry Josh
  Frost Quake Titan Vortex
  Barnaby Calico Drake Flint Hook Jonas
  Moss Pip Thistle
  Arthur Cedric Gareth Lancel Percival Tristan
  Owen Rafael Simon Theo Wade
  Cody Reed Wyatt Abel Gideon
  Arlo Enzo Kai Milo Omar
  Ezra Hugh Leon Nico Soren
`.trim().split(/\s+/));

export const KNOWN_NAMES = new Set([...FEMALE, ...MALE]);

function hashOf(text) { let h = 7; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// The game's own characters (cast.js) say which they are; set for the open puzzle.
let chosen = new Map();
export function setChosenGenders(characters = []) { chosen = new Map(characters.map((c) => [c.name, c.gender])); }

// 'f' or 'm', always the same for the same name.
export function genderOf(name) {
  if (chosen.has(String(name || '').trim())) return chosen.get(String(name).trim());
  const first = String(name || '').trim().split(/\s+/)[0];
  const cap = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  if (FEMALE.has(cap)) return 'f';
  if (MALE.has(cap)) return 'm';
  const n = cap.toLowerCase();
  if (/(a|ah|ia|ie|ine|elle|ette|een|lyn|lynn|ee|ey|i)$/.test(n)) return 'f';
  if (/(o|us|er|on|an|ck|ld|rd|rt|ph|th|am|el|in|im|ob|ed)$/.test(n)) return 'm';
  return hashOf(n) % 2 ? 'f' : 'm';
}
