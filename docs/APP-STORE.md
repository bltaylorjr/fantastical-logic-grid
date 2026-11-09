# The game on the Apple App Store (iPhone and iPad)

The iPhone and iPad app (`mobile/ios`) is a small native shell around the same
web build as the website, so every game change reaches it with the next build.
iOS was resumed by Bobby on 2026-11-08.

**No Mac is needed.** GitHub builds, signs and uploads the app on its own Mac
machines (free for this public repository), using an App Store Connect API key.
Workflow: "iPhone and iPad app" (`.github/workflows/ios.yml`).

## Cost (checked 2026-11-08)

- **Apple Developer Program: $99 a year** (Bobby approved). This is the only cost.
- App Store listing, TestFlight, App Review and GitHub's Mac builds: free.
- If the app is ever sold or has in-app purchases, Apple keeps 15% (Small
  Business Program, apply once in the account) or 30% without it.

## Price: Free (recommended)

List the app as **Free**. Reasons:

1. The same game is free on the website, in the Windows app and in the Android
   app. A paid iPhone app would charge for something one tap away for free, and
   reviews would say so.
2. Paid apps get a small share of the downloads free apps get; puzzle players
   expect to try first. The game earns through the tip jar and Supporter plan
   (on the website) instead.
3. App keys don't fit the App Store: Apple does not allow unlocking an app with
   a key from outside the store (Guideline 3.1.1). The iPhone app never asks for
   a key; Apple's own download is the copy protection.
4. For money from iPhone players later, add an Apple in-app purchase
   ("Supporter", $2.99 a month or $19.99 a year, matching the website), not a
   download price. That needs a small code change and Bobby's OK.

If Bobby still wants a download price, $2.99 once is the fair choice for a
puzzle game with no ads (he keeps about $2.54 per copy at 15%).

## What the iPhone app leaves out (App Review rules)

| Hidden in the iPhone/iPad app | Why |
| --- | --- |
| App key window | 3.1.1: no unlocking with keys from outside the store |
| Support the game link, gentle support asks, supporter extras | 3.1.1: no outside payment links; digital extras must use Apple's in-app purchase |
| Menu > Install the app (Windows and Android downloads) | Already installed; 2.3.10: no pointing at other platforms |

Everything else in the v1.15.6 feature set is the same as the website.
Supporter badges on the scoreboard still show. Account deletion is in the app
(Menu > Account and sync > Delete account), as 5.1.1(v) requires. Sign-in is
email only, so Sign in with Apple is not required.

## Pictures

`media/app-store/` (remake with `npm run build && node scripts/app-store-assets.cjs`):

- Each set: `games` (the games list the app opens on), `home`, `story`, `grid`
- `iphone-*.png`: 1320 × 2868, the 6.9" iPhone size App Store Connect asks for
- `ipad-*.png`: 2064 × 2752, the 13" iPad size
- App icon: built into the app (`mobile/ios/LogicGrid/Assets.xcassets`), nothing to upload

## Steps (owner)

1. **Join the Apple Developer Program** ($99/year) at
   https://developer.apple.com/programs/enroll/ as an **Individual**, with
   your Apple Account. Apple checks your identity in the Apple Developer app
   (on an iPhone) and can take 1 to 2 days to approve.
2. **Find your Team ID**: https://developer.apple.com/account > Membership
   details > Team ID (10 letters and numbers).
3. **Make an API key** so GitHub can sign and upload: open
   https://appstoreconnect.apple.com/access/integrations/api, ask for API
   access if asked, then **Team Keys > +** (Generate API Key). Name
   `GitHub`, Access **Admin** (needed so GitHub can make the signing
   certificate for you). Click **Download** (it can be downloaded only once)
   and note the **Key ID** and the **Issuer ID** shown above the list.
4. **Add them to GitHub** at
   https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions:
   - Secret `APP_STORE_CONNECT_KEY_ID`: the Key ID
   - Secret `APP_STORE_CONNECT_ISSUER_ID`: the Issuer ID
   - Secret `APP_STORE_CONNECT_KEY_BASE64`: the .p8 file as base64. On Windows,
     in PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\AuthKey_XXXX.p8")) | Set-Clipboard`
     then paste. (Or ask Claude in the project to do this step with you.)
   - On the **Variables** tab: variable `APPLE_TEAM_ID`: the Team ID
5. **Register the app id**: https://developer.apple.com/account/resources/identifiers/add/bundleId,
   App IDs > App, Explicit Bundle ID `com.fantasticallogicgrid.app`,
   description "The Logic Grid". No extra capabilities.
6. **Create the app in App Store Connect**: https://appstoreconnect.apple.com/apps
   > **+** > New App: platform iOS, name **The Logic Grid**,
   language English (U.S.), bundle ID `com.fantasticallogicgrid.app`,
   SKU `flg-ios`, Full access.
7. **Send the first build**: open
   https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/ios.yml
   > Run workflow (keep "Sign and upload" ticked). About 15 minutes after it
   finishes, the build appears under TestFlight. After that, every new game
   release uploads a new build by itself.
8. **Try it on your iPhone**: install **TestFlight** from the App Store, add
   yourself under TestFlight > Internal Testing, and open the invite.
9. **Fill in the listing** with the answers below, add the screenshots from
   `media/app-store/`, pick the build, set price **Free**, and click
   **Add for Review**. Apple usually answers within 1 to 2 days.

## Listing text

The store app is **The Logic Grid** (Bobby, 2026-11-08): a set of puzzle
games, with The Fantastical Logic Grid as the main game inside it. It opens on
the games list, like the Windows app and Google Play.

- **Name (30 max):** The Logic Grid
- **Subtitle (30 max):** Story logic puzzles and more
- **Promotional text (170 max):** Story logic grids where every case is a brand new story, plus number and grid puzzles. Every puzzle has exactly one answer. Free, no ads.
- **Keywords (100 max):** logic,puzzle,fantastical,brain,mystery,deduction,clues,detective,daily,story,sudoku,riddle
- **Description:**

The Logic Grid is a set of puzzle games where every puzzle has exactly one answer you can reach without guessing.

The main game, The Fantastical Logic Grid, turns every case into a brand new story. Read the clues, fill the grid with X and O, and close the case.

• Seven difficulty levels, from Basic to Theoretical Physicist, and almost any size
• More than 40 themes, from mysteries and holidays to national parks
• A new daily puzzle for everyone, with streaks and badges
• Hints that explain the reasoning, unlimited undo, and autosave
• Characters who read their clues aloud
• More games: NINETIMESNINE number puzzles and grid puzzles like Skyline, Star Field, Loop Line and Island Bridges
• Play in 100 languages
• Print any puzzle with AirPrint, with the answer key on its own page
• Race other players or the computer, and challenge friends to beat your time
• VoiceOver friendly, with dark and high-contrast colors and a Silent mode

Free, with no ads. Guests can play a few new puzzles a day; a free account (email only) gives unlimited puzzles, syncs your saves and lets you race.

- **Category:** Games, sub-categories Puzzle and Board
- **Support URL:** https://thelogicgrid.com/ (contact: support@thelogicgrid.com)
- **Marketing URL:** https://thelogicgrid.com
- **Privacy policy URL:** https://thelogicgrid.com/privacy/
- **Copyright:** 2026 Bobby Taylor

## App Privacy answers ("nutrition label")

These match `mobile/ios/LogicGrid/PrivacyInfo.xcprivacy`.

- Do you or your partners collect data? **Yes.** Tracking: **No.**
- **Contact Info > Email Address**: App Functionality. Linked to the user. Not tracking. (Optional account.)
- **Identifiers > User ID**: App Functionality. Linked. Not tracking.
- **User Content > Gameplay Content**: App Functionality (synced saves). Linked. Not tracking.
- **User Content > Other User Content**: App Functionality (ideas and problem reports). Linked. Not tracking.
- **Usage Data > Product Interaction**: Analytics, App Functionality. Not linked. Not tracking. (Can be turned off in Settings > Learning.)
- **Diagnostics > Crash Data**: App Functionality. Not linked. Not tracking.

## Age rating answers

All "None" except **User-Generated Content: Yes** (screen names on the
scoreboard and in races; every typed name is approved by an admin first; there
is no chat). Unrestricted web access: No. Gambling, contests: No. Expect **4+**
(or 9+ under the newer age ratings).

## Notes for App Review (paste in "Notes")

> The Logic Grid is a set of logic puzzle games. All game content is bundled
> in the app and works offline. No sign-in is needed to review: open The
> Fantastical Logic Grid from the games list, pick a difficulty and a theme,
> then Start (guests get a few new puzzles a day). A
> free account (email only) gives unlimited puzzles, syncs saves and races; it can be deleted in Menu > Account and
> sync > Delete account. Screen names typed by players are approved by an admin
> before anyone sees them, and players can report problems from Menu > Report a
> problem. There are no purchases, ads or payment links in the app.

## Keep in mind

- Build numbers come from the workflow's run number, so they always grow.
- The version shown is the game version (`desktop/src-tauri/tauri.conf.json`).
- Apple asks for builds made with its newest Xcode; the workflow picks the
  newest Xcode on GitHub's Mac machine.
- Guideline 4.2 ("minimum functionality") sometimes catches apps that look
  like a website in a frame. This app runs fully offline from its own files and
  uses AirPrint, the Files app and the device voices, which usually satisfies
  review. If Apple pushes back, reply with the notes above; Claude can add more
  native touches (haptics on marks, a native share sheet) if needed.
