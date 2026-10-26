# The game on itch.io and other game sites

Game sites such as itch.io, Game Jolt and Newgrounds show HTML5 games inside
their own page. The build makes a copy for them in `dist/portal`:

- It may be shown inside another site's frame. It is served from the game
  site's own domain, so this does not weaken the protection of
  thelogicgrid.com, which still refuses to be framed.
- It has no service worker (game sites give each upload its own address) and
  no home-screen install. The menu has **Play on thelogicgrid.com** instead.
- Everything else is the full game: quick puzzle, daily puzzle (read from
  thelogicgrid.com), voices, printing, Challenge a friend and accounts.

## Getting the zip

The **Game site zip** workflow (`.github/workflows/portal.yml`) rebuilds it after
every change to the game and puts it on the GitHub release **web-portal**:
https://github.com/bltaylorjr/fantastical-logic-grid/releases/tag/web-portal
(file `the-fantastical-logic-grid-web-game.zip`). That release is a
pre-release and never marked latest, so the desktop app's updater ignores it.

## Uploading to itch.io

1. Sign in at https://itch.io and open https://itch.io/game/new (or the game's
   **Edit game** page to update it).
2. **Kind of project:** HTML. **Pricing:** No payments.
3. **Uploads:** upload the zip and tick **This file will be played in the browser**.
4. **Embed options:** viewport 1280 × 800, tick **Mobile friendly**,
   **Fullscreen button** and **Click to launch in fullscreen** (phones).
5. **Frame options:** tick **SharedArrayBuffer support** only if the voices
   are slow to start (the game works without it).
6. Save, then open the page to check it plays.

To update it later, upload the new zip from the release and delete the old one.

## Server settings it needs

- The Worker accepts calls from `https://html-classic.itch.zone` and
  `https://html.itch.zone` (`ALLOWED_ORIGINS` in `server/wrangler.toml`).
- Signing in from the itch.io copy needs those two domains in Firebase:
  Firebase console > Authentication > Settings > Authorized domains. Without
  them the game still plays; only sign-in is off there.

Visits from itch.io count under the source **itch** in the admin Marketing
section, because the game reads the page it was opened from.
