# Connections and setup

<!-- Made by `node scripts/connections.mjs md` from admin/connections.js. Do not edit by hand. -->

Every outside service the game uses, why it is needed, the exact names and settings
(never secret values), steps and links. The same guide, with live Connected and
Missing status, is in the admin dashboard under **Connections and setup**
(https://flg-api.btay74.workers.dev/admin/#connections).

To change it, edit `admin/connections.js`, then run
`node scripts/connections.mjs md > docs/CONNECTIONS.md`. The Tests workflow fails if code
uses a secret, variable or binding that is not listed there.

| Where | How to set it |
| --- | --- |
| Cloudflare Worker secret | Cloudflare > Workers & Pages > flg-api > Settings > Variables and Secrets (type Secret) (<https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings>) |
| Worker variable (server/wrangler.toml [vars]) | server/wrangler.toml, under [vars]. Change it in the file, not the dashboard: a deploy resets dashboard values. (<https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/wrangler.toml>) |
| Worker binding (server/wrangler.toml) | server/wrangler.toml. Nothing to type in the dashboard. (<https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/wrangler.toml>) |
| GitHub repository secret | GitHub > Settings > Secrets and variables > Actions > Secrets (<https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions>) |
| GitHub repository variable | GitHub > Settings > Secrets and variables > Actions > Variables (<https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions>) |
| Private file (never in the repository) | The project files folder .private/, and your own safe backup |

## Website and domain

### Domain and DNS (thelogicgrid.com)

**Why:** Points thelogicgrid.com and www at the GitHub Pages website. The same DNS settings hold the records for Resend (player emails) and, if you use it, Google's TXT verification. The domain stays off Cloudflare.

**Cost:** The domain renewal is paid at your registrar (yearly). DNS records themselves are free.

**Settings:**

- A records for @: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- AAAA records for @: 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153
- CNAME for www: bltaylorjr.github.io

**Steps:**

1. Sign in at your domain registrar (where you bought thelogicgrid.com) and open the **DNS settings** for thelogicgrid.com.
2. Delete any parking-page `A`, `AAAA` or `CNAME` records for `@` and `www`.
3. Add the four `A` records, the four `AAAA` records and the `www` `CNAME` listed under Settings above.
4. Optional, protects the domain from takeover: open <https://github.com/settings/pages>, click **Add a domain**, enter `thelogicgrid.com`, and add the `TXT` record GitHub shows at the registrar. Then click **Verify**.
5. DNS changes take a few minutes to a day. The status here turns Connected when the records are seen.

**Links:** [GitHub Pages domain verification](https://github.com/settings/pages) · [DNS guide (hosting/DEPLOY.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/hosting/DEPLOY.md) · [Full guide (hosting/DEPLOY.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/hosting/DEPLOY.md)

### GitHub Pages (the website)

**Why:** Hosts the game at <https://thelogicgrid.com>. The "Publish web version" workflow builds and publishes it on every push to main and every night at 00:17 UTC (the daily puzzle page). Once the source goes private (see "Private source"), Pages is served from the public repo bltaylorjr/thelogicgrid instead, so the Pages checks here become optional.

**Cost:** Free for public repositories.

| Name | Where | Notes |
| --- | --- | --- |
| `FLG_SITE_URL` | GitHub repository variable | Only if the site ever moves from https://thelogicgrid.com. Optional. |

**Settings:**

- Settings > Pages > Source: GitHub Actions
- Settings > Pages > Custom domain: thelogicgrid.com
- Settings > Pages > Enforce HTTPS: On

**Steps:**

1. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/pages>.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Under **Custom domain**, enter `thelogicgrid.com` and click **Save**. Wait for the DNS check to pass.
4. Tick **Enforce HTTPS** once GitHub has issued the certificate (it is greyed out until then).
5. To publish now, open <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/pages.yml> and click **Run workflow**.

**Links:** [Pages settings](https://github.com/bltaylorjr/fantastical-logic-grid/settings/pages) · [Publish web version workflow](https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/pages.yml) · [Full guide (hosting/DEPLOY.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/hosting/DEPLOY.md)

### Extra web hosts (optional)

**Why:** Each push to main can also copy the website to other hosts. A host is skipped unless its secrets are set. None are needed: GitHub Pages already serves the site.

**Cost:** Free tiers exist for Netlify and Cloudflare Pages. Your own FTP or SSH hosting may cost money; check before adding it.

| Name | Where | Notes |
| --- | --- | --- |
| `NETLIFY_AUTH_TOKEN` | GitHub repository secret | Netlify: User settings > Applications > Personal access tokens. Optional. |
| `NETLIFY_SITE_ID` | GitHub repository secret | Netlify: Site configuration > Site ID. Optional. |
| `CLOUDFLARE_API_TOKEN` | GitHub repository secret | Cloudflare Pages (template "Edit Cloudflare Workers", or Cloudflare Pages: Edit). Optional. |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secret | Cloudflare Pages: the account ID on the dashboard sidebar. Optional. |
| `CLOUDFLARE_PROJECT` | GitHub repository secret | Cloudflare Pages project name. Optional. |
| `FTP_SERVER` | GitHub repository secret | FTP or FTPS host, e.g. ftps://host. Optional. |
| `FTP_USERNAME` | GitHub repository secret | Optional. |
| `FTP_PASSWORD` | GitHub repository secret | Optional. |
| `FTP_DIR` | GitHub repository secret | For example /public_html/. Optional. |
| `SSH_HOST` | GitHub repository secret | Optional. |
| `SSH_PORT` | GitHub repository secret | Optional. |
| `SSH_USER` | GitHub repository secret | Optional. |
| `SSH_PRIVATE_KEY` | GitHub repository secret | A key made only for deploying (ssh-keygen -t ed25519). Optional. |
| `SSH_PATH` | GitHub repository secret | For example /var/www/logic-grid. Optional. |
| `DEPLOY_HOOK_URL` | GitHub repository secret | A host's deploy or build hook (Vercel, Render, Netlify build hooks). Optional. |

**Steps:**

1. Pick the host you want and find its values (see each name's note).
2. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `<NAME>`).
3. Name: `<NAME>`. Secret: the value for that name. Click **Add secret**.
4. The next push to main (or <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/pages.yml> > **Run workflow**) also deploys there.

**Links:** [Hosts table (hosting/DEPLOY.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/hosting/DEPLOY.md#updating) · [Netlify tokens](https://app.netlify.com/user/applications#personal-access-tokens) · [Full guide (hosting/DEPLOY.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/hosting/DEPLOY.md)

## GitHub

### GitHub Actions settings

**Why:** Actions run the tests, publish the website, send the emails and make the how-to-play video. The video and Dependabot workflows open and merge their own pull requests, which needs this permission.

**Cost:** Free for public repositories.

**Settings:**

- Settings > Actions > General > Workflow permissions: Allow GitHub Actions to create and approve pull requests: ticked (done 26 Oct 2026)

**Steps:**

1. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions>.
2. Scroll to **Workflow permissions** and tick **Allow GitHub Actions to create and approve pull requests**. Click **Save**.
3. GitHub pauses scheduled workflows after 60 days without commits. If the health check or nightly publish stops, open the **Actions** tab and re-enable the workflow.

**Links:** [Actions settings](https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions) · [All workflows](https://github.com/bltaylorjr/fantastical-logic-grid/actions) · [Full guide (MAINTENANCE.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/MAINTENANCE.md)

### Private source: build server and public site repo

**Why:** Keeps the source code private while players still get the website and desktop updates from a public, built-files-only repo (bltaylorjr/thelogicgrid). Builds run on a free Oracle Cloud server, because private repos get only 2,000 free Actions minutes a month. Everything stays off until these variables are set, and removing them goes back to the old way.

**Cost:** Free: Oracle Cloud Always Free VM, a public GitHub repo and a fine-grained token. Oracle may reclaim a VM that stays idle for 7 days.

| Name | Where | Notes |
| --- | --- | --- |
| `FLG_RUNNER` | GitHub repository variable | Value: `["self-hosted","flg"]` Runs Linux jobs on the Oracle build server. Optional. |
| `FLG_SITE_REPO` | GitHub repository variable | Value: `bltaylorjr/thelogicgrid` Publishes the site and mirrors releases to the public repo. Optional. |
| `SITE_REPO_TOKEN` | GitHub repository secret | Fine-grained token with Contents: read and write on bltaylorjr/thelogicgrid only. Optional. |

**Steps:**

1. Create the public repository `bltaylorjr/thelogicgrid` at <https://github.com/new> (Public, no files).
2. Create a token at <https://github.com/settings/personal-access-tokens/new:> **Only select repositories** > `bltaylorjr/thelogicgrid`, **Contents: Read and write**. Copy it.
3. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `SITE_REPO_TOKEN`).
4. Name: `SITE_REPO_TOKEN`. Secret: the token. Click **Add secret**.
5. Set up the Oracle Cloud Always Free VM with `scripts/runner/oracle-cloud-init.sh` (steps in docs/PRIVATE-REPO.md).
6. Add the variable `FLG_RUNNER` = `["self-hosted","flg"]` at <https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions> and watch a few runs pass.
7. Add the variable `FLG_SITE_REPO` = `bltaylorjr/thelogicgrid`, run **Publish web version** and **Release desktop app**, then move the Pages custom domain to the public repo.
8. Only after a desktop release with the new update address has shipped: **Settings** > **General** > **Danger Zone** > **Change visibility** > **Private**.

**Links:** [GitHub variables](https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions) · [Fine-grained tokens](https://github.com/settings/personal-access-tokens) · [Full guide (docs/PRIVATE-REPO.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/PRIVATE-REPO.md)

### Dependabot and GitHub security

**Why:** Dependabot opens a tested pull request when a library has an update (patch and minor updates merge themselves). Secret scanning and push protection stop a key from being pushed by mistake.

**Cost:** Free for public repositories.

**Settings:**

- Dependabot alerts: Enabled
- Dependabot security updates: Enabled
- Private vulnerability reporting: Enabled
- Secret scanning and Push protection: Enabled
- Branch ruleset "main" (optional): Restrict deletions + Block force pushes. Do not require pull requests or approvals (that stops automatic merges).

**Steps:**

1. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/security_analysis> and click **Enable** for each item under Settings above that is still off.
2. Look through open alerts at <https://github.com/bltaylorjr/fantastical-logic-grid/security/dependabot>. Most have a Dependabot pull request already. A major update waits for a person: tell the project chat.
3. Optional: <https://github.com/bltaylorjr/fantastical-logic-grid/settings/rules> > **New ruleset** > **New branch ruleset**, name `main`, Enforcement **Active**, **Add target** > **Include default branch**, keep **Restrict deletions** and **Block force pushes**, click **Create**.
4. Turn on two-factor sign-in for GitHub (<https://github.com/settings/security>), Cloudflare (My Profile > Authentication) and Google (<https://myaccount.google.com/security>), for btay74@outlook.com and fantasticallogicgrid@gmail.com.

**Links:** [Security settings](https://github.com/bltaylorjr/fantastical-logic-grid/settings/security_analysis) · [Dependabot alerts](https://github.com/bltaylorjr/fantastical-logic-grid/security/dependabot) · [Rulesets](https://github.com/bltaylorjr/fantastical-logic-grid/settings/rules) · [Full guide (MAINTENANCE.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/MAINTENANCE.md)

### Break-glass key and the Actions admin key

**Why:** ADMIN_TOKEN opens the admin dashboard with the owner's rights when sign-in is down. GitHub Actions use the same value, as FLG_ADMIN_TOKEN, to fetch the error digest and free-limit alerts, send the weekly archive and summary emails, and report this page's GitHub status.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `ADMIN_TOKEN` | Cloudflare Worker secret | A long random password, 16 characters or more. Keep it to yourself. |
| `FLG_ADMIN_TOKEN` | GitHub repository secret | Exactly the same value as ADMIN_TOKEN. |
| `ARCHIVE_KEY` | Cloudflare Worker secret | Optional key for the coded player ids in archive zips. Without it ADMIN_TOKEN is used, so changing ADMIN_TOKEN changes the codes. Optional. |

**Steps:**

1. Make a long random password (for example from a password manager, 32 characters).
2. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
3. Click **Add** (or **Edit** next to `ADMIN_TOKEN` if it is already there).
4. Choose type **Secret**, enter the name `ADMIN_TOKEN`, paste that password as the value, and click **Deploy**.
5. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `FLG_ADMIN_TOKEN`).
6. Name: `FLG_ADMIN_TOKEN`. Secret: the same password. Click **Add secret**.
7. Cloudflare cannot show a secret again. If you lose it, make a new one and set it in both places.

**Links:** [Worker variables and secrets](https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings) · [GitHub secrets](https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions) · [Full guide (MAINTENANCE.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/MAINTENANCE.md)

## Cloudflare (the game server)

### Cloudflare Worker flg-api and Workers Builds

**Why:** The game server: accounts and sync, races and the scoreboard, voices, pictures, translations and this admin dashboard. Workers Builds deploys it and runs the database migrations on every push to main.

**Cost:** Free plan: 100,000 requests a day. Past that Cloudflare refuses requests; it never bills on the free plan.

| Name | Where | Notes |
| --- | --- | --- |
| `FLG_CLOUD_URL` | GitHub repository variable | Value: `https://flg-api.btay74.workers.dev` Tells the website and desktop builds where the server is. |
| `ALLOWED_ORIGINS` | Worker variable (server/wrangler.toml [vars]) | The website and apps allowed to call the server. |
| `SITE_URL` | Worker variable (server/wrangler.toml [vars]) | Value: `https://thelogicgrid.com` |
| `WORKER_NAME` | Worker variable (server/wrangler.toml [vars]) | Only if the Worker is renamed (default flg-api); used for usage numbers. Optional. |
| `ASSETS` | Worker binding (server/wrangler.toml) | Serves these admin dashboard files. |

**Settings:**

- Workers Builds > Root directory: server
- Workers Builds > Deploy command: npx wrangler d1 migrations apply flg --remote && npx wrangler deploy
- Workers Builds > Production branch: main
- Workers Builds > Builds for non-production branches: Off (stops the harmless red "Workers Builds: flg-api" check on pull requests)

**Steps:**

1. Open <https://dash.cloudflare.com> and choose **Workers & Pages** > **flg-api** > **Settings** > **Build**.
2. Check the Git repository is `bltaylorjr/fantastical-logic-grid`, root directory `server` and the deploy command shown under Settings.
3. Under **Branch control**, untick **Builds for non-production branches** (or **Enable non-production branch builds**) and click **Save**.
4. In GitHub, <https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions>, check the variable `FLG_CLOUD_URL` is `https://flg-api.btay74.workers.dev`.
5. If a build shows success but the old code stays live, open **Deployments** and click **Retry build**.

**Links:** [Worker settings](https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings) · [GitHub variables](https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions) · [Admin dashboard](https://flg-api.btay74.workers.dev/admin/) · [Full guide (server/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/README.md)

### Cloudflare D1 database "flg"

**Why:** Stores accounts' synced saves, screen names, scores, races, settings, story parts, feedback and the audit log.

**Cost:** Free: 5 GB, 5 million row reads and 100,000 row writes a day. It stops, never bills, on the free plan.

| Name | Where | Notes |
| --- | --- | --- |
| `DB` | Worker binding (server/wrangler.toml) | database_name "flg", database_id in server/wrangler.toml. |

**Settings:**

- database_id: 7285197a-aadd-4e07-ba53-0af8268cf794

**Steps:**

1. Nothing to do while it works. The database already exists and Workers Builds applies new tables (server/migrations) before each deploy.
2. To look at it: Cloudflare > **Storage & Databases** > **D1** > **flg**.
3. If it is ever re-made, put its new id in `server/wrangler.toml` (`database_id`).

**Links:** [D1 databases](https://dash.cloudflare.com/?to=/:account/workers/d1) · [Full guide (server/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/README.md)

### Cloudflare Workers AI (pictures and translations)

**Why:** Paints the AI scene pictures and portraits, and translates the game for players who pick another language.

**Cost:** Free daily allowance. On the free plan Cloudflare refuses requests past it; it never bills.

| Name | Where | Notes |
| --- | --- | --- |
| `AI` | Worker binding (server/wrangler.toml) | The [ai] binding in server/wrangler.toml. No key needed. |

**Steps:**

1. Nothing to set up. Switch pictures and translations on or off in **Settings and switches** (Pictures, Languages).

**Links:** [Workers AI](https://dash.cloudflare.com/?to=/:account/ai/workers-ai) · [Full guide (server/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/README.md)

### Cloudflare rate limits

**Why:** Per-player and per-connection request limits that keep the free allowances safe from floods.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `LIMIT_SYNC` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_AUTHLESS` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_COMPETE` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_PLAYS` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_PARTS` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_TTS` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_FEEDBACK` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_PICTURES` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_TRANSLATE` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_ERRORS` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_ADMIN_IP` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_ADMIN` | Worker binding (server/wrangler.toml) |  |
| `LIMIT_MESSAGES` | Worker binding (server/wrangler.toml) |  |

**Steps:**

1. Nothing to set up: each limit is a [[ratelimits]] block in `server/wrangler.toml`. Change the numbers there.

**Links:** [wrangler.toml](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/wrangler.toml) · [Full guide (server/wrangler.toml)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/wrangler.toml)

### Cloudflare usage numbers and free-limit alerts (optional)

**Why:** Lets Overview and Usage show daily Worker requests and D1 reads and writes against the free limits, and warn at the alert level (80%).

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `CF_API_TOKEN` | Cloudflare Worker secret | A Custom token with Account > Account Analytics > Read only. Optional. |
| `CF_ACCOUNT_ID` | Cloudflare Worker secret | Shown on the right of the Workers & Pages overview. Optional. |

**Steps:**

1. Open <https://dash.cloudflare.com/profile/api-tokens>, click **Create Token**, and under **Custom token** click **Get started**.
2. Name it `logic-grid-usage`. Permissions: **Account** > **Account Analytics** > **Read**. Click **Continue to summary**, then **Create Token**, and copy it.
3. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
4. Click **Add** (or **Edit** next to `CF_API_TOKEN` if it is already there).
5. Choose type **Secret**, enter the name `CF_API_TOKEN`, paste the token as the value, and click **Deploy**.
6. Add a second secret, `CF_ACCOUNT_ID`, with your Account ID, and click **Deploy**.
7. Check **Usage and free limits** in this dashboard.

**Links:** [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens) · [Worker variables and secrets](https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings) · [Full guide (admin/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/admin/README.md)

## Google and Firebase

### Firebase Authentication (player and admin sign-in)

**Why:** Email and password accounts, password reset and email confirmation. The website needs the web API key to show sign-in; the Worker checks Firebase's signed tokens with the project id.

**Cost:** Free on the Spark plan (50,000 monthly active players). Spark never bills.

| Name | Where | Notes |
| --- | --- | --- |
| `FLG_FIREBASE_API_KEY` | GitHub repository variable | The Firebase Web API key (starts AIza). A variable, not a secret: it is public by design, but GitHub's scanner flags it in code. |
| `FIREBASE_PROJECT_ID` | Worker variable (server/wrangler.toml [vars]) | Value: `the-fantastical-logic-grid` |

**Settings:**

- Authentication > Sign-in method: Email/Password: Enabled (Email link off)
- Authentication > Templates > Reply to: support@thelogicgrid.com (optional)
- Google Cloud > Credentials > Browser key > API restrictions: Identity Toolkit API and Token Service API only. Application restrictions: None (a website restriction breaks the desktop app).

**Steps:**

1. Open <https://console.firebase.google.com/project/the-fantastical-logic-grid/authentication/providers> and check **Email/Password** is **Enabled**.
2. Open <https://console.firebase.google.com/project/the-fantastical-logic-grid/settings/general> and copy the **Web API key** (starts `AIza`).
3. In GitHub, <https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions:> the variable `FLG_FIREBASE_API_KEY` must hold that key. Then run **Publish web version**.
4. Optional: <https://console.cloud.google.com/apis/credentials> (project the-fantastical-logic-grid) > **Browser key (auto created by Firebase)** > **API restrictions** > **Restrict key**, allow only Identity Toolkit API and Token Service API, **Save**.
5. Optional: <https://console.firebase.google.com/project/the-fantastical-logic-grid/authentication/emails>, edit each template, set **Reply to** to support@thelogicgrid.com (players see it when they answer a sign-in email), and save.

**Links:** [Firebase sign-in methods](https://console.firebase.google.com/project/the-fantastical-logic-grid/authentication/providers) · [Firebase project settings](https://console.firebase.google.com/project/the-fantastical-logic-grid/settings/general) · [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) · [Full guide (server/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/README.md)

### Admin dashboard sign-in

**Why:** Who owns this dashboard. The owner signs in with a confirmed game account whose email matches OWNER_EMAIL; the Worker needs the Firebase web API key to sign admins in.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `OWNER_EMAIL` | Cloudflare Worker secret | Value: `fantasticallogicgrid@gmail.com` The owner's game account email. |
| `FIREBASE_WEB_API_KEY` | Cloudflare Worker secret | The same AIza key as the GitHub variable FLG_FIREBASE_API_KEY. A value starting AQ. is wrong. |

**Steps:**

1. In the game (<https://thelogicgrid.com>), **Menu** > **Account and sync**: make an account with fantasticallogicgrid@gmail.com and click the link in the confirmation email.
2. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
3. Click **Add** (or **Edit** next to `OWNER_EMAIL` if it is already there).
4. Choose type **Secret**, enter the name `OWNER_EMAIL`, paste `fantasticallogicgrid@gmail.com` as the value, and click **Deploy**.
5. Copy the **Web API key** from <https://console.firebase.google.com/project/the-fantastical-logic-grid/settings/general> and set it the same way as the secret `FIREBASE_WEB_API_KEY`.
6. Open <https://flg-api.btay74.workers.dev/admin/> and sign in with that game account. Add helpers under **Admins**.

**Links:** [Worker variables and secrets](https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings) · [Firebase project settings](https://console.firebase.google.com/project/the-fantastical-logic-grid/settings/general) · [Full guide (admin/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/admin/README.md)

### Google Gemini (server voices and the AI story writer)

**Why:** Gives characters natural server voices and drafts story parts in the Story workshop.

**Cost:** Free tier from Google AI Studio (no card). The daily voice cap keeps it inside the free limit.

| Name | Where | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | Cloudflare Worker secret | A key from Google AI Studio. Never one that was posted anywhere. |
| `TTS_MODEL` | Worker variable (server/wrangler.toml [vars]) | The Gemini voice model (the dashboard setting can override it). |
| `DAILY_TTS_CAP` | Worker variable (server/wrangler.toml [vars]) | Value: `300` Default daily voice clips; the dashboard setting replaces it. |

**Steps:**

1. Open <https://aistudio.google.com/app/apikey> and click **Create API key**. Copy it.
2. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
3. Click **Add** (or **Edit** next to `GEMINI_API_KEY` if it is already there).
4. Choose type **Secret**, enter the name `GEMINI_API_KEY`, paste the key as the value, and click **Deploy**.
5. Voices, the cap and the model can be changed in **Settings and switches** > **Voices**.

**Links:** [Google AI Studio keys](https://aistudio.google.com/app/apikey) · [Worker variables and secrets](https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings) · [Full guide (server/LEARNING.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/LEARNING.md)

### Google Cloud Text-to-Speech, Chirp 3 HD (backup voices)

**Why:** Speaks when Gemini's free voices are off or used up, with the same voice for each character.

**Cost:** COST WARNING: Google Cloud needs a billing account with a card and bills past 1,000,000 characters a month. The Worker stops at GCLOUD_TTS_MONTH_CAP (900,000). Keep the $1 budget alert.

| Name | Where | Notes |
| --- | --- | --- |
| `GOOGLE_TTS_KEY` | Cloudflare Worker secret | An API key restricted to the Cloud Text-to-Speech API only. Optional. |
| `GCLOUD_TTS_MONTH_CAP` | Worker variable (server/wrangler.toml [vars]) | Value: `900000` Keep it under Google's free 1,000,000. |

**Settings:**

- Billing > Budgets & alerts: A $1 budget that emails you (set up 26 Oct 2026)

**Steps:**

1. In <https://console.cloud.google.com>, pick (or make) a project and link a billing account.
2. Turn on the API: <https://console.cloud.google.com/apis/library/texttospeech.googleapis.com> > **Enable**.
3. <https://console.cloud.google.com/apis/credentials> > **Create credentials** > **API key**. Edit it: **API restrictions** > **Restrict key** > **Cloud Text-to-Speech API** only. **Save** and copy it.
4. <https://console.cloud.google.com/billing/budgets> > **Create budget**: amount $1, email alerts on.
5. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
6. Click **Add** (or **Edit** next to `GOOGLE_TTS_KEY` if it is already there).
7. Choose type **Secret**, enter the name `GOOGLE_TTS_KEY`, paste the key as the value, and click **Deploy**.
8. Switch: **Settings and switches** > **Voices** > **Backup server voices**.

**Links:** [Text-to-Speech API](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com) · [Credentials](https://console.cloud.google.com/apis/credentials) · [Budgets & alerts](https://console.cloud.google.com/billing/budgets) · [Full guide (server/LEARNING.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/LEARNING.md)

## Search engines

### Google Search Console

**Why:** Gets the site into Google, shows what people searched, and feeds the dashboard's Search section.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `GSC_SERVICE_ACCOUNT` | Cloudflare Worker secret | The whole JSON key of a Google Cloud service account that is a Restricted user on the property. Optional. |
| `SEARCH_SITE_URL` | Worker variable (server/wrangler.toml [vars]) | Value: `https://thelogicgrid.com/` Use sc-domain:thelogicgrid.com for a domain property. |
| `FLG_GOOGLE_SITE_VERIFICATION` | GitHub repository variable | Only for the "HTML tag" method. The site uses the HTML file method. Optional. |

**Settings:**

- Property: <https://thelogicgrid.com/> (verified with the HTML file hosting/google42317eab27119d46.html; keep it)
- Sitemaps: sitemap.xml

**Steps:**

1. Open <https://search.google.com/search-console> and pick `https://thelogicgrid.com/`.
2. Go to **Sitemaps**, enter `sitemap.xml`, and click **Submit** (skip if already listed).
3. For dashboard numbers, go to <https://console.cloud.google.com> and make a project named `logic-grid-search`.
4. Turn on <https://console.cloud.google.com/apis/library/searchconsole.googleapis.com> > **Enable**.
5. <https://console.cloud.google.com/iam-admin/serviceaccounts> > **Create service account**, name `search-reader`, **Done** (no roles).
6. Open it > **Keys** > **Add key** > **Create new key** > **JSON** > **Create**. Copy its `client_email`.
7. In Search Console, **Settings** > **Users and permissions** > **Add user**, paste that email, choose **Restricted**, **Add**.
8. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
9. Click **Add** (or **Edit** next to `GSC_SERVICE_ACCOUNT` if it is already there).
10. Choose type **Secret**, enter the name `GSC_SERVICE_ACCOUNT`, paste everything in the downloaded .json file (open it in Notepad) as the value, and click **Deploy**.
11. Delete the downloaded file. In this dashboard open **Search** and click **Refresh now**.

**Links:** [Search Console](https://search.google.com/search-console) · [Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) · [SEO.md](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/SEO.md) · [Full guide (SEO.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/SEO.md)

### Bing Webmaster Tools

**Why:** Gets the site into Bing (which also feeds DuckDuckGo, Yahoo and Ecosia) and feeds the dashboard's Search section.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `BING_WEBMASTER_KEY` | Cloudflare Worker secret | Bing Webmaster > Settings > API access > API Key. Optional. |
| `FLG_BING_SITE_VERIFICATION` | GitHub repository variable | Only for the meta tag method. The site uses the XML file method. Optional. |

**Settings:**

- Verification: XML file hosting/BingSiteAuth.xml at the site root (keep it)

**Steps:**

1. Open <https://www.bing.com/webmasters> and pick thelogicgrid.com (or **Import from Google Search Console**).
2. **Sitemaps** > **Submit sitemap**: `https://thelogicgrid.com/sitemap.xml` (skip if listed).
3. For dashboard numbers: **Settings** (gear) > **API access** > **API Key** > **Generate**. Copy it.
4. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
5. Click **Add** (or **Edit** next to `BING_WEBMASTER_KEY` if it is already there).
6. Choose type **Secret**, enter the name `BING_WEBMASTER_KEY`, paste the key as the value, and click **Deploy**.

**Links:** [Bing Webmaster Tools](https://www.bing.com/webmasters) · [Full guide (SEO.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/SEO.md)

### IndexNow (tell Bing and others about changed pages)

**Why:** After each publish, the website workflow tells Bing, Yandex, Seznam and Naver which pages changed. The key file on the site proves it is ours.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `FLG_INDEXNOW_KEY` | GitHub repository variable | Only to use a different key; also change INDEXNOW_KEY in scripts/seo.mjs. Optional. |

**Steps:**

1. Nothing to set up. The key file is published with every build.

**Links:** [IndexNow](https://www.indexnow.org/documentation) · [Full guide (SEO.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/SEO.md)

## Email

### Gmail app password (the game's outgoing email)

**Why:** GitHub Actions send the weekly archive and summary emails, the daily player report, owner task emails and the backup thank-you notes, daily puzzle emails and weekly and special edition puzzle emails from fantasticallogicgrid@gmail.com.

**Cost:** Free. Gmail allows about 500 emails a day.

| Name | Where | Notes |
| --- | --- | --- |
| `GMAIL_USER` | GitHub repository secret | Value: `fantasticallogicgrid@gmail.com` |
| `GMAIL_APP_PASSWORD` | GitHub repository secret | The 16-letter app password (spaces are fine). |
| `ARCHIVE_TO` | GitHub repository secret | Value: `fantasticallogicgrid@gmail.com` Where archive zips go. |
| `SUMMARY_TO` | GitHub repository secret | Weekly summary to another address (otherwise ARCHIVE_TO). Optional. |
| `OWNER_TASKS_TO` | GitHub repository secret | Owner task emails to another address (otherwise GMAIL_USER). Optional. |
| `NIGHTLY_TO` | GitHub repository secret | Nightly maintenance problem emails to another address (otherwise ARCHIVE_TO). Optional. |
| `REPORTS_TO` | GitHub repository secret | Daily player report to another address (otherwise ARCHIVE_TO). Optional. |
| `PLAYER_REPORTS` | GitHub repository variable | Value: `off` Only to stop the daily player report email. Optional. |
| `IMPROVE` | GitHub repository variable | Weekly improvement run: off stops it; report emails the report but never changes the tuning. Optional. |

**Settings:**

- Google account > Security > 2-Step Verification: On (needed for app passwords)

**Steps:**

1. Sign in to fantasticallogicgrid@gmail.com and turn on 2-Step Verification: <https://myaccount.google.com/signinoptions/twosv>
2. Open <https://myaccount.google.com/apppasswords>, type `Logic Grid archive`, click **Create**, and copy the 16-letter password.
3. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `GMAIL_APP_PASSWORD`).
4. Name: `GMAIL_APP_PASSWORD`. Secret: the app password. Click **Add secret**.
5. Add `GMAIL_USER` and `ARCHIVE_TO` the same way, both `fantasticallogicgrid@gmail.com`.
6. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/archive-email.yml> > **Run workflow** with **Test send** ticked. Check Junk the first time.

**Links:** [App passwords](https://myaccount.google.com/apppasswords) · [GitHub secrets](https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions) · [Full guide (server/ARCHIVE.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/ARCHIVE.md)

### Weekly archive email and removal

**Why:** Every Monday old rows are zipped and emailed, then (once you allow it) removed so the free database never fills.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `ARCHIVE_TO` | Cloudflare Worker secret | Only for the Cloudflare Email Routing path (domain DNS on Cloudflare). Not used today. Optional. |
| `ARCHIVE_FROM` | Worker variable (server/wrangler.toml [vars]) | Value: `backups@thelogicgrid.com` Only for the Cloudflare Email Routing path. |
| `ARCHIVE_EMAIL` | Worker binding (server/wrangler.toml) | The commented [[send_email]] binding, only if DNS moves to Cloudflare. Optional. |

**Settings:**

- Settings and switches > Backups > Weekly archive email: On
- Settings and switches > Backups > Remove archived rows after the email is sent: On, once you agree with the list in Backups and archive

**Steps:**

1. Set up the Gmail app password first (the connection above).
2. In this dashboard, **Settings and switches** > **Backups**: turn on **Weekly archive email**.
3. Read **Backups and archive**: what goes and how long each kind is kept.
4. If you agree, turn on **Remove archived rows after the email is sent**. Keep the emails: they are then the only copy.

**Links:** [ARCHIVE.md](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/ARCHIVE.md) · [Full guide (server/ARCHIVE.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/ARCHIVE.md)

### Resend: player emails from support@thelogicgrid.com

**Why:** Sends the thank-you notes for ideas and problems from support@thelogicgrid.com (replies welcome), and the daily puzzle emails and the weekly and special edition puzzle emails (with their confirm links) from noreply@thelogicgrid.com, instead of the Gmail address. Until it is set up, they go from Gmail, so nothing is lost.

**Cost:** Free plan: 3,000 emails a month, 100 a day, no card. Past that Resend refuses and Gmail takes over.

| Name | Where | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | GitHub repository secret | Starts re_. Sending access, domain thelogicgrid.com only. Optional. |
| `MAIL_FROM` | GitHub repository variable | Another sender on the domain, e.g. hello@thelogicgrid.com. Optional. |

**Settings:**

- Resend domain: thelogicgrid.com, region US East
- DNS records (copy exactly from Resend): TXT for resend._domainkey, CNAME for send and rsend, optional TXT for _dmarc (or use Resend's Go to Namecheap button)

**Steps:**

1. Sign up at <https://resend.com> with fantasticallogicgrid@gmail.com.
2. <https://resend.com/domains> > **Add domain** > `thelogicgrid.com`, region US East, **Add**.
3. At your registrar's DNS settings for thelogicgrid.com, add each record Resend shows with the same type, name, value and priority. If your DNS host adds `.thelogicgrid.com` itself, enter only `send` or `resend._domainkey` as the name.
4. Back in Resend, click **Verify DNS records** and wait for **Verified** (minutes to hours).
5. <https://resend.com/api-keys> > **Create API key**, name `logic-grid`, **Sending access**, domain `thelogicgrid.com`. Copy the key.
6. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `RESEND_API_KEY`).
7. Name: `RESEND_API_KEY`. Secret: the key. Click **Add secret**.
8. Test: in the game, signed in with a confirmed account, send an idea with "Email me a thank-you note" ticked.

**Links:** [Resend domains](https://resend.com/domains) · [Resend API keys](https://resend.com/api-keys) · [Full guide (server/FEEDBACK-EMAILS.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/FEEDBACK-EMAILS.md)

### support@thelogicgrid.com: support inbox (ImprovMX forwarding + Gmail Send mail as)

**Why:** Mail to support@thelogicgrid.com is forwarded by ImprovMX to the game's Gmail, and Gmail can answer as support@ by sending through Resend. Nothing in the code needs it; it is the address players can write to.

**Cost:** ImprovMX free plan (forwarding, no card). Replies use the Resend free plan (shared 100 a day).

**Settings:**

- Namecheap Mail Settings: Custom MX: @ mx1.improvmx.com (10), @ mx2.improvmx.com (20)
- Root SPF TXT (@): v=spf1 include:spf.improvmx.com ~all
- ImprovMX alias: support -> fantasticallogicgrid@gmail.com
- Gmail Send mail as: smtp.resend.com, port 465 SSL, user resend, password = a Resend Sending access key

**Steps:**

1. Sign up at <https://app.improvmx.com> with fantasticallogicgrid@gmail.com, add `thelogicgrid.com`, and make the alias `support` forward to fantasticallogicgrid@gmail.com.
2. Namecheap > **Domain List** > **Manage** > **Advanced DNS**: under **Mail Settings** (Custom MX) add MX `@` `mx1.improvmx.com` priority 10 and MX `@` `mx2.improvmx.com` priority 20; under **Host Records** add TXT `@` `v=spf1 include:spf.improvmx.com ~all`.
3. In ImprovMX click **Check again** until it says **Email forwarding active**.
4. Gmail > **Settings** > **Accounts and Import** > **Send mail as** > **Add another email address**: `support@thelogicgrid.com`, SMTP `smtp.resend.com`, port 465 (SSL), user `resend`, password = a new Resend **Sending access** key. Confirm with the code Gmail sends.

**Links:** [ImprovMX](https://app.improvmx.com) · [ImprovMX Namecheap guide](https://improvmx.com/guides/namecheap) · [Full guide (docs/owner-tasks/2026-10-28-resend-namecheap.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/owner-tasks/2026-10-28-resend-namecheap.md)

### Educator emails straight away

**Why:** Educators who ask for a puzzle package on the Educators page get a code email, and later their PDFs. The "Educator packages" GitHub Action sends them every 5 minutes, which GitHub sometimes starts 10 or more minutes late. With this token the Worker starts that Action the moment a teacher sends the form or you approve, so the code arrives in a minute or two. Optional: without it everything still goes out, just a little later.

**Cost:** Free (a GitHub fine-grained token; Actions on a public repository are free).

| Name | Where | Notes |
| --- | --- | --- |
| `GITHUB_DISPATCH_TOKEN` | Cloudflare Worker secret | Fine-grained token, this repository only, Actions: Read and write. Starts github_pat_. Optional. |

**Steps:**

1. Open <https://github.com/settings/personal-access-tokens/new> (signed in as bltaylorjr).
2. Token name `flg-educator-emails`, Expiration **1 year** (put a reminder in your calendar), Resource owner **bltaylorjr**.
3. Repository access: **Only select repositories** > `fantastical-logic-grid`.
4. Repository permissions: **Actions** > **Read and write**. Leave everything else as No access. **Generate token** and copy it.
5. Open <https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings> (Cloudflare > **Workers & Pages** > **flg-api** > **Settings** > **Variables and Secrets**).
6. Click **Add** (or **Edit** next to `GITHUB_DISPATCH_TOKEN` if it is already there).
7. Choose type **Secret**, enter the name `GITHUB_DISPATCH_TOKEN`, paste the token as the value, and click **Deploy**.
8. Test: in the admin dashboard, Educator requests should say "within about 2 minutes".

**Links:** [New fine-grained token](https://github.com/settings/personal-access-tokens/new) · [Educator packages runs](https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/educator-packages.yml) · [Full guide (server/EDUCATORS.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/server/EDUCATORS.md)

## Desktop and mobile apps

### Desktop app updates (Tauri updater key)

**Why:** Each Windows release is signed so installed copies trust and install updates. Losing the private key ends updates for everyone who installed the app.

**Cost:** Free.

| Name | Where | Notes |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | GitHub repository secret | The whole contents of .private/updater.key (no password). |
| `updater.key` | Private file (never in the repository) | Project files: fantastical-logic-grid-app/.private/updater.key. Keep a backup somewhere safe. Its public half is in desktop/src-tauri/tauri.conf.json. |

**Steps:**

1. Open the private file `updater.key` and copy everything in it.
2. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `TAURI_SIGNING_PRIVATE_KEY`).
3. Name: `TAURI_SIGNING_PRIVATE_KEY`. Secret: the file's contents. Click **Add secret**.
4. Releases start by themselves when a new version number reaches main ("Release desktop app" workflow).

**Links:** [Release workflow](https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/release.yml) · [Releases](https://github.com/bltaylorjr/fantastical-logic-grid/releases) · [Full guide (MAINTENANCE.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/MAINTENANCE.md)

### Android app signing (paused)

**Why:** Signs the Android app. Mobile apps are paused, so nothing to do now.

**Cost:** Free. A Google Play account costs a one-time fee, only when the apps resume.

| Name | Where | Notes |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | GitHub repository secret | Base64 of .private/android-release.p12. Optional. |
| `ANDROID_KEYSTORE_PASSWORD` | GitHub repository secret | From .private/android-release.password. Optional. |

**Steps:**

1. Paused. When the mobile apps resume, add both secrets from the private files.

**Links:** [GitHub secrets](https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions) · [Full guide (mobile/README.md)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/mobile/README.md)

## Marketing autopilot (posting the approved ads)

### Bluesky (automatic posts)

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

### Mastodon (automatic posts)

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

### X (automatic posts)

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

### Facebook Page and Instagram (automatic posts)

**Why:** Lets the marketing autopilot post approved ads to the game's Facebook Page and Instagram (pictures and Reels) on their day. Posts in Facebook groups are always by hand: Facebook no longer lets apps post in groups.

**Cost:** Free. The app is switched to Live mode so posts are public; it only posts to the Page and Instagram account you allow.

| Name | Where | Notes |
| --- | --- | --- |
| `META_PAGE_ID` | GitHub repository secret | The Facebook Page's id (a number). |
| `META_PAGE_TOKEN` | GitHub repository secret | A Page access token made from a long-lived user token, so it does not expire. Also used for Instagram. |
| `INSTAGRAM_ACCOUNT_ID` | GitHub repository secret | The Instagram business account id linked to the Page (a number). |

**Steps:**

1. Make the Facebook Page for the game (<https://www.facebook.com/pages/create>).
2. Open <https://developers.facebook.com/apps> (click **Get started** first if Meta asks you to register as a developer). Click **Create app**, name it `Logic Grid autopilot`, pick the use case **Manage everything on your Page** (and **Manage messaging & content on Instagram** for Instagram), and choose **I don't want to connect a business portfolio yet**.
3. In the app, open **Use cases** > **Customize** next to each use case and click **Add** on `pages_show_list`, `pages_read_engagement` and `pages_manage_posts` (for Instagram also `instagram_basic` and `instagram_content_publish`).
4. In **App settings** > **Basic**, set the privacy policy to `https://thelogicgrid.com/privacy/` and terms to `https://thelogicgrid.com/terms/`, save, then switch **App Mode** to **Live** so posts are public.
5. Open <https://developers.facebook.com/tools/explorer>, choose the app, set **User or Page** to **Get User Access Token**, add the permissions above, click **Generate Access Token** and allow it for the game's Page (and Instagram account).
6. Click the **i** in the token box > **Open in Access Token Tool** > **Extend Access Token**, and copy the long-lived token.
7. Back in the Explorer, paste the long-lived token and run `me/accounts`. Copy the game Page's `access_token` and `id`.
8. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `META_PAGE_TOKEN`).
9. Name: `META_PAGE_TOKEN`. Secret: the Page access_token. Click **Add secret**.
10. Add `META_PAGE_ID` the same way: the Page `id`.
11. For Instagram: make the game's Instagram a free **Business** or **Creator** account (**Settings** > **Account type and tools**) and link it to the Page (Page **Settings** > **Linked accounts** > **Instagram**). Make the token again with the Instagram permissions ticked and update `META_PAGE_TOKEN`. Then in the Explorer run `<page id>?fields=instagram_business_account` and add its `id` as the secret `INSTAGRAM_ACCOUNT_ID`.
12. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`. Facebook Page (and Instagram) should say connected.

**Links:** [Meta apps](https://developers.facebook.com/apps) · [Graph API Explorer](https://developers.facebook.com/tools/explorer) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

### Threads (automatic posts)

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

### LinkedIn (automatic posts)

**Why:** Lets the marketing autopilot share approved LinkedIn ads on your profile on their day, with the link's picture card.

**Cost:** Free (the Share on LinkedIn product). LinkedIn keys last 60 days: when the check says LinkedIn stopped working, press **Get the key** again.

| Name | Where | Notes |
| --- | --- | --- |
| `LINKEDIN_TOKEN` | GitHub repository secret | A member key that can post for you (60 days). |

**Steps:**

1. Open <https://www.linkedin.com/developers/apps> and click **Create app**. Name: `Logic Grid autopilot`. LinkedIn asks for a Company Page: pick or create a free Page for the game. Upload the game icon and tick the agreement.
2. In the app, open **Products** and click **Request access** on **Share on LinkedIn** and on **Sign In with LinkedIn using OpenID Connect**. Both are instant and free.
3. Open **Auth**. Under **Authorized redirect URLs** add `https://flg-api.btay74.workers.dev/admin/` exactly, and copy the **Client ID** and **Primary Client Secret**.
4. In admin, **Connections and setup** > this card > **Get the key**. Paste the id, sign in to LinkedIn and click **Allow**, then paste the secret when admin asks.
5. Open <https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions> and click **New repository secret** (or the pencil next to `LINKEDIN_TOKEN`).
6. Name: `LINKEDIN_TOKEN`. Secret: the key admin shows. Click **Add secret**.
7. Test: <https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/marketing-post.yml> > **Run workflow** with mode `check`.

**Links:** [LinkedIn developer apps](https://www.linkedin.com/developers/apps) · [Full guide (scripts/marketing-post.py)](https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/marketing-post.py)

### Pinterest (automatic pins)

**Why:** Lets the marketing autopilot pin approved Pinterest ads on their day, with the picture and the tracked link, to the board named in the ad.

**Cost:** Free. A new Pinterest app starts with Trial access, where pins are visible only to you. Ask for **Standard access** (free, a short form) and add the keys once it is approved.

| Name | Where | Notes |
| --- | --- | --- |
| `PINTEREST_APP_ID` | GitHub repository secret | The app id. |
| `PINTEREST_APP_SECRET` | GitHub repository secret | The app secret key. |
| `PINTEREST_REFRESH_TOKEN` | GitHub repository secret | Made by Get the key; lasts a year. |
| `PINTEREST_BOARD_ID` | GitHub repository secret | Only if no board name matches the ad: the board to pin to. Optional. |

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

### YouTube (automatic uploads)

**Why:** Lets the marketing autopilot upload approved YouTube videos and Shorts on their day, with the title and description from the ad. Captions and playlists stay by hand: the email says so.

**Cost:** Free (the YouTube Data API allows about 6 uploads a day). Google keeps videos from a new app private until the app passes a free audit, so add the keys once it is approved.

| Name | Where | Notes |
| --- | --- | --- |
| `YOUTUBE_CLIENT_ID` | GitHub repository secret | OAuth client ID (Web application). |
| `YOUTUBE_CLIENT_SECRET` | GitHub repository secret | OAuth client secret. |
| `YOUTUBE_REFRESH_TOKEN` | GitHub repository secret | Made by Get the key. |

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

### TikTok (automatic videos)

**Why:** Lets the marketing autopilot post approved TikTok videos on their day, with the caption from the ad.

**Cost:** Free. TikTok reviews every app before it may post publicly (free, about a week); until then posts would be private, so add the keys once it is approved.

| Name | Where | Notes |
| --- | --- | --- |
| `TIKTOK_CLIENT_KEY` | GitHub repository secret | The app's client key. |
| `TIKTOK_CLIENT_SECRET` | GitHub repository secret | The app's client secret. |
| `TIKTOK_REFRESH_TOKEN` | GitHub repository secret | Made by Get the key; lasts a year. |

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

### Reddit (automatic posts)

**Why:** Lets the marketing autopilot post approved Reddit ads in the subreddit named in the ad on their day. Ads that point at a weekly thread or need a judgement call stay by hand. Replying to comments is always yours.

**Cost:** Free. Reddit may ask you to fill in a short form for API access first.

| Name | Where | Notes |
| --- | --- | --- |
| `REDDIT_CLIENT_ID` | GitHub repository secret | The id shown under the app name. |
| `REDDIT_CLIENT_SECRET` | GitHub repository secret | The app secret. |
| `REDDIT_REFRESH_TOKEN` | GitHub repository secret | Made by Get the key; does not expire. |

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
