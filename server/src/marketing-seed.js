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
    fbCover: { title: 'Facebook Page cover', kind: 'image', url: `${RAW}/media/marketing/facebook-cover-1640x624.png`, preview: '/admin/marketing-fbcover.png', size: '1640x624', notes: 'The Page\'s cover photo. Phones crop the sides, so the words stay in the middle.' },
    cover: { title: 'itch.io cover', kind: 'image', url: `${RAW}/media/marketing/itch-cover-630x500.png`, preview: '/admin/marketing-cover.png', size: '630x500', notes: '' },
    lgWide: { title: 'The Logic Grid: wide picture, all 11 games', kind: 'image', url: `${RAW}/media/marketing/logic-grid-wide-1600x900.png`, preview: '/admin/marketing-lg-wide.png', size: '1600x900', notes: 'X, Bluesky, Threads, Mastodon, LinkedIn, Reddit.' },
    lgSquare: { title: 'The Logic Grid: square picture, all 11 games', kind: 'image', url: `${RAW}/media/marketing/logic-grid-square-1080.png`, preview: '/admin/marketing-lg-square.png', size: '1080x1080', notes: 'Instagram and Facebook feed posts.' },
    lgPin: { title: 'The Logic Grid: Pinterest pin, all 11 games', kind: 'image', url: `${RAW}/media/marketing/logic-grid-pin-1000x1500.png`, preview: '/admin/marketing-lg-pin.png', size: '1000x1500', notes: 'Tall pins get the most room in Pinterest feeds.' },
    lgGallery: { title: 'The Logic Grid: gallery picture, all 11 games', kind: 'image', url: `${RAW}/media/marketing/logic-grid-gallery-1270x760.png`, preview: '/admin/marketing-lg-gallery.png', size: '1270x760', notes: 'Product Hunt, AlternativeTo, Microsoft Store, directories.' },
    lgCover: { title: 'The Logic Grid: small cover, all 11 games', kind: 'image', url: `${RAW}/media/marketing/logic-grid-itch-cover-630x500.png`, preview: '/admin/marketing-lg-cover.png', size: '630x500', notes: '' },
    lgFbCover: { title: 'The Logic Grid: Facebook Page cover', kind: 'image', url: `${RAW}/media/marketing/logic-grid-facebook-cover-1640x624.png`, preview: '/admin/marketing-lg-fbcover.png', size: '1640x624', notes: 'Phones crop the sides, so everything stays in the middle.' },
    lgXHeader: { title: 'The Logic Grid: X header', kind: 'image', url: `${RAW}/media/marketing/logic-grid-x-header-1500x500.png`, preview: '/admin/marketing-lg-xheader.png', size: '1500x500', notes: 'The X profile header. The profile photo covers the bottom left, so nothing important sits there.' },
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
      channel: 'reddit', medium: 'forum', content: 'webgames-launch', postOn: '2026-11-11', media: ['lgWide'], where: 'https://www.reddit.com/r/WebGames/',
      title: 'r/WebGames: launch post',
      body: 'The Logic Grid: 11 free puzzle games in the browser, from story logic grids to number puzzles, loops, bridges and a crossword\n\n{link}\n\nThe games: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. The first one writes a short story with a cast and clues for every logic grid puzzle. Every puzzle is made fresh, has exactly one answer, and the hints explain the next step instead of just giving it away.\n\nThere are daily puzzles, races against other players or the computer, and printing with answer keys. Guests can play a few new puzzles a day, and a free account is unlimited and works in every game. Feedback welcome!',
      notes: 'Post as a link post with the title above. Reply to comments in the first hour.',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'logicpuzzles-daily', postOn: '2026-11-24', media: ['wide'], where: 'https://www.reddit.com/r/logicpuzzles/',
      title: 'r/logicpuzzles: daily puzzle',
      body: 'I made a free logic grid game with a new daily puzzle every day (same puzzle for everyone)\n\nEach puzzle has a little story and a cast of characters, and the grid fills in as you mark it. Difficulty runs from Basic to Theoretical Physicist, and every hint shows the reasoning step instead of revealing the answer.\n\nToday\'s puzzle: {link}\n\nI would love to hear whether the harder levels feel fair.',
      notes: 'Read the sidebar rules first; some puzzle subreddits want the puzzle itself in the post. If so, post a printed page as a picture with the link in a comment.',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'sideproject-story', postOn: '2026-11-14', media: ['lgWide'], where: 'https://www.reddit.com/r/SideProject/',
      title: 'r/SideProject: the maker story',
      body: 'I built The Logic Grid: 11 free puzzle games on one puzzle engine, starting from a logic grid game that writes a fresh story for every puzzle\n\n{link}\n\nIt began as one game: you choose a theme, difficulty and size, and it builds a logic grid puzzle with exactly one solution, writes a short story and cast around it, and gives step-by-step hints.\n\nThe same engine now runs NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword, each with its own solver for hints. There are daily puzzles, races against other players or the computer, a scoreboard and printing with answer keys, all with one account. It runs entirely on free tiers: a static site, one small server for accounts and races, and free on-device voices for read-aloud. Happy to answer questions about how the puzzles are generated.',
      notes: '',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'playmygame', postOn: '2026-11-21', media: ['promoWide'], where: 'https://www.reddit.com/r/playmygame/',
      title: 'r/playmygame: video post',
      body: '[Browser/Windows] The Logic Grid: 11 free puzzle games, from story logic grids to Loop Line and a crossword\n\n{link}\n\nThe Fantastical Logic Grid writes a new story for every logic puzzle, across seven difficulty levels. Next to it are NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Daily puzzles, races against players or the computer, hints that explain each step and printable answer keys. Looking for feedback on which game you would try first, and why.',
      notes: 'Upload the 90 s promo as the video.',
    },
    {
      channel: 'facebook', medium: 'social', content: 'page-video', postOn: '2026-11-04', media: ['promoWideCap'], where: 'Your Facebook Page for the game (Bobby creates it, see the setup email)',
      title: 'Facebook Page: launch video',
      body: 'Meet The Logic Grid 🧩\n\n11 free puzzle games in one place, in your browser:\n\n✔ The Fantastical Logic Grid: logic puzzles where every puzzle has its own story\n✔ Number puzzles: NINETIMESNINE, Cage Math, Sum Cross, More or Less and Skyline\n✔ Picture Grid, Star Field, Loop Line, Island Bridges and Crossword\n✔ Daily puzzles, races and hints that teach, not tell\n✔ Print any puzzle with an answer key\n\nPlay now: {link}',
      notes: 'Pin this post to the top of the Page.',
    },
    {
      channel: 'facebook', medium: 'community', content: 'groups-printable', postOn: '2026-11-23', media: ['lgSquare'], where: 'Puzzle, brain-teaser, homeschool and activity-idea groups that allow sharing free resources',
      title: 'Facebook groups: free printable puzzles',
      body: 'Free printable puzzles, made fresh every time 🧩\n\nThe Logic Grid has 11 puzzle games you can print: story logic puzzles, number puzzles, picture puzzles, loops, bridges and crosswords. Pick the game and the level, and each puzzle prints with an answer key on its own page. Great for brain breaks, puzzle night or a quiet afternoon.\n\nMake one here: {link}',
      notes: 'Only post where the group rules allow it, and no more than one group a day.',
    },
    {
      channel: 'instagram', medium: 'social', content: 'reel-launch', postOn: '2026-11-05', media: ['promoTall'], where: 'Instagram account for the game',
      title: 'Instagram Reel: launch',
      body: '11 free puzzle games, one place. 🧩✨ Story logic grids, number puzzles, picture puzzles, loops, bridges and a crossword, with new daily puzzles. Free to play, link in bio.\n\n#logicpuzzle #puzzlegame #braingames #brainteaser #puzzles #crossword #numberpuzzles #freegames',
      notes: 'Instagram does not make links in captions clickable: the profile bio links to thelogicgrid.com/links/, which lists this post with its tracked link ({link}) once it is posted.',
    },
    {
      channel: 'instagram', medium: 'social', content: 'post-square', postOn: '2026-11-12', media: ['lgSquare'], where: 'Instagram account for the game',
      title: 'Instagram post: square picture',
      body: 'Which one would you play first? 🧩\n\nThe Logic Grid has 11 free puzzle games: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Free to play in your browser, link in bio.\n\n#logicpuzzles #puzzlelover #brainteasers #puzzletime #gamenight',
      notes: 'Instagram does not make links in captions clickable: the profile bio links to thelogicgrid.com/links/, which lists this post with its tracked link ({link}) once it is posted.',
    },
    {
      channel: 'tiktok', medium: 'video', content: 'launch-30s', postOn: '2026-11-10', media: ['promoTall'], where: 'TikTok account for the game',
      title: 'TikTok: 30 second launch',
      body: '11 free puzzle games in one place 🧩 Story logic grids, number puzzles, loops, bridges and a crossword. Which would you try first? Free to play, link in bio. #logicpuzzle #puzzle #braingames #brainteaser #puzzlegame',
      notes: 'The profile bio links to thelogicgrid.com/links/, which lists this video with its tracked link ({link}) once it is posted (TikTok shows bio links once the account is allowed one. Until then say "search The Logic Grid").',
    },
    {
      channel: 'youtube', medium: 'video', content: 'promo-90s', postOn: '2026-11-09', media: ['promoWide'], where: 'YouTube channel for the game',
      title: 'YouTube: 90 second promo',
      body: 'Title: The Fantastical Logic Grid: logic puzzles with a story (free browser game)\n\nDescription:\nEvery puzzle in The Fantastical Logic Grid comes with its own story and cast. Choose a theme and one of seven levels, from Basic to Theoretical Physicist, then use the clues to work out who did what. A new daily puzzle, races against other players or the computer, hints that explain each step, and printing with answer keys.\n\nIt is one of 11 free puzzle games on The Logic Grid, with NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Guests can play a few puzzles a day, and a free account gives unlimited puzzles in every game.\n\nPlay free: {link}\n\nChapters\n0:00 Pick a theme and level\n0:20 A new story every time\n0:40 Hints that teach\n1:00 Races and the scoreboard\n1:15 Print, save and install',
      notes: 'Upload the clean video with the 16x9 .srt captions. Check the chapter times against the video before posting.',
    },
    {
      channel: 'youtube', medium: 'video', content: 'shorts-30s', postOn: '2026-11-10', media: ['promoTall'], where: 'YouTube channel for the game (Shorts)',
      title: 'YouTube Shorts: 30 second cut',
      body: 'Title: Logic puzzles, but every one has a story #shorts\n\nDescription: Free to play: {link}',
      notes: '',
    },
    {
      channel: 'x', medium: 'social', content: 'launch-video', postOn: '2026-11-06', media: ['promoWideCap'], where: 'X account for the game: @the_logic_grid',
      title: 'X: launch post',
      body: '11 free puzzle games in one place. 🧩\n\nLogic grids where every puzzle has its own story, plus number puzzles, Picture Grid, Star Field, Loop Line, Island Bridges and a crossword. New daily puzzles, free in your browser.\n\n{link}',
      notes: '',
    },
    {
      channel: 'bluesky', medium: 'social', content: 'launch', postOn: '2026-11-03', media: ['lgWide'], where: 'Bluesky account for the game',
      title: 'Bluesky: launch post',
      body: 'I made The Logic Grid: 11 free puzzle games in your browser, from logic grid puzzles that each get their own little story to number puzzles, loops, bridges and a crossword. Daily puzzles, races, and hints that explain the reasoning. 🧩\n\n{link}',
      notes: 'Add alt text to the picture.',
    },
    {
      channel: 'threads', medium: 'social', content: 'launch', postOn: '2026-11-05', media: ['lgSquare'], where: 'Threads account for the game',
      title: 'Threads: launch post',
      body: 'Puzzle people: which would you play first? 🧩\n\nThe Logic Grid has 11 free puzzle games, from story logic grids to NINETIMESNINE, Skyline, Loop Line and a crossword. Free in your browser: {link}',
      notes: '',
    },
    {
      channel: 'mastodon', medium: 'social', content: 'launch', postOn: '2026-11-04', media: ['lgWide'], where: 'A Mastodon account on a general or games server',
      title: 'Mastodon: launch post',
      body: 'The Logic Grid is 11 free puzzle games in the browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle has exactly one answer, the hints explain each step, puzzles print with an answer key, and there is a high-contrast mode.\n\n{link}\n\n#LogicPuzzles #Puzzles #BrowserGames #IndieGames',
      notes: 'Mastodon readers value accessibility and alt text: describe the picture.',
    },
    {
      channel: 'pinterest', medium: 'social', content: 'printable-pin', postOn: '2026-11-19', media: ['pin'], where: 'Pinterest business account (free), boards: Printable Logic Puzzles, Brain Games, Puzzle Night',
      title: 'Pinterest: printable puzzles pin',
      body: 'Pin title: Free Printable Logic Puzzles with Answer Keys\n\nDescription: Make a new logic grid puzzle in seconds: choose a theme (pets, sports, holidays, cooking, mysteries) and a level from beginner to Theoretical Physicist. Each one prints with a story, clues, the grid and an answer key on a separate page. Great for brain breaks, classrooms and puzzle night.\n\nLink: {link}',
      notes: 'Pinterest pins keep bringing visits for months; add one new pin a week with a different theme.',
    },
    {
      channel: 'linkedin', medium: 'social', content: 'maker-post', postOn: '2026-11-03', media: ['lgWide'], where: 'Bobby\'s LinkedIn profile',
      title: 'LinkedIn: the maker post',
      body: 'I just launched The Logic Grid: 11 free puzzle games in the browser, from logic grid puzzles that are each generated with their own story to number puzzles, Loop Line, Island Bridges and a crossword.\n\nA few things I cared about while building it:\n• Every puzzle has exactly one solution, checked by a solver before you see it\n• Hints explain the reasoning instead of handing over the answer\n• One free account for every game, with daily puzzles and races\n• Runs entirely on free tiers\n\nIf you like puzzles, or know a teacher who does, I would love your feedback: {link}',
      notes: '',
    },
    {
      channel: 'hackernews', medium: 'community', content: 'show-hn', postOn: '2026-11-18', media: [], where: 'https://news.ycombinator.com/submit',
      title: 'Show HN',
      body: 'Title: Show HN: 11 puzzle generators in one site, including logic grids that write a story per puzzle\n\nURL: {link}\n\nFirst comment: Hi HN. The Logic Grid started as a generator for classic logic grid ("Einstein") puzzles: a solver checks each one has a single solution and grades it by the techniques needed, from simple elimination up to what-if reasoning for the top two levels, and a story engine writes the setting, cast and clue wording around the answer, never reusing a story. The same engine core now runs 10 more games (NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword), each with a human-style solver for hints. It is a static PWA plus one Cloudflare Worker for accounts and races, all on free tiers. Happy to talk about the generators.',
      notes: 'Post on a weekday morning US Eastern and stay around to answer comments.',
    },
    {
      channel: 'producthunt', medium: 'directory', content: 'launch', postOn: '2026-11-17', media: ['lgGallery', 'promoWide'], where: 'https://www.producthunt.com/posts/new',
      title: 'Product Hunt launch',
      body: 'Name: The Logic Grid\nTagline: 11 free puzzle games, with a fresh puzzle whenever you want\n\nDescription: The Logic Grid puts 11 puzzle games in your browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle is made fresh with exactly one answer, hints teach each step, there are daily puzzles, races against players or the computer, and every puzzle prints with an answer key. One free account works in every game, with a Windows app too.\n\nLink: {link}\n\nMaker comment: I built this because I loved logic grid puzzle books but always ran out of puzzles. It started with one game that writes a new story for every puzzle, and now there are ten more kinds of puzzle next to it.',
      notes: 'Launch at 12:01 am Pacific on a Tuesday to Thursday. Free to list.',
    },
    {
      channel: 'itch', medium: 'store', content: 'game-page', postOn: '2026-11-07', media: ['cover', 'gallery'], where: 'https://itch.io/game/new',
      title: 'itch.io game page',
      body: 'Kind: HTML (played in the browser) or an external link to the website\n\nShort description: Logic grid puzzles with a new story every time.\n\nPage text: The Fantastical Logic Grid builds a brand-new logic puzzle whenever you want one, with its own story, cast and clues. Choose a theme and one of seven levels, from Basic to Theoretical Physicist. Every puzzle has exactly one answer, the hints explain each step, and you can print any puzzle with an answer key. Race other players or the computer, and play the daily puzzle.\n\nPlay the full version on The Logic Grid, with 10 more free puzzle games: {link}\n\nTags: puzzle, logic, deduction, mystery, casual, singleplayer, accessibility',
      notes: 'Set the price to "No payments" (free). Genre: Puzzle.',
    },
    {
      channel: 'indiehackers', medium: 'community', content: 'launch-post', postOn: '2026-12-07', media: [], where: 'https://www.indiehackers.com/',
      title: 'Indie Hackers: launch post',
      body: 'Launched: a free logic puzzle game that writes a story for every puzzle\n\n{link}\n\nIt has since grown into The Logic Grid, 11 free puzzle games on one shared engine and one account. The whole thing runs at $0 a month on free tiers (static hosting, a Cloudflare Worker with D1, free on-device voices). Guests can try a few puzzles a day, and a free account is unlimited. Next I am trying to find players through free channels only, and tracking which ones actually bring people who solve a puzzle. I will share the numbers in a month.',
      notes: '',
    },
    {
      channel: 'alternativeto', medium: 'directory', content: 'listing', postOn: '2026-11-06', media: ['lgGallery'], where: 'https://alternativeto.net/ (add as an alternative to Puzzle Baron, Brainzilla logic puzzles)',
      title: 'AlternativeTo listing',
      body: 'Name: The Logic Grid\nDescription: 11 free puzzle games in the browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Puzzles are made fresh with exactly one answer, with daily puzzles, races, hints that explain each step and printable answer keys. Windows app available.\nWebsite: {link}\nTags: logic-puzzles, puzzle-game, brain-training, printable, crossword',
      notes: '',
    },
    {
      channel: 'microsoftstore', medium: 'store', content: 'pwa-listing', postOn: '2026-11-30', media: ['lgGallery', 'lgSquare'], where: 'https://www.pwabuilder.com/ then https://partner.microsoft.com/dashboard (individual developer accounts are free)',
      title: 'Microsoft Store listing (the web app)',
      body: 'Store name: The Logic Grid\nShort description: 11 free logic puzzle games, including story logic puzzles with a new story every time.\nDescription: The Logic Grid puts 11 puzzle games in one app: The Fantastical Logic Grid (story logic puzzles from Basic to Theoretical Physicist), NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle has exactly one answer, hints explain each step, there is a new daily puzzle every day, and puzzles print with an answer key. One free account works in every game. Works offline.\nWebsite: {link}',
      notes: 'Package the website with PWABuilder (free). The store listing links back with the tracked link above.',
    },
    {
      channel: 'email', medium: 'email', content: 'friends-family', postOn: '2026-11-02', media: [], where: 'Bobby\'s own email to friends and family',
      title: 'Email to friends and family',
      body: 'Subject: I made a puzzle game, would you try it?\n\nHi,\n\nI have been building a free puzzle website called The Logic Grid. Its main game, The Fantastical Logic Grid, gives every logic puzzle its own little story, and there is a new daily puzzle each day. There are 10 more puzzle games next to it.\n\nIt plays in your web browser, and you can try it with no sign-up: {link}\n\nIf you try it, I would love to know what you think (there is an Ideas box in the menu). And if you know someone who loves puzzles, please pass it on.\n\nThanks!\nBobby',
      notes: 'The quickest first players. Send from your own address, a few people at a time.',
    },
  ],
}, {
  // Free printable puzzle packages for teachers, schools and districts (the
  // website's Educators page, server/src/educators.js). Every ad opens
  // /educators/, and the page counts requests, confirmed school addresses and
  // packages sent for the ad that brought the teacher (edu_request,
  // edu_confirm, edu_sent). Drafts until Bobby approves them in admin.
  id: 'educators-2026',
  media: {
    eduWide: { title: 'Educators: wide post picture', kind: 'image', url: `${RAW}/media/marketing/educators-wide-1600x900.png`, preview: '/admin/marketing-educators-wide.png', size: '1600x900', notes: 'X, Bluesky, Threads, Mastodon, LinkedIn, Reddit, Facebook.' },
    eduSquare: { title: 'Educators: square post picture', kind: 'image', url: `${RAW}/media/marketing/educators-square-1080.png`, preview: '/admin/marketing-educators-square.png', size: '1080x1080', notes: 'Instagram and Facebook feed posts.' },
    eduPin: { title: 'Educators: Pinterest pin', kind: 'image', url: `${RAW}/media/marketing/educators-pin-1000x1500.png`, preview: '/admin/marketing-educators-pin.png', size: '1000x1500', notes: 'Teacher and classroom boards.' },
    eduFlyer: { title: 'Educators: printable flyer with QR code (PDF)', kind: 'other', url: `${RAW}/media/marketing/educators-flyer-letter.pdf`, preview: '/admin/marketing-educators-flyer.png', size: 'US Letter, 1 page', notes: 'Staff rooms, school offices, conferences, district mailings. The QR code is the flyer ad\'s tracked link.' },
    eduVideo: { title: 'Educators: how-to video (form to PDF)', kind: 'video', url: `${RAW}/seo/media/educators.mp4`, preview: '/admin/marketing-educators-video.png', size: '1920x1080, about 3 min', notes: 'Captions: seo/media/educators.en.vtt.' },
  },
  campaign: {
    code: 'educators-2026',
    name: 'Free puzzle packages for educators',
    status: 'draft',
    starts: '2026-11-09',
    ends: '2027-01-31',
    goal: 'Teachers, schools and districts who know the free printable puzzle packages exist and ask for one. The numbers to watch are educator requests, confirmed school addresses and packages sent, per channel and ad.',
    notes: 'Free channels only. Every ad is a draft until Bobby approves it; set the campaign to Running once the ads are approved. Teacher groups and subreddits often limit self-promotion: read the rules first and post the free resource, not the game. Timed for the weeks before winter break and the January return.',
  },
  ads: [
    {
      channel: 'facebook', medium: 'social', content: 'page-educators', landing: '/educators/', postOn: '2026-11-09', media: ['eduWide'], where: 'The game\'s Facebook Page',
      title: 'Facebook Page: free packages for teachers',
      body: 'Teachers: free printable logic puzzle packages for your class 🍎🧩\n\nTell us the grade, the level and the themes (or write your own, like your science fair or class book), and we email you a set of story logic puzzles with a separate answer key. Up to 30 puzzles, every one with a new story and exactly one answer.\n\nFree for schools. Ask with your school email: {link}',
      notes: 'Pin it to the top of the Page for a week.',
    },
    {
      channel: 'facebook', medium: 'community', content: 'teacher-groups', landing: '/educators/', postOn: '2026-11-10', media: ['eduSquare'], where: 'Teacher, homeschool co-op, gifted education and school librarian Facebook groups that allow sharing free resources',
      title: 'Facebook teacher groups: free resource',
      body: 'Free resource for anyone teaching grades K to 12 🧩\n\nI make a free logic puzzle site, and I now build printable puzzle packages for teachers at no cost. You pick the grade, difficulty, themes and how many (up to 30), or write a theme of your own. Every puzzle has a short story, a grid and exactly one answer, and the answer keys come in their own PDF.\n\nGreat for early finishers, brain breaks, sub plans and the week before break. Request one with your school email here: {link}\n\nHappy to answer questions!',
      notes: 'One group a day at most, and only where the rules allow free resources. Answer comments the same day.',
    },
    {
      channel: 'x', medium: 'social', content: 'edchat', landing: '/educators/', postOn: '2026-11-11', media: ['eduWide'], where: 'The game\'s X account',
      title: 'X: #edchat free packages',
      body: 'Teachers: free printable logic puzzle packs, made for your grade. 🍎🧩\n\nPick the level and themes (or write your own), and get up to 30 story puzzles with a separate answer key by email.\n\nFree for schools: {link}\n\n#edchat #teachers #iteachmath #criticalthinking',
      notes: '',
    },
    {
      channel: 'bluesky', medium: 'social', content: 'edusky', landing: '/educators/', postOn: '2026-11-09', media: ['eduWide'], where: 'The game\'s Bluesky account',
      title: 'Bluesky: #EduSky free packages',
      body: 'Teachers: free printable logic puzzle packs for your grade 🧩 Choose the level and themes, or write your own, and we email up to 30 story puzzles plus answer keys. Free for schools. #EduSky\n\n{link}',
      notes: 'Bluesky allows 300 characters; this fits with the link. Add alt text to the picture.',
    },
    {
      channel: 'mastodon', medium: 'social', content: 'edutooters', landing: '/educators/', postOn: '2026-11-12', media: ['eduWide'], where: 'The game\'s Mastodon account',
      title: 'Mastodon: free packages for teachers',
      body: 'Free for teachers: printable logic grid puzzle packages made to order. Choose the grade, difficulty, themes (or your own theme) and how many, up to 30. Every puzzle has a short story and exactly one answer; the answer keys come as a separate PDF. Large print for the youngest grades.\n\n{link}\n\n#Education #Teachers #EduTooters #CriticalThinking',
      notes: 'Describe the picture in the alt text.',
    },
    {
      channel: 'threads', medium: 'social', content: 'teachers', landing: '/educators/', postOn: '2026-11-13', media: ['eduSquare'], where: 'The game\'s Threads account',
      title: 'Threads: teachers',
      body: 'Teacher friends: what do your early finishers do? 🧩\n\nWe now make free printable logic puzzle packages for classes: your grade, your level, your themes, up to 30 puzzles with an answer key. Free for schools: {link}',
      notes: '',
    },
    {
      channel: 'instagram', medium: 'social', content: 'teacher-square', landing: '/educators/', postOn: '2026-11-16', media: ['eduSquare'], where: 'The game\'s Instagram account',
      title: 'Instagram post: free packages for teachers',
      body: 'Free printable logic puzzles for your classroom 🍎🧩\n\nPick the grade, the level and the themes (or write your own), and we email a package of story logic puzzles with a separate answer key. Up to 30 puzzles, free for schools. Request yours with your school email, link in bio.\n\n#teachersofinstagram #iteach #teacherresources #freeprintables #logicpuzzles #criticalthinking #earlyfinishers',
      notes: 'Instagram does not make links in captions clickable: the profile bio links to thelogicgrid.com/links/, which lists this post with its tracked link ({link}) once it is posted.',
    },
    {
      channel: 'linkedin', medium: 'social', content: 'district-leaders', landing: '/educators/', postOn: '2026-11-12', media: ['eduWide'], where: 'Bobby\'s LinkedIn profile',
      title: 'LinkedIn: principals and district leaders',
      body: 'For principals, curriculum coordinators and district leaders: free printable logic puzzle packages for your teachers.\n\nA teacher fills in a short form with their school email: grade, difficulty, themes or their own theme, and how many puzzles (up to 30). After a quick review we email print-ready PDFs: a short story, a logic grid and clues for each puzzle, and the answer keys in a separate file. Every puzzle is checked by a solver to have exactly one answer, and difficulty is matched to the grade.\n\nThere is no cost and no account. If it would help your schools, please pass it on: {link}',
      notes: 'Tag nobody you have not asked. Reply to every comment.',
    },
    {
      channel: 'pinterest', medium: 'social', content: 'classroom-pin', landing: '/educators/', postOn: '2026-11-17', media: ['eduPin'], where: 'Pinterest boards: Classroom Logic Puzzles, Early Finishers, Free Teacher Printables',
      title: 'Pinterest: free classroom puzzle packages',
      body: 'Pin title: Free Printable Logic Puzzle Packages for Teachers (K-12)\n\nDescription: Get a free set of story logic grid puzzles made for your class: choose the grade, the difficulty, the themes or your own theme, and up to 30 puzzles. Print-ready PDFs with a separate answer key. Great for early finishers, brain breaks, sub plans and critical thinking practice.\n\nLink: {link}',
      notes: 'Teachers save pins for months. Add a fresh pin every couple of weeks with a different theme picture.',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'teachingresources', landing: '/educators/', postOn: '2026-11-18', media: ['eduWide'], where: 'https://www.reddit.com/r/teachingresources/',
      title: 'r/teachingresources: free packages',
      body: 'Free printable logic puzzle packages, made to order for your grade (K-12)\n\n{link}\n\nI make a free logic puzzle site and built a way for teachers to get classroom packages at no cost. You choose the grade, the level, the themes (or type your own theme, such as your class novel or field trip) and how many puzzles, up to 30. Each puzzle has a short story, a grid and clues, and exactly one answer. The answer keys come in their own PDF.\n\nYou confirm a school email so the packages go to educators. Feedback from teachers is very welcome.',
      notes: 'Read the sidebar first. Answer questions in the first hour.',
    },
    {
      channel: 'reddit', medium: 'forum', content: 'homeschool', landing: '/educators/', postOn: '2026-12-02', media: ['eduWide'], where: 'https://www.reddit.com/r/homeschool/ (check the weekly resource thread rules)',
      title: 'r/homeschool: printable puzzles',
      body: 'Free printable story logic puzzles with answer keys, any level\n\nOur site makes a new logic grid puzzle whenever you want one, with its own short story and an answer key you can print on a separate page. Co-ops and homeschool groups with an organization email can also ask for a free package of up to 30 puzzles made for a grade level: {link}',
      notes: 'Many homeschool parents will not have a school email; the packages need one (or the admin "accept personal email" setting). Post in the weekly resources thread if the subreddit has one.',
    },
    {
      channel: 'youtube', medium: 'video', content: 'educators-how-to', landing: '/educators/', postOn: '2026-11-20', media: ['eduVideo'], where: 'The game\'s YouTube channel',
      title: 'YouTube: how teachers get a free package',
      body: 'Title: Free printable logic puzzle packages for teachers: how to ask for one\n\nDescription:\nA short walk-through of the Educators page of The Logic Grid: fill in the form with your school email, confirm the code, and get print-ready PDFs of story logic puzzles made for your grade, with the answer keys in a separate file. Free for schools.\n\nRequest a package: {link}',
      notes: 'Upload with the captions file (seo/media/educators.en.vtt). Add it to a playlist named For teachers.',
    },
    {
      channel: 'flyer', medium: 'qr', content: 'staff-room', landing: '/educators/', postOn: '2026-11-23', media: ['eduFlyer'], where: 'Print and pin up: staff rooms, school offices, libraries, teacher conferences and PTA meetings',
      title: 'Printable flyer with QR code',
      body: 'Print the flyer (PDF in the media list). Its QR code opens this ad\'s tracked link:\n{link}\n\nWords on the flyer: Free logic puzzle packages for your class. Choose the grade, level and themes. Up to 30 printable story puzzles with answer keys, emailed to you. Free for schools. Scan to ask for yours.',
      notes: 'If you change this ad\'s link name (content), rebuild the flyer so the QR code still counts: node media/marketing/tools/make-educator-images.cjs.',
    },
    {
      channel: 'email', medium: 'email', content: 'district-coordinators', landing: '/educators/', postOn: '2026-11-30', media: ['eduFlyer'], where: 'Bobby\'s own email, one district at a time: curriculum or instruction coordinators, gifted and talented coordinators, library media coordinators (addresses from the district\'s public staff directory)',
      title: 'Email to district coordinators',
      body: 'Subject: Free printable logic puzzle packages for your teachers\n\nHello,\n\nI run a free puzzle website, The Logic Grid, and I make free printable logic puzzle packages for teachers. A teacher fills in a short form with their school email: the grade, difficulty, themes (or their own theme) and how many puzzles, up to 30. After a quick review, we email print-ready PDFs with a separate answer key. Each puzzle has a short story and exactly one answer, and the difficulty is matched to the grade.\n\nThere is no cost and no account to create. If you think it would help, please share it with your teachers: {link}\n\nI have attached a one-page flyer. Thank you for your time.\n\nBobby Taylor\nThe Logic Grid',
      notes: 'Personal, one-to-one emails only (no bulk lists), a few a day. Attach the flyer PDF. If someone asks not to be contacted, note it here and do not email them again.',
    },
    {
      channel: 'newsletter', medium: 'email', content: 'school-newsletter', landing: '/educators/', postOn: '2026-12-01', media: ['eduSquare'], where: 'A short blurb to offer school librarians, PTA/PTO newsletters and teacher association bulletins',
      title: 'Blurb for school and PTA newsletters',
      body: 'Free logic puzzles for our classrooms\n\nThe Logic Grid, a free puzzle website, makes free printable puzzle packages for teachers: story logic puzzles chosen by grade, level and theme, with answer keys. Teachers can ask for one with their school email at {link}',
      notes: 'Send to people who edit a newsletter and ask whether it fits; never ask parents to sign up for anything.',
    },
    {
      channel: 'oercommons', medium: 'directory', content: 'listing', landing: '/educators/', postOn: '2026-11-25', media: ['eduWide'], where: 'https://oercommons.org/ (free account, Add OER)',
      title: 'OER Commons listing',
      body: 'Title: Free printable story logic puzzle packages (made to order)\n\nURL: {link}\n\nDescription: Teachers request a free package of logic grid puzzles for their grade (K-12 and adult learners): choose the difficulty, themes or a custom theme, and up to 30 puzzles. Each puzzle has a short story, clues and a grid with exactly one solution; answer keys come as a separate PDF. Builds deductive reasoning and close reading.\n\nSubjects: Mathematics, English Language Arts, Critical thinking\nMaterial type: Activity/Lab, Assessment, Game\nCost: Free',
      notes: 'Choose the most accurate licence the form offers for "free to use" (the puzzles are free for classroom use; the game itself stays all rights reserved).',
    },
    {
      channel: 'facebook', medium: 'social', content: 'winter-break', landing: '/educators/', postOn: '2026-12-14', media: ['eduSquare'], where: 'The game\'s Facebook Page',
      title: 'Facebook Page: week before winter break',
      body: 'The week before winter break calls for puzzles ❄️🧩\n\nTeachers can still get a free printable logic puzzle package made for their grade: holiday and winter themes, or a theme of your own, with answer keys. Requests are reviewed in a day or two: {link}',
      notes: '',
    },
    {
      channel: 'bluesky', medium: 'social', content: 'winter-break', landing: '/educators/', postOn: '2026-12-14', media: ['eduSquare'], where: 'The game\'s Bluesky account',
      title: 'Bluesky: week before winter break',
      body: 'The week before winter break calls for puzzles ❄️🧩 Teachers: free printable logic puzzle packs for your grade, with answer keys. Reviewed in a day or two. #EduSky\n\n{link}',
      notes: '',
    },
    {
      channel: 'x', medium: 'social', content: 'new-semester', landing: '/educators/', postOn: '2027-01-04', media: ['eduWide'], where: 'The game\'s X account',
      title: 'X: back to school in January',
      body: 'New semester, new brain warm-ups. 🧩\n\nTeachers: ask for a free printable logic puzzle package made for your grade, with answer keys, at {link}\n\n#edchat #teachers #bellringer',
      notes: '',
    },
    {
      channel: 'facebook', medium: 'social', content: 'new-semester', landing: '/educators/', postOn: '2027-01-05', media: ['eduWide'], where: 'The game\'s Facebook Page',
      title: 'Facebook Page: back to school in January',
      body: 'Back to school in January? Start the semester with a brain warm-up 🧩\n\nTeachers can ask for a free package of printable story logic puzzles made for their grade, with a separate answer key. Free for schools: {link}',
      notes: '',
    },
  ],
}, {
  // Built into the game: the copy for game sites (dist/portal) has a menu
  // link to the full website tagged with this code (web/js/app.js), so
  // players who come over from a game site show here. Nothing to post.
  id: 'portal',
  campaign: {
    code: 'portal',
    name: 'Game sites link to the full website',
    status: 'active',
    goal: 'Players on game sites (the portal copy) who open the full website from its menu.',
    notes: 'Built into the portal copy of the game. Nothing to post or approve.',
  },
  ads: [],
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
}, {
  // "How to play logic puzzles": three short vertical videos (the grid, reading
  // the clues, hints), made by .github/workflows/tip-videos.yml from the real
  // game. One tip a week on the Facebook Page, then Instagram, YouTube Shorts
  // and TikTok a day later. Approved by Bobby on 2026-10-28, after the launch
  // video passed 100 plays on Facebook.
  id: 'how-to-play-tips-2026',
  media: {
    tipGrid: { title: 'How to play 1: the grid (vertical, captions)', kind: 'video', url: `${RAW}/media/promo/how-to-play-1-the-grid-9x16-captioned.mp4`, preview: '/admin/marketing-promo-9x16.png', size: '1080x1920, about 35 s', notes: 'Reels, Shorts and TikTok. Captions: media/promo/how-to-play-1-the-grid-9x16.srt.' },
    tipClues: { title: 'How to play 2: reading the clues (vertical, captions)', kind: 'video', url: `${RAW}/media/promo/how-to-play-2-the-clues-9x16-captioned.mp4`, preview: '/admin/marketing-promo-9x16.png', size: '1080x1920, about 35 s', notes: 'Reels, Shorts and TikTok. Captions: media/promo/how-to-play-2-the-clues-9x16.srt.' },
    tipHints: { title: 'How to play 3: stuck? hints (vertical, captions)', kind: 'video', url: `${RAW}/media/promo/how-to-play-3-hints-9x16-captioned.mp4`, preview: '/admin/marketing-promo-9x16.png', size: '1080x1920, about 35 s', notes: 'Reels, Shorts and TikTok. Captions: media/promo/how-to-play-3-hints-9x16.srt.' },
  },
  campaign: {
    code: 'how-to-play-tips',
    name: 'How to play logic puzzles (video tips)',
    status: 'active',
    starts: '2026-11-01',
    ends: '2026-12-31',
    goal: 'New players who learn how logic grid puzzles work from a 35-second video and try one. Watch visits, first puzzles played and returns within a week per tip and channel.',
    notes: 'Follows the launch video, which passed 100 plays on Facebook. One tip a week so each gets its own attention. Reply to comments the same day; questions about how to play are ideas for the next tip.',
  },
  adStatus: 'approved',
  ads: [
    ...[
      ['tipGrid', 'grid', '2026-11-01', '2026-11-02', 'the grid', 'Every square pairs two things from the story: an X when they can\'t go together, an O when they must. One O per row. That\'s the whole idea!'],
      ['tipClues', 'clues', '2026-11-08', '2026-11-09', 'reading the clues', 'Start with the clues that say what is NOT true, mark the easy X\'s, and when only one square is left in a row, it\'s the O.'],
      ['tipHints', 'hints', '2026-11-15', '2026-11-16', 'hints', 'Stuck? Press Hint for a nudge, ask again for the exact square, then the full reasoning. Every puzzle has exactly one answer, no guessing.'],
    ].flatMap(([media, key, day1, day2, topic, lesson], i) => [
      {
        channel: 'facebook', medium: 'social', content: `tip-${key}`, postOn: day1, media: [media], where: 'The game\'s Facebook Page',
        title: `Facebook Page: how to play ${i + 1}, ${topic}`,
        body: `How to play logic puzzles, part ${i + 1} of 3: ${topic} 🧩\n\n${lesson}\n\nTry a free puzzle with its own story: {link}`,
        notes: 'Posted as a video; Facebook may also show it as a Reel. Reply to comments the same day.',
      },
      {
        channel: 'instagram', medium: 'social', content: `tip-${key}`, postOn: day2, media: [media], where: 'Instagram account for the game',
        title: `Instagram Reel: how to play ${i + 1}, ${topic}`,
        body: `How to play logic puzzles, part ${i + 1}: ${topic} 🧩 ${lesson} Free to play, link in bio.\n\n#logicpuzzle #howtoplay #puzzletips #braingames #brainteaser #puzzles #logicgrid`,
        notes: 'The profile bio links to thelogicgrid.com/links/, which lists this Reel with its tracked link ({link}) once it is posted.',
      },
      {
        channel: 'youtube', medium: 'video', content: `tip-${key}-short`, postOn: day2, media: [media], where: 'YouTube channel for the game (Shorts)',
        title: `YouTube Shorts: how to play ${i + 1}, ${topic}`,
        body: `Title: How to solve logic puzzles: ${topic} #shorts\n\nDescription: ${lesson} Play free: {link}`,
        notes: '',
      },
      {
        channel: 'tiktok', medium: 'video', content: `tip-${key}`, postOn: day2, media: [media], where: 'TikTok account for the game',
        title: `TikTok: how to play ${i + 1}, ${topic}`,
        body: `How to play logic puzzles, part ${i + 1}: ${topic} 🧩 Free to play, link in bio. #logicpuzzle #puzzletips #braingames #brainteaser #howtoplay`,
        notes: 'The profile bio links to thelogicgrid.com/links/, which lists this video with its tracked link ({link}) once it is posted.',
      },
    ]),
  ],
}];
