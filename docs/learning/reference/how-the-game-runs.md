# Tutorial: how the game runs and what it connects to

Your game isn't one program on one computer. It's a few free online services, each doing one job, talking to each other. This page is the map. The full technical setup guide, with every setting, is [docs/CONNECTIONS.md](../../CONNECTIONS.md); the same guide, with live **Connected / Missing** lights, is in the admin dashboard under **Connections and setup**.

![A map of the services. Players load the game from the website and save, race and sign in through the game server and Firebase. The game server uses the database, AI helpers and email. GitHub publishes the website, deploys the server and posts ads. Search engines read the website.](../wireframes/connections-map.png)

## The pieces, in plain words

| Piece | Service | What it does | If it stopped |
| --- | --- | --- | --- |
| Website | GitHub Pages, at thelogicgrid.com | Hands every player the game's files (pages, pictures, the puzzle engine). Puzzles are made on the player's own device. | Nobody could open the game. Players who installed it could still play offline. |
| Domain | thelogicgrid.com (DNS records) | Points the name to GitHub Pages and proves to Google and Bing that you own it. | The address stops working; the game is still at its github.io address. |
| Game server | Cloudflare Worker "flg-api" | Accounts, syncing saves, races, scoreboard, the admin dashboard, translations, player reports. | Solo play still works; accounts, races and sync pause. |
| Database | Cloudflare D1 "flg" | Stores saves, scores, settings and reports for the server. | Same as the server. |
| Sign-in | Firebase Authentication | Checks email and password for players and for you (admin). The game never sees passwords. | Signing in stops; playing as Guest works. |
| AI helpers | Cloudflare Workers AI, Google Gemini, Google voices | Story pictures, translations, natural voices. | The game falls back to built-in art and the device's own voices. |
| Email out | Gmail (the game's account), Resend | Gmail sends *your* reports and to-do emails; Resend sends players' emails. | Emails stop; the game itself is fine. |
| GitHub | github.com | Holds the code. **Actions** is GitHub's robot: it runs the tests, publishes the website, sends your emails, and posts approved ads. | Nothing changes for players; updates and emails pause. |
| Search engines | Google Search Console, Bing, IndexNow | Find and list the website's pages. | The game is harder to find, but works. |
| Social posting | Bluesky, Mastodon, X, Facebook, Instagram, Threads | Posts the ads you approve. | Ads stop posting. |

## Keys and secrets: how services trust each other

When one service talks to another, it shows a **key** (also called a token or secret) to prove it's allowed. For example, GitHub's robot shows the Gmail **app password** to send your emails.

- Keys are stored in locked boxes: **GitHub > Settings > Secrets and variables > Actions**, and **Cloudflare > flg-api > Settings > Variables and Secrets**. Once saved, nobody can read them back, not even you; you can only replace them.
- The code refers to a key by its **name** (`GMAIL_APP_PASSWORD`), never its value.
- **Never paste a key** into an issue, pull request, email or chat. Your repository is public, so anything written there is public.
- If a key might have leaked, make a new one at the service and replace it in the locked box. The old one stops working.

## What happens when you merge a change

1. You merge a pull request into **main** (after its **Tests** check is green).
2. GitHub Actions rebuilds and **publishes the website** (a few minutes).
3. Cloudflare **deploys the game server** and updates the database layout if needed.
4. Players get the new version the next time they open the game (installed apps update themselves).

## Try it (10 minutes, nothing can break)

1. Open the admin dashboard and go to **Connections and setup**. Find three services from the table above and check their lights.
2. Open your repository on GitHub and click the **Actions** tab. Find the most recent **Tests** run and open it: each green check is a job that passed.
3. Click **Settings > Secrets and variables > Actions** and look at the secret **names**. Find `GMAIL_USER`. Notice you can't see its value; that's the point.
