# Learning from every game, and free voices

The game learns on each device by itself (see `web/js/learn.js`). This part of the
shared Cloudflare Worker (`server/src/learn.js`) lets it learn from **everyone's**
games on web, desktop, Android and iOS, and gives every player natural Gemini voices
without a key of their own.

Everything here fits in Cloudflare's and Google's **free** plans. Nothing costs money.

| Free allowance | What the game uses |
| --- | --- |
| Workers: 100,000 requests a day | about 3 per finished puzzle, plus voice clips |
| D1: 5 GB, 5 million reads and 100,000 writes a day | 1 write per finished puzzle |
| Rate limiting and the Cache API | free |
| Gemini free tier (AI Studio key) | capped by `DAILY_TTS_CAP` (300 new clips a day); clips already made come from the cache and don't count |

If the free voice clips run out for the day, players hear the Kokoro voices on their
own device until the next day. Nothing is charged.

## What is shared, and what isn't

After a puzzle is finished (or a player gives up and deletes it), the game sends:
level, theme, grid size, clue types, how tough the puzzle was, time, hints, mistakes,
the star rating and "too easy / just right / too hard" tap, and which story parts the
story used.

It never sends a name, email, account, saved puzzles, AI keys or a device id. The
server never stores IP addresses: rate limits use a one-way hash that Cloudflare's
limiter keeps in memory only. Learning data is never linked to player accounts.

Players see a notice the first time results are shared, and can turn sharing off in
**Settings, Learning**. Server voices can be turned off in **Settings, Where voices
come from**. A player's own Google key is always used first.

## Story parts players share

When a player adds a story part in the Story workshop, it can also be sent to you to
share with everyone. The engine's rules check it first: no head counts, no links, kept
friendly for all ages, and the right fill-ins. Then it **waits for your review**.
Nothing a player writes reaches other players until you approve it.

To review, open `https://<your worker address>/admin/learn`, paste your admin token,
and approve or reject each one. Approved parts reach every player within about 15
minutes. The same page shows how many games have been shared and how many voice clips
were made today.

## One-time setup

These steps assume the Worker is already set up with the player accounts steps
(one Cloudflare account, one Worker, one D1 database, deployed from GitHub).

1. **Learning tables:** nothing to do. Cloudflare's GitHub deploy runs
   `wrangler d1 migrations apply` before each deploy, which creates them from
   `server/migrations/0100_learning.sql`.
2. **Add the Gemini key as a secret.** Make a new free key at aistudio.google.com
   (Get API key). Don't use a key that has been posted anywhere, including chat. Then either:
   - run `npx wrangler secret put GEMINI_API_KEY` from `server/` and paste the key when asked, or
   - in the dashboard, open **Workers & Pages**, open the Worker, then **Settings,
     Variables and Secrets, Add**. Choose type **Secret**, name it `GEMINI_API_KEY`,
     paste the key, and deploy.

   The key lives only in Cloudflare. It is never in the repository or the app.
3. **Add an admin token** for the review page, in the same way: a secret named
   `ADMIN_TOKEN`, set to a long random password (at least 16 characters) that you keep
   to yourself.
4. **Point the game at the Worker.** This is the same `FLG_CLOUD_URL` variable that
   player accounts use, so set it once. On GitHub, open the repository's **Settings,
   Secrets and variables, Actions, Variables** tab and add `FLG_CLOUD_URL` with the
   Worker's address (for example `https://flg.<your-subdomain>.workers.dev`). The next
   web build and desktop release pick it up. Until it is set, the game works fully on
   its own, as before.

## Settings you can change

In `server/wrangler.toml` under `[vars]`:

- `DAILY_TTS_CAP`: new voice clips per day for all players together (default 300).
  Lower it if Google's free limit for your key is lower.
- `ALLOWED_ORIGINS`: the sites and apps allowed to call the service.
- `TTS_MODEL`: the Gemini voice model.

## Tests

`node server/test/learn.test.mjs` runs the learning routes locally with
`wrangler dev`, using `server/test/learn.wrangler.toml`. No Cloudflare account is
needed.
