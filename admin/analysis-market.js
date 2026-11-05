// Outside research for the Analysis page (analysis.js): the puzzle market,
// competitors, trends, technology and the new builds they point to. Written
// by hand from public sources on the date below; every figure has its source.
// Refresh it every few months: change researchedOn and the entries, and keep
// figures only where a source backs them up (no claims without data).

const S = {
  appmagic: { title: 'AppMagic via Mobidictum, Feb 2026', url: 'https://mobidictum.com/appmagic-casual-games-report-2025-summary/' },
  adjust: { title: 'Adjust via PocketGamer.biz, Mar 2026', url: 'https://www.pocketgamer.biz/mobile-accounts-for-55-of-total-games-revenue-in-2025-as-studios-shift-towards-retention' },
  nyt: { title: 'Fast Company, Aug 2025', url: 'https://www.fastcompany.com/91386818/pips-new-game-nyt-the-next-wordle' },
  linkedin: { title: 'Jen Foley, Jul 2026', url: 'https://jenfoley.substack.com/p/linkedin-games-edition' },
  puzzmo: { title: 'Adrian Hon on Puzzmo, Nov 2023', url: 'https://adrianhon.substack.com/p/puzzmo' },
  puzzmoInma: { title: 'INMA on Hearst and Puzzmo, Mar 2025', url: 'https://www.inma.org/blogs/ideas/post.cfm/hearst-cracks-the-engagement-code-with-puzzmo' },
  baron: { title: 'Puzzle Baron FAQ', url: 'https://logic.puzzlebaron.com/faq.php' },
  brainzilla: { title: 'Brainzilla', url: 'https://www.brainzilla.com/logic/logic-grid/monopoly/' },
  egghead: { title: 'Egghead Games on the App Store', url: 'https://apps.apple.com/app/id919571269' },
  dell: { title: 'Penny Dell Puzzles', url: 'https://www.pennydellpuzzles.com/products/logic-math/dell-logic-puzzles/' },
  lpd: { title: 'Logic Puzzles Daily', url: 'https://logicpuzzlesdaily.com/?p=9066' },
  adventure: { title: 'Logic Adventure on the App Store', url: 'https://apps.apple.com/app/id6502436601' },
  murdle: { title: 'Arkansas Business on Murdle', url: 'https://www.arkansasbusiness.com/article/gt-karber-murdle-success/' },
  conceptis: { title: 'Conceptis', url: 'https://www.conceptispuzzles.com/index.aspx?uri=info' },
  kaser: { title: 'Everett Kaser Software', url: 'https://www.kaser.com/top.php' },
  king: { title: 'The Star on King and AI, May 2025', url: 'https://www.thestar.com.my/tech/tech-news/2025/05/13/how-ai-helps-push-candy-crush-players-through-its-most-difficult-puzzles' },
  cozy: { title: 'Outlook Respawn, Feb 2026', url: 'https://respawn.outlookindia.com/gaming/gaming-news/steam-vibe-shift-why-cozy-is-the-most-dominant-keyword-of-2026' },
  pw: { title: 'Publishers Weekly, Feb 2026', url: 'https://www.publishersweekly.com/pw/by-topic/industry-news/bookselling/article/99800-wi2026-passion-purchases-analog-living-trend-up.html' },
  circana: { title: 'Circana, May 2026', url: 'https://www.circana.com/post/turning-the-page-on-2026-book-trends' },
  tes: { title: 'TES teaching resources', url: 'https://www.tes.com/teaching-resource/logic-grid-puzzles-level-5-multi-step-deduction-complete-200-puzzle-pack-13505405' },
  eaa: { title: 'University of Bonn on the EU Accessibility Act, May 2026', url: 'https://www.uni-bonn.de/en/research-and-teaching/transfer/transfer-center-enacom/games-accessibility-en/was-founders-need-to-know-about-accessibility-the-eu-accessibility-act-2025' },
  epic: { title: 'AppleInsider, Mar 2026', url: 'https://appleinsider.com/articles/26/03/30/the-epic-vs-apple-case-wont-get-a-rehearing-for-app-store-fees' },
  epic2: { title: 'Neon on the Dec 2025 ruling', url: 'https://www.neonpay.com/blog/the-latest-epic-v.-apple-appeal-ruling-december-2025-what-changed-for-game-developers' },
  push: { title: 'Aimtell, May 2026', url: 'https://aimtell.com/blog/state-of-declarative-web-push-2026' },
  webgpu: { title: 'web.dev, Nov 2025', url: 'https://web.dev/blog/webgpu-supported-major-browsers' },
  prompt: { title: 'Chromium blink-dev', url: 'https://groups.google.com/a/chromium.org/g/blink-dev/c/iR6R7-nQeHI' },
  pew: { title: 'Pew via The Decoder, Jul 2025', url: 'https://the-decoder.com/pew-finds-that-only-1-percent-of-users-click-a-source-link-directly-from-googles-ai-overviews/' },
  reddit: { title: 'Phaser, Jun 2026', url: 'https://phaser.io/news/2026/06/reddit-and-phaser-launch-a-40-000-game-dev-hackathon' },
};

export const MARKET = {
  researchedOn: '2026-11-02',
  note: 'Market and technology figures come from the public sources linked beside them, as read on the research date. They describe the market, not this game. Some figures could not be found from a reliable source (puzzle-book sales on Amazon KDP, a separate figure for logic and brain games, current short-video discovery numbers) and are left out rather than guessed.',

  market: [
    { text: 'Mobile puzzle games earned about $8.2 billion in 2025, up 7.6% on the year before, with downloads up 9.9%. No separate figure exists for logic or brain puzzles.', sources: [S.appmagic] },
    { text: 'Puzzle games were 10% of mobile game installs and 13% of sessions in 2025. Studios are shifting effort from finding players to keeping them.', sources: [S.adjust] },
    { text: 'New York Times puzzles were played 11.1 billion times in 2024. Two-thirds of weekly players play two or more of its games, and in August 2025 it added Pips, a logic puzzle with three daily levels.', sources: [S.nyt] },
    { text: 'LinkedIn now has eight daily puzzles, most of them logic grids (Queens, Tango, Zip, Mini Sudoku). 84% of players come back the next day and 80% are still playing a week later.', sources: [S.linkedin] },
    { text: 'Puzzmo (owned by Hearst) is free on the web with an optional $40-a-year plan, and avoids app store fees by staying web-first. Its launch invites brought in 104,000 players with no ad spend.', sources: [S.puzzmo, S.puzzmoInma] },
    { text: 'Murdle, a daily mystery logic puzzle, has sold over a million books, has a board game, and a TV series is in development. It has no official app.', sources: [S.murdle] },
  ],

  competitors: [
    { name: 'Puzzle Baron Logic Puzzles', url: S.baron.url, offer: 'Large catalog of generated logic grids on the web, high scores, monthly contests, books', model: 'Free with ads; premium from about $3.33 a month removes ads', us: 'Our nearest web rival. We add stories, voiced clues, themes and seven levels; they have years of catalog and search traffic.' },
    { name: 'Egghead Games: Logic Grid Puzzles', url: S.egghead.url, offer: 'iPhone and iPad app, 100 free puzzles, "Smart Hints" that explain the next step, strong accessibility', model: '$2.99 volumes or $4.99 a month', us: 'The quality benchmark (4.8 stars from about 39,000 reviews). Our hints already teach the reasoning like theirs; reviews and an iPhone app are where they lead.' },
    { name: 'Logic Puzzles Daily', url: S.lpd.url, offer: 'iPhone app with about 70 free puzzles and a free daily challenge', model: '$4.49 a month; hints by watching ads', us: 'Same daily idea. We are cheaper ($2.99 planned) and have no ads.' },
    { name: 'Logic Adventure: Clue Games', url: S.adventure.url, offer: 'Story-driven zebra puzzles with postcard rewards', model: '$4.99 a week or $49.99 a year, plus coin packs', us: 'Closest to our story idea, but with heavy in-app spending. Free with donations is a clear contrast.' },
    { name: 'Murdle', url: S.murdle.url, offer: 'Free daily mystery deduction puzzle on the web, best-selling books', model: 'Books (about $10 to $15), licensing', us: 'Shows how big story deduction can get. We can offer what it lacks: an app, levels, and puzzles made from a player\'s own story.' },
    { name: 'Brainzilla', url: S.brainzilla.url, offer: 'Free logic grids in the browser and free PDFs', model: 'Ads; answer keys sold to teachers', us: 'Already serves teachers. Our lesson-plan puzzle packages go further.' },
    { name: 'Dell Logic Puzzles (print)', url: S.dell.url, offer: 'Quarterly magazine, about 95 puzzles an issue', model: 'Subscription (listed $28.97 to $69.97)', us: 'Print-loyal solvers. Our print books reach the same people.' },
    { name: 'Conceptis', url: S.conceptis.url, offer: 'Picture logic, Slitherlink, Skyscrapers and more, licensed to newspapers and apps', model: 'Licensing', us: 'A competitor for our sister games (Picture Grid and the planned Skyscrapers and Slitherlink), not for logic grids.' },
    { name: 'Everett Kaser', url: S.kaser.url, offer: 'Windows and Mac deduction games (the Sherlock family)', model: '$19.95 a game', us: 'A small but loyal paying niche on desktop, like our Windows app.' },
  ],

  strengths: [
    'Stories, themes and voiced clues inside a real logic grid: most rivals offer plain grids or story without depth.',
    'Seven levels, from Basic to Theoretical Physicist, so one game serves beginners and experts, and hints that explain the reasoning like the best-rated app.',
    'Players can send their own storylines through the Puzzle Wizard and see them become puzzles. No rival found offers this.',
    'Lesson-plan puzzle packages for teachers, and print books from the same engine.',
    'Free with no ads, with a lower planned price ($2.99 a month) than the paid apps ($4.49 to $4.99).',
    'Web-first like Puzzmo, so no app store fee on payments through Stripe.',
  ],
  gaps: [
    'Reach: rivals have years of search traffic and app store reviews; this site launched in October 2026.',
    'Habit: no daily reminder for players yet, while the daily leaders bring players back every day.',
    'Sharing: a spoiler-free share card exists, but nobody measures how often it is used.',
    'App stores: no iPhone app yet, where the best-rated rivals are.',
    'Proof: ratings and reviews other people can see.',
  ],

  trends: [
    { title: 'The daily habit wins', text: 'Daily puzzles with streaks keep players: LinkedIn sees 84% come back the next day, and NYT players mostly play more than one game.', forUs: 'Make today\'s puzzle the front door, show the streak, and offer a second quick puzzle from the other games.', sources: [S.linkedin, S.nyt] },
    { title: 'Logic grids went mainstream', text: 'Most new daily puzzles from LinkedIn and NYT (Queens, Tango, Zip, Pips) are logic grids, so many more people now know the format.', forUs: 'Use simple words people already know ("like Queens or Pips, with a story") in posts and on the front page.', sources: [S.linkedin, S.nyt] },
    { title: 'Mystery and story deduction', text: 'Murdle\'s book sales and TV deal, and story apps like Logic Adventure, show demand for deduction with a story.', forUs: 'A short daily "case file" (who, where, with what) fits our engine and story beats.', sources: [S.murdle, S.adventure] },
    { title: 'Spoiler-free sharing', text: 'Wordle\'s shared result grid made a puzzle spread by itself; NYT says thousands share scores every minute.', forUs: 'The share card is built; put it first on the daily solved screen and measure how often it is used.', sources: [S.nyt] },
    { title: 'AI behind the scenes, designers in charge', text: 'King uses AI to draft and retune Candy Crush levels in the thousands each week, with designers still deciding.', forUs: 'Keep the generator in charge of the logic and use AI only to write story flavour, checked before it ships.', sources: [S.king] },
    { title: 'Cozy and calm', text: 'Use of "cozy" in Steam game descriptions grew about 675% from 2022 to 2025.', forUs: 'A calm mode (no timer, soft sounds, gentle themes) next to the race mode.', sources: [S.cozy] },
    { title: 'Screen-free and puzzle books', text: 'Activity and puzzle books helped children\'s book sales rebound in 2025, and screen-free categories grew in early 2026. No figure was found for puzzle books alone.', forUs: 'Themed print volumes (holidays, mystery casebooks) from the engine, sold print-on-demand.', sources: [S.pw, S.circana] },
    { title: 'Classrooms buy logic puzzles', text: 'Teacher marketplaces sell logic-grid packs and Brainzilla sells answer keys to teachers. No market size was found.', forUs: 'A free sample pack on teacher marketplaces that leads to the lesson-plan packages.', sources: [S.tes, S.brainzilla] },
    { title: 'Accessibility is expected', text: 'The EU Accessibility Act has applied since June 2025, and leading rivals advertise screen-reader support and cues that do not rely on colour.', forUs: 'Keyboard play is in. Add a spoken label for every grid cell, colour-free marks and captions for the voiced clues.', sources: [S.eaa, S.egghead] },
  ],

  tech: [
    { title: 'Payment links outside the App Store', text: 'US courts have ruled that Apple must allow links to outside payment, and its request for a rehearing was denied in March 2026. Google Play also allows outside payments in the US.', forUs: 'An iPhone or Android app can send players to Stripe checkout on the web instead of building in-app purchases first.', sources: [S.epic2, S.epic] },
    { title: 'Web push on iPhone', text: 'Apple added a newer kind of web push in iOS 18.4 for web apps added to the Home Screen, and in iOS 26 sites added to the Home Screen open as web apps by default.', forUs: 'An opt-in daily puzzle reminder for players who install the web app, on iPhone too.', sources: [S.push] },
    { title: 'Search clicks shrink under AI answers', text: 'Pew found clicks on regular results fall from 15% to 8% when Google shows an AI Overview.', forUs: 'Aim pages at things an AI summary cannot replace: playable puzzles, printable PDFs and the daily puzzle. Grow Reddit and short video alongside search.', sources: [S.pew] },
    { title: 'Games inside Reddit', text: 'Reddit is pushing games that run inside Reddit itself, with a $40,000 game-making contest in 2026.', forUs: 'A small daily logic grid on Reddit could reach puzzle communities where they already are.', sources: [S.reddit] },
    { title: 'AI in the browser', text: 'Chrome is adding a built-in AI model for web pages on desktop. It is not on Android, and Firefox and Safari have not committed.', forUs: 'Only as an optional extra for story wording, with the current text as the fallback.', sources: [S.prompt] },
    { title: 'WebGPU everywhere', text: 'WebGPU now works in Chrome, Edge, Firefox and Safari, with some limits on Linux and Android.', forUs: 'Low priority: a 2D grid does not need it. Useful later for animated story scenes.', sources: [S.webgpu] },
  ],

  // New builds the research points to. Impact and effort are estimates for ranking.
  builds: [
    { title: 'Put the existing share card first on the daily solved screen, add a coloured spoiler-free grid to it, and count shares so their pull can be measured', why: 'Sharing drove Wordle; it brings players at no cost', area: 'Growth', impact: 'high', effort: 'small', sources: [S.nyt] },
    { title: 'Daily "case file" mystery: one short who, where, with-what puzzle each day with a story reveal', why: 'Murdle\'s format, which has no official app', area: 'New mode', impact: 'high', effort: 'medium', sources: [S.murdle] },
    { title: 'A 2-minute "mini" daily grid, free forever, as the first step before the full levels', why: 'Short daily logic grids keep LinkedIn and NYT players', area: 'New mode', impact: 'high', effort: 'small', sources: [S.linkedin, S.nyt] },
    { title: 'Opt-in daily puzzle reminder by web push, including iPhone home-screen installs', why: 'Brings players back each day', area: 'Retention', impact: 'medium', effort: 'small', sources: [S.push] },
    { title: 'Private friend groups with a daily leaderboard, and personal bests by default', why: 'How LinkedIn and Puzzmo keep groups playing', area: 'Social', impact: 'medium', effort: 'medium', sources: [S.linkedin, S.puzzmo] },
    { title: 'Yearly plan (about $24 to $29) next to $2.99 a month, with the archive and print books for members', why: 'Puzzmo charges $40 a year; paid rivals $4.49 to $4.99 a month', area: 'Income', impact: 'medium', effort: 'small', sources: [S.puzzmo, S.egghead, S.lpd] },
    { title: 'Free sample pack on teacher marketplaces that leads to the lesson-plan packages', why: 'Teachers already buy logic-grid packs there', area: 'Education', impact: 'medium', effort: 'small', sources: [S.tes] },
    { title: 'Themed print books (holiday editions, mystery casebooks) print-on-demand', why: 'Screen-free puzzle books are growing', area: 'Income', impact: 'medium', effort: 'medium', sources: [S.pw, S.circana] },
    { title: 'Weekly featured player storyline, with the author credited', why: 'Turns the Puzzle Wizard into a community, which no rival has', area: 'Community', impact: 'medium', effort: 'small', sources: [] },
    { title: 'Accessibility check against the leader: a spoken label for every grid cell, colour-free marks and captions for voiced clues (keyboard play is already in)', why: 'Rivals advertise it; EU law points that way', area: 'Puzzle quality', impact: 'medium', effort: 'small', sources: [S.eaa, S.egghead] },
    { title: 'A small daily logic grid on Reddit', why: 'Reaches puzzle communities where they already are', area: 'Growth', impact: 'medium', effort: 'medium', sources: [S.reddit] },
    { title: 'Calm mode: no timer, soft sounds, gentle themes', why: 'Cozy games are a fast-growing category', area: 'New mode', impact: 'low', effort: 'small', sources: [S.cozy] },
  ],
};
