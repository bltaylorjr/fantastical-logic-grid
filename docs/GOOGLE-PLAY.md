# The game on Google Play

The Android app (`mobile/android`) is a small native shell around the same
web build as the website, so every game change reaches it with the next build.
The "Mobile apps" workflow builds the signed APK (to install directly) and the
AAB (the file Google Play wants) on every change, once the two signing secrets
are set. iOS is paused.

## Cost and rules (checked 2026-10-27)

- **One-time $25 registration fee.** This is the only cost and needs Bobby's
  OK before it is paid. Everything else here is free.
- Google checks your identity with a government ID, and asks you to confirm
  you own an Android phone through the Play Console app.
- **New personal accounts must run a closed test first:** at least 12 testers
  opted in for 14 days in a row. Only then can you ask for production access
  (Google usually answers within a week). Friends and family with a Google
  account and an Android phone are enough; they join through a link.

## What is ready in the repository

- Package name: `com.fantasticallogicgrid.app`. It can never change once uploaded.
- Signed builds: the "Mobile apps" workflow's artifact `android-<version>`
  holds the `.aab` for Play and the `.apk` for direct installs. Target SDK 36
  meets Play's current requirement.
- Pictures in `media/play-store/` (remake with `npm run build && node scripts/play-store-assets.cjs`):
  - `icon-512.png`: app icon, 512 × 512
  - `feature-graphic.png`: banner, 1024 × 500
  - `phone-*.png`: six phone screenshots, 1080 × 1920 (light and dark)
- Privacy policy: https://thelogicgrid.com/privacy/
- Listing text, Data safety and content rating answers: below.

## Steps (owner)

1. Pay the fee only after saying OK in the project. Then sign up at
   https://play.google.com/console/signup as a **Personal** account with
   `fantasticallogicgrid@gmail.com` as the developer account email (private,
   for Google only). When it asks for the **contact email** that players see,
   use `support@thelogicgrid.com`. Finish the identity and phone checks.
2. **Create app**: name **The Fantastical Logic Grid**, language English (United States),
   **Game**, **Free**. Tick the declarations.
3. **Set up your app** (the dashboard lists each item). Use the answers below.
4. **Testing > Closed testing > Create track**. Upload the `.aab`. When asked
   about **Play App Signing**, keep the default (Google holds the app signing key;
   our key becomes the upload key). Add testers by email or a Google Group,
   send them the opt-in link, and keep at least 12 of them opted in for 14 days.
5. After 14 days: **Dashboard > Apply for production**, answer the short
   questions about the test, and wait for Google.
6. When it is approved: **Production > Create new release**, upload the latest
   `.aab`, and roll out.

Note on Play App Signing: phones that installed the APK directly from the
website or GitHub can't update to the Play version (different signature).
Those players should sign in to sync their saves, uninstall, and install from
Play once. The directly installed APK keeps working and keeps getting updates
from GitHub.

## Store listing

**App name (30 characters max)**
The Fantastical Logic Grid

**Short description (80 characters max)**
Story logic grid puzzles. Every case is a new story. Free, no ads, works offline.

**Full description**
Every case in The Fantastical Logic Grid is a brand new story. Read the clues, fill the grid with X and O, and close the case. Every puzzle has exactly one answer you can reach without guessing.

• Seven difficulty levels, from Basic to Theoretical Physicist, and almost any size
• More than 40 themes, from mysteries and holidays to national parks
• A new daily puzzle for everyone, with streaks and badges
• Hints that explain the reasoning, unlimited undo, and autosave
• Characters who read their clues aloud, in natural voices
• Play in 100 languages
• Print any puzzle, with the answer key on its own page
• Race other players and challenge friends to beat your time
• Screen reader friendly, with dark and high-contrast colors and a Silent mode
• Works offline once installed

Free, with no ads. An account is optional and only needed to sync between devices.

**Category:** Game > Puzzle. **Tags:** Logic, Puzzle, Brain games (pick what Play offers).
**Contact email:** support@thelogicgrid.com. **Website:** https://thelogicgrid.com

## App content answers

- **Privacy policy:** https://thelogicgrid.com/privacy/
- **Ads:** No, the app has no ads.
- **App access:** All features are available without signing in (races need a
  free account; reviewers don't need one).
- **Target audience:** 13 and over is the simplest choice. Picking an age
  under 13 brings in Google's Families rules (stricter checks on sign-in and
  data). Teachers' printable packs on the website are not affected.
- **Content rating (IARC questionnaire):** category **Puzzle**. No violence,
  fear, sexual content, bad language, drugs or gambling. Users can interact:
  answer yes only to "users can see each other's screen names" (on the
  scoreboard and in races; names are approved by an admin; there is no chat).
  No purchases. Expect "Everyone" / PEGI 3.
- **Data safety:**
  - Data is encrypted in transit: **Yes**. Users can ask for deletion: **Yes**
    (Menu > Account and sync > Delete account, in the app or on the website).
  - **Personal info > Email address**: collected, optional, for account
    management and the optional daily puzzle email. Not shared.
  - **Personal info > User IDs**: collected, optional (the sign-in account id), account management. Not shared.
  - **App activity > App interactions**: collected, optional (anonymous play
    summaries; can be turned off in Settings > Learning), analytics. Not shared.
  - **App activity > Other user-generated content**: collected, optional
    (ideas and problem reports players send, and synced notes), for app
    functionality and support. Not shared.
  - **App info and performance > Crash logs**: collected, for analytics. Not shared.
  - Text sent for natural voices and translations goes to Google and
    Cloudflare as service providers working for the game, which Play does not
    count as sharing.
- **Government app / financial features / health:** No.
- **News app:** No.

## Keep in mind

- Support the game links: the tip jar and Supporter switches are off. Before
  turning any of them on inside the Android app, check Google Play's payments
  policy, which limits payment links in apps from Play.
