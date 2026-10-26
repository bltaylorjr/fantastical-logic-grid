# Free with optional extras (freemium)

The Fantastical Logic Grid launches **free**. Nothing in the game is locked,
and no part of the code takes payments. This page records the plan, the
choices still open, and the one switch that already exists.

## What stays free, always

Every puzzle, theme, topic, size and difficulty; the daily puzzle and
streaks; races and the scoreboard; hints, Check, Undo and Start over; saving,
printing, My notes and the answer key; voices, pictures, music and
celebrations; accounts and sync across devices; all 100 languages; Silent mode
and every accessibility feature.

## Proposed optional extras (not built, waiting on the owner's choice)

- Printable puzzle-book PDFs (a set of puzzles with answer keys).
- Bonus theme and topic packs.
- Longer stats history and more badges.
- A Supporter badge next to the screen name on the scoreboard.
- Early access to new themes before everyone gets them.

None of these take anything away from free players.

## Ways to take money (all have fees)

Approximate, checked from memory in October 2026. Read each service's pricing
page before signing up.

| Option | Fee | Notes |
| --- | --- | --- |
| GitHub Sponsors (tips or monthly) | 0% for personal sponsors | Uses the existing GitHub account. Payouts need a bank account and tax form. |
| Ko-fi (tips) | 0% on tips | Stripe or PayPal processing, about 2.9% + 30c. |
| Ko-fi memberships or shop | 5% on the free plan | Plus processing. |
| Paddle or Lemon Squeezy (one-time unlock) | about 5% + 50c a sale | Merchant of record: they collect and pay sales tax for you. |
| Stripe directly | about 2.9% + 30c | You handle sales tax yourself. Not recommended alone. |

## What is built now: the Support the game link

Admin dashboard > **Settings and switches > Support and premium**:

- **Support the game link** (off by default).
- **Support page link**: an `https://` link to a tip, sponsor or membership
  page set up on any of the services above.

When both are set, the game's Menu shows **Support the game**, which opens
that page in a new window. Players reach it within about a minute, on the
website and in the desktop app, with no new release. The setting only accepts
`https://` links. The code is in `server/src/settings.js` (`support_url`,
`publicConfig`), `web/js/remote-config.js` (`supportUrl`) and `web/js/app.js`
(`applyFeatures`).

## Next steps once the owner picks

- **Tip jar (GitHub Sponsors or Ko-fi):** set up the page, paste its link in
  the setting above, switch it on. No code needed. A Supporter badge needs a
  small change to mark supporters by hand in the admin Players page.
- **Paid extras (Ko-fi membership, Paddle or Lemon Squeezy):** needs a
  webhook in the Worker that marks an account as premium, and the extras
  themselves. That is a separate piece of work.
