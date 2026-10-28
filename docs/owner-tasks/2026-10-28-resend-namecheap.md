# Send player emails from noreply@thelogicgrid.com (Resend + Namecheap, about 15 minutes)

**Why:** Player emails (thank-you notes, updates, the daily puzzle email, educator packages) now go from the game's Gmail with "(no-reply)" in the name. With Resend they come from **noreply@thelogicgrid.com**, look more professional, and are less likely to land in spam. Resend's free plan (3,000 emails a month, 100 a day) needs no card and never bills; past the limit, Gmail takes over automatically.

**Safe:** the new records only use the names `send`, `resend._domainkey` and `_dmarc`. They don't touch the website records (GitHub Pages) or your Gmail.

## Part 1: Resend (5 minutes)

1. Go to https://resend.com/signup and sign up with **fantasticallogicgrid@gmail.com** (free plan; no card).
2. Open https://resend.com/domains and click **Add domain**.
3. Type `thelogicgrid.com`, pick region **North Virginia (us-east-1)**, click **Add**.
4. Leave that page open. It lists the records to add: one **MX** and one **TXT** named `send`, and one **TXT** named `resend._domainkey` (a long value starting with `p=`). Each has a copy button.

## Part 2: Namecheap Advanced DNS (5 minutes)

1. Go to https://ap.www.namecheap.com/domains/list/ and sign in.
2. Next to **thelogicgrid.com** click **Manage**, then the **Advanced DNS** tab.
3. **MX record.** Scroll to **Mail Settings**. In its dropdown choose **Custom MX**. (If it currently says **Email Forwarding** and you actually use forwarding addresses on thelogicgrid.com, stop and reply to this email first, because Custom MX turns forwarding off.) Click **Add New Record** in that section and fill in:
   - Type: **MX Record**
   - Host: `send`
   - Value: the MX value from Resend (it looks like `feedback-smtp.us-east-1.amazonses.com`)
   - Priority (the unlabeled box after Value): `10`
   - TTL: **Automatic**
   - Click the green check mark to save.
4. **SPF record.** Scroll up to **Host Records** and click **Add New Record**:
   - Type: **TXT Record**
   - Host: `send`
   - Value: `v=spf1 include:amazonses.com ~all` (or copy it from Resend)
   - TTL: **Automatic**, then the green check mark.
5. **DKIM record.** **Add New Record** again:
   - Type: **TXT Record**
   - Host: `resend._domainkey`
   - Value: copy the long `p=...` value from Resend exactly (use its copy button)
   - TTL: **Automatic**, then the green check mark.
6. **DMARC record (recommended; Gmail and Yahoo trust it more).** **Add New Record** again:
   - Type: **TXT Record**
   - Host: `_dmarc`
   - Value: `v=DMARC1; p=none;`
   - TTL: **Automatic**, then the green check mark.
7. Click **Save All Changes** if Namecheap shows that button.

Tip: in the Host box type only `send` or `resend._domainkey`, never the full `send.thelogicgrid.com`; Namecheap adds the domain itself.

## Part 3: Verify and add the key (5 minutes)

1. Back on the Resend domain page, click **Verify DNS records**. It usually turns **Verified** within an hour (Resend allows up to 72 hours).
2. Open https://resend.com/api-keys, click **Create API key**: name `logic-grid`, permission **Sending access**, domain `thelogicgrid.com`. Click **Add** and copy the key (it starts with `re_`; you only see it once).
3. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions/new. Name: `RESEND_API_KEY`, Secret: paste the key, click **Add secret**.
4. Reply in the Claude thread "Connect Resend email to Namecheap domain" (or reply to this email). Claude then runs the **Resend check**, which looks up the records and sends a test email to the game's Gmail from noreply@thelogicgrid.com. You can run it yourself too: https://github.com/bltaylorjr/fantastical-logic-grid/actions/workflows/resend-check.yml > **Run workflow**.

Never paste the key into an email or chat, only into the GitHub secret.
