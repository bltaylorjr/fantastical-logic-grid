# Search: helping people find thelogicgrid.com

No tool or service can promise a top-5 place in Google or Bing. Search engines rank
pages by how well they answer what people type, how many other sites link to them and
how people use them. What we can do, for free, is make the site as easy as possible to
find, read and rank, keep it fresh, and catch problems early. That is what this setup does.

## What runs by itself

| What | When | Where |
|---|---|---|
| Search pages that work without JavaScript: How to play (with the video, transcript and FAQ), Themes (one page per theme), Difficulty levels, Daily puzzle | every build | `scripts/seo.mjs`, `seo/site.css` |
| A new **daily puzzle page** with a never-used story, plus the last 30 days | every night, 00:17 UTC | `.github/workflows/pages.yml` |
| Search tags on every page: description, canonical address, Open Graph and X/Twitter cards (share picture `seo/og-image.jpg`), and structured data (VideoGame, WebSite, HowTo, VideoObject, FAQ, Article, breadcrumbs) | every build | `scripts/seo.mjs` |
| `sitemap.xml` (with real "last changed" dates), `robots.txt`, `llms.txt` (for AI assistants), a friendly `404.html` | every build | `scripts/seo.mjs` |
| **IndexNow**: tells Bing, Yandex, Seznam, Naver and other IndexNow engines which pages changed, right after each publish | after every publish | `pages.yml`, job `indexnow` |
| **Site check** on every pull request: every page has a title, description, canonical address and one h1; every structured-data block has the fields Google needs; every link on the site works; the sitemap lists only real pages | each pull request | `scripts/check-site.mjs` (in `npm test`) |
| **Lighthouse** on every pull request: SEO (95+), accessibility (90+), layout shift (under 0.1) and the script-size budget must pass; the speed score (90), largest paint (2.5 s) and blocking time (300 ms) are warnings | each pull request | `.github/workflows/seo.yml`, `lighthouserc.json` |
| **Nightly live check** at 2 am Eastern: robots.txt, sitemap, every page answers and names itself as canonical, the daily page is fresh (published again if not), the IndexNow key, links to other sites, Lighthouse with the same budgets on the live site, and the Google and Bing numbers refresh. Anything wrong goes in the `nightly-maintenance` issue (and an email if it needs you) | nightly | `.github/workflows/nightly.yml`, `lighthouserc.live.json` |

Google does not use IndexNow and retired its sitemap "ping" in 2023. Google finds changes
through the sitemap you submit in Search Console (below), which it re-reads on its own.

The game page's text comes from `web/index.html`; the How to play transcript is copied
from it at build time, so it stays in step with the video.

## One-time setup (about 15 minutes, free, needs your accounts)

### 1. Google Search Console

1. Go to https://search.google.com/search-console and sign in with your Google account.
2. Choose **Add property**, then **Domain**, and type `thelogicgrid.com`.
3. Google shows a **TXT record**. Add it at your domain registrar's DNS settings
   (the same place you set up the GitHub Pages records), then press **Verify**.
   DNS changes can take up to an hour.
   - If you would rather not touch DNS: choose **URL prefix** with
     `https://thelogicgrid.com/`, pick **HTML tag**, and copy only the `content="..."`
     value. In GitHub, open the repository **Settings > Secrets and variables > Actions >
     Variables**, add `FLG_GOOGLE_SITE_VERIFICATION` with that value, run the
     **Publish web version** workflow, then press **Verify**.
   - Done (2026-10-25): the site is verified with Google's **HTML file** method. The file
     `hosting/google42317eab27119d46.html` is published at the site root. Keep it there,
     because Google re-checks it from time to time.
4. Open **Sitemaps**, enter `sitemap.xml`, and press **Submit**.
5. Open **URL inspection**, paste `https://thelogicgrid.com/`, and press
   **Request indexing**. Do the same for `/how-to-play/` and `/daily/`.

### 2. Bing Webmaster Tools (also feeds DuckDuckGo, Yahoo and Ecosia)

1. Go to https://www.bing.com/webmasters and sign in (a Microsoft, Google or Facebook account works).
2. Choose **Import from Google Search Console**. This copies the site and its sitemap in one step.
   - Or add the site by hand, pick the **Meta tag** method, and save its `content` value as
     the repository variable `FLG_BING_SITE_VERIFICATION`, then publish and verify.
   - Done (2026-10-25): the site is verified with Bing's **XML file** method. The file
     `hosting/BingSiteAuth.xml` is published at the site root. Keep it there.
3. IndexNow needs nothing more: the key file is already on the site.

### 3. Optional, also free

- **Google Business Profile** is only for places people can visit, so skip it.
- List the game on free directories people browse for games, such as itch.io (web games
  can be listed for free), and share the link where puzzle fans gather. Links from other
  sites are the biggest ranking factor this setup cannot create on its own.
- When the mobile apps resume, their store listings (Google Play, App Store) should link
  to the site, and the site can link back to them.

## What to watch

- In Search Console: **Performance** shows the searches people found the site with and
  its average position. **Pages** shows anything Google could not index, and why.
- The `nightly-maintenance` issue, if one opens (it closes itself on a clean night).
- The first results usually take a few days to a few weeks to appear for a new domain.

## Settings

All optional repository variables (Settings > Secrets and variables > Actions > Variables):

| Variable | Use |
|---|---|
| `FLG_GOOGLE_SITE_VERIFICATION` | Google "HTML tag" verification value |
| `FLG_BING_SITE_VERIFICATION` | Bing "meta tag" verification value |
| `FLG_SITE_URL` | the site address, if it ever moves from `https://thelogicgrid.com` |
| `FLG_INDEXNOW_KEY` | a different IndexNow key (also change `INDEXNOW_KEY` in `scripts/seo.mjs`) |

GitHub pauses scheduled workflows in a repository that has had no commits for 60 days.
If that happens, the weekly check will say the daily page is stale; re-enable the
workflow from the **Actions** tab.

## Changing the pages

- Wording, FAQ and page layout: `scripts/seo.mjs`. Colors and spacing: `seo/site.css`.
- Share picture: edit `seo/og-card.html`, then `npm run build && node scripts/og-image.cjs`.
- Try it locally: `npm run build && node scripts/serve.mjs dist/site 8080`, then open
  http://localhost:8080/how-to-play/. Lighthouse: `npx @lhci/cli@0.15.1 autorun`.
