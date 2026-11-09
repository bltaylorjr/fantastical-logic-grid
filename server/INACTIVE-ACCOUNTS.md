# Automatic deletion of inactive accounts

Code: `src/inactive-accounts.js`, run by the nightly maintenance (2 am Eastern,
`src/nightly.js`). Warning emails: `.github/workflows/inactive-warning.yml` and
`scripts/inactive-warning.py`. Admin view: Grid Admin > Players > Inactive
account cleanup. Settings: Settings and switches > Inactive accounts.

## The rules

- **Inactive accounts.** No plays, syncs, changes or sign-ins for
  `inactive_delete_days` (30). A player with an email address is warned
  `inactive_warn_days` (7) before, and is never deleted sooner than that after
  the warning was sent. Signing in or playing resets the clock.
- **Accounts with no screen name.** Emailed a link to
  https://thelogicgrid.com/account/ (which suggests a name), and deleted
  `unnamed_grace_days` (3) after that email if they still have no name. With no
  email address, the days start the night the account is first found.
- **Never deleted:** Fan_Logic_Admin, CobaltSockMonkey18 (and CobaltSockMonkey),
  the owner and every admin (matched by email), and blocked players.
- Deleting removes the Firebase sign-in first, then all the account's data
  here (the same as the player's own Delete account). At most 50 a night.
  Each one is in the admin audit log as `auto-cleanup`, `players.auto_delete`.

## Turning it on

1. Firebase console > Project settings > Service accounts > Generate new
   private key. This downloads a JSON file.
2. Cloudflare dashboard > Workers > flg-api > Settings > Variables and
   Secrets > Add, type **Secret**, name `FIREBASE_SERVICE_ACCOUNT`, value: the
   whole JSON file. (Or `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT` in
   `server/` and paste it.)
3. Grid Admin > Players > Inactive account cleanup: check who would be
   warned and deleted.
4. Settings and switches > Inactive accounts > switch on **Delete inactive
   accounts automatically**.

The warning emails use the same GitHub secrets as the daily puzzle email
(`FLG_ADMIN_TOKEN`, and `RESEND_API_KEY` or `GMAIL_USER` +
`GMAIL_APP_PASSWORD`, see DAILY-EMAIL.md). If they are not set, players with
an email are never warned, so they are never deleted either.
