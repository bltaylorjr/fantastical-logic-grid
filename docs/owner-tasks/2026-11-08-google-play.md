# Put the Android app on Google Play (your steps, in order)

**Why:** you asked what it takes to get the game onto Google Play. Claude has
the app, the store pictures, the listing text and every form answer ready.
These are the steps only you can do. Full answers to paste are in
https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/GOOGLE-PLAY.md

**Cost:** one-time **$25** Google fee (step 2). Everything else is free.
Reply OK in the project before paying.

**Steps:**

1. **Add the 2 Android signing secrets** (5 minutes, free). Without them
   GitHub can only build a test copy that Google won't accept. Follow the
   earlier email "Add the 2 Android signing secrets", or:
   1. In the Claude project Library open `fantastical-logic-grid-app/.private`
      and download `android-release.p12.base64` and `android-release.password`.
   2. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions/new
   3. Name `ANDROID_KEYSTORE_BASE64`, paste the whole `.p12.base64` file, **Add secret**.
   4. Open the link again. Name `ANDROID_KEYSTORE_PASSWORD`, paste the one line
      from `.password`, **Add secret**.
   5. Tell Claude "secrets added". Claude then builds the signed app and puts
      the `.apk` (for your phone) and the `.aab` (for Google) on the latest
      release and in your Downloads\Projects folder.
2. **Create the Google Play developer account** ($25 once).
   1. Go to https://play.google.com/console/signup and pick **Personal**.
   2. Developer account email: `fantasticallogicgrid@gmail.com`.
      Contact email players see: `support@thelogicgrid.com`.
      Website: `https://thelogicgrid.com`.
   3. Pay the $25 and upload a photo of your government ID when asked.
      Google can take a few days to check it.
   4. Install the **Google Play Console** app on your Android phone and sign in
      with the same account. Google uses it to confirm you own an Android phone.
3. **Create the app** in Play Console: **Create app**, name
   *The Fantastical Logic Grid*, English (United States), **Game**, **Free**,
   tick the declarations.
4. **Fill in "Set up your app"** with the answers in GOOGLE-PLAY.md: privacy
   policy https://thelogicgrid.com/privacy/, no ads, app access, target
   audience **13 and over**, content rating questionnaire, Data safety.
5. **Store listing:** paste the short and full description from GOOGLE-PLAY.md
   and upload the pictures from
   https://github.com/bltaylorjr/fantastical-logic-grid/tree/main/media/play-store
   (icon-512.png, feature-graphic.png and the six phone-*.png screenshots).
   Claude will also copy them to Downloads\Projects\Google Play.
6. **Closed test (required for new personal accounts):**
   **Test and release > Testing > Closed testing > Create track**, upload the
   `.aab`, keep **Play App Signing** on (the default). Add testers' Gmail
   addresses and send them the opt-in link. You need **at least 12 testers
   opted in for 14 days in a row**. Ask 15 or more friends or family with
   Android phones, and ask them to play a few puzzles during the two weeks.
7. **Apply for production** (Dashboard) after the 14 days, answer Google's
   short questions about the test, and wait (usually under a week).
8. **Release:** Production > Create new release, upload the latest `.aab`,
   roll out. Claude can prepare each new `.aab` for you.

**One decision for you in the project thread:** the Android app asks for an
app key. Google's reviewers and your testers need to get past that, so Claude
asked whether copies installed from Google Play should skip the key.
