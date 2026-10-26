# Tell Google the video errors are fixed (Search Console, 2 minutes)

**Why:** Search Console emailed you about 5 "Videos structured data" issues on https://www.thelogicgrid.com/ (missing thumbnailUrl, name, uploadDate, description, and contentUrl or embedUrl). The cause was on the home page: it pointed at the how-to-play video without describing it, so Google saw an empty video. The home page now carries the full video details, and the build now refuses to publish a video entry with any of those fields missing. Clicking **Validate fix** asks Google to check again sooner instead of waiting for its next visit. It's free.

**Steps:**

1. Wait until the site has redeployed with the fix (about 10 minutes after this email arrives).
2. Open https://search.google.com/search-console and pick the **thelogicgrid.com** property.
3. In the left menu, under **Enhancements**, click **Videos**. (If you don't see it there, open the link in Google's email instead.)
4. Click the first issue in the list, for example **Missing field "thumbnailUrl"**.
5. Click **Validate fix**. Google emails you when it starts and again when it finishes, which can take a few days up to about two weeks.
6. Go back and do the same for any other issue in the list that still shows **Validate fix**. Validating one critical issue usually re-checks the same page for the others too.
7. Optional, to see it yourself right away: open https://search.google.com/test/rich-results, enter `https://thelogicgrid.com/`, and click **Test URL**. The **Videos** item should show no errors.

If the issue count hasn't dropped two weeks after Google says validation finished, reply to this email and it will be looked at again.
