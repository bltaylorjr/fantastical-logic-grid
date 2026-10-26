# Outstanding setup tasks for The Fantastical Logic Grid (26 Oct 2026)

These are the things only you can do outside the code, checked against the project on 26 October 2026. They're in order of importance. Each one says what it's for and how to do it. If you've already done one, skip it. Mobile app tasks are left out while the apps are paused.

Everything here is free. Nothing in this list will be billed.

## 1. Let GitHub Actions open pull requests (needed for the how-to-play video)

**Why:** The workflow that re-records the how-to-play video after each game change can't open its pull request. Its last run failed with "GitHub Actions is not permitted to create or approve pull requests", so the video in the game is now behind the latest features.

**Steps:**

1. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions
2. Scroll down to **Workflow permissions**.
3. Tick **Allow GitHub Actions to create and approve pull requests**. Leave the rest as it is.
4. Click **Save**.
5. Open https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/video.yml, click **Run workflow**, then **Run workflow** again. In about 20 minutes it opens a video pull request, and that pull request merges itself once its checks pass.

## 2. Send player emails from noreply@thelogicgrid.com (DNS records and a Resend key)

**Why:** The thank-you emails for ideas and problem reports go out from the game's Gmail with "(no-reply)" in the name. With Resend's free plan they come from the real address noreply@thelogicgrid.com instead. The free plan gives 3,000 emails a month and 100 a day, and it needs no card. Until you do this, emails still go out from Gmail, so nothing is lost. These records don't touch the website or the domain's other email.

**Steps:**

1. Sign up at https://resend.com with fantasticallogicgrid@gmail.com.
2. Go to **Domains**, click **Add domain**, enter `thelogicgrid.com`, choose the US East region, and click **Add**.
3. Resend shows 3 or 4 DNS records: an **MX** and a **TXT** for `send`, a **TXT** for `resend._domainkey`, and an optional **TXT** for `_dmarc`. Keep that page open.
4. In another tab, sign in wherever you manage thelogicgrid.com's DNS. That's where you added the GitHub Pages records for the website. Open the DNS settings for thelogicgrid.com.
5. Add each record exactly as Resend shows it, with the same type, name, value and priority. Copy and paste the values. Some DNS hosts add `.thelogicgrid.com` to the name on their own. If yours does, enter only `send` or `resend._domainkey`.
6. Save. Back in Resend, click **Verify DNS records**. This can take a few minutes to a few hours. Wait until the domain shows **Verified**.
7. In Resend, go to **API Keys** and click **Create API key**. Name it `logic-grid`, choose **Sending access** and the domain `thelogicgrid.com`, then click **Add**. Copy the key, which starts with `re_`.
8. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions and click **New repository secret**. For the name, enter `RESEND_API_KEY`. Paste the key as the value and click **Add secret**.
9. To test, sign in to the game with an account whose email is confirmed. Open **Menu > Ideas and problems**, send an idea with "Email me a thank-you note" ticked, and check that account's inbox within about 15 minutes.

Full guide: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/FEEDBACK-EMAILS.md

## 3. Turn on the weekly archive email, then OK the removal list

**Why:** The test emails already work, since the last one reached this Gmail. The weekly email stays off until you switch it on. Removing old rows from the database stays off until you've read the list below and agree with it.

**Steps:**

1. Open https://flg-api.btay74.workers.dev/admin/ and sign in.
2. Go to **Settings and switches > Backups**.
3. Turn on **Weekly archive email** and save. From then on, a zip arrives here every Monday at about 05:07 UTC. While this switch is on, nothing is removed without a backup.
4. Read what would be removed after each email. Rows newer than these ages always stay.
   - Finished races, their players and challenges: older than 45 days. Points earned stay on the scoreboard.
   - Anonymous play summaries: older than 90 days.
   - Error reports from the apps: older than 30 days.
   - Daily voice clip counters: older than 60 days.
   - Rejected story parts: 90 days after review.
   - Ended announcements: 90 days after they end.
   - Admin audit log: older than 90 days.
   - Daily cleanup log: older than 90 days.
   - Never removed: accounts, saved games, screen names, scores, bans, admins, settings, approved or waiting story parts, and open races.
5. If you agree, turn on **Remove archived rows after the email is sent** on the same page and save. After that, each Monday's email is the only copy of those rows, so keep the emails.

Details: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/ARCHIVE.md

## 4. Check the Firebase key in Cloudflare (the "AQ." value)

**Why:** The Worker secret `FIREBASE_WEB_API_KEY` was saved with a value starting `AQ.`. A Firebase web API key starts with `AIza`. If it's wrong, signing in to the admin dashboard can fail after the secret is next read. Skip this if the admin dashboard signs you in with your game account (not the break-glass key).

**Steps:**

1. Open https://console.firebase.google.com and choose the project **the-fantastical-logic-grid**.
2. Click the gear next to **Project Overview**, then **Project settings > General**. Copy the **Web API key**, which starts with `AIza`.
3. Open https://dash.cloudflare.com, then **Workers & Pages > flg-api > Settings > Variables and Secrets**.
4. Find `FIREBASE_WEB_API_KEY`, click **Edit**, paste the `AIza...` key, keep the type as **Secret**, and click **Deploy**.
5. The GitHub variable `FLG_FIREBASE_API_KEY` should hold the same key. Check it at https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions (the website build already uses an `AIza` key).

## 5. Finish the email switch (from the "switch project emails" guide)

**Why:** Admin ownership and the game's contact details should use fantasticallogicgrid@gmail.com. Your Cloudflare, GitHub, Google and Bing logins stay on btay74@outlook.com. Skip any step you've already done.

**Steps:**

1. In the game (https://thelogicgrid.com), go to **Menu > Account and sync** and create an account with fantasticallogicgrid@gmail.com. Open the confirmation email and click the link.
2. In Cloudflare, go to **Workers & Pages > flg-api > Settings > Variables and Secrets**. Set `OWNER_EMAIL` (type **Secret**) to `fantasticallogicgrid@gmail.com` and click **Deploy**.
3. Sign in to https://flg-api.btay74.workers.dev/admin/ with that game account to check it works.
4. Optional: add fantasticallogicgrid@gmail.com as a user in these places.
   - **Firebase:** open https://console.firebase.google.com, then **Project settings > Users and permissions > Add member** (Editor).
   - **Google Search Console:** open https://search.google.com/search-console, then **Settings > Users and permissions > Add user**.
   - **Bing Webmaster Tools:** open https://www.bing.com/webmasters, then **Settings > User management > Add user**.
5. Optional: in Firebase, go to **Authentication > Templates**, edit each template, set **Reply to** to fantasticallogicgrid@gmail.com, and save.

Guide: https://claude.ai/artifact/4MEsyqiPS5MfXAtdnp4K3W

## 6. Turn on Dependabot alerts and GitHub's security settings

**Why:** Dependabot alerts warn you about known holes in the libraries the game uses, and security updates fix them on their own. The other settings stop leaked keys from being pushed and give people a private way to report problems. All of these are free for public repositories.

**Steps:**

1. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/security_analysis
2. Click **Enable** for each of these that's still off:
   - **Dependabot alerts**
   - **Dependabot security updates**
   - **Private vulnerability reporting**
   - **Secret scanning** and **Push protection**
3. Make sure two-factor sign-in is on for your GitHub, Cloudflare and Google (btay74@outlook.com) accounts, and for fantasticallogicgrid@gmail.com. For GitHub, check https://github.com/settings/security, for Cloudflare go to **My Profile > Authentication**, and for Google use https://myaccount.google.com/security
4. Optional: protect `main` from being deleted or force-pushed. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/rules, choose **New ruleset > New branch ruleset**, and name it `main`. Set **Enforcement** to **Active**, click **Add target > Include default branch**, keep **Restrict deletions** and **Block force pushes** ticked, and click **Create**. Don't tick "Require a pull request" or "Require approvals", because they would stop the automatic merges.

The security work still in progress may add a few more owner-only settings. They'll arrive in a separate email.

## 7. Optional: Google and Bing numbers in the admin dashboard

**Why:** This fills in the dashboard's **Search** section with clicks, views and search terms. It's free. First make sure the sitemap is submitted. If you've already done that, skip steps 1 and 2.

**Steps:**

1. **Google:** open https://search.google.com/search-console and pick `https://thelogicgrid.com/`. Go to **Sitemaps**, enter `sitemap.xml`, and click **Submit**.
2. **Bing:** open https://www.bing.com/webmasters, then **Sitemaps > Submit sitemap**, and enter `https://thelogicgrid.com/sitemap.xml`.
3. **Google key:** go to https://console.cloud.google.com.
   1. Create a project named `logic-grid-search` and select it.
   2. Search for **Google Search Console API** and click **Enable**.
   3. Go to **IAM & Admin > Service accounts > Create service account**, name it `search-reader`, and click **Done** (no roles needed).
   4. Open the account, go to **Keys > Add key > Create new key > JSON**, and click **Create**. Copy its `client_email`.
   5. In Search Console, open the property, then **Settings > Users and permissions > Add user**. Paste that email, choose **Restricted**, and click **Add**.
   6. Open the downloaded `.json` file in Notepad and copy all of it. In Cloudflare, go to **flg-api > Settings > Variables and Secrets > Add**, enter `GSC_SERVICE_ACCOUNT` as the name, choose type **Secret**, paste, and click **Deploy**. Then delete the downloaded file.
4. **Bing key:** on https://www.bing.com/webmasters, open **Settings (gear) > API access > API Key > Generate**. Add it in Cloudflare as the secret `BING_WEBMASTER_KEY`.
5. In the admin dashboard, open **Search** and click **Refresh now**.

Guide: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/admin/README.md (step 7)

## 8. Optional: Cloudflare usage numbers and free-limit alerts

**Why:** This lets the dashboard show Cloudflare requests, reads and writes against the free limits, and warn you at 80%. It's free.

**Steps:**

1. Open https://dash.cloudflare.com/profile/api-tokens and click **Create Token**. Under **Custom token**, click **Get started**.
2. Name it `logic-grid-usage`. Under permissions, choose **Account > Account Analytics > Read**. Click **Continue to summary**, then **Create Token**, and copy it.
3. In **Workers & Pages > flg-api > Settings > Variables and Secrets**, add the secret `CF_API_TOKEN` with that token.
4. Add a second secret, `CF_ACCOUNT_ID`, with your Account ID. It's shown on the right of the **Workers & Pages** overview page.
5. Click **Deploy**, then check the dashboard's **Overview**.

## 9. Optional: stop the failing "Workers Builds: flg-api" check on pull requests

**Why:** Cloudflare tries to build every pull request branch and fails straight away. It's harmless, because main deploys fine, but it shows a red X on every pull request.

**Steps:**

1. Open https://dash.cloudflare.com, then **Workers & Pages > flg-api > Settings > Build**.
2. Under **Branch control**, untick **Enable non-production branch builds** (or turn off **Builds for non-production branches**).
3. Click **Save**. Production builds from main carry on as before.

---

From now on, whenever a change needs you to do something like this, you'll get an email here. Questions about any step can go in the project chat.
