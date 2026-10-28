# Launch: the game passed its health check, 6 things only you can do

The full health check on October 28 found the game ready to launch. The
website, game, API, database and Windows app are all up, every automatic test
passes, and no player has hit an error in the last two days. Fixes from the
check (a faster home page, the Connections status report, a keyboard guard in
the tutorial and the security alerts in build tools) are in pull request #149.

The website is already public at https://thelogicgrid.com, and the approved
ads start posting on Monday, November 2, as planned. These are the launch steps
only you can do. None of them cost money.

## 1. Try the game once yourself (5 minutes)

So you have seen launch-day behaviour with your own eyes.

1. Open https://thelogicgrid.com on your phone and your PC.
2. Start a puzzle, make a few marks, close the page, open it again: your marks should still be there.
3. Solve it (or use the hints), and try **Print** once.

## 2. Check the admin switches

1. Sign in at https://flg-api.btay74.workers.dev/admin/ with your game account.
2. Open **Settings and switches** and check that Races, Solo scores, Screen names, Ideas and problems and Celebrations are the way you want them.
3. Leave everything under **Support and premium** off. The money options stay off until you say so.

## 3. Post a welcome message for launch week

1. In the admin dashboard, open **Communication**.
2. Under **News in every player's Messages**, write a short welcome (for example: "Welcome to The Fantastical Logic Grid! A new daily puzzle every day. Tell us what you think with Menu > Ideas and problems.") and click **Publish news**. Players see it under Menu > Messages and news.
3. Optional: add a one-line **Banner on the home screen** for launch week.

## 4. Submit the sitemap to Google and Bing (if not done yet)

1. Google Search Console: https://search.google.com/search-console > thelogicgrid.com > **Sitemaps** > enter `sitemap.xml` > **Submit**.
2. Bing Webmaster Tools: https://www.bing.com/webmasters > thelogicgrid.com > **Sitemaps** > **Submit sitemap** > `https://thelogicgrid.com/sitemap.xml`.

## 5. Decide which sites the ads post to by themselves

The Connections report now works, and it shows the Facebook Page keys are set
but no keys for Bluesky, Mastodon, X, Instagram or Threads. That's fine: on
each ad's day, ads for those sites are emailed to you ready to paste. If you
want any of them to post by themselves, follow its steps in the admin
dashboard under **Connections and setup > Marketing autopilot**.

## 6. Android (only when you are ready)

The Android signing secrets `ANDROID_KEYSTORE_BASE64` and
`ANDROID_KEYSTORE_PASSWORD` are not in GitHub yet, so Android builds are not
signed for the store. The steps are in the earlier email "To do: Add the 2
Android signing secrets". Publishing on Google Play has a one-time **$25** fee, which
needs your OK first.

Not changed, on purpose: the money options (tip jar and Supporter) stay off,
the repository stays public until the private build server is ready, and no
marketing goes out before its approved day.
