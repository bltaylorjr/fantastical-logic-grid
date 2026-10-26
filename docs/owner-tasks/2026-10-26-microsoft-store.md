# Put the game in the Microsoft Store (about 30 minutes, free)

**Why:** a Store listing helps people find the game on Windows, and Store installs show no "Windows protected your PC" warning. Microsoft stopped charging individual developers in September 2025, and the free PWABuilder tool makes the Store package from the website, so this costs nothing. The Store version updates itself whenever the website changes.

**Before you start:** you need the free Microsoft Store developer account from step 20 of the "Set up the free accounts for the launch campaign" email (https://storedeveloper.microsoft.com, choose **Individual developer**).

**Steps:**

1. Open https://partner.microsoft.com/dashboard/apps-and-games/overview, choose **New product** > **MSIX or PWA app**, and reserve the name **The Fantastical Logic Grid**.
2. In the new app, open **Product management** > **Product identity**. Leave this page open. You need three values from it: **Package/Identity/Name**, **Package/Identity/Publisher** and **Package/Properties/PublisherDisplayName**. They are not secret.
3. In another tab, open https://www.pwabuilder.com, type `https://thelogicgrid.com` and press **Start**.
4. Press **Package for stores**, then **Windows**, then **Generate package**. Paste the three values from step 2 into **Package ID**, **Publisher ID** and **Publisher display name**. Leave everything else as it is, and download the zip.
5. Back in Partner Center, press **Start your submission** and fill in each section:
   - **Pricing and availability:** Free.
   - **Properties:** category **Games**, subcategory **Puzzle & trivia**. Privacy policy: `https://thelogicgrid.com/privacy/`. Website: `https://thelogicgrid.com`. Support contact: `fantasticallogicgrid@gmail.com`.
   - **Age ratings:** answer the short questionnaire. The game has no violence, no purchases and no free-text chat.
   - **Packages:** unzip the PWABuilder download and upload the file ending in `.msixbundle`.
   - **Store listings:** choose **English (United States)**. Copy the short description, description and search terms from https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/MICROSOFT-STORE.md#listing-text. Upload the two screenshots from https://github.com/bltaylorjr/fantastical-logic-grid/tree/main/media/store (open each, then press the download button).
6. Press **Submit to the Store**. Microsoft usually finishes checking in one to three days and emails you.
7. When it's live, reply in the project with the Store link, so it can be added to the website and the game's Install menu.

If PWABuilder or Partner Center shows a warning you're not sure about, reply in the project with a screenshot.
