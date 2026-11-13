// Lab mode stories: the words for Timeline Case and Seating Plan puzzles
// (engine/src/modes.js builds the puzzles; this file is only words).
// All of it is original writing for the game, and all of it is meant to be
// rewritten or added to by hand.
//
// HOW IT FITS TOGETHER
//   The player picks a theme on the setup screen. A Lab puzzle then takes its
//   cast (the theme's names and cast word, like "athlete") and its categories
//   from that theme (themes.js), and its story from the entry below with the
//   same theme id. A theme with no entry here (or an entry that names a
//   category the theme does not have) still works: it falls back to one of
//   the stand-alone stories at the bottom of this file, and the puzzle says so
//   in a note. The tests (test/mode-tests.js) check every entry.
//
// HOW TO WRITE A TIMELINE CASE (a whodunit told by the clock)
//   thing    what went missing, with "the" ("the championship trophy").
//   scene    where it happens, short, with "the" ("the awards banquet").
//            Story moments use it.
//   place, object, extra
//            ids of three of the theme's own categories (see themes.js; not
//            the numbered ones like Age or Arrival). place and object are in
//            every puzzle, extra joins the bigger ones.
//   time     { start, step }: the first time in the log, in minutes after
//            midnight (19 * 60 is 7:00 PM), and the minutes between times.
//   setting, mood   a few words for the picture and the music.
//   titles   two puzzle titles.
//   openings two first sentences. Slots: {n} how many (a word, "five"),
//            {many} the cast word in the plural ("athletes").
//   crime    one sentence: when the thing went missing. Slots: {time} (the
//            time of the crime), {thing}.
//   log      one sentence: who wrote the times down. Every cast member is in
//            the log once, each at a different time. Slot: {one} ("athlete").
//   endings  two closing lines, shown when the puzzle is solved. Slots:
//            {culprit} the one who did it, {time}, {thing}, {Thing} (with a
//            capital), {where} and {holding}: what the culprit did, in the
//            category's own words ("competed in Archery", "ate the Banana"),
//            and {one}. The theme's words do not all suit "they" ("they
//            flies"), so write "{culprit}, who {where}" or "the {one} who
//            {where}". Keep endings kind: nobody is really a villain.
//
// HOW TO WRITE A SEATING PLAN (guests around one round table)
//   occasion the event, short, with "the" ("the team banquet"). Story
//            moments use it.
//   thing    what was left at one seat ("a thank-you card for the coach").
//   cats     ids of three of the theme's own categories (not numbered ones).
//            Smaller puzzles use one or two of them.
//   seat     optional: what to call a seat ({ name: 'Chair' }). Default Seat.
//   setting, mood, titles, openings   as above.
//   incident one sentence: someone finds {thing} at {seat} (the seat number).
//   endings  two lines. Slots: {winner} who sat there, {seat}, {left} and
//            {right} (the neighbours), {thing}.
//
// RULES FOR EVERY LINE
//   - Short, plain, friendly words.
//   - Never name a cast member or an item in an opening, crime, incident or
//     story moment: players would take it for a clue.
//   - No famous characters, brands or real people.

export const TIMELINE_STORIES = {
  mystery: {
    thing: 'the emerald brooch', scene: 'the manor', place: 'room', object: 'object', extra: 'drink',
    time: { start: 19 * 60, step: 30 },
    setting: 'an old country manor on a stormy night, candles in every hall', mood: 'moody, candlelit, suspicious',
    titles: ['The Emerald Brooch', 'A Long Night at the Manor'],
    openings: [
      'Thunder rolled over Bramblewood Manor, and {n} {many} were stuck inside until the storm passed.',
      'The power flickered at Bramblewood Manor as {n} {many} gathered for a quiet weekend.',
    ],
    crime: 'At {time}, {thing} vanished from its velvet box in the hall.',
    log: 'The butler keeps a hall book, and he wrote each {one} down once, each at a different time.',
    endings: [
      'The hall book gives it away. {culprit}, who {where} and {holding}, was seen at {time}. {Thing} turned up in a teapot, safe and sound.',
      'At {time} only {culprit} passed the hall. That was the {one} who {where} and {holding}, and they meant to give {thing} a polish, nothing more.',
    ],
  },
  action: {
    thing: 'the secret blueprint', scene: 'headquarters', place: 'hideout', object: 'gadget', extra: 'vehicle',
    time: { start: 6 * 60, step: 30 },
    setting: 'a hidden spy headquarters under a city, screens glowing in the dark', mood: 'tense, fast, sleek',
    titles: ['The Missing Blueprint', 'Trouble at Headquarters'],
    openings: [
      'Before sunrise, {n} {many} checked in at headquarters for the morning briefing.',
      'The alarms were quiet and the coffee was hot as {n} {many} reported for duty.',
    ],
    crime: 'At {time}, {thing} was taken from the locked vault.',
    log: 'The vault door scans every badge, and it logged each {one} once, each at a different time.',
    endings: [
      'The badge log does not lie. {culprit}, who {where} and {holding}, was at the vault at {time}. It was a training test, and {culprit} passed it.',
      'At {time} only {culprit} went near the vault. That was the {one} who {where} and {holding}, and {thing} was back by lunch with a gold star on it.',
    ],
  },
  adventure: {
    thing: 'the old treasure map', scene: 'base camp', place: 'place', object: 'gear', extra: 'companion',
    time: { start: 17 * 60, step: 30 },
    setting: 'a canvas base camp at the edge of the jungle, lanterns hanging from poles', mood: 'warm, wild, curious',
    titles: ['The Missing Map', 'Night at Base Camp'],
    openings: [
      'After a long day out in the wild, {n} {many} came back to base camp tired and hungry.',
      'The lanterns came on at base camp as {n} {many} shared stories of the day.',
    ],
    crime: 'At {time}, {thing} disappeared from the map tent.',
    log: 'The camp cook writes down each {one} who comes for supper, once each, each at a different time.',
    endings: [
      'The cook\'s list solves it. {culprit}, who {where} and {holding}, came by at {time}. They only borrowed {thing} to plan a surprise trip for everyone.',
      'At {time} only {culprit} was near the map tent. That was the {one} who {where} and {holding}, and {thing} was back on the table by breakfast.',
    ],
  },
  holiday: {
    thing: 'the star for the top of the tree', scene: 'Grandma\'s house', place: 'decoration', object: 'gift', extra: 'treat',
    time: { start: 9 * 60, step: 30 },
    setting: 'a cozy family house in the snow, a tall bare tree waiting by the window', mood: 'cozy, twinkly, playful',
    titles: ['The Missing Star', 'Who Took the Star?'],
    openings: [
      'Snow fell all morning as {n} {many} helped get Grandma\'s house ready for the holiday.',
      'The kitchen smelled of cinnamon, and {n} {many} were busy all over Grandma\'s house.',
    ],
    crime: 'At {time}, {thing} vanished from its box.',
    log: 'Grandma wrote each {one} on the kitchen chalkboard once, with the time, as they came in to warm up.',
    endings: [
      'The chalkboard settles it. {culprit}, who {where} and {holding}, came in at {time}. They had hidden {thing} to put it on the tree as a surprise.',
      'At {time} only {culprit} was near the box. That was the {one} who {where} and {holding}, and {thing} ended up right where it belongs, on top of the tree.',
    ],
  },
  occasion: {
    thing: 'the cake topper', scene: 'the party', place: 'dance', object: 'present', extra: 'cake',
    time: { start: 18 * 60, step: 15 },
    setting: 'a party hall strung with lights, a tall cake on a table at the front', mood: 'bright, happy, busy',
    titles: ['The Cake Topper Caper', 'A Mix-Up at the Party'],
    openings: [
      'The music was loud and the dance floor was full as {n} {many} enjoyed the party.',
      'Balloons filled the hall, and {n} {many} had come to celebrate.',
    ],
    crime: 'At {time}, {thing} went missing from the top of the cake.',
    log: 'The photographer took one picture of each {one} during the evening, and every picture shows the time.',
    endings: [
      'The pictures tell the story. {culprit}, who {where} and {holding}, was at the cake at {time}. They had only taken {thing} to keep it safe from the dancing.',
      'At {time} only {culprit} stood by the cake. That was the {one} who {where} and {holding}, and {thing} went back on top just in time for the photos.',
    ],
  },
  fantasy: {
    thing: 'the Moonstone Orb', scene: 'the castle', place: 'tower', object: 'wand', extra: 'familiar',
    time: { start: 20 * 60, step: 30 },
    setting: 'a castle of tall towers under a full moon, a glowing orb on a stand', mood: 'magical, starry, mysterious',
    titles: ['The Moonstone Orb', 'Shadows in the Castle'],
    openings: [
      'On the night of the full moon, {n} {many} gathered at the castle for the great spell-casting.',
      'Candles floated in the air as {n} {many} climbed the castle stairs.',
    ],
    crime: 'At {time}, {thing} vanished from its silver stand.',
    log: 'The castle\'s talking door greets each {one} once, and it never forgets the time.',
    endings: [
      'The talking door remembers. {culprit}, who {where} and {holding}, passed by at {time}. {Thing} had been borrowed to light the way home.',
      'At {time} only {culprit} was near the stand. That was the {one} who {where} and {holding}, and {thing} was back, glowing brighter than ever.',
    ],
  },
  scifi: {
    thing: 'the captain\'s crystal key', scene: 'the space station', place: 'planet', object: 'ship', extra: 'alien',
    time: { start: 8 * 60, step: 20 },
    setting: 'a ring-shaped space station above a blue planet, ships docked all round', mood: 'shiny, humming, curious',
    titles: ['The Crystal Key', 'Trouble on the Station'],
    openings: [
      '{n} {many} docked at the space station for a day of rest between missions.',
      'The station lights turned blue for morning as {n} {many} met in the main ring.',
    ],
    crime: 'At {time}, {thing} disappeared from the command deck.',
    log: 'The station computer logs each {one} through the airlock once, each at a different time.',
    endings: [
      'The airlock log solves it. {culprit}, who {where} and {holding}, came through at {time}. They had taken {thing} to fix a loose panel, and forgot to say so.',
      'At {time} only {culprit} was on the command deck. That was the {one} who {where} and {holding}, and {thing} was back in the captain\'s hand by dinner.',
    ],
  },
  sports: {
    thing: 'the championship trophy', scene: 'the awards banquet', place: 'sport', object: 'snack', extra: 'jersey',
    time: { start: 18 * 60, step: 15 },
    setting: 'a sports hall set for an awards banquet, a shiny trophy on a stage', mood: 'proud, lively, cheerful',
    titles: ['The Missing Trophy', 'Banquet Night'],
    openings: [
      'At the end of a long season, {n} {many} dressed up for the awards banquet.',
      'The hall buzzed with cheers as {n} {many} found their way to the awards banquet.',
    ],
    crime: 'At {time}, {thing} vanished from the stage.',
    log: 'The team manager signed each {one} in once, each at a different time.',
    endings: [
      'The sign-in sheet gives it away. {culprit}, who {where} and {holding}, was by the stage at {time}. They only wanted a photo with {thing}.',
      'At {time} only {culprit} was near the stage. That was the {one} who {where} and {holding}, and {thing} was back before the first speech.',
    ],
  },
  cooking: {
    thing: 'the secret recipe book', scene: 'the kitchen contest', place: 'station', object: 'utensil', extra: 'dish',
    time: { start: 10 * 60, step: 15 },
    setting: 'a big bright contest kitchen with rows of cooking stations', mood: 'warm, busy, delicious',
    titles: ['The Secret Recipe', 'Mystery in the Kitchen'],
    openings: [
      'The kitchen contest began at dawn, and {n} {many} raced to get their dishes ready.',
      'Pots bubbled and pans sizzled as {n} {many} cooked for the judges.',
    ],
    crime: 'At {time}, {thing} went missing from the judges\' table.',
    log: 'The judges ticked off each {one} once on their tasting sheet, each at a different time.',
    endings: [
      'The tasting sheet tells it. {culprit}, who {where} and {holding}, was at the judges\' table at {time}. They wanted to copy one recipe for their grandmother.',
      'At {time} only {culprit} visited the judges. That was the {one} who {where} and {holding}, and {thing} came back with a little flour on it.',
    ],
  },
  pets: {
    thing: 'the judge\'s golden whistle', scene: 'the pet show', place: 'pet', object: 'toy', extra: 'collar',
    time: { start: 9 * 60, step: 15 },
    setting: 'a pet show on a green lawn, tents and a ring with little jumps', mood: 'sunny, playful, noisy',
    titles: ['The Golden Whistle', 'A Puzzle at the Pet Show'],
    openings: [
      '{n} {many} brought their animals to the pet show on a bright Saturday morning.',
      'Barks, chirps and squeaks filled the air as {n} {many} waited for the judging.',
    ],
    crime: 'At {time}, {thing} went missing from the judge\'s table.',
    log: 'The ring steward checked each {one} in once, each at a different time.',
    endings: [
      'The check-in list solves it. {culprit}, who {where} and {holding}, was at the table at {time}. A curious pet had carried {thing} away, and {culprit} brought it back.',
      'At {time} only {culprit} went near the table. That was the {one} who {where} and {holding}, and {thing} turned up in a basket of toys.',
    ],
  },
  town: {
    thing: 'the prize-winning pie', scene: 'the town fair', place: 'place', object: 'purchase', extra: 'ride',
    time: { start: 9 * 60, step: 15 },
    setting: 'a small town on fair day, bunting across Main Street', mood: 'friendly, sunny, busy',
    titles: ['The Missing Pie', 'Fair Day Mix-Up'],
    openings: [
      'It was fair day, and {n} {many} were out running errands all over town.',
      'Main Street was busy from early on, as {n} {many} hurried about their day.',
    ],
    crime: 'At {time}, {thing} vanished from the window of the town hall.',
    log: 'The town hall clerk noted each {one} who stopped by, once each, each at a different time.',
    endings: [
      'The clerk\'s notes settle it. {culprit}, who {where} and {holding}, stopped by at {time}. They had moved {thing} out of the hot sun.',
      'At {time} only {culprit} was at the town hall. That was the {one} who {where} and {holding}, and {thing} was shared with the whole street.',
    ],
  },
  parks: {
    thing: 'the ranger\'s trail camera', scene: 'the ranger station', place: 'trail', object: 'gear', extra: 'wildlife',
    time: { start: 6 * 60, step: 30 },
    setting: 'a wooden ranger station in a pine forest, mountains behind', mood: 'fresh, green, calm',
    titles: ['The Missing Camera', 'A Puzzle on the Trail'],
    openings: [
      'Early in the morning, {n} {many} set out from the ranger station.',
      'Mist hung over the trees as {n} {many} signed up for a day in the park.',
    ],
    crime: 'At {time}, {thing} went missing from its post.',
    log: 'The ranger wrote each {one} in the trail book once, each at a different time.',
    endings: [
      'The trail book points one way. {culprit}, who {where} and {holding}, passed the post at {time}. They had taken {thing} down to save it from the rain.',
      'At {time} only {culprit} was on that part of the trail. That was the {one} who {where} and {holding}, and {thing} was back on its post that afternoon.',
    ],
  },
  travel: {
    thing: 'the hotel\'s antique globe', scene: 'the hotel lobby', place: 'outing', object: 'souvenir', extra: 'lodging',
    time: { start: 8 * 60, step: 30 },
    setting: 'a grand old hotel lobby with palm trees and a spinning globe', mood: 'sunny, relaxed, curious',
    titles: ['The Missing Globe', 'Lost in the Lobby'],
    openings: [
      '{n} {many} passed through the hotel lobby on the first day of their trips.',
      'Suitcases rolled across the shiny floor as {n} {many} came and went.',
    ],
    crime: 'At {time}, {thing} vanished from the front desk.',
    log: 'The desk clerk wrote down each {one} who asked for help, once each, each at a different time.',
    endings: [
      'The desk book gives it away. {culprit}, who {where} and {holding}, was at the desk at {time}. They had borrowed {thing} to plan their route.',
      'At {time} only {culprit} stood at the front desk. That was the {one} who {where} and {holding}, and {thing} came back with a postcard taped to it.',
    ],
  },
  wonders: {
    thing: 'the first-prize medal', scene: 'the model fair', place: 'landmark', object: 'tool', extra: 'material',
    time: { start: 10 * 60, step: 15 },
    setting: 'a school gym full of model towers, bridges and temples on long tables', mood: 'bright, careful, proud',
    titles: ['The Missing Medal', 'Mystery at the Model Fair'],
    openings: [
      '{n} {many} set up their models for the big model fair.',
      'Glue guns hummed as {n} {many} added the last touches to their models.',
    ],
    crime: 'At {time}, {thing} vanished from the judges\' table.',
    log: 'The judges visited each {one} once, and wrote down the time of each visit.',
    endings: [
      'The judges\' notes solve it. {culprit}, who {where} and {holding}, was near the table at {time}. They had tucked {thing} away so it would not get glue on it.',
      'At {time} only {culprit} was by the judges\' table. That was the {one} who {where} and {holding}, and {thing} was found under a cardboard bridge.',
    ],
  },
  music: {
    thing: 'the festival\'s golden microphone', scene: 'the music festival', place: 'stage', object: 'outfit', extra: 'instrument',
    time: { start: 18 * 60, step: 15 },
    setting: 'an outdoor music festival at dusk, stages lit up across a field', mood: 'loud, joyful, glowing',
    titles: ['The Golden Microphone', 'Backstage Mystery'],
    openings: [
      'As the sun went down, {n} {many} got ready backstage at the music festival.',
      'The crowd was singing along, and {n} {many} were waiting for their turn to play.',
    ],
    crime: 'At {time}, {thing} disappeared from the sound desk.',
    log: 'The stage manager ticked off each {one} once on the clipboard, each at a different time.',
    endings: [
      'The clipboard tells it. {culprit}, who {where} and {holding}, was at the sound desk at {time}. They only wanted to try {thing} for one song.',
      'At {time} only {culprit} went near the sound desk. That was the {one} who {where} and {holding}, and {thing} was back for the big finale.',
    ],
  },
  nautical: {
    thing: 'the ship\'s brass bell', scene: 'the harbor', place: 'boat', object: 'gear', extra: 'role',
    time: { start: 5 * 60, step: 30 },
    setting: 'a busy harbor at dawn, sailboats tied up along the docks', mood: 'salty, breezy, bright',
    titles: ['The Missing Bell', 'A Mystery at the Harbor'],
    openings: [
      '{n} {many} came down to the harbor at dawn to get ready for the big race.',
      'Gulls cried over the docks as {n} {many} checked their sails.',
    ],
    crime: 'At {time}, {thing} vanished from the harbor master\'s post.',
    log: 'The harbor master wrote each {one} in the dock book once, each at a different time.',
    endings: [
      'The dock book settles it. {culprit}, who {where} and {holding}, passed the post at {time}. They had taken {thing} to shine it for the race.',
      'At {time} only {culprit} was near the post. That was the {one} who {where} and {holding}, and {thing} rang out loud to start the race.',
    ],
  },
  farm: {
    thing: 'the blue ribbon', scene: 'the county fair', place: 'chore', object: 'machine', extra: 'crop',
    time: { start: 5 * 60, step: 30 },
    setting: 'a county fair beside a red barn, animal pens and a big tent', mood: 'sunny, earthy, cheerful',
    titles: ['The Missing Ribbon', 'Mix-Up at the Fair'],
    openings: [
      'Before sunrise, {n} {many} got to work at the county fair.',
      'Roosters crowed as {n} {many} hurried to finish their morning work at the fair.',
    ],
    crime: 'At {time}, {thing} disappeared from the judges\' tent.',
    log: 'The fair secretary wrote each {one} into the visitor book once, each at a different time.',
    endings: [
      'The visitor book solves it. {culprit}, who {where} and {holding}, was in the tent at {time}. A goat had chewed {thing}, and {culprit} was trying to fix it.',
      'At {time} only {culprit} went into the tent. That was the {one} who {where} and {holding}, and {thing} was pinned back up by noon.',
    ],
  },
  science: {
    thing: 'the robot\'s spare battery', scene: 'the science fair', place: 'project', object: 'tool', extra: 'goggles',
    time: { start: 9 * 60, step: 15 },
    setting: 'a science fair in a big hall, posters and gadgets on every table', mood: 'bright, buzzing, clever',
    titles: ['The Missing Battery', 'Science Fair Puzzle'],
    openings: [
      '{n} {many} set up their projects for the science fair.',
      'Wires, beakers and posters covered the tables as {n} {many} got ready for the judges.',
    ],
    crime: 'At {time}, {thing} went missing from the charging table.',
    log: 'The charging table has a sign-up sheet, and each {one} signed it once, each at a different time.',
    endings: [
      'The sign-up sheet gives it away. {culprit}, who {where} and {holding}, was at the table at {time}. Their own project had run out of power.',
      'At {time} only {culprit} was at the charging table. That was the {one} who {where} and {holding}, and {thing} went back fully charged.',
    ],
  },
  math: {
    thing: 'the answer envelope', scene: 'the math contest', place: 'team', object: 'tool', extra: 'shape',
    time: { start: 13 * 60, step: 15 },
    setting: 'a school hall set up for a math contest, desks in neat rows', mood: 'focused, quiet, clever',
    titles: ['The Answer Envelope', 'A Puzzle at the Contest'],
    openings: [
      '{n} {many} sharpened their pencils for the math contest.',
      'The clock ticked loudly as {n} {many} waited for the contest to begin.',
    ],
    crime: 'At {time}, {thing} vanished from the front desk.',
    log: 'Each {one} handed in one practice sheet, and each sheet is stamped with the time.',
    endings: [
      'The stamped sheets solve it. {culprit}, who {where} and {holding}, was at the front desk at {time}. They had picked up {thing} by mistake with their papers.',
      'At {time} only {culprit} went to the front desk. That was the {one} who {where} and {holding}, and {thing} was still sealed.',
    ],
  },
  biology: {
    thing: 'the rare beetle sample', scene: 'the field station', place: 'habitat', object: 'tool', extra: 'animal',
    time: { start: 7 * 60, step: 30 },
    setting: 'a wooden field station at the edge of a wetland, jars and notebooks everywhere', mood: 'green, curious, calm',
    titles: ['The Missing Beetle', 'A Puzzle at the Field Station'],
    openings: [
      '{n} {many} came back to the field station after a morning of fieldwork.',
      'Frogs croaked outside as {n} {many} sorted their notes at the field station.',
    ],
    crime: 'At {time}, {thing} went missing from the lab bench.',
    log: 'The station keeps a sample log, and each {one} signed it once, each at a different time.',
    endings: [
      'The sample log settles it. {culprit}, who {where} and {holding}, was at the bench at {time}. They had moved {thing} into the shade to keep it cool.',
      'At {time} only {culprit} was at the bench. That was the {one} who {where} and {holding}, and {thing} was safe in a labeled jar.',
    ],
  },
  astronomy: {
    thing: 'the big telescope\'s star finder', scene: 'the observatory', place: 'blanket', object: 'telescope', extra: 'snack',
    time: { start: 20 * 60, step: 15 },
    setting: 'a hilltop observatory under a clear night sky, the dome open', mood: 'starry, hushed, curious',
    titles: ['The Missing Star Finder', 'Who Moved the Telescope?'],
    openings: [
      'On a clear night, {n} {many} climbed the hill to the observatory.',
      'The dome rolled open, and {n} {many} looked up at a sky full of stars.',
    ],
    crime: 'At {time}, {thing} vanished, and the telescope was turned to face the wrong way.',
    log: 'The observatory\'s guest book has each {one} in it once, each at a different time.',
    endings: [
      'The guest book points one way. {culprit}, who {where} and {holding}, was in the dome at {time}. They had turned the telescope to show a friend a comet.',
      'At {time} only {culprit} was in the dome. That was the {one} who {where} and {holding}, and {thing} was found in a coat pocket.',
    ],
  },
  paradox: {
    thing: 'the key to the clock of Tuesdays', scene: 'the dream house', place: 'door', object: 'object', extra: 'stair',
    time: { start: 5 * 60, step: 15 },
    setting: 'a house of impossible stairs and floating doors, clocks melting on the walls', mood: 'dreamy, strange, gentle',
    titles: ['The Clock of Tuesdays', 'A Riddle in the Dream House'],
    openings: [
      '{n} {many} wandered into the dream house, where the stairs went up and down at once.',
      'The clocks ran backward as {n} {many} drifted through the dream house.',
    ],
    crime: 'At {time}, {thing} disappeared, and it stayed Monday all day.',
    log: 'A mirror in the hall reflects each {one} once, and it notes the time in silver letters.',
    endings: [
      'The mirror remembers. {culprit}, who {where} and {holding}, passed it at {time}. They had wound the clock the wrong way, just to see what would happen.',
      'At {time} only {culprit} was near the clock. That was the {one} who {where} and {holding}, and {thing} was back, and Tuesday came at last.',
    ],
  },
  seasons: {
    thing: 'the prize apple pie', scene: 'the harvest festival', place: 'activity', object: 'treat', extra: 'sweater',
    time: { start: 9 * 60, step: 15 },
    setting: 'a fall harvest festival under red and gold trees, hay bales everywhere', mood: 'crisp, golden, cozy',
    titles: ['The Missing Pie', 'Festival Puzzle'],
    openings: [
      'Leaves crunched underfoot as {n} {many} arrived at the harvest festival.',
      'The air smelled of cider as {n} {many} enjoyed the harvest festival.',
    ],
    crime: 'At {time}, {thing} vanished from the judging table.',
    log: 'The festival helper stamped each {one}\'s ticket once, each at a different time.',
    endings: [
      'The ticket stamps solve it. {culprit}, who {where} and {holding}, was at the table at {time}. They had moved {thing} away from a curious squirrel.',
      'At {time} only {culprit} was near the table. That was the {one} who {where} and {holding}, and {thing} won its prize after all.',
    ],
  },
};

export const SEATING_STORIES = {
  mystery: {
    occasion: 'the manor dinner', thing: 'an unsigned invitation to next year\'s dinner', cats: ['drink', 'hat', 'pet'],
    setting: 'a round table in a candlelit manor dining room, rain on the windows', mood: 'moody, elegant, warm',
    titles: ['Dinner at the Manor', 'The Unsigned Invitation'],
    openings: [
      'The storm kept everyone in, so {n} {many} sat down to dinner around the manor\'s old round table.',
      'Candles flickered as {n} {many} took their places for dinner at Bramblewood Manor.',
    ],
    incident: 'After the soup, the butler found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. They smiled and said everyone was welcome back next year.',
      'The invitation was from {winner}, in {seat}. {left} and {right} said yes straight away.',
    ],
  },
  action: {
    occasion: 'the farewell dinner', thing: 'a thank-you card written in invisible ink', cats: ['vehicle', 'gadget', 'disguise'],
    setting: 'a round table in a rooftop restaurant, city lights all round', mood: 'sleek, warm, a little secret',
    titles: ['The Farewell Dinner', 'Invisible Ink'],
    openings: [
      'The chief was retiring, so {n} {many} met for one last dinner around a round table on the roof.',
      'No missions tonight: {n} {many} sat down together for the chief\'s farewell dinner.',
    ],
    incident: 'When the plates were cleared, the chief found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} on their left and {right} on their right. The card said: "Best boss ever."',
      'It was {winner}, in {seat}. {left} held the card up to a candle, and {right} read the words out loud.',
    ],
  },
  adventure: {
    occasion: 'the camp feast', thing: 'a hand-drawn map to a secret picnic spot', cats: ['gear', 'companion', 'snack'],
    setting: 'a round wooden table at a jungle base camp, lanterns overhead', mood: 'warm, wild, cheerful',
    titles: ['The Camp Feast', 'A Map at Supper'],
    openings: [
      'After the last trip of the season, {n} {many} sat down to a feast around the camp\'s round table.',
      'Lanterns swung in the breeze as {n} {many} gathered for supper at base camp.',
    ],
    incident: 'Under one plate, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The next morning they led everyone to the picnic spot.',
      'The map was from {winner}, in {seat}. {left} and {right} packed the lunch.',
    ],
  },
  holiday: {
    occasion: 'the holiday dinner', thing: 'a little wrapped gift with no tag', cats: ['gift', 'treat', 'sweater'],
    setting: 'a round table by a twinkling tree, snow falling outside', mood: 'cozy, twinkly, joyful',
    titles: ['The Holiday Dinner', 'A Gift With No Tag'],
    openings: [
      'The whole family came, and {n} {many} squeezed round Grandma\'s round table for the holiday dinner.',
      'Snow fell outside while {n} {many} sat down to the holiday dinner.',
    ],
    incident: 'Before dessert, someone spotted {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. The gift was for Grandma, and it made her laugh.',
      'It was {winner}, in {seat}. {left} and {right} helped Grandma open it.',
    ],
  },
  occasion: {
    occasion: 'the birthday party', thing: 'a birthday card with no name', cats: ['present', 'dish', 'cake'],
    setting: 'a round party table with balloons tied to every chair', mood: 'bright, happy, festive',
    titles: ['The Birthday Table', 'The Card With No Name'],
    openings: [
      '{n} {many} came to the birthday party and sat around one big round table.',
      'Balloons bobbed over every chair as {n} {many} found their places.',
    ],
    incident: 'When the candles were blown out, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The card had a joke inside, and the whole table laughed.',
      'The card was from {winner}, in {seat}. {left} and {right} sang the loudest.',
    ],
  },
  fantasy: {
    occasion: 'the wizards\' feast', thing: 'a glowing wishing stone', cats: ['familiar', 'potion', 'robe'],
    setting: 'a great round table in a castle hall, candles floating above', mood: 'magical, golden, merry',
    titles: ['The Wizards\' Feast', 'The Wishing Stone'],
    openings: [
      'On midsummer night, {n} {many} sat down to a feast at the castle\'s round table.',
      'Floating candles lit the hall as {n} {many} took their seats for the feast.',
    ],
    incident: 'As the bells rang midnight, {thing} lit up at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. They wished for one more feast next year, and the stone glowed yes.',
      'The stone was from {winner}, in {seat}. {left} and {right} each made a wish too.',
    ],
  },
  scifi: {
    occasion: 'the starship dinner', thing: 'a tiny robot that hums the ship\'s song', cats: ['planet', 'alien', 'snack'],
    setting: 'a round table in a starship\'s dining deck, stars sliding past the window', mood: 'shiny, cozy, starry',
    titles: ['Dinner on the Starship', 'The Humming Robot'],
    openings: [
      'Between two stars, {n} {many} sat down to dinner around the ship\'s round table.',
      'The ship slowed to cruising speed as {n} {many} gathered on the dining deck.',
    ],
    incident: 'Over dessert, {thing} switched on at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. They had built the robot as a gift for the whole crew.',
      'It was {winner}, in {seat}. {left} and {right} hummed along.',
    ],
  },
  sports: {
    occasion: 'the team banquet', thing: 'a thank-you card for the coach', cats: ['sport', 'country', 'jersey'],
    setting: 'a round banquet table in a sports hall, medals on display', mood: 'proud, lively, warm',
    titles: ['The Team Banquet', 'A Card for the Coach'],
    openings: [
      'At the end of the season, {n} {many} sat down around one round table for the team banquet.',
      'Cheers filled the hall as {n} {many} took their seats for the banquet.',
    ],
    incident: 'After the speeches, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. The card said: "Thanks for believing in us."',
      'The card was from {winner}, in {seat}. {left} and {right} had signed it too.',
    ],
  },
  cooking: {
    occasion: 'the chefs\' supper', thing: 'a recipe card for a secret sauce', cats: ['dish', 'dessert', 'apron'],
    setting: 'a round table in a restaurant kitchen after closing, pots still warm', mood: 'warm, tasty, friendly',
    titles: ['The Chefs\' Supper', 'The Secret Sauce'],
    openings: [
      'After the contest, {n} {many} cooked for each other and sat around one round table.',
      'Pans cooled on the stove while {n} {many} sat down to share a supper.',
    ],
    incident: 'Tucked under a napkin, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. They shared the sauce recipe with everyone.',
      'It was {winner}, in {seat}. {left} and {right} asked for seconds.',
    ],
  },
  pets: {
    occasion: 'the pet picnic', thing: 'a bag of homemade pet treats tied with a bow', cats: ['pet', 'toy', 'collar'],
    setting: 'a round picnic table in a park, pets playing on the grass', mood: 'sunny, playful, happy',
    titles: ['The Pet Picnic', 'Treats With a Bow'],
    openings: [
      'After the pet show, {n} {many} shared a picnic around a round table in the park.',
      'Tails wagged under the table as {n} {many} sat down for a picnic.',
    ],
    incident: 'When the picnic was over, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. The treats were for every pet at the table.',
      'The treats were from {winner}, in {seat}. The pets of {left} and {right} were first in line.',
    ],
  },
  town: {
    occasion: 'the street potluck', thing: 'a jar of homemade jam', cats: ['purchase', 'snack', 'coffee'],
    setting: 'a round table in the middle of a quiet street, string lights overhead', mood: 'friendly, relaxed, warm',
    titles: ['The Street Potluck', 'A Jar of Jam'],
    openings: [
      'The street was closed for the evening, and {n} {many} sat around one round table for a potluck.',
      'String lights came on as {n} {many} brought chairs out for the street potluck.',
    ],
    incident: 'At the end of the night, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The jam was for the neighbor who fixed everyone\'s fences.',
      'It was {winner}, in {seat}. {left} and {right} asked for the recipe.',
    ],
  },
  parks: {
    occasion: 'the lodge supper', thing: 'a pressed wildflower bookmark', cats: ['park', 'trail', 'gear'],
    setting: 'a round table in a log lodge, a fire crackling', mood: 'woodsy, warm, calm',
    titles: ['Supper at the Lodge', 'The Wildflower Bookmark'],
    openings: [
      'After a long day of hiking, {n} {many} sat down around the lodge\'s round table.',
      'The fire crackled as {n} {many} shared stories over supper at the lodge.',
    ],
    incident: 'When the bowls were cleared, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. The bookmark was a gift for the ranger.',
      'It was {winner}, in {seat}. {left} and {right} said it was the prettiest thing they saw all day.',
    ],
  },
  travel: {
    occasion: 'the welcome dinner', thing: 'a postcard addressed to the chef', cats: ['destination', 'souvenir', 'suitcase'],
    setting: 'a round table on a hotel terrace by the sea', mood: 'sunny, relaxed, festive',
    titles: ['The Welcome Dinner', 'A Postcard for the Chef'],
    openings: [
      'On their first night, {n} {many} met at the hotel\'s welcome dinner around one round table.',
      'Waves rolled in below the terrace as {n} {many} sat down to dinner.',
    ],
    incident: 'After dinner, a waiter found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The postcard said the soup was the best they ever had.',
      'It was {winner}, in {seat}. {left} and {right} added their names too.',
    ],
  },
  wonders: {
    occasion: 'the builders\' dinner', thing: 'a tiny model of the dinner table itself', cats: ['landmark', 'material', 'helper'],
    setting: 'a round table in a hall full of model buildings', mood: 'proud, bright, friendly',
    titles: ['The Builders\' Dinner', 'A Tiny Table'],
    openings: [
      'After the model fair, {n} {many} sat down for dinner around one round table.',
      'Models of towers and bridges stood all around the hall as {n} {many} took their seats.',
    ],
    incident: 'Over dessert, someone noticed {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. They had built the tiny table during the speeches.',
      'It was {winner}, in {seat}. {left} and {right} were in the model too, made of clay.',
    ],
  },
  music: {
    occasion: 'the after-show dinner', thing: 'a new song written on a napkin', cats: ['instrument', 'genre', 'outfit'],
    setting: 'a round table in a late-night diner after a concert', mood: 'happy, tired, glowing',
    titles: ['After the Show', 'The Napkin Song'],
    openings: [
      'After the big show, {n} {many} sat down for a late dinner around one round table.',
      'Their ears still ringing, {n} {many} piled into the diner after the concert.',
    ],
    incident: 'When the bill came, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The band played the napkin song at the next show.',
      'The song was from {winner}, in {seat}. {left} and {right} hummed it all the way home.',
    ],
  },
  nautical: {
    occasion: 'the pirate feast', thing: 'a bottle with a tiny ship inside', cats: ['boat', 'flag', 'role'],
    setting: 'a round table in a harbor tavern, lanterns and ropes hanging from the beams', mood: 'merry, salty, rowdy',
    titles: ['The Pirate Feast', 'A Ship in a Bottle'],
    openings: [
      'After the big race, {n} {many} had a pirate feast around the tavern\'s round table.',
      'Lanterns swung from the beams as {n} {many} sat down to a pirate feast.',
    ],
    incident: 'When the feast was done, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. The bottle was a prize for the youngest sailor.',
      'It was {winner}, in {seat}. {left} and {right} gave three loud cheers.',
    ],
  },
  farm: {
    occasion: 'the harvest supper', thing: 'a jar of honey with a thank-you tag', cats: ['animal', 'crop', 'stand'],
    setting: 'a round table in a barn, hay bales and lanterns all round', mood: 'warm, golden, homey',
    titles: ['The Harvest Supper', 'A Jar of Honey'],
    openings: [
      'When the harvest was in, {n} {many} sat down to supper around one round table in the barn.',
      'Lanterns glowed in the barn as {n} {many} sat down to the harvest supper.',
    ],
    incident: 'After the pie, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The honey was a thank-you for help with the hay.',
      'It was {winner}, in {seat}. {left} and {right} spread it on warm bread.',
    ],
  },
  science: {
    occasion: 'the lab lunch', thing: 'a cupcake shaped like an atom', cats: ['field', 'tool', 'goggles'],
    setting: 'a round table in a bright lab break room, posters on the walls', mood: 'bright, clever, friendly',
    titles: ['The Lab Lunch', 'The Atom Cupcake'],
    openings: [
      'After a long week, {n} {many} took a break and sat down for lunch around one round table.',
      'The experiments could wait: {n} {many} sat down together for the lab lunch.',
    ],
    incident: 'When lunch was over, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. They had baked it to cheer up a friend whose project fizzled.',
      'It was {winner}, in {seat}. {left} and {right} split the cupcake in three.',
    ],
  },
  math: {
    occasion: 'the math club pizza night', thing: 'a riddle with no answer written', cats: ['puzzle', 'shape', 'team'],
    setting: 'a round table covered in pizza boxes and scrap paper', mood: 'clever, cheerful, cozy',
    titles: ['Pizza Night', 'The Unanswered Riddle'],
    openings: [
      'After the contest, {n} {many} shared pizza around one round table.',
      'Pizza boxes piled up as {n} {many} sat down for math club pizza night.',
    ],
    incident: 'Under one pizza box, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. They had written the riddle for next week.',
      'It was {winner}, in {seat}. {left} and {right} solved it before the last slice.',
    ],
  },
  biology: {
    occasion: 'the field station supper', thing: 'a sketch of a rare moth', cats: ['animal', 'habitat', 'tool'],
    setting: 'a round table on the porch of a field station, moths around the lamp', mood: 'calm, green, curious',
    titles: ['Supper at the Field Station', 'The Moth Sketch'],
    openings: [
      'At the end of fieldwork, {n} {many} sat down to supper around one round table on the porch.',
      'Moths danced around the lamp as {n} {many} gathered for supper.',
    ],
    incident: 'When the plates were stacked, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. They had drawn the moth that landed on the lamp.',
      'It was {winner}, in {seat}. {left} and {right} said it looked just like the real one.',
    ],
  },
  astronomy: {
    occasion: 'the midnight picnic', thing: 'a card naming a star after the host', cats: ['telescope', 'constellation', 'snack'],
    setting: 'a round picnic table on a dark hilltop under the stars', mood: 'starry, hushed, cozy',
    titles: ['The Midnight Picnic', 'A Star for the Host'],
    openings: [
      'Under a clear sky, {n} {many} shared a midnight picnic around one round table.',
      'The stars were out as {n} {many} sat down for a picnic on the hill.',
    ],
    incident: 'When the cocoa was gone, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. They pointed the star out to everyone.',
      'It was {winner}, in {seat}. {left} and {right} found the star with their telescopes.',
    ],
  },
  paradox: {
    occasion: 'the upside-down tea party', thing: 'a teacup that pours upward', cats: ['door', 'clock', 'color'],
    setting: 'a round table floating in the air, chairs on the ceiling', mood: 'dreamy, odd, gentle',
    titles: ['The Upside-Down Tea Party', 'The Teacup That Pours Up'],
    openings: [
      'The table floated, the chairs hung from the ceiling, and {n} {many} sat down to tea.',
      'In a dream where up was down, {n} {many} met for tea around one round table.',
    ],
    incident: 'When the tea ran out, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, between {left} and {right}. The tea poured up, and everyone drank it anyway.',
      'It was {winner}, in {seat}. {left} and {right} said it was the best tea they had never had.',
    ],
  },
  seasons: {
    occasion: 'the festival supper', thing: 'a pie with a leaf cut in the crust', cats: ['treat', 'activity', 'sweater'],
    setting: 'a round table under a maple tree, leaves drifting down', mood: 'crisp, golden, cozy',
    titles: ['The Festival Supper', 'The Leaf Pie'],
    openings: [
      'As the festival ended, {n} {many} sat down to supper around one round table.',
      'Leaves drifted onto the table as {n} {many} gathered for the festival supper.',
    ],
    incident: 'When the plates were cleared, someone found {thing} at {seat}.',
    endings: [
      '{winner} sat in {seat}, with {left} on their left and {right} on their right. The pie was for whoever raked the most leaves.',
      'It was {winner}, in {seat}. {left} and {right} had the first slices.',
    ],
  },
};

// ---------------------------------------------------------------------------
// STORY MOMENTS (beats) for Lab puzzles: short lines shown while the player
// solves, like the main game's (beats.js shows them and keeps its own on/off
// switch). Timeline Case moments feel like the case closing in; Seating Plan
// moments feel like the party going on.
//
// HOW TO WRITE STORY MOMENTS
//   "early" shows after the first section, "middle" about halfway, "late"
//   just before the last section. One or two short sentences each. Slots:
//     {one} {many}   the cast word ("athlete", "athletes"); {One} {Many} capitalized
//     {name}         any one of the cast, picked at random (never the answer)
//     {thing}        what went missing (timeline) or was left behind (seating)
//     {scene}        where the case happens, or the occasion ("the team banquet")
//     {Scene}        same, with a capital
//   Never give away an answer: no times, seats or items.
//   "default" is used for every theme; a theme can have its own lists too
//   (an empty or missing list uses the default).
export const LAB_BEATS = {
  timeline: {
    default: {
      early: [
        'The first times fall into place. {name} checks the clock and says nothing.',
        'Word spreads round {scene}: {thing} is still missing.',
      ],
      middle: [
        'Half the log makes sense now. The {many} stop chatting and start watching the door.',
        '{name} says they heard footsteps. Nobody else did.',
      ],
      late: [
        'Only a few times are left to place. Whoever took {thing} must be getting nervous.',
        'The case is closing in. Nobody at {scene} wants to leave first.',
      ],
    },
    sports: {
      early: ['The band plays on, but the empty spot on the stage is all anyone talks about.'],
      middle: ['{name} keeps glancing at the stage. The speeches are running late.'],
      late: ['The awards are about to start, and there is still no trophy. The case is nearly solved.'],
    },
    scifi: {
      early: ['The station lights dim for a moment. {name} says it is only a power test.'],
      middle: ['The airlock log scrolls past on every screen. The {many} read it twice.'],
      late: ['The captain taps the console. One last stretch of the log to check.'],
    },
  },
  seating: {
    default: {
      early: [
        'The first {many} find their seats. Somewhere at {scene}, a glass clinks.',
        '{name} passes the bread around the table, to the left, of course.',
      ],
      middle: [
        'Halfway through {scene}, the chatter grows louder and someone asks for seconds.',
        'The {many} swap stories across the table. {name} laughs the loudest.',
      ],
      late: [
        'Dessert is on its way. Only a few seats are still a mystery.',
        'The candles burn low at {scene}. Soon everyone will know who left {thing}.',
      ],
    },
    scifi: {
      early: ['The ship hums softly. {name} floats a bread roll across the table.'],
      middle: ['A comet streaks past the window, and every {one} turns to look.'],
      late: ['Dessert arrives in little silver pouches. Only a few seats are left to place.'],
    },
    nautical: {
      early: ['A fiddle starts up in the corner, and {name} taps along on the table.'],
      middle: ['Someone starts a sea song, and the whole table joins in.'],
      late: ['The lanterns sway. The feast is nearly over, and only a few seats are still a mystery.'],
    },
    holiday: {
      early: ['Someone pulls a cracker, and paper hats go around the table.'],
      middle: ['{name} asks for more gravy, and the dish goes around the table.'],
      late: ['Dessert is coming out of the oven. Only a few seats are left to place.'],
    },
  },
};

// ---------------------------------------------------------------------------
// STAND-ALONE STORIES, used only when the chosen theme cannot host the mode
// (a Player Story, an educator's own world, or a theme with no entry above).
// Each has its own cast, categories and story. The slots are as above, plus
// {place}, {object} and {extra}: the culprit's items, by name.
export const FALLBACK_TIMELINE = [
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

export const FALLBACK_SEATING = [
  {
    id: 'harvest', name: 'The Harvest Supper',
    setting: 'a round oak table in a farmhouse kitchen, set for a harvest supper by candlelight', mood: 'warm, golden, friendly',
    names: ['Alma', 'Boris', 'Cecily', 'Dexter', 'Esme', 'Fabian', 'Gilda', 'Hollis', 'Ingrid', 'Jules'],
    thing: 'a thank-you note tucked under a plate',
    titles: ['The Harvest Supper', 'A Note Under the Plate'],
    openings: [
      'After the last field was cut, {n} {many} gathered around the old oak table at Brookfield Farm for the harvest supper.',
      'The farmhouse kitchen smelled of bread and apples as {n} neighbors took their places around one round table.',
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
      'Ten years after they left school, {n} old classmates met again around one round table in the Linden Hotel ballroom.',
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
      'Teacups clinked as {n} members of the Puzzle Society took their usual chairs around the round table.',
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
    names: ['Alastair', 'Belinda', 'Cyrus', 'Delia', 'Ewan', 'Faye', 'Gustav', 'Hilde', 'Ivor', 'Josephine'],
    thing: 'a small brass compass left beside a napkin',
    titles: ['The Captain\'s Table', 'The Brass Compass'],
    openings: [
      'On the last night of the voyage, {n} {many} were invited to dine at the captain\'s round table.',
      'The ship\'s band played softly as {n} passengers found their place cards around the captain\'s table.',
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

