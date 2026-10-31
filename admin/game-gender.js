// Whether a character is a woman or a man. The portrait and the voice both ask
// here, so a character never looks like one and sounds like the other.
// Every name in every theme and topic is listed (scripts/test-gender.mjs
// checks); names a player types in get a steady guess from how they end.
const FEMALE = new Set(`
  Ariel Clio Gigi Gracie Hope Inga Iona Harbor Cypress
  Addie Adelaide Adele Agna Agnes Aiko Alba Alina Alma Amelia Amelie Anika
  Anouk Ansley Anya Aoife Aria Asha Aspen Aster Astrid Avery Ayana Beatrice
  Beatrix Bellamy Beryl Bess Bettina Birdie Bisa Blair Blythe Bonnie Bree
  Briar Bridget Brigid Brook Bryn Bryony Calla Camila Carmen Casey Cass
  Cassidy Cecily Celia Ciara Cielo Clementine Cleo Coco Coral Cordelia Cosima
  Cricket Dagny Dahlia Daisy Dakota Dalia Dana Dara Darya Delia Della Dolly
  Dora Dorothea Dot Dottie Dove Ebony Eden Edie Effie Eileen Eldra Elin Elise
  Elodie Eloise Elsie Elva Ember Emi Emmy Emory Eshe Esmeralda Esperanza
  Esther Etta Eula Euphemia Evangeline Evelyn Evie Fable Farah Faye Fiona
  Flossie Frankie Freja Genevieve Gertie Gia Gilda Gilly Ginevra Ginger Ginny
  Gisele Giselle Goldie Gwendolyn Halle Hana Harper Hedda Helga Henrietta
  Hester Hex Hilde Honor Ida Ignatia Ilona Ilse Ilyra Imogen Indigo Ines Inez
  Iolana Ione Isadora Itzel Iva Jade Jana Jasmine Jemima Joelle Jolene Jordan
  Joy June Kailani Kari Kavya Kenzie Kesi Kiara Kira Laleh Lani Lark Lavinia
  Leah Leilani Leni Lin Lina Lirien Loretta Lorna Lucia Lula Lulu Maeve Magna
  Mali Malia Margo Margot Marisol Marla Maude Maya Meera Mei Min Minnie Mira
  Morwenna Myrtle Nalani Nia Niamh Noa Nola Nora Nyx Octavia Odessa Odile Ora
  Ottilie Patsy Pearl Perpetua Petra Pia Pippa Pua Quinn Reba Rosalind Rosetta
  Rosie Roxanne Ruby Ruth Sabine Sable Sela Shelby Sia Sigrid Skye Sora Soraya
  Suri Tara Tess Thalia Thora Tillie Tilly Vesna Vivienne Wanda Wen Winnie
  Wren Xena Yu Yuki Zelda Zoe Zola Zuri
  Elena Ingrid
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
  Lyra Odette Selena Tamsin Yara
  Greer Hattie Linnea Sloane Thea
  Mabel Josie Lottie Hedy Priya
  Coralie Marina Nerissa Ondine Delphina Serena Muriel Oceane
`.trim().split(/\s+/));
const MALE = new Set(`
  Archie Cliff Dag Eddy Ernest Fletcher Forrest Franco Grove Igor
  Aarav Abe Abner Akira Alder Alfie Alfredo Ambrose Amir Anders Ansel Anton
  Ari Arjun Asa Ash August Aurelio Avi Axel Ayo Bao Baraka Bastian Bastien
  Beau Benedict Benji Benny Bertram Beto Bixby Bjorn Blaise Blip Bodhi Bodie
  Borin Boris Bram Brendan Brody Brooks Buck Cal Calvin Cecil Chester Chidi
  Chike Cinder Clark Clint Cole Colm Colt Colton Cooper Corbin Corin Cormac
  Corwin Cove Cruz Cutler Cyprian Cyril Cyrus Dallas Dane Dante Darian Dario
  Darius Dashiell Dayo Declan Dell Delmar Dev Dewey Dex Dexter Dimitri Django
  Dmitri Doyle Drew Drift Duke Duncan Dune Earl Ebon Edgar Elliot Ellis Elm
  Elmer Emeric Emery Emil Emlyn Emmett Enrico Ernie Everett Ewan Fabian Faelan
  Faraji Farid Fausto Felipe Femi Fen Fergus Ferris Finley Finnick Fitz Fizz
  Florian Floyd Flynn Ford Freddie Frederick Fritz Gabe Gage Gale Garrett
  Garrick Gaspard Gavin Gil Gino Gio Gizmo Glen Grady Graham Grey Grim Gunnar
  Hal Hamish Hank Harlan Heath Henrik Hiro Hob Holden Hollis Homer Horace
  Horatio Humphrey Huxley Idris Iggy Ignatius Ikaika Ike Ilan Ilya Indy Inigo
  Ira Ishaan Ivo Jabari Jacques Jago Jamal Javi Jax Jed Jesse Jet Jin Joel
  Jory Joss Jude Julian Julius Jun Kaito Kasim Kasimir Kekoa Kenji Keoni Kip
  Kiran Kit Kito Kofi Korr Lan Lars Laszlo Leo Leopold Lorenzo Lowell Luca
  Lucian Lucius Luis Luther Lyle Lysander Magnus Makoa Malik Marlo Marlon
  Mateo Matthias Maverick Max Merle Micah Montague Nalu Ned Nikhil Nimeth
  Niran Nolan Oren Orrin Osric Otto Ozzie Pascal Pike Quentin Quill Rafe
  Rafferty Raj Raphael Reese Remy Ren Rex Rocco Rohan Rollie Rook Rowan Royce
  Rufus Rupert Rurik Sandy Sawyer Sven Sylas Tao Tariq Taro Tate Teddy Tendai
  Teo Tide Tito Toby Tuck Ulf Ulric Vael Viggo Virgil Vix Wei Wes Wiley Yuri
  Zale Zane Zuberi
  Desmond
  Amos Clem Otis Boone Ravi Sam Finnian
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
  Beckett Ronan Silas Tobias Wesley
  Angus Callum Murray Rory Tucker
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
