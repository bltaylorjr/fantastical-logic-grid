# Security settings only you can turn on

These go with the security work in the code (strict page policy, server
security headers, size limits, leaked-password check, CodeQL, dependency
review and Scorecard). Everything here is free. Each step takes a minute or
two. They are in order of how much they help.

## 1. Firebase: stop sign-up abuse (most important)

In the Firebase console, open project **the-fantastical-logic-grid**, then
**Authentication > Settings**:

1. **User actions** (some consoles call it User account management) **> Email enumeration protection**: turn it **on**.
   Then nobody can use the sign-in form to find out which emails have accounts.
2. **Password policy**: choose **Require enforcement**, set the minimum length
   to **8** and leave the other boxes unticked. This matches what the game asks for.
3. **Authorized domains**: keep only `thelogicgrid.com`, `www.thelogicgrid.com`,
   `bltaylorjr.github.io`, `localhost` and the
   `the-fantastical-logic-grid.firebaseapp.com` / `.web.app` entries. Delete any others.

## 2. Google Cloud: lock the API keys to what they are for

At console.cloud.google.com, choose the same project, then
**APIs & Services > Credentials**:

1. Open the **Browser key** (the one in FLG_FIREBASE_API_KEY). Under
   **API restrictions** choose **Restrict key**, tick **Identity Toolkit API**
   and **Token Service API**, then **Save**. Leave **Application
   restrictions** at **None**, because the desktop app needs that.
2. If you made a key for the backup voices (GOOGLE_TTS_KEY), open it and
   restrict it to **Cloud Text-to-Speech API** only.
3. **Billing > Budgets & alerts**: add a budget of **$1** with email alerts.
   It costs nothing and warns you if anything ever starts to charge.

## 3. GitHub: let the new scanners report

On github.com/bltaylorjr/fantastical-logic-grid, open **Settings**:

1. **Code security > Code scanning**: if **Default setup** is on, switch it
   **off**. The repository now has its own CodeQL workflow, and the two
   cannot run together.
2. **Actions > General > Workflow permissions**: choose **Read repository
   contents and packages permissions**. Keep **Allow GitHub Actions to create
   and approve pull requests** ticked, because the how-to-play video needs it.
   Each workflow already asks for the extra rights it needs.
3. **Pages**: make sure **Enforce HTTPS** is ticked.
4. Optional, if you added the main ruleset: under **Require status checks
   to pass**, add **app**, **server**, **Analyze (javascript-typescript)** and
   **review**. Do not add "Workers Builds: flg-api".

## 4. Cloudflare: tighten the keys

At dash.cloudflare.com:

1. **Workers & Pages > flg-api > Settings > Variables and Secrets**: if
   **ADMIN_TOKEN** is shorter than 32 characters, replace it with a long
   random one (for example from a password manager's generator). Put the same
   value in the GitHub repository secret **FLG_ADMIN_TOKEN**.
2. **My Profile > API Tokens**: the token in **CF_API_TOKEN** should have only
   **Account Analytics: Read**. If it has more, make a new one with just that,
   swap it in, and delete the old one.

## 5. Your domain registrar: protect thelogicgrid.com

At the company where you bought thelogicgrid.com:

1. Turn on **Registrar lock** (it may be called "transfer lock" or "domain lock").
2. Turn on **DNSSEC** if they offer it free.
3. Add a DNS record of type **CAA** for `thelogicgrid.com` with flag `0`,
   tag `issue` and value `letsencrypt.org`. Then only GitHub Pages' certificate
   company can issue certificates for your site.

You can skip anything your accounts don't show. Nothing in the game breaks if
a step isn't done.
