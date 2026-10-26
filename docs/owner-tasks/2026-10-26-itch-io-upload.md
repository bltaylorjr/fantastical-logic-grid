# Put the game on itch.io (10 minutes, free)

**Why:** itch.io is one of the free channels in the market test. Players there can play the game right on its itch.io page, without leaving the site. A copy of the game made for game sites is now built automatically after every change. It's free: set the price to **No payments**.

**Before you start:** you need a free itch.io account. Sign-up is step 15 of the "Set up the free accounts for the launch campaign" email.

**Steps:**

1. Download the zip from https://github.com/bltaylorjr/fantastical-logic-grid/releases/tag/web-portal (the file is `the-fantastical-logic-grid-web-game.zip`). Don't unzip it.
2. Open https://itch.io/game/new while signed in.
3. Fill in the title, short description and cover from the ad "itch.io game page" in the admin dashboard's **Marketing** section.
4. **Kind of project:** choose **HTML**.
5. **Pricing:** choose **No payments**.
6. **Uploads:** upload the zip, then tick **This file will be played in the browser**.
7. **Embed options:** set the viewport to **1280 × 800**, and tick **Mobile friendly**, **Fullscreen button** and **Click to launch in fullscreen**.
8. Press **Save & view page** and check that the game starts. Then set **Visibility** to **Public** and save again.
9. So players can sign in on itch.io too: open https://console.firebase.google.com, pick the game's project, go to **Authentication > Settings > Authorized domains**, press **Add domain**, and add `html-classic.itch.zone`. Then add `html.itch.zone` the same way. (Optional: without this the game still plays there, only sign-in doesn't.)

**Later updates:** whenever the game changes, a new zip appears at the same link. Upload it on the game's **Edit game** page and delete the old upload. Full notes are in docs/PORTALS.md in the repository.
