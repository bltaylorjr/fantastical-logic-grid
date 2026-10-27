# Contributor badges

A thank-you badge for players whose ideas and suggestions end up in the game.
Free: it uses only the game's own Worker and database.

## How a player earns it

1. They sign in, then send an idea or a problem report (Menu > Ideas and
   problems) or suggest a character (Menu > Suggest a character).
2. They leave **Count this toward my Contributor badge** ticked. (It is ticked
   to start with, and only shows when they are signed in.)
3. It counts once the team uses it:
   - an idea or problem report is marked **addressed** in the admin
     Communication inbox (fixed problem reports can be left out under
     Settings and switches > Contributors);
   - a suggested character is **published** in Characters.
4. Admins can also add a credit by hand on the admin **Contributors** page,
   for help given outside the game.

| Badge    | From (default, change under Settings and switches > Contributors) |
|----------|----|
| Bronze   | 2  |
| Silver   | 5  |
| Gold     | 10 |
| Platinum | 25 |

The badge shows in the player's **My stats and badges** window and next to
their name on the scoreboard. Switching **Contributor badges** off hides it
everywhere and stops new counting; counts already earned are kept.

## Privacy

Ideas and problem reports stay anonymous in the Communication inbox. Only the
`contributions` table (migration 1950) links a ticked message to the player's
account, and only the Contributors page reads it. Deleting an account removes
its contributions. A credit the team never used is let go after 200 days; a
counted one stays even after the idea itself is cleaned up.

## Code

- `src/contributors.js`: recording, counting, tiers, `GET /v1/contributor`,
  admin routes `GET/POST /admin/v1/contributors`, `POST .../:id/remove`.
- Hooks: `src/feedback.js` and `src/characters.js` (record on send),
  `src/admin.js` feedback update and `src/characters.js` publish (count),
  `src/compete.js` (scoreboard `contributor: <tier>`).
- Game: `web/js/contributor.js`, the `.fb-credit` tick boxes in
  `web/index.html`, My stats in `web/js/app.js`, `contributorPill` in
  `web/js/compete-ui.js`.
- Tests: `test/contributors.test.mjs`, `scripts/e2e-contributor.cjs`.
