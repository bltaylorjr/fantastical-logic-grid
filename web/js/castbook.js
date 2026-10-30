// The game's full cast: every built-in character has a personality, a voice
// that suits it and a face that shows it. The personality colors what they
// say: how they lead into a clue, what they say when they saw nothing, their
// hint and their cheer when the puzzle is solved. A character is the same
// person in every theme they appear in. Names a player types get a steady
// personality from the name, so they sound and look the same every time.
//
// The lines never name a grid item or another character and never say
// anything about the answer (scripts/test-cast.mjs checks), so they only add
// color, never clues. No imports besides gender.js, so the voice, portrait
// and test code can all use it.
import { genderOf } from './gender.js';

// Voices: Gemini and Google Cloud Chirp 3 HD share these names (server
// voices); Kokoro voices run on the device. "voice:pace" sets a speaking
// pace. Device voices use rate and pitch.
export const PERSONALITIES = {
  cheerful: {
    label: 'Cheerful', about: 'sees the bright side of everything',
    gemini: { f: ['Autonoe', 'Laomedeia'], m: ['Puck', 'Achird'] },
    kokoro: { f: ['af_heart:1.05', 'af_nova:1.05'], m: ['am_puck:1.05', 'am_michael:1.04'] },
    device: { rate: 1.03, pitch: 1.08 },
    face: { lorelei: { mouth: ['happy01', 'happy03', 'happy06', 'happy09'] }, openPeeps: { face: ['smile', 'smileBig', 'lovingGrin1'] } },
    clue: ['Oh, this is the fun part:', 'Happy to help! Here goes:', 'What a lovely puzzle. I noticed this:', 'Good news, I remember this one:'],
    nothing: ["I didn't see a thing, but isn't it a lovely day?", 'Nothing from me, sorry! You are doing great, though.'],
    hint: ['Here is a little bit of help for you.', "Don't worry, we'll get there together!"],
    solve: ['Hooray! I knew you could do it!', 'That was wonderful. What a day!'],
  },
  grumpy: {
    label: 'Grumpy', about: 'grumbles a lot, but always tells the truth',
    gemini: { f: ['Gacrux', 'Kore'], m: ['Algenib', 'Alnilam'] },
    kokoro: { f: ['af_kore:0.92', 'af_sarah:0.92'], m: ['am_fenrir:0.9', 'bm_george:0.92'] },
    device: { rate: 0.92, pitch: 0.86 },
    face: { lorelei: { mouth: ['sad01', 'sad03', 'sad05'] }, openPeeps: { face: ['serious', 'tired', 'contempt'] } },
    clue: ['Fine. If you must know:', "I'll say this once:", 'Hmph. Write this down, then:', "Don't make me repeat it:"],
    nothing: ['I saw nothing. Now leave me be.', "Nothing. And I'd like my quiet back."],
    hint: ['Oh, all right. Look here.', "I suppose you'll want a nudge."],
    solve: ['Hmph. Not bad. Not bad at all.', 'About time. Well done, I suppose.'],
  },
  nervous: {
    label: 'Nervous', about: 'jumpy and a little flustered',
    gemini: { f: ['Leda', 'Zephyr'], m: ['Fenrir', 'Enceladus'] },
    kokoro: { f: ['af_nicole:1.12', 'af_bella:1.1'], m: ['am_puck:1.12', 'am_michael:1.1'] },
    device: { rate: 1.1, pitch: 1.05 },
    face: { lorelei: { mouth: ['sad02', 'sad04', 'happy12'] }, openPeeps: { face: ['concerned', 'concernedFear', 'hectic'] } },
    clue: ['Oh dear, oh dear. I think it was like this:', "I'm almost sure, um, that", 'Please, please believe me:', "I hope I've got this right:"],
    nothing: ["I d-didn't see anything! Honestly!", "Me? Nothing! I wasn't even looking!"],
    hint: ['Um, maybe, just maybe, look here?', "I'm not sure, but I'd try this."],
    solve: ['Oh, thank goodness! My nerves!', 'Phew! You did it! I can breathe again.'],
  },
  dramatic: {
    label: 'Dramatic', about: 'turns every moment into a grand scene',
    gemini: { f: ['Pulcherrima', 'Aoede'], m: ['Sadachbia', 'Orus'] },
    kokoro: { f: ['af_bella:0.96', 'bf_isabella:0.96'], m: ['am_fenrir:0.98', 'bm_fable:0.96'] },
    device: { rate: 0.95, pitch: 1.02 },
    face: { lorelei: { mouth: ['happy14', 'happy17', 'sad07'] }, openPeeps: { face: ['awe', 'explaining', 'driven'] } },
    clue: ['Gather close, for I shall reveal it:', 'Oh, how thrilling! Listen to this:', 'Mark my words, darling:', 'It was a moment I shall never forget:'],
    nothing: ['Alas! I saw nothing at all. The tragedy!', 'Nothing! Oh, the agony of it.'],
    hint: ['A surprise awaits, my friend. Behold!', 'The plot thickens. Look closer!'],
    solve: ['Magnificent! What a finale!', 'Encore! Encore! Simply marvelous!'],
  },
  scholarly: {
    label: 'Bookish', about: 'loves facts and precise details',
    gemini: { f: ['Erinome', 'Despina'], m: ['Sadaltager', 'Rasalgethi'] },
    kokoro: { f: ['bf_emma:0.98', 'af_sarah:1'], m: ['bm_george:1', 'am_michael:0.98'] },
    device: { rate: 0.97, pitch: 0.98 },
    face: { lorelei: { mouth: ['happy02', 'happy05'] }, openPeeps: { face: ['explaining', 'calm', 'solemn'] } },
    clue: ['According to my notes:', 'Precisely, and I quote:', 'The facts are quite plain:', 'I made a careful record:'],
    nothing: ['I have no reliable data, I am afraid.', 'My notes are empty on that, regrettably.'],
    hint: ['Consider the evidence carefully.', 'Logically, this is the next step.'],
    solve: ['A flawless deduction. Most impressive.', 'Quod erat demonstrandum. Well reasoned!'],
  },
  boastful: {
    label: 'Boastful', about: 'is sure they noticed it first',
    gemini: { f: ['Pulcherrima', 'Kore'], m: ['Alnilam', 'Puck'] },
    kokoro: { f: ['af_bella:1.04', 'af_kore:1.04'], m: ['am_fenrir:1.04', 'am_puck:1'] },
    device: { rate: 1, pitch: 0.95 },
    face: { lorelei: { mouth: ['happy07', 'happy10'] }, openPeeps: { face: ['cheeky', 'smileTeethGap', 'driven'] } },
    clue: ['Naturally, I noticed it straight away:', 'Nobody notices things like I do:', 'Trust me, I never miss a thing:', 'You are lucky I was there:'],
    nothing: ['I saw nothing, which means there was nothing to see.', 'Nothing. Even I need a day off.'],
    hint: ['Pay attention and learn from the best.', 'I would have seen this ages ago.'],
    solve: ['Not bad! Almost as fast as I would be.', 'A champion move. I taught you well.'],
  },
  dreamy: {
    label: 'Dreamy', about: 'drifts off in the middle of a thought',
    gemini: { f: ['Achernar', 'Aoede'], m: ['Enceladus', 'Umbriel'] },
    kokoro: { f: ['af_aoede:0.9', 'af_nicole:0.9'], m: ['am_michael:0.9', 'bm_fable:0.9'] },
    device: { rate: 0.88, pitch: 1.02 },
    face: { lorelei: { mouth: ['happy04', 'happy08'] }, openPeeps: { face: ['eyesClosed', 'calm', 'cute'] } },
    clue: ['Oh, I was just daydreaming, but', 'It comes back to me like a dream:', 'Hmm, the clouds were lovely, and', 'If I remember rightly, softly now:'],
    nothing: ['I was lost in thought, I think. I missed it.', 'Hmm? Oh, nothing. I was far away.'],
    hint: ['Let your mind wander over here.', 'Picture it, and look just there.'],
    solve: ['How lovely. It all fits together.', 'Like waking from a lovely dream. Well done.'],
  },
  blunt: {
    label: 'Blunt', about: 'says it plainly, no fuss',
    gemini: { f: ['Kore', 'Erinome'], m: ['Orus', 'Schedar'] },
    kokoro: { f: ['af_kore:1', 'af_sarah:1.04'], m: ['am_fenrir:1', 'am_michael:1.04'] },
    device: { rate: 1, pitch: 0.92 },
    face: { lorelei: { mouth: ['sad06', 'happy11'] }, openPeeps: { face: ['serious', 'blank', 'solemn'] } },
    clue: ['Plain and simple:', 'No fuss. Here it is:', 'Straight to the point:', 'Facts only:'],
    nothing: ['Saw nothing. Next.', 'Nothing to report.'],
    hint: ['Look here. Simple.', 'This one. Go.'],
    solve: ['Done. Good work.', 'Solved. Nicely handled.'],
  },
  gossipy: {
    label: 'Chatty', about: 'loves to share a bit of news',
    gemini: { f: ['Laomedeia', 'Callirrhoe'], m: ['Zubenelgenubi', 'Achird'] },
    kokoro: { f: ['af_heart:1.1', 'af_nova:1.1'], m: ['am_puck:1.08', 'am_michael:1.08'] },
    device: { rate: 1.08, pitch: 1.06 },
    face: { lorelei: { mouth: ['happy13', 'happy15'] }, openPeeps: { face: ['smileLOL', 'cheeky', 'explaining'] } },
    clue: ["Ooh, you'll never guess what I heard:", "Don't tell anyone I told you, but", 'Have you heard the latest?', 'Word around here is this:'],
    nothing: ['I heard nothing, and believe me, I was listening!', 'Not a peep! Can you imagine?'],
    hint: ['Psst! A little bird told me this.', 'Want to hear something juicy? Look here.'],
    solve: ['Wait until everyone hears about this!', 'Oh, this is the best news all week!'],
  },
  sly: {
    label: 'Sly', about: 'speaks in hints and winks',
    gemini: { f: ['Despina', 'Callirrhoe'], m: ['Algieba', 'Umbriel'] },
    kokoro: { f: ['af_nicole:0.95', 'bf_isabella:0.95'], m: ['bm_fable:0.95', 'am_michael:0.95'] },
    device: { rate: 0.94, pitch: 0.94 },
    face: { lorelei: { mouth: ['happy16', 'happy18'] }, openPeeps: { face: ['suspicious', 'cheeky', 'smile'] } },
    clue: ['Between you and me,', "I'll let you in on a little secret:", 'A wink and a nudge:', "You didn't hear it from me, but"],
    nothing: ['Me? I never see anything. Officially.', 'Nothing. Or so I say.'],
    hint: ['A clever eye would look right here.', 'Shh. Try this, and keep it quiet.'],
    solve: ['Clever, clever. I had a feeling you would.', 'Well, well. You are sharper than you look.'],
  },
  kind: {
    label: 'Kindly', about: 'gentle and reassuring',
    gemini: { f: ['Sulafat', 'Vindemiatrix'], m: ['Achird', 'Iapetus'] },
    kokoro: { f: ['af_heart:0.96', 'af_aoede:0.98'], m: ['am_michael:0.96', 'am_puck:0.96'] },
    device: { rate: 0.95, pitch: 1.02 },
    face: { lorelei: { mouth: ['happy01', 'happy05', 'happy09'] }, openPeeps: { face: ['smile', 'calm', 'cute'] } },
    clue: ['Take your time, dear. I saw this:', "I'm happy to share what I know:", 'This might help you:', 'Gently now, here is what I saw:'],
    nothing: ["I'm sorry, I didn't see anything. Can I get you some tea?", 'Nothing, I am afraid. But you are doing so well.'],
    hint: ['You are so close. Try here.', "There's no rush. This may help."],
    solve: ['Oh, well done! I am so proud of you.', 'Wonderful work. You should be proud.'],
  },
  brave: {
    label: 'Bold', about: 'fearless and full of energy',
    gemini: { f: ['Zephyr', 'Autonoe'], m: ['Fenrir', 'Sadachbia'] },
    kokoro: { f: ['af_bella:1.06', 'af_kore:1.06'], m: ['am_fenrir:1.08', 'am_puck:1.06'] },
    device: { rate: 1.04, pitch: 0.97 },
    face: { lorelei: { mouth: ['happy06', 'happy10'] }, openPeeps: { face: ['driven', 'smileBig', 'serious'] } },
    clue: ['Listen up, I faced it head on:', 'No fear! Here it is:', 'I stood right there and saw it:', 'Charge ahead with this:'],
    nothing: ['I was busy saving the day. I saw nothing.', 'Nothing! But I am ready for anything.'],
    hint: ['Onward! Strike here!', 'Be bold. This is the way forward.'],
    solve: ['Victory! We did it!', 'Ha! Nothing can stop us!'],
  },
  shy: {
    label: 'Shy', about: 'speaks softly, but notices everything',
    gemini: { f: ['Achernar', 'Vindemiatrix'], m: ['Enceladus', 'Schedar'] },
    kokoro: { f: ['af_nicole:0.94', 'af_aoede:0.94'], m: ['am_puck:0.94', 'am_michael:0.92'] },
    device: { rate: 0.93, pitch: 1.04 },
    face: { lorelei: { mouth: ['happy02', 'sad08'] }, openPeeps: { face: ['cute', 'eyesClosed', 'concerned'] } },
    clue: ['Um, if it helps, I noticed', "I don't usually say much, but", 'Quietly, I saw this:', "Sorry, it's small, but"],
    nothing: ['Oh, um, I didn\'t see anything. Sorry.', 'I... nothing. Sorry.'],
    hint: ['Maybe, um, here?', 'If you like, try this one.'],
    solve: ['Oh! You did it. That is really nice.', 'Wow. Um, well done.'],
  },
  silly: {
    label: 'Playful', about: 'jokes even at serious moments',
    gemini: { f: ['Leda', 'Laomedeia'], m: ['Puck', 'Zubenelgenubi'] },
    kokoro: { f: ['af_nova:1.1', 'af_heart:1.12'], m: ['am_puck:1.1', 'am_fenrir:1.1'] },
    device: { rate: 1.07, pitch: 1.12 },
    face: { lorelei: { mouth: ['happy03', 'happy15', 'happy17'] }, openPeeps: { face: ['smileLOL', 'smileTeethGap', 'lovingGrin2'] } },
    clue: ['Knock knock! Who is there? A clue!', 'Ready for a chuckle? Here goes:', 'No joke, this really happened:', 'Ta-da! Fresh clue coming up:'],
    nothing: ['I saw nothing, but I did hear a great joke.', 'Nada! Want to hear a joke instead?'],
    hint: ['Psst, the answer is tucked right here. Boo!', 'Tickle this part of the grid.'],
    solve: ['Woo-hoo! Time for a happy wiggle!', 'Ha! You cracked it wide open!'],
  },
  formal: {
    label: 'Proper', about: 'polite and very proper',
    gemini: { f: ['Gacrux', 'Erinome'], m: ['Rasalgethi', 'Iapetus'] },
    kokoro: { f: ['bf_emma:0.95', 'bf_isabella:0.98'], m: ['bm_george:0.95', 'bm_fable:0.98'] },
    device: { rate: 0.94, pitch: 0.96 },
    face: { lorelei: { mouth: ['happy02', 'happy11'] }, openPeeps: { face: ['calm', 'solemn', 'smile'] } },
    clue: ['If I may be so bold:', 'I must respectfully state that', 'For the record, if you please:', 'I am obliged to report this:'],
    nothing: ['I regret to say I observed nothing of note.', 'I have nothing to report, I am afraid.'],
    hint: ['Might I suggest this, if you please?', 'Do allow me to point you here.'],
    solve: ['Splendid. Most splendid indeed.', 'Jolly good show. Very well done.'],
  },
  curious: {
    label: 'Curious', about: 'asks questions about everything',
    gemini: { f: ['Autonoe', 'Leda'], m: ['Sadachbia', 'Iapetus'] },
    kokoro: { f: ['af_sarah:1.06', 'af_heart:1.04'], m: ['am_puck:1.04', 'am_fenrir:1.04'] },
    device: { rate: 1.04, pitch: 1.06 },
    face: { lorelei: { mouth: ['happy04', 'happy12'] }, openPeeps: { face: ['awe', 'explaining', 'smile'] } },
    clue: ['Ooh, interesting! I noticed this:', 'Did you know this? I found out that', 'I asked around, and', 'I just had to look closer:'],
    nothing: ['Nothing yet! But what did you see?', "I didn't see it. Why do you ask? Ooh, tell me!"],
    hint: ['What if you looked here?', 'I wonder what happens if you try this?'],
    solve: ['Amazing! How did you figure it out?', 'Wow! Can we do another one?'],
  },
};
export const PERSONALITY_IDS = Object.keys(PERSONALITIES);

// Every built-in character, by personality.
const CAST = {
  cheerful: 'Clara Diego Annie Julia Bella Bea Abby Owen Rosa Arlo Nico Comet Bluebell Sloane Ravi Horatio Drew Hana Elliot Gia Anya Dev Ayo Calvin Margot Ambrose Laleh Sable Zale Anders Agnes Gracie Forrest Cypress Marla Keoni Dario Rosetta Finnick Marlo Wanda Lorna Iggy Corin Dell Itzel Clark Bellamy Jet',
  grumpy: 'Basil Hawk Bruno Frank George Grant Dolores Fred Marta Gideon Frost Flint Moss Ronan Lottie Muriel Ellis Maverick Rupert Kito Beau Ishaan Ciara Dottie Octavia Beryl Soraya Ulric Emi Henrik Gino Inga Ginger Elm Reba Makoa Gaspard Alfredo Hollis Lani Tillie Royce Alfie Kasimir Halle Aurelio Ansley Gisele',
  nervous: 'Felix Jonah Brian Fenwick Flux Eli Cassie Mina Jonas Percival Wesley Otis Bertram Camila Django Dashiell Finley Rocco Leilani Bram Ida Kavya Declan Bonnie Raphael Corwin Tariq Cruz Fizz Brigid Hilde Jed Harlan Grove Clint Kekoa Lorenzo Enrico Cormac Maude Elsie Tuck Ozzie Mateo Idris Cyprian Glen Jacques',
  dramatic: 'Hugo Blaze Chloe Delphine Electra Carlos Antonio Rafael Bianca Vortex Hook Lancel Greer Boone Ignatius Odessa Rowan Skye Brody Ari Cal Meera Eileen Marlon Vivienne Ignatia Eldra Vesna Gizmo Colm Fritz Ansel Dune Cliff Kesi Ikaika Matthias Cecil Honor Cutler Dewey Ora Teddy Petra Dane Garrick Ford Ginevra',
  scholarly: 'Ada Elsa Isaac Galen Helix Chen Nadia Maren Imani Rowena Tamsin Tucker Delphina Florian Kiran Rafferty Wren Kaito Nalu Dex Emil Nikhil Maeve Winnie Agna Lysander Faelan Drift Alina Boris Blair Homer Jesse Ernest Nia Morwenna Raj Pascal Jemima Dorothea Minnie Floyd Lina Bettina Joelle Blythe Holden Julius',
  boastful: 'Jasper Ace Hector Jack Juno Andre Harry Wyatt Enzo Titan Drake Cedric Hattie Hedy Lavinia Evangeline Emery Mei Shelby Cleo Fiona Rohan Niamh Aria Nora Mira Ilyra Xena Effie Freja Fletcher Gigi Bjorn Hope Zola Rosie Lin Tito Bridget Ginny Lyle Luther Leo Fen Bodie Dove Joel',
  dreamy: 'Iris Isla Elowen Cosmo Willa Kai Celeste Zephyr Tristan Lyra Callum Marina Cordelia Dexter Cosima Dakota Frankie Ren Cyrus Eden Hiro Tara Bisa Carmen Quinn Osric Calla Yuri Hex Gunnar Abner Iona Clio Igor Jabari Tilly Ottilie Gavin Colton Hester Virgil Wiley Cole Dora Beto Emlyn Edgar Aster',
  blunt: 'Greta Falcon Gwen David Dax Dina Josh Wade Rhea Vera Quake Morgan Gareth Linnea Priya Fabian Bree Sora Tate Gio Ilse Bao Chike Dante Borin Perpetua Kit Nyx Kip Hedda Faye Jasmine Dag Sigrid Kofi Duncan Pia Pearl Dana Etta Ruby Myrtle Maya Gilda Ember Gilly Clementine Doyle',
  gossipy: 'Gemma Carly Emma Holly Harriet Lena Daphne Barnaby Yara Mabel Serena Amelia Bodhi Benedict Cooper Brooks Colt Taro Dara Dmitri Jana Jin Dayo Della Dagny Quill Lark Rex Gabe Dimitri Gil Jolene Elin Anton Tendai Ewan August Blaise Everett Abe Buck Chester Remy Jory Heath Inigo Cove Euphemia',
  sly: 'Dorian Cobra Cassius Jules Reed Ezra Calico Thistle Selena Rory Ondine Elena Eloise Harper Esmeralda Imogen Jordan Yuki Asha Indy Benji Lan Eshe Ernie Grim Sabine Rook Zelda Javi Ivo Cass Emmett Lars Jade Zuberi Fergus Laszlo Darius Ira Rufus Earl Orrin Emeric Leni Ilona Huxley Alba Gertie',
  kind: 'Ivy Ella Hannah Hazel Gaia Indira Eva Opal Abel Flora Fern Elaine Tobias Clem Montague Leopold Reese Kenji Baraka Amelie Aarav Min Femi Genevieve Helga Amir Lirien Vix Luis Kari Edie Adele Eddy Magnus Kailani Ned Viggo Evelyn Grady Lucius Nola Kira Margo Rafe Cricket Ferris Ebon Humphrey',
  brave: 'Dash Amara Brynn Astra Fatima Freya Tessa Leon Nova Anne Brienne Beckett Josie Finnian Marisol Rosalind Sawyer Aiko Ines Felipe Ilan Tao Jamal Hank Korr Darya Nimeth Delmar Celia Elise Flynn Astrid Gale Cyril Malia Cecily Lucia Frederick Aspen Elmer Merle Tess Sia Sela Bryony Hamish Hob Brook',
  shy: 'Ghost Isolde Ivan Nell Soren Dewdrop Thea Sam Desmond Avery Anouk Adelaide Birdie Ash Axel Akira Corbin Sandy Jude Hal Anika Wen Kiara Joy Magna Farid Oren Pike Bastian Farah Ike Ariel Alder Sven Otto Alma Mali Beatrix Lowell Bess Patsy Zane Zoe Teo Cielo Benny Fable Cinder',
  silly: 'Jett Finn Ben Kevin Bix Jada Gus Bo Theo Cody Milo Spark Clover Silas Amos Oceane Dallas Coral Chidi Jago Leah Yu Malik Ruth Rurik Inez Sylas Avi Evie Ilya Goldie Garrett Briar Ayana Nalani Odile Arjun Julian Nolan Rollie Eula Dot Luca Emory Darian Emmy Bixby Ebony',
  formal: 'Edith Henry Alice Alaric Emile Grace Simon Omar Hugh Arthur Odette Murray Nerissa Ingrid Fitz Quentin Jax Duke Dalia Esther Micah Aoife Zuri Wes Thora Bryn Thalia Blip Freddie Jun Coco Elodie Harbor Dolly Iolana Bastien Niran Dahlia Roxanne Lula Flossie Lulu Toby Asa Esperanza Daisy Ione Grey',
  curious: 'Echo Cora Danny Juniper Ion Dylan Paige Leila Noor Esme Pip Angus Coralie Henrietta Gwendolyn Casey Kenzie Delia Faraji Horace Noa Brendan Beatrice Lucian Ulf Kasim Vael Tide Giselle Archie Franco June Isadora Loretta Pua Suri Wei Joss Cassidy Addie Iva Pippa Max Gage Fausto Graham Elva Indigo',
};
const BY_NAME = new Map();
for (const [p, names] of Object.entries(CAST)) for (const n of names.split(' ')) BY_NAME.set(n, p);
export const CAST_NAMES = new Set(BY_NAME.keys());
// So no two characters in one cast share a server voice, these take another
// voice of the same kind (scripts/test-cast.mjs checks every cast).
const SERVER_VOICE = {
  Hazel: 'Sulafat', Dash: 'Zephyr', Falcon: 'Schedar', Cora: 'Leda', Hector: 'Fenrir', Ella: 'Sulafat',
  Henry: 'Rasalgethi', Jack: 'Fenrir', Jada: 'Leda', Harriet: 'Callirrhoe', Eva: 'Sulafat', Harry: 'Alnilam',
  Rosa: 'Laomedeia', Nell: 'Vindemiatrix', Gideon: 'Algenib', Milo: 'Zubenelgenubi', Nova: 'Zephyr',
  Quake: 'Schedar', Vortex: 'Sadachbia', Morgan: 'Kore', Bluebell: 'Laomedeia', Fern: 'Zephyr',
  Tristan: 'Umbriel', Hattie: 'Zephyr', Murray: 'Puck', Rory: 'Charon', Silas: 'Rasalgethi', Priya: 'Zephyr',
  Sam: 'Charon', Elena: 'Zephyr', Bruno: 'Charon', Camila: 'Kore', Leopold: 'Puck', Cooper: 'Puck',
  Brooks: 'Charon', Dallas: 'Charon', Taro: 'Puck', Elliot: 'Charon', Sandy: 'Puck', Nalu: 'Charon',
  Bea: 'Despina', Cyrus: 'Charon', Ines: 'Achernar', Asha: 'Zephyr', Faraji: 'Charon', Gio: 'Charon',
  Cassie: 'Kore', Hal: 'Charon', Jules: 'Alnilam', Anya: 'Leda', Leah: 'Zephyr', Rohan: 'Charon',
  Kavya: 'Kore', Meera: 'Leda', Yu: 'Zephyr', Min: 'Kore', Owen: 'Umbriel', Dayo: 'Charon', Calvin: 'Charon',
  Ruth: 'Zephyr', Joy: 'Kore', Nora: 'Zephyr', Agna: 'Zephyr', Korr: 'Charon', Ignatia: 'Zephyr',
  Laleh: 'Kore', Yuri: 'Puck', Oceane: 'Zephyr', Abby: 'Callirrhoe', Kai: 'Algieba', Felipe: 'Orus',
  Giselle: 'Zephyr', Josie: 'Callirrhoe', Hilde: 'Kore', Kevin: 'Charon', Beckett: 'Charon', Ravi: 'Puck',
  Axel: 'Fenrir', Abner: 'Puck', Gil: 'Charon', Flynn: 'Orus', Coco: 'Zephyr', Franco: 'Puck',
  Gigi: 'Callirrhoe', Brynn: 'Kore', Cypress: 'Zephyr', Daphne: 'Kore', Jade: 'Leda', Magnus: 'Puck',
  Marla: 'Zephyr', Agnes: 'Callirrhoe', Nalani: 'Zephyr', Morwenna: 'Kore', Dario: 'Charon', Viggo: 'Puck',
  Elise: 'Zephyr', Kit: 'Charon', Harlan: 'Charon', Opal: 'Kore', Alma: 'Aoede', Blaise: 'Charon',
  Enzo: 'Fenrir', Bram: 'Iapetus', Colton: 'Puck', Everett: 'Charon', Emery: 'Orus', Marlo: 'Charon',
  Lucius: 'Puck', Gemma: 'Callirrhoe', Pearl: 'Leda', Ned: 'Puck', Wanda: 'Zephyr', Addie: 'Zephyr',
  Wiley: 'Charon', Eli: 'Algieba', Dot: 'Kore', Leo: 'Charon', Bree: 'Autonoe', Jax: 'Orus', Maya: 'Kore',
  Toby: 'Charon', Luca: 'Fenrir', Avery: 'Despina', Skye: 'Zephyr', Mateo: 'Puck', Nadia: 'Achernar',
  Jory: 'Charon', Pia: 'Despina', Ember: 'Leda', Beto: 'Charon', Cielo: 'Zephyr', Dune: 'Charon',
  Marina: 'Laomedeia', Elm: 'Puck', Effie: 'Kore', Emlyn: 'Puck', Gilly: 'Zephyr', Gwendolyn: 'Zephyr',
  Eloise: 'Gacrux', Amara: 'Pulcherrima', Dev: 'Orus', Aria: 'Erinome', Basil: 'Rasalgethi', Ari: 'Fenrir',
  Faye: 'Gacrux', Colm: 'Charon', Freya: 'Vindemiatrix', Edgar: 'Fenrir', Cass: 'Zephyr', Dimitri: 'Charon',
  Bertram: 'Puck', Euphemia: 'Kore', Ebony: 'Aoede', Hollis: 'Fenrir',
};

// Kokoro voices that ship with the game. Others download once from the same
// place as the voice model; until they do (or offline) the stand-in speaks.
export const KOKORO_BUNDLED = new Set(['af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'am_michael', 'am_fenrir', 'am_puck']);
export const KOKORO_STAND_IN = { af_kore: 'af_bella', af_sarah: 'af_heart', af_nova: 'af_heart', bf_emma: 'af_nicole', bf_isabella: 'af_aoede', bm_george: 'am_michael', bm_fable: 'am_fenrir' };

function hashOf(text) { let h = 7; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
const firstName = (name) => {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

// Which personality a character has: their own for the built-in cast, a
// steady pick for any other name.
export function personalityOf(name) {
  const first = firstName(name);
  return BY_NAME.get(first) || PERSONALITY_IDS[hashOf(first.toLowerCase()) % PERSONALITY_IDS.length];
}

// Everything that makes a character themself.
export function profileOf(name) {
  const id = personalityOf(name);
  const p = PERSONALITIES[id];
  const own = BY_NAME.has(firstName(name)) && SERVER_VOICE[firstName(name)];
  const g = genderOf(name);
  const seed = hashOf(firstName(name));
  const pick = (list) => list[seed % list.length];
  const [kokoro, pace] = pick(p.kokoro[g]).split(':');
  return {
    name, gender: g, personality: id, label: p.label, about: p.about,
    voice: { gemini: own || pick(p.gemini[g]), kokoro, pace: Number(pace || 1), standIn: KOKORO_STAND_IN[kokoro] || kokoro, ...p.device },
    face: p.face,
  };
}

// One of the character's lines for a moment: 'clue' (said before a clue),
// 'nothing', 'hint' or 'solve'. The same n always gives the same line.
export function sayingOf(name, kind, n = 0) {
  const lines = PERSONALITIES[personalityOf(name)][kind] || [];
  return lines.length ? lines[(Math.abs(n) + hashOf(firstName(name))) % lines.length] : '';
}

// How a character acts while they speak (talking-face.js and the voice's
// tone, ai.js). Each personality has its own way of telling a clue; some
// moments change it: a cheer is excited, and a culprit caught at the end of
// a mystery is sheepish.
export const MOODS = ['calm', 'cheerful', 'excited', 'nervous', 'guilty', 'sly', 'grumpy', 'proud', 'kind', 'shy',
  'dreamy', 'formal', 'dramatic', 'playful', 'curious', 'blunt', 'chatty', 'bookish', 'bold'];
const MOOD_OF = {
  cheerful: 'cheerful', grumpy: 'grumpy', nervous: 'nervous', dramatic: 'dramatic', scholarly: 'bookish', boastful: 'proud',
  dreamy: 'dreamy', blunt: 'blunt', gossipy: 'chatty', sly: 'sly', kind: 'kind', brave: 'bold', shy: 'shy', silly: 'playful',
  formal: 'formal', curious: 'curious',
};
// How a mood changes a voice: its pace (Kokoro and device voices) and pitch
// (device voices). The natural voice is told the mood in words instead.
export const MOOD_PACE = { nervous: 1.08, excited: 1.08, chatty: 1.05, guilty: 0.94, shy: 0.95, dreamy: 0.92, grumpy: 0.96, sly: 0.96 };
export const MOOD_PITCH = { nervous: 1.08, excited: 1.1, cheerful: 1.05, guilty: 0.94, grumpy: 0.92, shy: 1.04 };
export const moodPace = (pace, mood) => (MOOD_PACE[mood] ? Math.round(Math.min(1.25, Math.max(0.75, pace * MOOD_PACE[mood])) * 100) / 100 : pace);
export const moodOf = (name) => MOOD_OF[personalityOf(name)] || 'calm';

// Said by the one behind it all when a mystery is solved. Like every line,
// they never name anyone or anything in the grid.
const CAUGHT = [
  'All right, all right. It was me.',
  'You got me. I should have known you would work it out.',
  'Oh dear. I suppose the game is up.',
  'Fine, I confess. I only meant to borrow it.',
];
export const caughtLine = (name, n = 0) => CAUGHT[(Math.abs(n) + hashOf(firstName(name))) % CAUGHT.length];
// The same for one of the game's own characters (cast.js), whose personality
// is written in words in the admin dashboard: the first mood or personality
// it mentions, such as "a nervous baker" or "grumpy but fair".
export function moodOfPersonality(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  for (const w of words) {
    if (MOOD_OF[w]) return MOOD_OF[w];
    if (MOODS.includes(w)) return w;
  }
  return 'calm';
}
