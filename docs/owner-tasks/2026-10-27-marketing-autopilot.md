# Turn on the marketing autopilot: one free key per site (about 1 hour in total)

**What changed:** the approved launch ads now post themselves on their posting day, every morning at about 10 am Eastern. This works for the six sites whose free official tools allow it: **Bluesky, Mastodon, X, the Facebook Page, Instagram and Threads**. Each needs a key, saved once as an encrypted GitHub secret. A site without its key is not skipped: its ad comes to this inbox that morning, ready to post by hand.

**Still by hand (emailed to you on each posting day, with the words, link and files ready):** Reddit, Hacker News, Product Hunt, TikTok, YouTube, LinkedIn, Pinterest, Facebook groups, itch.io, Indie Hackers, AlternativeTo, the Microsoft Store and the friends-and-family email. These sites either have no posting tool, forbid automated promotional posts (Reddit bans accounts for it), or only let unreviewed apps post privately (TikTok, YouTube). Posting those automatically would risk the accounts.

**About passwords:** the autopilot never needs or stores a site password. It uses keys that can only post, which you can cancel at any time on the site. Keep your site passwords in a free password manager, for example Bitwarden (https://bitwarden.com, free plan). Never email, paste or commit a password or key anywhere else, including the project chat.

**Switches:** admin > Settings and switches > **Marketing** has "Post approved ads automatically" and "Email the ads to post by hand". Each ad's **Posting day** can be changed in admin > Marketing > Edit.

**To check your keys at any time:** https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml > **Run workflow** > mode `check`. It posts nothing and lists each site as connected, not set up, or not working.

Do these before **Tuesday, November 3** (the first automatic post is Bluesky that day). Any you skip simply arrive here as by-hand posts.

## 1. Bluesky (automatic posts)

**Why:** Lets the marketing autopilot post approved Bluesky ads on their day. Without it, the Bluesky ad is emailed to you to post by hand.

**Cost:** Free. An app password can only post; it cannot change the account password or settings.

| Name | Where | Notes |
| --- | --- | --- |
| `BLUESKY_HANDLE` | GitHub repository secret | The game account's handle, for example thelogicgrid.bsky.social. |
| `BLUESKY_APP_PASSWORD` | GitHub repository secret | An app password, never the account password. |

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

| Name | Where | Notes |
| --- | --- | --- |
| `MASTODON_URL` | GitHub repository variable | The server the account is on, for example https://mastodon.social. |
| `MASTODON_TOKEN` | GitHub repository secret | An access token that can only post. |

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

| Name | Where | Notes |
| --- | --- | --- |
| `X_API_KEY` | GitHub repository secret | API Key (consumer key). |
| `X_API_SECRET` | GitHub repository secret | API Key Secret. |
| `X_ACCESS_TOKEN` | GitHub repository secret | Access Token for the game's X account, made after setting Read and write. |
| `X_ACCESS_SECRET` | GitHub repository secret | Access Token Secret. |

**Steps:**

1. Signed in as the game's X account, open <https://developer.x.com/en/portal/dashboard> and sign up for the **Free** plan. Describe the use as: posting the game's own scheduled announcements.
2. Open your app > **User authentication settings** > **Set up**. App permissions: **Read and write**. Type: **Web App, Automated App or Bot**. Callback URI and website: `https://thelogicgrid.com`. Save.
3. Open **Keys and tokens**. Regenerate the **API Key and Secret** and copy both. Then generate the **Access Token and Secret** (after setting Read and write) and copy both.
4. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `X_API_KEY`).
5. Name: `X_API_KEY`. Secret: the API Key. Click **Add secret**.
6. Add `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_SECRET` the same way.
7. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [X developer portal](https://developer.x.com/en/portal/dashboard) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 4. Facebook Page and Instagram (automatic posts)

**Why:** Lets the marketing autopilot post approved ads to the game's Facebook Page and Instagram (pictures and Reels) on their day. Posts in Facebook groups are always by hand: Facebook no longer lets apps post in groups.

**Cost:** Free. The app stays in development mode, which is enough to post to Pages and accounts you manage.

| Name | Where | Notes |
| --- | --- | --- |
| `META_PAGE_ID` | GitHub repository secret | The Facebook Page's id (a number). |
| `META_PAGE_TOKEN` | GitHub repository secret | A Page access token made from a long-lived user token, so it does not expire. Also used for Instagram. |
| `INSTAGRAM_ACCOUNT_ID` | GitHub repository secret | The Instagram business account id linked to the Page (a number). |

**Steps:**

1. In the Instagram app, make the game's account a free **Business** or **Creator** account (**Settings** > **Account type and tools**). Link it to the game's Facebook Page (Page **Settings** > **Linked accounts** > **Instagram**).
2. Open <https://developers.facebook.com/apps>, click **Create app**, choose **Other**, then type **Business**. Name it `Logic Grid autopilot`.
3. Open <https://developers.facebook.com/tools/explorer>, choose that app, and click **Generate Access Token** with these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Allow it for the game's Page and Instagram account.
4. Open <https://developers.facebook.com/tools/debug/accesstoken>, paste that token, click **Debug**, then **Extend Access Token** and copy the long-lived token.
5. Back in the Explorer, paste the long-lived token and run `me/accounts`. Copy the game Page's `access_token` and `id`.
6. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `META_PAGE_TOKEN`).
7. Name: `META_PAGE_TOKEN`. Secret: the Page access_token. Click **Add secret**.
8. Add `META_PAGE_ID` the same way: the Page `id`.
9. In the Explorer, run `<page id>?fields=instagram_business_account` and add its `id` as the secret `INSTAGRAM_ACCOUNT_ID`.
10. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`. Facebook Page and Instagram should say connected.

**Links:** [Meta apps](https://developers.facebook.com/apps) · [Graph API Explorer](https://developers.facebook.com/tools/explorer) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

## 5. Threads (automatic posts)

**Why:** Lets the marketing autopilot post approved Threads ads on their day.

**Cost:** Free. The token lasts 60 days; make a new one when the check says it stopped working.

| Name | Where | Notes |
| --- | --- | --- |
| `THREADS_USER_ID` | GitHub repository secret | The Threads account id (a number). |
| `THREADS_TOKEN` | GitHub repository secret | A long-lived Threads token (60 days). |

**Steps:**

1. Open <https://developers.facebook.com/apps>, click **Create app**, and choose the use case **Access the Threads API**. Name it `Logic Grid Threads`.
2. In the app, open **App roles** > **Roles** > **Add people** > **Threads testers** and add the game's Threads account. Accept the invite in Threads (**Settings** > **Account** > **Website permissions** > **Invites**).
3. Open **Use cases** > **Access the Threads API** > **Settings**. Tick `threads_basic` and `threads_content_publish`, then use **User Token Generator** to make a token for the game account and copy it.
4. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `THREADS_TOKEN`).
5. Name: `THREADS_TOKEN`. Secret: that token. Click **Add secret**.
6. Open `https://graph.threads.net/v1.0/me?fields=id&access_token=` followed by the token in your browser, and add the `id` it shows as the secret `THREADS_USER_ID`.
7. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [Threads API](https://developers.facebook.com/docs/threads) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)
