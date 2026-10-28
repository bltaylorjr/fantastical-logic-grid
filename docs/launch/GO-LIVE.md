# Going live with a money option

There are four options, each in its own pull request so they can be reviewed
side by side. All four share the supporter system (option 1's pull request):
an admin **Supporters** page, a ★ supporter badge on the scoreboard in four
tiers (Bronze, Silver, Gold, Platinum), and
**supporter extra** themes that open only for premium supporters. The daily
puzzle, races and shared puzzles always stay free.

## Hidden until you launch

Every part has its own tick box under Admin > **Settings and switches >
Support and premium**, and all of them start **off**, so merging changes
nothing players can see. Set everything up, test it, then tick the boxes on
launch day.

| Tick box | What players see when it's on |
| --- | --- |
| **Support the game link** | "Support the game" in the game's Menu |
| **Support asks in the game** | The Supporter plan's gentle asks: a thank-you on the solved panel after the 3rd, 10th and 25th puzzle, a note at a 7- and 30-day streak, the Supporters window from the Menu, one line on printed puzzles and in the daily puzzle email. At most once a week, never during play or a race, and "Don't ask again" means never. Needs the Support the game link on too. |
| **Show supporter badges** | Bronze to Platinum badges on the scoreboard |
| **Supporter extras** | The ticked themes locked for non-premium players, and the Get extras link |
| **Ko-fi payments** (option 2) | Ko-fi payments add supporters (off: Ko-fi's calls are refused, and Ko-fi retries them later) |
| **Lemon Squeezy payments** (option 3) | Lemon Squeezy orders add supporters (off: refused, and Lemon Squeezy retries them later) |

You can still add people by hand under **Supporters** while the boxes are off;
they just don't see anything until you switch it on.

| Option | Pull request | Players pay | Fee (check before signing up) | Who handles sales tax |
| --- | --- | --- | --- | --- |
| 1. Tip jar | Supporter system + tip jar | Any amount, by choice | GitHub Sponsors 0% for personal sponsors; Ko-fi 0% on tips plus Stripe/PayPal about 2.9% + 30c | You (tips are usually treated as income, not sales) |
| 2. Ko-fi membership | Ko-fi webhook | Monthly membership | 5% on Ko-fi's free plan plus Stripe/PayPal | You |
| 3. One-time unlock | Lemon Squeezy webhook | Once, for example $4.99 | About 5% + 50c a sale | Lemon Squeezy (merchant of record) |
| 4. All free for now | none | Nothing | none | none |

Options 2 and 3 can run together. Option 1's Support link can run with any of them.

## Badge tiers

Every supporter gets a ★ badge next to their name on the scoreboard, in one of
four tiers: **Bronze**, **Silver**, **Gold** or **Platinum**. A player with more
than one running grant shows the highest one.

- **Added by hand** (Admin > **Supporters**): you choose the badge.
- **Through a payment service**: if the membership tier's name says Bronze,
  Silver, Gold or Platinum (for example a Ko-fi tier called "Gold
  supporters"), that is the badge. Otherwise the amount paid decides it, using
  Admin > **Settings and switches > Support and premium**: Silver from $5, Gold
  from $15, Platinum from $50 to start with, and Bronze below that.
- Name your Ko-fi membership tiers after the badges (for example "Bronze
  supporters" $3, "Silver supporters" $5, "Gold supporters" $15) so the badge
  always matches the tier the player picked.

## Option 1: tip jar with a Supporter badge

1. Set up a tip page. GitHub Sponsors: https://github.com/sponsors > **Get sponsored** with your personal account, add bank and tax details, wait for approval. Or Ko-fi: sign up at https://ko-fi.com and connect Stripe or PayPal.
2. Admin dashboard > **Settings and switches > Support and premium**: paste the page link in **Support page link**, save, and turn on **Support the game link** (and **Show supporter badges**) when you're ready to launch.
3. When someone tips and you want to thank them, open **Supporters**, enter the email they used (or their player id from **Players**), choose **Supporter badge** and the badge tier (Bronze, Silver, Gold or Platinum), and click **Add**. The badge appears once they sign in with that confirmed email.

## Option 2: Ko-fi membership unlocks the extras

Needs the Ko-fi pull request merged. Payments arrive by Ko-fi's webhook, so nobody has to be added by hand.

1. Sign up at https://ko-fi.com with fantasticallogicgrid@gmail.com and connect Stripe or PayPal.
2. In Ko-fi, open **Memberships** and create a tier, for example "Supporter extras", $3 a month. Say it unlocks the supporter extra themes and the badge, and that players must use the same email as their game account.
3. Ko-fi > **More > API** (https://ko-fi.com/manage/webhooks): set **Webhook URL** to `https://flg-api.btay74.workers.dev/v1/pay/kofi` and click **Update**. Copy the **Verification Token** shown there.
4. Cloudflare > **Workers & Pages > flg-api > Settings > Variables and Secrets > Add**: name `KOFI_VERIFICATION_TOKEN`, type **Secret**, paste the token, **Deploy**.
5. Back in Ko-fi, click **Send Single Donation Test**. Admin > **Supporters** should show a new row from Ko-fi.
6. Admin > **Settings and switches > Support and premium**: tick the themes that become supporter extras, and set **Get extras page link** to your Ko-fi memberships page (`https://ko-fi.com/<you>/tiers`).

What the webhook does: a membership payment gives Premium for 35 days and each monthly payment extends it, so a cancelled membership runs out by itself. A one-off tip gives the Supporter badge. A shop order is ignored.

## Option 3: one-time unlock with Lemon Squeezy

Needs the Lemon Squeezy pull request merged. Lemon Squeezy is the seller of record, so it collects and pays sales tax and VAT for you.

1. Sign up at https://www.lemonsqueezy.com with fantasticallogicgrid@gmail.com, create a store, and finish **Settings > Payouts** and the identity check.
2. **Products > New product**: "The Fantastical Logic Grid supporter extras", a single payment (for example $4.99), and a description of what it unlocks. Publish it, then copy its **Share** link (a checkout link).
3. **Settings > Webhooks > +**: URL `https://flg-api.btay74.workers.dev/v1/pay/lemonsqueezy`, a signing secret you make up (20+ random characters), and the events **order_created** and **order_refunded**. Save.
4. Cloudflare > **flg-api > Settings > Variables and Secrets > Add**: name `LEMONSQUEEZY_SIGNING_SECRET`, type **Secret**, the same secret, **Deploy**.
5. Admin > **Settings and switches > Support and premium**: tick the supporter extra themes, and set **Get extras page link** to the checkout link from step 2. The game adds the signed-in player's id to the link, so the purchase reaches the right account even if they type another email.
6. Test in Lemon Squeezy's **Test mode** with card 4242 4242 4242 4242. Admin > **Supporters** should show the order, and a refund ends it.

## Option 4: all free for now

Nothing to do. Merge nothing, or merge only the supporter system to have the badge ready.

## Before taking any money

Not legal or tax advice; check anything you are unsure of with an accountant or lawyer.

- **Terms and privacy.** The copying-protection work adds a /terms/ page and a /privacy/ page. Once you take payments they should also say what the extras include, that the core game stays free, the refund policy (Lemon Squeezy's default is fine), that payments are handled by GitHub, Ko-fi or Lemon Squeezy, and that the game keeps the payer's email only to link the extras to their account.
- **Name and brand.** A US trademark for "The Fantastical Logic Grid" costs about $350 per class at the USPTO, and copyright registration about $45 to $65. Both are optional and cost money; the copying-protection email has the steps.
- **Taxes.** Payment services report payouts to the IRS (Form 1099-K) above their thresholds. Keep payouts in a separate bank account if you can, and keep the monthly statements.
- **Sales tax.** Lemon Squeezy handles it. With Ko-fi and GitHub Sponsors tips you are the seller; sales of digital goods can owe sales tax in some states, which is another reason the paid unlock goes through Lemon Squeezy.
- **Business.** You can sell as an individual (sole proprietor). An LLC separates personal and business money but has state fees.
- **Refunds and chargebacks.** Before you turn on payments, follow [CHARGEBACKS.md](CHARGEBACKS.md): set the statement name and the free fraud checks in Stripe or PayPal, set a $3 minimum tip in Ko-fi, and learn the Refunded, Chargeback and Dispute evidence buttons under Admin > Supporters.
- **Security.** The webhook secrets live only in Cloudflare as Secrets, never in the repo. Check that two-step sign-in is on for GitHub, Cloudflare, Google, Ko-fi and Lemon Squeezy.
