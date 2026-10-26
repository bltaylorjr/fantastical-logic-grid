// More story parts, added in the October 2026 player upgrade for the two
// themes players pick most (Holiday and Special Occasion), so their stories
// keep feeling new. Keyed by story key: a theme id for its classic topic, or
// "theme/topic". topics.js appends these to the end of each list when it
// loads; appending (never inserting) keeps every saved story id pointing at
// the same parts. Same rules as every other part: stay in the topic's own
// setting, and never name a grid item or a cast name.

export const MORE_STORIES = {
  holiday: {
    adjs: ['Glowing', 'Wintry'],
    openings: [
      'Sleigh tracks led up the hill to the farmhouse, where {n} {many} had come for the holidays.',
      '{N} {many} bundled up in mittens for a holiday walk through the village.',
      '{N} {many} filled the old inn on Maple Hill, where a fire crackled all night.',
      '{N} {many} spent a snowy afternoon building a toy village for the fair.',
    ],
    incidents: [
      { name: 'Snowman', text: 'A grand snowman appeared in the yard overnight, wearing Grandpa\'s old hat.', prize: 'the snowman prize' },
      { name: 'Sled', text: 'Someone waxed the old wooden sled until it flew down the hill.', prize: 'the fastest sled award' },
      { name: 'Carol', text: 'A lovely carol was sung at the window, but the singer slipped away.', prize: 'the caroling cup' },
      { name: 'Recipe', text: 'Great-Grandma\'s lost cocoa recipe turned up tucked inside a cookbook.', prize: 'the cocoa recipe' },
    ],
    mishaps: [
      'The holiday letter went out with all the names mixed up.',
      'Grandpa told the story so many times that every version is different.',
      'Snow covered the footprints before anyone could follow them.',
      'The note on the fridge fell behind it, and only a corner can be read.',
    ],
    endings: [
      '{Fact}, so {winner} gets {prize} and a cup of hot cider.',
      '{Fact}! {winner} takes a bow while snow falls outside.',
      'The holiday mystery is solved. {Fact}, and {winner} gets to open the first present.',
      '{Fact}. The cousins chant {winner}\'s name around the fireplace.',
    ],
  },
  'holiday/halloween': {
    adjs: ['Shadowy', 'Eerie'],
    openings: [
      '{N} {many} gathered under a crooked streetlamp, ready for a night of treats.',
      'The haunted hayride left the farm at dusk with {n} {many} aboard.',
      'Dry leaves swirled down the sidewalk as {n} {many} rang the first doorbell.',
      '{N} {many} met at the creaky gate of the old cemetery for the neighborhood tour.',
    ],
    incidents: [
      { name: 'Lantern', text: 'Someone lit every jack-o\'-lantern on the block before sunset.', prize: 'the lantern lighter badge' },
      { name: 'Maze', text: 'One brave explorer found the way out of the corn maze first.', prize: 'the corn maze ribbon' },
      { name: 'Doorbell', text: 'A spooky doorbell that howls was fixed by a mystery helper.', prize: 'the howling doorbell' },
      { name: 'Treat Trail', text: 'A trail of wrapped treats led to a hidden prize in the hedge.', prize: 'the hidden prize' },
    ],
    mishaps: [
      'The flashlight batteries died, so nobody saw who went where.',
      'Fake cobwebs got tangled all over the party list.',
      'Everyone swapped masks halfway through the night.',
      'The fog machine filled the yard, and the details vanished with it.',
    ],
    endings: [
      '{Fact}, so {winner} wins {prize} and a spooky round of applause.',
      '{Fact}! {winner} takes off their mask and grins.',
      'The spooky secret is out. {Fact}, and the porch lights blink in celebration.',
      '{Fact}. {winner} leads everyone home under the full moon.',
    ],
  },
  'holiday/thanksgiving': {
    adjs: ['Thankful', 'Autumn'],
    openings: [
      '{N} {many} spent Thanksgiving at a lakeside cabin with a giant wooden table.',
      'The smell of fresh bread filled the house as {n} {many} arrived.',
      'Grandma\'s big kitchen was busy from sunrise, with {n} {many} lending a hand.',
      '{N} {many} took a long autumn walk before the feast began.',
    ],
    incidents: [
      { name: 'Gratitude Jar', text: 'A jar of kind notes for every guest was filled in secret.', prize: 'the gratitude jar' },
      { name: 'Rolls', text: 'Someone baked a basket of warm rolls that vanished in minutes.', prize: 'the best baker ribbon' },
      { name: 'Tablecloth', text: 'Grandma\'s old tablecloth was mended and pressed by a mystery helper.', prize: 'the tablecloth thank-you' },
      { name: 'Kids Table', text: 'The little ones\' table was decorated with handmade leaf garlands.', prize: 'the decorating prize' },
    ],
    mishaps: [
      'The seating cards were shuffled when the dog ran under the table.',
      'Everyone was so full that nobody remembers a thing.',
      'Grandpa told the story at dinner, but he told it backward.',
      'The recipe cards and the helper list got stacked together.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and the very last piece of dessert.',
      '{Fact}. Everyone around the table claps for {winner}.',
      'Mystery solved! {Fact}, and Grandma says {winner} can pick the movie tonight.',
      '{Fact}, so {winner} is the star of this year\'s Thanksgiving photo.',
    ],
  },
  'holiday/july4': {
    adjs: ['Bright', 'Summery'],
    openings: [
      '{N} {many} rode decorated bikes down Main Street on the Fourth of July.',
      'The whole block closed off the street for a summer picnic, and {n} {many} came.',
      '{N} {many} claimed a spot on the hill to see the sky light up.',
      'Red, white and blue bunting hung from every fence as {n} {many} arrived.',
    ],
    incidents: [
      { name: 'Flag', text: 'Someone raised the town flag at sunrise before anyone else was awake.', prize: 'the early riser award' },
      { name: 'Bike Parade', text: 'The best decorated bike in the parade has not been named yet.', prize: 'the bike parade ribbon' },
      { name: 'Cooler', text: 'A cooler full of icy drinks appeared just when everyone was thirsty.', prize: 'the cool helper medal' },
      { name: 'Anthem', text: 'A mystery singer led the whole crowd in the anthem.', prize: 'the anthem honor' },
    ],
    mishaps: [
      'Sticky fingers smeared the picnic plan.',
      'The loudspeaker crackled, so every announcement was a jumble.',
      'Everyone was squinting in the bright sun, so nobody saw clearly.',
      'A sudden summer shower soaked the sign-in sheet.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and the best seat for the show.',
      '{Fact}. The whole block gives {winner} a round of applause.',
      'Mystery solved! {Fact}, and the night sky booms in celebration.',
      '{Fact}, so {winner} gets to lead next year\'s bike parade.',
    ],
  },
  'holiday/valentines': {
    adjs: ['Tender', 'Charming'],
    openings: [
      '{N} {many} met at the skating rink for a Valentine\'s skate.',
      'The library held a card-making morning, and {n} {many} came.',
      '{N} {many} baked heart-shaped treats for the neighbors.',
      'Paper hearts hung in every window as {n} {many} walked to school.',
    ],
    incidents: [
      { name: 'Mailbox', text: 'The class valentine mailbox was built and painted by a mystery helper.', prize: 'the mailbox prize' },
      { name: 'Kind Notes', text: 'Every locker had a kind note tucked inside it.', prize: 'the kindness ribbon' },
      { name: 'Cookie Card', text: 'A giant cookie shaped like a card appeared in the lunchroom.', prize: 'the cookie card' },
      { name: 'Serenade', text: 'Someone played a sweet tune for the lunch ladies.', prize: 'the serenade award' },
    ],
    mishaps: [
      'The glue on the cards stuck all the name tags together.',
      'The heart stickers covered up the sign-up sheet.',
      'Everyone giggled so much that nobody kept track.',
      'The teacher\'s list fell into the punch bowl.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a paper crown of hearts.',
      '{Fact}. Everyone sends {winner} a thank-you card.',
      'The sweet secret is out. {Fact}, and {winner} smiles from ear to ear.',
      '{Fact}, so {winner} gets the first pick from the treat jar.',
    ],
  },
  'holiday/newyear': {
    adjs: ['Dazzling', 'Fresh'],
    openings: [
      '{N} {many} stayed up late at a cozy cabin to ring in the new year.',
      'The ferry boat\'s deck was packed with {n} {many} waiting for midnight.',
      '{N} {many} played board games until the clock neared midnight.',
      'Streamers covered the hall as {n} {many} found their seats.',
    ],
    incidents: [
      { name: 'Time Capsule', text: 'A time capsule of wishes was sealed by a mystery helper.', prize: 'the time capsule' },
      { name: 'Streamers', text: 'Every streamer in the hall was hung before anyone arrived.', prize: 'the decorating medal' },
      { name: 'Playlist', text: 'The perfect midnight playlist was put together in secret.', prize: 'the music award' },
      { name: 'Pancakes', text: 'Someone made a mountain of pancakes for New Year\'s morning.', prize: 'the pancake prize' },
    ],
    mishaps: [
      'Streamers tangled around the guest list.',
      'Everyone was so sleepy after midnight that the details are fuzzy.',
      'The countdown cheers drowned out every conversation.',
      'The party notes were swept up with the confetti.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and the first cheer of the new year.',
      '{Fact}. Everyone hugs {winner} as the clock strikes midnight.',
      'Mystery solved! {Fact}, and the new year begins with a big cheer.',
      '{Fact}, so {winner} gets to make the first wish of the year.',
    ],
  },
  'holiday/easter': {
    adjs: ['Blossoming', 'Cheerful'],
    openings: [
      '{N} {many} rolled eggs down the grassy hill behind Grandma\'s house.',
      'Spring rain had just stopped as {n} {many} set off with their baskets.',
      '{N} {many} met at the farm to see the new spring lambs.',
      'Bright spring blossoms lined the path as {n} {many} came for brunch.',
    ],
    incidents: [
      { name: 'Riddle', text: 'Someone hid a riddle in every egg, and one led to a prize.', prize: 'the riddle prize' },
      { name: 'Bunny Ears', text: 'Fuzzy bunny ears were made by hand for every little one.', prize: 'the craft ribbon' },
      { name: 'Brunch', text: 'The whole spring brunch was cooked before anyone woke up.', prize: 'the brunch medal' },
      { name: 'Egg Tree', text: 'A tree hung with painted eggs appeared in the yard.', prize: 'the egg tree prize' },
    ],
    mishaps: [
      'The egg hunt clues were mixed up with the shopping list.',
      'A puppy ran off with the hunt map.',
      'Everyone was so excited that the hunt was a blur.',
      'Spring showers washed the chalk arrows away.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a big spring hug.',
      '{Fact}. The cousins cheer as {winner} takes a bow.',
      'Mystery solved! {Fact}, and everyone sits down for brunch.',
      '{Fact}, so {winner} gets to hide the eggs next year.',
    ],
  },
  occasion: {
    adjs: ['Joyful', 'Dazzling'],
    openings: [
      '{N} {many} gathered on a rooftop terrace for a summer celebration.',
      'A garden party under paper lanterns welcomed {n} {many}.',
      'The old train station was turned into a party hall for {n} {many}.',
      '{N} {many} came to a surprise party at the community pool.',
    ],
    incidents: [
      { name: 'Guest Book', text: 'Someone filled the guest book with sweet drawings.', prize: 'the guest book prize' },
      { name: 'Banner', text: 'A giant handmade banner was hung over the door in secret.', prize: 'the banner award' },
      { name: 'Playlist', text: 'A mystery guest put together the perfect party playlist.', prize: 'the music prize' },
      { name: 'Fireflies', text: 'Someone strung tiny lights in the trees just before dark.', prize: 'the twinkle award' },
    ],
    mishaps: [
      'The party favors got mixed up with the name cards.',
      'Confetti cannons went off right over the guest list.',
      'The host kept changing the plan, so the notes make no sense.',
      'Everyone was laughing so hard that nobody kept track.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and the last dance of the night.',
      '{Fact}. Everyone lifts a glass to {winner}.',
      'The party secret is out. {Fact}, and {winner} gets a standing ovation.',
      '{Fact}, so {winner} takes home {prize} and a big slice of cake.',
    ],
  },
  'occasion/birthday': {
    adjs: ['Bubbly', 'Merry'],
    openings: [
      'A roller rink birthday party brought {n} {many} out for a spin.',
      '{N} {many} came to a costume birthday party in the backyard.',
      'The birthday star\'s house was covered in streamers when {n} {many} arrived.',
      '{N} {many} met at the park for a picnic birthday bash.',
    ],
    incidents: [
      { name: 'Big Wish', text: 'Someone lifted the little birthday star up high to make a wish.', prize: 'the wish helper award' },
      { name: 'Crown', text: 'A sparkly birthday crown was made by hand and left on the chair.', prize: 'the birthday crown' },
      { name: 'Party Bags', text: 'Every guest found a party bag with their name on it.', prize: 'the party bag prize' },
      { name: 'Card', text: 'A giant card was signed by everyone, but nobody knows who started it.', prize: 'the giant card' },
    ],
    mishaps: [
      'The party bags got mixed up, and so did the notes.',
      'Wrapping paper flew everywhere, and the list went with it.',
      'Everyone was singing so loudly that nobody heard a word.',
      'The birthday star opened gifts so fast that nobody kept track.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and an extra party bag.',
      '{Fact}. The birthday star cheers for {winner}.',
      'Mystery solved! {Fact}, and the party ends with one more song.',
      '{Fact}, so {winner} gets to cut the next cake.',
    ],
  },
  'occasion/wedding': {
    adjs: ['Romantic', 'Moonlit'],
    openings: [
      '{N} {many} gathered in a vineyard for a sunset wedding.',
      'A wedding on a riverboat welcomed {n} {many} aboard.',
      '{N} {many} found their seats under a big white tent.',
      'Fairy lights twinkled in the orchard as {n} {many} arrived for the wedding.',
    ],
    incidents: [
      { name: 'Veil', text: 'The veil snagged on a branch, and someone freed it just in time.', prize: 'the veil rescue' },
      { name: 'Sparklers', text: 'Someone handed out sparklers for the couple\'s grand exit.', prize: 'the sparkler send-off' },
      { name: 'Vows', text: 'A guest helped the couple write their vows in secret.', prize: 'the vow helper honor' },
      { name: 'Getaway Car', text: 'The getaway car was decorated with ribbons and tin cans.', prize: 'the getaway car prize' },
    ],
    mishaps: [
      'The ring bearer dropped the notes into the fountain.',
      'Everyone was crying happy tears, so nobody saw clearly.',
      'The place cards got shuffled by a gust of wind.',
      'The wedding video froze right at the important part.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a dance with the couple.',
      '{Fact}. The happy couple raise a glass to {winner}.',
      'What a celebration! {Fact}, and everyone throws petals.',
      '{Fact}, so {winner} gets the first slice of wedding cake.',
    ],
  },
  'occasion/graduation': {
    adjs: ['Shining', 'Brilliant'],
    openings: [
      '{N} {many} lined up in caps and gowns on the football field.',
      'A party at the pizza parlor celebrated {n} {many}.',
      '{N} {many} signed yearbooks under the old oak tree.',
      'The auditorium buzzed as {n} {many} waited for their names.',
    ],
    incidents: [
      { name: 'Yearbook', text: 'Someone collected a kind message for everyone\'s yearbook.', prize: 'the yearbook award' },
      { name: 'Tassel', text: 'A lost tassel was found and sewn back on just in time.', prize: 'the tassel rescue' },
      { name: 'Thank-You', text: 'The teachers each got a thank-you card from a mystery student.', prize: 'the thank-you honor' },
      { name: 'Class Gift', text: 'The class gift to the school was planned in secret.', prize: 'the class gift prize' },
    ],
    mishaps: [
      'The name cards for the stage got shuffled.',
      'Everyone threw their caps at once, and the notes went flying.',
      'The microphone squealed, so nobody heard the announcements.',
      'The program was printed with the pages out of order.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a cheer from the whole class.',
      '{Fact}. The principal shakes {winner}\'s hand.',
      'Mystery solved! {Fact}, and the class takes one last photo.',
      '{Fact}, so {winner} gets to toss the first cap next year.',
    ],
  },
  'occasion/anniversary': {
    adjs: ['Treasured', 'Timeless'],
    openings: [
      '{N} {many} gathered at the lake cottage where the couple spent their honeymoon.',
      'The town hall was decorated with old photos as {n} {many} arrived.',
      '{N} {many} came to a picnic for the couple in the park where they first met.',
      'A surprise brunch for the happy couple brought {n} {many} together.',
    ],
    incidents: [
      { name: 'Map', text: 'Someone drew a map of every place the couple has lived.', prize: 'the memory map' },
      { name: 'Vow Renewal', text: 'A guest secretly arranged for the couple to renew their vows.', prize: 'the vow renewal honor' },
      { name: 'First Date', text: 'The couple\'s first date was recreated, right down to the menu.', prize: 'the first date surprise' },
      { name: 'Quilt', text: 'A quilt made from old family shirts was given with no card.', prize: 'the memory quilt' },
    ],
    mishaps: [
      'The old photos got mixed up with the new ones.',
      'Grandpa kept telling the story differently each time.',
      'The card table tipped over, and every note went flying.',
      'The guest list was written in pencil and smudged.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a dance with the couple.',
      '{Fact}. The couple holds hands and thanks {winner}.',
      'What a celebration! {Fact}, and everyone tells their favorite story.',
      '{Fact}, so {winner} gets a spot in the family photo.',
    ],
  },
  'occasion/babyshower': {
    adjs: ['Gentle', 'Snuggly'],
    openings: [
      '{N} {many} came to a picnic shower in the park.',
      'A cozy brunch shower filled the kitchen with {n} {many}.',
      '{N} {many} brought gifts to a shower at the community center.',
      'Pastel balloons bobbed by the door as {n} {many} arrived.',
    ],
    incidents: [
      { name: 'Lullaby', text: 'A guest wrote a lullaby just for the new baby.', prize: 'the lullaby honor' },
      { name: 'Nursery', text: 'Someone painted stars on the nursery ceiling in secret.', prize: 'the nursery surprise' },
      { name: 'Wishes', text: 'A jar of wishes for the baby was filled by a mystery helper.', prize: 'the wish jar' },
      { name: 'Meals', text: 'A freezer full of meals was cooked for the new parents.', prize: 'the helper prize' },
    ],
    mishaps: [
      'The gift tags fell off when the bows were tied.',
      'The guessing game cards got mixed into the gift pile.',
      'Everyone cooed over the tiny clothes and forgot the details.',
      'A toddler guest colored all over the guest book.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a thank-you card.',
      '{Fact}. The parents-to-be thank {winner} with a hug.',
      'Mystery solved! {Fact}, and everyone toasts the new baby.',
      '{Fact}, so {winner} gets to babysit first.',
    ],
  },
  'occasion/retirement': {
    adjs: ['Grateful', 'Cheerful'],
    openings: [
      '{N} {many} filled the old lunchroom for a farewell party.',
      'A backyard cookout for the retiree drew {n} {many}.',
      '{N} {many} waved goodbye at a send-off on the front steps.',
      'Balloons and old photos covered the lobby as {n} {many} came.',
    ],
    incidents: [
      { name: 'Bench', text: 'A bench with the retiree\'s name was set up outside the front door.', prize: 'the bench of honor' },
      { name: 'Scrapbook', text: 'Someone collected a page of memories from every coworker.', prize: 'the scrapbook' },
      { name: 'Golf Clubs', text: 'A new set of golf clubs was wrapped with a big bow.', prize: 'the golf club gift' },
      { name: 'Last Bell', text: 'Someone rang the old bell to mark the very last shift.', prize: 'the last bell honor' },
    ],
    mishaps: [
      'Everyone kept telling stories, so the timeline is a mess.',
      'The farewell slides were shown in the wrong order.',
      'The sign-up sheet was used as a coaster.',
      'Old memos got mixed in with the party notes.',
    ],
    endings: [
      '{Fact}! {winner} gets {prize} and a thank-you from the boss.',
      '{Fact}. The retiree laughs and hugs {winner}.',
      'What a send-off! {Fact}, and everyone signs the farewell card.',
      '{Fact}, so {winner} gets the retiree\'s old desk plant.',
    ],
  },
};
