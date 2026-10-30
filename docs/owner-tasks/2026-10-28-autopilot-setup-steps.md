# Set up automatic posting on every other site

Facebook is done. These are the steps for every other site the autopilot can post to. Everything is free. Never pick a paid plan or press Boost.

**Do them in this order** (by first posting day): Bluesky (3 Nov), LinkedIn (3 Nov), Mastodon (4 Nov), Instagram and Threads (5 Nov), X (6 Nov), YouTube (9 Nov), TikTok (10 Nov), Reddit (11 Nov), Pinterest (17 Nov). Any site you have not finished by its day is emailed to you to post by hand, so nothing is missed.

**Apply early for these three free approvals,** because posts stay private until they come through: the YouTube API audit (can take a few weeks), TikTok app review (about a week) and Pinterest Standard access (a few days).

**Where keys go:** every key is a GitHub repository secret at <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> (click **New repository secret**). The one exception is `MASTODON_URL`, which is a variable on the **Variables** tab of the same page. Keep passwords in a password manager such as Bitwarden. Never email or paste a key anywhere else.

**The Get the key button:** LinkedIn, Pinterest, YouTube, TikTok and Reddit each have a **Get the key** button in admin > Connections and setup. You paste the app id, click Allow on the site, paste the app secret, and admin shows the key to save. You don't need to type any commands.

**After each site,** tell me "done" in the chat, or run <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`. That signs in to each site and posts nothing.

Secret values are never in this email, only their names.

The same steps, with live status, are in the admin dashboard under **Connections and setup**: <https://flg-api.btay74.workers.dev/admin/#connections>

## 1. Bluesky (automatic posts)

**Why:** Lets the marketing autopilot post approved Bluesky ads on their day. Without it, the Bluesky ad is emailed to you to post by hand.

**Cost:** Free. An app password can only post; it cannot change the account password or settings.

**Keys to save (name, then where):**

- `BLUESKY_HANDLE`, GitHub repository secret. The game account's handle, for example thelogicgrid.bsky.social.
- `BLUESKY_APP_PASSWORD`, GitHub repository secret. An app password, never the account password.

**Steps:**

1. Sign in to <https://bsky.app> as the game's account, then open **Settings** > **Privacy and security** > **App passwords** > **Add App Password**. Name it `Logic Grid autopilot` and copy the password it shows.
2. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `BLUESKY_APP_PASSWORD`).
3. Name: `BLUESKY_APP_PASSWORD`. Secret: that app password. Click **Add secret**.
4. Add `BLUESKY_HANDLE` the same way: the handle without the @.
5. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`. It should say Bluesky: connected.

**Links:** [Bluesky app passwords](https://bsky.app/settings/app-passwords) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 2. Mastodon (automatic posts)

**Why:** Lets the marketing autopilot post approved Mastodon ads on their day.

**Cost:** Free.

**Keys to save (name, then where):**

- `MASTODON_URL`, GitHub repository variable. The server the account is on, for example https://mastodon.social.
- `MASTODON_TOKEN`, GitHub repository secret. An access token that can only post.

**Steps:**

1. Sign in to your Mastodon server, open **Preferences** > **Development** > **New application**. Name it `Logic Grid autopilot`. Under scopes, untick everything except `read:accounts`, `write:statuses` and `write:media`. Click **Submit**.
2. Open the new application and copy **Your access token**.
3. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `MASTODON_TOKEN`).
4. Name: `MASTODON_TOKEN`. Secret: that access token. Click **Add secret**.
5. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions>, click **New repository variable**, name `MASTODON_URL`, value your server address (for example `https://mastodon.social`).
6. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [Mastodon servers](https://joinmastodon.org/servers) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 3. X (automatic posts)

**Why:** Lets the marketing autopilot post approved X ads on their day (text and link; the link shows the game's picture card).

**Cost:** Free on the X API Free plan, which allows far more posts a month than this campaign needs. Do not pick a paid plan.

**Keys to save (name, then where):**

- `X_API_KEY`, GitHub repository secret. API Key (consumer key).
- `X_API_SECRET`, GitHub repository secret. API Key Secret.
- `X_ACCESS_TOKEN`, GitHub repository secret. Access Token for the game's X account, made after setting Read and write.
- `X_ACCESS_SECRET`, GitHub repository secret. Access Token Secret.

**Steps:**

1. Signed in as the game's X account, open <https://developer.x.com/en/portal/dashboard> and sign up for the **Free** plan. Describe the use as: posting the game's own scheduled announcements.
2. Open your app > **User authentication settings** > **Set up**. App permissions: **Read and write**. Type: **Web App, Automated App or Bot**. Callback URI and website: `https://thelogicgrid.com`. Save.
3. Open **Keys and tokens**. Regenerate the **API Key and Secret** and copy both. Then generate the **Access Token and Secret** (after setting Read and write) and copy both.
4. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `X_API_KEY`).
5. Name: `X_API_KEY`. Secret: the API Key. Click **Add secret**.
6. Add `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_SECRET` the same way.
7. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [X developer portal](https://developer.x.com/en/portal/dashboard) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 4. Instagram (automatic posts)

**Why:** Lets the autopilot post approved Instagram pictures and Reels on their day. It reuses the Facebook app you already made.

**Cost:** Free.

**Keys to save (name, then where):**

- `INSTAGRAM_ACCOUNT_ID`, GitHub repository secret. The Instagram business account id (a number).
- `META_PAGE_TOKEN`, GitHub repository secret. Replace the current one with a new token that also has the Instagram permissions.

**Steps:**

1. Make an Instagram account for the game in the Instagram app (sign up with fantasticallogicgrid@gmail.com).
2. Switch it to a free **Business** or **Creator** account: **Settings** > **Account type and tools** > **Switch to professional account**.
3. Link it to the Facebook Page: on the Page, **Settings** > **Linked accounts** > **Instagram** > **Connect account**.
4. Open <https://developers.facebook.com/apps>, click **Logic Grid autopilot** > **Use cases** > **Add use case**, and add **Manage messaging & content on Instagram**. Click **Customize** on it and **Add** `instagram_basic` and `instagram_content_publish`.
5. Open <https://developers.facebook.com/tools/explorer>. Choose **Logic Grid autopilot** and **Get User Access Token**. Make sure all five permissions are listed: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` and `instagram_content_publish`. Click **Generate Access Token** and allow both the Page and the Instagram account.
6. Make it last, as before: click the **i** in the token box > **Open in Access Token Tool** > **Extend Access Token**, and copy the long token.
7. In the Explorer, paste the long token and run `me/accounts`. Copy the Page's `access_token`.
8. On GitHub secrets (<https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions>), click the pencil next to `META_PAGE_TOKEN` and paste the new Page access_token.
9. In the Explorer, run `<your page id>?fields=instagram_business_account` (use the Page id number). Copy the `id` it shows.
10. Add the secret `INSTAGRAM_ACCOUNT_ID` with that id.
11. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`. Both Facebook Page and Instagram should say connected.

## 5. Threads (automatic posts)

**Why:** Lets the marketing autopilot post approved Threads ads on their day.

**Cost:** Free. The token lasts 60 days; make a new one when the check says it stopped working.

**Keys to save (name, then where):**

- `THREADS_USER_ID`, GitHub repository secret. The Threads account id (a number).
- `THREADS_TOKEN`, GitHub repository secret. A long-lived Threads token (60 days).

**Steps:**

1. Open <https://developers.facebook.com/apps>, click **Create app**, and choose the use case **Access the Threads API**. Name it `Logic Grid Threads`.
2. In the app, open **App roles** > **Roles** > **Add people** > **Threads testers** and add the game's Threads account. Accept the invite in Threads (**Settings** > **Account** > **Website permissions** > **Invites**).
3. Open **Use cases** > **Access the Threads API** > **Settings**. Tick `threads_basic` and `threads_content_publish`, then use **User Token Generator** to make a token for the game account and copy it.
4. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `THREADS_TOKEN`).
5. Name: `THREADS_TOKEN`. Secret: that token. Click **Add secret**.
6. Open `https://graph.threads.net/v1.0/me?fields=id&access_token=` followed by the token in your browser, and add the `id` it shows as the secret `THREADS_USER_ID`.
7. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [Threads API](https://developers.facebook.com/docs/threads) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 6. LinkedIn (automatic posts)

**Why:** Lets the marketing autopilot share approved LinkedIn ads on your profile on their day, with the link's picture card.

**Cost:** Free (the Share on LinkedIn product). LinkedIn keys last 60 days: when the check says LinkedIn stopped working, press **Get the key** again.

**Keys to save (name, then where):**

- `LINKEDIN_TOKEN`, GitHub repository secret. A member key that can post for you (60 days).

**Steps:**

1. Open <https://www.linkedin.com/developers/apps> and click **Create app**. Name: `Logic Grid autopilot`. LinkedIn asks for a Company Page: pick or create a free Page for the game. Upload the game icon and tick the agreement.
2. In the app, open **Products** and click **Request access** on **Share on LinkedIn** and on **Sign In with LinkedIn using OpenID Connect**. Both are instant and free.
3. Open **Auth**. Under **Authorized redirect URLs** add `https://flg-api.btay74.workers.dev/admin/` exactly, and copy the **Client ID** and **Primary Client Secret**.
4. In admin, **Connections and setup** > this card > **Get the key**. Paste the id, sign in to LinkedIn and click **Allow**, then paste the secret when admin asks.
5. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `LINKEDIN_TOKEN`).
6. Name: `LINKEDIN_TOKEN`. Secret: the key admin shows. Click **Add secret**.
7. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [LinkedIn developer apps](https://www.linkedin.com/developers/apps) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 7. Pinterest (automatic pins)

**Why:** Lets the marketing autopilot pin approved Pinterest ads on their day, with the picture and the tracked link, to the board named in the ad.

**Cost:** Free. A new Pinterest app starts with Trial access, where pins are visible only to you. Ask for **Standard access** (free, a short form) and add the keys once it is approved.

**Keys to save (name, then where):**

- `PINTEREST_APP_ID`, GitHub repository secret. The app id.
- `PINTEREST_APP_SECRET`, GitHub repository secret. The app secret key.
- `PINTEREST_REFRESH_TOKEN`, GitHub repository secret. Made by Get the key; lasts a year.
- `PINTEREST_BOARD_ID`, GitHub repository secret. Only if no board name matches the ad: the board to pin to. Optional.

**Steps:**

1. With the game's free Pinterest business account, make the boards the ads name (for example Printable Logic Puzzles and Classroom Logic Puzzles).
2. Open <https://developers.pinterest.com/apps> and click **Connect app**. Name: `Logic Grid autopilot`, website `https://thelogicgrid.com`, privacy policy `https://thelogicgrid.com/privacy/`.
3. In the app's settings add the redirect URI `https://flg-api.btay74.workers.dev/admin/` exactly, and copy the **App id** and **App secret key**.
4. Ask for **Standard access** from the app page (free). Wait for the approval email before the next step, so pins are public.
5. In admin, **Connections and setup** > this card > **Get the key**. Paste the id, sign in to Pinterest and allow it, then paste the secret when admin asks.
6. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `PINTEREST_REFRESH_TOKEN`).
7. Name: `PINTEREST_REFRESH_TOKEN`. Secret: the refresh key admin shows. Click **Add secret**.
8. Add `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET` the same way.
9. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [Pinterest developer apps](https://developers.pinterest.com/apps) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 8. YouTube (automatic uploads)

**Why:** Lets the marketing autopilot upload approved YouTube videos and Shorts on their day, with the title and description from the ad. Captions and playlists stay by hand: the email says so.

**Cost:** Free (the YouTube Data API allows about 6 uploads a day). Google keeps videos from a new app private until the app passes a free audit, so add the keys once it is approved.

**Keys to save (name, then where):**

- `YOUTUBE_CLIENT_ID`, GitHub repository secret. OAuth client ID (Web application).
- `YOUTUBE_CLIENT_SECRET`, GitHub repository secret. OAuth client secret.
- `YOUTUBE_REFRESH_TOKEN`, GitHub repository secret. Made by Get the key.

**Steps:**

1. Make the game's YouTube channel at <https://www.youtube.com/create_channel> (signed in as fantasticallogicgrid@gmail.com).
2. Open <https://console.cloud.google.com/apis/library/youtube.googleapis.com> in the project `the-fantastical-logic-grid` and click **Enable**.
3. Open **Google Auth Platform** > **Branding**: app name `Logic Grid autopilot`, support email fantasticallogicgrid@gmail.com, home page `https://thelogicgrid.com`, privacy `https://thelogicgrid.com/privacy/`. Then **Audience** > **Publish app** (In production), so the key does not stop after 7 days.
4. Open **Clients** > **Create client** > **Web application**. Under **Authorized redirect URIs** add `https://flg-api.btay74.workers.dev/admin/` exactly. Copy the **Client ID** and **Client secret**.
5. Fill in the free YouTube API audit form at <https://support.google.com/youtube/contact/yt_api_form> so uploads can be public. Wait for the approval before the next step.
6. In admin, **Connections and setup** > this card > **Get the key**. Paste the id, sign in as the channel's Google account and allow it (click **Advanced** > **Go to Logic Grid autopilot** if Google warns the app is unverified: it is your own app), then paste the secret when admin asks.
7. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `YOUTUBE_REFRESH_TOKEN`).
8. Name: `YOUTUBE_REFRESH_TOKEN`. Secret: the refresh key admin shows. Click **Add secret**.
9. Add `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` the same way.
10. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [Google Cloud console](https://console.cloud.google.com/) · [YouTube API audit form](https://support.google.com/youtube/contact/yt_api_form) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 9. TikTok (automatic videos)

**Why:** Lets the marketing autopilot post approved TikTok videos on their day, with the caption from the ad.

**Cost:** Free. TikTok reviews every app before it may post publicly (free, about a week); until then posts would be private, so add the keys once it is approved.

**Keys to save (name, then where):**

- `TIKTOK_CLIENT_KEY`, GitHub repository secret. The app's client key.
- `TIKTOK_CLIENT_SECRET`, GitHub repository secret. The app's client secret.
- `TIKTOK_REFRESH_TOKEN`, GitHub repository secret. Made by Get the key; lasts a year.

**Steps:**

1. Open <https://developers.tiktok.com>, sign in with the game's TikTok account, and **Manage apps** > **Connect an app**. Name: `Logic Grid autopilot`, website `https://thelogicgrid.com`, terms `https://thelogicgrid.com/terms/`, privacy `https://thelogicgrid.com/privacy/`.
2. Add the products **Login Kit** (redirect URI `https://flg-api.btay74.workers.dev/admin/` exactly) and **Content Posting API** (turn on **Direct Post**). Copy the **Client key** and **Client secret**.
3. Click **Submit for review**. Say it posts the game's own scheduled videos to its own account. Wait for the approval email.
4. In admin, **Connections and setup** > this card > **Get the key**. Paste the id, sign in to TikTok and allow it, then paste the secret when admin asks.
5. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `TIKTOK_REFRESH_TOKEN`).
6. Name: `TIKTOK_REFRESH_TOKEN`. Secret: the refresh key admin shows. Click **Add secret**.
7. Add `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` the same way.
8. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [TikTok for Developers](https://developers.tiktok.com/) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 10. Reddit (automatic posts)

**Why:** Lets the marketing autopilot post approved Reddit ads in the subreddit named in the ad on their day. Ads that point at a weekly thread or need a judgement call stay by hand. Replying to comments is always yours.

**Cost:** Free. Reddit may ask you to fill in a short form for API access first.

**Keys to save (name, then where):**

- `REDDIT_CLIENT_ID`, GitHub repository secret. The id shown under the app name.
- `REDDIT_CLIENT_SECRET`, GitHub repository secret. The app secret.
- `REDDIT_REFRESH_TOKEN`, GitHub repository secret. Made by Get the key; does not expire.

**Steps:**

1. Sign in to Reddit as the account you post from. Comment around the subreddits for a week or two first: many hide posts from brand-new accounts.
2. Open <https://www.reddit.com/prefs/apps> and click **create another app**. Name: `Logic Grid autopilot`, type **web app**, redirect uri `https://flg-api.btay74.workers.dev/admin/` exactly. If Reddit asks you to request API access, fill in that form first (free).
3. Copy the id under the app name and the **secret**.
4. In admin, **Connections and setup** > this card > **Get the key**. Paste the id, then click **Allow** on Reddit, then paste the secret when admin asks.
5. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `REDDIT_REFRESH_TOKEN`).
6. Name: `REDDIT_REFRESH_TOKEN`. Secret: the refresh key admin shows. Click **Add secret**.
7. Add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` the same way.
8. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [Reddit apps](https://www.reddit.com/prefs/apps) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)
