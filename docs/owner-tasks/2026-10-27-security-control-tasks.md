# Keep control of the game: lock your accounts and back up the keys

From the security and control review (2026-10-27). The code and servers are
well protected. What's left is in your hands: the accounts that own
everything, and the two keys that can never be replaced. Tasks 1 to 4 are
free and take about an hour in total. Full report:
https://claude.ai/artifact/Du1unPpMn7gz9uJPjjk8SD

## 1. Turn on two-step sign-in everywhere (free, about 30 minutes)

Why: one stolen password could hand someone your code, website, server or
domain. Use an authenticator app (Google Authenticator, Microsoft
Authenticator or similar) rather than text messages where offered. Save each
site's recovery codes on paper or in a password manager, not only on your PC.

1. Gmail (fantasticallogicgrid@gmail.com): https://myaccount.google.com/signinoptions/two-step-verification
2. Microsoft (btay74@outlook.com): https://account.live.com/proofs/manage/additional
3. GitHub (bltaylorjr): https://github.com/settings/security, then download
   the recovery codes.
4. Cloudflare: https://dash.cloudflare.com/profile/authentication
5. Google Cloud and Firebase use your Google account. Turn on two-step
   sign-in for whichever Google account owns the Firebase project.
6. Your domain registrar (where you bought thelogicgrid.com): its security
   or account settings page.

## 2. Lock the domain (free, 5 minutes)

Why: losing thelogicgrid.com means losing the site and its search ranking.

1. Sign in to your domain registrar and open thelogicgrid.com.
2. Turn on **Registrar lock** (it may be called Transfer lock or Domain lock).
3. Turn on **Auto-renew**, and check the card on file hasn't expired.

## 3. Back up the two signing keys offline (free, 10 minutes)

Why: if either key is lost, no installed copy of the game can ever be
updated again (Windows), and Google Play will refuse updates (Android).
Right now they exist only in the Claude project folder and GitHub secrets.

1. In the Claude project, open the folder
   `fantastical-logic-grid-app/.private/` and download these 4 files:
   `updater.key`, `android-release.p12`, `android-release.p12.base64`,
   `android-release.password`.
2. Put them on a USB drive (ideally an encrypted one, or inside a password
   manager's secure file storage), and keep it somewhere safe at home.
3. Don't email them or put them in a cloud folder that's shared with anyone.

## 4. Check who can reach your code (free, 5 minutes)

1. https://github.com/bltaylorjr/fantastical-logic-grid/settings/access:
   only you should be listed.
2. https://github.com/bltaylorjr/fantastical-logic-grid/settings/keys:
   remove any deploy key you don't recognize.
3. https://github.com/settings/installations: remove any app you don't use.
   Keep Claude, Cloudflare and Dependabot.
4. https://github.com/settings/tokens and https://github.com/settings/personal-access-tokens:
   delete tokens you don't use.

## 5. Optional, COSTS MONEY

None of these will be done for you. The details and links are in the
"Protect the game from copying" email from 2026-10-26.

- Register the copyright (about $45 to $65). When you apply, disclose which
  parts were written by AI. Your Design Contribution and Authorship Record
  (Claude project, folder `ip-reports`) describes your own part.
- Register the trademark "The Fantastical Logic Grid" (about $350 per class).
  You can already use the ™ mark, and the website now does.
- Code-sign the Windows installer (about $10 a month with Microsoft's Trusted
  Signing, or about $200 or more a year for a certificate). Until then, each
  release lists SHA-256 checksums.
- A one-hour consult with an intellectual-property lawyer before selling the
  game or taking payments.

## 6. When you're ready

Making the source code private is paused at your request. When you want
it, say "resume private repo" in the project thread, and use the "Make the
source private, part 1" email from 2026-10-26.
