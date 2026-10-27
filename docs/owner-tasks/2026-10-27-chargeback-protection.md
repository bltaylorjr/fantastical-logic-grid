# Protect tips from chargebacks before you turn on payments (27 Oct 2026)

The game now has chargeback protection for the tip jar and Supporter system. There are **Refunded**, **Chargeback** and **Dispute evidence** buttons under Admin > Supporters, a block on new perks after a chargeback, and a "Tips and refunds" section in the terms. Everything is still behind the launch switches, which are off.

A few settings live in the payment services' own dashboards, and only you can change them. They are free. **Do them before you turn on the Support the game link or any payment switch.** The full guide is here: https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/docs/launch/CHARGEBACKS.md

## 1. Make the bank statement name match the game

**Why:** when payers don't recognize a charge, they ask their bank to reverse it.

**Steps (Stripe, if Ko-fi pays you through Stripe):**

1. Open https://dashboard.stripe.com/settings/public
2. Set **Statement descriptor** to `THELOGICGRID.COM`.
3. Set the support email to fantasticallogicgrid@gmail.com and the website to https://thelogicgrid.com, then save.

**Steps (PayPal, if Ko-fi pays you through PayPal):**

1. Sign in at https://www.paypal.com and open **Settings > Business information**.
2. Set the business name (and the statement name, if offered) to `THELOGICGRID.COM`, add the support email and website, and save.
3. Make sure dispute emails are turned on under notifications.

## 2. Turn on Stripe's free fraud checks

**Why:** small tip pages are a favorite place for testing stolen cards.

**Steps:**

1. Open https://dashboard.stripe.com/radar/rules
2. Make sure these are on: "Block if CVC verification fails", "Block if postal code verification fails" and "Block if risk level is highest".
3. Turn on "Request 3D Secure if 3D Secure is supported for card".

## 3. Set a minimum tip in Ko-fi

**Why:** card testers use very small payments.

**Steps:**

1. Sign in at https://ko-fi.com and open **Settings**.
2. Set the price of one coffee to at least $3, and save.
3. In your Ko-fi page's description, add: "Tips are a thank-you, not a purchase. Refunds within 30 days: https://thelogicgrid.com/terms/#tips"

## 4. If a refund request or dispute comes in

1. Refund requests: refund in the payment service, then press **Refunded** next to the payment in Admin > Supporters.
2. Disputes: press **Chargeback**, then **Dispute evidence**, and send that file in the payment service's dispute page before its deadline.
