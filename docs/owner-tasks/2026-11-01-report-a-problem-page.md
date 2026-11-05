# Report a Problem: check the instant puzzle doctor is switched on

Report a Problem now opens its own page, where players can attach up to 3
screenshots or files. The moment a report arrives, the puzzle doctor reviews
it, repairs a broken puzzle within a minute or two, logs every step in the new
errors database, and sends you an alert with the outcome. Details:
server/PUZZLE-REPORTS.md.

The instant start uses the same `GITHUB_DISPATCH_TOKEN` Worker secret as the
educator emails and the marketing poster. If you already added it, there is
nothing to do. To check, or to add it:

1. Open the admin dashboard, **Connections and setup**, and look for
   "Educator emails straight away". If it shows as set, you are done.
2. If not: open https://github.com/settings/personal-access-tokens/new (signed
   in as bltaylorjr). Name `flg-dispatch`, expiration 1 year, **Only select
   repositories** > `fantastical-logic-grid`, **Repository permissions** >
   **Actions** > **Read and write**. Click **Generate token** and copy it.
3. Open https://dash.cloudflare.com, go to **Workers & Pages > flg-api >
   Settings > Variables and Secrets**, click **Add** (or **Edit** next to
   `GITHUB_DISPATCH_TOKEN`), choose type **Secret**, paste the token and click
   **Deploy**.
4. Test: report a puzzle from the game. In the admin app, **Error tracking**,
   open the report: its Doctor's log should say "Doctor started", and a second
   alert should arrive within a couple of minutes with the doctor's verdict.

If you skip this, nothing breaks: reported puzzles are checked in the doctor's
15-minute round instead, and everything else works the same.

Your alerts: problem reports are sent as **Problem** alerts at once. To get
fewer, untick Problems in **Settings > My alerts** (you would then miss other
problems too).
