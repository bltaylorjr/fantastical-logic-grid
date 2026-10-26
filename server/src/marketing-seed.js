// Starter campaigns for the admin Marketing section (marketing.js). Each one is
// added once, the first time the section opens after it ships, as drafts to
// check before posting. After that the dashboard is the record: changes made
// there are never overwritten from here, and a deleted campaign stays deleted.
//
// In an ad's words, {link} stands for its tracked link (the dashboard fills it
// in when it shows or copies the ad). Every channel here is free to use.
const REPO = 'https://github.com/bltaylorjr/fantastical-logic-grid';
const RAW = `${REPO}/raw/main`;

export const SEEDS = [{
  id: 'launch-2026',
  media: {
    promoWide: { title: 'Promo video, 90 s, 16:9', kind: 'video', url: `${RAW}/media/promo/the-fantastical-logic-grid-promo-16x9.mp4`, preview: '/admin/marketing-promo-16x9.png', size: '1920x1080, 90 s', notes: 'Upload the .srt captions with it (media/promo).' },
    promoWideCap: { title: 'Promo video, 90 s, 16:9, captions burned in', kind: 'video', url: `${RAW}/media/promo/the-fantastical-logic-grid-promo-16x9-captioned.mp4`, preview: '/admin/marketing-promo-16x9.png', size: '1920x1080, 90 s', notes: 'For feeds that play with the sound off (Facebook, X, LinkedIn).' },
    promoTall: { title: 'Promo video, 30 s, vertical, captions burned in', kind: 'video', url: `${RAW}/media/promo/the-fantastical-logic-grid-promo-9x16-captioned.mp4`, preview: '/admin/marketing-promo-9x16.png', size: '1080x1920, 30 s', notes: 'TikTok, Instagram Reels, YouTube Shorts, Facebook Reels.' },
    square: { title: 'Square post picture', kind: 'image', url: `${RAW}/media/marketing/square-1080.png`, preview: '/admin/marketing-square.png', size: '1080x1080', notes: 'Instagram and Facebook feed posts.' },
    wide: { title: 'Wide post picture', kind: 'image', url: `${RAW}/media/marketing/wide-1600x900.png`, preview: '/admin/marketing-wide.png', size: '1600x900', notes: 'X, Bluesky, Threads, Mastodon, LinkedIn, Reddit.' },
    pin: { title: 'Pinterest pin (printable puzzles)', kind: 'image', url: `${RAW}/media/marketing/pin-1000x1500.png`, preview: '/admin/marketing-pin.png', size: '1000x1500', notes: 'Tall pins get the most room in Pinterest feeds.' },
    gallery: { title: 'Gallery picture (Product Hunt, itch.io, directories)', kind: 'image', url: `${RAW}/media/marketing/gallery-1270x760.png`, preview: '/admin/marketing-gallery.png', size: '1270x760', notes: '' },
    cover: { title: 'itch.io cover', kind: 'image', url: `${RAW}/media/marketing/itch-cover-630x500.png`, preview: '/admin/marketing-cover.png', size: '630x500', notes: '' },
  },
  campaign: {
    code: 'launch-2026',
    name: 'Launch on free channels',
    status: 'active',
    starts: '2026-11-02',
    ends: '2026-12-31',
    goal: 'First players from free channels: visits, first puzzles solved and installs. Every link is tracked, so the table below shows which posts bring players who stay.',
    notes: 'Free channels only. Bobby approved every ad on 2026-10-26. Set an ad to Posted with the post link once it is live. Check each community\'s self-promotion rules on the day you post.',
  },
  // Bobby approved all of these on 2026-10-26.
  adStatus: 'approved',
  ads: [
    {
      channel: 'reddit', medium: 'forum', content: 'webgames-launch', media: ['wide'], where: 'https://www.reddit.com/r/WebGames/',
      title: 'r/WebGames: launch post',
      body: 'The Fantastical Logic Grid: logic grid puzzles where every puzzle comes with its own short story (free, plays in the browser)\n\n{link}\n\nPick a theme (mystery, fantasy, sci-fi, national parks and more), a difficulty from Basic to Quantum Physicist and a grid size, and it writes a new story with a cast and clues to match. Every puzzle has exactly one answer, and the hints explain the next step instead of just giving it away.\n\nNo sign-up needed. It saves your progress, prints with an answer key, and works offline once loaded. Feedback welcome!',
      notes: 'Post as a link post with the title above. Reply to comments in the first hour.',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'logicpuzzles-daily', media: ['wide'], where: 'https://www.reddit.com/r/logicpuzzles/',
      title: 'r/logicpuzzles: daily puzzle',
      body: 'I made a free logic grid game with a new daily puzzle every day (same puzzle for everyone)\n\nEach puzzle has a little story and a cast of characters, and the grid fills in as you mark it. Difficulty runs from Basic to Quantum Physicist, and every hint shows the reasoning step instead of revealing the answer.\n\nToday\'s puzzle: {link}\n\nI would love to hear whether the harder levels feel fair.',
      notes: 'Read the sidebar rules first; some puzzle subreddits want the puzzle itself in the post. If so, post a printed page as a picture with the link in a comment.',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'sideproject-story', media: ['wide'], where: 'https://www.reddit.com/r/SideProject/',
      title: 'r/SideProject: the maker story',
      body: 'I built a logic grid puzzle game that writes a fresh story for every puzzle\n\n{link}\n\nWhat it does: you choose a theme, difficulty and size; it builds a puzzle with exactly one solution, writes a short story and cast around it, and gives step-by-step hints. There is a daily puzzle, races against other players, a scoreboard and printing with answer keys.\n\nIt runs entirely on free tiers: a static site, one small server for accounts and races, and free on-device voices for read-aloud. Happy to answer questions about how the puzzles are generated.',
      notes: '',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'playmygame', media: ['promoWide'], where: 'https://www.reddit.com/r/playmygame/',
      title: 'r/playmygame: video post',
      body: '[Browser/Windows] The Fantastical Logic Grid: story-driven logic grid puzzles, free\n\n{link}\n\nNew story every puzzle, six difficulty levels, daily puzzle, races and printable answer keys. Looking for feedback on the tutorial and the first Easy puzzle.',
      notes: 'Upload the 90 s promo as the video.',
    },
    {
      channel: 'facebook', medium: 'social', content: 'page-video', media: ['promoWideCap'], where: 'Your Facebook Page for the game (Bobby creates it, see the setup email)',
      title: 'Facebook Page: launch video',
      body: 'Meet The Fantastical Logic Grid 🧩\n\nEvery puzzle comes with its own story: a stolen crown at the castle, a mix-up at the bake sale, a mystery in the national park. Pick your theme and difficulty, then work out who did what, where and when.\n\n✔ Free, plays in your browser\n✔ A new daily puzzle for everyone\n✔ Hints that teach, not tell\n✔ Print it with an answer key\n\nPlay now: {link}',
      notes: 'Pin this post to the top of the Page.',
    },
    {
      channel: 'facebook', medium: 'community', content: 'groups-printable', media: ['square'], where: 'Puzzle, brain-teaser, homeschool and activity-idea groups that allow sharing free resources',
      title: 'Facebook groups: free printable puzzles',
      body: 'Free printable logic puzzles, made fresh every time 🧩\n\nYou pick the theme (pets, cooking, sports, holidays and more) and the level, from Basic for beginners to Quantum Physicist. Each one prints with the story, the clues, the grid and an answer key on its own page. Great for brain breaks, puzzle night or a quiet afternoon.\n\nMake one here: {link}',
      notes: 'Only post where the group rules allow it, and no more than one group a day.',
    },
    {
      channel: 'instagram', medium: 'social', content: 'reel-launch', media: ['promoTall'], where: 'Instagram account for the game',
      title: 'Instagram Reel: launch',
      body: 'Every puzzle tells a story. 🧩✨ Pick a theme, choose your level, and crack the case clue by clue. Free to play, link in bio.\n\n#logicpuzzle #puzzlegame #braingames #brainteaser #puzzles #logicgrid #mysterygame #freegames',
      notes: 'Instagram does not make links in captions clickable: put {link} in the profile bio for the launch week.',
    },
    {
      channel: 'instagram', medium: 'social', content: 'post-square', media: ['square'], where: 'Instagram account for the game',
      title: 'Instagram post: square picture',
      body: 'Who borrowed the lighthouse keeper\'s lantern? Only the clues know. 🔦\n\nThe Fantastical Logic Grid writes a brand-new story for every puzzle, from Basic to Quantum Physicist. Free to play in your browser, link in bio.\n\n#logicpuzzles #puzzlelover #brainteasers #puzzletime #gamenight',
      notes: '',
    },
    {
      channel: 'tiktok', medium: 'video', content: 'launch-30s', media: ['promoTall'], where: 'TikTok account for the game',
      title: 'TikTok: 30 second launch',
      body: 'Every logic puzzle comes with its own story 🧩 Which level would you try first: Easy or Quantum Physicist? Free to play, link in bio. #logicpuzzle #puzzle #braingames #brainteaser #puzzlegame',
      notes: 'Links in bio need a set follower count on some accounts; until then say "search The Fantastical Logic Grid".',
    },
    {
      channel: 'youtube', medium: 'video', content: 'promo-90s', media: ['promoWide'], where: 'YouTube channel for the game',
      title: 'YouTube: 90 second promo',
      body: 'Title: The Fantastical Logic Grid: logic puzzles with a story (free browser game)\n\nDescription:\nEvery puzzle in The Fantastical Logic Grid comes with its own story and cast. Choose a theme and a level from Basic to Quantum Physicist, then use the clues to work out who did what. A new daily puzzle, races against other players, hints that explain each step, and printing with answer keys.\n\nPlay free: {link}\n\nChapters\n0:00 Pick a theme and level\n0:20 A new story every time\n0:40 Hints that teach\n1:00 Races and the scoreboard\n1:15 Print, save and install',
      notes: 'Upload the clean video with the 16x9 .srt captions. Check the chapter times against the video before posting.',
    },
    {
      channel: 'youtube', medium: 'video', content: 'shorts-30s', media: ['promoTall'], where: 'YouTube channel for the game (Shorts)',
      title: 'YouTube Shorts: 30 second cut',
      body: 'Title: Logic puzzles, but every one has a story #shorts\n\nDescription: Free to play: {link}',
      notes: '',
    },
    {
      channel: 'x', medium: 'social', content: 'launch-video', media: ['promoWideCap'], where: 'X account for the game',
      title: 'X: launch post',
      body: 'Logic grid puzzles, but every one comes with its own story. 🧩\n\nPick a theme, pick a level (Basic to Quantum Physicist), solve. Free in your browser, with a new daily puzzle every day.\n\n{link}',
      notes: '',
    },
    {
      channel: 'bluesky', medium: 'social', content: 'launch', media: ['wide'], where: 'Bluesky account for the game',
      title: 'Bluesky: launch post',
      body: 'I made a free logic grid puzzle game where every puzzle gets its own little story, from a castle mystery to a bake-sale mix-up. Six levels, a daily puzzle, and hints that explain the reasoning. 🧩\n\n{link}',
      notes: 'Add alt text to the picture.',
    },
    {
      channel: 'threads', medium: 'social', content: 'launch', media: ['square'], where: 'Threads account for the game',
      title: 'Threads: launch post',
      body: 'Puzzle people: would you rather start on Easy or jump straight to Quantum Physicist? 🧩\n\nThe Fantastical Logic Grid writes a new story for every logic puzzle. Free in your browser: {link}',
      notes: '',
    },
    {
      channel: 'mastodon', medium: 'social', content: 'launch', media: ['wide'], where: 'A Mastodon account on a general or games server',
      title: 'Mastodon: launch post',
      body: 'The Fantastical Logic Grid is a free browser game of logic grid puzzles, each with its own short story and cast. It works offline once loaded, prints with an answer key, has a high-contrast mode and can read the clues aloud.\n\n{link}\n\n#LogicPuzzles #Puzzles #BrowserGames #IndieGames',
      notes: 'Mastodon readers value accessibility and alt text: describe the picture.',
    },
    {
      channel: 'pinterest', medium: 'social', content: 'printable-pin', media: ['pin'], where: 'Pinterest business account (free), boards: Printable Logic Puzzles, Brain Games, Puzzle Night',
      title: 'Pinterest: printable puzzles pin',
      body: 'Pin title: Free Printable Logic Puzzles with Answer Keys\n\nDescription: Make a new logic grid puzzle in seconds: choose a theme (pets, sports, holidays, cooking, mysteries) and a level from beginner to Quantum Physicist. Each one prints with a story, clues, the grid and an answer key on a separate page. Great for brain breaks, classrooms and puzzle night.\n\nLink: {link}',
      notes: 'Pinterest pins keep bringing visits for months; add one new pin a week with a different theme.',
    },
    {
      channel: 'linkedin', medium: 'social', content: 'maker-post', media: ['wide'], where: 'Bobby\'s LinkedIn profile',
      title: 'LinkedIn: the maker post',
      body: 'I just launched The Fantastical Logic Grid, a free logic puzzle game where every puzzle is generated with its own story.\n\nA few things I cared about while building it:\n• Every puzzle has exactly one solution, checked by a solver before you see it\n• Hints explain the reasoning instead of handing over the answer\n• Accessible from the start: keyboard and screen-reader play, high contrast, read-aloud, 100 languages\n• Runs entirely on free tiers\n\nIf you like puzzles, or know a teacher who does, I would love your feedback: {link}',
      notes: '',
    },
    {
      channel: 'hackernews', medium: 'community', content: 'show-hn', media: [], where: 'https://news.ycombinator.com/submit',
      title: 'Show HN',
      body: 'Title: Show HN: A logic grid puzzle generator that writes a story for each puzzle\n\nURL: {link}\n\nFirst comment: Hi HN. This builds classic logic grid ("Einstein") puzzles from a theme, a size and a difficulty. A solver checks each one has a single solution and grades it by the techniques needed, from simple elimination up to what-if reasoning for the Quantum Physicist level. A story engine then writes the setting, cast and clue wording around the answer, and never reuses a story. It is a static PWA plus one Cloudflare Worker for accounts and races, all on free tiers. Happy to talk about the generator.',
      notes: 'Post on a weekday morning US Eastern and stay around to answer comments.',
    },
    {
      channel: 'producthunt', medium: 'directory', content: 'launch', media: ['gallery', 'promoWide'], where: 'https://www.producthunt.com/posts/new',
      title: 'Product Hunt launch',
      body: 'Name: The Fantastical Logic Grid\nTagline: Logic grid puzzles with a new story every time\n\nDescription: Pick a theme and a level from Basic to Quantum Physicist, and get a brand-new logic puzzle with its own story and cast. Hints teach each step, there is a daily puzzle for everyone, races and a scoreboard, and every puzzle prints with an answer key. Free in the browser, with a Windows app.\n\nLink: {link}\n\nMaker comment: I built this because I loved logic grid puzzle books but always ran out of puzzles. Now there is a fresh one whenever you want it.',
      notes: 'Launch at 12:01 am Pacific on a Tuesday to Thursday. Free to list.',
    },
    {
      channel: 'itch', medium: 'store', content: 'game-page', media: ['cover', 'gallery'], where: 'https://itch.io/game/new',
      title: 'itch.io game page',
      body: 'Kind: HTML (played in the browser) or an external link to the website\n\nShort description: Logic grid puzzles with a new story every time.\n\nPage text: The Fantastical Logic Grid builds a brand-new logic puzzle whenever you want one, with its own story, cast and clues. Choose from 14 themes and six levels, from Basic to Quantum Physicist. Every puzzle has exactly one answer, the hints explain each step, and you can print any puzzle with an answer key.\n\nPlay the full version on the website: {link}\n\nTags: puzzle, logic, deduction, mystery, casual, singleplayer, accessibility',
      notes: 'Set the price to "No payments" (free). Genre: Puzzle.',
    },
    {
      channel: 'indiehackers', medium: 'community', content: 'launch-post', media: [], where: 'https://www.indiehackers.com/',
      title: 'Indie Hackers: launch post',
      body: 'Launched: a free logic puzzle game that writes a story for every puzzle\n\n{link}\n\nThe whole thing runs at $0 a month on free tiers (static hosting, a Cloudflare Worker with D1, free on-device voices). Next I am trying to find players through free channels only, and tracking which ones actually bring people who solve a puzzle. I will share the numbers in a month.',
      notes: '',
    },
    {
      channel: 'alternativeto', medium: 'directory', content: 'listing', media: ['gallery'], where: 'https://alternativeto.net/ (add as an alternative to Puzzle Baron, Brainzilla logic puzzles)',
      title: 'AlternativeTo listing',
      body: 'Name: The Fantastical Logic Grid\nDescription: Free logic grid puzzle generator with a new story for each puzzle, six difficulty levels, a daily puzzle, hints that explain each step and printable answer keys. Plays in the browser and offline; Windows app available.\nWebsite: {link}\nTags: logic-puzzles, puzzle-game, brain-training, printable, offline',
      notes: '',
    },
    {
      channel: 'microsoftstore', medium: 'store', content: 'pwa-listing', media: ['gallery', 'square'], where: 'https://www.pwabuilder.com/ then https://partner.microsoft.com/dashboard (individual developer accounts are free)',
      title: 'Microsoft Store listing (the web app)',
      body: 'Store name: The Fantastical Logic Grid\nShort description: Logic grid puzzles with a new story every time.\nDescription: Choose a theme and a level from Basic to Quantum Physicist and get a brand-new logic puzzle with its own story and cast. Every puzzle has exactly one answer, hints explain each step, a new daily puzzle arrives every day, and every puzzle prints with an answer key. Works offline.\nWebsite: {link}',
      notes: 'Package the website with PWABuilder (free). The store listing links back with the tracked link above.',
    },
    {
      channel: 'email', medium: 'email', content: 'friends-family', media: [], where: 'Bobby\'s own email to friends and family',
      title: 'Email to friends and family',
      body: 'Subject: I made a puzzle game, would you try it?\n\nHi,\n\nI have been building a free puzzle game called The Fantastical Logic Grid. Every logic puzzle comes with its own little story, and there is a new daily puzzle each day.\n\nIt plays in your web browser, no sign-up needed: {link}\n\nIf you try it, I would love to know what you think (there is an Ideas box in the menu). And if you know someone who loves puzzles, please pass it on.\n\nThanks!\nBobby',
      notes: 'The quickest first players. Send from your own address, a few people at a time.',
    },
  ],
}, {
  // Built into the game: the daily puzzle email's Play button is tagged with
  // this code (scripts/daily-email.py), so its visits, plays and solves show
  // here. Nothing to post.
  id: 'daily-email',
  campaign: {
    code: 'daily-email',
    name: 'Daily puzzle email',
    status: 'active',
    goal: 'Players who asked for each day\'s puzzle by email, coming back to play it.',
    notes: 'Sent automatically every morning (server/DAILY-EMAIL.md). Nothing to post or approve.',
  },
  ads: [],
}];
