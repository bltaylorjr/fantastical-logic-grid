# App keys for the Windows and Android apps

The Windows (desktop) and Android apps ask for an **app key** the first time
they open. The website at thelogicgrid.com never needs a key.

## Rules (Bobby, 2026-10-27)

- Every key, its installs and its downloads are kept and shown in the admin
  dashboard under **App keys**, for tracking and checking installs.
- A key installs on **one** computer or phone. When a player asks, an admin can
  allow a **second** install (**Allow a 2nd install**). Two is the most.
- A key can be used for **two downloads** from the website (Menu > Install the
  app). After that the player needs a new key.

## How it works

1. The player types the key in the app. The app sends the key, a random install
   id (made once on that device) and the platform to `POST /v1/license/activate`.
2. The Worker checks the key, uses one of its installs and sends back a **pass**
   signed with the `LICENSE_SIGNING_KEY` secret (ECDSA P-256).
3. The app checks the pass with the public key in `web/js/cloud-config.js`
   (`CLOUD.licenseKey`), so it opens offline from then on.
4. About once a day when online, the app sends the pass to
   `POST /v1/license/check`. A cancelled key, an ended key or an install the
   admin removed asks for a key again.
5. On the website, the Windows and Android downloads send the typed key to
   `POST /v1/license/download`, which counts it toward the key's 2 downloads.
   The files on GitHub Releases are still public, but the apps will not open
   without a key.

Players allowed under **Settings and switches > App keys > Who can get a key
for themselves** see **Get my free key** on the website (one key each, ever,
from `/v1/license/mine`). Everyone else gets keys an admin makes under
**App keys > Make keys**.

## Switches (Settings and switches > App keys)

| Setting | Default | What it does |
| --- | --- | --- |
| The apps need a key | On | Off: the apps open without a key. |
| Downloads on the website ask for a key | On | Off: downloads start straight away. |
| Who can get a key for themselves | Any signed-in player | Or only Supporters, or nobody. |
| Computers or phones each new key installs on | 1 | 1 or 2. |

Nothing is asked until the `LICENSE_SIGNING_KEY` secret is set, so nobody is
locked out before keys can be made.

## Setup

The signing key pair was made once. The private half is the file
`license-signing.jwk` in the project's private folder (never in the
repository); its whole one line goes in the Cloudflare Worker secret
`LICENSE_SIGNING_KEY`. The public half is in `web/js/cloud-config.js`. If the
private key is ever replaced, the public key there must change in the same
release, and every install asks for its key again.

Tables: `licenses` and `license_devices` (migration `2000_licenses.sql`).
Account deletion keeps a player's key working on their devices but removes the
link to the account.

Tests: `server/test/licenses.test.mjs` and `scripts/e2e-license.cjs`
(`npm run test:license`).
