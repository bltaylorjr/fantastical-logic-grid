# Security

The Fantastical Logic Grid is a free puzzle game at https://thelogicgrid.com,
with a Windows app, optional player accounts and an admin dashboard. We take
the safety of players and their saves seriously.

## Reporting a problem

Please report security problems privately, not in a public issue:

- **Preferred:** [open a private security advisory](https://github.com/bltaylorjr/fantastical-logic-grid/security/advisories/new) on GitHub.
- Or email **fantasticallogicgrid@gmail.com** with "Security" in the subject.

Tell us what you found, how to see it happen, and what it could let someone
do. We will reply within 3 days, keep you told about the fix, and credit you
when it ships unless you would rather stay anonymous. Please give us a fair
chance to fix the problem before you tell anyone else, and do not access,
change or delete other players' data while testing.

`https://thelogicgrid.com/.well-known/security.txt` lists the same contacts.

## What is covered

- The website and game (`web/`, `scripts/`, `hosting/`)
- The Cloudflare Worker API and the admin dashboard (`server/`, `admin/`)
- The Windows desktop app (`desktop/`) and its update channel
- The build and release workflows (`.github/`)

Out of scope: denial of service by sheer traffic, reports from automated
scanners with no working example, and problems in Firebase, Cloudflare or
GitHub themselves (please report those to them).

## How the game protects players

- Playing never needs an account. Accounts use Firebase sign-in; the game
  never sees passwords, and the Worker checks every sign-in token's
  signature, project, expiry and issue time.
- Secrets live only in Cloudflare and GitHub secret stores, never in this
  repository or the apps.
- Every page carries a strict Content Security Policy; the API and admin
  dashboard send HSTS, anti-framing and no-sniff headers; every API route has
  rate limits and size limits; admins need a confirmed email, are signed out
  after 30 idle minutes and must sign in again every 12 hours, and every admin
  action is written to an audit log.
- Each change runs the full test suite before it can merge, and Dependabot
  keeps libraries patched.
