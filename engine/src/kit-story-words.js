// Story words for the grid-kit games (Cage Math, Sum Cross, Picture Grid,
// More or Less, Skyline, Star Field, Loop Line, Island Bridges) when the
// player picks a story theme. kit-story.js puts these words together; this
// file is only words, so it is safe to rewrite any line here.
//
// HOW TO WRITE (a good first task):
//
//   THEMES: one entry per theme in themes.js (same id). Each has:
//     places  words that go before a thing in a title: "Ravenscroft"
//     things  words that end a title: "Manor". Title = "The {place} {thing}".
//             Pick words that work with any place: "The Ravenscroft Manor".
//     intros  the opening line. The game then adds one sentence that says
//             what to do (GAMES below), so an intro only sets the scene.
//     endings shown on the solved card, after the game's own "done" line.
//     beats   short story moments shown while solving:
//               early  at about one third of the way
//               middle at about two thirds
//               late   just before the end
//             One or two short sentences each. Leave a list out (or empty)
//             and the DEFAULT lines are used instead.
//   Slots you can use in any line:
//     {place} {thing}  the words picked for the title
//     {one} {One}      the theme's cast word from themes.js ("suspect", "Suspect")
//     {many} {Many}    its plural ("suspects", "Suspects")
//     {name}           one of the theme's cast names from themes.js ("Ada")
//     {bits}           what the player is placing in this game ("stars", "bridges")
//   Rules: plain, short, friendly words. Never write a number or anything
//   that hints at where something goes: a story moment must never give away
//   an answer. Use original names only (no famous characters, brands or real
//   people). The tests check every theme has places, things, intros and endings,
//   and that no beat holds a digit.
//
//   GAMES: one entry per game. "task" is the opening's last sentence (what to
//   do), "done" starts the ending, "bits" fills the {bits} slot. Picture
//   Grid's "done" may use {picture}, the picture's name (shown only once it is solved).

export const GAMES = {
  cm: { task: 'Fill the grid so every cage makes its target, with no number twice in a row or column.', done: 'The last cage makes its target.', bits: 'cages' },
  sc: { task: 'Fill the white squares so every run adds up to its total, with no number twice in a run.', done: 'Every run adds up.', bits: 'runs' },
  pg: { task: 'Shade the squares the numbers call for, and a hidden picture will appear.', done: 'There it is: {picture}.', bits: 'rows and columns' },
  ml: { task: 'Fill the grid with no number twice in a row or column, and keep every sign true.', done: 'Every sign holds.', bits: 'signs' },
  sk: { task: 'Raise one tower of each height in every row and column, so each lookout sees just the right count.', done: 'Every lookout counts just right.', bits: 'towers' },
  sf: { task: 'Place the stars: the right count in every row, column and region, and no two touching.', done: 'The last star shines.', bits: 'stars' },
  ll: { task: 'Draw one closed loop. Each number says how many sides of its square the loop runs along.', done: 'The loop closes, with no loose ends.', bits: 'pieces of the loop' },
  ib: { task: 'Build bridges so every island gets its number and all of them join up.', done: 'The last bridge joins every island.', bits: 'bridges' },
  cw: { task: 'Fill every square so each Across and Down answer matches its clue.', done: 'The last word drops into place.', bits: 'answers' },
};

// Used for any theme, or any list, that has no lines of its own.
export const DEFAULT = {
  places: ['Lantern', 'Willow', 'Copper', 'Harbor', 'Meadow', 'Juniper'],
  things: ['Hall', 'House', 'Square', 'Garden'],
  intros: ['Something at the {place} {thing} is not quite finished.', 'The {place} {thing} has been waiting for someone patient.'],
  endings: ['The {place} {thing} is finished at last.', 'All is well at the {place} {thing}.'],
  beats: {
    early: ['A good start. The first {bits} are settling in.', 'The first steps are done. The rest begins to make sense.'],
    middle: ['More than halfway. The {bits} are starting to agree with each other.', 'The picture is getting clearer with every step.'],
    late: ['Nearly there. Only a few {bits} are left to settle.', 'The end is in sight. Take your time.'],
  },
};

export const THEMES = {
  mystery: {
    places: ['Ravenscroft', 'Hollow Oak', 'Greymoor', 'Ashcombe', 'Blackwood', 'Larkspur'],
    things: ['Manor', 'Library', 'Estate', 'Study'],
    intros: ['Someone at the {place} {thing} is hiding something, and the {many} all have alibis.', 'A lamp goes out at the {place} {thing}. When it comes back on, a clue has been left behind.'],
    endings: ['The {many} gather in the hall, and the truth comes out at last.', 'The case of the {place} {thing} is closed.'],
    beats: {
      early: ['{name} says they were in the garden all evening. Nobody saw them there.', 'A clock in the {place} {thing} chimes, and every {one} looks up.'],
      middle: ['A torn note turns up behind a bookshelf. {name} goes pale.', 'Two {many} tell the same story, word for word. Too neat?'],
      late: ['The {many} are asked to stay in the drawing room. Nobody argues.', '{name} starts to speak, then stops. You are close now.'],
    },
  },
  action: {
    places: ['Red Falcon', 'Night Harbor', 'Iron Gate', 'Silver Fox', 'Deep Freeze', 'Thunder'],
    things: ['Base', 'Mission', 'Hideout', 'Run'],
    intros: ['The {place} {thing} goes live at midnight. The {many} need the code before then.', 'Agent {name} has one message for you: crack it, and crack it fast.'],
    endings: ['The {many} slip away with seconds to spare.', 'Mission complete. The {place} {thing} goes quiet.'],
    beats: {
      early: ['A radio crackles. {name} is in position and waiting.', 'The first lock gives. Somewhere, an alarm stays silent.'],
      middle: ['A spotlight sweeps past the window. Keep still.', '{name} checks the clock and says nothing.'],
      late: ['The {many} hold their breath. One last move.', 'The getaway car starts up. Almost done.'],
    },
  },
  adventure: {
    places: ['Sunken', 'Emerald', 'Whispering', 'Lost River', 'Golden', 'Misty Peak'],
    things: ['Temple', 'Cavern', 'Valley', 'Citadel'],
    intros: ['An old map leads to the {place} {thing}. The way in is a puzzle.', '{name} the {one} has reached the {place} {thing}, and the door has no handle.'],
    endings: ['The door grinds open, and the {many} step into the light.', 'The {place} {thing} gives up its last secret.'],
    beats: {
      early: ['Torches flicker along the wall. The path goes deeper.', '{name} brushes dust from a carving and smiles.'],
      middle: ['A rope bridge sways underfoot. Steady now.', 'The {many} hear water somewhere far below.'],
      late: ['A faint glow ahead. The {many} speed up.', 'The last passage opens. {name} lets out a whoop.'],
    },
  },
  holiday: {
    places: ['Snowy', 'Hollyberry', 'Candlelight', 'Frosted', 'Peppermint', 'Evergreen'],
    things: ['Cottage', 'Kitchen', 'Lodge', 'Parlor'],
    intros: ['The {many} are coming to the {place} {thing}, and nothing is ready yet.', '{name} has a plan for the {place} {thing}. It just needs one more puzzle solved.'],
    endings: ['The lights go on, and the {many} cheer.', 'Everyone squeezes round the table at the {place} {thing}.'],
    beats: {
      early: ['Someone has started singing in the next room. Badly.', '{name} sneaks a cookie from the tray.'],
      middle: ['Snow starts to fall outside. The {many} press their noses to the glass.', 'A box of ribbons tips over. Nobody minds.'],
      late: ['The doorbell rings. Almost time.', '{name} lights the last candle and waits for you.'],
    },
  },
  occasion: {
    places: ['Garden', 'Golden', 'Starlit', 'Rosewood', 'Silver', 'Sunny'],
    things: ['Party', 'Ballroom', 'Terrace', 'Gala'],
    intros: ['The {place} {thing} starts at eight, and the seating plan is still a puzzle.', '{name} is planning a surprise at the {place} {thing}. You are in on it.'],
    endings: ['The music starts, and the {many} take to the floor.', 'A toast to you, from everyone at the {place} {thing}.'],
    beats: {
      early: ['The first {many} arrive, a little early.', 'Balloons go up. One floats off on its own.'],
      middle: ['The band tunes up. {name} taps a foot.', 'The cake arrives. It is taller than expected.'],
      late: ['The lights dim. The surprise is nearly ready.', '{name} hushes the room. Just a moment more.'],
    },
  },
  fantasy: {
    places: ['Moonstone', 'Thornwild', 'Elderglen', 'Starfall', 'Emberwyn', 'Silverbrook'],
    things: ['Tower', 'Keep', 'Academy', 'Grove'],
    intros: ['A spell at the {place} {thing} has come undone. Only clear thinking can mend it.', '{name} the {one} hands you an old scroll. "Solve this, and the ward holds."'],
    endings: ['The spell knits itself back together with a soft chime.', 'The {many} of the {place} {thing} bow to you.'],
    beats: {
      early: ['Sparks drift up from the page. The magic notices you.', 'A small dragon peeks round the door, curious.'],
      middle: ['The candles burn blue. {name} nods: keep going.', 'Runes on the wall begin to glow, one by one.'],
      late: ['The air hums. The spell is almost whole.', 'The {many} lower their wands and wait.'],
    },
  },
  scifi: {
    places: ['Nova', 'Orion', 'Quasar', 'Nebula', 'Polaris', 'Zenith'],
    things: ['Station', 'Outpost', 'Starship', 'Colony'],
    intros: ['The computer on the {place} {thing} has scrambled its own log.', 'Pilot {name} needs a clear course out of the {place} {thing}.'],
    endings: ['Engines hum. The {place} {thing} is cleared for launch.', 'The {many} wave from the viewport as the stars stream past.'],
    beats: {
      early: ['A green light blinks on the console. Systems waking up.', '{name} taps the screen. "That looks right."'],
      middle: ['The ship drifts past a ringed planet. Nobody looks; they are watching you.', 'A friendly robot rolls over to see how it is going.'],
      late: ['Countdown is ready to start. Just a little more.', 'The {many} strap in. Nearly there.'],
    },
  },
  sports: {
    places: ['Riverside', 'Summit', 'Lakeside', 'Northfield', 'Hillcrest', 'Bayview'],
    things: ['Stadium', 'Arena', 'Cup', 'Derby'],
    intros: ['The {place} {thing} starts soon, and the team sheet is a mess.', 'Coach {name} hands you the clipboard. "Sort this out, please."'],
    endings: ['The whistle blows, and the crowd is on its feet.', 'A lap of honor round the {place} {thing}.'],
    beats: {
      early: ['The {many} warm up on the side. Someone drops a ball.', 'The crowd starts to fill the stands.'],
      middle: ['Halftime oranges are passed round. {name} gives a thumbs up.', 'A drumbeat starts in the stands.'],
      late: ['Final minutes. The crowd goes quiet.', 'The {many} huddle up. One last push.'],
    },
  },
  cooking: {
    places: ['Saffron', 'Butterfield', 'Rosemary', 'Honeycomb', 'Cinnamon', 'Bramble'],
    things: ['Kitchen', 'Bakery', 'Bistro', 'Diner'],
    intros: ['The {place} {thing} opens tonight, and the recipe cards are all mixed up.', 'Chef {name} needs a plan before the ovens heat up.'],
    endings: ['The first plate goes out, and the room goes "Mmm".', 'The {place} {thing} is full, and every table is happy.'],
    beats: {
      early: ['Onions sizzle. The kitchen smells wonderful already.', '{name} tastes the sauce and adds a pinch of salt.'],
      middle: ['A timer pings. Bread out, pies in.', 'The {many} move round each other like dancers.'],
      late: ['Plates are warming. Nearly service time.', '{name} wipes down the counter and waits for you.'],
    },
  },
  pets: {
    places: ['Paw Print', 'Whisker', 'Feather', 'Puddle', 'Snuggle', 'Waggy'],
    things: ['Show', 'Shelter', 'Park', 'Club'],
    intros: ['Every pet at the {place} {thing} needs the right spot before the show begins.', '{name} has lost track of who goes where at the {place} {thing}.'],
    endings: ['Every pet gets a treat and a ribbon.', 'Tails wag all round the {place} {thing}.'],
    beats: {
      early: ['A puppy chases its own tail. Twice.', 'A cat watches you from the windowsill.'],
      middle: ['Someone tips over the water bowl. Towels, please.', '{name} brushes a very fluffy rabbit.'],
      late: ['The judges arrive. The {many} smooth down their pets.', 'A parrot says "Nearly!" Fair enough.'],
    },
  },
  town: {
    places: ['Maple', 'Main Street', 'Cobblestone', 'Brookside', 'Elm', 'Old Town'],
    things: ['Market', 'Fair', 'Square', 'Library'],
    intros: ['The {place} {thing} opens in the morning, and the plan is still on the back of an envelope.', '{name} from next door asks for a hand at the {place} {thing}.'],
    endings: ['The stalls open, and the whole street comes out.', 'The {many} of the {place} {thing} say thank you.'],
    beats: {
      early: ['The bakery lights come on. Coffee time.', 'A bus rumbles past. {name} waves.'],
      middle: ['Bunting goes up between the lampposts.', 'The {many} trade gossip by the fountain.'],
      late: ['The church clock strikes. Nearly opening time.', '{name} unlocks the door and looks back at you.'],
    },
  },
  parks: {
    places: ['Pine Ridge', 'Cedar Falls', 'Granite', 'Bear Creek', 'Aspen', 'Red Rock'],
    things: ['Trail', 'Canyon', 'Lookout', 'Meadow'],
    intros: ['The trail map for the {place} {thing} has washed out in the rain.', 'Ranger {name} needs the {place} {thing} sorted before the hikers arrive.'],
    endings: ['The view from the {place} {thing} is worth every step.', 'The {many} reach the top and cheer.'],
    beats: {
      early: ['A hawk circles overhead. The trail climbs.', '{name} stops to tie a bootlace.'],
      middle: ['A deer crosses the path and does not hurry.', 'The {many} share trail mix by a stream.'],
      late: ['The trees thin out. The summit is close.', 'The wind picks up. Nearly at the top.'],
    },
  },
  travel: {
    places: ['Seabreeze', 'Sunset', 'Coral Bay', 'Palm', 'Harborview', 'Lavender'],
    things: ['Resort', 'Hotel', 'Island', 'Station'],
    intros: ['The bookings at the {place} {thing} are a tangle.', '{name} has a suitcase, a ticket and one puzzle left before the trip.'],
    endings: ['The {many} kick off their shoes. Holiday starts now.', 'Postcards from the {place} {thing}: wish you were here.'],
    beats: {
      early: ['A suitcase wheel squeaks down the hall.', '{name} checks the tickets one more time.'],
      middle: ['The smell of sun cream and salt in the air.', 'A tour guide waves a little flag. The {many} follow.'],
      late: ['The bags are packed. Almost time to go.', 'The boarding call comes. Just one more thing.'],
    },
  },
  wonders: {
    places: ['Grand', 'Crystal', 'High Arch', 'Sandstone', 'Marble', 'Skyward'],
    things: ['Bridge', 'Dome', 'Tower', 'Palace'],
    intros: ['The plans for the {place} {thing} are old and faded.', 'Master {one} {name} needs one last check before the {place} {thing} opens.'],
    endings: ['The scaffolding comes down. The {place} {thing} stands tall.', 'The first visitors gasp at the {place} {thing}.'],
    beats: {
      early: ['Cranes swing slowly against the sky.', '{name} unrolls the plans and weighs the corners with stones.'],
      middle: ['The {many} stop for lunch on a high beam.', 'Sunlight falls through a new window for the first time.'],
      late: ['The last stone is lifted into place.', 'Ribbon and scissors are ready. Nearly done.'],
    },
  },
  music: {
    places: ['Velvet', 'Bluebird', 'Moonlight', 'Harmony', 'Golden Note', 'Echo'],
    things: ['Hall', 'Club', 'Festival', 'Studio'],
    intros: ['The set list for the {place} {thing} is all out of order.', '{name} the {one} needs the band sorted before the curtain goes up.'],
    endings: ['The last chord rings out, and the crowd roars.', 'An encore at the {place} {thing}, just for you.'],
    beats: {
      early: ['Someone tunes a guitar backstage.', '{name} hums a tune under their breath.'],
      middle: ['The drummer counts in, then stops. Not yet.', 'The hall fills up. The {many} peek round the curtain.'],
      late: ['The lights go down. A hush falls.', 'The {many} take their places. Almost showtime.'],
    },
  },
  nautical: {
    places: ['Saltwind', 'Gull Rock', 'Anchor', 'Tidewater', 'Bluewave', 'Lighthouse'],
    things: ['Harbor', 'Quay', 'Cove', 'Shipyard'],
    intros: ['The tide is turning at the {place} {thing}, and the ships are all in a muddle.', 'Captain {name} needs the charts sorted before the {many} set sail.'],
    endings: ['Sails up. The {many} head out on the tide.', 'A bell rings out across the {place} {thing}, just for you.'],
    beats: {
      early: ['Gulls squabble over a dropped sandwich.', 'Ropes creak as the ships rock at their moorings.'],
      middle: ['{name} squints at the horizon. Weather looks fair.', 'The {many} haul a crate up the gangplank.'],
      late: ['The tide is nearly high. Ready the lines.', 'The lighthouse blinks. Almost time to sail.'],
    },
  },
  farm: {
    places: ['Sunflower', 'Clover', 'Haystack', 'Apple Tree', 'Green Acre', 'Duck Pond'],
    things: ['Farm', 'Barn', 'Orchard', 'Fair'],
    intros: ['Market day at the {place} {thing}, and the plan is a muddle.', 'Farmer {name} could use a sharp mind at the {place} {thing}.'],
    endings: ['The cart is loaded, and the {many} wave it off.', 'Pie for everyone at the {place} {thing}.'],
    beats: {
      early: ['A rooster crows, a bit late.', 'The goats have found the gate again.'],
      middle: ['{name} wipes their boots and checks the list.', 'The ducks march across the yard in a line.'],
      late: ['The sun is setting over the fields.', 'The {many} lean on the fence and wait for you.'],
    },
  },
  science: {
    places: ['Bright Spark', 'Quantum', 'Beaker', 'Atom', 'Prism', 'Catalyst'],
    things: ['Lab', 'Institute', 'Workshop', 'Fair'],
    intros: ['The results at the {place} {thing} need checking before anyone can publish.', 'Dr. {name} hands you the notebook. "Something here does not add up."'],
    endings: ['The experiment works, and the {many} cheer.', 'A new discovery for the {place} {thing}, with your name on it.'],
    beats: {
      early: ['A beaker bubbles gently on the bench.', '{name} pushes their goggles up and leans in.'],
      middle: ['The data starts to show a pattern.', 'The {many} gather round the screen.'],
      late: ['One more test. Everyone steps back.', '{name} crosses their fingers.'],
    },
  },
  math: {
    places: ['Golden Ratio', 'Prime', 'Infinity', 'Fractal', 'Pi', 'Tangent'],
    things: ['Society', 'Seminar', 'Library', 'Club'],
    intros: ['The blackboard at the {place} {thing} holds a problem nobody has finished.', '{name} the {one} has an idea, but needs you to prove it.'],
    endings: ['The proof is complete. The {many} applaud.', 'Chalk dust settles on a solved board at the {place} {thing}.'],
    beats: {
      early: ['Chalk squeaks on the board. A pattern appears.', '{name} underlines something twice.'],
      middle: ['The {many} stop arguing and start nodding.', 'Someone fetches more chalk. This is getting good.'],
      late: ['One step left. The room goes still.', '{name} puts the chalk down and waits.'],
    },
  },
  biology: {
    places: ['Rainforest', 'Tidepool', 'Mossy', 'Fern Hollow', 'Coral', 'Wildwood'],
    things: ['Reserve', 'Field Station', 'Greenhouse', 'Lab'],
    intros: ['The survey sheets from the {place} {thing} got muddled in the rain.', '{name} the {one} needs a clear count before nightfall.'],
    endings: ['The survey is done, and the {many} pack up their nets.', 'The {place} {thing} has a new page in the notebook.'],
    beats: {
      early: ['A frog plops into the pond.', '{name} spots a beetle with a shiny green back.'],
      middle: ['Birdsong fills the trees.', 'The {many} compare notes under a big leaf.'],
      late: ['The light is fading. Last notes now.', 'A moth lands on the lamp. Nearly done.'],
    },
  },
  astronomy: {
    places: ['Starwatch', 'Comet', 'Moonrise', 'Aurora', 'Galaxy', 'Meteor'],
    things: ['Observatory', 'Dome', 'Hill', 'Camp'],
    intros: ['The sky charts at the {place} {thing} are out of order, and tonight is clear.', '{name} the {one} has the telescope ready, but not the plan.'],
    endings: ['The dome opens, and the night sky is perfect.', 'A shooting star crosses the sky over the {place} {thing}.'],
    beats: {
      early: ['The first stars come out.', '{name} adjusts the telescope a little.'],
      middle: ['The moon rises over the hill.', 'The {many} sip cocoa and wait.'],
      late: ['The clouds have cleared. Almost time.', '{name} points up. "There. Nearly."'],
    },
  },
  paradox: {
    places: ['Upside-Down', 'Melting Clock', 'Endless', 'Mirror', 'Floating', 'Backwards'],
    things: ['Staircase', 'Library', 'Garden', 'Teahouse'],
    intros: ['In the {place} {thing}, the doors open onto yesterday.', '{name} the {one} insists this puzzle solved itself tomorrow.'],
    endings: ['The {place} {thing} folds up neatly and makes sense, just for a moment.', 'The {many} applaud, a little before you finish.'],
    beats: {
      early: ['A clock ticks sideways.', 'A teacup refills itself. Nobody comments.'],
      middle: ['The stairs go up in both directions now.', '{name} waves at you from two places at once.'],
      late: ['The ceiling is starting to look like a floor.', 'The {many} are already celebrating. Odd.'],
    },
  },
  seasons: {
    places: ['Springtime', 'Midsummer', 'Harvest', 'First Frost', 'Blossom', 'Maple Leaf'],
    things: ['Festival', 'Fair', 'Garden', 'Picnic'],
    intros: ['The {place} {thing} is this weekend, and nobody has a plan.', '{name} has the bunting, the tables and one big puzzle.'],
    endings: ['The {place} {thing} is a great success.', 'The {many} toast the season, and you.'],
    beats: {
      early: ['A breeze carries the smell of cut grass.', '{name} hangs the first string of lights.'],
      middle: ['Children race round the tables.', 'The {many} set out lemonade in the shade.'],
      late: ['The sun dips low. Almost time to start.', '{name} looks round, pleased. Nearly there.'],
    },
  },
};
