# Turn on your alerts: push to your phone and email (about 10 minutes)

**Why:** The admin dashboard can now alert you when something needs you: problems (a new kind of error in the apps, a disputed payment, failed nightly maintenance) and things waiting for approval (educator requests, character suggestions) arrive at once. Player messages, ideas and problem reports, new screen names and new ads are gathered into one alert at most once an hour.

**Cost:** free. Push alerts use your phone's or browser's own push service. Emails go from noreply@thelogicgrid.com through Resend's free plan. No text messages (those would need a paid service).

**Each admin sets up their own.** Only you see your choices.

## Part 1: Let the Worker send email (2 minutes, once)

Skip this if you only want push alerts.

1. Find your Resend key: it's the same one saved as the **RESEND_API_KEY** GitHub secret. If you don't have a copy, make a new one at https://resend.com/api-keys (**Create API key**, permission **Sending access**, domain **thelogicgrid.com**).
2. Go to https://dash.cloudflare.com, then **Workers & Pages**, then **flg-api**.
3. Open **Settings**, then **Variables and Secrets**, then **Add**.
4. Type **Secret**, name `RESEND_API_KEY`, paste the key, and click **Deploy**.

## Part 2: Push alerts on your phone (3 minutes per device)

**iPhone or iPad** (iOS 16.4 or newer):

1. In Safari, open the admin dashboard and sign in.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open the dashboard from the new Home Screen icon (alerts only work from there).
4. Go to **Settings and switches**. At the top, under **My alerts**, check the device name and tap **Turn on alerts on this device**.
5. Tap **Allow** when asked.

**Android phone, or a computer** (Chrome, Edge, Firefox or Safari):

1. Open the admin dashboard and sign in.
2. Go to **Settings and switches**, then **My alerts**, then **Turn on alerts on this device**.
3. Choose **Allow** when asked.

The desktop admin app can't show push alerts. Use email, or turn on push in your browser instead.

## Part 3: Your email and what to alert you about (2 minutes)

1. In **My alerts**, type the address for alerts under **Send alerts to this email address**. You can change it any time.
2. Tick **Email me alerts too**.
3. Under **What to alert me about**, untick anything you don't want.
4. Click **Save my alert choices**, then **Send a test alert**. You should get a push and an email within a minute.

**To stop alerts on a device:** click **Remove** next to it under **Your devices**. To stop emails, untick **Email me alerts too** and save.
