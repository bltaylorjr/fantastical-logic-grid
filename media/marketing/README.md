# Marketing pictures

Pictures for the launch campaign's posts, one per channel size. They are
listed with the promo videos (`media/promo`) in the admin dashboard's
**Marketing** section, where each ad says which ones it uses.

| File | Size | For |
| --- | --- | --- |
| `wide-1600x900.png` | 1600 x 900 | X, Bluesky, Threads, Mastodon, LinkedIn, Reddit |
| `square-1080.png` | 1080 x 1080 | Instagram and Facebook feed posts |
| `pin-1000x1500.png` | 1000 x 1500 | Pinterest |
| `gallery-1270x760.png` | 1270 x 760 | Product Hunt, itch.io, AlternativeTo, Microsoft Store |
| `itch-cover-630x500.png` | 630 x 500 | itch.io cover |
| `facebook-cover-1640x624.png` | 1640 x 624 | Facebook Page cover photo |

Each picture also has a `.jpg` twin, because Instagram's posting tool takes JPEG only
(`scripts/marketing-post.py` swaps `.png` for `.jpg` for Instagram). After a rebuild,
remake them: `python3 -c "from PIL import Image;import glob;[Image.open(f).convert('RGB').save(f[:-4]+'.jpg',quality=90) for f in glob.glob('media/marketing/*.png')]"`.

## Rebuild them

They are made from the real game, so they stay up to date with its look:

```
npm ci && npm run build
node media/marketing/tools/make-images.cjs
```

`tools/make-images.cjs` opens the built game, makes a puzzle, takes pictures
of the grid, the clues and the story scene, and lays them out on the game's
colours with its fonts and logo. It also writes the small previews the admin
dashboard shows (`admin/marketing-*.png`). Everything is free and made here,
so there is nothing to license.

## Educator campaign

Pictures and a printable flyer for the `educators-2026` campaign (free
puzzle packages for teachers, schools and districts on the website's
Educators page). Each picture has a `.jpg` twin for Instagram and the
automatic poster.

| File | Size | For |
| --- | --- | --- |
| `educators-wide-1600x900.png` | 1600 x 900 | X, Bluesky, Mastodon, LinkedIn, Reddit, Facebook Page, OER Commons |
| `educators-square-1080.png` | 1080 x 1080 | Instagram, Threads, Facebook groups, newsletters |
| `educators-pin-1000x1500.png` | 1000 x 1500 | Pinterest teacher boards |
| `educators-flyer-letter.pdf` | US Letter | Staff rooms, school offices, district emails (with a `.png` copy) |

The flyer's QR code is the tracked link of the "Printable flyer with QR
code" ad (`utm_source=flyer&utm_medium=qr&utm_campaign=educators-2026&utm_content=staff-room`),
so every scan shows in the admin Marketing numbers. They are made from a
real sample Grade 4 package (`scripts/educator-package.mjs`):

```
npm ci && npm run build
pip install segno   # free QR code maker
node media/marketing/tools/make-educator-images.cjs
```
