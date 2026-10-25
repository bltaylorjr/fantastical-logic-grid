# The game's Cloudflare Worker

One small Worker (`flg-api`) serves every copy of the game (website, desktop,
Android, iPhone):

- **Account sync** (`src/sync.js`): saved puzzles, progress, settings and the
  used-story list follow a signed-in player to every device.
- **Screen names, races and the scoreboard** (`src/compete.js`): players who
  choose a screen name can race others on the same puzzle and earn points.
- **Shared learning and voices** (`src/learn.js`): added by the learning work.
- **Admin dashboard** (`src/admin.js`, `src/settings.js`, app in `../admin`):
  analytics, settings and switches, announcements, players, moderation, admin
  roles and an audit log, at `/admin/`. Setup: `../admin/README.md`.

Everything here runs on free plans. Nothing needs a credit card.

| Service | What it does | Free allowance | When it could cost money |
| --- | --- | --- | --- |
| Firebase Authentication (Spark plan) | Email + password sign-in, password reset emails, email confirmation | 50,000 monthly active players; reset/confirm emails are sent by Firebase (daily send limits apply) | Only if you upgrade to the Blaze plan on purpose. Spark never bills. |
| Cloudflare Workers (Free) | Runs `flg-api` | 100,000 requests a day, 10 ms CPU per request | If you choose Workers Paid ($5/month). On Free, requests over the limit are refused, never billed. |
| Cloudflare D1 (Free) | Stores the synced game data | 5 GB, 5 million row reads and 100,000 row writes a day | Same as above: Free stops, it never bills. |

Passwords never reach this Worker or the game's code. Firebase stores them; the
Worker only checks Firebase's signed ID tokens and learns the player's id.

## One-time setup

### 1. Firebase (sign-in)

1. Go to <https://console.firebase.google.com>, sign in with a Google account
   and choose **Create a project**. Name it (for example `fantastical-logic-grid`).
   Google Analytics is not needed. The project stays on the free **Spark** plan.
2. **Build > Authentication > Get started > Sign-in method > Email/Password >
   Enable** (leave "Email link" off) and **Save**.
3. **Authentication > Settings > Password policy**: set a minimum length of 8
   (optional; the game already asks for 8).
4. **Authentication > Templates**: optionally set the sender name to
   "The Fantastical Logic Grid" for the password reset and confirmation emails.
5. **Project settings (gear) > General > Your apps > Web (`</>`)**: register an
   app called "The Fantastical Logic Grid". Hosting is not needed. Copy two
   values: **apiKey** and **projectId**. The apiKey is not a secret; it only
   names the project.
6. Recommended: in Google Cloud Console (project fantastical-logic-grid) >
   APIs & Services > Credentials, open the "Browser key (auto created by
   Firebase)" and under **API restrictions** choose *Restrict key* and allow
   only *Identity Toolkit API* and *Token Service API*. Leave **Application
   restrictions** at *None*: the desktop and phone apps send no website
   address, so a website restriction would block their sign-in. The key ships
   inside every copy of the game anyway; Firebase keys only name the project,
   and the API restriction stops anyone using it for other Google services.

### 2. Cloudflare (the Worker and database)

You need a free Cloudflare account (<https://dash.cloudflare.com/sign-up>).
From a computer with Node.js 20 or later, in this `server` folder:

```sh
npm install
npx wrangler login                 # opens the browser once
npx wrangler d1 create flg         # prints a database_id
```

Then edit `wrangler.toml`:

- `database_id` = the id printed above
- `FIREBASE_PROJECT_ID` = the Firebase projectId from step 1.5

and run:

```sh
npm run deploy                     # creates the tables and publishes the Worker
```

It prints the Worker's address, like `https://flg-api.<your-name>.workers.dev`.
Optional: in the Cloudflare dashboard, give it a nicer address such as
`https://api.thelogicgrid.com` (Workers & Pages > flg-api > Settings > Domains & Routes).

### 3. Switch accounts on in the game

In GitHub: **Settings > Secrets and variables > Actions > Variables > New
repository variable**, add:

- `FLG_FIREBASE_API_KEY` = the Firebase apiKey
- `FLG_CLOUD_URL` = the Worker address from step 2 (the same variable the shared learning service uses)

The next website publish and desktop release include accounts. (The key is kept out of the code so GitHub's secret scanner stays quiet.) Until both are set, the game
shows no account controls and works exactly as before.

### Deploying through Cloudflare's GitHub connection

If the Worker is connected to this repository in Cloudflare (Workers & Pages >
Create > Import a repository), set **Root directory** to `server` and **Deploy
command** to `npx wrangler d1 migrations apply flg --remote && npx wrangler deploy`.
The D1 database still has to exist first (dashboard: Storage & Databases > D1 >
Create database, name `flg`) with its id in `wrangler.toml`.

### Later deploys from GitHub (optional)

To have GitHub deploy the Worker, create a Cloudflare API token with the
"Edit Cloudflare Workers" template plus D1 edit permission, and add the repo
secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## How sync works

- Every change is saved on the device first, so the game plays offline. When
  signed in, changes go to the Worker in the background (a few seconds after a
  change, when the app comes back into view, when the connection returns, and
  every 5 minutes).
- Each record has a server revision number. A write based on an old revision
  comes back as a conflict, and the app merges:
  - **Saved puzzle**: a solved copy beats an unsolved one, otherwise the most
    recently played copy wins. If the other copy had progress of its own, it is
    kept as "*name* (from another device)". Progress beats a deletion. The
    puzzle open on screen is never replaced while it is being played.
  - **Used stories** and **history**: both lists are combined, so a story is
    never reused on any device.
  - **Settings**: the most recent change wins. API keys stay on each device.
- When someone signs in on a device that already has puzzles, those puzzles
  join their account. Signing out can optionally remove puzzles from a shared
  device; they stay in the account.
- **Deleting an account** (in the game: Menu > Account and sync > Delete my
  account) needs the password again. It removes all synced data here, then the
  Firebase account. The player's puzzles stay on that device.

## How races and the scoreboard work

- **Screen names** are optional and need an account. 3 to 20 letters, numbers,
  spaces, dots, dashes or underscores. `src/names.js` refuses rude words
  (also spelled with look-alikes such as `sh1t`, `$hit` or `s.h.i.t`), names
  that pretend to be the game (admin, support, official), and names that
  match an existing one once case, spaces and look-alike digits are ignored
  (`Sky Fox`, `sky_f0x`). The screen name is the only thing other players see.
- **Races**: a player starts a race from their New puzzle choices. The puzzle
  is stored here and everyone who joins (with the 6-character code, a
  `thelogicgrid.com/?race=CODE` link, or *Find a race* for open races) gets
  the very same puzzle. The fastest race time wins: solve time plus 1 minute
  per hint and 15 seconds per check. A race is open for 7 days, up to 20
  players. A finish counts only when the answers match the solution, and the
  time can never be shorter than the server's own clock since joining.
  Revealing the solution counts as giving up. Shared puzzles are checked for
  rude words (custom titles and names) before anyone else sees them.
- **Points**: each solved puzzle (solo or race) earns points: more for harder
  and bigger puzzles, up to 50% more for beating the usual time, less for
  each hint and check, nothing for a revealed solution. A puzzle scores once;
  up to 40 solo puzzles a day count. Solo times come from the player's device,
  so the scoreboard is for fun, not prizes.
- **Scoreboard**: this week (from Monday, UTC) and all time, top 50 by points,
  with solved puzzles and race wins (races won against at least one other
  finisher). Anyone can view it; it is cached for 30 seconds.
- **Leaving**: *Leave the scoreboard* in the screen name window, or deleting
  the account, removes the name, points and race results.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `POST /v1/sync` | signed in | push changes and/or pull changes since a revision |
| `DELETE /v1/account` | signed in within 10 minutes | delete all synced data |
| `GET /v1/health` | anyone | check the Worker is up; `?deep=1` adds the database, last daily cleanup, voice quota and errors today |
| `POST /v1/errors` | anyone (rate limited) | anonymous error reports from the apps (`src/errors.js`) |
| `GET /admin/errors?days=7` | `ADMIN_TOKEN` | most frequent error reports |
| `GET/PUT/DELETE /v1/profile` | signed in | read, choose or remove the screen name |
| `POST /v1/scores` | screen name | add a solved solo puzzle |
| `GET /v1/scoreboard?period=week\|all` | anyone | top players (and your place when signed in) |
| `POST /v1/races`, `POST /v1/races/find` | screen name | start a race, or find an open one |
| `POST /v1/races/:code/join`, `.../finish`, `GET /v1/races/:code` | screen name | join, send a result, standings |
| `/v1/learn/*`, `/v1/tts`, `/admin/learn*` | see `src/learn.js` | shared learning and voices |

Limits: 60 sync requests a minute per player, 1 MB per saved puzzle, 5,000
records per player; 30 race and score requests a minute per player, 20 races
started a day; 10 error reports a minute per connection, 300 distinct errors a day.

A daily cron (`[triggers]` in `wrangler.toml`, `src/upkeep.js`) deletes data the game no longer
needs; see [MAINTENANCE.md](../MAINTENANCE.md).

## Tests

```sh
npm test                           # Worker tests (Miniflare, local D1)
cd .. && npm run test:accounts     # two-device browser test of the whole flow
cd .. && npm run test:compete      # two players: screen names, a race, the scoreboard
cd .. && npm run test:errors       # an error in the game reaches the Worker, cleaned
```
