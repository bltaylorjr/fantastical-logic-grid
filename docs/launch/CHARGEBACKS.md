# Refunds, chargebacks and payment fraud

A **chargeback** happens when a payer asks their bank or card company to take
a payment back, instead of asking you. You lose the payment, and the payment
service usually adds a dispute fee (for example, Stripe charges $15 in the US
for each dispute, win or lose; check the current fee on its pricing page). Too
many disputes, roughly 1 in 100 payments, can get a payment account limited or
closed. So the aim is to stop chargebacks before they start, and to answer the
few that still come.

Not legal advice. Fees and deadlines change, so check the payment service's
own help pages.

## The usual causes for a tip jar

1. **Card testing.** Fraudsters use small donation pages to check whether
   stolen card numbers work. The real card owner later disputes every charge.
   This is the biggest risk for a tip jar.
2. **"I don't recognize this charge."** The name on the bank statement doesn't
   match the game, so the payer thinks it's fraud.
3. **A child used a parent's card**, or someone paid by mistake and didn't
   know how to ask for a refund.

## What the game already does (all behind the launch switches)

- **Clear terms.** The terms page has a "Tips and supporter thank-yous"
  section (https://thelogicgrid.com/terms/#tips). It says a tip is a voluntary
  gift, nothing in the game is locked, what the badge and extras are, and that
  anyone can email within 30 days for a full refund, no questions asked. The
  Supporters window in the game says the same thing in one line, with a link.
- **Refunded button.** Admin > Supporters > **Refunded** ends that payment's
  badge and extras and keeps the record.
- **Chargeback button.** Admin > Supporters > **Chargeback** stops every badge
  and extra that player has straight away, keeps the records for the dispute,
  and **blocks** them. While they are blocked, a new payment from them (from
  Ko-fi or Lemon Squeezy, once those are connected) is recorded but adds
  nothing. The block is listed under "Refunds and chargebacks" on the same
  page, and **Lift the block** removes it.
- **Dispute evidence.** Admin > Supporters > **Dispute evidence** downloads a
  plain-text summary of the payment for the payment service. It covers the
  payment id and date, what it gave and that it was delivered at once, when
  the account was made, how many puzzles the player finished after paying,
  their other payments, and the terms they agreed to.
- **No card details here.** Card and PayPal details stay with the payment
  service. The game only keeps the payer's email and payment id, to link the
  badge to their account.

## Set up before you turn on payments

Do these once, in the payment service's dashboard. They are all free.

### Stripe (if Ko-fi pays you through Stripe)

1. **Statement name.** Stripe Dashboard > Settings > Business > Public
   details. Set the **statement descriptor** to `THELOGICGRID.COM`. Add a
   support email (fantasticallogicgrid@gmail.com) and the website
   (https://thelogicgrid.com). Payers then see a name they recognize.
2. **Radar fraud rules.** Stripe Dashboard > Radar > Rules. Radar's built-in
   rules are free with standard Stripe pricing. Make sure these are on:
   "Block if CVC verification fails", "Block if postal code verification
   fails", and the default "Block if risk level is highest".
3. **3D Secure.** In the same Rules page, turn on "Request 3D Secure if 3D
   Secure is supported for card". When a 3D Secure payment is disputed as
   fraud, the card's bank usually carries the loss, not you.
4. **Early fraud warnings.** Radar shows "early fraud warnings" when a card's
   bank reports a payment as fraud. Refund those payments straight away, then
   press **Refunded** in the admin. A refunded payment can't become a
   chargeback.

### PayPal (if Ko-fi pays you through PayPal)

1. PayPal > Account settings > Business information. Set the business name
   (and the "soft descriptor" or statement name, if PayPal offers it) to
   `THELOGICGRID.COM`, and add the support email and website.
2. Turn on email alerts for disputes, so you see them in time.

### Ko-fi

1. Ko-fi > Settings. Set the price of one "coffee" to at least **$3**. Very
   small payments are what card testers use.
2. In the page's text, link to the terms: "Tips are a thank-you, not a
   purchase. Refunds within 30 days:
   https://thelogicgrid.com/terms/#tips".

### Lemon Squeezy (option 3, if you use it later)

Lemon Squeezy is the **merchant of record**, so it handles card checks, fraud
screening and disputes itself. Set the store's refund policy to the same 30
days, and answer if Lemon Squeezy asks you for evidence.

### GitHub Sponsors

GitHub handles payments and disputes. Nothing to set up here; refund through
GitHub if someone asks.

## When someone asks for a refund

1. Refund it in the payment service (Stripe, PayPal, Ko-fi or Lemon Squeezy).
2. Press **Refunded** next to their payment in Admin > Supporters.
3. Reply kindly. A fast refund costs less than a chargeback, and the player
   may come back.

## When a dispute or chargeback arrives

1. Press **Chargeback** next to the payment in Admin > Supporters. You can add
   the dispute id as a note.
2. Press **Dispute evidence** and save the file.
3. In the payment service's dispute page (for example, Stripe Dashboard >
   Payments > Disputes), choose "accept" or "counter". To counter, choose
   **digital product or service**, paste or attach the evidence file, and say
   that the badge was delivered at once and the payer agreed to the terms.
   Answer before the deadline the dispute page shows; it is often 7 to 21 days.
4. If you win, or the player pays it back, press **Lift the block** under
   "Refunds and chargebacks".

If the evidence shows the payer was playing a lot after paying, that helps.
For a stolen card, it's usually best to accept, since the real card owner
never agreed to the payment.
