# Educator puzzle packages are live: one optional step (5 minutes)

**Why:** Teachers can now ask for free printable puzzle packages on https://thelogicgrid.com/educators/ (the "For educators" link in the top corner of the game). Their school email is confirmed with a code, then the request waits for you in the admin dashboard under **Educator requests**. When you click **Approve and send**, the puzzles are made and emailed as PDFs. This already works with the email setup you have. It checks for new work every 5 minutes. The optional step below makes the code emails and packages go out within about a minute instead. It's free.

**What you need to do day to day:** open the admin dashboard, click **Educator requests**, check the school and click **Approve and send** or **Decline**. Switches are under **Settings and switches > Educators**.

**Optional steps (faster emails):**

1. Open https://github.com/settings/personal-access-tokens/new (signed in as bltaylorjr).
2. Name it `flg educator emails`, set **Expiration** to 1 year.
3. Under **Repository access**, pick **Only select repositories** and choose **fantastical-logic-grid**.
4. Under **Permissions > Repository permissions**, set **Actions** to **Read and write**. Leave everything else as is.
5. Click **Generate token** and copy it (you only see it once).
6. Open https://dash.cloudflare.com, go to **Workers & Pages > flg-api > Settings > Variables and Secrets**, click **Add**, choose type **Secret**, name it `GITHUB_DISPATCH_TOKEN`, paste the token and click **Deploy**.
7. Check it: in the admin dashboard, **Connections and setup**, "Educator emails straight away" should show as set.

If you skip this, nothing breaks: emails just take up to 5 minutes. Reply to this email if anything looks wrong.
