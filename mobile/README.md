# The Fantastical Logic Grid: Android and iOS apps

Both apps are thin native shells around the same web build (`dist/web`), so
every game feature, story and fix comes from `web/` with no mobile copy to
keep in step. Nothing here changes the web code.

```
mobile/shared/native-bridge.js   loaded before the game in both apps
mobile/android/                  Android app (Java, no third-party libraries)
mobile/ios/                      iPhone and iPad app (Swift, XcodeGen project spec)
mobile/scripts/mobile-e2e.cjs    phone check in headless Chromium
mobile/scripts/android-icons.py  regenerates the Android launcher icons
.github/workflows/mobile.yml     builds both apps on GitHub
```

## What the native side adds

A phone WebView leaves out some things the game uses in a browser. The bridge
fills them in:

| Game feature | Android | iOS |
| --- | --- | --- |
| Print (and Save as PDF) | system print service | AirPrint sheet |
| Save to file (`.flg.json`) | system "Save to" picker | Files export sheet |
| Open a puzzle file | system file picker | built in |
| Keep the screen on while playing | window keep-screen-on flag | idle timer off |
| Device voice (when no AI voice is set) | Android text-to-speech | built in |
| Back button / gesture | closes the open dialog, then leaves the app | (none) |
| Status and navigation bar colours | follow the game's light, dark or high-contrast theme | same |

The game files are served from inside the app (`https://appassets.androidplatform.net/`
on Android, `app://localhost/` on iOS), so the game works fully offline; saves
stay in the app's own storage. The offline service worker is skipped because
nothing has to be downloaded. The version comes from
`desktop/src-tauri/tauri.conf.json`, like the desktop app.

## Building

Run `npm ci && npm run build` in the repo root first (writes `dist/web`).

**Android** (JDK 17+ and the Android SDK, or just open `mobile/android` in Android Studio):

```
cd mobile/android
./gradlew assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
FLG_KEYSTORE=/path/android-release.p12 FLG_KEYSTORE_PASSWORD=... ./gradlew assembleRelease bundleRelease
```

`assembleRelease` makes the signed APK to sideload; `bundleRelease` makes the
`.aab` that Google Play wants. Every update must be signed with the same key,
or phones refuse to install it over the old version. Keep the key and its
password safe and out of the repo.

**iOS** (a Mac with Xcode):

```
brew install xcodegen
cd mobile/ios && xcodegen && open LogicGrid.xcodeproj
```

Pick your team under Signing & Capabilities, then run on a device or archive
for TestFlight and the App Store.

**On GitHub**, the "Mobile apps" workflow builds Android on every change. With the
repository secrets `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`
it makes the signed APK and AAB, and after each "Release desktop app" run it
adds the APK to that release (or start it by hand with "Add the APK to the
current release" ticked). Without them it makes a debug APK. The iOS job is
paused and runs only when the workflow is started by hand; it compiles the app
for the Simulator, which needs no Apple account. Google Play steps and listing:
`docs/GOOGLE-PLAY.md`.

**Phone check**: `node mobile/scripts/mobile-e2e.cjs` (needs Playwright)
serves `dist/web` the way the Android app does, stands in for the Android side
and checks each bridge feature, plus the layout at 360 and 412 px wide.

## Installing without a store

* **Android:** copy the `.apk` to the phone (or download it from the GitHub
  Release), open it, and allow "Install unknown apps" for the app you opened it
  with when Android asks. Later versions install over it and keep your saves.
* **iPhone/iPad:** Apple allows no sideloading without a developer account.
  Until then, the game installs from Safari as a web app: open the hosted game,
  tap Share, then *Add to Home Screen*. It runs offline and keeps its saves.

## Store accounts

| Store | Account | Cost | Notes |
| --- | --- | --- | --- |
| Google Play | Google Play Console developer account | US$25 once | New personal accounts must run a closed test with at least 12 testers for 14 days before going public. Upload the `.aab`. |
| Apple App Store | Apple Developer Program | US$99 a year | Needs a Mac (or a cloud Mac) to sign; TestFlight for testers, then App Review. |
