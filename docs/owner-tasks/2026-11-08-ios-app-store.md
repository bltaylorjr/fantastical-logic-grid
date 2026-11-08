# iPhone app: join Apple's developer program and connect it to GitHub (8 Nov 2026)

**Why:** The iPhone and iPad app is ready for the App Store. GitHub builds, signs and uploads it on its own Mac machines, so you don't need a Mac. It only needs your Apple developer account and one key.

**Cost:** Apple Developer Program, $99 a year (you approved it). Everything else is free.

**Price to pick:** **Free.** The game is free on the website, Windows and Android, and Apple doesn't allow app keys from outside the store. Money from iPhone players can come later through an Apple in-app "Supporter" purchase. Full reasons: docs/APP-STORE.md.

## Steps

1. **Join** at https://developer.apple.com/programs/enroll/ as an **Individual** ($99/year). Apple checks your ID in the Apple Developer app on an iPhone; approval can take 1 to 2 days.
2. **Team ID:** https://developer.apple.com/account > Membership details > Team ID.
3. **API key:** https://appstoreconnect.apple.com/access/integrations/api > Team Keys > **+**. Name `GitHub`, Access **Admin**. Download the `.p8` file (only once) and note the **Key ID** and the **Issuer ID**.
4. **GitHub secrets** at https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions:
   1. `APP_STORE_CONNECT_KEY_ID` = the Key ID
   2. `APP_STORE_CONNECT_ISSUER_ID` = the Issuer ID
   3. `APP_STORE_CONNECT_KEY_BASE64` = the `.p8` file as base64. In Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\AuthKey_XXXX.p8")) | Set-Clipboard`, then paste.
   4. On the **Variables** tab: `APPLE_TEAM_ID` = the Team ID
5. **App ID:** https://developer.apple.com/account/resources/identifiers/add/bundleId > App IDs > App. Explicit Bundle ID `com.fantasticallogicgrid.app`, description "The Fantastical Logic Grid".
6. **New app:** https://appstoreconnect.apple.com/apps > **+** > New App. iOS, name **The Fantastical Logic Grid**, English (U.S.), bundle ID `com.fantasticallogicgrid.app`, SKU `flg-ios`.
7. **First build:** https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/ios.yml > **Run workflow**. About 15 minutes after it finishes, the build shows under TestFlight. Later releases upload by themselves.
8. **Test on your iPhone:** install **TestFlight** from the App Store, add yourself under TestFlight > Internal Testing, open the invite.
9. **Listing and review:** paste the text, privacy and age answers from docs/APP-STORE.md (https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/APP-STORE.md), upload the screenshots in media/app-store, set price **Free**, pick the build, and click **Add for Review**.

Tell Claude in the project when steps 1 to 4 are done, and it will start the first build and check it.
