# Facebook launch kit: set up the Page, then hand over the posting

You asked for the Facebook ads and launch materials so you can do the first setup yourself, then let the autopilot keep the content going. Everything here is **free**. Do not press **Boost post** or open **Ads Manager**: those cost money, and nothing in this plan needs them.

There are three parts. Part A takes about 15 minutes, Part B is reference copy for later, and Part C takes about 15 minutes.

## Part A: create the Facebook Page (free)

1. Sign in to Facebook with your own account and open <https://www.facebook.com/pages/create>.
2. Page name: **The Fantastical Logic Grid**. Category: **Video game**.
3. Bio (98 characters): **Free logic grid puzzles with a new story every time. A daily puzzle, hints that teach, printables.**
4. Click **Create Page**.
5. Profile picture: download <https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/web/icons/icon-1024.png> and upload it.
6. Cover photo: download <https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/facebook-cover-1640x624.png> and upload it. It is sized for Facebook, and the words sit in the middle so phones do not cut them off.
7. Contact details: website **https://thelogicgrid.com**, email **fantasticallogicgrid@gmail.com**.
8. Click **Add action button**, choose **Play game**, and use the link **https://thelogicgrid.com/?play=now**
9. Page **Settings** > **Username**: try **thelogicgrid** (or the closest free name).
10. Optional: if the game has an Instagram account, link it now under Page **Settings** > **Linked accounts** > **Instagram**.
11. Reply to this email or tell Claude the Page's web address, so it can go on the website and in the admin Marketing bio links.

## Part B: the approved Facebook ads, word for word

These are already in the admin app under **Marketing** (<https://flg-api.btay74.workers.dev/admin/#marketing>), with the pictures and the tracking links. You only post one by hand.

### 1. Page launch video, Wednesday 4 November (posts itself once Part C is done)

Video: <https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/promo/the-fantastical-logic-grid-promo-16x9-captioned.mp4> (90 seconds, captions burned in for sound-off feeds).

Words:

Meet The Fantastical Logic Grid 🧩

Every puzzle comes with its own story: a stolen crown at the castle, a mix-up at the bake sale, a mystery in the national park. Pick your theme and difficulty, then work out who did what, where and when.

✔ Free, plays in your browser
✔ A new daily puzzle for everyone
✔ Hints that teach, not tell
✔ Print it with an answer key

Play now: https://thelogicgrid.com/?play=now&utm_source=facebook&utm_medium=social&utm_campaign=launch-2026&utm_content=page-video

After it posts, **pin it** to the top of the Page (the three dots on the post > **Pin to top of Page**). If Part C is not done by 4 November, you will get the usual by-hand email that morning instead.

### 2. Facebook groups, free printables, Monday 23 November (always by hand)

Picture: <https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/square-1080.png>

Words:

Free printable logic puzzles, made fresh every time 🧩

You pick the theme (pets, cooking, sports, holidays and more) and the level, from Basic for beginners to Quantum Physicist. Each one prints with the story, the clues, the grid and an answer key on its own page. Great for brain breaks, puzzle night or a quiet afternoon.

Make one here: https://thelogicgrid.com/?play=now&utm_source=facebook&utm_medium=community&utm_campaign=launch-2026&utm_content=groups-printable

Only post in puzzle, brain-teaser, homeschool and activity-idea groups whose rules allow free resources, and **no more than one group a day**. Facebook does not let apps post in groups, so this one always stays by hand.

### 3. Teacher posts (waiting for your OK)

Four more Facebook posts for teachers (9 and 10 November, 14 December, 5 January) are drafts in the **Educators 2026** campaign. They post only after you approve them in admin.

## Part C: let the autopilot keep the Page going

"Maintaining content" means this: every day at 10:07 am Eastern the autopilot posts any Facebook or Instagram ad that is **Approved** in admin and due that day, then marks it Posted. New posts are always added as **drafts** for your approval first. It never posts anything you have not approved, never posts in groups, and never spends money.

1. If you use Instagram: in the Instagram app, make the game's account a free **Business** or **Creator** account (**Settings** > **Account type and tools**) and link it to the Page (Part A step 10).
2. Open <https://developers.facebook.com/apps>, click **Create app**, choose **Other**, then type **Business**. Name it **Logic Grid autopilot**. It stays in development mode, which is free and enough for your own Page.
3. Open <https://developers.facebook.com/tools/explorer>, choose that app, and click **Generate Access Token** with these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Allow it for the game's Page (and Instagram account).
4. Open <https://developers.facebook.com/tools/debug/accesstoken>, paste that token, click **Debug**, then **Extend Access Token**, and copy the long-lived token.
5. Back in the Explorer, paste the long-lived token and run `me/accounts`. Copy the game Page's `access_token` and `id`.
6. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret**.
7. Name: `META_PAGE_TOKEN`. Secret: the Page `access_token`. Click **Add secret**.
8. Add `META_PAGE_ID` the same way, with the Page `id`.
9. For Instagram: in the Explorer, run `<page id>?fields=instagram_business_account` and add its `id` as the secret `INSTAGRAM_ACCOUNT_ID`. Skip this if there is no Instagram account yet.
10. Test: open <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml>, click **Run workflow**, choose mode **check**. Facebook Page (and Instagram) should say connected. Nothing is posted in check mode.

Keep the tokens in a password manager such as Bitwarden (free). Never email or paste them in chat.

**To take access back at any time:** remove the app under Facebook **Settings** > **Business integrations**, or delete the `META_PAGE_TOKEN` secret on GitHub. You can also pause all automatic posting with the **Marketing autopilot** switch in admin **Settings**.

The same steps, with live status, are in admin under **Connections and setup**: <https://flg-api.btay74.workers.dev/admin/#connections>
