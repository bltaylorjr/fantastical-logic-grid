# Everything waiting on you, most important first (26 Oct 2026)

This is every open task that needs your answer or your hands. Each one was checked against the project on 26 October 2026 at about 2 pm Eastern. They're in order of priority, so number 1 matters most. If you've already done something, skip it.

Project link (all the threads named below are here): https://claude.ai/code/project/chan_01FS7FCXupo9pecEJ7JKeby1

Nothing here costs money unless it says **COSTS MONEY**.

**At a glance:**

1. Pick how the game makes money (decision)
2. Approve the launch ads (decision, the calendar starts 2 November)
3. Approve the Supporter plan wording (decision)
4. Security settings only you can turn on (15 minutes)
5. Make sure you can always sign in to the admin dashboard (10 minutes)
6. Make the source private, part 1 (30 minutes)
7. Turn on the weekly archive (2 minutes)
8. Tell Google the video errors are fixed (2 minutes)
9. Send player emails from noreply@thelogicgrid.com (20 minutes)
10. List the game on itch.io and in the Microsoft Store (40 minutes)
11. Mobile apps: resume or keep paused? (decision)
12. Check Dependabot alerts (10 minutes)
13. Optional: talk to an intellectual-property attorney
14. Optional: dashboard extras and the red check on pull requests

## 1. Pick how the game makes money (decision)

**Why first:** three money options are built and tested, and they're held until you choose. The supporter plan, the in-game "please support" messages and the launch all wait on this choice.

**Steps:**

1. Read the options: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/launch/FREEMIUM.md
   - **Option 1, tip jar with a Supporter badge** (PR #88): https://github.com/bltaylorjr/fantastical-logic-grid/pull/88. This is the recommended start, and options 2 and 3 are built on top of it.
   - **Option 2, Ko-fi monthly membership** (PR #89): https://github.com/bltaylorjr/fantastical-logic-grid/pull/89
   - **Option 3, Lemon Squeezy one-time unlock**, for example $4.99 (PR #90): https://github.com/bltaylorjr/fantastical-logic-grid/pull/90
   - **Option 4, everything free for now.** Nothing gets merged.
2. All three options show Bronze, Silver, Gold and Platinum supporter badges on the scoreboard, as you asked.
3. In the thread **"Prepare freemium launch package"**, reply with what you want, for example "merge 1" or "merge 1 and 2".
4. Payment services keep a fee from each payment. Nothing is signed up for until you pick. The go-live steps for your pick come in their own email.

## 2. Approve the launch ads (decision)

**Why:** about two dozen ready-to-post ads are waiting as drafts in the admin dashboard. The posting calendar starts on Monday, 2 November, and nothing is posted without your OK.

**Steps:**

1. Open https://flg-api.btay74.workers.dev/admin/ and sign in.
2. Go to **Marketing > Launch on free channels**.
3. Open each ad and read it. To change anything, use **Edit**.
4. For each ad you're happy with, choose **Edit**, set **Status** to **Approved to post**, and save. You can also reply in the thread **"Launch free online marketing campaign"** with the ones you approve.
5. Post the approved ads from the game's own accounts. The account sign-ups are in the earlier email "Set up the free accounts for the launch campaign": https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-marketing-accounts.md

## 3. Approve the Supporter plan wording (decision)

**Why:** the plan says how and when the game asks players for support: at most once a week, never during play, and never pay-to-win.

**Steps:**

1. Open the plan: https://claude.ai/artifact/PRLPPGFNMyjYZJioP89qxx
2. Edit it directly, or leave comments on anything you want changed.
3. In the thread **"Launch free online marketing campaign"**, reply "supporter wording approved", or say what to change.

## 4. Security settings only you can turn on (about 15 minutes, free)

**Why:** you haven't had this list before. Each step closes a common way that accounts or a domain get misused.

**Steps:**

1. **Firebase:** open https://console.firebase.google.com, pick the project **the-fantastical-logic-grid**, and go to **Authentication > Settings**.
   1. Turn on **Email enumeration protection**.
   2. Under **Password policy**, choose **Require enforcement** and set the minimum length to **8**.
   3. Under **Authorized domains**, keep only these: `thelogicgrid.com`, `www.thelogicgrid.com`, `bltaylorjr.github.io`, `localhost`, and the `the-fantastical-logic-grid.firebaseapp.com` and `.web.app` entries. If the game is on itch.io, also keep `html-classic.itch.zone` and `html.itch.zone`.
2. **Google Cloud:** open https://console.cloud.google.com, pick the same project, and go to **APIs & Services > Credentials**.
   1. Open the **Browser key**. Under **API restrictions**, choose **Restrict key**, tick **Identity Toolkit API** and **Token Service API**, and click **Save**.
   2. Open the backup-voice key and restrict it to **Cloud Text-to-Speech API**.
   3. Go to **Billing > Budgets & alerts** and add a **$1** budget with email alerts. It costs nothing, and it warns you if anything ever starts to charge.
3. **Cloudflare:** open https://dash.cloudflare.com.
   1. Go to **flg-api > Settings > Variables and Secrets**. If `ADMIN_TOKEN` is shorter than 32 characters, replace it with a long random one. Put the same value in the GitHub secret `FLG_ADMIN_TOKEN`.
   2. Check that the token in `CF_API_TOKEN` has only **Account Analytics: Read**.
4. **Your domain registrar** (wherever you bought thelogicgrid.com):
   1. Turn on **Registrar lock**.
   2. Turn on **DNSSEC** if it's free.
   3. Add a **CAA** record for `thelogicgrid.com` with flag `0`, tag `issue` and value `letsencrypt.org`.
5. **GitHub:** open https://github.com/bltaylorjr/fantastical-logic-grid/settings/pages and make sure **Enforce HTTPS** is ticked. A few more GitHub settings come with the security update that's still in progress. They'll be emailed when it's live.

## 5. Make sure you can always sign in to the admin dashboard (about 10 minutes)

**Why:** a wrong Firebase key or owner email could lock you out of the dashboard the next time those settings are read. Full steps are in tasks 4 and 5 of the first setup email: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-outstanding-setup-tasks.md

**Steps:**

1. In Cloudflare, go to **flg-api > Settings > Variables and Secrets**. The secret `FIREBASE_WEB_API_KEY` should start with `AIza`, not `AQ.`. If it doesn't, copy the **Web API key** from Firebase **Project settings > General**, paste it in, and click **Deploy**.
2. In the game, create an account with fantasticallogicgrid@gmail.com under **Menu > Account and sync**, and confirm it from the email.
3. In the same Cloudflare page, set the secret `OWNER_EMAIL` to `fantasticallogicgrid@gmail.com` and click **Deploy**.
4. Sign in at https://flg-api.btay74.workers.dev/admin/ with that account to check that it works.

## 6. Make the source private, part 1 (about 30 minutes)

**Why:** you chose to make the code private, with a public site-only repository and a free Oracle build server. Nothing goes private until you've done these steps and the switch has been tested with you.

**Steps:**

1. Follow the 5 steps in the "Make the source private, part 1" email: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-private-source-part-1.md
2. Do its steps 3 and 4 within the same hour, because the runner code expires after one hour.
3. Oracle's Always Free tier is free, but Oracle asks for a card to check who you are.
4. When you've finished, reply "part 1 done" in the thread **"Protect the game from copying"**.

## 7. Turn on the weekly archive (2 minutes)

**Why:** you already OK'd the removal list. The switches are still yours to flip.

**Steps:**

1. Open https://flg-api.btay74.workers.dev/admin/ and go to **Settings and switches > Backups**.
2. Turn on **Weekly archive email** and save.
3. Turn on **Remove archived rows after the email is sent** and save.

## 8. Tell Google the video errors are fixed (2 minutes)

**Why:** the home page's video details are fixed now. Clicking **Validate fix** asks Google to check again sooner.

**Steps:**

1. Open https://search.google.com/search-console and pick **thelogicgrid.com**.
2. Go to **Enhancements > Videos** and click the first issue.
3. Click **Validate fix**. Do the same for any other issue that still shows the button.

Full steps: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-validate-video-fix.md

## 9. Send player emails from noreply@thelogicgrid.com (about 20 minutes)

**Why:** until this is done, player emails come from the game's Gmail, so nothing is lost in the meantime. Resend's free plan needs no card.

**Steps:**

1. Sign up at https://resend.com with fantasticallogicgrid@gmail.com.
2. Go to **Domains > Add domain** and enter `thelogicgrid.com`.
3. Copy the 3 or 4 DNS records that Resend shows into the DNS settings at your domain host. Then click **Verify DNS records** and wait until it says **Verified**.
4. Go to **API Keys > Create API key**, choose **Sending access**, and copy the key.
5. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions and add a new secret named `RESEND_API_KEY`, with the key as its value.

Full steps (task 2): https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-outstanding-setup-tasks.md

## 10. List the game on itch.io and in the Microsoft Store (about 40 minutes, free)

**Why:** these are two more free places where players can find the game. Each one needs its free account from the marketing-accounts email first.

**Steps:**

1. itch.io (10 minutes): https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-itch-io-upload.md
2. Microsoft Store (30 minutes): https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-microsoft-store.md
3. When either one is live, reply in the project chat with its link.

## 11. Mobile apps: resume or keep paused? (decision)

**Why:** the Android and iPhone apps have been paused since 25 October. Later that day you said "continue all builds", but it wasn't clear whether that included mobile, so they're still paused. Phone players can use the website, or add it to their home screen.

**Steps:**

1. Reply in the project chat with "resume mobile" or "keep mobile paused".
2. Store accounts **COST MONEY**. Google Play is $25 once. Apple is $99 a year and needs a Mac. Nothing gets bought without your OK.

## 12. Check Dependabot alerts (10 minutes, free)

**Steps:**

1. Look through the open alerts at https://github.com/bltaylorjr/fantastical-logic-grid/security/dependabot. If an alert needs a major update and has no pull request, say so in the project chat.
2. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/security_analysis and turn on **Secret scanning**, **Push protection** and **Private vulnerability reporting** if any of them are off.

Full steps (task 6): https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-outstanding-setup-tasks.md

## 13. Optional: talk to an intellectual-property attorney

**Why:** the design reports in `Downloads\Projects\Design reports` recommend a short talk with an IP attorney. The reports are a factual record, not legal advice. The game has been public since about 25 October. In the US, you have one year from the first public showing to file for a patent.

**Steps:**

1. For a free or low-cost first consultation, search for "<your state> bar lawyer referral", or use the USPTO's free help: https://www.uspto.gov/patents/basics/using-legal-services/pro-bono
2. Bring the three PDFs from `Downloads\Projects\Design reports`.
3. Registrations are optional and **COST MONEY**: about $45 to $65 for a copyright, and about $350 per class for a trademark. Details: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-copy-protection.md

## 14. Optional: dashboard extras and the red check on pull requests

All three are in tasks 7, 8 and 9 of the first setup email: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-26-outstanding-setup-tasks.md

1. Show Google and Bing search numbers in the dashboard (task 7).
2. Show Cloudflare usage and get a warning near the free limits (task 8).
3. Stop the red "Workers Builds: flg-api" check that still fails on every pull request (task 9).

---

Reply in the project chat with any questions, or with "done" and the item number, and whatever comes next for that item will be picked up.
