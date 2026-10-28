# Add the 2 Android signing secrets (about 5 minutes, free)

**Why:** the Android app is back on. GitHub builds it on every change, but
without these two secrets it can only make a test copy that won't install
over the app you already have. With them, every build is signed with the
game's own key, and the APK is added to each GitHub Release.

The values are in the project's shared files, in the folder
`fantastical-logic-grid-app/.private`. They are private: don't email them or
post them anywhere else.

**Steps:**

1. In the Claude project, open the **Library** (project files), go to
   `fantastical-logic-grid-app/.private`, and download
   `android-release.p12.base64` and `android-release.password`.
   Keep a copy of the whole `.private` folder somewhere safe, like a USB stick:
   if the key is lost, the installed app can never be updated.
2. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions/new
3. **Name:** `ANDROID_KEYSTORE_BASE64`. **Secret:** open `android-release.p12.base64`
   in Notepad, press Ctrl+A, Ctrl+C, and paste it in. Press **Add secret**.
4. Open the same link again.
   **Name:** `ANDROID_KEYSTORE_PASSWORD`. **Secret:** open `android-release.password`
   in Notepad and copy the one line (no spaces before or after). Press **Add secret**.
5. Reply in the project thread "Resume Android app release" with "secrets added".
   Claude then builds the signed app, adds it to the current release, and
   saves it to your Downloads\Projects folder.

**After that (no rush):** install the APK on your Android phone and try a puzzle.
Copy the `.apk` to the phone (or open the GitHub Release on the phone), open it,
and allow "Install unknown apps" when Android asks.

**Google Play:** the listing, pictures and form answers are ready in
https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/GOOGLE-PLAY.md.
Google charges a **one-time $25** fee to publish. Don't pay it until you have
said OK in the project.
