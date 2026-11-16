# Fix the Bluesky link in the website footer

**Why:** the Bluesky icon in the footer of every website page links to
https://bsky.app/profile/thelogicgrid.bsky.social, and that page says the
profile does not exist. The daily puzzle posts to Bluesky are working, so the
game's account is real, but its address is different. Visitors who click the
icon land on an error page. The nightly check flags it every night.

**What to do (about 2 minutes):**

1. Open the game's Bluesky account in the Bluesky app or at https://bsky.app
   and go to its profile. Copy the address from the browser bar. It looks like
   `https://bsky.app/profile/your-handle`.
2. Open the admin dashboard: https://flg-api.btay74.workers.dev/admin/
3. Go to **Settings and switches** > **Social links** > **Bluesky page**.
4. Paste the address and save.

The game shows the new link within about a minute. The website shows it after
the next nightly build. The nightly check will then stop reporting it.

If you would rather not show Bluesky at all, clear the **Bluesky page** box
and save. The icon then disappears.
