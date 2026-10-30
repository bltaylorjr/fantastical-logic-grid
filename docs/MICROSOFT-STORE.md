# The game in the Microsoft Store

The Store version is the website's web app (PWA) wrapped as an MSIX package by
the free **PWABuilder** tool. The Store signs the package, so it costs nothing,
it installs with no SmartScreen warning, and it updates itself whenever the
website changes. No code signing certificate is needed.

Microsoft has not charged individual developers to register since September
2025 ([Windows Developer Blog](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)).

## What is ready in the repository

- `web/manifest.webmanifest` has everything PWABuilder and the Store look
  for: `id`, name, description, categories, icons (including maskable),
  screenshots (wide and narrow) and a **Play a quick puzzle** shortcut.
- Store screenshots, 1920 × 1080 PNG: `media/store/home.png` and
  `media/store/play.png`. Remake them with `npm run build && node scripts/store-screenshots.cjs`.
- Privacy policy: https://thelogicgrid.com/privacy/
- The listing text is below.

## Steps (owner)

1. Free account: https://storedeveloper.microsoft.com, choose **Individual developer**.
2. Partner Center > **Apps and games** > **New product** > **MSIX or PWA app**, and reserve the name **The Fantastical Logic Grid**.
3. Open the new app > **Product management** > **Product identity**. Keep this page open; it shows **Package/Identity/Name**, **Package/Identity/Publisher** and **Package/Properties/PublisherDisplayName**. These are not secrets.
4. Open https://www.pwabuilder.com, enter `https://thelogicgrid.com`, press **Start**, then **Package for stores** > **Windows** > **Generate package**. Paste the three values from step 3 into **Package ID**, **Publisher ID** and **Publisher display name**, keep the rest, and download the zip.
5. Back in Partner Center, **Start your submission**:
   - **Pricing and availability:** Free, all markets.
   - **Properties:** category **Games > Puzzle & trivia**. Privacy policy URL `https://thelogicgrid.com/privacy/`. Website `https://thelogicgrid.com`. Support contact `support@thelogicgrid.com`.
   - **Age ratings:** answer the free questionnaire (no violence, no purchases, players can chat only through screen names in races; there is no free text chat).
   - **Packages:** upload the `.msixbundle` from the PWABuilder zip.
   - **Store listings > English (United States):** paste the text below and upload the two PNGs from `media/store/`.
6. **Submit to the Store.** Certification usually takes one to three days.

Later website updates reach Store players on their own. Upload a new package
only when PWABuilder or Microsoft asks for one.

## Listing text

**Short description (up to 200 characters)**
Story logic grid puzzles where every case is a brand new story. Free, no ads, with hints, a daily puzzle, races and printable answer keys.

**Description**
Every case in The Fantastical Logic Grid is a brand new story. Read the clues, fill the grid with X and O, and close the case. Every puzzle has exactly one answer you can reach without guessing.

- Seven difficulty levels, from Basic to Theoretical Physicist, and almost any size
- More than 40 themes, from mysteries and holidays to national parks
- A new daily puzzle for everyone, with streaks and badges
- Hints that explain the reasoning, unlimited undo, and autosave
- Characters who read their clues aloud, in natural voices
- Play in 100 languages
- Print any puzzle, with the answer key on its own page
- Race other players and challenge friends to beat your time
- Keyboard and screen reader friendly, with dark and high-contrast colors and a Silent mode

Free, with no ads. An account is optional and only needed to sync between devices.

**Search terms (up to 7)**
logic puzzle, logic grid, brain teaser, deduction, mystery puzzle, daily puzzle, zebra puzzle

**What's new**
A quick puzzle to start playing in seconds, Challenge a friend links, and everyone's numbers for the daily puzzle.
