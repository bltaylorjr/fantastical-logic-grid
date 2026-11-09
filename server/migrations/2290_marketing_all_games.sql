-- The Logic Grid with all 11 games (8 Nov 2026): the launch ads lead with The Logic Grid
-- and its 11 games instead of one game, theme counts are gone (the number changes as
-- themes are added), the educator ads name the website The Logic Grid, and the new
-- pictures of all 11 games join the media library. Only ads not yet posted and still in
-- their starter words change: anything edited in the dashboard, or posted, stays as it is.

INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: wide picture, all 11 games', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png', '/admin/marketing-lg-wide.png', '1600x900', 'X, Bluesky, Threads, Mastodon, LinkedIn, Reddit.', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png');
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: square picture, all 11 games', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png', '/admin/marketing-lg-square.png', '1080x1080', 'Instagram and Facebook feed posts.', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png');
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: Pinterest pin, all 11 games', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-pin-1000x1500.png', '/admin/marketing-lg-pin.png', '1000x1500', 'Tall pins get the most room in Pinterest feeds.', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-pin-1000x1500.png');
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: gallery picture, all 11 games', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png', '/admin/marketing-lg-gallery.png', '1270x760', 'Product Hunt, AlternativeTo, Microsoft Store, directories.', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png');
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: small cover, all 11 games', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-itch-cover-630x500.png', '/admin/marketing-lg-cover.png', '630x500', '', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-itch-cover-630x500.png');
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: Facebook Page cover', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-facebook-cover-1640x624.png', '/admin/marketing-lg-fbcover.png', '1640x624', 'Phones crop the sides, so everything stays in the middle.', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-facebook-cover-1640x624.png');
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'The Logic Grid: X header', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-x-header-1500x500.png', '/admin/marketing-lg-xheader.png', '1500x500', 'The X profile header. The profile photo covers the bottom left, so nothing important sits there.', 'starter plan', 1794182400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-x-header-1500x500.png');

UPDATE campaign_ads SET body = 'The Logic Grid: 11 free puzzle games in the browser, from story logic grids to number puzzles, loops, bridges and a crossword

{link}

The games: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. The first one writes a short story with a cast and clues for every logic grid puzzle. Every puzzle is made fresh, has exactly one answer, and the hints explain the next step instead of just giving it away.

There are daily puzzles, races against other players or the computer, and printing with answer keys. Guests can play a few new puzzles a day, and a free account is unlimited and works in every game. Feedback welcome!', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'webgames-launch' AND status <> 'posted' AND body = 'The Fantastical Logic Grid: logic grid puzzles where every puzzle comes with its own short story (free, plays in the browser)

{link}

Pick a theme (mystery, fantasy, sci-fi, national parks and 19 more), a difficulty from Basic to Theoretical Physicist and a grid size, and it writes a new story with a cast and clues to match. Every puzzle has exactly one answer, and the hints explain the next step instead of just giving it away.

Try it with no sign-up. A free account gives unlimited puzzles. It saves your progress, prints with an answer key, and works offline once loaded. It is one of 11 free puzzle games on the site, from number puzzles to Loop Line, Island Bridges and a crossword. Feedback welcome!' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'I built The Logic Grid: 11 free puzzle games on one puzzle engine, starting from a logic grid game that writes a fresh story for every puzzle

{link}

It began as one game: you choose a theme, difficulty and size, and it builds a logic grid puzzle with exactly one solution, writes a short story and cast around it, and gives step-by-step hints.

The same engine now runs NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword, each with its own solver for hints. There are daily puzzles, races against other players or the computer, a scoreboard and printing with answer keys, all with one account. It runs entirely on free tiers: a static site, one small server for accounts and races, and free on-device voices for read-aloud. Happy to answer questions about how the puzzles are generated.', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'sideproject-story' AND status <> 'posted' AND body = 'I built a logic grid puzzle game that writes a fresh story for every puzzle

{link}

What it does: you choose a theme, difficulty and size, and it builds a puzzle with exactly one solution, writes a short story and cast around it, and gives step-by-step hints. There is a daily puzzle, races against other players or the computer, a scoreboard and printing with answer keys.

Since then it has grown into The Logic Grid, 11 free puzzle games (number puzzles, Star Field, Loop Line, Island Bridges, a crossword and more) that share one puzzle engine and one account. It runs entirely on free tiers: a static site, one small server for accounts and races, and free on-device voices for read-aloud. Happy to answer questions about how the puzzles are generated.' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = '[Browser/Windows] The Logic Grid: 11 free puzzle games, from story logic grids to Loop Line and a crossword

{link}

The Fantastical Logic Grid writes a new story for every logic puzzle, across seven difficulty levels. Next to it are NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Daily puzzles, races against players or the computer, hints that explain each step and printable answer keys. Looking for feedback on which game you would try first, and why.', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'playmygame' AND status <> 'posted' AND body = '[Browser/Windows] The Fantastical Logic Grid: story-driven logic grid puzzles, free

{link}

New story every puzzle, 23 themes, seven difficulty levels, a daily puzzle, races against players or the computer, and printable answer keys. Looking for feedback on the tutorial and the first Easy puzzle.' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Meet The Logic Grid 🧩

11 free puzzle games in one place, in your browser:

✔ The Fantastical Logic Grid: logic puzzles where every puzzle has its own story
✔ Number puzzles: NINETIMESNINE, Cage Math, Sum Cross, More or Less and Skyline
✔ Picture Grid, Star Field, Loop Line, Island Bridges and Crossword
✔ Daily puzzles, races and hints that teach, not tell
✔ Print any puzzle with an answer key

Play now: {link}', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'facebook' AND content = 'page-video' AND status <> 'posted' AND body = 'Meet The Fantastical Logic Grid 🧩

Every puzzle comes with its own story: a stolen crown at the castle, a mix-up at the bake sale, a mystery in the national park. Pick your theme and difficulty, then work out who did what, where and when.

✔ Free, plays in your browser
✔ A new daily puzzle for everyone
✔ Hints that teach, not tell
✔ Print it with an answer key
✔ 10 more free puzzle games on The Logic Grid

Play now: {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Free printable puzzles, made fresh every time 🧩

The Logic Grid has 11 puzzle games you can print: story logic puzzles, number puzzles, picture puzzles, loops, bridges and crosswords. Pick the game and the level, and each puzzle prints with an answer key on its own page. Great for brain breaks, puzzle night or a quiet afternoon.

Make one here: {link}', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'facebook' AND content = 'groups-printable' AND status <> 'posted' AND body = 'Free printable logic puzzles, made fresh every time 🧩

You pick the theme (pets, cooking, sports, holidays and more) and the level, from Basic for beginners to Theoretical Physicist. Each one prints with the story, the clues, the grid and an answer key on its own page. Great for brain breaks, puzzle night or a quiet afternoon.

Make one here: {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = '11 free puzzle games, one place. 🧩✨ Story logic grids, number puzzles, picture puzzles, loops, bridges and a crossword, with new daily puzzles. Free to play, link in bio.

#logicpuzzle #puzzlegame #braingames #brainteaser #puzzles #crossword #numberpuzzles #freegames', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'instagram' AND content = 'reel-launch' AND status <> 'posted' AND body = 'Every puzzle tells a story. 🧩✨ Pick a theme, choose your level, and crack the case clue by clue. Free to play, link in bio.

#logicpuzzle #puzzlegame #braingames #brainteaser #puzzles #logicgrid #mysterygame #freegames' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Which one would you play first? 🧩

The Logic Grid has 11 free puzzle games: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Free to play in your browser, link in bio.

#logicpuzzles #puzzlelover #brainteasers #puzzletime #gamenight', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'instagram' AND content = 'post-square' AND status <> 'posted' AND body = 'Who borrowed the lighthouse keeper''s lantern? Only the clues know. 🔦

The Fantastical Logic Grid writes a brand-new story for every puzzle, from Basic to Theoretical Physicist. Free to play in your browser, link in bio.

#logicpuzzles #puzzlelover #brainteasers #puzzletime #gamenight' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = '11 free puzzle games in one place 🧩 Story logic grids, number puzzles, loops, bridges and a crossword. Which would you try first? Free to play, link in bio. #logicpuzzle #puzzle #braingames #brainteaser #puzzlegame', notes = 'The profile bio links to thelogicgrid.com/links/, which lists this video with its tracked link ({link}) once it is posted (TikTok shows bio links once the account is allowed one. Until then say "search The Logic Grid").', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'tiktok' AND content = 'launch-30s' AND status <> 'posted' AND body = 'Every logic puzzle comes with its own story 🧩 Which level would you try first: Easy or Theoretical Physicist? Free to play, link in bio. #logicpuzzle #puzzle #braingames #brainteaser #puzzlegame' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Title: The Fantastical Logic Grid: logic puzzles with a story (free browser game)

Description:
Every puzzle in The Fantastical Logic Grid comes with its own story and cast. Choose a theme and one of seven levels, from Basic to Theoretical Physicist, then use the clues to work out who did what. A new daily puzzle, races against other players or the computer, hints that explain each step, and printing with answer keys.

It is one of 11 free puzzle games on The Logic Grid, with NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Guests can play a few puzzles a day, and a free account gives unlimited puzzles in every game.

Play free: {link}

Chapters
0:00 Pick a theme and level
0:20 A new story every time
0:40 Hints that teach
1:00 Races and the scoreboard
1:15 Print, save and install', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'youtube' AND content = 'promo-90s' AND status <> 'posted' AND body = 'Title: The Fantastical Logic Grid: logic puzzles with a story (free browser game)

Description:
Every puzzle in The Fantastical Logic Grid comes with its own story and cast. Choose from 23 themes and seven levels, from Basic to Theoretical Physicist, then use the clues to work out who did what. A new daily puzzle, races against other players or the computer, hints that explain each step, and printing with answer keys.

It is one of 11 free puzzle games on The Logic Grid. Try it with no sign-up, and make a free account for unlimited puzzles.

Play free: {link}

Chapters
0:00 Pick a theme and level
0:20 A new story every time
0:40 Hints that teach
1:00 Races and the scoreboard
1:15 Print, save and install' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = '11 free puzzle games in one place. 🧩

Logic grids where every puzzle has its own story, plus number puzzles, Picture Grid, Star Field, Loop Line, Island Bridges and a crossword. New daily puzzles, free in your browser.

{link}', where_to = 'X account for the game: @the_logic_grid', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'x' AND content = 'launch-video' AND status <> 'posted' AND body = 'Logic grid puzzles, but every one comes with its own story. 🧩

Pick a theme, pick a level (Basic to Theoretical Physicist), solve. Free in your browser, with a new daily puzzle every day.

{link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'I made The Logic Grid: 11 free puzzle games in your browser, from logic grid puzzles that each get their own little story to number puzzles, loops, bridges and a crossword. Daily puzzles, races, and hints that explain the reasoning. 🧩

{link}', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'bluesky' AND content = 'launch' AND status <> 'posted' AND body = 'I made a free logic grid puzzle game where every puzzle gets its own little story, from a castle mystery to a bake-sale mix-up. Seven levels, a daily puzzle, and hints that explain the reasoning. 🧩

{link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Puzzle people: which would you play first? 🧩

The Logic Grid has 11 free puzzle games, from story logic grids to NINETIMESNINE, Skyline, Loop Line and a crossword. Free in your browser: {link}', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'threads' AND content = 'launch' AND status <> 'posted' AND body = 'Puzzle people: would you rather start on Easy or jump straight to Theoretical Physicist? 🧩

The Fantastical Logic Grid writes a new story for every logic puzzle. Free in your browser: {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'The Logic Grid is 11 free puzzle games in the browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle has exactly one answer, the hints explain each step, puzzles print with an answer key, and there is a high-contrast mode.

{link}

#LogicPuzzles #Puzzles #BrowserGames #IndieGames', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'mastodon' AND content = 'launch' AND status <> 'posted' AND body = 'The Fantastical Logic Grid is a free browser game of logic grid puzzles, each with its own short story and cast. It works offline once loaded, prints with an answer key, has a high-contrast mode and can read the clues aloud.

{link}

#LogicPuzzles #Puzzles #BrowserGames #IndieGames' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'I just launched The Logic Grid: 11 free puzzle games in the browser, from logic grid puzzles that are each generated with their own story to number puzzles, Loop Line, Island Bridges and a crossword.

A few things I cared about while building it:
• Every puzzle has exactly one solution, checked by a solver before you see it
• Hints explain the reasoning instead of handing over the answer
• One free account for every game, with daily puzzles and races
• Runs entirely on free tiers

If you like puzzles, or know a teacher who does, I would love your feedback: {link}', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'linkedin' AND content = 'maker-post' AND status <> 'posted' AND body = 'I just launched The Fantastical Logic Grid, a free logic puzzle game where every puzzle is generated with its own story.

A few things I cared about while building it:
• Every puzzle has exactly one solution, checked by a solver before you see it
• Hints explain the reasoning instead of handing over the answer
• Accessible from the start: keyboard and screen-reader play, high contrast, read-aloud, 100 languages
• Runs entirely on free tiers

If you like puzzles, or know a teacher who does, I would love your feedback: {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Title: Show HN: 11 puzzle generators in one site, including logic grids that write a story per puzzle

URL: {link}

First comment: Hi HN. The Logic Grid started as a generator for classic logic grid ("Einstein") puzzles: a solver checks each one has a single solution and grades it by the techniques needed, from simple elimination up to what-if reasoning for the top two levels, and a story engine writes the setting, cast and clue wording around the answer, never reusing a story. The same engine core now runs 10 more games (NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword), each with a human-style solver for hints. It is a static PWA plus one Cloudflare Worker for accounts and races, all on free tiers. Happy to talk about the generators.', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'hackernews' AND content = 'show-hn' AND status <> 'posted' AND body = 'Title: Show HN: A logic grid puzzle generator that writes a story for each puzzle

URL: {link}

First comment: Hi HN. This builds classic logic grid ("Einstein") puzzles from a theme, a size and a difficulty. A solver checks each one has a single solution and grades it by the techniques needed, from simple elimination up to what-if reasoning for the top two levels. A story engine then writes the setting, cast and clue wording around the answer, and never reuses a story. The same engine core now runs 10 more games on the site (number puzzles, Star Field, Loop Line, Island Bridges and a crossword), each with a human-style solver for hints. It is a static PWA plus one Cloudflare Worker for accounts and races, all on free tiers. Happy to talk about the generator.' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Name: The Logic Grid
Tagline: 11 free puzzle games, with a fresh puzzle whenever you want

Description: The Logic Grid puts 11 puzzle games in your browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle is made fresh with exactly one answer, hints teach each step, there are daily puzzles, races against players or the computer, and every puzzle prints with an answer key. One free account works in every game, with a Windows app too.

Link: {link}

Maker comment: I built this because I loved logic grid puzzle books but always ran out of puzzles. It started with one game that writes a new story for every puzzle, and now there are ten more kinds of puzzle next to it.', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png'), (SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/promo/the-fantastical-logic-grid-promo-16x9.mp4')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'producthunt' AND content = 'launch' AND status <> 'posted' AND body = 'Name: The Fantastical Logic Grid
Tagline: Logic grid puzzles with a new story every time

Description: Pick a theme and a level from Basic to Theoretical Physicist, and get a brand-new logic puzzle with its own story and cast. Hints teach each step, there is a daily puzzle for everyone, races against players or the computer, a scoreboard, and every puzzle prints with an answer key. Free in the browser, with a Windows app. It is the flagship of The Logic Grid, 11 free puzzle games with one account.

Link: {link}

Maker comment: I built this because I loved logic grid puzzle books but always ran out of puzzles. Now there is a fresh one whenever you want it, and ten more kinds of puzzle next to it.' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Kind: HTML (played in the browser) or an external link to the website

Short description: Logic grid puzzles with a new story every time.

Page text: The Fantastical Logic Grid builds a brand-new logic puzzle whenever you want one, with its own story, cast and clues. Choose a theme and one of seven levels, from Basic to Theoretical Physicist. Every puzzle has exactly one answer, the hints explain each step, and you can print any puzzle with an answer key. Race other players or the computer, and play the daily puzzle.

Play the full version on The Logic Grid, with 10 more free puzzle games: {link}

Tags: puzzle, logic, deduction, mystery, casual, singleplayer, accessibility', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'itch' AND content = 'game-page' AND status <> 'posted' AND body = 'Kind: HTML (played in the browser) or an external link to the website

Short description: Logic grid puzzles with a new story every time.

Page text: The Fantastical Logic Grid builds a brand-new logic puzzle whenever you want one, with its own story, cast and clues. Choose from 23 themes and seven levels, from Basic to Theoretical Physicist. Every puzzle has exactly one answer, the hints explain each step, and you can print any puzzle with an answer key. Race other players or the computer, and play the daily puzzle.

Play the full version on the website, with 10 more free puzzle games: {link}

Tags: puzzle, logic, deduction, mystery, casual, singleplayer, accessibility' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Name: The Logic Grid
Description: 11 free puzzle games in the browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Puzzles are made fresh with exactly one answer, with daily puzzles, races, hints that explain each step and printable answer keys. Windows app available.
Website: {link}
Tags: logic-puzzles, puzzle-game, brain-training, printable, crossword', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'alternativeto' AND content = 'listing' AND status <> 'posted' AND body = 'Name: The Fantastical Logic Grid
Description: Free logic grid puzzle generator with a new story for each puzzle, 23 themes, seven difficulty levels, a daily puzzle, races, hints that explain each step and printable answer keys. Plays in the browser and offline. Windows app available. Part of The Logic Grid, 11 free puzzle games.
Website: {link}
Tags: logic-puzzles, puzzle-game, brain-training, printable, offline' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png'), (SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'microsoftstore' AND content = 'pwa-listing' AND status <> 'posted' AND body = 'Store name: The Logic Grid
Short description: 11 free logic puzzle games, including story logic puzzles with a new story every time.
Description: The Logic Grid puts 11 puzzle games in one app: The Fantastical Logic Grid (story logic puzzles from Basic to Theoretical Physicist), NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle has exactly one answer, hints explain each step, there is a new daily puzzle every day, and puzzles print with an answer key. One free account works in every game. Works offline.
Website: {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Title: Free printable logic puzzle packages for teachers: how to ask for one

Description:
A short walk-through of the Educators page of The Logic Grid: fill in the form with your school email, confirm the code, and get print-ready PDFs of story logic puzzles made for your grade, with the answer keys in a separate file. Free for schools.

Request a package: {link}', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'youtube' AND content = 'educators-how-to' AND status <> 'posted' AND body = 'Title: Free printable logic puzzle packages for teachers: how to ask for one

Description:
A short walk-through of the Educators page of The Fantastical Logic Grid: fill in the form with your school email, confirm the code, and get print-ready PDFs of story logic puzzles made for your grade, with the answer keys in a separate file. Free for schools.

Request a package: {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'educators-2026');
UPDATE campaign_ads SET body = 'Subject: Free printable logic puzzle packages for your teachers

Hello,

I run a free puzzle website, The Logic Grid, and I make free printable logic puzzle packages for teachers. A teacher fills in a short form with their school email: the grade, difficulty, themes (or their own theme) and how many puzzles, up to 30. After a quick review, we email print-ready PDFs with a separate answer key. Each puzzle has a short story and exactly one answer, and the difficulty is matched to the grade.

There is no cost and no account to create. If you think it would help, please share it with your teachers: {link}

I have attached a one-page flyer. Thank you for your time.

Bobby Taylor
The Logic Grid', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'email' AND content = 'district-coordinators' AND status <> 'posted' AND body = 'Subject: Free printable logic puzzle packages for your teachers

Hello,

I run a free logic puzzle website, The Fantastical Logic Grid, and I make free printable puzzle packages for teachers. A teacher fills in a short form with their school email: the grade, difficulty, themes (or their own theme) and how many puzzles, up to 30. After a quick review, we email print-ready PDFs with a separate answer key. Each puzzle has a short story and exactly one answer, and the difficulty is matched to the grade.

There is no cost and no account to create. If you think it would help, please share it with your teachers: {link}

I have attached a one-page flyer. Thank you for your time.

Bobby Taylor
The Fantastical Logic Grid' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'educators-2026');
UPDATE campaign_ads SET body = 'Free logic puzzles for our classrooms

The Logic Grid, a free puzzle website, makes free printable puzzle packages for teachers: story logic puzzles chosen by grade, level and theme, with answer keys. Teachers can ask for one with their school email at {link}', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'newsletter' AND content = 'school-newsletter' AND status <> 'posted' AND body = 'Free logic puzzles for our classrooms

The Fantastical Logic Grid makes free printable puzzle packages for teachers: story logic puzzles chosen by grade, level and theme, with answer keys. Teachers can ask for one with their school email at {link}' AND campaign_id = (SELECT id FROM campaigns WHERE code = 'educators-2026');

-- Second pass: on the live site nine of these launch ads still had the words
-- of a 4 Nov 2026 update (updated_at 1793681366000) instead of the starter
-- words above, so the earlier refresh and the first pass skipped them. They
-- have not been edited since, so they get the same new words. An ad edited by
-- hand has a later updated_at and is left alone.
UPDATE campaign_ads SET body = 'The Logic Grid: 11 free puzzle games in the browser, from story logic grids to number puzzles, loops, bridges and a crossword

{link}

The games: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. The first one writes a short story with a cast and clues for every logic grid puzzle. Every puzzle is made fresh, has exactly one answer, and the hints explain the next step instead of just giving it away.

There are daily puzzles, races against other players or the computer, and printing with answer keys. Guests can play a few new puzzles a day, and a free account is unlimited and works in every game. Feedback welcome!', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-wide-1600x900.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'webgames-launch' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = '[Browser/Windows] The Logic Grid: 11 free puzzle games, from story logic grids to Loop Line and a crossword

{link}

The Fantastical Logic Grid writes a new story for every logic puzzle, across seven difficulty levels. Next to it are NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Daily puzzles, races against players or the computer, hints that explain each step and printable answer keys. Looking for feedback on which game you would try first, and why.', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'reddit' AND content = 'playmygame' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Free printable puzzles, made fresh every time 🧩

The Logic Grid has 11 puzzle games you can print: story logic puzzles, number puzzles, picture puzzles, loops, bridges and crosswords. Pick the game and the level, and each puzzle prints with an answer key on its own page. Great for brain breaks, puzzle night or a quiet afternoon.

Make one here: {link}', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'facebook' AND content = 'groups-printable' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Title: The Fantastical Logic Grid: logic puzzles with a story (free browser game)

Description:
Every puzzle in The Fantastical Logic Grid comes with its own story and cast. Choose a theme and one of seven levels, from Basic to Theoretical Physicist, then use the clues to work out who did what. A new daily puzzle, races against other players or the computer, hints that explain each step, and printing with answer keys.

It is one of 11 free puzzle games on The Logic Grid, with NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Guests can play a few puzzles a day, and a free account gives unlimited puzzles in every game.

Play free: {link}

Chapters
0:00 Pick a theme and level
0:20 A new story every time
0:40 Hints that teach
1:00 Races and the scoreboard
1:15 Print, save and install', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'youtube' AND content = 'promo-90s' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Title: Show HN: 11 puzzle generators in one site, including logic grids that write a story per puzzle

URL: {link}

First comment: Hi HN. The Logic Grid started as a generator for classic logic grid ("Einstein") puzzles: a solver checks each one has a single solution and grades it by the techniques needed, from simple elimination up to what-if reasoning for the top two levels, and a story engine writes the setting, cast and clue wording around the answer, never reusing a story. The same engine core now runs 10 more games (NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword), each with a human-style solver for hints. It is a static PWA plus one Cloudflare Worker for accounts and races, all on free tiers. Happy to talk about the generators.', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'hackernews' AND content = 'show-hn' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Name: The Logic Grid
Tagline: 11 free puzzle games, with a fresh puzzle whenever you want

Description: The Logic Grid puts 11 puzzle games in your browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle is made fresh with exactly one answer, hints teach each step, there are daily puzzles, races against players or the computer, and every puzzle prints with an answer key. One free account works in every game, with a Windows app too.

Link: {link}

Maker comment: I built this because I loved logic grid puzzle books but always ran out of puzzles. It started with one game that writes a new story for every puzzle, and now there are ten more kinds of puzzle next to it.', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png'), (SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/promo/the-fantastical-logic-grid-promo-16x9.mp4')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'producthunt' AND content = 'launch' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Kind: HTML (played in the browser) or an external link to the website

Short description: Logic grid puzzles with a new story every time.

Page text: The Fantastical Logic Grid builds a brand-new logic puzzle whenever you want one, with its own story, cast and clues. Choose a theme and one of seven levels, from Basic to Theoretical Physicist. Every puzzle has exactly one answer, the hints explain each step, and you can print any puzzle with an answer key. Race other players or the computer, and play the daily puzzle.

Play the full version on The Logic Grid, with 10 more free puzzle games: {link}

Tags: puzzle, logic, deduction, mystery, casual, singleplayer, accessibility', updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'itch' AND content = 'game-page' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Name: The Logic Grid
Description: 11 free puzzle games in the browser: The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Puzzles are made fresh with exactly one answer, with daily puzzles, races, hints that explain each step and printable answer keys. Windows app available.
Website: {link}
Tags: logic-puzzles, puzzle-game, brain-training, printable, crossword', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'alternativeto' AND content = 'listing' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
UPDATE campaign_ads SET body = 'Store name: The Logic Grid
Short description: 11 free logic puzzle games, including story logic puzzles with a new story every time.
Description: The Logic Grid puts 11 puzzle games in one app: The Fantastical Logic Grid (story logic puzzles from Basic to Theoretical Physicist), NINETIMESNINE, Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop Line, Island Bridges and Crossword. Every puzzle has exactly one answer, hints explain each step, there is a new daily puzzle every day, and puzzles print with an answer key. One free account works in every game. Works offline.
Website: {link}', media = json_array((SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-gallery-1270x760.png'), (SELECT id FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/logic-grid-square-1080.png')), updated_at = 1794182400000
  WHERE created_by = 'starter plan' AND channel = 'microsoftstore' AND content = 'pwa-listing' AND status <> 'posted' AND updated_at = 1793681366000 AND campaign_id = (SELECT id FROM campaigns WHERE code = 'launch-2026');
