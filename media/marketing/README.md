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
